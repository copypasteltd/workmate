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
  beforePath = "evidence/plan-migrations-before.json",
  prior = beforeMode
    ? undefined
    : JSON.parse(await readFile(beforePath, "utf8")),
  databases = [];
assert.ok(["127.0.0.1", "localhost", "::1"].includes(source.hostname));
const file = "056-immutable-commercial-plan-versions.sql",
  digest = sha(await readFile(path.join(platform, "migrations", file)));
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
    for (const [key, table, where] of [
      ["legacy_plan_catalog", "catalog_entries", "WHERE e.kind='plan'"],
      ["legacy_grants", "entitlements", ""],
      ["wallets", "wallets", ""],
    ]) {
      const raw = (
        await c.query(
          `SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]')::text AS bytes,count(*)::int AS count FROM ${table} e ${where}`,
        )
      ).rows[0];
      original[key] = { count: raw.count, sha256: sha(raw.bytes) };
    }
    const entry = { database: name, migrations, original, read_only: true };
    if (beforeMode) assert.equal(migrations.at(-1).version, 55);
    else {
      const old = prior.databases.find((d) => d.database === name);
      assert.equal(migrations.at(-1).version, 56);
      assert.equal(migrations.at(-1).source_sha256, digest);
      assert.deepEqual(migrations.slice(0, 55), old.migrations);
      assert.deepEqual(original, old.original);
      const tables = (
        await c.query(
          "SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname",
          [
            [
              "commercial_plans",
              "commercial_plan_versions",
              "commercial_plan_publications",
              "legacy_entitlement_plan_bindings",
              "commercial_plan_migration_issues",
            ],
          ],
        )
      ).rows;
      assert.equal(tables.length, 5);
      assert.ok(tables.every((t) => t.relrowsecurity && t.relforcerowsecurity));
      const bindings = (
          await c.query(
            "SELECT provenance,count(*)::int AS count FROM legacy_entitlement_plan_bindings GROUP BY provenance ORDER BY provenance",
          )
        ).rows,
        invalid = (
          await c.query(
            "SELECT count(*)::int AS count FROM entitlements e JOIN legacy_entitlement_plan_bindings b ON b.entitlement_id=e.id WHERE b.runtime_body IS DISTINCT FROM CASE WHEN e.plan_body='{}'::jsonb THEN (SELECT runtime_body FROM commercial_plan_versions WHERE id=b.catalog_version_id) ELSE e.plan_body END OR b.provenance<>CASE WHEN e.plan_body='{}'::jsonb THEN 'evaluated_fallback_at_binding' ELSE 'recorded_grant_snapshot' END",
          )
        ).rows[0].count,
        missing = (
          await c.query(
            "SELECT count(*)::int AS count FROM entitlements e LEFT JOIN legacy_entitlement_plan_bindings b ON b.entitlement_id=e.id WHERE b.entitlement_id IS NULL",
          )
        ).rows[0].count;
      assert.equal(invalid, 0);
      assert.equal(missing, 0);
      Object.assign(entry, {
        tables,
        bindings,
        invalid_bindings: invalid,
        missing_bindings: missing,
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
const at = new Date().toISOString(),
  result = {
    at,
    status: "passed",
    scope:
      "Read-only native 055→056 metadata and exact old-row digest comparison at upgrade; no historical original grant fact is invented",
    databases,
    source_files: { ["copypaste-platform/migrations/" + file]: digest },
    verifier_sha256: sha(await readFile(import.meta.filename)),
  };
if (!beforeMode) {
  result.before_sha256 = sha(await readFile(beforePath));
  result.logs = [];
  for (const log of [
    "plan-versions-live-migration-056.log",
    "plan-versions-seed-test.log",
    "plan-versions-controller-start.log",
  ])
    result.logs.push({
      path: "evidence/" + log,
      sha256: sha(await readFile("evidence/" + log)),
    });
}
await writeFile(
  beforeMode ? beforePath : "evidence/plan-migrations.json",
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
