import type { Tx } from "./db.js";
import type { Principal } from "./auth.js";
import { audit } from "./auth.js";
import { settle } from "./billing.js";
import { event } from "./tasks.js";

export async function cancelWorkflowRun(
  tx: Tx,
  run: any,
  actor: Principal,
  code = "CANCELLED",
) {
  if (!["running", "awaiting_approval"].includes(run.state)) return;
  if (run.active_task) {
    const task = (
      await tx.query("SELECT * FROM tasks WHERE id=$1 FOR UPDATE", [
        run.active_task,
      ])
    ).rows[0];
    if (task?.status === "running")
      await tx.query(
        "UPDATE tasks SET cancel_requested=true,version=version+1 WHERE id=$1",
        [task.id],
      );
    else if (
      task &&
      ["queued", "paused", "awaiting_approval"].includes(task.status)
    ) {
      await settle(tx, run.tenant_id, task.id, 0, task.created_by);
      await tx.query(
        "UPDATE tasks SET status='cancelled',cancel_requested=true,version=version+1 WHERE id=$1",
        [task.id],
      );
    }
    if (task)
      await event(tx, run.tenant_id, task.id, "workflow.cancel_requested", {
        workflow_run_id: run.id,
      });
  }
  await tx.query(
    "UPDATE workflow_runs SET state='cancelled',error_code=$2 WHERE id=$1",
    [run.id, code],
  );
  await audit(
    tx,
    actor,
    "workflow.cancel",
    run.id,
    "succeeded",
    { code },
    run.tenant_id,
  );
}
