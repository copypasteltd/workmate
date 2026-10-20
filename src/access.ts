import type { FastifyRequest } from "fastify";
import type { Tx, Database } from "./db.js";
import type { Principal } from "./auth.js";
import { canonical, hash, Problem } from "./lib.js";

export type MemberRole = "owner" | "admin" | "member" | "approver" | "viewer";
export async function tenantAccess(
  tx: Tx,
  p: Principal,
  tenant: string,
  minimum: "read" | "write" | "manage" | "owner" = "read",
) {
  // Private resources are protected by a second, transaction-local RLS boundary.
  await tx.query("SELECT set_config('app.actor_id',$1,true)", [p.id]);
  const m = (
    await tx.query(
      "SELECT m.*,t.status AS tenant_status,u.status AS user_status,u.auth_version FROM memberships m JOIN tenants t ON t.id=m.tenant_id JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.status='active'",
      [tenant, p.id],
    )
  ).rows[0];
  if (
    !m ||
    m.tenant_status !== "active" ||
    m.user_status !== "active" ||
    m.auth_version !== p.authVersion
  )
    throw new Problem(404, "NOT_FOUND", "Workspace not found");
  const allowed =
    minimum === "owner"
      ? ["owner"]
      : minimum === "manage"
        ? ["owner", "admin"]
        : minimum === "write"
          ? ["owner", "admin", "member"]
          : ["owner", "admin", "member", "approver", "viewer"];
  if (!allowed.includes(m.role))
    throw new Problem(
      403,
      "FORBIDDEN",
      "You do not have permission for this action",
    );
  return m as { role: MemberRole; version: number };
}
export async function projectAccess(
  tx: Tx,
  p: Principal,
  tenant: string,
  project: string,
  action: "read" | "write" | "approve" | "manage" = "read",
) {
  const m = await tenantAccess(tx, p, tenant);
  const pr = (
    await tx.query(
      "SELECT * FROM projects WHERE tenant_id=$1 AND id=$2 AND archived=false",
      [tenant, project],
    )
  ).rows[0];
  if (!pr) throw new Problem(404, "NOT_FOUND", "Project not found");
  if (["owner", "admin"].includes(m.role)) return pr;
  const binding = (
    await tx.query(
      "SELECT role FROM project_members WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",
      [tenant, project, p.id],
    )
  ).rows[0];
  if (!binding) throw new Problem(404, "NOT_FOUND", "Project not found");
  if (
    action === "manage" ||
    (action === "write" &&
      (m.role !== "member" || binding.role !== "editor")) ||
    (action === "approve" && !["approver", "editor"].includes(binding.role))
  )
    throw new Problem(
      403,
      "FORBIDDEN",
      "Your project role does not allow this action",
    );
  return pr;
}
export async function listProjects(tx: Tx, p: Principal, tenant: string) {
  const m = await tenantAccess(tx, p, tenant);
  return (
    await tx.query(
      `SELECT p.* FROM projects p WHERE p.tenant_id=$1 AND NOT p.archived ${["owner", "admin"].includes(m.role) ? "" : "AND EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=$2)"} ORDER BY created_at DESC`,
      ["owner", "admin"].includes(m.role) ? [tenant] : [tenant, p.id],
    )
  ).rows;
}
export function key(req: FastifyRequest) {
  const value = req.headers["idempotency-key"];
  if (typeof value !== "string" || !/^[\w:-]{16,128}$/.test(value))
    throw new Problem(
      400,
      "IDEMPOTENCY_REQUIRED",
      "A unique Idempotency-Key is required",
    );
  return value;
}
export async function replay<T>(
  tx: Tx,
  actor: string,
  action: string,
  key: string,
  input: unknown,
  effect: () => Promise<T>,
): Promise<T> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `${actor}:${action}:${key}`,
  ]);
  const digest = hash(canonical(input));
  const previous = (
    await tx.query(
      "SELECT * FROM request_replays WHERE actor_id=$1 AND action=$2 AND key=$3",
      [actor, action, key],
    )
  ).rows[0];
  if (previous) {
    if (previous.revoked_at)
      throw new Problem(
        410,
        "REQUEST_RESULT_REMOVED",
        "This saved response was removed or expired; the operation will not run again",
      );
    if (previous.input_hash !== digest)
      throw new Problem(
        409,
        "IDEMPOTENCY_CONFLICT",
        "This request key was used with different content",
      );
    return previous.response as T;
  }
  const response = await effect();
  await tx.query(
    "INSERT INTO request_replays(actor_id,action,key,input_hash,response) VALUES($1,$2,$3,$4,$5)",
    [actor, action, key, digest, JSON.stringify(response)],
  );
  return response;
}
export async function eraseReplayContent(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  // Keep the uniqueness tombstone so retries cannot recreate paid work or
  // retrieve an old serialized prompt after its source has been erased.
  await tx.query(
    "UPDATE request_replays SET response='{}',revoked_at=now() WHERE revoked_at IS NULL AND (response::text LIKE ANY($1::text[]) OR action=ANY($2::text[]))",
    [
      ids.map((id) => `%${id}%`),
      ids.flatMap((id) => [`tool:${id}`, `conversation.message:${id}`]),
    ],
  );
}
export const activePlans = async (tx: Tx, tenant: string) =>
  (
    await tx.query(
      "SELECT id,plan,starts_at,ends_at,state,auto_renew FROM entitlement_access WHERE tenant_id=$1 AND state='active' AND starts_at<=now() AND ends_at>now() ORDER BY ends_at DESC",
      [tenant],
    )
  ).rows;
