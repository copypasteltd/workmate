import { readFile, writeFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { parseEnv } from "node:util";
import { execFileSync } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";
const platform = path.resolve("../copypaste-platform"),
  pg = createRequire(path.join(platform, "package.json"))("pg"),
  env = parseEnv(await readFile(path.join(platform, ".env"), "utf8")),
  base = new URL(env.OWNER_DATABASE_URL),
  before = process.argv.includes("--before"),
  beforePath = "evidence/resource-erasure-migrations-before.json",
  previous = before ? null : JSON.parse(await readFile(beforePath, "utf8")),
  sha = (b) => createHash("sha256").update(b).digest("hex"),
  originalCommit = "134d1b42a3f0009a336076bc77ba62d0cbd7bd29",
  tables = [
    "users",
    "tenants",
    "memberships",
    "projects",
    "assets",
    "asset_versions",
    "upload_sessions",
    "upload_parts",
    "deletion_jobs",
    "wallets",
    "ledger",
    "entitlements",
    "legacy_entitlement_plan_bindings",
    "commercial_plans",
    "commercial_plan_versions",
    "commercial_plan_publications",
    "commercial_plan_migration_issues",
    "entitlement_subjects",
    "vip_grants",
    "vip_grant_events",
    "legacy_vip_replacements",
    "entitlement_outbox",
    "entitlement_notifications",
  ],
  databases = [];
assert.ok(["localhost", "127.0.0.1", "::1"].includes(base.hostname));
assert.equal(base.port, "55432");
if (before)
  await assert.rejects(readFile(beforePath), (e) => e.code === "ENOENT");
for (const database of ["copypaste", "copypaste_test"]) {
  const url = new URL(base);
  url.pathname = "/" + database;
  const c = new pg.Client({ connectionString: url.href });
  await c.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const migrations = (
      await c.query(
        "SELECT version,source_sha256 FROM schema_migrations ORDER BY version",
      )
    ).rows;
    assert.equal(migrations.length, before ? 58 : 59);
    const original_migration_bytes = {};
    for (const [index, m] of migrations.entries()) {
      assert.equal(m.version, index + 1);
      const file = (await readdir(path.join(platform, "migrations"))).find(
        (f) => f.startsWith(String(m.version).padStart(3, "0") + "-"),
      );
      const bytes = await readFile(path.join(platform, "migrations", file));
      if (m.version <= 57) {
        assert.deepEqual(
          bytes,
          execFileSync(
            "git",
            ["show", originalCommit + ":migrations/" + file],
            { cwd: platform, windowsHide: true },
          ),
        );
        original_migration_bytes[file] = sha(bytes);
      }
      if (m.version === 58) {
        assert.deepEqual(
          bytes,
          await readFile("evidence/resource-candidate-03-migration-058.sql"),
        );
        original_migration_bytes[file] = sha(bytes);
      }
      if (m.source_sha256 !== null) assert.equal(m.source_sha256, sha(bytes));
    }
    const original = {};
    for (const table of tables) {
      const r = (
        await c.query(
          `SELECT count(*)::int AS count,coalesce(jsonb_agg(to_jsonb(e) ORDER BY to_jsonb(e)::text),'[]')::text AS value FROM ${table} e`,
        )
      ).rows[0];
      original[table] = { count: r.count, sha256: sha(r.value) };
    }
    const entry = {
      database,
      migrations,
      original,
      original_migration_source_commit: originalCommit,
      original_migration_bytes,
      read_only: true,
      complete_pre_upgrade_row_snapshot: true,
    };
    if (!before) {
      const old = previous.databases.find((d) => d.database === database);
      assert.deepEqual(migrations.slice(0, 58), old.migrations);
      assert.deepEqual(original, old.original);
      const privileges = (
        await c.query(
          "SELECT has_function_privilege('cp_app','tenant_resource_state(uuid)','EXECUTE') AS app_can_read,has_function_privilege('cp_control','tenant_resource_state(uuid)','EXECUTE') AS control_can_read,has_function_privilege('cp_app','assert_tenant_storage_capacity(uuid,bigint,uuid)','EXECUTE') AS app_can_check",
        )
      ).rows[0];
      assert.deepEqual(privileges, {
        app_can_read: false,
        control_can_read: true,
        app_can_check: true,
      });
      const guards = (
        await c.query(
          "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname=ANY($1::text[]) ORDER BY tgname",
          [
            [
              "membership_resource_guard",
              "a_resource_asset_guard",
              "resource_upload_guard",
              "upload_version_resource_commit",
              "upload_session_resource_commit",
              "a_vip_resource_lock",
              "a_legacy_resource_lock",
            ],
          ],
        )
      ).rows;
      assert.equal(guards.length, 7);
      Object.assign(entry, {
        original_facts_unchanged: true,
        applied_checksums_unchanged: true,
        privileges,
        guards,
      });
    }
    await c.query("COMMIT");
    databases.push(entry);
  } finally {
    await c.end();
  }
}
const result = {
  at: new Date().toISOString(),
  status: "passed",
  phase: before ? "before_059" : "after_059_before_API_restart",
  scope:
    "Observed native PostgreSQL 058 to 059 erasure repair only; original rows including actual upload links, nullable historical checksums and migration bytes remain unchanged",
  databases,
  verifier_sha256: sha(await readFile(import.meta.filename)),
};
await writeFile(
  before ? beforePath : "evidence/resource-erasure-migrations.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    phase: result.phase,
    databases: databases.map((d) => ({
      database: d.database,
      migrations: d.migrations.length,
      tables: Object.keys(d.original).length,
    })),
  }),
);
