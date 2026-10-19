import type { Tx, Database } from "./db.js";
import type { Principal } from "./auth.js";
import { audit } from "./auth.js";
import type { Catalog } from "./catalog.js";
import { Problem, uuid } from "./lib.js";
import { z } from "zod";
export interface Scope {
  tenant?: string;
  project?: string;
}
export const adminBindingInput = z
  .object({
    role_key: z.string().min(1).max(80),
    scope_kind: z.enum(["global", "tenant", "project"]),
    scope_id: uuid.optional(),
    effect: z.enum(["allow", "deny"]).default("allow"),
    limits: z
      .object({
        max_amount_micros: z.number().int().nonnegative().max(1e12).optional(),
        max_duration_hours: z.number().int().positive().optional(),
        max_batch: z.number().int().min(1).max(100).optional(),
      })
      .strict()
      .default({}),
    expires_at: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export async function lockAdminAccess(tx: Tx) {
  await tx.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('admin-super-protection',0))",
  );
}
export async function keepEffectiveSuper(tx: Tx) {
  const r = await tx.query(
    "SELECT 1 FROM admin_bindings b JOIN admin_principals p ON p.id=b.principal_id WHERE b.role_key='super_admin' AND b.effect='allow' AND b.scope_kind='global' AND b.expires_at IS NULL AND p.status='active' AND p.enrollment_state='enrolled' AND NOT EXISTS(SELECT 1 FROM admin_bindings d JOIN admin_roles r ON r.key=d.role_key WHERE d.principal_id=p.id AND d.effect='deny' AND d.scope_kind='global' AND (d.expires_at IS NULL OR d.expires_at>now()) AND r.permissions ?| ARRAY['admin.access.principals.write','admin.access.bindings.write','admin.access.bindings.revoke','admin.access.roles.write']) LIMIT 1",
  );
  if (!r.rowCount)
    throw new Problem(
      409,
      "LAST_SUPER_ADMIN",
      "Keep at least one active, enrolled permanent global super administrator with recovery permissions",
    );
}
export async function revokeAdminSessions(
  tx: Tx,
  id: string,
  preservePendingInvitation = false,
) {
  const r = await tx.query(
    "UPDATE admin_principals SET auth_version=auth_version+1,version=version+1 WHERE id=$1 RETURNING id,auth_version,enrollment_state",
    [id],
  );
  if (!r.rowCount)
    throw new Problem(404, "NOT_FOUND", "Administrator not found");
  await tx.query(
    "UPDATE sessions SET revoked_at=now() WHERE admin_id=$1 AND revoked_at IS NULL",
    [id],
  );
  // Changing delegated permissions must invalidate a setup already in progress.
  // The invitation can still identify its recipient, who must verify email again.
  if (preservePendingInvitation && r.rows[0].enrollment_state === "pending") {
    await tx.query(
      "UPDATE admin_enrollments SET issued_auth_version=$2,setup_hash=NULL,setup_secret=NULL,setup_expires_at=NULL,setup_attempts=0,email_verified_at=NULL WHERE principal_id=$1 AND purpose IN ('initial','reset') AND consumed_at IS NULL AND revoked_at IS NULL",
      [id, r.rows[0].auth_version],
    );
  }
}
function delegationFits(source: any, target: any) {
  return (
    ["max_amount_micros", "max_duration_hours", "max_batch"].every(
      (k) =>
        source.limits[k] === undefined ||
        (target.limits[k] !== undefined &&
          target.limits[k] <= source.limits[k]),
    ) &&
    (!source.expires_at ||
      (target.expires_at &&
        new Date(target.expires_at).getTime() <=
          new Date(source.expires_at).getTime()))
  );
}
async function assertDelegationScope(
  tx: Tx,
  actor: Principal,
  permission: string,
  target: Scope,
) {
  const denied = (await bindings(tx, actor)).filter(
    (binding) =>
      binding.effect === "deny" && binding.permissions.includes(permission),
  );
  for (const restriction of denied) {
    let overlaps =
      restriction.scope_kind === "global" ||
      (!target.tenant && !target.project);
    if (
      restriction.scope_kind === "tenant" &&
      restriction.scope_id === target.tenant
    )
      overlaps = true;
    if (restriction.scope_kind === "project") {
      if (restriction.scope_id === target.project) overlaps = true;
      else if (target.tenant && !target.project)
        overlaps = !!(
          await tx.query(
            "SELECT 1 FROM projects WHERE id=$1 AND tenant_id=$2",
            [restriction.scope_id, target.tenant],
          )
        ).rowCount;
    }
    if (overlaps)
      throw new Problem(
        403,
        "ADMIN_FORBIDDEN",
        "Delegated or restored access overlaps your own explicit restriction",
      );
  }
}

