import { readFile, writeFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { parseEnv } from "node:util";
import { execFileSync } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";

const platform = path.resolve("../copypaste-platform");
const pg = createRequire(path.join(platform, "package.json"))("pg");
const env = parseEnv(await readFile(path.join(platform, ".env"), "utf8"));
const base = new URL(env.OWNER_DATABASE_URL);
assert.ok(["localhost", "127.0.0.1", "::1"].includes(base.hostname));
assert.equal(base.port, "55432");
const before = process.argv.includes("--before"),
  beforePath = "evidence/capability-migrations-before.json";
const previous = before ? null : JSON.parse(await readFile(beforePath, "utf8"));
if (before)
  await assert.rejects(readFile(beforePath), (e) => e.code === "ENOENT");
const originalCommit = "8c47f275c0ea624a4ff7f5393028ce709b9a0882";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const files = await readdir(path.join(platform, "migrations")),
  databases = [];
for (const database of ["copypaste", "copypaste_test"]) {
  const url = new URL(base);
  url.pathname = "/" + database;
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const migrations = (
      await client.query(
        "SELECT version,source_sha256 FROM schema_migrations ORDER BY version",
      )
    ).rows;
    assert.equal(migrations.length, before ? 62 : 63);
    const originalMigrationBytes = {};
    for (const [index, migration] of migrations.entries()) {
      assert.equal(migration.version, index + 1);
      const file = files.find((name) =>
        name.startsWith(String(migration.version).padStart(3, "0") + "-"),
      );
      const bytes = await readFile(path.join(platform, "migrations", file));
      if (migration.version <= 62) {
        assert.deepEqual(
          bytes,
          execFileSync(
            "git",
            [
              "-c",
              "core.fsmonitor=false",
              "show",
              originalCommit + ":migrations/" + file,
            ],
            { cwd: platform, windowsHide: true },
          ),
        );
        originalMigrationBytes[file] = sha(bytes);
      }
      if (migration.source_sha256 !== null)
        assert.equal(migration.source_sha256, sha(bytes));
    }
    const tables = (
      await client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('schema_migrations','task_runtime_bindings') ORDER BY tablename",
      )
    ).rows.map((row) => row.tablename);
    assert.ok(tables.length >= 124);
    const original = {};
    for (const table of tables) {
      assert.match(table, /^[a-z][a-z0-9_]*$/);
      const row = (
        await client.query(
          `SELECT count(*)::int AS count,coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]')::text AS value FROM public.${table} t`,
        )
      ).rows[0];
      original[table] = { count: row.count, sha256: sha(row.value) };
    }
    const entry = {
      database,
      migrations,
      original,
      original_migration_source_commit: originalCommit,
      original_migration_bytes: originalMigrationBytes,
      read_only: true,
      complete_pre_upgrade_row_snapshot: true,
    };
    if (!before) {
      const old = previous.databases.find((row) => row.database === database);
      assert.deepEqual(migrations.slice(0, 62), old.migrations);
      assert.deepEqual(original, old.original);
      assert.deepEqual(originalMigrationBytes, old.original_migration_bytes);
      const privileges = (
        await client.query(
          "SELECT has_table_privilege('cp_app','task_runtime_bindings','SELECT') AS app_read,has_table_privilege('cp_app','task_runtime_bindings','INSERT') AS app_insert,has_table_privilege('cp_app','task_runtime_bindings','UPDATE') AS app_update,has_table_privilege('cp_app','task_runtime_bindings','DELETE') AS app_delete,has_table_privilege('cp_app','internal_capability_versions','UPDATE') AS app_capability_update,has_table_privilege('cp_app','codex_runtime_profiles','UPDATE') AS app_runtime_update,has_function_privilege('cp_app','lock_task_capability_versions(uuid,uuid[])','EXECUTE') AS bounded_lock",
        )
      ).rows[0];
      assert.deepEqual(privileges, {
        app_read: true,
        app_insert: true,
        app_update: false,
        app_delete: false,
        app_capability_update: false,
        app_runtime_update: false,
        bounded_lock: true,
      });
      const lock = (
        await client.query(
          "SELECT prosecdef,proconfig,NOT EXISTS(SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS no_public_execute FROM pg_proc WHERE oid='lock_task_capability_versions(uuid,uuid[])'::regprocedure",
        )
      ).rows[0];
      assert.equal(lock.prosecdef, true);
      assert.equal(lock.no_public_execute, true);
      assert.ok(
        lock.proconfig.some(
          (value) =>
            value.replaceAll(" ", "") === "search_path=pg_catalog,public",
        ),
      );
      const rls = (
        await client.query(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='task_runtime_bindings'::regclass",
        )
      ).rows[0];
      assert.deepEqual(rls, {
        relrowsecurity: true,
        relforcerowsecurity: true,
      });
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid='task_runtime_bindings'::regclass AND NOT tgisinternal AND tgname='immutable_task_runtime_binding'",
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM task_runtime_bindings",
          )
        ).rows[0].n,
        0,
        "Historical task selections are not backfilled",
      );
      Object.assign(entry, {
        original_rows_unchanged: true,
        original_migration_bytes_unchanged: true,
        historical_checksums_unchanged: true,
        privileges,
        lock,
        rls,
        historical_bindings_fabricated: false,
      });
    }
    await client.query("COMMIT");
    databases.push(entry);
  } finally {
    await client.end();
  }
}
const report = {
  at: new Date().toISOString(),
  status: before ? "captured_before_upgrade" : "passed",
  scope:
    "Native 062 to 063 additive upgrade; both original public-table row digests and migration history, bounded lock and immutable private task bindings",
  databases,
};
await writeFile(
  before ? beforePath : "evidence/capability-migrations.json",
  JSON.stringify(report, null, 2) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    status: report.status,
    databases: databases.map((entry) => ({
      database: entry.database,
      preserved_tables: Object.keys(entry.original).length,
      migration_count: entry.migrations.length,
    })),
  }),
);
