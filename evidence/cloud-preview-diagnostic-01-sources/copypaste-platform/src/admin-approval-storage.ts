import type { Database, Tx } from "./db.js";
import { audit } from "./auth.js";
import { lockAdminAccess } from "./admin-access.js";

export function approvalDTO(r: any) {
  return {
    id: r.id,
    operation_id: r.operation_id,
    requester_id: r.requester_id,
    payload_hash: r.payload_hash,
    state: r.state,
    expires_at: new Date(r.expires_at).toISOString(),
    version: r.version,
  };
}

export async function createApprovalRequest(tx: Tx, op: any) {
  return (
    await tx.query(
      "INSERT INTO admin_approval_requests(operation_id,requester_id,payload_hash,policy_version_id,expires_at) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [
        op.id,
        op.principal_id,
        op.payload_hash,
        op.policy_version_id,
        op.payload.expires_at,
      ],
    )
  ).rows[0];
}

/** The worker persists real expiry, with the operation and system audit in the
 * same transaction. No reviewer or human approval decision is invented. */
export async function expireAdminApprovals(db: Database) {
  return db.tx(
    async (tx) => {
      // Use the same lock order as writers and approval decisions.
      await lockAdminAccess(tx);
      const rows = (
        await tx.query(
          "SELECT * FROM admin_approval_requests WHERE state='pending' AND expires_at<=now() ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED",
        )
      ).rows;
      for (const r of rows) {
        const op = (
          await tx.query(
            "SELECT * FROM admin_operations WHERE id=$1 FOR UPDATE",
            [r.operation_id],
          )
        ).rows[0];
        if (op.state !== "pending_approval") continue;
        await tx.query(
          "UPDATE admin_operations SET state='cancelled',version=version+1,result=coalesce(result,'{}'::jsonb)||'{\"error_code\":\"OPERATION_EXPIRED\"}'::jsonb WHERE id=$1",
          [op.id],
        );
        await tx.query(
          "UPDATE admin_approval_requests SET state='expired',version=version+1 WHERE id=$1",
          [r.id],
        );
        await audit(
          tx,
          undefined,
          "admin.approval.expire",
          r.id,
          "succeeded",
          { operation_id: op.id, payload_hash: r.payload_hash },
          op.tenant_id ?? undefined,
        );
      }
      return rows.length;
    },
    undefined,
    true,
  );
}
