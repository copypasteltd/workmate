import type { FastifyInstance } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import type { Principal } from "./auth.js";
import { requireUser } from "./auth.js";
import { tenantAccess, key, replay } from "./access.js";
import { currentUserAuthority, lockUserAuthorities } from "./user-authority.js";
import { canonical, hash, Problem, uuid } from "./lib.js";

const mode = (db: Database) =>
  db.config.DEMO_MODE ? "simulated" : "configured_services";
const query = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().min(1).max(4096).optional(),
    account_id: uuid.optional(),
    category: z.enum(["account_updates", "all"]).default("account_updates"),
    unread: z.enum(["true", "false"]).optional(),
  })
  .strict();
const cursorBody = z
  .object({
    v: z.literal(1),
    scope: z.string().regex(/^[a-f0-9]{64}$/),
    before: z.string().max(60),
    created: z.string().max(60),
    id: uuid,
    expires: z.number().int(),
  })
  .strict();
const noticeQuery = `SELECT n.id,n.read,n.created_at::text AS delivered_at,o.created_at::text AS recorded_at,
  w.id AS account_id,w.tenant_id,w.user_id,w.data_mode,o.kind AS source_kind,
  j.id AS journal_id,j.kind AS journal_kind,j.direction,j.bucket,j.amount_micros::text AS journal_amount,j.operation_id AS journal_operation,
  p.id AS payment_id,p.amount_micros::text AS payment_amount,pc.operation_id AS confirmation_operation,p.operation_id AS payment_operation,
  r.id AS refund_id,r.amount_micros::text AS requested_amount,r.operation_id AS refund_operation,
  e.id AS refund_event_id,e.outcome,e.observed_amount_micros::text AS observed_amount,e.operation_id AS refund_event_operation
  FROM financial_notifications n JOIN financial_outbox o ON o.id=n.outbox_id JOIN wallets w ON w.id=o.billing_account_id
  LEFT JOIN billing_journal j ON j.id=o.journal_id LEFT JOIN payment_records p ON p.id=o.payment_id
  LEFT JOIN payment_confirmations pc ON pc.payment_record_id=p.id
  LEFT JOIN billing_refund_events e ON e.id=o.refund_event_id LEFT JOIN billing_refunds r ON r.id=coalesce(o.refund_id,e.refund_id)`;
const visible = `n.recipient_id=$1 AND w.data_mode=$3 AND
  (w.user_id=$1 OR (w.tenant_id=$2 AND EXISTS(SELECT 1 FROM memberships m JOIN tenants t ON t.id=m.tenant_id
    WHERE m.tenant_id=w.tenant_id AND m.user_id=$1 AND m.status='active' AND NOT m.admin_suspended
    AND m.role IN ('owner','admin') AND t.status='active' AND t.admin_closed_at IS NULL)))`;
const money = (value: string | null) =>
  value === null ? null : { currency: "HKD", amount_micros: value };
