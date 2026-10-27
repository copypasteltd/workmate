import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";
import { execFileSync } from "node:child_process";
import path from "node:path";

const platform = path.resolve("../copypaste-platform"),
  before = process.argv.includes("--before"),
  id = process.argv[2],
  prefix = `evidence/task-source-migrations-${id}`,
  baseline = "b270ad7f0f11d8c91012a20edb78eb542f2774fa";
assert.match(id ?? "", /^\d{2}$/);
assert.equal(process.argv.length, before ? 4 : 3);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  pg = createRequire(path.join(platform, "package.json"))("pg"),
  config = parseEnv(await readFile(path.join(platform, ".env"), "utf8")),
  base = new URL(config.OWNER_DATABASE_URL),
  prior = before
    ? null
    : JSON.parse(await readFile(prefix + "-before.json", "utf8")),
  files = await readdir(path.join(platform, "migrations")),
  databases = [];
assert.ok(["localhost", "127.0.0.1", "::1"].includes(base.hostname));
assert.equal(base.port, "55432");
const applied81 = JSON.parse(
  await readFile("evidence/task-source-integration-02.json", "utf8"),
);
const sql81 = files.find((f) => f.startsWith("081-"));
assert.ok(sql81);
assert.equal(
  sha(await readFile(path.join(platform, "migrations", sql81))),
  applied81.source_files["migrations/" + sql81],
);
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
    assert.equal(migrations.length, before ? 80 : 81);
    const originalMigrationBytes = {};
    for (const [i, entry] of migrations.entries()) {
      assert.equal(entry.version, i + 1);
      const file = files.find((f) =>
        f.startsWith(String(entry.version).padStart(3, "0") + "-"),
      );
      assert.ok(file);
      const bytes = await readFile(path.join(platform, "migrations", file));
      if (entry.version <= 80) {
        const original = execFileSync(
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
        assert.deepEqual(bytes, original);
        originalMigrationBytes[file] = sha(bytes);
      }
      if (entry.source_sha256 !== null)
        assert.equal(entry.source_sha256, sha(bytes));
    }
    const tables = (
      await client.query(
        "SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p') AND c.relname<>'schema_migrations' ORDER BY c.relname",
      )
    ).rows;
    assert.equal(tables.length, 168);
    const original = {};
    for (const table of tables) {
      assert.match(table.relname, /^[a-z][a-z0-9_]*$/);
      const row = (
        await client.query(
          `SELECT count(*)::integer AS count,coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]')::text AS value FROM public.${table.relname} t`,
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
    const entry = {
      database: name,
      migrations,
      original,
      tables,
      function_definitions: definitions,
      original_migration_bytes: originalMigrationBytes,
      original_migration_source_commit: baseline,
      complete_pre_upgrade_row_snapshot: true,
      read_only: true,
    };
    if (!before) {
      const old = prior.databases.find((d) => d.database === name);
      assert.deepEqual(original, old.original);
      assert.deepEqual(tables, old.tables);
      assert.deepEqual(migrations.slice(0, 80), old.migrations);
      assert.deepEqual(originalMigrationBytes, old.original_migration_bytes);
      assert.deepEqual(
        Object.keys(definitions),
        Object.keys(old.function_definitions),
      );
      const changed = Object.keys(definitions).filter(
        (identity) =>
          definitions[identity] !== old.function_definitions[identity],
      );
      assert.deepEqual(changed, [
        "analysis_report_available(uuid)",
        "analysis_report_owned(uuid)",
      ]);
      const functions = (
        await client.query(`SELECT p.proname,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) AS owner,
        has_function_privilege('cp_app',p.oid,'EXECUTE') AS app_execute,
        has_function_privilege('cp_queue',p.oid,'EXECUTE') AS queue_execute,
        EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
        FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN('analysis_report_available','analysis_report_owned') ORDER BY p.proname`)
      ).rows;
      assert.equal(functions.length, 2);
      assert.ok(
        functions.every(
          (f) =>
            f.prosecdef &&
            f.owner === "cp_control" &&
            f.proconfig.includes("row_security=on") &&
            f.app_execute &&
            !f.queue_execute &&
            !f.public_execute,
        ),
      );
      const roles = (
        await client.query(
          "SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname IN('cp_app','cp_control','cp_queue') ORDER BY rolname",
        )
      ).rows;
      assert.equal(roles.length, 3);
      assert.ok(roles.every((r) => !r.rolsuper && !r.rolbypassrls));
      Object.assign(entry, {
        functions,
        roles,
        changed_functions: changed,
        synthetic_history_added: false,
        unchanged_table_definitions_and_rls: true,
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
    "Native SQL080 to 081; both databases preserve all 168 public-table row digests, table ownership/RLS, every other public function and SQL001-080. Only the two declared report-access functions change; no synthetic history or new tables.",
  databases,
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
