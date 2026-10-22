import type { Tx } from "./db.js";
import { event } from "./tasks.js";

export async function readyOutbox(tx: Tx, dataMode: string) {
  return (
    await tx.query(
      `WITH ready AS (
    SELECT o.id,o.created_at,row_number() OVER(PARTITION BY o.tenant_id ORDER BY o.created_at,o.id) AS tenant_position
    FROM outbox o WHERE o.dispatched_at IS NULL AND (o.topic<>'task.run' OR EXISTS(
      SELECT 1 FROM tasks t WHERE t.execution_location='cloud' AND t.id::text=o.payload->>'task_id' AND t.data_mode=$1 AND t.status='queued' AND NOT t.cancel_requested AND t.capacity_retry_at<=now()
        AND (t.input_context->>'seo_audit_id' IS NULL OR EXISTS(SELECT 1 FROM seo_runs sr WHERE sr.id::text=t.input_context->>'seo_audit_id' AND sr.task_id=t.id AND sr.state IN('complete','partial') AND sr.result_asset_version_id IS NOT NULL AND sr.invalidated_at IS NULL))))
  ) SELECT o.* FROM outbox o JOIN ready r ON r.id=o.id
    ORDER BY r.tenant_position,r.created_at,o.id FOR UPDATE OF o SKIP LOCKED LIMIT 20`,
      [dataMode],
    )
  ).rows;
}

export function executionClass(
  role: any,
  mode: string,
): "text" | "image" | "media" {
  if (mode !== "execute") return "text";
  if (
    role.tool_ids.some(
      (id: string) => id.startsWith("video.") || id.startsWith("speech."),
    )
  )
    return "media";
  if (role.tool_ids.some((id: string) => id.startsWith("image.")))
    return "image";
  return "text";
}

/** The database counts and claims atomically; no slot is held by an input wait. */
export async function claimCapacity(
  tx: Tx,
  task: any,
  role: any,
  userLimit: number,
  fencing: string,
) {
  const reason = (
    await tx.query("SELECT claim_execution_capacity($1,$2,$3,$4) AS reason", [
      task.id,
      executionClass(role, task.mode),
      userLimit,
      fencing,
    ])
  ).rows[0].reason as string | null;
  if (reason) {
    // The task lock also serializes duplicate queue deliveries and recovery.
    // At most one undispatched replacement waits for its retry time.
    await tx.query(
      `INSERT INTO outbox(tenant_id,topic,payload)
      SELECT $1,'task.run',jsonb_build_object('task_id',$2::text)
      WHERE NOT EXISTS(SELECT 1 FROM outbox WHERE topic='task.run' AND payload->>'task_id'=$2::text AND dispatched_at IS NULL)`,
      [task.tenant_id, task.id],
    );
    if (task.capacity_wait_reason !== reason)
      await event(tx, task.tenant_id, task.id, "task.capacity_wait", {
        reason,
      });
    return null;
  }
  return (await tx.query("SELECT * FROM tasks WHERE id=$1", [task.id])).rows[0];
}