function dto(r: any) {
  const journal = r.source_kind === "journal",
    payment = r.source_kind.startsWith("payment_"),
    outcome = r.source_kind === "refund_outcome";
  return {
    id: r.id,
    read: r.read,
    recorded_at: new Date(r.recorded_at).toISOString(),
    delivered_at: new Date(r.delivered_at).toISOString(),
    subject: {
      kind: r.user_id ? "user" : "tenant",
      id: r.user_id ?? r.tenant_id,
    },
    billing_account_id: r.account_id,
    data_mode: r.data_mode,
    event_type: journal
      ? "billing." + r.journal_kind
      : outcome
        ? "refund." + r.outcome
        : r.source_kind.replace("_", "."),
    source_id: r.journal_id ?? r.refund_event_id ?? r.refund_id ?? r.payment_id,
    operation_id: journal
      ? r.journal_operation
      : outcome
        ? r.refund_event_operation
        : payment
          ? r.source_kind === "payment_confirmed"
            ? r.confirmation_operation
            : r.payment_operation
          : r.refund_operation,
    amount: money(
      journal
        ? r.journal_amount
        : payment
          ? r.payment_amount
          : outcome
            ? r.observed_amount
            : r.requested_amount,
    ),
    requested_amount:
      outcome || r.source_kind === "refund_requested"
        ? money(r.requested_amount)
        : null,
    direction: journal ? r.direction : "neutral",
    bucket: journal ? r.bucket : null,
  };
}
function signed(db: Database, value: z.infer<typeof cursorBody>) {
  const encoded = Buffer.from(JSON.stringify(value)).toString("base64url");
  return (
    encoded +
    "." +
    createHmac("sha256", db.config.MASTER_KEY!)
      .update(encoded)
      .digest("base64url")
  );
}
function decode(db: Database, token: string, scope: string) {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) throw new Error();
    const expected = createHmac("sha256", db.config.MASTER_KEY!)
        .update(parts[0])
        .digest(),
      actual = Buffer.from(parts[1], "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(expected, actual))
      throw new Error();
    const value = cursorBody.parse(
      JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")),
    );
    if (value.scope !== scope || value.expires <= Date.now()) throw new Error();
    return value;
  } catch {
    throw new Problem(
      410,
      "CURSOR_EXPIRED",
      "Refresh the current financial inbox",
    );
  }
}
async function authority(tx: Tx, p: Principal, tenant: string) {
  await lockUserAuthorities(tx, [p.id]);
  const user = await currentUserAuthority(tx, p);
  if (user.admin_closed_at)
    throw new Problem(
      401,
      "AUTHORIZATION_CHANGED",
      "Your account authorization changed; sign in again",
    );
  const member = await tenantAccess(tx, p, tenant);
  // Control transactions bypass table RLS, so retain its administrative
  // suspension/closure checks explicitly as well as the normal role check.
  if (
    !(
      await tx.query(
        `SELECT 1 FROM memberships m JOIN tenants t ON t.id=m.tenant_id
    WHERE m.user_id=$1 AND m.tenant_id=$2 AND NOT m.admin_suspended AND t.admin_closed_at IS NULL`,
        [p.id, tenant],
      )
    ).rowCount
  )
    throw new Problem(404, "NOT_FOUND", "Workspace not found");
  return member;
}
export function registerFinancialNotifications(
  app: FastifyInstance,
  db: Database,
) {
  const auth = { preHandler: requireUser(db) };
  app.get("/v1/financial-notifications", auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const tenant = uuid.parse(req.headers["x-tenant-id"]),
      q = query.parse(req.query);
    return db.tx(
      async (tx) => {
        const member = await authority(tx, req.principal, tenant),
          args = [req.principal.id, tenant, mode(db)],
          scope = hash(
            canonical({
              actor: req.principal.id,
              session: req.principal.sessionId,
              auth: req.principal.authVersion,
              tenant,
              role: member.role,
              membership: member.version,
              mode: mode(db),
              account: q.account_id ?? null,
              category: q.category,
              unread: q.unread ?? null,
            }),
          ),
          cursor = q.cursor ? decode(db, q.cursor, scope) : null;
        if (
          q.account_id &&
          !(
            await tx.query(
              `SELECT 1 FROM wallets w WHERE w.id=$1 AND w.data_mode=$4 AND
        (w.user_id=$2 OR (w.tenant_id=$3 AND $5::boolean))`,
              [
                q.account_id,
                req.principal.id,
                tenant,
                mode(db),
                ["owner", "admin"].includes(member.role),
              ],
            )
          ).rowCount
        )
          throw new Problem(404, "NOT_FOUND", "Billing account not found");
        const filters = `AND ($4::uuid IS NULL OR w.id=$4) AND ($5='all' OR o.kind<>'journal' OR j.kind NOT IN ('reserve','consume','release'))`;
        if (
          cursor &&
          !(
            await tx.query(
              `${noticeQuery} WHERE ${visible} ${filters} AND n.id=$6 AND n.created_at=$7::timestamptz`,
              [
                ...args,
                q.account_id ?? null,
                q.category,
                cursor.id,
                cursor.created,
              ],
            )
          ).rowCount
        )
          throw new Problem(
            410,
            "CURSOR_EXPIRED",
            "Refresh the current financial inbox",
          );
        const before =
            cursor?.before ??
            (await tx.query("SELECT clock_timestamp()::text AS at")).rows[0].at,
          rows = (
            await tx.query(
              `${noticeQuery} WHERE ${visible} ${filters} AND n.created_at<=$6::timestamptz
          AND ($7::timestamptz IS NULL OR (n.created_at,n.id)<($7,$8::uuid))
          AND ($9::boolean IS NULL OR n.read=NOT $9) ORDER BY n.created_at DESC,n.id DESC LIMIT $10`,
              [
                ...args,
                q.account_id ?? null,
                q.category,
                before,
                cursor?.created ?? null,
                cursor?.id ?? null,
                q.unread === undefined ? null : q.unread === "true",
                q.limit + 1,
              ],
            )
          ).rows,
          items = rows.slice(0, q.limit),
          last = items.at(-1);
        return {
          items: items.map(dto),
          next_cursor:
            rows.length > q.limit
              ? signed(db, {
                  v: 1,
                  scope,
                  before,
                  created: last.delivered_at,
                  id: last.id,
                  expires: cursor?.expires ?? Date.now() + 15 * 60 * 1000,
                })
              : null,
        };
      },
      tenant,
      true,
      req.principal.id,
    );
  });
  app.patch(
    "/v1/financial-notifications/:notification_id",
    auth,
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      z.object({}).strict().parse(req.query);
      const tenant = uuid.parse(req.headers["x-tenant-id"]),
        id = uuid.parse((req.params as any).notification_id),
        body = z.object({ read: z.boolean() }).strict().parse(req.body);
      return db.tx(
        async (tx) => {
          await authority(tx, req.principal, tenant);
          if (
            !(
              await tx.query(`${noticeQuery} WHERE ${visible} AND n.id=$4`, [
                req.principal.id,
                tenant,
                mode(db),
                id,
              ])
            ).rowCount
          )
            throw new Problem(
              404,
              "NOT_FOUND",
              "Financial notification not found",
            );
          return replay(
            tx,
            req.principal.id,
            `financial.notification:${id}`,
            key(req),
            body,
            async () =>
              (
                await tx.query(
                  "UPDATE financial_notifications SET read=$2 WHERE id=$1 AND recipient_id=$3 RETURNING id,read",
                  [id, body.read, req.principal.id],
                )
              ).rows[0],
          );
        },
        tenant,
        true,
        req.principal.id,
      );
    },
  );
}

