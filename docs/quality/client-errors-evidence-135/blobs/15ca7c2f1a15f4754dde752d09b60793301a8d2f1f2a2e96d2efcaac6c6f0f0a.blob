import type { Tx } from "./db.js";
import { Problem } from "./lib.js";

/** Paid inference and ordinary task tools require the resource consent as well
 * as normal task authority. Read through the current private-owner RLS scope. */
export async function assertDedicatedComputerExecution(tx: Tx, task: any) {
  const locator = task.input_context?.dedicated_computer;
  if (!locator && task.role_key !== "computer-operator") return;
  if (!locator || task.execution_location !== "cloud" || task.mode !== "execute" || task.role_key !== "computer-operator")
    throw new Problem(409, "CLOUD_RUNTIME_AGENT_CONSENT_REQUIRED", "Confirm a specific running computer before starting this task");
  const allowed = (await tx.query(`SELECT 1 FROM cloud_runtime_task_bindings b
    JOIN cloud_runtime_sessions s ON s.id=b.session_id JOIN cloud_runtime_quotes q ON q.id=s.quote_id
    WHERE b.task_id=$1 AND b.tenant_id=$2 AND b.project_id=$3 AND b.private_owner=$4 AND NOT b.revoked
    AND s.id=$5 AND b.generation=$6 AND b.specification_hash=$7
    AND b.generation=s.generation AND b.specification_hash=q.specification_hash
    AND s.state='running' AND s.expires_at>clock_timestamp()
    AND s.content_state='active' AND q.content_state='active'
    AND q.actor_auth_version=$8 AND q.body->'scope'->'agent_control'='true'::jsonb`,
    [task.id,task.tenant_id,task.project_id,task.private_owner,locator.session_id,locator.generation,locator.specification_hash,task.actor_auth_version])).rowCount;
  if (!allowed) throw new Problem(409, "CLOUD_RUNTIME_LEASE_ENDED", "The approved computer is no longer available for this task");
}
