import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { parseEnv } from "node:util";
import { execFileSync } from "node:child_process";
import path from "node:path";
const platform = path.resolve("../copypaste-platform"),
  pg = createRequire(path.join(platform, "package.json"))("pg");
const env = parseEnv(await readFile(path.join(platform, ".env"), "utf8")),
  base = new URL(env.OWNER_DATABASE_URL);
assert.ok(["localhost", "127.0.0.1", "::1"].includes(base.hostname));
assert.equal(base.port, "55432");
const before = process.argv.includes("--before"),
  beforePath = "evidence/agent-adoption-migrations-before.json";
if (before)
  await assert.rejects(readFile(beforePath), (e) => e.code === "ENOENT");
const prior = before ? null : JSON.parse(await readFile(beforePath, "utf8"));
const sha = (v) => createHash("sha256").update(v).digest("hex"),
  originalCommit = "bed58fb1d2d93f3a765173cf2d72a4d116ed90a6";
const files = await readdir(path.join(platform, "migrations"));
const added = ["agent_adoption_previews"],
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
    assert.equal(migrations.length, before ? 64 : 65);
    const migrationBytes = {};
    for (const [index, m] of migrations.entries()) {
      assert.equal(m.version, index + 1);
      const file = files.find((f) =>
        f.startsWith(String(m.version).padStart(3, "0") + "-"),
      );
      assert.ok(file);
      const raw = await readFile(path.join(platform, "migrations", file));
      if (m.version <= 64) {
        assert.deepEqual(
          raw,
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
        migrationBytes[file] = sha(raw);
      }
      if (m.source_sha256 !== null) assert.equal(m.source_sha256, sha(raw));
    }
    const names = (
      await client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'schema_migrations' ORDER BY tablename",
      )
    ).rows.map((x) => x.tablename);
    if (before) assert.ok(added.every((n) => !names.includes(n)));
    const original = {};
    for (const name of names.filter((n) => !added.includes(n))) {
      assert.match(name, /^[a-z][a-z0-9_]*$/);
      const row = (
        await client.query(
          `SELECT count(*)::int AS count,coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]')::text AS value FROM public.${name} t`,
        )
      ).rows[0];
      original[name] = { count: row.count, sha256: sha(row.value) };
    }
    assert.ok(Object.keys(original).length >= 131);
    const entry = {
      database,
      migrations,
      original,
      original_migration_source_commit: originalCommit,
      original_migration_bytes: migrationBytes,
      read_only: true,
      complete_pre_upgrade_row_snapshot: true,
    };
    if (!before) {
      const old = prior.databases.find((x) => x.database === database);
      assert.deepEqual(migrations.slice(0, 64), old.migrations);
      assert.deepEqual(original, old.original);
      assert.deepEqual(migrationBytes, old.original_migration_bytes);
      const privileges = (
        await client.query(
          "SELECT has_table_privilege('cp_app','agent_adoption_previews','SELECT') AS app_read,has_table_privilege('cp_app','agent_adoption_previews','INSERT') AS app_insert,has_table_privilege('cp_app','agent_adoption_previews','UPDATE') AS app_update,has_table_privilege('cp_app','agent_adoption_previews','DELETE') AS app_delete,has_column_privilege('cp_app','agent_adoption_previews','consumed_at','UPDATE') AS app_consume,has_column_privilege('cp_app','agent_adoption_previews','result','UPDATE') AS app_result,has_column_privilege('cp_app','agent_adoption_previews','proposal_hash','UPDATE') AS app_rewrite_proposal",
        )
      ).rows[0];
      assert.deepEqual(privileges, {
        app_read: true,
        app_insert: true,
        app_update: false,
        app_delete: false,
        app_consume: true,
        app_result: true,
        app_rewrite_proposal: false,
      });
      const rls = (
        await client.query(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='agent_adoption_previews'::regclass",
        )
      ).rows[0];
      assert.deepEqual(rls, {
        relrowsecurity: true,
        relforcerowsecurity: true,
      });
      const count = (
        await client.query(
          "SELECT count(*)::int AS n FROM agent_adoption_previews",
        )
      ).rows[0].n;
      assert.equal(
        count,
        0,
        "Never fabricate historical customer previews or adoption confirmations",
      );
      const functionPrivileges = (
        await client.query(
          "SELECT has_function_privilege('cp_app','lock_adoption_skill_versions(uuid[])','EXECUTE') AS can_lock,has_table_privilege('cp_app','skill_versions','UPDATE') AS can_modify_skill_versions",
        )
      ).rows[0];
      assert.deepEqual(functionPrivileges, {
        can_lock: true,
        can_modify_skill_versions: false,
      });
      const controls = {
          agent_adoption_previews: { privileges, rls, new_rows: count },
        },
        views = { bounded_skill_locks: functionPrivileges };
      Object.assign(entry, {
        original_rows_unchanged: true,
        original_migration_bytes_unchanged: true,
        historical_checksums_unchanged: true,
        historical_adoptions_fabricated: false,
        controls,
        views,
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
    "Native 064 to 065 additive upgrade; preserve every original public-table row and SQL001-064 byte, enforce tenant/actor comparison RLS and column-level consumption, no fabricated historical customer adoption",
  verifier_sha256: sha(await readFile(import.meta.filename)),
  databases,
};
await writeFile(
  before ? beforePath : "evidence/agent-adoption-migrations.json",
  JSON.stringify(report, null, 2) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    status: report.status,
    databases: databases.map((x) => ({
      database: x.database,
      preserved_tables: Object.keys(x.original).length,
      migration_count: x.migrations.length,
    })),
  }),
);