/** Financial truth commits with its source. Delivery can retry independently;
 * reads always recheck current recipient, subject, role and execution mode. */
export async function dispatchFinancialNotifications(db: Database) {
  return db.tx(
    async (tx) => {
      const rows = (
        await tx.query(
          `SELECT o.id,w.user_id,w.tenant_id FROM financial_outbox o JOIN wallets w ON w.id=o.billing_account_id
      WHERE o.dispatched_at IS NULL AND w.data_mode=$1 ORDER BY o.created_at,o.id LIMIT 100 FOR UPDATE OF o SKIP LOCKED`,
          [mode(db)],
        )
      ).rows;
      for (const row of rows) {
        await tx.query(
          `INSERT INTO financial_notifications(outbox_id,recipient_id)
        SELECT $1,u.id FROM users u WHERE
        (u.id=$2 OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.tenant_id=$3 AND m.role IN ('owner','admin')))
        AND financial_recipient_allowed((SELECT billing_account_id FROM financial_outbox WHERE id=$1),u.id)
        ON CONFLICT(outbox_id,recipient_id) DO NOTHING`,
          [row.id, row.user_id, row.tenant_id],
        );
        await tx.query(
          "UPDATE financial_outbox SET dispatched_at=clock_timestamp() WHERE id=$1",
          [row.id],
        );
      }
      return rows.length;
    },
    undefined,
    true,
  );
}
