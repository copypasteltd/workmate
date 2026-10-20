import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { parseEnv } from "node:util";
import path from "node:path";
import assert from "node:assert/strict";

const platform = path.resolve("../copypaste-platform"),
  pg = createRequire(path.join(platform, "package.json"))("pg"),
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  env = parseEnv(await readFile(path.join(platform, ".env"), "utf8")),
  source = new URL(env.OWNER_DATABASE_URL),
  beforeMode = process.argv.includes("--before"),
  beforePath = "evidence/vip-migrations-before.json",
  prior = beforeMode
    ? undefined
    : JSON.parse(await readFile(beforePath, "utf8")),
  databases = [],
  file = "057-canonical-vip-grant-lifecycle.sql",
  digest = sha(await readFile(path.join(platform, "migrations", file)));
assert.ok(["localhost", "127.0.0.1", "::1"].includes(source.hostname));
assert.equal(source.port, "55432");
for (const name of ["copypaste", "copypaste_test"]) {
  const url = new URL(source);
  url.pathname = "/" + name;
  const c = new pg.Client({ connectionString: url.href });
  await c.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const migrations = (
        await c.query(
          "SELECT version,source_sha256 FROM schema_migrations ORDER BY version",
        )
      ).rows,
      original = {};
    assert.equal(migrations.length, beforeMode ? 56 : 57);
    for (let n = 0; n < 56; n++) {
      assert.equal(migrations[n].version, n + 1);
      const { readdir } = await import("node:fs/promises"),
        migration = (await readdir(path.join(platform, "migrations"))).find(
          (f) => f.startsWith(String(n + 1).padStart(3, "0") + "-"),
        );
      assert.ok(migration);
      assert.equal(
        migrations[n].source_sha256,
        sha(await readFile(path.join(platform, "migrations", migration))),
      );
    }
    for (const table of [
      "entitlements",
      "legacy_entitlement_plan_bindings",
      "commercial_plans",
      "commercial_plan_versions",
      "commercial_plan_publications",
      "commercial_plan_migration_issues",
      "wallets",
    ]) {
      const raw = (
        await c.query(
          `SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY to_jsonb(e)::text),'[]')::text AS bytes,count(*)::int AS count FROM ${table} e`,
        )
      ).rows[0];
      original[table] = { count: raw.count, sha256: sha(raw.bytes) };
    }
    const entry = { database: name, migrations, original, read_only: true };
    if (!beforeMode) {
      const old = prior.databases.find((d) => d.database === name);
      assert.deepEqual(migrations.slice(0, 56), old.migrations);
      assert.equal(migrations.at(-1).source_sha256, digest);
      assert.deepEqual(original, old.original);
      const tables = (
        await c.query(
          "SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname",
          [
            [
              "entitlement_subjects",
              "vip_grants",
              "vip_grant_events",
              "legacy_vip_replacements",
              "entitlement_outbox",
              "entitlement_notifications",
            ],
          ],
        )
      ).rows;
      assert.equal(tables.length, 6);
      assert.ok(tables.every((t) => t.relrowsecurity && t.relforcerowsecurity));
      const addedRows = {};
      for (const table of tables.map((t) => t.relname)) {
        addedRows[table] = (
          await c.query(`SELECT count(*)::int AS n FROM ${table}`)
        ).rows[0].n;
        assert.equal(
          addedRows[table],
          0,
          "Upgrade must not invent historical canonical facts",
        );
      }
      const view = (
        await c.query(
          "SELECT reloptions FROM pg_class WHERE oid='entitlement_access'::regclass",
        )
      ).rows[0];
      assert.ok(view.reloptions.includes("security_invoker=true"));
      Object.assign(entry, {
        tables,
        new_table_rows_at_upgrade: addedRows,
        security_invoker_view: true,
        original_facts_unchanged: true,
        applied_checksums_unchanged: true,
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
  scope:
    "Read-only native 056→057 checks at upgrade: all original migration digests and exact existing legacy grants, bindings, plan definitions/publications, issues and wallet rows are unchanged; no invented canonical origin",
  databases,
  source_files: { ["copypaste-platform/migrations/" + file]: digest },
  verifier_sha256: sha(await readFile(import.meta.filename)),
};
if (!beforeMode) {
  result.before_sha256 = sha(await readFile(beforePath));
  result.logs = [];
  for (const file of [
    "vip-primary-native-database-start.log",
    "vip-live-migration-057.log",
  ])
    result.logs.push({
      path: "evidence/" + file,
      sha256: sha(await readFile("evidence/" + file)),
    });
}
await writeFile(
  beforeMode ? beforePath : "evidence/vip-migrations.json",
  JSON.stringify(result, null, 2) + "\n",
  beforeMode ? { flag: "wx" } : undefined,
);
console.log(
  JSON.stringify({
    phase: beforeMode ? "before" : "verify",
    databases: databases.length,
    status: "passed",
  }),
);
