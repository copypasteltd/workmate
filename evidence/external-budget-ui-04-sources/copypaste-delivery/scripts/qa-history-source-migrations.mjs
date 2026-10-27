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
  prefix = `evidence/history-source-migrations-${id}`,
  baseline = "0e0cc8c1ba923b151e1e79ac8bd1db44acfa7d93";
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
for (const [version,attempt] of [[82,"04"],[83,"05"],[84,"07"],[85,"09"],[86,"11"],[87,"12"]]) {
 const applied=JSON.parse(await readFile(`evidence/history-source-integration-${attempt}.json`,"utf8"));
 const file=files.find(f=>f.startsWith(String(version).padStart(3,"0")+"-"));
 assert.equal(sha(await readFile(path.join(platform,"migrations",file))),applied.source_files["migrations/"+file]);
}
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
    assert.equal(migrations.length, before ? 81 : 87);
    const originalMigrationBytes = {};
    for (const [i, entry] of migrations.entries()) {
      assert.equal(entry.version, i + 1);
      const file = files.find((f) =>
        f.startsWith(String(entry.version).padStart(3, "0") + "-"),
      );
      assert.ok(file);
      const bytes = await readFile(path.join(platform, "migrations", file));
      if (entry.version <= 81) {
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
    assert.equal(tables.length, before ? 168 : 169);
    const original = {};
    for (const table of tables.filter(t=>t.relname!=="task_source_reads")) {
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
    const policies=(await client.query("SELECT tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows;
    const triggers=(await client.query("SELECT c.relname AS table,t.tgname AS name,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal ORDER BY c.relname,t.tgname")).rows;
    const entry = {
      database: name,
      migrations,
      original,
      tables,
      function_definitions: definitions,
      policies, triggers,
      original_migration_bytes: originalMigrationBytes,
      original_migration_source_commit: baseline,
      complete_pre_upgrade_row_snapshot: true,
      read_only: true,
    };
    if (!before) {
      const old = prior.databases.find((d) => d.database === name);
      assert.deepEqual(original, old.original);
      assert.deepEqual(tables.filter(t=>t.relname!=="task_source_reads"), old.tables);
      const sourceTable=tables.find(t=>t.relname==="task_source_reads");
      assert.ok(sourceTable.relrowsecurity && sourceTable.relforcerowsecurity);
      assert.equal((await client.query("SELECT count(*)::int AS n FROM task_source_reads")).rows[0].n,0);
      assert.deepEqual(migrations.slice(0, 81), old.migrations);
      assert.deepEqual(originalMigrationBytes, old.original_migration_bytes);
      const added=Object.keys(definitions).filter(k=>!(k in old.function_definitions));
      assert.deepEqual(added,["content_source_manifest(uuid,uuid,uuid[],uuid[])","guard_content_source_binding()","guard_publication_input_snapshot()","guard_task_source_read()","lock_task_content_sources(uuid)","publication_input_sources(uuid)","task_asset_sources_available(uuid)","task_asset_version_sources_available(uuid)","task_content_source_manifest(uuid)","task_content_sources_available(uuid)"]);
      const changed=Object.keys(old.function_definitions).filter(k=>definitions[k]!==old.function_definitions[k]);
      assert.deepEqual(changed,[]);
      const functions=(await client.query(`SELECT p.proname,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) AS owner,
       has_function_privilege('cp_app',p.oid,'EXECUTE') AS app_execute,has_function_privilege('cp_queue',p.oid,'EXECUTE') AS queue_execute,
       EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x WHERE x.grantee=0 AND x.privilege_type='EXECUTE') AS public_execute
       FROM pg_proc p WHERE p.oid::regprocedure::text=ANY($1::text[]) ORDER BY p.proname`,[added])).rows;
      assert.equal(functions.length,10);
      for(const f of functions) {
       assert.ok(f.prosecdef && f.owner==='cp_control' && f.proconfig.includes('row_security=on') && !f.queue_execute && !f.public_execute);
       assert.equal(f.app_execute,f.proname.startsWith('task_') || ['lock_task_content_sources','publication_input_sources'].includes(f.proname));
      }
      const sourcePrivileges=(await client.query("SELECT has_table_privilege('cp_app','task_source_reads','SELECT') AS app_read,has_table_privilege('cp_app','task_source_reads','INSERT') AS app_insert,has_table_privilege('cp_app','task_source_reads','UPDATE') AS app_update,has_table_privilege('cp_app','task_source_reads','DELETE') AS app_delete,has_table_privilege('cp_queue','task_source_reads','SELECT') AS queue_read")).rows[0];
      assert.deepEqual(sourcePrivileges,{app_read:true,app_insert:true,app_update:false,app_delete:false,queue_read:false});
      const addedPolicies=policies.filter(x=>!old.policies.some(y=>y.tablename===x.tablename && y.policyname===x.policyname));
      assert.deepEqual(addedPolicies.map(x=>x.tablename+':'+x.policyname),['asset_versions:task_asset_version_source_scope','assets:task_asset_source_scope','task_source_reads:task_source_app','task_source_reads:task_source_control']);
      assert.deepEqual(policies.filter(x=>!addedPolicies.includes(x)),old.policies);
      const addedTriggers=triggers.filter(x=>!old.triggers.some(y=>y.table===x.table && y.name===x.name));
      assert.deepEqual(addedTriggers.map(x=>x.table+':'+x.name),['asset_versions:asset_publication_input_snapshot','asset_versions:asset_publication_source_binding','task_source_reads:task_source_read_guard','tasks:task_plan_source_binding']);
      assert.deepEqual(triggers.filter(x=>!addedTriggers.includes(x)),old.triggers);
      Object.assign(entry,{added_functions:added,new_source_table_rows:0,source_privileges:sourcePrivileges,additional_policies:addedPolicies,additional_triggers:addedTriggers});
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
        original_table_ownership_rls_flags_unchanged: true,
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
    "Native SQL081 to 087; both databases preserve all 168 original public table row digests, table ownership/RLS flags, every original public function and SQL001-081. Only declared empty provenance, policies, guards and source helpers are added; no invented historical reads.",
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
