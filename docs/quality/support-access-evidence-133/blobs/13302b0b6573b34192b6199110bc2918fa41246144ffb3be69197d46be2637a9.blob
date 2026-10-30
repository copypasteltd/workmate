import { loadConfig } from "../src/config.js";
import { Database } from "../src/db.js";
import { Catalog } from "../src/catalog.js";
import { audit } from "../src/auth.js";
import { lockAdminAccess, revokeAdminSessions } from "../src/admin-access.js";
import { canonical, email, Problem } from "../src/lib.js";

if (process.argv.length !== 4 || process.argv[3] !== "--acknowledge-global-publication-authority")
  throw new Error("Usage: npm run admin:enable-publications -- admin@example.com --acknowledge-global-publication-authority");
const address = email.parse(process.argv[2]);
const db = new Database(loadConfig()), catalog = new Catalog();
const permissions = ["admin.publication.read", "admin.publication.policy.write", "admin.publication.resolve"];
try {
  await catalog.load();
  const result = await db.tx(async tx => {
    await lockAdminAccess(tx);
    const principal = (await tx.query(`SELECT p.* FROM admin_principals p WHERE p.email=$1 AND p.status='active' AND p.enrollment_state='enrolled'
      AND EXISTS(SELECT 1 FROM admin_bindings b WHERE b.principal_id=p.id AND b.role_key='super_admin'
        AND b.effect='allow' AND b.scope_kind='global' AND b.expires_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM admin_bindings b JOIN admin_roles r ON r.key=b.role_key
        WHERE b.principal_id=p.id AND b.effect='deny' AND (b.expires_at IS NULL OR b.expires_at>now())
        AND r.permissions ?| ARRAY['admin.access.roles.write','admin.publication.read','admin.publication.policy.write','admin.publication.resolve'])
      FOR UPDATE OF p`, [address])).rows[0];
    if (!principal) throw new Problem(403, "ADMIN_UPGRADE_FORBIDDEN", "An enrolled permanent global super administrator without overlapping denies is required");
    const roleKey = "publication_operator_v1";
    await tx.query("INSERT INTO admin_roles(key,name,permissions,builtin) VALUES($1,'Publishing operator',$2,false) ON CONFLICT(key) DO NOTHING", [roleKey, JSON.stringify(permissions)]);
    const role = (await tx.query("SELECT permissions FROM admin_roles WHERE key=$1", [roleKey])).rows[0];
    if (canonical([...role.permissions].sort()) !== canonical([...permissions].sort()))
      throw new Error("Existing publishing role differs; do not overwrite it");
    const inserted = await tx.query(`INSERT INTO admin_bindings(principal_id,role_key,scope_kind,effect)
      SELECT $1,$2,'global','allow' WHERE NOT EXISTS(SELECT 1 FROM admin_bindings WHERE principal_id=$1
        AND role_key=$2 AND scope_kind='global' AND effect='allow' AND expires_at IS NULL) RETURNING id`, [principal.id, roleKey]);
    if (inserted.rowCount) {
      await revokeAdminSessions(tx, principal.id);
      await audit(tx, { id: principal.id, audience: "admin" }, "admin.publication.explicit_upgrade", principal.id,
        "succeeded", { permissions, operator_local_command: true });
    }
    return { id: principal.id, granted: !!inserted.rowCount };
  }, undefined, true);
  console.log(result.granted
    ? "Explicit publishing permissions granted to administrator " + result.id + ". Existing sessions were revoked; sign in again before using the panel."
    : "Administrator " + result.id + " already has the exact explicit publishing grant. No permissions or sessions changed.");
} finally { await db.close(); }
