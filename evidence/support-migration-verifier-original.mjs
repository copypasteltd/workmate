import { readFile, writeFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { parseEnv } from "node:util";
import { execFileSync } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";
const platform = path.resolve("../copypaste-platform"), pg = createRequire(path.join(platform, "package.json"))("pg"), env = parseEnv(await readFile(path.join(platform, ".env"), "utf8")), base = new URL(env.OWNER_DATABASE_URL), before = process.argv.includes("--before"), beforePath = "evidence/support-migrations-before.json", previous = before ? null : JSON.parse(await readFile(beforePath, "utf8")), sha = (v) => createHash("sha256").update(v).digest("hex"), originalCommit = "6bb2d3b1805dbe83d5b0e3dde1d4af5fc51cdd13", databases = [];
assert.ok(["localhost", "127.0.0.1", "::1"].includes(base.hostname)); assert.equal(base.port, "55432");
if (before) await assert.rejects(readFile(beforePath), (e) => e.code === "ENOENT");
const files = await readdir(path.join(platform, "migrations"));
for (const database of ["copypaste", "copypaste_test"]) {
  const url = new URL(base); url.pathname = "/" + database; const c = new pg.Client({ connectionString: url.href }); await c.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const migrations = (await c.query("SELECT version,source_sha256 FROM schema_migrations ORDER BY version")).rows;
    assert.equal(migrations.length, before ? 61 : 62);
    const original_migration_bytes = {};
    for (const [i, m] of migrations.entries()) {
      assert.equal(m.version, i + 1); const file = files.find((f) => f.startsWith(String(m.version).padStart(3, "0") + "-")), bytes = await readFile(path.join(platform, "migrations", file));
      if (m.version <= 61) { assert.deepEqual(bytes, execFileSync("git", ["show", originalCommit + ":migrations/" + file], { cwd: platform, windowsHide: true })); original_migration_bytes[file] = sha(bytes); }
      if (m.source_sha256 !== null) assert.equal(m.source_sha256, sha(bytes));
    }
    const tables = (await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('schema_migrations','support_grants','support_session_contexts') ORDER BY tablename")).rows.map((r) => r.tablename), original = {};
    assert.equal(tables.length, 122);
    for (const table of tables) { assert.match(table, /^[a-z][a-z0-9_]*$/); const r = (await c.query(`SELECT count(*)::int AS count,coalesce(jsonb_agg(to_jsonb(e) ORDER BY to_jsonb(e)::text),'[]')::text AS value FROM ${table} e`)).rows[0]; original[table] = { count: r.count, sha256: sha(r.value) }; }
    const entry = { database, migrations, original, original_migration_source_commit: originalCommit, original_migration_bytes, read_only: true, complete_pre_upgrade_row_snapshot: true };
    if (!before) {
      const old = previous.databases.find((d) => d.database === database); assert.deepEqual(migrations.slice(0, 61), old.migrations); assert.deepEqual(original, old.original); assert.deepEqual(original_migration_bytes, old.original_migration_bytes);
      const privileges = (await c.query("SELECT has_table_privilege('cp_app','support_grants','SELECT') AS app_grants_read,has_table_privilege('cp_app','support_session_contexts','SELECT') AS app_contexts_read,has_table_privilege('cp_control','support_grants','INSERT') AS control_insert,has_table_privilege('cp_control','support_session_contexts','UPDATE') AS control_context_update,has_function_privilege('cp_app','support_grant_current(uuid)','EXECUTE') AS app_check,has_function_privilege('cp_control','support_grant_current(uuid)','EXECUTE') AS control_check")).rows[0];
      assert.deepEqual(privileges, { app_grants_read: false, app_contexts_read: false, control_insert: true, control_context_update: false, app_check: false, control_check: true });
      const guards = (await c.query("SELECT tgname,tgrelid::regclass::text AS relation FROM pg_trigger WHERE NOT tgisinternal AND tgname=ANY($1::text[]) ORDER BY tgname", [["support_grant_guard", "support_context_guard", "canonical_support_session_guard"]])).rows; assert.equal(guards.length, 3);
      const rls = (await c.query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[]) ORDER BY relname", [["support_grants", "support_session_contexts"]])).rows; assert.equal(rls.length, 2); assert.ok(rls.every((r) => r.relrowsecurity && r.relforcerowsecurity));
      const new_records = (await c.query("SELECT (SELECT count(*)::int FROM support_grants) AS grants,(SELECT count(*)::int FROM support_session_contexts) AS contexts")).rows[0]; assert.deepEqual(new_records, { grants: 0, contexts: 0 });
      Object.assign(entry, { original_facts_unchanged: true, applied_checksums_unchanged: true, privileges, guards, rls, new_records });
    }
    await c.query("COMMIT"); databases.push(entry);
  } finally { await c.end(); }
}
const result = { at: new Date().toISOString(), status: "passed", phase: before ? "before_062" : "after_062_before_API_restart", scope: "Native PostgreSQL 061 to 062 additive controlled support migration, all 122 original public tables compared before API restart, immutable 001–061 bytes and actual nullable historical checksums preserved; no fabricated grants or scoped legacy sessions", databases, verifier_sha256: sha(await readFile(import.meta.filename)) };
await writeFile(before ? beforePath : "evidence/support-migrations.json", JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ phase: result.phase, databases: databases.map((d) => ({ database: d.database, original_tables: Object.keys(d.original).length })) }));
