import type {Tx} from "./db.js";
import type {Principal} from "./auth.js";
import {projectAccess,tenantAccess} from "./access.js";
import {validFederation} from "./federation-session.js";
import {Problem} from "./lib.js";
type Scope={tenant:string;project:string|null};
/** Keep the exact current session and project authority for a short transaction. */
export async function projectAuthority(
  tx: Tx,
  p: Principal,
  scope: Scope,
  minimum: "read" | "write" | "manage",
) {
  await tx.query("SELECT set_config('app.actor_id',$1,true)", [p.id]);
  const user = (
    await tx.query(
      "SELECT status,auth_version FROM users WHERE id=$1 FOR SHARE",
      [p.id],
    )
  ).rows[0];
  const session = (
    await tx.query(
      "SELECT *,expires_at>now() AS valid FROM sessions WHERE id=$1 AND user_id=$2 FOR SHARE",
      [p.sessionId, p.id],
    )
  ).rows[0];
  if (
    !user ||
    user.status !== "active" ||
    user.auth_version !== p.authVersion ||
    !session ||
    !session.valid ||
    session.revoked_at ||
    session.auth_version !== p.authVersion ||
    session.audience !== p.audience ||
    !(await validFederation(tx, session))
  )
    throw new Problem(401, "SESSION_EXPIRED", "Please sign in again");
  await tx.query("SELECT id FROM tenants WHERE id=$1 FOR SHARE", [
    scope.tenant,
  ]);
  const membership = (
    await tx.query(
      "SELECT version,role,status FROM memberships WHERE tenant_id=$1 AND user_id=$2 FOR SHARE",
      [scope.tenant, p.id],
    )
  ).rows[0];
  if(scope.project===null){
    if(minimum!=="read")throw new Problem(403,"FORBIDDEN","A project is required for changes");
    await tenantAccess(tx,p,scope.tenant);
    return {membership,binding:null,auth_version:p.authVersion};
  }
  await tx.query(
    "SELECT id FROM projects WHERE id=$1 AND tenant_id=$2 FOR SHARE",
    [scope.project, scope.tenant],
  );
  const binding = (
    await tx.query(
      "SELECT * FROM project_members WHERE project_id=$1 AND user_id=$2 FOR SHARE",
      [scope.project, p.id],
    )
  ).rows[0];
  await projectAccess(tx, p, scope.tenant, scope.project, minimum);
  return {
    membership,
    binding: binding ? { role: binding.role } : null,
    auth_version: p.authVersion,
  };
}

