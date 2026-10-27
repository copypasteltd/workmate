import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { advanceConnectors } from "../src/connectors.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { Worker } from "../src/worker.js";
import { CodexRuntimeAdapter, type RuntimeContext, type RuntimeResult } from "../src/runtime.js";
import { connectorReadInputV1 } from "../src/analysis-role-tools.js";
import { desktopCompanyToolSchema } from "../src/desktop-tool-policy.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createRequire } from "node:module";
import contract from "../contracts/web-analytics-schemas.json" with { type: "json" };
const ajv = new Ajv2020({ allErrors: true }); createRequire(import.meta.url)("ajv-formats")(ajv);
ajv.addKeyword("components");
const root = { components: { schemas: contract.schemas } };
const pageSchema = ajv.compile({ ...root, $ref: "#/components/schemas/ReportPage" });
const reportSchema = ajv.compile({ ...root, $ref: "#/components/schemas/Report" });
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string };
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", WORKER_ENABLED: "false", DEV_MAILBOX: "true" }), { worker: false });
});
after(async () => { try { await s?.app.close(); } finally { await isolated?.cleanup(); } });
async function call(c: Client | undefined, method: string, url: string, body?: unknown, tenant?: string) {
  const raw = await s.app.inject({ method: method as any, url,
    headers: { origin: s.db.config.WEB_ORIGIN, "idempotency-key": randomUUID(),
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}), ...(tenant ? { "x-tenant-id": tenant } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
  let data: any; try { data = raw.json(); } catch { data = raw.body; }
  return { status: raw.statusCode, data, raw };
}
async function ok(c: Client | undefined, method: string, url: string, body?: unknown, tenant?: string) {
  const r = await call(c, method, url, body, tenant);
  assert.ok(r.status >= 200 && r.status < 300, `${r.status} ${JSON.stringify(r.data)}`); return r.data;
}
async function user(): Promise<Client> {
  const challenge = await ok(undefined, "POST", "/v1/auth/challenge", { email: `web-analytics-${randomUUID()}@example.invalid` });
  const mail = JSON.parse(await readFile(`${s.db.config.DATA_DIR}/mailbox/${challenge.challenge_id}.json`, "utf8"));
  const r = await call(undefined, "POST", "/v1/auth/verify", { challenge_id: challenge.challenge_id, code: mail.text.match(/\b\d{6}\b/)[0] });
  assert.equal(r.status, 200); const cookie = r.raw.cookies.find(c => c.name === "cp_session")!;
  return { id: r.data.user.id, csrf: r.data.csrf_token, cookie: cookie.name + "=" + cookie.value };
}
const dates = { date_from: "2026-10-01", date_to: "2026-10-07" };
async function workspace() {
  const owner = await user(), w = await ok(owner, "POST", "/v1/tenants", { name: "Synthetic website analysis", project_name: "Hong Kong website" });
  const tenant = w.tenant.id as string, project = w.project.id as string;
  return { owner, tenant, project, base: `/v1/tenants/${tenant}/projects/${project}` };
}
type Fixture = Awaited<ReturnType<typeof workspace>>;
async function drain(f: Fixture, connection: string) {
  for (let i = 0; i < 40; i++) {
    const d = await ok(f.owner, "GET", `/v1/connections/${connection}/detail`, undefined, f.tenant);
    if (!d.jobs.some((j: any) => ["queued", "running"].includes(j.status))) return d;
    await advanceConnectors(s.db, s.storage);
  }
  throw new Error("Owned connector jobs did not finish");
}
async function connect(f: Fixture, provider: "ga4" | "search_console") {
  const c = await ok(f.owner, "POST", "/v1/connections", { project_id: f.project, provider }, f.tenant);
  const consent = new URL(c.authorization_url); consent.pathname = consent.pathname.replace("/consent/", "/approve/");
  const response = await fetch(consent, { redirect: "manual" }); assert.equal(response.status, 302);
  const callback = new URL(response.headers.get("location")!);
  await ok(undefined, "GET", callback.pathname + callback.search);
  const discovered = await drain(f, c.id), accountIds = discovered.accounts.filter((a: any) => a.readable && a.kind !== "manager").map((a: any) => a.account_id);
  await ok(f.owner, "PATCH", `/v1/connections/${c.id}`, { expected_version: discovered.connection.version, account_ids: accountIds, project_ids: [f.project] }, f.tenant);
  return { id: c.id, accountIds };
}
async function capture(f: Fixture, c: { id: string }) {
  const job = await ok(f.owner, "POST", `/v1/connections/${c.id}/syncs`, dates, f.tenant);
  await drain(f, c.id);
  return ok(f.owner, "GET", `/v1/syncs/${job.id}`, undefined, f.tenant);
}
function url(f: Fixture, id: string, profile = "ga4_traffic", account = "201", extra: Record<string, string> = {}) {
  return f.base + `/connector-snapshots/${id}/web-analysis?` + new URLSearchParams({ profile, account_id: account, ...dates, group_by: "", ...extra });
}
test("OAuth/PKCE captured GA4 facts produce exact pages and full authenticated downloads with no task/AI charge", async () => {
  const f = await workspace(), c = await connect(f, "ga4");
  s.connectorFixture!.setFaults("ga4", ["negative_revenue"]);
  const snapshot = await capture(f, c); assert.equal(snapshot.state, "complete");
  const raw = await ok(f.owner, "GET", `/v1/connector-snapshots/${snapshot.snapshot_id}`, undefined, f.tenant);
  assert.equal(raw.web_analysis_options.length, 2);
  const calls = s.connectorFixture!.calls.length;
  const before = (await s.db.control.query("SELECT (SELECT count(*) FROM tasks) AS tasks,(SELECT count(*) FROM ledger) AS ledger")).rows[0];
  const r = await call(f.owner, "GET", url(f, snapshot.snapshot_id, "ga4_traffic", "201", { group_by: "channel", limit: "1" }), undefined, f.tenant);
  assert.equal(r.status, 200); assert.equal(r.raw.headers["cache-control"], "private, no-store");
  assert.equal(pageSchema(r.data), true, JSON.stringify(pageSchema.errors));
  assert.equal(r.data.summary.metrics.sessions.value, "360");
  assert.equal(r.data.summary.metrics.totalRevenue.value, "-199.5");
  assert.equal(r.data.summary.metrics.totalUsers.value, null);
  assert.equal(r.data.total_groups, 3); assert.equal(r.data.groups.length, 1); assert.equal(r.data.next_offset, 1);
  const next = await ok(f.owner, "GET", url(f, snapshot.snapshot_id, "ga4_traffic", "201", { group_by: "channel", offset: "1", limit: "1" }), undefined, f.tenant);
  assert.equal(next.calculation_sha256, r.data.calculation_sha256); assert.notEqual(next.groups[0].id, r.data.groups[0].id);
  for (const format of ["json", "csv", "html"]) {
    const exported = await call(f.owner, "GET", url(f, snapshot.snapshot_id, "ga4_traffic", "201", { group_by: "channel", format, locale: "en-HK" }), undefined, f.tenant);
    assert.equal(exported.status, 200); assert.ok(exported.raw.headers["content-disposition"]?.includes("attachment"));
    assert.equal(exported.raw.headers["x-content-type-options"], "nosniff");
    assert.ok(exported.raw.body.includes(r.data.calculation_sha256));
    if (format === "json") { assert.equal(exported.data.groups.length, 3); assert.equal(reportSchema(exported.data), true, JSON.stringify(reportSchema.errors)); }
    if (format === "html") assert.ok(!exported.raw.body.includes("<script"));
  }
  assert.equal(s.connectorFixture!.calls.length, calls);
  const after = (await s.db.control.query("SELECT (SELECT count(*) FROM tasks) AS tasks,(SELECT count(*) FROM ledger) AS ledger")).rows[0];
  assert.deepEqual(after, before);
});
test("Search reports keep property/account boundaries, Pacific dates, unknown totals and full-row evidence", async () => {
  const f = await workspace(), c = await connect(f, "search_console"), snapshot = await capture(f, c);
  const account = c.accountIds[0], r = await ok(f.owner, "GET", url(f, snapshot.snapshot_id, "search_performance", account, { group_by: "query" }), undefined, f.tenant);
  assert.equal(r.summary.metrics.clicks.value, "63"); assert.equal(r.summary.metrics.impressions.value, "603");
  assert.equal(r.summary.metrics.ctr.value, "0.10447761");
  assert.equal(r.source.timezone, "America/Los_Angeles");
  assert.equal(r.source.account_id, account); assert.equal(r.coverage.selected_rows, 3);
  assert.ok(r.limitations.includes("GSC_ANONYMIZED_QUERIES_OMITTED"));
  const empty = await ok(f.owner, "GET", url(f, snapshot.snapshot_id, "search_performance", account, { date_from: "2026-10-07" }), undefined, f.tenant);
  assert.equal(empty.summary.metrics.clicks.value, null); assert.equal(empty.summary.metrics.clicks.null_reason, "no_rows");
});
test("Report reads reject anonymous/foreign actors, conflicting path scope, invalid filters and unsupported methods", async () => {
  const f = await workspace(), c = await connect(f, "ga4"), snapshot = await capture(f, c), stranger = await user();
  const path = url(f, snapshot.snapshot_id);
  assert.equal((await call(undefined, "GET", path, undefined, f.tenant)).status, 401);
  assert.equal((await call(stranger, "GET", path, undefined, f.tenant)).status, 404);
  const other = await workspace();
  assert.equal((await call(f.owner, "GET", path.replace(f.project, other.project), undefined, f.tenant)).status, 404);
  assert.equal((await call(f.owner, "GET", path.replace(f.tenant, other.tenant), undefined, f.tenant)).status, 404);
  for (const patch of [{ group_by: "event" }, { account_id: "999" }, { date_from: "2026-09-30" }, { offset: "999" }] as Record<string, string>[]) {
    const bad = await call(f.owner, "GET", url(f, snapshot.snapshot_id, "ga4_traffic", "201", patch), undefined, f.tenant);
    assert.equal(bad.status, 422, JSON.stringify(bad.data));
  }
  assert.equal((await call(f.owner, "GET", path + "&extra=untrusted", undefined, f.tenant)).status, 400);
  assert.equal((await call(f.owner, "POST", path, {}, f.tenant)).status, 404);
});
test("Original retained report survives OAuth disconnect; source quarantine/expiry blocks preview and all exports", async () => {
  const f = await workspace(), c = await connect(f, "ga4"), snapshot = await capture(f, c), path = url(f, snapshot.snapshot_id);
  const first = await ok(f.owner, "GET", path, undefined, f.tenant);
  await ok(f.owner, "DELETE", `/v1/connections/${c.id}`, undefined, f.tenant);
  assert.equal((await ok(f.owner, "GET", path, undefined, f.tenant)).calculation_sha256, first.calculation_sha256);
  const asset = (await s.db.control.query("SELECT asset_id FROM connector_snapshots WHERE id=$1", [snapshot.snapshot_id])).rows[0].asset_id;
  await s.db.control.query("UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1", [asset]);
  for (const format of ["page", "json", "html", "csv"])
    assert.equal((await call(f.owner, "GET", path + "&format=" + format, undefined, f.tenant)).status, 404);
  await s.db.control.query("UPDATE assets SET state='active',retention_expires_at=clock_timestamp()-interval '1 second',moderation_version=moderation_version+1 WHERE id=$1", [asset]);
  assert.equal((await call(f.owner, "GET", path, undefined, f.tenant)).status, 404);
});
test("A source revoked during file loading cannot be returned by the last availability check", async () => {
  const f = await workspace(), c = await connect(f, "ga4"), snapshot = await capture(f, c);
  const row = (await s.db.control.query("SELECT s.asset_id,v.storage_key FROM connector_snapshots s JOIN asset_versions v ON v.asset_id=s.asset_id AND v.version=s.asset_version WHERE s.id=$1", [snapshot.snapshot_id])).rows[0];
  const original = s.storage.get.bind(s.storage); let once = true;
  s.storage.get = async key => { const bytes = await original(key); if (key === row.storage_key && once) { once = false; await s.db.control.query("UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1", [row.asset_id]); } return bytes; };
  try { assert.equal((await call(f.owner, "GET", url(f, snapshot.snapshot_id), undefined, f.tenant)).status, 404); }
  finally { s.storage.get = original; }
});
test("Captured byte corruption is rejected instead of exporting plausible-looking metrics", async () => {
  const f = await workspace(), c = await connect(f, "ga4"), snapshot = await capture(f, c);
  const row = (await s.db.control.query("SELECT v.storage_key FROM connector_snapshots s JOIN asset_versions v ON v.asset_id=s.asset_id AND v.version=s.asset_version WHERE s.id=$1", [snapshot.snapshot_id])).rows[0];
  const original = s.storage.get.bind(s.storage);
  s.storage.get = async key => key === row.storage_key ? Buffer.from("{}") : original(key);
  try { const r = await call(f.owner, "GET", url(f, snapshot.snapshot_id), undefined, f.tenant); assert.equal(r.status, 409); assert.equal(r.data.error.code, "CONNECTOR_SNAPSHOT_INTEGRITY"); }
  finally { s.storage.get = original; }
});
class ToolFixture extends CodexRuntimeAdapter {
  failure: unknown;
  constructor(private perform: (ctx: RuntimeContext) => Promise<void>) { super(s.db.config); }
  override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
    try { await this.perform(ctx); } catch (e) { this.failure = e; throw e; }
    return { status: "completed", text: "Synthetic model; deterministic source-bound metrics were read through real tools.", inputTokens: 20, outputTokens: 10, usageKnown: true, accepted: true, thread: "synthetic-web-analysis", turn: randomUUID() };
  }
}
test("Versioned marketing specialist reads new analytics through authorized cloud/native schema; old version remains exact", async () => {
  const f = await workspace(), c = await connect(f, "ga4"), snapshot = await capture(f, c);
  const role = s.catalog.role("marketing-analyst"); assert.equal(role.version, "1.2.0");
  const release = JSON.parse(await readFile("catalog/web-analytics-release-v1.json", "utf8"));
  const old = s.catalog.role("marketing-analyst", release.previous_role_sha256); assert.equal(old.version, "1.1.0");
  assert.equal(s.catalog.digest(old), release.previous_role_sha256);
  assert.equal(connectorReadInputV1.safeParse({ snapshot_id: snapshot.snapshot_id, analysis: { profile: "ga4_traffic", account_id: "201", ...dates } }).success, false);
  await ok(f.owner, "POST", `/v1/tenants/${f.tenant}/demo-credit`, {});
  const templates = await ok(f.owner, "GET", "/v1/agent-templates?limit=30", undefined, f.tenant), template = templates.items.find((t: any) => t.role_key === "marketing-analyst");
  const agent = await ok(f.owner, "POST", `/v1/agent-templates/${template.id}/instances`, { project_id: f.project, template_version: template.version }, f.tenant);
  const conversation = await ok(f.owner, "POST", f.base + "/conversations", { name: "Captured website review", agent_id: agent.id });
  const accepted = await ok(f.owner, "POST", f.base + `/conversations/${conversation.id}/messages`, { body: "Review captured website metrics", expected_version: conversation.version, intent: "delegate", mode: "execute", budget_micros: 1000000, client_message_id: randomUUID() });
  const runtime = new ToolFixture(async ctx => {
    assert.ok(ctx.skills.some(p => p.content.includes("name: web-analytics")));
    const read = ctx.tools.find(t => t.name === "connector_read")!; assert.ok(read);
    desktopCompanyToolSchema(read.inputSchema);
    const analysis = { profile: "ga4_traffic", account_id: "201", ...dates, group_by: ["channel"] };
    const report: any = await read.run({ snapshot_id: snapshot.snapshot_id, analysis, limit: 20 }, randomUUID());
    assert.equal(report.kind, "captured_web_analytics"); assert.equal(report.groups.length, 2); assert.equal(report.next_offset, 2);
    assert.equal(report.summary.metrics.sessions.value, "360");
    assert.equal(report.summary.metrics.totalUsers.value, null);
    const download = await ok(f.owner, "GET", report.report_downloads.json, undefined, f.tenant);
    assert.equal(download.calculation_sha256, report.calculation_sha256); assert.equal(download.groups.length, 3);
    assert.ok(!/access_token|refresh_token|encrypted_secret/.test(JSON.stringify(report)));
  });
  await new Worker(s.db, s.catalog, s.storage, runtime).run(f.tenant, accepted.task.id);
  if (runtime.failure) throw runtime.failure;
  const completed = await ok(f.owner, "GET", f.base + `/tasks/${accepted.task.id}`);
  assert.equal(completed.status, "succeeded");
  assert.equal(Number(completed.charged_micros), 30);
});
