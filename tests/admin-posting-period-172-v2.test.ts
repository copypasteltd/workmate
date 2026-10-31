import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { parse } from "csv-parse/sync";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { usageReportFilters, groupUsage, selectUsageWorks, summarizeUsage } from "../src/admin-usage-report-model.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { overviewAdmin, overviewBind } from "./admin-overview-fixture-160-v2.js";
import { historyCall, historyOk, type System } from "./admin-history-fixture.js";
import { reportPermissions, refundConsumption } from "./admin-usage-report-fixture-169-v1.js";
import { postingFixture } from "./admin-posting-period-fixture-172-v2.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: System,
  f: Awaited<ReturnType<typeof postingFixture>>, admin: Awaited<ReturnType<typeof overviewAdmin>>;
const root = "/v1/admin/usage-reports";
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", DEV_MAILBOX: "true", WORKER_ENABLED: "false" }), { worker: false });
  f = await postingFixture(s); admin = await overviewAdmin(s, reportPermissions);
});
after(async () => { try { await s?.app.close(); } finally { await isolated?.cleanup(); } });
async function snapshot(extra: any = {}, client = admin.client) {
  const saved = await historyOk(s, client, "POST", root, { ...f.filters, time_basis: "ledger_posted_at", user_id: f.first.owner.id, ...extra });
  return historyOk(s, client, "GET", root + "/" + saved.id);
}
const pathFor = (r: any, extra = "") => root + "/" + r.id + extra;
async function exported(r: any, query = "") {
  const raw = await s.app.inject({ method: "GET", url: pathFor(r, "/export" + query), headers: { origin: s.db.config.ADMIN_ORIGIN, cookie: admin.client!.cookie } });
  assert.equal(raw.statusCode, 200, raw.body);
  return parse(raw.body, { columns: true, bom: true }) as Record<string, string>[];
}

