import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { historyLogin, historyOk, type HistoryClient } from "./admin-history-fixture.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { hash } from "../src/lib.js";
import { reviewPage } from "../src/analysis-review.js";
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>;
before(async () => { isolated = await isolatedTestEnvironment(); s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", DEV_MAILBOX: "true", WORKER_ENABLED: "false" }), { worker: false }); });
after(async () => { try { await s?.app.close(); } finally { await isolated?.cleanup(); } });
async function call(c: HistoryClient | null, method: string, url: string, body?: unknown, key = randomUUID()) {
  const raw = await s.app.inject({ method: method as any, url, headers: { origin: s.db.config.WEB_ORIGIN, ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf, ...(c.tenant ? { "x-tenant-id": c.tenant } : {}) } : {}), "idempotency-key": key }, ...(body === undefined ? {} : { payload: body as any }) });
  return { status: raw.statusCode, raw, data: raw.headers["content-type"]?.includes("json") ? raw.json() : null };
}
const ok = (r: Awaited<ReturnType<typeof call>>) => { assert.ok(r.status >= 200 && r.status < 300, `${r.status} ${JSON.stringify(r.data)}`); return r.data; };
async function fixture() {
  const owner = await historyLogin(s), w = await historyOk(s, owner, "POST", "/v1/tenants", { name: "Marketing review fixture", project_name: "Controlled imported facts" }); owner.tenant = w.tenant.id;
  return { owner, tenant: w.tenant.id, project: w.project.id, base: `/v1/tenants/${w.tenant.id}/projects/${w.project.id}` };
}
async function source(f: Awaited<ReturnType<typeof fixture>>, count = 13, suffix = "") {
  const rows = ["date,channel,campaign,impressions,clicks,spend,conversions,revenue,currency"];
  for (let i = 0; i < count; i++) for (const [date, spend] of [["2026-10-01", i ? "100.125678" : "0"], ["2026-10-08", "80.123456"]]) rows.push(`${date},Google,Campaign ${i}${suffix},1000,100,${spend},0,,HKD`);
  return ok(await call(f.owner, "POST", f.base + "/analytics/import", { name: "Source " + suffix, csv: rows.join("\n"), currency: "HKD", account_id: "=SHEET_FORMULA()", attribution_definition: "7d click", conversion_definition: "Purchase" }));
}
const spec = (id: string) => ({ prompt: 'Review </script><script>alert("no")</script>', snapshot_ids: [id], date_from: "2026-10-08", date_to: "2026-10-08", comparison: { date_from: "2026-10-01", date_to: "2026-10-01" }, timezone: "Asia/Hong_Kong", currency_policy: "group_by_currency", metrics: ["spend", "ctr", "cpa", "roas"], dimensions: ["campaign"] });
const counters = async (tenant: string) => (await s.db.control.query("SELECT (SELECT count(*)::int FROM current_ai_provider_requests WHERE tenant_id=$1) calls,(SELECT count(*)::int FROM ledger WHERE tenant_id=$1) ledger,(SELECT count(*)::int FROM tasks WHERE tenant_id=$1) tasks", [tenant])).rows[0];

