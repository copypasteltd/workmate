import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";
import { execFileSync } from "node:child_process";
import path from "node:path";

const platform = path.resolve("../copypaste-platform"),
  id = process.argv[2],
  before = process.argv.includes("--before"),
  prefix = `evidence/paid-input-migrations-${id}`;
assert.match(id ?? "", /^\d{2}$/);
assert.equal(process.argv.length, before ? 4 : 3);
const sha = (b) => createHash("sha256").update(b).digest("hex"),
  baseline = "df3ff96d551ed5a54107119562b8fa26a1c9b094";
const pg = createRequire(path.join(platform, "package.json"))("pg"),
  config = parseEnv(await readFile(path.join(platform, ".env"), "utf8"));
const base = new URL(config.OWNER_DATABASE_URL),
  files = await readdir(path.join(platform, "migrations")),
  prior = before
    ? null
    : JSON.parse(await readFile("evidence/paid-input-migrations-01-before.json", "utf8"));
assert.ok(["localhost", "127.0.0.1", "::1"].includes(base.hostname));
assert.equal(base.port, "55432");
const databases = [],
  newTables = ["task_input_checkpoints", "task_tool_receipts"];
for (const name of ["copypaste", "copypaste_test"]) {
  const url = new URL(base);
  url.pathname = "/" + name;
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const migrations = (
      await client.query(
        "SELECT version,source_sha256 FROM schema_migrations ORDER BY version",
      )
    ).rows;
    assert.equal(migrations.length, before ? 87 : 91);
    const originalMigrationBytes = {};
    for (const [index, entry] of migrations.entries()) {
      assert.equal(entry.version, index + 1);
      const file = files.find((f) =>
        f.startsWith(String(entry.version).padStart(3, "0") + "-"),
      );
      assert.ok(file);
      const bytes = await readFile(path.join(platform, "migrations", file));
      if (entry.source_sha256 !== null)
        assert.equal(entry.source_sha256, sha(bytes));
      if (entry.version <= 87) {
        const old = execFileSync(
          "git",
          [
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.untrackedCache=false",
            "show",
            baseline + ":migrations/" + file,
          ],
          { cwd: platform, windowsHide: true },
        );
        assert.deepEqual(bytes, old);
        originalMigrationBytes[file] = sha(bytes);
      }
    }
    const tables = (
      await client.query(
        "SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p') AND c.relname<>'schema_migrations' ORDER BY c.relname",
      )
    ).rows;
    assert.equal(tables.length, before ? 169 : 171);
    const original = {};
    for (const table of tables.filter((t) => !newTables.includes(t.relname))) {
      assert.match(table.relname, /^[a-z][a-z0-9_]*$/);
      const projection =
        table.relname === "tasks"
          ? "to_jsonb(t)-'accrued_micros'"
          : table.relname === "tool_operations"
            ? "to_jsonb(t)-'attempt_fencing'"
            : table.relname === "task_dependencies"
              ? "to_jsonb(t)-'checkpoint_id'"
              : "to_jsonb(t)";
      const row = (
        await client.query(
          `SELECT count(*)::integer AS count,coalesce(jsonb_agg(${projection} ORDER BY (${projection})::text),'[]')::text AS value FROM public.${table.relname} t`,
        )
      ).rows[0];
      original[table.relname] = { count: row.count, sha256: sha(row.value) };
    }
    const definitions = {};
    for (const fn of (
      await client.query(
        "SELECT p.oid::regprocedure::text AS identity,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' ORDER BY p.oid::regprocedure::text",
      )
    ).rows)
      definitions[fn.identity] = sha(fn.definition);
    const policies = (
      await client.query(
        "SELECT tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname",
      )
    ).rows;
    const triggers = (
      await client.query(
        "SELECT c.relname AS table,t.tgname AS name,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal ORDER BY c.relname,t.tgname",
      )
    ).rows;
    const entry = {
      database: name,
      migrations,
      original,
      tables,
      function_definitions: definitions,
      policies,
      triggers,
      original_migration_bytes: originalMigrationBytes,
      original_migration_source_commit: baseline,
      complete_pre_upgrade_row_snapshot: true,
      read_only: true,
    };
    if (!before) {
      const old = prior.databases.find((d) => d.database === name);
      assert.deepEqual(original, old.original);
      assert.deepEqual(migrations.slice(0, 87), old.migrations);
      assert.deepEqual(originalMigrationBytes, old.original_migration_bytes);
      assert.deepEqual(
        tables.filter((t) => !newTables.includes(t.relname)),
        old.tables,
      );
      for (const name of newTables) {
        const t = tables.find((t) => t.relname === name);
        assert.ok(t.relrowsecurity && t.relforcerowsecurity);
        assert.equal(
          (await client.query(`SELECT count(*)::int AS n FROM ${name}`)).rows[0]
            .n,
          0,
        );
      }
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM tasks WHERE accrued_micros<>0",
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM tool_operations WHERE attempt_fencing IS NOT NULL",
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (await client.query("SELECT count(*)::int AS n FROM task_dependencies WHERE checkpoint_id IS NOT NULL")).rows[0].n,
        0,
      );
      const added = Object.keys(definitions).filter(
        (k) => !(k in old.function_definitions),
      );
      assert.deepEqual(added, [
        "close_paid_input_checkpoints()",
        "guard_paid_input_checkpoint()",
        "guard_task_tool_receipt()",
      ]);
      const changed = Object.keys(old.function_definitions).filter(
        (k) => old.function_definitions[k] !== definitions[k],
      );
      assert.deepEqual(changed, [
        "claim_execution_capacity(uuid,text,integer,uuid)",
      ]);
      const functions = (
        await client.query(
          `SELECT p.proname,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) AS owner,
    has_function_privilege('cp_app',p.oid,'EXECUTE') AS app_execute,has_function_privilege('cp_queue',p.oid,'EXECUTE') AS queue_execute,
    EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x WHERE x.grantee=0 AND x.privilege_type='EXECUTE') AS public_execute
    FROM pg_proc p WHERE p.oid::regprocedure::text=ANY($1::text[]) ORDER BY p.proname`,
          [added],
        )
      ).rows;
      assert.equal(functions.length, 3);
      assert.ok(
        functions.every(
          (f) =>
            f.owner === "cp_control" &&
            f.prosecdef &&
            f.proconfig.includes("row_security=on") &&
            !f.app_execute &&
            !f.queue_execute &&
            !f.public_execute,
        ),
      );
      const privileges = {};
      for (const table of newTables) {
        const p = (
          await client.query(
            "SELECT has_table_privilege('cp_app',$1,'SELECT') AS app_read,has_table_privilege('cp_app',$1,'INSERT') AS app_insert,has_table_privilege('cp_app',$1,'UPDATE') AS app_update,has_table_privilege('cp_app',$1,'DELETE') AS app_delete,has_table_privilege('cp_queue',$1,'SELECT') AS queue_read",
            [table],
          )
        ).rows[0];
        assert.deepEqual(p, {
          app_read: true,
          app_insert: true,
          app_update: false,
          app_delete: false,
          queue_read: false,
        });
        privileges[table] = p;
      }
      const costUpdate = (
        await client.query(
          "SELECT has_column_privilege('cp_app','task_input_checkpoints','state','UPDATE') AS state,has_column_privilege('cp_app','task_input_checkpoints','accrued_micros','UPDATE') AS cost,has_column_privilege('cp_app','task_input_checkpoints','runtime_thread','UPDATE') AS thread",
        )
      ).rows[0];
      assert.deepEqual(costUpdate, { state: true, cost: false, thread: false });
      const addedPolicies = policies.filter(
        (x) =>
          !old.policies.some(
            (y) => y.tablename === x.tablename && y.policyname === x.policyname,
          ),
      );
      assert.deepEqual(
        addedPolicies.map((x) => x.tablename + ":" + x.policyname),
        [
          "task_input_checkpoints:input_checkpoint_app",
          "task_input_checkpoints:input_checkpoint_control",
          "task_tool_receipts:task_tool_receipt_app",
          "task_tool_receipts:task_tool_receipt_control",
        ],
      );
      assert.deepEqual(
        policies.filter((x) => !addedPolicies.includes(x)),
        old.policies,
      );
      const addedTriggers = triggers.filter(
        (x) =>
          !old.triggers.some((y) => y.table === x.table && y.name === x.name),
      );
      assert.deepEqual(
        addedTriggers.map((x) => x.table + ":" + x.name),
        [
          "task_input_checkpoints:paid_input_checkpoint_guard",
          "task_tool_receipts:task_tool_receipt_guard",
          "tasks:close_paid_input_checkpoints",
        ],
      );
      assert.deepEqual(
        triggers.filter((x) => !addedTriggers.includes(x)),
        old.triggers,
      );
      const roles = (
        await client.query(
          "SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname IN('cp_app','cp_control','cp_queue') ORDER BY rolname",
        )
      ).rows;
      assert.equal(roles.length, 3);
      assert.ok(roles.every((r) => !r.rolsuper && !r.rolbypassrls));
      Object.assign(entry, {
        added_functions: added,
        changed_functions: changed,
        functions,
        roles,
        new_checkpoint_rows: 0,
        new_receipt_rows: 0,
        original_dependency_checkpoint_ids_null: true,
        privileges,
        cost_update_privileges: costUpdate,
        additional_policies: addedPolicies,
        additional_triggers: addedTriggers,
        original_table_ownership_rls_flags_unchanged: true,
        synthetic_history_added: false,
      });
    }
    databases.push(entry);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
}
const report = {
  at: new Date().toISOString(),
  status: before ? "captured_before_upgrade" : "passed",
  scope:
    "Native SQL087 to 091; preserve all 169 original table row projections, prior migration bytes and definitions except the explicitly extended capacity claim. New columns start at zero/null and both new execution-fact tables start empty; no invented paid history.",
  databases,
  baseline: { path: "evidence/paid-input-migrations-01-before.json", sha256: sha(await readFile("evidence/paid-input-migrations-01-before.json")) },
  original_verifier_sha256: prior.verifier_sha256,
  verifier_sha256: sha(await readFile(import.meta.filename)),
};
await writeFile(
  prefix + (before ? "-before.json" : ".json"),
  JSON.stringify(report, null, 2) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    status: report.status,
    databases: databases.map((d) => ({
      database: d.database,
      migrations: d.migrations.length,
      original_tables: Object.keys(d.original).length,
    })),
  }),
);
