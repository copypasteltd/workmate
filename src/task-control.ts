import type { Database, Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import type { Principal } from "./auth.js";
import { projectAccess } from "./access.js";
import { Problem } from "./lib.js";
import { event } from "./tasks.js";
import { assertTaskSkills } from "./skill-lifecycle.js";
import { authorizeExecutionPlan } from "./plans.js";
import { resolveWorkContext } from "./persistent-work.js";
import { assertReportSources } from "./analysis-reports.js";
import { checkInputDependencies } from "./task-dependencies.js";

/** Caller holds the task row lock and has authorized the human/admin action.
 * Only the initial, unclaimed checkpoint is resumable here. Never requeue a
 * previously accepted model turn or uncertain external operation.
 */
export async function controlUnclaimedTask(
  tx: Tx,
  db: Database,
  catalog: Catalog,
  task: any,
  action: "pause" | "resume",
) {
  const expected = action === "pause" ? "queued" : "paused";
  if (
    task.status !== expected ||
    task.attempt !== 0 ||
    task.runtime_thread ||
    task.cancel_requested ||
    task.content_state !== "active"
  )
    throw new Problem(
      409,
      action === "pause" ? "CANNOT_PAUSE" : "CANNOT_RESUME",
      "Only an unclaimed task at its initial execution checkpoint can be paused or resumed",
    );
  const reservation = (
    await tx.query("SELECT * FROM reservations WHERE task_id=$1 FOR UPDATE", [
      task.id,
    ])
  ).rows[0];
  if (
    reservation?.status !== "reserved" ||
    reservation.amount_micros !== task.budget_micros ||
    (
      await tx.query("SELECT 1 FROM tool_operations WHERE task_id=$1 LIMIT 1", [
        task.id,
      ])
    ).rowCount
  )
    throw new Problem(
      409,
      "CHECKPOINT_UNAVAILABLE",
      "The original reservation or initial execution checkpoint is unavailable",
    );
  if (action === "pause") {
    await tx.query(
      "UPDATE tasks SET status='paused',capacity_wait_reason=NULL,version=version+1,updated_at=now() WHERE id=$1",
      [task.id],
    );
    await event(tx, task.tenant_id, task.id, "task.paused", {
      previous: "queued",
      status: "paused",
      checkpoint: "before_first_model_turn",
    });
  } else {
    // An administrator's permission to resume does not confer the beneficiary's
    // revoked permission. Execute under the original user's frozen auth version.
    const user = (
      await tx.query("SELECT * FROM users WHERE id=$1", [task.created_by])
    ).rows[0];
    const actor: Principal = {
      id: task.created_by,
      email: user.email,
      name: user.name,
      authVersion: task.actor_auth_version,
      audience: "user",
      sessionId: "",
      sessionHash: "",
    };
    await projectAccess(tx, actor, task.tenant_id, task.project_id, "write");
    if ((task.data_mode === "simulated") !== db.config.DEMO_MODE)
      throw new Problem(
        409,
        "DATA_MODE_MISMATCH",
        "Resume in the task's execution environment",
      );
    const role = catalog.role(task.role_key);
    await catalog.ensureEnabled(tx, task.role_key);
    await assertTaskSkills(tx, catalog, task);
    if (catalog.digest(role) !== task.role_hash)
      throw new Problem(
        409,
        "ROLE_VERSION_CHANGED",
        "The task's role version is no longer available",
      );
    const availability = catalog.available(db.config, role, task.mode);
    if (!availability.available)
      throw new Problem(
        503,
        availability.reason!,
        "The task's execution capability is unavailable",
      );
    await assertReportSources(tx, task);
    await authorizeExecutionPlan(
      tx,
      task.tenant_id,
      task.created_by,
      role,
      task.mode,
    );
    await resolveWorkContext(
      tx,
      actor,
      task.tenant_id,
      task.project_id,
      task.input_context,
      db.config.CODEX_VERSION,
      [...catalog.capabilityVersions.values()].map((v) => v.id),
    );
    if (await checkInputDependencies(tx, task)) {
      await tx.query(
        "UPDATE tasks SET status='queued',version=version+1,updated_at=now(),capacity_retry_at=now(),next_claim_retry_at=now()+interval '1 minute' WHERE id=$1",
        [task.id],
      );
      await tx.query(
        `INSERT INTO outbox(tenant_id,topic,payload)
         SELECT $1,'task.run',jsonb_build_object('task_id',$2::text)
         WHERE NOT EXISTS(SELECT 1 FROM outbox WHERE topic='task.run' AND payload->>'task_id'=$2::text AND dispatched_at IS NULL)`,
        [task.tenant_id, task.id],
      );
      await event(tx, task.tenant_id, task.id, "task.resumed", {
        previous: "paused",
        status: "queued",
        checkpoint: "before_first_model_turn",
      });
    }
  }
  return (await tx.query("SELECT * FROM tasks WHERE id=$1", [task.id])).rows[0];
}