test("stable current-authority review exports every scope and exact evidence in HTML/CSV/JSON without model work or charges", async () => {
  const f = await fixture(), dataset = await source(f), specification = spec(dataset.id), path = f.base + "/analysis/preview", before = await counters(f.tenant);
  const a = ok(await call(f.owner, "POST", path, specification)), b = ok(await call(f.owner, "POST", path, specification));
  assert.deepEqual(a, b); assert.equal(a.groups.length, 13); assert.equal(a.preview.kind, "deterministic_preview"); assert.equal(a.preview.model_charges, false); assert.equal(a.preview.data_mode, "simulated");
  assert.equal(a.groups[0].periods.current.summary.exact.spend, "80.12345600");
  assert.ok(a.evidence.some((e: any) => e.metric_id === "spend.change" && e.value?.startsWith("-"))); assert.ok(a.evidence.some((e: any) => e.null_reason));
  for (const format of ["html", "csv", "json"]) {
    const r = await call(f.owner, "POST", path + "/export", { specification, calculation_sha256: a.calculation_sha256, format, locale: "en-HK" }); assert.equal(r.status, 200); const bytes = r.raw.rawPayload;
    assert.equal(r.raw.headers["cache-control"], format === "html" ? "no-store, no-transform" : "no-store"); assert.equal(r.raw.headers["x-content-sha256"], hash(bytes)); assert.equal(Number(r.raw.headers["content-length"]), bytes.length); assert.match(String(r.raw.headers["content-disposition"]), /attachment/);
    assert.ok(String(r.raw.headers["access-control-expose-headers"]).toLowerCase().includes("x-content-sha256"));
    if (format === "json") { const body = JSON.parse(bytes.toString()); assert.equal(body.kind, "deterministic_preview"); assert.equal(body.calculation_sha256, a.calculation_sha256); assert.equal(body.calculation.groups.length, 13); assert.equal(body.calculation.evidence.length, a.evidence.length); }
    else if (format === "html") { const text = bytes.toString(); assert.ok(text.includes("&lt;script&gt;")); assert.ok(!text.includes("<script>")); assert.match(text, /default-src 'none'/); assert.ok(text.includes(a.groups[12].periods.current.id)); }
    else { const text = bytes.toString(); assert.ok(text.includes("\"'=SHEET_FORMULA()\"")); assert.ok(text.includes("80.12345600")); assert.ok(text.includes(a.groups[12].periods.current.id)); assert.ok(text.includes("new_value")); }
  }
  assert.equal((await call(f.owner, "POST", path + "/export", { specification, calculation_sha256: "0".repeat(64), format: "json", locale: "en-HK" })).data.error.code, "ANALYSIS_PREVIEW_CHANGED");
  assert.equal((await call(null, "POST", path + "/export", { specification, calculation_sha256: a.calculation_sha256, format: "json" })).status, 401);
  const stranger = await historyLogin(s); stranger.tenant = f.tenant;
  assert.ok([403, 404].includes((await call(stranger, "POST", path, specification)).status));
  await s.db.control.query("UPDATE analytics_datasets SET content_state='quarantined' WHERE id=$1", [dataset.id]);
  assert.ok([403, 404].includes((await call(f.owner, "POST", path + "/export", { specification, calculation_sha256: a.calculation_sha256, format: "json", locale: "en-HK" })).status));
  assert.deepEqual(await counters(f.tenant), before);
});
test("dataset history reaches beyond100 and private report history beyond50 with literal search, no duplicate pages and query-bound cursors", async () => {
  const f = await fixture(), ids: string[] = [];
  for (let i = 0; i < 103; i++) ids.push((await source(f, 1, "history%_" + String(i).padStart(3, "0"))).id);
  const found: string[] = []; let cursor: string | null = null;
  do { const page = ok(await call(f.owner, "GET", f.base + "/analytics?limit=19" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""))); found.push(...page.items.map((v: any) => v.id)); cursor = page.next_cursor; if (cursor) assert.equal((await call(f.owner, "GET", f.base + "/analytics?search=different&cursor=" + encodeURIComponent(cursor))).data.error.code, "INVALID_CURSOR"); } while (cursor);
  assert.equal(found.length, 103); assert.equal(new Set(found).size, 103); assert.deepEqual(new Set(found), new Set(ids));
  const searched = ok(await call(f.owner, "GET", f.base + "/analytics?search=" + encodeURIComponent("history%_102"))); assert.deepEqual(searched.items.map((v: any) => v.id), [ids[102]]);
  await historyOk(s, f.owner, "POST", `/v1/tenants/${f.tenant}/demo-credit`, {});
  const agent = ok(await call(f.owner, "POST", f.base + "/analysis/assistant", {})), review = ok(await call(f.owner, "POST", f.base + "/analysis/preview", spec(ids[0]))), body = { project_id: f.project, agent_id: agent.id, analysis: review.spec, expected_calculation_sha256: review.calculation_sha256, budget: { currency: "HKD", amount_micros: "10000" } }, key = randomUUID();
  const bad = await call(f.owner, "POST", "/v1/reports", { ...body, expected_calculation_sha256: "0".repeat(64) }); assert.equal(bad.status, 409); assert.equal((await counters(f.tenant)).tasks, 0);
  const first = ok(await call(f.owner, "POST", "/v1/reports", body, key)); assert.equal(ok(await call(f.owner, "POST", "/v1/reports", body, key)).id, first.id);
  ok(await call(f.owner, "POST", f.base + "/tasks/" + first.task_id + "/cancel", {}));
  for (let i = 1; i < 53; i++) { const report = ok(await call(f.owner, "POST", "/v1/reports", { ...body, expected_calculation_sha256: undefined, analysis: { ...review.spec, prompt: "Report history " + i } })); ok(await call(f.owner, "POST", f.base + "/tasks/" + report.task_id + "/cancel", {})); }
  const reports: string[] = []; cursor = null;
  do { const page = ok(await call(f.owner, "GET", f.base + "/analysis/reports?limit=17" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""))); reports.push(...page.items.map((r: any) => r.id)); cursor = page.next_cursor; } while (cursor);
  assert.equal(reports.length, 53); assert.equal(new Set(reports).size, 53); assert.ok(reports.includes(first.id)); assert.equal((await counters(f.tenant)).tasks, 53);
  const other = await historyLogin(s); other.tenant = f.tenant;
  await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')", [f.tenant, other.id]);
  await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')", [f.tenant, f.project, other.id]);
  assert.deepEqual(ok(await call(other, "GET", f.base + "/analysis/reports?limit=100")).items, []);
  assert.equal((await call(other, "GET", f.base + "/analysis/reports/" + first.id)).status, 404);
});
test("cursor positions retain database microseconds and reject changed project/search scope", () => {
  const q = reviewPage({ search: "literal%_", limit: 2 }, "dataset:project:actor", 100), id = randomUUID(), cursor = q.next({ id, list_cursor_at: "2026-10-01T00:00:00.123456Z" });
  const next = reviewPage({ search: "literal%_", cursor }, "dataset:project:actor", 100); assert.equal(next.at, "2026-10-01T00:00:00.123456Z"); assert.equal(next.id, id);
  assert.throws(() => reviewPage({ search: "literal%_", cursor }, "other-project", 100), /list changed/);
  assert.throws(() => reviewPage({ search: "different", cursor }, "dataset:project:actor", 100), /list changed/);
});
