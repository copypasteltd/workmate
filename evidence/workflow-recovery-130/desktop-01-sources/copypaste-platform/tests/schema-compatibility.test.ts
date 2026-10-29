import test from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { runMigrations } from "../scripts/migration-runner.js";
import { requiredSchemaVersion } from "../src/schema-compatibility.js";
import { assertLiveEnvironment } from "../src/recovery-fence.js";
import { Database } from "../src/db.js";
import { Catalog } from "../src/catalog.js";
import { Storage } from "../src/storage.js";
import { Worker } from "../src/worker.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";

test("the release schema requirement matches every published forward migration", async () => {
  const versions = (await readdir("migrations"))
    .filter(name => /^\d+-.*\.sql$/.test(name))
    .map(name => Number(name.split("-")[0])).sort((a, b) => a - b);
  assert.deepEqual(versions, Array.from({ length: requiredSchemaVersion }, (_, i) => i + 1));
});

test("API and every worker entry reject partial, missing and future schema history before seeding or paid work", async () => {
  const fixture = await isolatedTestEnvironment({ throughVersion: 125 });
  const config = loadConfig({ ...fixture.env, NODE_ENV: "test", DEMO_MODE: "false", WORKER_ENABLED: "false" });
  const db = new Database(config), owner = new pg.Client({ connectionString: fixture.env.OWNER_DATABASE_URL });
  let current: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    await owner.connect();
    const catalog = new Catalog();
    await catalog.load();
    const worker = new Worker(db, catalog, new Storage(config));
    const facts = async () => (await owner.query(`SELECT
      (SELECT count(*)::int FROM admin_roles) AS roles,
      (SELECT count(*)::int FROM codex_runtime_profiles) AS runtimes,
      (SELECT count(*)::int FROM tasks) AS tasks,
      (SELECT count(*)::int FROM ledger) AS ledger`)).rows[0];
    const before = await facts();
    assert.equal((await owner.query("SELECT state FROM recovery_environment")).rows[0].state, "live");
    const blocked = async (error: RegExp) => {
      await assert.rejects(assertLiveEnvironment(db), error);
      await assert.rejects(buildApp(config, { worker: false }), error);
      await assert.rejects(worker.start(), error);
      await assert.rejects(worker.dispatch(), error);
      await assert.rejects(worker.run(randomUUID(), randomUUID()), error);
      assert.deepEqual(await facts(), before);
    };
    await blocked(/SCHEMA_UPGRADE_REQUIRED/);
    await runMigrations(owner, "Complete release schema compatibility upgrade");
    await assertLiveEnvironment(db);
    const historical = (await owner.query("DELETE FROM schema_migrations WHERE version=64 RETURNING *")).rows[0];
    assert.ok(historical);
    await blocked(/SCHEMA_UPGRADE_REQUIRED/);
    await owner.query("INSERT INTO schema_migrations(version,applied_at,source_sha256) VALUES($1,$2,$3)",
      [historical.version, historical.applied_at, historical.source_sha256]);
    await owner.query("UPDATE schema_migrations SET version=$1 WHERE version=$2", [requiredSchemaVersion + 1, requiredSchemaVersion]);
    await blocked(/SCHEMA_VERSION_UNSUPPORTED/);
    await owner.query("UPDATE schema_migrations SET version=$1 WHERE version=$2", [requiredSchemaVersion, requiredSchemaVersion + 1]);
    await assertLiveEnvironment(db);
    current = await buildApp(config, { worker: false });
    await current.app.ready();
    const health = await current.app.inject({ method: "GET", url: "/health/live" });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().version, "0.5.1");
  } finally {
    await current?.app.close();
    await db.close();
    await owner.end();
    await fixture.cleanup();
  }
});
