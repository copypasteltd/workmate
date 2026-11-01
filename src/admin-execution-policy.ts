import type { Tx } from "./db.js";
import type { Principal } from "./auth.js";
import { requireSensitiveAdmin } from "./admin-access.js";

/** Role identity is read from current server records, never from browser flags
 * or a copied permission list. Business permission, scope and limits still apply. */
export async function isHighestAdmin(tx: Tx, p: Principal) {
  if (p.audience !== "admin") return false;
  return !!(await tx.query("SELECT admin_is_highest($1,$2) AS allowed", [p.id, p.authVersion])).rows[0].allowed;
}
export async function enableSuperAdminDirect(tx: Tx, p: Principal) {
  if (!(await isHighestAdmin(tx, p))) return false;
  await requireSensitiveAdmin(tx, p);
  await tx.query("SELECT set_config('app.admin_direct_context',$1,true)", [JSON.stringify({actor_id:p.id,session_id:p.sessionId,auth_version:p.authVersion})]);
  return true;
}
export async function adminApprovalRequired(tx: Tx, p: Principal, configured: boolean) {
  return (await enableSuperAdminDirect(tx, p)) ? false : configured;
}
export async function superAdminDirectActive(tx: Tx, actor: string) {
  return !!(await tx.query("SELECT admin_direct_context_valid($1) AS allowed", [actor])).rows[0].allowed;
}
