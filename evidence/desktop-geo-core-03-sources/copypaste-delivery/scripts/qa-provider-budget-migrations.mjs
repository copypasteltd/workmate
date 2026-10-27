import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { parseEnv } from "node:util";
import { execFileSync } from "node:child_process";
import path from "node:path";

const platform = path.resolve("../copypaste-platform"),
  before = process.argv.includes("--before");
const pg = createRequire(path.join(platform, "package.json"))("pg");
const env = parseEnv(await readFile(path.join(platform, ".env"), "utf8"));
const base = new URL(env.OWNER_DATABASE_URL);
assert.ok(["localhost", "127.0.0.1", "::1"].includes(base.hostname));
assert.equal(base.port, "55432");
const beforePath = "evidence/provider-budget-migrations-before.json";
if (before)
  await assert.rejects(readFile(beforePath), (e) => e.code === "ENOENT");
const prior = before ? null : JSON.parse(await readFile(beforePath, "utf8"));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const files = await readdir(path.join(platform, "migrations"));
const added = [
  "ai_provider_budget_policies",
  "ai_provider_budget_heads",
  "ai_request_budget_envelopes",
  "ai_platform_budget_periods",
  "ai_input_count_requests",
  "ai_input_count_events",
  "ai_request_budget_allocations",
  "ai_request_budget_violations",
];
const databases = [];
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
    assert.equal(migrations.length, before ? 66 : 67);
    const migrationBytes = {};
    for (const [i, r] of migrations.entries()) {
      assert.equal(r.version, i + 1);
      const file = files.find((n) =>
        n.startsWith(String(r.version).padStart(3, "0") + "-"),
      );
      assert.ok(file);
      const bytes = await readFile(path.join(platform, "migrations", file));
      if (r.version <= 66) {
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
              "0ed17e7:migrations/" + file,
            ],
            { cwd: platform, windowsHide: true },
          ),
        );
        migrationBytes[file] = sha(bytes);
      }
      if (r.source_sha256 !== null) assert.equal(r.source_sha256, sha(bytes));
    }
    const names = (
      await c.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'schema_migrations' ORDER BY tablename",
      )
    ).rows.map((r) => r.tablename);
    if (before) assert.ok(added.every((n) => !names.includes(n)));
    const original = {};
    for (const name of names.filter((n) => !added.includes(n))) {
      assert.match(name, /^[a-z][a-z0-9_]*$/);
      const r = (
        await c.query(
          `SELECT count(*)::integer AS count,coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]')::text AS value FROM public.${name} t`,
        )
      ).rows[0];
      original[name] = { count: r.count, sha256: sha(r.value) };
    }
    assert.ok(Object.keys(original).length >= 136);
    const entry = {
      database,
      migrations,
      original,
      original_migration_source_commit: "0ed17e7",
      original_migration_bytes: migrationBytes,
      read_only: true,
      complete_pre_upgrade_row_snapshot: true,
    };
    if (!before) {
      const old = prior.databases.find((r) => r.database === database);
      assert.deepEqual(original, old.original);
      assert.deepEqual(migrations.slice(0, 66), old.migrations);
      assert.deepEqual(migrationBytes, old.original_migration_bytes);
      const controls = {};
      for (const name of added) {
        const rls = (
          await c.query(
            "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass",
            [name],
          )
        ).rows[0];
        assert.deepEqual(rls, {
          relrowsecurity: true,
          relforcerowsecurity: true,
        });
        const permissions = (
          await c.query(
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
      const empty = {};
      for (const name of added.filter(
        (n) => n !== "ai_request_budget_envelopes",
      )) {
        const n = (await c.query(`SELECT count(*)::integer AS n FROM ${name}`))
          .rows[0].n;
        assert.equal(
          n,
          0,
          "Migration must not fabricate provider operations, fees or a verified counting service",
        );
        empty[name] = n;
      }
      const envelopes = (
        await c.query(`SELECT e.id FROM ai_request_budget_envelopes e LEFT JOIN tasks t ON t.id=e.task_id
        LEFT JOIN reservations r ON r.task_id=t.id WHERE e.subject_kind<>'task' OR e.policy_id IS NOT NULL
        OR t.id IS NULL OR t.status NOT IN ('queued','paused') OR t.attempt<>0 OR r.status<>'reserved'
        OR e.amount_micros<>r.amount_micros OR e.data_mode<>t.data_mode
        OR EXISTS(SELECT 1 FROM ai_gateway_requests g WHERE g.task_id=t.id AND g.dispatched_at IS NOT NULL)
        OR EXISTS(SELECT 1 FROM tool_operations o WHERE o.task_id=t.id AND o.state IN ('accepted','succeeded','reconciling'))`)
      ).rows;
      assert.equal(
        envelopes.length,
        0,
        "Backfilled budget bounds require definitely unexecuted original reservations",
      );
      const count = (
        await c.query(
          "SELECT count(*)::integer AS n FROM ai_request_budget_envelopes",
        )
      ).rows[0].n;
      const functions = (
        await c.query(`SELECT proname,prosecdef,pg_get_userbyid(proowner) AS owner,
        NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(proacl,acldefault('f',proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS no_public_execute
        FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('register_task_ai_budget','register_validation_ai_budget',
        'ai_budget_used','ai_budget_subject_blocked','ai_platform_budget_period','allocate_ai_generation_budget','task_ai_budget_receipt',
        'admit_ai_input_count_request','dispatch_ai_input_count_request','ai_gateway_limit_reason') ORDER BY proname`)
      ).rows;
      assert.equal(functions.length, 10);
      assert.ok(
        functions.every(
          (r) => r.prosecdef && r.owner === "cp_control" && r.no_public_execute,
        ),
      );
      Object.assign(entry, {
        controls,
        empty_new_tables: empty,
        unexecuted_budget_bounds: count,
        functions,
        historical_spend_fabricated: false,
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
    "Native additive SQL067; all original rows and SQL001-066 unchanged; new unexecuted task budget bounds only, no historical provider or pricing facts",
  databases,
  verifier_sha256: sha(await readFile(import.meta.filename)),
};
await writeFile(
  before ? beforePath : "evidence/provider-budget-migrations.json",
  JSON.stringify(report, null, 2) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    status: report.status,
    databases: databases.map((r) => ({
      name: r.database,
      original_tables: Object.keys(r.original).length,
      version: r.migrations.length,
    })),
  }),
);
