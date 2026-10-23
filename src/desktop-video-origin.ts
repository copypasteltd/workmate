import type { Tx } from "./db.js";
import { Problem } from "./lib.js";
import { validFederation } from "./federation-session.js";
import { lockNativeWorkflowParent } from "./desktop-workflows.js";

/** Call after user-authority locks and before project/render locks. The shared
 * task lock serializes publication with cancellation without reversing the
 * Desktop task -> execution -> project -> render order. Cloud jobs have no
 * native origin and retain their existing lifecycle. */
export async function assertDesktopVideoOrigin(tx: Tx, render: any) {
  if (!render.origin_task_id) return;
  const unavailable = () => new Problem(409, "DESKTOP_VIDEO_ORIGIN_UNAVAILABLE", "The owning desktop execution is no longer authorized");
  const hint = (await tx.query("SELECT * FROM tasks WHERE id=$1", [render.origin_task_id])).rows[0];
  if (hint) await lockNativeWorkflowParent(tx, hint, true);
  const task = (await tx.query("SELECT * FROM tasks WHERE id=$1 FOR SHARE", [render.origin_task_id])).rows[0];
  const execution = (await tx.query("SELECT * FROM desktop_executions WHERE task_id=$1 FOR SHARE", [render.origin_task_id])).rows[0];
  if (!task || !execution || task.tenant_id !== render.tenant_id || task.project_id !== render.project_id
    || task.created_by !== render.actor_id || task.actor_auth_version !== render.actor_auth_version
    || task.execution_location !== "desktop" || task.role_key !== "video-motion" || task.cancel_requested
    || task.content_state !== "active" || !["running", "succeeded"].includes(task.status)) throw unavailable();
  if (task.status === "running" ? execution.state !== "running" || new Date(task.lease_until).getTime() <= Date.now()
    || new Date(execution.credential_expires_at).getTime() <= Date.now() : execution.state !== "finished") throw unavailable();
  // A normally completed native turn may hand off a clearly queued, zero-AI
  // composition. It still needs the original, current native login family.
  const session = (await tx.query(
    `SELECT s.* FROM sessions s JOIN refresh_tokens f ON f.session_id=s.id WHERE f.family_id=$1 AND f.client_id='desktop'
     AND f.user_id=$2 AND f.revoked_at IS NULL AND f.expires_at>now() AND s.revoked_at IS NULL AND s.expires_at>now()
     AND s.auth_version=$3 ORDER BY s.created_at DESC LIMIT 1`,
    [execution.native_family_id, task.created_by, task.actor_auth_version],
  )).rows[0];
  if (!session || !(await validFederation(tx, session))) throw unavailable();
}