test("posting period includes old works by actual charges/refunds and keeps current liabilities separate", async () => {
  const r = await snapshot(); assert.equal(r.time_basis, "ledger_posted_at");
  assert.equal(r.total, 2); assert.ok(r.items.some((w: any) => w.id === f.company && Date.parse(w.created_at) === Date.parse(f.oldCreation)));
  assert.equal(r.summary.confirmed_micros, "1000001"); assert.equal(r.summary.refunded_micros, "100000"); assert.equal(r.summary.net_micros, "900001");
  assert.equal(r.summary.reserved_micros, null); assert.equal(r.summary.reconciliation_hold_micros, null); assert.equal(r.summary.holds_state, "outside_posted_activity");
  assert.equal(r.units_time_basis, "selected_work_lifetime"); assert.ok(!r.items.some((w: any) => [f.reserved, f.unknown, f.historical].includes(w.id)));
  assert.equal((await snapshot({ payer_kind: "user" })).summary.confirmed_micros, "125001");
  assert.equal((await snapshot({ billing_account_id: f.first.tenantWallet })).summary.confirmed_micros, "875000");
});
test("daily postings aggregate each charge/refund once across the Hong Kong midnight boundary", async () => {
  const r = await snapshot(f.historicalFilters); assert.equal(r.total, 1);
  assert.equal(r.summary.confirmed_micros, "500003"); assert.equal(r.summary.refunded_micros, "100001"); assert.equal(r.summary.net_micros, "400002");
  assert.deepEqual(r.groups.day.map((g: any) => [g.key, g.confirmed_micros, g.refunded_micros, g.net_micros]), [[f.days[0], "200001", "0", "200001"], [f.days[1], "300002", "100001", "200001"]]);
  assert.equal(r.groups.day.reduce((n: bigint, g: any) => n + BigInt(g.net_micros), 0n).toString(), r.summary.net_micros);
  for (const g of r.groups.day) {
    const q = "?group_by=day&group_key=" + g.key, page = await historyOk(s, admin.client, "GET", pathFor(r, q));
    const detail = await historyOk(s, admin.client, "GET", pathFor(r, `/works/task/${f.historical}` + q));
    const rows = await exported(r, q); assert.equal(rows.length, 1);
    for (const key of ["confirmed_micros", "refunded_micros"]) { assert.equal(page.summary[key], g[key]); assert.equal(detail.work[key], g[key]); assert.equal(rows[0][key], g[key]); }
    assert.equal(rows[0].net_micros, g.net_micros); assert.equal(rows[0].group_key, g.key); assert.equal(rows[0].reserved_micros, "");
    assert.equal(rows[0].watermark, r.watermark); assert.equal(detail.watermark, r.watermark); assert.equal(page.watermark, r.watermark);
    assert.equal(detail.work.ledger.length, 1); assert.equal(detail.work.refunds.length, g.key === f.days[0] ? 0 : 1);
  }
});
test("refund-only periods have negative net and trace an original charge outside the period", async () => {
  const r = await snapshot({ period_from: f.dates[2], period_to: new Date(Date.parse(f.dates[2]) + 1000).toISOString() });
  assert.equal(r.total, 1); assert.equal(r.summary.confirmed_micros, "0"); assert.equal(r.summary.refunded_micros, "100001"); assert.equal(r.summary.net_micros, "-100001");
  const d = await historyOk(s, admin.client, "GET", pathFor(r, `/works/task/${f.historical}`));
  assert.equal(d.work.ledger.length, 0); assert.equal(d.work.refunds[0].original_charge_id, f.charges[0]);
  assert.equal(d.work.refunds[0].original_charge_micros, "200001"); assert.equal(Date.parse(d.work.refunds[0].original_charge_posted_at), Date.parse(f.dates[0]));
  const rows = await exported(r); assert.equal(rows[0].net_micros, "'-100001"); assert.equal(rows[0].time_basis, "ledger_posted_at");
  assert.equal(rows[0].period_from, f.dates[2]); assert.equal(rows[0].holds_state, "outside_posted_activity");
});
test("half-open charge/refund boundaries and group-context detail never import unrelated entries", async () => {
  const r = await snapshot({ period_from: f.dates[0], period_to: f.dates[1] });
  assert.equal(r.summary.confirmed_micros, "200001"); assert.equal(r.summary.refunded_micros, "0");
  const onlySecond = await snapshot({ period_from: f.dates[1], period_to: f.dates[2] }); assert.equal(onlySecond.summary.confirmed_micros, "300002"); assert.equal(onlySecond.summary.refunded_micros, "0");
  assert.equal((await historyCall(s, admin.client, "GET", pathFor(r, `/works/task/${f.historical}?group_by=day&group_key=${f.days[1]}`))).status, 404);
  assert.equal((await historyCall(s, admin.client, "GET", pathFor(r, `/works/task/${f.historical}?group_by=day`))).status, 400);
  assert.equal((await historyCall(s, admin.client, "GET", pathFor(r, `/works/task/${f.historical}?page=1`))).status, 400);
  assert.equal((await snapshot({ source: "desktop_agent" })).total, 0); assert.equal((await snapshot({ model_alias: "unseen" })).total, 0);
  assert.equal((await snapshot({ capability_version_id: randomUUID() })).total, 0);
});
test("old omitted-time-basis requests and cohorts retain their exact replay contract", async () => {
  assert.deepEqual(usageReportFilters.parse(f.filters), f.filters);
  const body = { ...f.filters, user_id: f.first.owner.id }, key = randomUUID();
  const request = (payload: any) => s.app.inject({ method: "POST", url: root, headers: { origin: s.db.config.ADMIN_ORIGIN, cookie: admin.client!.cookie, "x-csrf-token": admin.client!.csrf, "idempotency-key": key }, payload });
  const a = await request(body), b = await request(body); assert.equal(a.statusCode, 200, a.body); assert.deepEqual(a.json(), b.json());
  assert.equal((await request({ ...body, time_basis: "ledger_posted_at" })).statusCode, 409);
  const r = await historyOk(s, admin.client, "GET", root + "/" + a.json().id); assert.equal(r.time_basis, "work_created_at"); assert.equal(r.total, 3);
  assert.equal(r.summary.confirmed_micros, "125001"); assert.equal(r.summary.reserved_micros, "1000000"); assert.equal(r.summary.reconciliation_hold_micros, "1000000");
  assert.equal((await historyCall(s, admin.client, "POST", root, { ...body, time_basis: "other" })).status, 400);
  assert.equal((await historyCall(s, admin.client, "POST", root, { ...body, unexpected: true })).status, 400);
});
test("snapshots keep the same facts after later canonical refunds", async () => {
  const r = await snapshot(); await refundConsumption(s, f, "50000");
  const old = await historyOk(s, admin.client, "GET", pathFor(r)); assert.deepEqual(old.summary, r.summary); assert.equal(old.watermark, r.watermark);
  const fresh = await snapshot(); assert.equal(fresh.summary.refunded_micros, "150000"); assert.equal(fresh.summary.net_micros, "850001");
});
test("current project scopes, denies and whole-selection export authority also cover historical postings", async () => {
  const a = await overviewAdmin(s, ["admin.users.read"]); await overviewBind(s, a.id, ["admin.usage.read", "admin.exports.create", "admin.exports.download"], "project", f.first.project);
  const r = await snapshot({ ...f.historicalFilters }, a.client); assert.equal(r.total, 1); assert.equal(r.summary.internal_cost, undefined);
  const partial = await overviewAdmin(s, ["admin.usage.read"]); await overviewBind(s, partial.id, ["admin.exports.create", "admin.exports.download"], "project", f.first.project);
  const all = await snapshot({ user_id: undefined }, partial.client); assert.ok(all.items.some((w: any) => w.id === f.outside));
  assert.equal((await historyCall(s, partial.client, "GET", pathFor(all, "/export"))).status, 403);
  await overviewBind(s, a.id, ["admin.usage.read"], "project", f.first.project, "deny"); assert.equal((await snapshot(f.historicalFilters, a.client)).total, 0);
  assert.equal((await historyCall(s, a.client, "GET", pathFor(r))).status, 409);
});
test("independent identity, current MFA, user access and session ownership remain mandatory", async () => {
  const noUser = await overviewAdmin(s, ["admin.usage.read"]);
  assert.equal((await historyCall(s, noUser.client, "POST", root, { ...f.filters, time_basis: "ledger_posted_at", user_id: f.first.owner.id })).status, 403);
  const r = await snapshot(); assert.equal((await historyCall(s, noUser.client, "GET", pathFor(r))).status, 404);
  const session = (await s.db.control.query("SELECT id FROM sessions WHERE admin_id=$1 ORDER BY created_at DESC LIMIT 1", [noUser.id])).rows[0];
  await s.db.control.query("UPDATE sessions SET mfa_at=now()-interval '1 hour' WHERE id=$1", [session.id]);
  assert.equal((await historyCall(s, noUser.client, "POST", root, { ...f.filters, time_basis: "ledger_posted_at" })).status, 403);
});
test("posting-day projection preserves large exact integers and does not duplicate lifetime units", () => {
  const row = { id: "fixture", user_id: "one", billing_account_id: "wallet", tenant_id: "tenant", project_id: "project", role_key: "designer", source: "cloud_agent", created_at: "2020-01-01T00:00:00Z", confirmed_micros: "9007199254741004", refunded_micros: "9", reserved_micros: null, reconciliation_hold_micros: null, unresolved: false,
    ledger: [{ amount_micros: "-9007199254740993", created_at: "2026-01-01T15:59:59Z" }, { amount_micros: "-11", created_at: "2026-01-01T16:00:00Z" }], refunds: [{ amount_micros: "9", created_at: "2026-01-01T16:00:01Z" }], operations: [{ units: { input_tokens: "9007199254740993" } }] };
  const groups = groupUsage([row], "ledger_posted_at").day; assert.deepEqual(groups.map((g: any) => g.net_micros), ["9007199254740993", "2"]);
  const chosen = selectUsageWorks([row], { group_by: "day", group_key: "2026-01-02" }, "ledger_posted_at");
  assert.equal(summarizeUsage(chosen, "ledger_posted_at").net_micros, "2"); assert.equal(summarizeUsage([row], "ledger_posted_at").units.input_tokens.known, "9007199254740993");
  assert.equal(row.ledger.length, 2); assert.equal(summarizeUsage([], "ledger_posted_at").reserved_micros, null);
});
