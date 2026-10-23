import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";
import { execFileSync } from "node:child_process";
import path from "node:path";

const platform = path.resolve("../copypaste-platform"),
  before = process.argv.includes("--before");
const id = process.argv[2],
  prefix = `evidence/seo-change-migrations-${id}`;
assert.match(id ?? "", /^\d{2}$/);
const sha = (v) => createHash("sha256").update(v).digest("hex");
const pg = createRequire(path.join(platform, "package.json"))("pg");
const config = parseEnv(await readFile(path.join(platform, ".env"), "utf8"));
const base = new URL(config.OWNER_DATABASE_URL);
assert.ok(["localhost", "127.0.0.1", "::1"].includes(base.hostname));
assert.equal(base.port, "55432");
const prior = before
  ? null
  : JSON.parse(await readFile(prefix + "-before.json", "utf8"));
const added = ["seo_change_tasks"],
  databases = [];
const files = await readdir(path.join(platform, "migrations"));
for (const name of ["copypaste", "copypaste_test"]) {
  const url = new URL(base);
  url.pathname = "/" + name;
  const c = new pg.Client({ connectionString: url.href });
  await c.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const migrations = (
      await c.query(
        "SELECT version,source_sha256 FROM schema_migrations ORDER BY version",
      )
    ).rows;
    assert.equal(migrations.length, before ? 79 : 80);
    const originalMigrationBytes = {};
    for (const [i, r] of migrations.entries()) {
      assert.equal(r.version, i + 1);
      const file = files.find((f) =>
        f.startsWith(String(r.version).padStart(3, "0") + "-"),
      );
      assert.ok(file);
      const bytes = await readFile(path.join(platform, "migrations", file));
      if (r.version <= 79) {
        const original = execFileSync(
          "git",
          [
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.untrackedCache=false",
            "show",
            "830ccfb20ed8beb1a5893dc8888ebe53ad6f4ec9:migrations/" + file,
          ],
          { cwd: platform, windowsHide: true },
        );
        assert.deepEqual(bytes, original);
        originalMigrationBytes[file] = sha(bytes);
      }
      if (r.source_sha256 !== null) assert.equal(r.source_sha256, sha(bytes));
    }
    const names = (
      await c.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'schema_migrations' ORDER BY tablename",
      )
    ).rows.map((r) => r.tablename);
    assert.equal(names.length, before ? 167 : 168);
    if (before) assert.ok(added.every((n) => !names.includes(n)));
    const rows = {};
    for (const table of names.filter((n) => !added.includes(n))) {
      assert.match(table, /^[a-z][a-z0-9_]*$/);
      const r = (
        await c.query(
          `SELECT count(*)::integer AS count,coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]')::text AS value FROM public.${table} t`,
        )
      ).rows[0];
      rows[table] = { count: r.count, sha256: sha(r.value) };
    }
    assert.equal(Object.keys(rows).length, 167);
    const entry = {
      database: name,
      migrations,
      original: rows,
      original_migration_bytes: originalMigrationBytes,
      original_migration_source_commit:
        "830ccfb20ed8beb1a5893dc8888ebe53ad6f4ec9",
      complete_pre_upgrade_row_snapshot: true,
      read_only: true,
    };
    if (!before) {
      const old = prior.databases.find((d) => d.database === name);
      assert.deepEqual(rows, old.original);
      assert.deepEqual(migrations.slice(0, 79), old.migrations);
      assert.deepEqual(originalMigrationBytes, old.original_migration_bytes);
      const controls = {};
      for (const table of added) {
        const rls = (
          await c.query(
            "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass",
            [table],
          )
        ).rows[0];
        assert.deepEqual(rls, {
          relrowsecurity: true,
          relforcerowsecurity: true,
        });
        const privileges = (
          await c.query(
            "SELECT has_table_privilege('cp_app',$1,'SELECT') AS app_select,has_table_privilege('cp_app',$1,'INSERT') AS app_insert,has_table_privilege('cp_app',$1,'UPDATE') AS app_update,has_table_privilege('cp_app',$1,'DELETE') AS app_delete,has_table_privilege('cp_queue',$1,'SELECT') AS queue_select,has_table_privilege('cp_queue',$1,'INSERT') AS queue_insert,has_table_privilege('cp_queue',$1,'UPDATE') AS queue_update,has_table_privilege('cp_queue',$1,'DELETE') AS queue_delete",
            [table],
          )
        ).rows[0];
        assert.deepEqual(privileges, {
          app_select: true,
          app_insert: true,
          app_update: true,
          app_delete: false,
          queue_select: false,
          queue_insert: false,
          queue_update: false,
          queue_delete: false,
        });
        const count = (
          await c.query(`SELECT count(*)::integer AS n FROM ${table}`)
        ).rows[0].n;
        assert.equal(
          count,
          0,
          "Never invent persistent customer website history",
        );
        controls[table] = { rls, privileges, count };
      }
      const functions = (
        await c.query(
          "SELECT proname,prosecdef,proconfig,pg_get_userbyid(proowner) AS owner,NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(proacl,acldefault('f',proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS no_public_execute FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('seo_change_available','guard_seo_change_binding','seo_asset_available','erase_seo_changes') ORDER BY proname",
        )
      ).rows;
      assert.equal(functions.length, 4);
      assert.ok(
        functions.every(
          (f) =>
            f.prosecdef &&
            f.owner === "cp_control" &&
            f.no_public_execute &&
            f.proconfig.includes("row_security=on"),
        ),
      );
      const roles = (
        await c.query(
          "SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname IN ('cp_app','cp_control','cp_queue') ORDER BY rolname",
        )
      ).rows;
      assert.equal(roles.length, 3);
      assert.ok(roles.every((r) => !r.rolsuper && !r.rolbypassrls));
      Object.assign(entry, {
        controls,
        functions,
        roles,
        synthetic_history_added: false,
      });
    }
    databases.push(entry);
    await c.query("COMMIT");
  } finally {
    await c.end();
  }
}
const report = {
  at: new Date().toISOString(),
  status: before ? "captured_before_upgrade" : "passed",
  scope:
    "Native persistent SQL079 to 080; both databases, all 167 previous public tables and SQL001-079 preserved; one new empty FORCE RLS table; no synthetic business history",
  databases,
  verifier_sha256: sha(await readFile(import.meta.filename)),
};
await writeFile(
  prefix + (before ? "-before.json" : ".json"),
  JSON.stringify(report, null, 2) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    status: report.status,
    databases: databases.map((d) => ({
      database: d.database,
      migrations: d.migrations.length,
      original_tables: Object.keys(d.original).length,
    })),
  }),
);
