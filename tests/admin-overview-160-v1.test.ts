import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { historyCall, historyLogin, historyOk, type System, type HistoryClient } from "./admin-history-fixture.js";
import { overviewAdmin, overviewBind, overviewWorkspace, overviewTask, overviewSettle, overviewGet, overviewCloudCharge, overviewPermissions } from "./admin-overview-fixture-160-v1.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: System, demo: System;
before(async () => {
  isolated = await isolatedTestEnvironment();
  const env = { ...isolated.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "false", AI_BASE_URL: "http://127.0.0.1:9/v1", AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "explicit-synthetic-no-requests", AI_MODEL: "synthetic-fixture", AI_VERIFIED: "true", AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000" };
  s = await buildApp(loadConfig({ ...env, DEMO_MODE: "false" }), { worker: false });
  demo = await buildApp(loadConfig({ ...env, DEMO_MODE: "true" }), { worker: false });
});
after(async () => { try { await demo?.app.close(); await s?.app.close(); } finally { await isolated?.cleanup(); } });
const summary = async (system: System, client: HistoryClient) => {
  const r = await overviewGet(system, client); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.summary;
};

test("exact admin identity, overview grant and strict query; missing field grants stay null", async () => {
  assert.equal((await overviewGet(s, null)).status, 401);
  const user = await historyLogin(s);
  assert.equal((await overviewGet(s, user)).status, 401);
  const no = await overviewAdmin(s, ["admin.users.read"]);
  assert.equal((await overviewGet(s, no.client)).status, 403);
  const only = await overviewAdmin(s, ["admin.overview.read"]);
  const data = await summary(s, only.client!);
  for (const name of ["users", "tasks", "charged_micros", "reserved_micros", "reconciling"]) assert.equal(data[name], null, name);
  assert.equal((await historyCall(s, only.client, "GET", "/v1/admin/overview?tenant_id=" + randomUUID())).status, 400);
});

test("a tenant deny constrains global user counts exactly like the current authorized directory", async () => {
  const yes = await overviewWorkspace(s), no = await overviewWorkspace(s), admin = await overviewAdmin(s);
  await overviewBind(s, admin.id, ["admin.users.read", "admin.overview.read"], "tenant", no.tenant, "deny");
  const rows = await historyOk(s, admin.client, "GET", "/v1/admin/users?limit=100");
  assert.equal(rows.next_cursor, null); assert.ok(rows.items.some((r: any) => r.id === yes.owner.id)); assert.ok(!rows.items.some((r: any) => r.id === no.owner.id));
  const data = await summary(s, admin.client!);
  assert.equal(data.users, rows.items.length);
  const actual = await s.db.control.query("SELECT count(*)::int AS n FROM users");
  assert.ok(data.users < actual.rows[0].n, "Denied-only users must not enter the global count");
});

test("project-only grants count assigned users and owners without counting unrelated members", async () => {
  const f = await overviewWorkspace(s), yes = await historyLogin(s), no = await historyLogin(s), admin = await overviewAdmin(s, ["admin.overview.read"]);
  for (const member of [yes, no]) await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'viewer')", [f.tenant, member.id]);
  await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'viewer')", [f.tenant, f.project, yes.id]);
  await overviewBind(s, admin.id, ["admin.users.read"], "project", f.project);
  const rows = await historyOk(s, admin.client, "GET", "/v1/admin/users?limit=100");
  assert.deepEqual(rows.items.map((r: any) => r.id).sort(), [f.owner.id, yes.id].sort());
  assert.equal((await summary(s, admin.client!)).users, 2);
  await overviewBind(s, admin.id, ["admin.users.read"], "project", f.project, "deny");
  assert.equal((await summary(s, admin.client!)).users, 0);
});

