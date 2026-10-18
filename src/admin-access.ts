import type { Tx, Database } from "./db.js";
import type { Principal } from "./auth.js";
import { audit } from "./auth.js";
import type { Catalog } from "./catalog.js";
import { Problem } from "./lib.js";
export interface Scope {
  tenant?: string;
  project?: string;
}
export async function bindings(tx: Tx, p: Principal) {
  return (
    await tx.query(
      "SELECT b.*,r.permissions FROM admin_bindings b JOIN admin_roles r ON r.key=b.role_key JOIN admin_principals p ON p.id=b.principal_id WHERE b.principal_id=$1 AND p.status='active' AND p.auth_version=$2 AND (b.expires_at IS NULL OR b.expires_at>now())",
      [p.id, p.authVersion],
    )
  ).rows;
}
function matches(b: any, s: Scope) {
  return (
    b.scope_kind === "global" ||
    (b.scope_kind === "tenant" && s.tenant === b.scope_id) ||
    (b.scope_kind === "project" && s.project === b.scope_id)
  );
}
export async function permit(
  tx: Tx,
  p: Principal,
  key: string,
  s: Scope = {},
  value?: { amount?: number; hours?: number; batch?: number },
) {
  const bs = (await bindings(tx, p)).filter(
    (b) => b.permissions.includes(key) && matches(b, s),
  );
  if (bs.some((b) => b.effect === "deny"))
    throw new Problem(
      403,
      "ADMIN_FORBIDDEN",
      "Explicit deny prevents this action",
    );
  const allowed = bs.filter(
    (b) =>
      b.effect === "allow" &&
      (!value?.amount ||
        b.limits.max_amount_micros === undefined ||
        value.amount <= b.limits.max_amount_micros) &&
      (!value?.hours ||
        b.limits.max_duration_hours === undefined ||
        value.hours <= b.limits.max_duration_hours) &&
      (!value?.batch ||
        b.limits.max_batch === undefined ||
        value.batch <= b.limits.max_batch),
  );
  if (!allowed.length)
    throw new Problem(
      403,
      "ADMIN_FORBIDDEN",
      "Your admin role or scope does not allow this action",
    );
  return allowed;
}
export async function can(tx: Tx, p: Principal, key: string, s: Scope = {}) {
  try {
    await permit(tx, p, key, s);
    return true;
  } catch {
    return false;
  }
}
/** SQL scope for collection queries. Explicit project denies also constrain aggregates. */
export async function scopePredicate(
  tx: Tx,
  p: Principal,
  key: string,
  tenantColumn: string,
  projectColumn?: string,
  offset = 0,
) {
  const bs = (await bindings(tx, p)).filter((b) => b.permissions.includes(key));
  const globalDeny = bs.some(
    (b) => b.effect === "deny" && b.scope_kind === "global",
  );
  const ids = (effect: string, kind: string) =>
    bs
      .filter((b) => b.effect === effect && b.scope_kind === kind)
      .map((b) => b.scope_id);
  const values = [
    !globalDeny &&
      bs.some((b) => b.effect === "allow" && b.scope_kind === "global"),
    globalDeny ? [] : ids("allow", "tenant"),
    globalDeny ? [] : ids("allow", "project"),
    ids("deny", "tenant"),
    ids("deny", "project"),
  ];
  const n = (i: number) => "$" + (offset + i);
  const sql = `(${n(1)}::boolean OR ${tenantColumn}=ANY(${n(2)}::uuid[])${projectColumn ? ` OR ${projectColumn}=ANY(${n(3)}::uuid[])` : ""}) AND NOT (${tenantColumn}=ANY(${n(4)}::uuid[])${projectColumn ? ` OR ${projectColumn}=ANY(${n(5)}::uuid[])` : ""})`;
  // Reference every placeholder, including arrays unused for tenant-only objects.
  return {
    sql: `(${sql}) AND ${n(3)}::uuid[] IS NOT NULL AND ${n(5)}::uuid[] IS NOT NULL`,
    values,
  };
}
export async function requireRecentMfa(tx: Tx, p: Principal) {
  const result = (
    await tx.query(
      "SELECT 1 FROM sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at>now() AND mfa_at>now()-interval '10 minutes'",
      [p.sessionId],
    )
  ).rowCount;
  if (!result)
    throw new Problem(
      403,
      "MFA_REQUIRED",
      "Please sign in again to confirm a sensitive action",
    );
}
export async function visibleTenants(
  tx: Tx,
  p: Principal,
  key: string,
  includeProjects = false,
) {
  const tenant = await scopePredicate(tx, p, key, "t.id");
  let filter = tenant.sql,
    args = tenant.values;
  if (includeProjects) {
    const project = await scopePredicate(
      tx,
      p,
      key,
      "p.tenant_id",
      "p.id",
      args.length,
    );
    filter += ` OR EXISTS(SELECT 1 FROM projects p WHERE p.tenant_id=t.id AND ${project.sql})`;
    args = [...args, ...project.values];
  }
  return (
    await tx.query(
      `SELECT t.id FROM tenants t WHERE ${filter} ORDER BY t.created_at DESC`,
      args,
    )
  ).rows.map((r) => r.id as string);
}
export async function seedRoles(db: Database, catalog: Catalog) {
  await db.tx(
    async (tx) => {
      for (const r of catalog.admin.roles)
        await tx.query(
          "INSERT INTO admin_roles(key,name,permissions,builtin) VALUES($1,$2,$3,true) ON CONFLICT(key) DO NOTHING",
          [r.id, r.id, JSON.stringify(r.permissions)],
        );
    },
    undefined,
    true,
  );
}
export async function auditDenied(
  db: Database,
  p: Principal,
  action: string,
  target: string | undefined,
  code: string,
) {
  await db.tx(
    (tx) => audit(tx, p, action, target, "denied", { code }),
    undefined,
    true,
  );
}
