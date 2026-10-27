import { loadConfig } from "../src/config.js";
import { Database } from "../src/db.js";
import { Catalog } from "../src/catalog.js";
import { audit } from "../src/auth.js";
import { lockAdminAccess } from "../src/admin-access.js";
import { canonical, email, Problem } from "../src/lib.js";
const address = email.parse(process.argv[2]);
if (
  process.argv[3] !== "--acknowledge-global-recovery-visibility" ||
  process.argv.length !== 4
)
  throw new Error(
    "Usage: npm run admin:enable-recovery -- admin@example.com --acknowledge-global-recovery-visibility",
  );
const db = new Database(loadConfig()),
  catalog = new Catalog();
try {
  await catalog.load();
  const id = await db.tx(
    async (tx) => {
      await lockAdminAccess(tx);
      const p = (
        await tx.query(
          `SELECT p.* FROM admin_principals p WHERE p.email=$1 AND p.status='active' AND p.enrollment_state='enrolled'
   AND EXISTS(SELECT 1 FROM admin_bindings b WHERE b.principal_id=p.id AND b.role_key='super_admin' AND b.effect='allow' AND b.scope_kind='global' AND b.expires_at IS NULL)
   AND NOT EXISTS(SELECT 1 FROM admin_bindings b JOIN admin_roles r ON r.key=b.role_key WHERE b.principal_id=p.id AND b.effect='deny' AND (b.expires_at IS NULL OR b.expires_at>now())
    AND r.permissions ?| ARRAY['admin.access.roles.write','admin.recovery.read']) FOR UPDATE OF p`,
          [address],
        )
      ).rows[0];
      if (!p)
        throw new Problem(
          403,
          "ADMIN_UPGRADE_FORBIDDEN",
          "An enrolled permanent global super administrator without overlapping denies is required",
        );
      const permissions = [
        "admin.recovery.read",
      ];
      const key = "recovery_observer_v1";
      await tx.query(
        "INSERT INTO admin_roles(key,name,permissions,builtin) VALUES($1,'Recovery observer',$2,false) ON CONFLICT(key) DO NOTHING",
        [key, JSON.stringify(permissions)],
      );
      const role = (
        await tx.query("SELECT permissions FROM admin_roles WHERE key=$1", [
          key,
        ])
      ).rows[0];
      if (
        canonical([...role.permissions].sort()) !==
        canonical([...permissions].sort())
      )
        throw new Error(
          "Existing recovery observer role differs; do not overwrite it",
        );
      await tx.query(
        "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,effect) SELECT $1,$2,'global','allow' WHERE NOT EXISTS(SELECT 1 FROM admin_bindings WHERE principal_id=$1 AND role_key=$2 AND scope_kind='global' AND effect='allow' AND expires_at IS NULL)",
        [p.id, key],
      );
      await audit(
        tx,
        { id: p.id, audience: "admin" },
        "admin.recovery.explicit_upgrade",
        p.id,
        "succeeded",
        { permissions, operator_local_command: true },
      );
      return p.id;
    },
    undefined,
    true,
  );
  console.log(
    "Explicit recovery visibility granted to administrator " +
      id +
      ". Sign in again before using the new panel.",
  );
} finally {
  await db.close();
}
