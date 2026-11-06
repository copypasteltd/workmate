import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { unzipSync } from "fflate";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { historyLogin, historyOk, type HistoryClient } from "./admin-history-fixture.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { saveAsset } from "../src/storage.js";
import { normalizeMetricsCSV } from "../src/analytics-import.js";
import { calculateAnalysis, normalizedAnalysis } from "../src/analysis-calculation.js";
import { calculationDigest, renderAnalysisDelivery } from "../src/analysis-role-delivery.js";
import { designTemplateIds } from "../src/design-templates.js";
import { selectDesignEvidence } from "../src/portable-design-evidence.js";
import { hash } from "../src/lib.js";
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>;
before(async () => { isolated = await isolatedTestEnvironment(); s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", DEV_MAILBOX: "true", WORKER_ENABLED: "false" }), { worker: false }); });
after(async () => { try { await s?.app.close(); } finally { await isolated?.cleanup(); } });
async function call(c: HistoryClient, method: string, url: string, body?: unknown, key = randomUUID()) {
  const raw = await s.app.inject({ method: method as any, url, headers: { origin: s.db.config.WEB_ORIGIN, cookie: c.cookie, "x-csrf-token": c.csrf, "x-tenant-id": c.tenant!, "idempotency-key": key }, ...(body === undefined ? {} : { payload: body as any }) });
  return { status: raw.statusCode, raw, data: raw.headers["content-type"]?.includes("json") ? raw.json() : null };
}
function ok(r: Awaited<ReturnType<typeof call>>) { assert.ok(r.status >= 200 && r.status < 300, `${r.status} ${JSON.stringify(r.data)}`); return r.data; }
async function fixture() {
  const user = await historyLogin(s), w = await historyOk(s, user, "POST", "/v1/tenants", { name: "Design production fixture", project_name: "Explicit simulated data" }); user.tenant = w.tenant.id;
  const base = `/v1/tenants/${user.tenant}/projects/${w.project.id}`;
  const asset = (name: string, bytes: Buffer, mime: string, metadata = {}, privateOwner?: string) => s.db.tx(tx => saveAsset(tx, s.storage, { tenant: user.tenant!, project: w.project.id, user: user.id, name, bytes, mime, metadata, ...(privateOwner ? { privateOwner } : {}) }), user.tenant!, false, user.id);
  return { user, project: w.project.id, base, root: base + "/editable-projects", asset };
}
const counts = async (tenant: string) => (await s.db.control.query(`SELECT
  (SELECT count(*)::int FROM current_ai_provider_requests WHERE tenant_id=$1) calls,
  (SELECT count(*)::int FROM ledger WHERE tenant_id=$1) ledger,
  (SELECT count(*)::int FROM creative_projects WHERE tenant_id=$1) projects`, [tenant])).rows[0];

for (const locale of ["zh-HK", "en-HK"] as const) test(`${locale}: all six layouts create real reusable immutable works without a provider or duplicate replay`, async () => {
  const f = await fixture(), catalog = ok(await call(f.user, "GET", f.root + "/templates"));
  assert.deepEqual(catalog.items.map((v: any) => v.id), [...designTemplateIds]);
  for (const template_id of designTemplateIds) {
    const body = { name: "Actual layout " + template_id, template_id, locale, confirm_project_sharing: true }, key = randomUUID();
    const created = ok(await call(f.user, "POST", f.root, body, key));
    assert.deepEqual(ok(await call(f.user, "POST", f.root, body, key)), created);
    assert.equal(ok(await call(f.user, "GET", f.root + "/requests/" + key + "?operation=create")).result.id, created.id);
    const detail = ok(await call(f.user, "GET", f.root + "/" + created.id));
    assert.equal(detail.input.locale, locale); assert.equal(detail.version, 1);
    const preview = ok(await call(f.user, "POST", f.root + "/" + created.id + "/draft-preview", { expected_version: 1, source_version: 1, input: detail.input }));
    assert.equal(preview.saved, false); assert.equal(hash(Buffer.from(preview.base64, "base64")), preview.sha256);
    assert.equal((await call(f.user, "POST", f.root, { ...body, name: "Different request" }, key)).status, 409);
  }
  assert.deepEqual(await counts(f.user.tenant!), { calls: 0, ledger: 0, projects: 6 });
  assert.equal((await call(f.user, "POST", f.root, { name: "No sharing consent", template_id: "pitch-deck", locale, confirm_project_sharing: false })).status, 422);
  const outsider = await historyLogin(s); outsider.tenant = f.user.tenant;
  for (const path of ["/templates", "/resources?kind=image"]) assert.ok([403,404].includes((await call(outsider, "GET", f.root + path)).status));
});

test("shared fixed PNG selection excludes private/wrong-project resources and rechecks digest, quarantine and real pixels", async () => {
  const f = await fixture(), c = createCanvas(320, 160), g = c.getContext("2d"); g.fillStyle = "#b55f36"; g.fillRect(0, 0, 320, 160);
  const a = await f.asset("Reviewed product.png", c.toBuffer("image/png"), "image/png");
  await f.asset("Private product.png", c.toBuffer("image/png"), "image/png", {}, f.user.id);
  const listed = ok(await call(f.user, "GET", f.root + "/resources?kind=image&q=Reviewed"));
  assert.equal(listed.items.length, 1); assert.equal(listed.items[0].source_version_id, a.version.id);
  const path = f.root + "/resources/" + a.version.id + "?sha256=" + a.version.sha256;
  const r = await call(f.user, "GET", path), detail = ok(r); assert.equal(r.raw.headers["cache-control"], "no-store");
  assert.equal(detail.width, 320); assert.equal(detail.height, 160); assert.equal(detail.preview.sha256, hash(Buffer.from(detail.preview.base64, "base64")));
  assert.equal((await call(f.user, "GET", path.replace(a.version.sha256, "0".repeat(64)))).status, 409);
  const other = await historyOk(s, f.user, "POST", `/v1/tenants/${f.user.tenant}/projects`, { name: "Another project" });
  assert.equal((await call(f.user, "GET", path.replace(f.project, other.id))).status, 404);
  await s.db.control.query("UPDATE assets SET state='quarantined' WHERE id=$1", [a.id]);
  assert.equal((await call(f.user, "GET", path)).status, 404); assert.equal(ok(await call(f.user, "GET", f.root + "/resources?kind=image")).items.length, 0);
});

async function analysisFixture(f: Awaited<ReturnType<typeof fixture>>, corrupt = false) {
  const parsed = normalizeMetricsCSV("date,channel,campaign,impressions,clicks,spend,conversions,revenue,currency\n2026-10-01,Google,Launch,1000,100,12.345678,1,40,HKD\n2026-10-01,Google,Repeat,100,10,7,0,0,HKD\n2026-09-01,Google,Launch,2000,200,50,2,80,HKD", {
    currency: "HKD", account_id: "review-account", attribution_definition: "7d click", conversion_definition: "Purchase" });
  const dataset = { id: randomUUID(), project_id: f.project, source: parsed.source, currency: parsed.currency, timezone: parsed.timezone, rows: parsed.rows,
    import_spec: parsed.spec, source_sha256: parsed.source_sha256, spec_hash: parsed.spec_hash, metric_snapshot: { summary: parsed.summary }, created_at: new Date() };
  const specification = normalizedAnalysis({ prompt: "Explicitly simulated calculation fixture", snapshot_ids: [dataset.id], date_from: "2026-10-01", date_to: "2026-10-02", timezone: "Asia/Hong_Kong", currency_policy: "group_by_currency", metrics: ["spend", "cpa"], dimensions: ["campaign"], comparison: { date_from: "2026-09-01", date_to: "2026-09-02" } });
  const calculation = calculateAnalysis(randomUUID(), f.project, specification, [dataset]), digest = calculationDigest(calculation);
  assert.ok(calculation.evidence.some(r => r.value?.startsWith("-")));
  const delivery = renderAnalysisDelivery(calculation, { specification, calculation_sha256: digest, title: "Campaign evidence", locale: "en-HK", metrics: ["spend"], scope_ids: calculation.groups.map(v => v.periods.current.id) }, [dataset], "simulated");
  let bytes = delivery.files.find(v => v.name === "analysis.source.json")!.bytes;
  if (corrupt) { const body = JSON.parse(bytes.toString()); body.calculation.evidence[0].value = "999"; bytes = Buffer.from(JSON.stringify(body)); }
  const source = await f.asset("analysis.source.json", bytes, "application/json", { analysis_role_schema: "copypaste-analysis-delivery-1", calculation_sha256: digest, private_note: "DO_NOT_SHARE" }, f.user.id);
  return { source, bytes, delivery };
}
test("explicit publication makes an intact analysis reusable, excludes signed changes, retains missing reasons and produces a real saved chart ZIP", async () => {
  const f = await fixture(), source = await analysisFixture(f);
  assert.equal(ok(await call(f.user, "GET", f.root + "/resources?kind=chart")).items.length, 0);
  const body = { name: "Reviewed analysis.source.json", expected_version: 1 }, key = randomUUID(), path = f.base + "/assets/" + source.source.id + "/publish";
  const published = ok(await call(f.user, "POST", path, body, key)); assert.deepEqual(ok(await call(f.user, "POST", path, body, key)), published);
  const meta = (await s.db.control.query("SELECT metadata FROM asset_versions WHERE id=$1", [published.version.id])).rows[0].metadata;
  assert.equal(meta.private_note, undefined); assert.equal(meta.task_id, undefined); assert.equal(meta.calculation_sha256, JSON.parse(source.bytes.toString()).calculation_sha256);
  const listed = ok(await call(f.user, "GET", f.root + "/resources?kind=chart")); assert.equal(listed.items.length, 1);
  const detail = ok(await call(f.user, "GET", f.root + "/resources/" + published.version.id + "?sha256=" + published.version.sha256));
  assert.ok(detail.unsupported_count > 0); assert.ok(detail.items.some((r: any) => r.value === null && r.null_reason));
  const spend = detail.items.filter((r: any) => r.metric_id === "spend" && JSON.parse(r.scope).period === "current"); assert.equal(spend.length, 2); assert.equal(new Set(spend.map((r: any) => r.series_key)).size, 1);
  assert.ok(spend.some((r: any) => r.label === "Launch" && r.value === "12.34567800"));
  const p = ok(await call(f.user, "POST", f.root, { name: "Evidence presentation", template_id: "performance-review", locale: "en-HK", confirm_project_sharing: true }));
  const project = ok(await call(f.user, "GET", f.root + "/" + p.id));
  project.input.slides[1].scene.layers = [{ kind: "chart", id: "actual_spend", x: 100, y: 100, w: 1200, h: 600, title: "Reviewed spend", color: "#b55f36", source_version_id: published.version.id, sha256: published.version.sha256, evidence_ids: spend.map((r: any) => r.id) }];
  const updated = ok(await call(f.user, "PUT", f.root + "/" + p.id, { name: p.name, expected_version: 1, input: project.input })); assert.equal(updated.version, 2);
  const rendered = ok(await call(f.user, "POST", f.root + "/" + p.id + "/render", { expected_version: 2 }));
  const zip = rendered.files.find((v: any) => v.name.endsWith("editable-design.zip")); assert.ok(zip);
  const downloaded = await call(f.user, "GET", f.base + "/assets/" + zip.asset_id + "/download"); assert.equal(downloaded.status, 200);
  const files = unzipSync(downloaded.raw.rawPayload); assert.ok(files["presentation.pptx"]); assert.match(Buffer.from(files["evidence.csv"]).toString(), /12\.34567800/);
  const before = await counts(f.user.tenant!); assert.equal(before.calls, 0); assert.equal(before.ledger, 0);
  const invalid = structuredClone(project.input); invalid.slides[1].scene.layers[0].evidence_ids.push(detail.items.find((r: any) => r.metric_id === "cpa").id);
  assert.equal((await call(f.user, "PUT", f.root + "/" + p.id, { name: p.name, expected_version: 2, input: invalid })).status, 422);
  assert.equal(ok(await call(f.user, "GET", f.root + "/" + p.id)).current_version, 2); assert.deepEqual(await counts(f.user.tenant!), before);
  await s.db.control.query("UPDATE assets SET state='quarantined' WHERE id=$1", [published.id]);
  assert.equal((await call(f.user, "GET", f.root + "/" + p.id)).status, 404);
});
test("source corruption is rejected atomically; chart scope also separates source platform, timezone, grain and unverified provenance", async () => {
  const f = await fixture(), source = await analysisFixture(f, true), before = await counts(f.user.tenant!);
  assert.equal((await call(f.user, "POST", f.base + "/assets/" + source.source.id + "/publish", { name: "Corrupt calculation", expected_version: 1 })).status, 409);
  assert.equal(ok(await call(f.user, "GET", f.root + "/resources?kind=chart")).items.length, 0); assert.deepEqual(await counts(f.user.tenant!), before);
  const row = { id: randomUUID(), metric_id: "spend", label: "Original", value: "1.00000000", unit: "HKD", null_reason: null, scope: JSON.stringify({ source: "google_ads", timezone: "Asia/Hong_Kong", account_id: "account", currency: "HKD", entity_level: "campaign", dimensions: { campaign: "Launch" } }) };
  for (const patch of [{ source: "meta_ads" }, { timezone: "UTC" }, { entity_level: "ad" }, { unverified_source_snapshot_id: randomUUID() }]) {
    const other = { ...row, id: randomUUID(), scope: JSON.stringify({ ...JSON.parse(row.scope), ...patch }) };
    assert.throws(() => selectDesignEvidence([row, other], [row.id, other.id]));
  }
});
