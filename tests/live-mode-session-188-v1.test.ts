import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { historyLogin, historyOk } from "./admin-history-fixture.js";

test("switching service mode exposes usable workspaces without reclassifying historical companies or invalidating login", async () => {
  const fixture = await isolatedTestEnvironment();
  const owner = new pg.Client({ connectionString: fixture.env.OWNER_DATABASE_URL });
  let system: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    await owner.connect();
    const configuration = (demo: boolean) => loadConfig({
      ...fixture.env, NODE_ENV: "test", DEMO_MODE: demo ? "true" : "false", WORKER_ENABLED: "false",
    });
    system = await buildApp(configuration(false), { worker: false });
    const user = await historyLogin(system);
    const companies: { id: string; mode: string; status: string; membership: string }[] = [];
    for (const [mode, status, membership] of [
      ["configured_services", "active", "active"], ["simulated", "active", "active"],
      ["configured_services", "suspended", "active"], ["configured_services", "active", "removed"],
    ]) {
      const row = (await owner.query("INSERT INTO tenants(name,data_mode,status) VALUES($1,$2,$3) RETURNING id", [
        "Explicit mode-switch integration workspace", mode, status,
      ])).rows[0];
      await owner.query("INSERT INTO memberships(tenant_id,user_id,role,status) VALUES($1,$2,'owner',$3)", [row.id, user.id, membership]);
      companies.push({ id: row.id, mode, status, membership });
    }
    const real = await historyOk(system, user, "GET", "/v1/session/context");
    assert.equal(real.user.id, user.id);
    assert.deepEqual(real.memberships.map((m: any) => m.id), [companies[0].id]);
    assert.equal(real.memberships[0].data_mode, "configured_services");
    await system.app.close();
    system = await buildApp(configuration(true), { worker: false });
    const demo = await historyOk(system, user, "GET", "/v1/session/context");
    assert.equal(demo.user.id, user.id);
    assert.deepEqual(demo.memberships.map((m: any) => m.id), [companies[1].id]);
    const retained = (await owner.query("SELECT id,data_mode,status FROM tenants WHERE id=ANY($1::uuid[]) ORDER BY id", [companies.map(c => c.id)])).rows;
    assert.deepEqual(retained, companies.map(c => ({ id: c.id, data_mode: c.mode, status: c.status })).sort((a, b) => a.id.localeCompare(b.id)));
  } finally {
    await system?.app.close();
    await owner.end();
    await fixture.cleanup();
  }
});