test("real personal/enterprise holds and charge-ledger settlements agree with account pages; unknown usage is not charged", async () => {
  const f = await overviewWorkspace(s), admin = await overviewAdmin(s), tenant = await overviewTask(s, f), personal = await overviewTask(s, f, f.personalWallet);
  const before = await summary(s, admin.client!);
  const accounts = await historyOk(s, admin.client, "GET", "/v1/admin/billing/accounts?limit=100");
  assert.equal(accounts.next_cursor, null);
  assert.equal(before.reserved_micros, accounts.items.reduce((n: bigint, a: any) => n + BigInt(a.reserved.amount_micros), 0n).toString());
  assert.ok(BigInt(before.reserved_micros) >= 2_000_000n);
  await overviewSettle(s, f, tenant.id);
  await overviewSettle(s, f, personal.id, 321_000, true);
  const after = await summary(s, admin.client!);
  assert.equal(BigInt(after.charged_micros) - BigInt(before.charged_micros), 875_000n);
  assert.equal(BigInt(before.reserved_micros) - BigInt(after.reserved_micros), 1_000_000n);
  const facts = (await s.db.control.query("SELECT coalesce(sum(-amount_micros),0)::text AS n FROM ledger WHERE kind='charge' AND data_mode='configured_services'")).rows[0];
  assert.equal(after.charged_micros, facts.n);
});

test("project denies exclude entire unreadable balances; global field denies return unavailable instead of zero", async () => {
  const f = await overviewWorkspace(s), admin = await overviewAdmin(s);
  await overviewTask(s, f); await overviewTask(s, f, f.personalWallet);
  await overviewBind(s, admin.id, ["admin.billing.read"], "project", f.project, "deny");
  const accounts = await historyOk(s, admin.client, "GET", "/v1/admin/billing/accounts?limit=100");
  assert.ok(!accounts.items.some((a: any) => [f.tenantWallet, f.personalWallet].includes(a.id)));
  assert.equal((await summary(s, admin.client!)).reserved_micros, accounts.items.reduce((n: bigint, a: any) => n + BigInt(a.reserved.amount_micros), 0n).toString());
  await overviewBind(s, admin.id, ["admin.billing.read", "admin.usage.read"], "global", null, "deny");
  const data = await summary(s, admin.client!);
  assert.equal(data.reserved_micros, null); assert.equal(data.charged_micros, null); assert.equal(data.tasks, null);
});

test("current-mode totals include real cloud-resource charge facts with no task and exclude the other mode", async () => {
  const admin = await overviewAdmin(s), f = await overviewWorkspace(demo);
  const configuredBefore = await summary(s, admin.client!), simulatedBefore = await summary(demo, admin.client!);
  const task = await overviewTask(demo, f); await overviewSettle(demo, f, task.id);
  const session = await overviewCloudCharge(demo, f);
  assert.ok(session);
  const simulatedAfter = await summary(demo, admin.client!), configuredAfter = await summary(s, admin.client!);
  assert.equal(BigInt(simulatedAfter.charged_micros) - BigInt(simulatedBefore.charged_micros), 2_875_000n);
  for (const name of ["tasks", "charged_micros", "reserved_micros", "reconciling"]) assert.equal(configuredAfter[name], configuredBefore[name], name);
  await overviewBind(s, admin.id, ["admin.usage.read"], "project", f.project, "deny");
  assert.equal((await summary(demo, admin.client!)).charged_micros, simulatedBefore.charged_micros);
});

async function delayedRead(change: "session" | "binding") {
  const admin = await overviewAdmin(s), block = await s.db.control.connect();
  let pending: ReturnType<typeof overviewGet> | undefined;
  try {
    await block.query("BEGIN");
    await block.query("SELECT pg_advisory_xact_lock(hashtextextended('admin-super-protection',0))");
    pending = overviewGet(s, admin.client);
    const until = Date.now() + 8000;
    let waiting = false;
    while (Date.now() < until) {
      const row = (await s.db.control.query("SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND NOT l.granted AND a.datname=current_database()) AS waiting")).rows[0];
      if (row.waiting) { waiting = true; break; }
      await new Promise(r => setTimeout(r, 20));
    }
    assert.ok(waiting, "The actual overview transaction must be waiting on the access lock");
    if (change === "session") await block.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE admin_id=$1", [admin.id]);
    else await block.query("UPDATE admin_bindings SET effect='deny' WHERE principal_id=$1", [admin.id]);
    await block.query("COMMIT");
    const result = await pending;
    assert.equal(result.status, 403, JSON.stringify(result.data));
    assert.equal(result.data.summary, undefined);
  } finally { await block.query("ROLLBACK"); block.release(); await pending?.catch(() => undefined); }
}
test("a session revoked during a real access-lock wait cannot return aggregate data", async () => delayedRead("session"));
test("bindings changed during a real access-lock wait are rechecked before aggregate data", async () => delayedRead("binding"));
