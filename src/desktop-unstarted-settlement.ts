import type { Tx } from "./db.js";
import { desktopStartupProtocol } from "./desktop-startup-recovery.js";

/** Caller holds the task/execution locks and has already closed their gateways.
 * A zero ledger alone proves nothing after local turn admission. */
export async function desktopUnstartedSettlementProof(
  tx: Tx, task: any, execution: any,
  cost: { knownChargeMicros: number; inputTokens: number; outputTokens: number; uncertain: boolean; violation: boolean },
) {
  if (execution.startup_protocol !== desktopStartupProtocol || execution.startup_state !== "preparing"
    || task.execution_location !== "desktop" || task.runtime_turn != null
    || cost.uncertain || cost.violation || cost.knownChargeMicros !== 0 || cost.inputTokens !== 0 || cost.outputTokens !== 0)
    return null;
  // Maintenance has no signed-in actor. Bind the proof to this locked task's
  // durable owner; never infer ownership from a client request body.
  await tx.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.actor_id',$2,true)", [task.tenant_id, task.created_by]);
  const proof = (await tx.query("SELECT desktop_startup_admission_proof($1) AS proof", [task.id])).rows[0]?.proof;
  const counts = ["model_requests", "input_count_requests", "company_tool_admissions", "tool_operations", "video_jobs", "audio_jobs"];
  if (proof?.safe !== true || proof.task_id !== task.id || proof.fencing_token !== task.fencing_token
    || proof.worker_attempt !== task.attempt || proof.turn_admitted !== false || counts.some(key => proof[key] !== 0)) return null;
  return proof;
}
