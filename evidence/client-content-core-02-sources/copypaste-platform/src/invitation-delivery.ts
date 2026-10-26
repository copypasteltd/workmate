import { randomUUID } from "node:crypto";
import type { Database, Tx } from "./db.js";
import { sendMail } from "./auth.js";
import { seal, unseal } from "./lib.js";

export async function validInvitationIssuer(tx: Tx, i: any): Promise<boolean> {
  const m = (
    await tx.query(
      "SELECT m.role,m.version FROM memberships m JOIN users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.status='active' AND u.status='active' AND t.status='active'",
      [i.tenant_id, i.created_by],
    )
  ).rows[0];
  if (
    !m ||
    m.version !== i.issuer_version ||
    !["owner", "admin"].includes(m.role) ||
    (["owner", "admin"].includes(i.role) && m.role !== "owner")
  )
    return false;
  const n = (
    await tx.query(
      "SELECT count(*)::int AS n FROM projects WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND NOT archived",
      [i.tenant_id, i.project_ids],
    )
  ).rows[0].n;
  return n === new Set(i.project_ids).size;
}
export async function queueInvitation(
  tx: Tx,
  db: Database,
  i: any,
  value: string,
) {
  await tx.query(
    "INSERT INTO invitation_deliveries(invite_id,tenant_id,version,token_cipher) VALUES($1,$2,$3,$4) ON CONFLICT(invite_id) DO UPDATE SET version=EXCLUDED.version,token_cipher=EXCLUDED.token_cipher,state='queued',attempts=0,next_attempt_at=now(),lease_id=NULL,lease_until=NULL,last_error=NULL,delivered_at=NULL",
    [i.id, i.tenant_id, i.version, seal(db.config.MASTER_KEY!, value)],
  );
}
/** SMTP is at least once. A fenced lease prevents stale workers updating newer
 * resend generations; a crash after SMTP can repeat the same single-use link.
 * No network I/O occurs inside a database transaction or membership lock.
 */
export async function dispatchInvitationMail(
  db: Database,
  options: { limit?: number; send?: typeof sendMail } = {},
) {
  const result = { delivered: 0, failed: 0, cancelled: 0 };
  await db.control.query(
    "UPDATE invitation_deliveries SET state='failed',last_error='MAIL_UNAVAILABLE',lease_id=NULL,lease_until=NULL WHERE state='sending' AND lease_until<now() AND attempts>=8",
  );
  // Erase recoverable tokens on expiry even after the bounded retry budget ends.
  await db.control.query(
    "UPDATE invitation_deliveries d SET state='cancelled',token_cipher=NULL,lease_id=NULL,lease_until=NULL FROM invites i WHERE i.id=d.invite_id AND d.state IN ('queued','sending','failed') AND (i.expires_at<=now() OR i.consumed_at IS NOT NULL OR i.revoked_at IS NOT NULL)",
  );
  for (let n = 0; n < Math.min(options.limit ?? 2, 20); n++) {
    const next = (
      await db.control.query(
        "SELECT d.invite_id,d.tenant_id FROM invitation_deliveries d WHERE ((d.state IN ('queued','failed') AND d.next_attempt_at<=now()) OR (d.state='sending' AND d.lease_until<now())) AND d.attempts<8 ORDER BY d.next_attempt_at,d.invite_id LIMIT 1",
      )
    ).rows[0];
    if (!next) break;
    const claimed = await db.tx(
      async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `members:${next.tenant_id}`,
        ]);
        const row = (
          await tx.query(
            "SELECT i.*,d.version AS delivery_version,d.token_cipher,d.attempts FROM invites i JOIN invitation_deliveries d ON d.invite_id=i.id WHERE i.id=$1 AND d.attempts<8 AND ((d.state IN ('queued','failed') AND d.next_attempt_at<=now()) OR (d.state='sending' AND d.lease_until<now())) FOR UPDATE OF i,d",
            [next.invite_id],
          )
        ).rows[0];
        if (!row) return null;
        if (
          row.version !== row.delivery_version ||
          row.consumed_at ||
          row.revoked_at ||
          new Date(row.expires_at).getTime() <= Date.now() ||
          !(await validInvitationIssuer(tx, row))
        ) {
          await tx.query(
            "UPDATE invitation_deliveries SET state='cancelled',token_cipher=NULL,lease_id=NULL,lease_until=NULL WHERE invite_id=$1",
            [row.id],
          );
          result.cancelled++;
          return null;
        }
        const lease = randomUUID();
        await tx.query(
          "UPDATE invitation_deliveries SET state='sending',attempts=attempts+1,lease_id=$2,lease_until=now()+interval '45 seconds' WHERE invite_id=$1",
          [row.id, lease],
        );
        return { ...row, lease, attempts: row.attempts + 1 };
      },
      next.tenant_id,
      true,
    );
    if (!claimed) continue;
    try {
      const value = unseal(db.config.MASTER_KEY!, claimed.token_cipher);
      await (options.send ?? sendMail)(
        db,
        claimed.email,
        "CopyPaste · Workspace invitation",
        `You have been invited to a CopyPaste workspace. Sign in using this email and accept: ${db.config.WEB_ORIGIN}/invite?token=${value}&workspace=${claimed.tenant_id}`,
        claimed.id,
        10_000,
      );
      const saved = await db.control.query(
        "UPDATE invitation_deliveries SET state='delivered',token_cipher=NULL,delivered_at=now(),last_error=NULL,lease_id=NULL,lease_until=NULL WHERE invite_id=$1 AND version=$2 AND lease_id=$3 AND state='sending'",
        [claimed.id, claimed.version, claimed.lease],
      );
      if (saved.rowCount) result.delivered++;
    } catch {
      const saved = await db.control.query(
        "UPDATE invitation_deliveries SET state='failed',last_error='MAIL_UNAVAILABLE',next_attempt_at=now()+make_interval(secs=>$4),lease_id=NULL,lease_until=NULL WHERE invite_id=$1 AND version=$2 AND lease_id=$3 AND state='sending'",
        [
          claimed.id,
          claimed.version,
          claimed.lease,
          Math.min(3600, 30 * 2 ** (claimed.attempts - 1)),
        ],
      );
      if (saved.rowCount) result.failed++;
    }
  }
  return result;
}
