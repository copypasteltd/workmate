import type { Tx } from "./db.js";
import { audit } from "./auth.js";
import { lockAdminAccess, revokeAdminSessions } from "./admin-access.js";
import { canonical, hash, Problem } from "./lib.js";

/** Trusted operator only; never invoked by server startup or a browser route. */
export async function enableProviderAdmin(
  tx: Tx,
  id: string,
  reason: string,
  permissions: string[],
  expected?: string,
) {
  await lockAdminAccess(tx);
  const target = (
    await tx.query(
      "SELECT id,status,enrollment_state,auth_version,version FROM admin_principals WHERE id=$1 FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (
    !target ||
    target.status !== "active" ||
    target.enrollment_state !== "enrolled" ||
    !(
      await tx.query(
        "SELECT 1 FROM admin_bindings WHERE principal_id=$1 AND role_key='super_admin' AND scope_kind='global' AND effect='allow' AND expires_at IS NULL",
        [id],
      )
    ).rowCount
  )
    throw new Problem(
      409,
      "PROVIDER_OPERATOR_TARGET_INVALID",
      "Select an active enrolled permanent global super administrator",
    );
  const bindings = (
    await tx.query(
      "SELECT b.id,b.role_key,b.scope_kind,b.scope_id,b.effect,b.expires_at,r.permissions FROM admin_bindings b JOIN admin_roles r ON r.key=b.role_key WHERE b.principal_id=$1 ORDER BY b.id",
      [id],
    )
  ).rows;
  if (
    bindings.some(
      (b) =>
        b.effect === "deny" &&
        (!b.expires_at || new Date(b.expires_at).getTime() > Date.now()) &&
        b.permissions.some((p: string) => permissions.includes(p)),
    )
  )
    throw new Problem(
      409,
      "PROVIDER_OPERATOR_TARGET_DENIED",
      "Resolve the existing explicit provider restriction before enabling global control",
    );
  const database = (
    await tx.query(
      "SELECT current_database() AS name,oid::text FROM pg_database WHERE datname=current_database()",
    )
  ).rows[0];
  const snapshot = {
    database,
    target,
    bindings,
    permissions: [...permissions].sort(),
    reason,
  };
  const digest = hash(canonical(JSON.parse(JSON.stringify(snapshot))));
  if (expected === undefined)
    return {
      preview_hash: digest,
      target_id: id,
      permissions: snapshot.permissions,
      creates_business_effect: false,
    };
  if (expected !== digest)
    throw new Problem(
      409,
      "PROVIDER_OPERATOR_PREVIEW_CHANGED",
      "Preview the exact current principal and database before applying",
    );
  const role = "provider_control_v1";
  await tx.query(
    "INSERT INTO admin_roles(key,name,permissions,builtin) VALUES($1,'Provider controls (explicit operator enablement)',$2,false) ON CONFLICT(key) DO NOTHING",
    [role, JSON.stringify(snapshot.permissions)],
  );
  const stored = (
    await tx.query("SELECT permissions FROM admin_roles WHERE key=$1", [role])
  ).rows[0];
  if (
    canonical([...stored.permissions].sort()) !==
    canonical(snapshot.permissions)
  )
    throw new Problem(
      409,
      "PROVIDER_OPERATOR_ROLE_CHANGED",
      "The dedicated role has unexpected permissions",
    );
  if (
    !(
      await tx.query(
        "SELECT 1 FROM admin_bindings WHERE principal_id=$1 AND role_key=$2 AND scope_kind='global' AND effect='allow' AND expires_at IS NULL",
        [id, role],
      )
    ).rowCount
  )
    await tx.query(
      "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,effect) VALUES($1,$2,'global','allow')",
      [id, role],
    );
  await revokeAdminSessions(tx, id);
  await audit(tx, undefined, "admin.ai.operator.enable", id, "succeeded", {
    reason,
    preview_hash: digest,
    permissions: snapshot.permissions,
    old_auth_version: target.auth_version,
    requires_new_sign_in: true,
  });
  return {
    target_id: id,
    enabled: true,
    old_sessions_revoked: true,
    preview_hash: digest,
  };
}
