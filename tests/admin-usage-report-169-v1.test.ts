import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { overviewAdmin, overviewBind } from "./admin-overview-fixture-160-v2.js";
import { historyCall, historyOk, type System, type HistoryClient } from "./admin-history-fixture.js";
import { usageFixture, reportPermissions, refundConsumption } from "./admin-usage-report-fixture-169-v1.js";
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: System, f: Awaited<ReturnType<typeof usageFixture>>, admin: Awaited<ReturnType<typeof overviewAdmin>>;
const root = "/v1/admin/usage-reports";
before(async () => { isolated = await isolatedTestEnvironment(); s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", DEV_MAILBOX: "true", WORKER_ENABLED: "false" }), { worker: false }); f = await usageFixture(s); admin = await overviewAdmin(s, reportPermissions); });
after(async () => { try { await s?.app.close(); } finally { await isolated?.cleanup(); } });
async function snapshot(extra: any = {}, c = admin.client) { const saved = await historyOk(s, c, "POST", root, { ...f.filters, ...extra }); return historyOk(s, c, "GET", root + "/" + saved.id); }
test("exact ledger charge facts, separate personal/company payers, reserved/unknown and initiator attribution", async () => {
  const r = await snapshot({ user_id: f.first.owner.id }); assert.equal(r.total, 4); assert.equal(r.summary.confirmed_micros, "1000001"); assert.equal(r.summary.reserved_micros, "1000000"); assert.equal(r.summary.reconciliation_hold_micros, "1000000"); assert.equal(r.summary.unresolved_works, 1);
  assert.equal(r.groups.user.length, 1); assert.equal(r.groups.payer.length, 2); assert.equal(r.summary.internal_cost.amount_micros, null); assert.equal(r.summary.internal_cost.state, "not_recorded");
  assert.equal((await snapshot({ payer_kind: "user" })).summary.confirmed_micros, "125001");
  assert.equal((await snapshot({ billing_account_id: f.first.tenantWallet })).summary.confirmed_micros, "875000");
});
test("one immutable snapshot backs groups, task/operation/ledger detail and safe full-selection CSV after real refund", async () => {
  const before = await snapshot({ tenant_id: f.first.tenant }); await refundConsumption(s, f);
  const after = await snapshot({ tenant_id: f.first.tenant }); assert.equal(after.summary.refunded_micros, "100000"); assert.equal(after.summary.net_micros, "900001");
  const reread = await historyOk(s, admin.client, "GET", root + "/" + before.id); assert.deepEqual(reread.summary, before.summary); assert.equal(reread.watermark, before.watermark);
  const detail = await historyOk(s, admin.client, "GET", root + `/${after.id}/works/task/${f.company}`); assert.equal(detail.work.refunds[0].amount_micros, "100000"); assert.equal(detail.work.operations[0].action, "image.generate"); assert.equal(detail.work.ledger.length, 1);
  assert.ok(!JSON.stringify(detail).includes("Explicit synthetic accounting fixture")); assert.ok(!JSON.stringify(detail).includes("attempt_fencing"));
  const url = root + `/${after.id}?page_size=1&group_by=payer&group_key=${f.first.personalWallet}`, grouped = await historyOk(s, admin.client, "GET", url); assert.equal(grouped.total, 1); assert.equal(grouped.summary.confirmed_micros, "125001");
  const csv = await s.app.inject({ method: "GET", url: root + `/${after.id}/export?group_by=payer&group_key=${f.first.personalWallet}`, headers: { origin: s.db.config.ADMIN_ORIGIN, cookie: admin.client!.cookie } }); assert.equal(csv.statusCode, 200, csv.body); assert.ok(csv.body.includes("125001")); assert.ok(csv.body.includes(after.watermark)); assert.ok(!csv.body.includes(f.company)); assert.equal(csv.body.trim().split("\n").length, 2);
});
test("current project scopes and denies restrict every group, selected user and whole-selection export", async () => {
  const a = await overviewAdmin(s, ["admin.users.read"]); await overviewBind(s, a.id, ["admin.usage.read", "admin.exports.create", "admin.exports.download"], "project", f.first.project);
  const r = await snapshot({}, a.client); assert.equal(r.total, 4); assert.ok(r.items.every((w: any) => w.project_id === f.first.project)); assert.equal(r.summary.internal_cost, undefined);
  assert.equal((await snapshot({ user_id: f.second.owner.id }, a.client)).total, 0);
  await overviewBind(s, a.id, ["admin.usage.read"], "project", f.first.project, "deny"); assert.equal((await snapshot({}, a.client)).total, 0); assert.equal((await historyCall(s, a.client, "GET", root + "/" + r.id)).status, 409);
  const partial = await overviewAdmin(s, ["admin.usage.read"]); await overviewBind(s, partial.id, ["admin.exports.create", "admin.exports.download"], "project", f.first.project); const all = await snapshot({}, partial.client);
  assert.equal((await historyCall(s, partial.client, "GET", root + `/${all.id}/export`)).status, 403);
});
test("strict half-open time, source/model/capability filters, inaccessible detail and legacy usage contract", async () => {
  const when = (await s.db.control.query("SELECT created_at FROM tasks WHERE id=$1", [f.company])).rows[0].created_at.toISOString();
  assert.equal((await snapshot({ task_id: f.company, period_from: when })).total, 1); assert.equal((await snapshot({ task_id: f.company, period_to: when })).total, 0);
  assert.equal((await snapshot({ source: "desktop_agent" })).total, 0); assert.equal((await snapshot({ model_alias: "unseen-model" })).total, 0); assert.equal((await snapshot({ capability_version_id: randomUUID() })).total, 0);
  const r = await snapshot({ task_id: f.company }); assert.equal((await historyCall(s, admin.client, "GET", root + `/${r.id}/works/task/${f.outside}`)).status, 404);
  assert.equal((await historyCall(s, admin.client, "POST", root, { ...f.filters, period_to: f.filters.period_from })).status, 400); assert.equal((await historyCall(s, admin.client, "GET", root + `/${r.id}?group_by=user`)).status, 400);
  assert.equal((await historyCall(s, admin.client, "GET", "/v1/admin/usage")).status, 200);
});
test("session-bound snapshots, recent MFA, independent directory permission and exact request replay", async () => {
  const no = await overviewAdmin(s, ["admin.users.read"]); assert.equal((await historyCall(s, no.client, "POST", root, f.filters)).status, 403);
  const usage = await overviewAdmin(s, ["admin.usage.read"]); assert.equal((await historyCall(s, usage.client, "POST", root, { ...f.filters, user_id: f.first.owner.id })).status, 403);
  const idempotency = randomUUID(), request = (body: any) => s.app.inject({ method: "POST", url: root, headers: { origin: s.db.config.ADMIN_ORIGIN, cookie: admin.client!.cookie, "x-csrf-token": admin.client!.csrf, "idempotency-key": idempotency }, payload: body });
  const a = await request(f.filters), b = await request(f.filters); assert.equal(a.statusCode, 200, a.body); assert.deepEqual(a.json(), b.json()); assert.equal((await request({ ...f.filters, role_key: "designer" })).statusCode, 409);
  assert.equal((await historyCall(s, usage.client, "GET", root + "/" + a.json().id)).status, 404);
  const session = await s.db.control.query("SELECT id FROM sessions WHERE admin_id=$1 ORDER BY created_at DESC LIMIT 1", [usage.id]); await s.db.control.query("UPDATE sessions SET mfa_at=now()-interval '1 hour' WHERE id=$1", [session.rows[0].id]); assert.equal((await historyCall(s, usage.client, "POST", root, f.filters)).status, 403);
});
test("empty intersections remain exact and pagination bounds reject oversized pages", async () => {
  // A narrow SQL query returns an empty exact result rather than importing unrelated rows.
  const empty = await snapshot({ user_id: f.first.owner.id, project_id: f.second.project }); assert.equal(empty.total, 0); assert.equal(empty.summary.confirmed_micros, "0"); assert.equal(empty.summary.internal_cost, undefined);
  assert.equal((await historyCall(s, admin.client, "GET", root + `/${empty.id}?page_size=101`)).status, 400);
});