/** Removing a deny restores access and therefore requires bounded delegation. */
export async function validateAdminDenyRemoval(
  tx: Tx,
  actor: Principal,
  denied: any,
) {
  if (denied.effect !== "deny") return;
  if (denied.principal_id === actor.id)
    throw new Problem(
      403,
      "SELF_BINDING_FORBIDDEN",
      "Another authorized administrator must remove a restriction on your own access",
    );
  await permit(tx, actor, "admin.access.bindings.write");
  const permissions = (
    await tx.query("SELECT permissions FROM admin_roles WHERE key=$1", [
      denied.role_key,
    ])
  ).rows[0].permissions as string[];
  const allowed = (
    await tx.query(
      "SELECT b.*,r.permissions FROM admin_bindings b JOIN admin_roles r ON r.key=b.role_key WHERE b.principal_id=$1 AND b.effect='allow' AND (b.expires_at IS NULL OR b.expires_at>now())",
      [denied.principal_id],
    )
  ).rows;
  const tenants = new Map<string, string | null>();
  async function scope(binding: any): Promise<Scope | null> {
    if (binding.scope_kind === "global") return {};
    if (binding.scope_kind === "tenant") return { tenant: binding.scope_id };
    if (!tenants.has(binding.scope_id))
      tenants.set(
        binding.scope_id,
        (
          await tx.query("SELECT tenant_id FROM projects WHERE id=$1", [
            binding.scope_id,
          ])
        ).rows[0]?.tenant_id ?? null,
      );
    const tenant = tenants.get(binding.scope_id);
    return tenant ? { tenant, project: binding.scope_id } : null;
  }
  const restriction = await scope(denied);
  if (!restriction) return;
  for (const grant of allowed) {
    const affected = permissions.filter((key) =>
      grant.permissions.includes(key),
    );
    if (!affected.length) continue;
    const existing = await scope(grant);
    if (
      !existing ||
      (restriction.tenant &&
        existing.tenant &&
        restriction.tenant !== existing.tenant) ||
      (restriction.project &&
        existing.project &&
        restriction.project !== existing.project)
    )
      continue;
    const intersection = {
      tenant: restriction.tenant ?? existing.tenant,
      project: restriction.project ?? existing.project,
    };
    for (const permission of affected) {
      const sources = await permit(tx, actor, permission, intersection);
      await assertDelegationScope(tx, actor, permission, intersection);
      // Conservative for overlapping denies: every possibly restored grant must
      // fit, so removing redundant denies in sequence cannot bypass these bounds.
      if (!sources.some((source) => delegationFits(source, grant)))
        throw new Problem(
          403,
          "DELEGATION_LIMIT",
          "Restored access must fit the operator's current limits and expiry",
        );
    }
  }
}
export async function validateAdminDelegation(
  tx: Tx,
  p: Principal,
  b: z.infer<typeof adminBindingInput>,
) {
  await permit(tx, p, "admin.access.bindings.write");
  if (
    (b.scope_kind === "global" && b.scope_id) ||
    (b.scope_kind !== "global" && !b.scope_id)
  )
    throw new Problem(
      400,
      "SCOPE_INVALID",
      "Choose the matching scope identifier",
    );
  const role = (
    await tx.query("SELECT * FROM admin_roles WHERE key=$1", [b.role_key])
  ).rows[0];
  if (!role) throw new Problem(404, "NOT_FOUND", "Role not found");
  let scope: Scope = {};
  if (b.scope_kind === "tenant") {
    if (
      !(await tx.query("SELECT 1 FROM tenants WHERE id=$1", [b.scope_id]))
        .rowCount
    )
      throw new Problem(404, "NOT_FOUND", "Scope not found");
    scope = { tenant: b.scope_id };
  } else if (b.scope_kind === "project") {
    const project = (
      await tx.query("SELECT tenant_id FROM projects WHERE id=$1", [b.scope_id])
    ).rows[0];
    if (!project) throw new Problem(404, "NOT_FOUND", "Scope not found");
    scope = { project: b.scope_id, tenant: project.tenant_id };
  }
  if (b.expires_at && Date.parse(b.expires_at) <= Date.now())
    throw new Problem(400, "EXPIRY_INVALID", "Expiry must be in the future");
  for (const permission of role.permissions) {
    const inherited = await permit(tx, p, permission, scope);
    if (b.effect === "allow")
      await assertDelegationScope(tx, p, permission, scope);
    if (
      b.effect === "allow" &&
      !inherited.some((source) => delegationFits(source, b))
    )
      throw new Problem(
        403,
        "DELEGATION_LIMIT",
        "Delegated limits and expiry must fit an existing grant",
      );
  }
}
export async function bindings(tx: Tx, p: Principal) {
  return (
    await tx.query(
      "SELECT b.*,r.permissions FROM admin_bindings b JOIN admin_roles r ON r.key=b.role_key JOIN admin_principals p ON p.id=b.principal_id WHERE b.principal_id=$1 AND p.status='active' AND p.enrollment_state='enrolled' AND p.auth_version=$2 AND (b.expires_at IS NULL OR b.expires_at>now())",
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
  value?: { amount?: number | bigint; hours?: number; batch?: number },
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
      (value?.amount === undefined ||
        b.limits.max_amount_micros === undefined ||
        BigInt(value.amount) <= BigInt(b.limits.max_amount_micros)) &&
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
      "SELECT 1 FROM sessions s JOIN admin_principals p ON p.id=s.admin_id WHERE s.id=$1 AND s.admin_id=$2 AND s.audience='admin' AND s.auth_version=p.auth_version AND p.auth_version=$3 AND p.status='active' AND p.enrollment_state='enrolled' AND s.revoked_at IS NULL AND s.expires_at>now() AND s.mfa_at>now()-interval '10 minutes'",
      [p.sessionId, p.id, p.authVersion],
    )
  ).rowCount;
  if (!result)
    throw new Problem(
      403,
      "MFA_REQUIRED",
      "Please sign in again to confirm a sensitive action",
    );
}
/** Retain the exact live admin session through a sensitive transaction. */
export async function requireSensitiveAdmin(tx: Tx, p: Principal) {
  await tx.query(
    "SELECT s.id FROM sessions s JOIN admin_principals p ON p.id=s.admin_id WHERE s.id=$1 AND p.id=$2 FOR SHARE OF s,p",
    [p.sessionId, p.id],
  );
  await requireRecentMfa(tx, p);
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
