import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { unzipSync, zipSync } from "fflate";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { historyLogin, type HistoryClient } from "./admin-history-fixture.js";
import { loadConfig } from "../src/config.js";
import { buildApp } from "../src/server.js";
import { saveAsset } from "../src/storage.js";
import { hash } from "../src/lib.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>;
before(async () => { isolated = await isolatedTestEnvironment(); s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", WORKER_ENABLED: "false", DEV_MAILBOX: "true" }), { worker: false }); });
after(async () => { try { await s?.app.close(); } finally { await isolated?.cleanup(); } });
async function call(c: HistoryClient | null, method: string, url: string, body?: unknown, key = randomUUID()) {
  const raw = await s.app.inject({ method: method as any, url, headers: { origin: s.db.config.WEB_ORIGIN,
    ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf, ...(c.tenant ? { "x-tenant-id": c.tenant } : {}) } : {}),
    "idempotency-key": key, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
  let data: any = null; try { data = raw.json(); } catch {}
  return { status: raw.statusCode, data, raw };
}
function ok(r: Awaited<ReturnType<typeof call>>) { assert.ok(r.status >= 200 && r.status < 300, `${r.status} ${JSON.stringify(r.data)}`); return r.data; }
const image = (color: string) => { const c = createCanvas(64, 64), g = c.getContext("2d"); g.fillStyle = color; g.fillRect(0, 0, 64, 64); return c.toBuffer("image/png"); };
async function fixture(options: { expiredFont?: boolean; expiredFact?: boolean; logoWidth?: number } = {}) {
  const user = await historyLogin(s), w = ok(await call(user, "POST", "/v1/tenants", { name: "Brand restore studio", project_name: "Original campaign" }));
  user.tenant = w.tenant.id; const destination = ok(await call(user, "POST", `/v1/tenants/${w.tenant.id}/projects`, { name: "Destination campaign" }));
  const tenant = w.tenant.id as string, sourceId = w.project.id as string, targetId = destination.id as string,
    base = `/v1/tenants/${tenant}/projects/${sourceId}`, target = `/v1/tenants/${tenant}/projects/${targetId}`;
  const asset = async (project: string, name: string, bytes: Buffer, mime = "image/png") => s.db.tx(tx => saveAsset(tx, s.storage,
    { tenant, project, user: user.id, name, mime, bytes }), tenant, false, user.id);
  const originalLogo = await asset(sourceId, "Original Logo.png", image("#15171a")), product = await asset(sourceId, "Product.png", image("#bcc8d0")),
    targetLogo = await asset(targetId, "Target Logo.png", image("#2352df"));
  const definition = (isTarget: boolean) => ({ schema_version: 2, name: isTarget ? "Destination brand" : "Original brand", colors: isTarget ? ["#e7eefc", "#2352df", "#15171a"] : ["#f6f6f4", "#15171a"], tone: "Clear and useful",
    font_bindings: [{ key: isTarget ? "display" : "body", label: "Noto Sans TC", source: { builtin: "noto-sans-tc" }, rights: { source: "Noto project", license: "SIL Open Font License 1.1", channels: ["web"], valid_until: isTarget && options.expiredFont ? "2000-01-01T00:00:00Z" : null } }],
    facts: [{ key: isTarget ? "offer" : "price", kind: "price", text: isTarget ? "New season" : "Launch offer", amount_minor: isTarget ? 19800 : 12800, currency: "HKD",
      valid_until: isTarget && options.expiredFact ? "2000-01-01T00:00:00Z" : null }],
    logos: [{ key: isTarget ? "identity" : "mark", asset_id: isTarget ? targetLogo.id : originalLogo.id, version: 1, usage: "Campaign Logo", min_width: isTarget ? options.logoWidth ?? 64 : 64, clear_space: 16 }], locales: ["en-HK", "zh-Hant-HK"], channels: ["web"] });
  const sourceBrand = ok(await call(user, "POST", base + "/brand/definitions", definition(false))), targetBrand = ok(await call(user, "POST", target + "/brand/definitions", definition(true)));
  const body = { width: 640, height: 800, background: "#f6f6f4", brand: { id: sourceBrand.id, version: 1, channel: "web", locale: "en-HK" }, layers: [
    { type: "image", asset_id: originalLogo.id, version: 1, x: 32, y: 32, width: 96, height: 96 },
    { type: "image", asset_id: product.id, version: 1, x: 32, y: 150, width: 576, height: 350 },
    { type: "text", text: "Old literal price must be resolved", font_key: "body", fact_key: "price", x: 32, y: 570, font_size: 26, color: "#15171a" },
    { type: "text", text: "MAKE SPACE FOR MORE.", font_key: "body", x: 32, y: 640, font_size: 22, color: "#15171a" }] };
  const original = ok(await call(user, "POST", base + "/creative", { name: "Original brand canvas", body }));
  const exported = await call(user, "GET", `${base}/creative-project-packages/${original.id}?expected_version=1`); assert.equal(exported.status, 200, JSON.stringify(exported.data));
  const bytes = exported.raw.rawPayload, archive = await asset(targetId, "Brand source.zip", bytes, "application/zip"), selection = { asset_id: archive.id, version: 1, sha256: archive.version.sha256 };
  const preview = ok(await call(user, "POST", target + "/creative-project-packages/preview", selection)), brandTarget = {
    binding: { id: targetBrand.id, version: 1, channel: "web", locale: "en-HK" }, fonts: [{ source_key: "body", target_key: "display" }], facts: [{ source_key: "price", target_key: "offer" }],
    logos: [{ source_key: "mark", target_key: "identity" }], colors: [{ from: "#f6f6f4", to: "#e7eefc" }] };
  const review = () => call(user, "POST", target + "/creative-project-packages/brand-preview", { ...selection, brand_target: brandTarget });
  const restoreBody = (r: any) => ({ ...selection, name: "Restored destination campaign", preview_hash: preview.preview_hash, confirm_project_sharing: true, confirm_media_rights: true,
    brand_target: brandTarget, brand_review_hash: r.review_hash, confirm_brand_review: true });
  return { user, tenant, sourceId, targetId, base, target, asset, sourceBrand, targetBrand, targetLogo, product, original, bytes, selection, preview, brandTarget, review, restoreBody };
}
const counts = async (tenant: string) => (await s.db.control.query(`SELECT (SELECT count(*)::int FROM creative_projects WHERE tenant_id=$1) AS projects,
  (SELECT count(*)::int FROM assets WHERE tenant_id=$1) AS assets,(SELECT count(*)::int FROM ledger WHERE tenant_id=$1) AS ledger,
  (SELECT count(*)::int FROM current_ai_provider_requests WHERE tenant_id=$1) AS model_calls`, [tenant])).rows[0];

test("brand canvas ZIP contains exact source declarations, resolved facts and outlined source preview without granting old brand authority", async () => {
  const f = await fixture(), files = unzipSync(f.bytes), manifest = JSON.parse(Buffer.from(files["manifest.json"]).toString());
  assert.equal(manifest.brand_requirements.source_name, "Original brand"); assert.equal(manifest.brand_requirements.texts.length, 2);
  assert.match(manifest.brand_requirements.texts[0].resolved_text, /128\.00/); assert.deepEqual(manifest.brand_requirements.logos, [{ layer: 0, key: "mark" }]);
  assert.equal(manifest.renderer_profile.renderer, "poster-brand-outlines-1");
  const svg = Buffer.from(files["preview.svg"]).toString(); assert.ok(svg.includes("<path")); assert.ok(!svg.includes("<text")); assert.ok(svg.includes("media/001.png"));
  assert.deepEqual(f.preview.brand_design_colors.sort(), ["#15171a", "#f6f6f4"].sort());
});

test("explicit mappings create a new target-bound editable canvas, reuse authorized Logo, render PNG/PDF/SVG and re-export", async () => {
  const f = await fixture(), review = ok(await f.review()); assert.match(review.texts[0].after, /198\.00/); assert.equal(review.texts[0].target_font_key, "display");
  const before = await counts(f.tenant), key = randomUUID(), restored = ok(await call(f.user, "POST", f.target + "/creative-project-packages/restore", f.restoreBody(review), key));
  assert.equal(restored.imported_assets, 1); assert.equal(restored.reused_brand_assets, 1); assert.notEqual(restored.id, f.original.id);
  assert.deepEqual(ok(await call(f.user, "POST", f.target + "/creative-project-packages/restore", f.restoreBody(review), key)), restored);
  assert.equal(ok(await call(f.user, "GET", f.target + "/creative-project-packages/requests/" + key)).result.id, restored.id);
  const current = ok(await call(f.user, "GET", f.target + "/creative")).items.find((v: any) => v.id === restored.id);
  assert.equal(current.body.brand.id, f.targetBrand.id); assert.equal(current.body.layers[0].asset_id, f.targetLogo.id); assert.notEqual(current.body.layers[1].asset_id, f.product.id);
  assert.equal(current.body.layers[2].fact_key, "offer"); assert.match(current.body.layers[2].text, /198\.00/); assert.equal(current.body.background, "#e7eefc");
  current.body.layers[3].text = "Restored and edited.";
  ok(await call(f.user, "PUT", f.target + "/creative/" + restored.id, { name: "Edited target campaign", version: 1, body: current.body }));
  for (const format of ["png", "pdf", "svg"]) {
    const rendered = ok(await call(f.user, "POST", `${f.target}/creative/${restored.id}/render`, { expected_version: 2, format })),
      download = await call(f.user, "GET", `${f.target}/assets/${rendered.id}/download`);
    assert.equal(download.status, 200); const data = download.raw.rawPayload;
    if (format === "png") assert.equal(data.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    if (format === "pdf") assert.equal(data.subarray(0, 4).toString(), "%PDF");
    if (format === "svg") assert.ok(!data.toString().includes("<text"));
  }
  const again = await call(f.user, "GET", `${f.target}/creative-project-packages/${restored.id}?expected_version=2`); assert.equal(again.status, 200);
  const manifest = JSON.parse(Buffer.from(unzipSync(again.raw.rawPayload)["manifest.json"]).toString()); assert.equal(manifest.brand_requirements.source_name, "Destination brand");
  const original = ok(await call(f.user, "GET", f.base + "/creative")).items.find((v: any) => v.id === f.original.id); assert.equal(original.version, 1); assert.equal(original.body.brand.id, f.sourceBrand.id);
  const after = await counts(f.tenant); assert.equal(after.projects - before.projects, 1); assert.equal(after.assets - before.assets, 4); assert.equal(after.model_calls, before.model_calls); assert.equal(after.ledger, before.ledger);
});

test("a source brand ID, omitted review or forged review hash cannot bind destination content or create source assets", async () => {
  const f = await fixture(), review = ok(await f.review()), before = await counts(f.tenant), body = f.restoreBody(review);
  for (const invalid of [{ ...body, brand_target: undefined }, { ...body, confirm_brand_review: undefined }, { ...body, brand_review_hash: "0".repeat(64) }]) {
    const r = await call(f.user, "POST", f.target + "/creative-project-packages/restore", invalid); assert.ok([409, 422].includes(r.status), JSON.stringify(r.data));
  }
  const cross = await call(f.user, "POST", f.target + "/creative-project-packages/brand-preview", { ...f.selection, brand_target: { ...f.brandTarget, binding: { ...f.brandTarget.binding, id: f.sourceBrand.id } } });
  assert.equal(cross.status, 409); assert.deepEqual(await counts(f.tenant), before);
});

test("missing, duplicate, unknown-field and unapproved-color mappings fail before restoring content", async () => {
  const f = await fixture(), before = await counts(f.tenant);
  for (const target of [{ ...f.brandTarget, fonts: [] }, { ...f.brandTarget, facts: [...f.brandTarget.facts, ...f.brandTarget.facts] },
    { ...f.brandTarget, logos: [{ source_key: "mark", target_key: "unknown" }] }, { ...f.brandTarget, colors: [{ from: "#f6f6f4", to: "#ff0000" }] }]) {
    const r = await call(f.user, "POST", f.target + "/creative-project-packages/brand-preview", { ...f.selection, brand_target: target });
    assert.equal(r.status, 422, JSON.stringify(r.data)); assert.equal(r.data.code ?? r.data.error?.code, "PACKAGE_BRAND_MAPPING_INVALID");
  }
  assert.deepEqual(await counts(f.tenant), before);
});

test("expired target font usage, expired facts and destination Logo layout are enforced", async () => {
  for (const options of [{ expiredFont: true }, { expiredFact: true }, { logoWidth: 128 }]) {
    const f = await fixture(options), before = await counts(f.tenant), r = await f.review();
    assert.equal(r.status, 422, JSON.stringify(r.data)); assert.ok(["BRAND_FONT_USAGE_DENIED", "BRAND_FACT_UNAVAILABLE", "BRAND_LOGO_LAYOUT_INVALID"].includes(r.data.code ?? r.data.error?.code));
    assert.deepEqual(await counts(f.tenant), before);
  }
});

test("brand withdrawal between review and restore is rechecked; completed receipts never recreate removed output", async () => {
  const f = await fixture(), review = ok(await f.review()), before = await counts(f.tenant);
  await s.db.control.query("UPDATE brand_profiles SET content_state='quarantined' WHERE id=$1", [f.targetBrand.id]);
  assert.equal((await call(f.user, "POST", f.target + "/creative-project-packages/restore", f.restoreBody(review))).status, 409); assert.deepEqual(await counts(f.tenant), before);
  await s.db.control.query("UPDATE brand_profiles SET content_state='active' WHERE id=$1", [f.targetBrand.id]);
  const key = randomUUID(), result = ok(await call(f.user, "POST", f.target + "/creative-project-packages/restore", f.restoreBody(review), key));
  await s.db.control.query("UPDATE creative_projects SET retention_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [result.id]);
  assert.equal(ok(await call(f.user, "GET", f.target + "/creative-project-packages/requests/" + key)).state, "removed");
  const after = await counts(f.tenant); assert.equal((await call(f.user, "POST", f.target + "/creative-project-packages/restore", f.restoreBody(review), key)).status, 410); assert.deepEqual(await counts(f.tenant), after);
});

test("destination project permissions govern brand lists, reviews and restore; archived brand declarations cannot supply authority", async () => {
  const f = await fixture(), stranger = await historyLogin(s), before = await counts(f.tenant);
  for (const route of ["brand-options", `requests/${randomUUID()}`]) assert.equal((await call(stranger, "GET", f.target + "/creative-project-packages/" + route)).status, 404);
  assert.equal((await call(stranger, "POST", f.target + "/creative-project-packages/brand-preview", { ...f.selection, brand_target: f.brandTarget })).status, 404);
  assert.equal((await call(null, "GET", f.target + "/creative-project-packages/brand-options")).status, 401);
  const options = ok(await call(f.user, "GET", f.target + "/creative-project-packages/brand-options")); assert.equal(options.items.length, 1); assert.equal(options.items[0].brand_id, f.targetBrand.id);
  assert.deepEqual(await counts(f.tenant), before);
});

test("omitted or mismatched brand layer declarations are rejected even when the ZIP's own checksums are recomputed", async () => {
  const f = await fixture();
  for (const mutation of [(m: any) => { delete m.brand_requirements; }, (m: any) => { m.brand_requirements.texts[0].layer = 0; }]) {
    const files = unzipSync(f.bytes), manifest = JSON.parse(Buffer.from(files["manifest.json"]).toString()); mutation(manifest);
    files["manifest.json"] = Buffer.from(JSON.stringify(manifest));
    files["SHA256SUMS"] = Buffer.from(Object.entries(files).filter(([name]) => name !== "SHA256SUMS").map(([name, data]) => `${hash(Buffer.from(data))}  ${name}`).join("\n") + "\n");
    const archive = await f.asset(f.targetId, "Invalid declarations.zip", Buffer.from(zipSync(files, { level: 0 })), "application/zip"), before = await counts(f.tenant),
      r = await call(f.user, "POST", f.target + "/creative-project-packages/preview", { asset_id: archive.id, version: 1, sha256: archive.version.sha256 });
    assert.equal(r.status, 422, JSON.stringify(r.data)); assert.deepEqual(await counts(f.tenant), before);
  }
});
