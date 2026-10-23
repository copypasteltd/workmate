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
  beforePath = "evidence/financial-migrations-before.json",
  previous = before ? null : JSON.parse(await readFile(beforePath, "utf8")),
  sha = (b) => createHash("sha256").update(b).digest("hex"),
  originalCommit = "1b8d91dc064b53c235212599d407836743aafd92",
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
    assert.equal(migrations.length, before ? 60 : 61);
    const original_migration_bytes = {};
    for (const [index, m] of migrations.entries()) {
      assert.equal(m.version, index + 1);
      const file = (await readdir(path.join(platform, "migrations"))).find(
        (f) => f.startsWith(String(m.version).padStart(3, "0") + "-"),
      );
      const bytes = await readFile(path.join(platform, "migrations", file));
      if (m.version <= 60) {
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
      if (m.source_sha256 !== null) assert.equal(m.source_sha256, sha(bytes));
    }
    const original = {};
    const tables = (
      await c.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('schema_migrations','financial_outbox','financial_notifications') ORDER BY tablename",
      )
    ).rows.map((r) => r.tablename);
    for (const table of tables) {
      assert.match(table, /^[a-z][a-z0-9_]*$/);
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
    assert.equal(
      Object.keys(original).length,
      120,
      "Inventory every original public table, including 060 combinations",
    );
    if (!before) {
      const old = previous.databases.find((d) => d.database === database);
      assert.deepEqual(migrations.slice(0, 60), old.migrations);
      assert.deepEqual(original, old.original);
      const privileges = (
        await c.query(
          "SELECT has_table_privilege('cp_app','financial_outbox','SELECT') AS app_outbox_read,has_table_privilege('cp_app','financial_notifications','SELECT') AS app_notifications_read,has_table_privilege('cp_control','financial_outbox','INSERT') AS control_insert,has_function_privilege('cp_app','financial_recipient_allowed(uuid,uuid)','EXECUTE') AS app_check,has_function_privilege('cp_control','financial_recipient_allowed(uuid,uuid)','EXECUTE') AS control_check",
        )
      ).rows[0];
      assert.deepEqual(privileges, {
        app_outbox_read: false,
        app_notifications_read: false,
        control_insert: true,
        app_check: false,
        control_check: true,
      });
      const guards = (
        await c.query(
          "SELECT tgname,tgrelid::regclass::text AS relation FROM pg_trigger WHERE NOT tgisinternal AND tgname=ANY($1::text[]) ORDER BY tgname,tgrelid::regclass::text",
          [
            [
              "financial_delivery_capture",
              "financial_outbox_guard",
              "financial_notification_guard",
            ],
          ],
        )
      ).rows;
      assert.equal(guards.length, 7);
      const new_records = (
        await c.query(
          "SELECT (SELECT count(*)::int FROM financial_outbox) AS outbox,(SELECT count(*)::int FROM financial_notifications) AS notifications",
        )
      ).rows[0];
      assert.deepEqual(
        new_records,
        { outbox: 0, notifications: 0 },
        "Never manufacture retrospective notifications",
      );
      const rls = (
        await c.query(
          "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[]) ORDER BY relname",
          [["financial_outbox", "financial_notifications"]],
        )
      ).rows;
      assert.equal(rls.length, 2);
      assert.ok(rls.every((r) => r.relrowsecurity && r.relforcerowsecurity));
      Object.assign(entry, {
        original_facts_unchanged: true,
        applied_checksums_unchanged: true,
        privileges,
        guards,
        new_records,
        rls,
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
  phase: before ? "before_061" : "after_061_before_API_restart",
  scope:
    "Observed native PostgreSQL 060 to 061 additive financial delivery upgrade. Every original public table row, actual operation, journal and nullable historical checksum remains unchanged; comparison completed before API restart",
  databases,
  verifier_sha256: sha(await readFile(import.meta.filename)),
};
await writeFile(
  before ? beforePath : "evidence/financial-migrations.json",
  JSON.stringify(result, null, 2) + "\n",
  { flag: "wx" },
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
