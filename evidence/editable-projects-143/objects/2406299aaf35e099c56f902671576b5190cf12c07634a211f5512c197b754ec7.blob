import type { Tx } from "./db.js";
import { canonical, hash, Problem } from "./lib.js";
import { revisionSelection, type RevisionBinding } from "./delivery-revision-model.js";

/** Called after the existing recursive source locks. No new read authority is granted. */
export async function assertDeliveryRevisionSource(tx: Tx, task: { id: string; input_context?: any }, visited = new Set<string>()) {
  const context = task.input_context ?? (await tx.query("SELECT input_context FROM tasks WHERE id=$1", [task.id])).rows[0]?.input_context;
  if (!context?.delivery_revision) return;
  if (visited.has(task.id) || visited.size >= 128)
    throw new Problem(409, "REVISION_SOURCE_UNAVAILABLE", "The revision source chain cannot be resolved");
  visited.add(task.id);
  const reference = context.delivery_revision as RevisionBinding;
  const parsed = revisionSelection.safeParse({ source_task_id: reference.source_task_id, expected_version: reference.expected_version,
    expected_delivery_hash: reference.expected_delivery_hash, target: reference.target });
  if (!parsed.success || context.plan_source_task_id !== reference.source_task_id)
    throw new Problem(409, "REVISION_SOURCE_UNAVAILABLE", "This revision has no valid fixed source");
  const original = (await tx.query(`SELECT t.id,t.role_key,t.role_hash,t.input_context,business_delivery_snapshot(t.id) AS delivery
    FROM tasks t WHERE t.id=$1 AND t.content_state='active' AND t.status IN('succeeded','failed','cancelled')
      AND business_quality_sources_available(t.id)`, [reference.source_task_id])).rows[0];
  if (!original || original.role_key !== reference.source_role_key || original.role_hash !== reference.source_role_hash
    || hash(canonical(original.delivery)) !== reference.expected_delivery_hash)
    throw new Problem(409, "REVISION_SOURCE_CHANGED", "The fixed original delivery is no longer available");
  await assertDeliveryRevisionSource(tx, original, visited);
}
