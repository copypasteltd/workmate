import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { parseEnv } from "node:util";
import { execFileSync } from "node:child_process";
import path from "node:path";

const platform = path.resolve("../copypaste-platform");
const pg = createRequire(path.join(platform, "package.json"))("pg");
const env = parseEnv(await readFile(path.join(platform, ".env"), "utf8"));
const base = new URL(env.OWNER_DATABASE_URL);
assert.ok(["localhost", "127.0.0.1", "::1"].includes(base.hostname));
assert.equal(base.port, "55432");
const before = process.argv.includes("--before");
const beforePath = "evidence/provider-control-migrations-before.json";
if (before)
  await assert.rejects(readFile(beforePath), (e) => e.code === "ENOENT");
const prior = before ? null : JSON.parse(await readFile(beforePath, "utf8"));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const files = await readdir(path.join(platform, "migrations"));
const added = [
  "ai_gateway_policy_versions",
  "ai_gateway_policy_heads",
  "ai_gateway_requests",
  "ai_gateway_request_events",
];
const databases = [];
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
    assert.equal(migrations.length, before ? 65 : 66);
    const migrationBytes = {};
    for (const [index, record] of migrations.entries()) {
      assert.equal(record.version, index + 1);
      const file = files.find((name) =>
        name.startsWith(String(record.version).padStart(3, "0") + "-"),
      );
      assert.ok(file);
      const bytes = await readFile(path.join(platform, "migrations", file));
      if (record.version <= 65) {
        assert.deepEqual(
          bytes,
          execFileSync(
            "git",
            [
              "-c",
              "core.fsmonitor=false",
              "-c",
              "core.untrackedCache=false",
              "show",
              "c5b3f75:migrations/" + file,
            ],
            { cwd: platform, windowsHide: true },
          ),
        );
        migrationBytes[file] = sha(bytes);
      }
      if (record.source_sha256 !== null)
        assert.equal(record.source_sha256, sha(bytes));
    }
    const names = (
      await client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'schema_migrations' ORDER BY tablename",
      )
    ).rows.map((row) => row.tablename);
    if (before) assert.ok(added.every((name) => !names.includes(name)));
    const original = {};
    for (const name of names.filter((name) => !added.includes(name))) {
      assert.match(name, /^[a-z][a-z0-9_]*$/);
      const row = (
        await client.query(
          `SELECT count(*)::int AS count,coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]')::text AS value FROM public.${name} t`,
        )
      ).rows[0];
      original[name] = { count: row.count, sha256: sha(row.value) };
    }
    assert.ok(Object.keys(original).length >= 132);
    const entry = {
      database,
      migrations,
      original,
      original_migration_source_commit: "c5b3f75",
      original_migration_bytes: migrationBytes,
      read_only: true,
      complete_pre_upgrade_row_snapshot: true,
    };
    if (!before) {
      const old = prior.databases.find((row) => row.database === database);
      assert.deepEqual(migrations.slice(0, 65), old.migrations);
      assert.deepEqual(original, old.original);
      assert.deepEqual(migrationBytes, old.original_migration_bytes);
      const controls = {};
      for (const name of added) {
        const rls = (
          await client.query(
            "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass",
            [name],
          )
        ).rows[0];
        assert.deepEqual(rls, {
          relrowsecurity: true,
          relforcerowsecurity: true,
        });
        const permissions = (
          await client.query(
            "SELECT has_table_privilege('cp_app',$1,'INSERT') AS app_insert,has_table_privilege('cp_app',$1,'UPDATE') AS app_update,has_table_privilege('cp_app',$1,'DELETE') AS app_delete",
            [name],
          )
        ).rows[0];
        assert.deepEqual(permissions, {
          app_insert: false,
          app_update: false,
          app_delete: false,
        });
        controls[name] = { rls, permissions };
      }
      const requests = (
        await client.query("SELECT count(*)::int AS n FROM ai_gateway_requests")
      ).rows[0].n;
      const events = (
        await client.query(
          "SELECT count(*)::int AS n FROM ai_gateway_request_events",
        )
      ).rows[0].n;
      assert.equal(requests, 0, "Never fabricate historical provider requests");
      assert.equal(events, 0);
      const policies = (
        await client.query(
          "SELECT data_mode,version,global_slots,tenant_slots,actor_slots,text_slots,image_slots,verification_slots FROM ai_gateway_policy_versions ORDER BY data_mode",
        )
      ).rows;
      assert.deepEqual(
        policies,
        ["configured_services", "simulated"].map((mode) => ({
          data_mode: mode,
          version: 1,
          global_slots: 16,
          tenant_slots: 4,
          actor_slots: 2,
          text_slots: 12,
          image_slots: 4,
          verification_slots: 2,
        })),
      );
      const heads = (
        await client.query(
          "SELECT h.data_mode,p.version FROM ai_gateway_policy_heads h JOIN ai_gateway_policy_versions p ON p.id=h.policy_version_id AND p.data_mode=h.data_mode ORDER BY h.data_mode",
        )
      ).rows;
      assert.deepEqual(
        heads,
        ["configured_services", "simulated"].map((mode) => ({
          data_mode: mode,
          version: 1,
        })),
      );
      const functions = (
        await client.query(`SELECT proname,prosecdef,pg_get_userbyid(proowner) AS owner,
        NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(proacl,acldefault('f',proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS no_public_execute
        FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('admit_ai_gateway_request','dispatch_ai_gateway_request') ORDER BY proname`)
      ).rows;
      assert.equal(functions.length, 2);
      assert.ok(
        functions.every(
          (row) =>
            row.prosecdef &&
            row.owner === "cp_control" &&
            row.no_public_execute,
        ),
      );
      Object.assign(entry, {
        original_rows_unchanged: true,
        original_migration_bytes_unchanged: true,
        historical_checksums_unchanged: true,
        historical_requests_fabricated: false,
        controls,
        bootstrap_policies: policies,
        bootstrap_heads: heads,
        request_rows: requests,
        event_rows: events,
        functions,
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
    "Native 065-to-066 additive upgrade; preserve every original public-table row, SQL001-065 byte and historical checksum; no fabricated provider calls or customer usage",
  verifier_sha256: sha(await readFile(import.meta.filename)),
  databases,
};
await writeFile(
  before ? beforePath : "evidence/provider-control-migrations.json",
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
