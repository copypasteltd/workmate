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
const beforePath = "evidence/provider-admin-migrations-before.json";
if (before)
  await assert.rejects(readFile(beforePath), (e) => e.code === "ENOENT");
const prior = before ? null : JSON.parse(await readFile(beforePath, "utf8"));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const files = await readdir(path.join(platform, "migrations"));
const added = [
  "ai_provider_policy_drafts", "ai_provider_admin_publications", "ai_provider_admin_heads",
  "ai_provider_evidence", "ai_provider_cost_confirmations", "ai_provider_termination_confirmations", "ai_provider_task_settlements",
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
    assert.equal(migrations.length, before ? 67 : 68);
    const migrationBytes = {};
    for (const [i, r] of migrations.entries()) {
      assert.equal(r.version, i + 1);
      const file = files.find((n) =>
        n.startsWith(String(r.version).padStart(3, "0") + "-"),
      );
      assert.ok(file);
      const bytes = await readFile(path.join(platform, "migrations", file));
      if (r.version <= 67) {
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
              "b32441b:migrations/" + file,
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
    assert.ok(Object.keys(original).length === 144);
    const entry = {
      database,
      migrations,
      original,
      original_migration_source_commit: "b32441b",
      original_migration_bytes: migrationBytes,
      read_only: true,
      complete_pre_upgrade_row_snapshot: true,
    };
    if (!before) {
      const old = prior.databases.find((r) => r.database === database);
      assert.deepEqual(original, old.original);
      assert.deepEqual(migrations.slice(0, 67), old.migrations);
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
            "SELECT has_table_privilege('cp_app',$1,'SELECT') AS app_select,has_table_privilege('cp_app',$1,'INSERT') AS app_insert,has_table_privilege('cp_app',$1,'UPDATE') AS app_update,has_table_privilege('cp_app',$1,'DELETE') AS app_delete,has_table_privilege('cp_queue',$1,'SELECT') AS queue_select,has_table_privilege('cp_queue',$1,'INSERT') AS queue_insert,has_table_privilege('cp_queue',$1,'UPDATE') AS queue_update,has_table_privilege('cp_queue',$1,'DELETE') AS queue_delete",
            [name],
          )
        ).rows[0];
        assert.deepEqual(permissions, {
          app_select: false,
          app_insert: false,
          app_update: false,
          app_delete: false,
          queue_select: false,
          queue_insert: false,
          queue_update: false,
          queue_delete: false,
        });
        controls[name] = { rls, permissions };
      }
      const empty = {};
      for (const name of added) {
        const n = (await c.query(`SELECT count(*)::integer AS n FROM ${name}`))
          .rows[0].n;
        assert.equal(
          n,
          0,
          "Migration must not fabricate provider operations, fees or a verified counting service",
        );
        empty[name] = n;
      }
      const functions = (
        await c.query(`SELECT proname,prosecdef,pg_get_userbyid(proowner) AS owner,
        NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(proacl,acldefault('f',proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS no_public_execute
        FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('ai_budget_used','ai_budget_subject_blocked','task_ai_budget_receipt','ai_gateway_limit_reason') ORDER BY proname`)
      ).rows;
      assert.equal(functions.length, 4);
      assert.ok(
        functions.every(
          (r) => r.prosecdef && r.owner === "cp_control" && r.no_public_execute,
        ),
      );
      const viewPrivileges = (await c.query("SELECT has_table_privilege('cp_app','current_ai_provider_requests','SELECT') AS app_select,has_table_privilege('cp_queue','current_ai_provider_requests','SELECT') AS queue_select")).rows[0];
      assert.deepEqual(viewPrivileges,{app_select:false,queue_select:false});
      Object.assign(entry, {
        controls,
        internal_view_privileges: viewPrivileges,
        empty_new_tables: empty,
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
    "Native additive SQL068; all original rows and SQL001-067 unchanged; no automatic permissions, publication, manual evidence, usage, charge or settlement facts",
  databases,
  verifier_sha256: sha(await readFile(import.meta.filename)),
};
await writeFile(
  before ? beforePath : "evidence/provider-admin-migrations.json",
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
