import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { unzipSync, zipSync } from "fflate";
import { PNG } from "pngjs";
import { PDFDocument } from "pdf-lib";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { historyLogin, type HistoryClient } from "./admin-history-fixture.js";
import { loadConfig } from "../src/config.js";
import { buildApp } from "../src/server.js";
import { saveAsset } from "../src/storage.js";
import { canonical, hash } from "../src/lib.js";
import { vectorInput, slidesInput, editableDesignSchema } from "../src/editable-design-model.js";
import { readDesignSource, readDesignChart } from "../src/editable-design-tools.js";
import { Worker } from "../src/worker.js";
import { CodexRuntimeAdapter, type RuntimeContext, type RuntimeResult } from "../src/runtime.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>;
before(async () => { isolated = await isolatedTestEnvironment(); s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", WORKER_ENABLED: "false", DEV_MAILBOX: "true" }), { worker: false }); });
after(async () => { try { await s?.app.close(); } finally { await isolated?.cleanup(); } });
async function call(c: HistoryClient | null, method: string, url: string, body?: unknown, key = randomUUID()) {
  const raw = await s.app.inject({ method: method as any, url, headers: { origin: s.db.config.WEB_ORIGIN,
    ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf, ...(c.tenant ? { "x-tenant-id": c.tenant } : {}) } : {}), "idempotency-key": key,
    ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
  let data: any = null; try { data = raw.json(); } catch {} return { status: raw.statusCode, data, raw };
}
function ok(r: Awaited<ReturnType<typeof call>>) { assert.ok(r.status >= 200 && r.status < 300, `${r.status} ${JSON.stringify(r.data)}`); return r.data; }
const pixels = (color: string) => { const c = createCanvas(32, 32), g = c.getContext("2d"); g.fillStyle = color; g.fillRect(0, 0, 32, 32); return c.toBuffer("image/png"); };
const counts = async (tenant: string) => (await s.db.control.query(`SELECT (SELECT count(*)::int FROM creative_projects WHERE tenant_id=$1) AS projects,
  (SELECT count(*)::int FROM assets WHERE tenant_id=$1) AS assets,(SELECT count(*)::int FROM ledger WHERE tenant_id=$1) AS ledger,
  (SELECT count(*)::int FROM current_ai_provider_requests WHERE tenant_id=$1) AS model_calls`, [tenant])).rows[0];

async function fixture(kind: "vector" | "presentation" = "presentation", branded = false) {
  const user = await historyLogin(s), w = ok(await call(user, "POST", "/v1/tenants", { name: "Editable studio", project_name: "Original work" }));
  user.tenant = w.tenant.id; const tenant = w.tenant.id as string, sourceId = w.project.id as string,
    targetId = ok(await call(user, "POST", `/v1/tenants/${tenant}/projects`, { name: "Destination work" })).id as string,
    base = `/v1/tenants/${tenant}/projects/${sourceId}`, target = `/v1/tenants/${tenant}/projects/${targetId}`;
  const asset = (project: string, name: string, bytes: Buffer, mime = "image/png", metadata = {}, privateOwner?: string) => s.db.tx(tx => saveAsset(tx, s.storage,
    { tenant, project, user: user.id, name, bytes, mime, metadata, ...(privateOwner ? { privateOwner } : {}) }), tenant, false, user.id);
  const product = await asset(sourceId, "Product.png", pixels("#bcc8d0")), originalLogo = await asset(sourceId, "Original Logo.png", pixels("#15171a")),
    targetLogo = await asset(targetId, "Destination Logo.png", pixels("#2352df"));
  const scope = (campaign: string) => JSON.stringify({ campaign, currency: "HKD", account_id: "source-account", attribution_definition: "7d click", conversion_definition: "Purchase", date_from: "2026-10-01", date_to: "2026-10-02" });
  const rows = [{ id: randomUUID(), metric_id: "spend", label: "Launch", value: "123.450000000001", unit: "HKD", null_reason: null, scope: scope("Launch") },
    { id: randomUUID(), metric_id: "spend", label: "Retargeting", value: null, unit: "HKD", null_reason: "No imported value", scope: scope("Retargeting") }];
  const evidence = await asset(sourceId, "Chart snapshot.json", Buffer.from(JSON.stringify({ schema: "copypaste-imported-design-evidence-1", provenance: "user_attested_import", rows })), "application/json", { design_evidence_provenance: "user_attested_import" });
  const brandDefinition = (destination: boolean) => ({ schema_version: 2, name: destination ? "Destination brand" : "Original brand", colors: destination ? ["#e7eefc", "#2352df", "#15171a"] : ["#f6f6f4", "#15171a"], tone: "Clear and useful",
    font_bindings: [{ key: destination ? "display" : "body", label: "Noto Sans TC", source: { builtin: "noto-sans-tc" }, rights: { source: "Noto project", license: "SIL Open Font License 1.1", channels: ["web"], valid_until: null } }],
    facts: [], logos: [{ key: destination ? "identity" : "mark", asset_id: destination ? targetLogo.id : originalLogo.id, version: 1, usage: "Campaign Logo", min_width: 64, clear_space: 16 }], locales: ["en-HK"], channels: ["web"] });
  const sourceBrand = branded ? ok(await call(user, "POST", base + "/brand/definitions", brandDefinition(false))) : null,
    targetBrand = branded ? ok(await call(user, "POST", target + "/brand/definitions", brandDefinition(true))) : null;
  const scene = { width: 800, height: 600, background: "#f6f6f4", layers: [
    { kind: "text", id: "headline", x: 24, y: 24, w: 560, h: 80, text: "A new chapter.", font_size: 32, weight: 700, color: "#15171a" },
    { kind: "image", id: "product", x: 24, y: 150, w: 250, h: 240, asset_version_id: product.version.id, sha256: product.version.sha256, alt: "Actual product pixels" },
    { kind: "chart", id: "chart", x: 320, y: 150, w: 450, h: 300, source_version_id: evidence.version.id, sha256: evidence.version.sha256, title: "Campaign spend", evidence_ids: rows.map(r => r.id), color: "#2352df" },
    ...(branded ? [{ kind: "image", id: "logo", x: 670, y: 24, w: 96, h: 96, asset_version_id: originalLogo.version.id, sha256: originalLogo.version.sha256, alt: "Original brand Logo" }] : []),
  ] };
  const common = { title: "Campaign review", locale: "en-HK", ...(branded ? { brand: { id: sourceBrand.id, version: 1, channel: "web", locale: "en-HK" } } : {}) },
    input = kind === "vector" ? vectorInput.parse({ ...common, purpose: "Campaign vector", scene }) : slidesInput.parse({ ...common, audience: "Marketing team", decision: "Review campaign", slides: [{ id: "opening", title: "Launch", notes: "Original speaker notes", scene }, { id: "next", title: "Next steps", notes: "Keep both pages", scene: structuredClone(scene) }] });
  const source = await asset(sourceId, kind + ".source.json", Buffer.from(JSON.stringify({ schema: editableDesignSchema, kind, input, input_sha256: hash(canonical(input)), data_mode: "simulated" })), "application/json", { editable_design_schema: editableDesignSchema, design_kind: kind, data_mode: "simulated" });
  const createBody = { name: "Original editable " + kind, source_version_id: source.version.id, sha256: source.version.sha256, confirm_project_sharing: true };
  const key = randomUUID(), original = ok(await call(user, "POST", base + "/editable-projects", createBody, key));
  const archive = async (id = original.id, version = 1, projectBase = base) => { const r = await call(user, "GET", `${projectBase}/creative-project-packages/${id}?expected_version=${version}`); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.raw.rawPayload; };
  const prepare = async (sourceBytes?: Buffer) => {
    const bytes = sourceBytes ?? await archive();
    const upload = await asset(targetId, kind + ".zip", bytes, "application/zip"), selection = { asset_id: upload.id, version: 1, sha256: upload.version.sha256 },
      preview = ok(await call(user, "POST", target + "/creative-project-packages/preview", selection));
    const body: any = { ...selection, name: "Restored " + kind, preview_hash: preview.preview_hash, confirm_project_sharing: true, confirm_media_rights: true, confirm_imported_evidence: true };
    if (branded) { const brand_target = { binding: { id: targetBrand.id, version: 1, channel: "web", locale: "en-HK" }, fonts: [{ source_key: "body", target_key: "display" }], facts: [], logos: [{ source_key: "mark", target_key: "identity" }], colors: [{ from: "#f6f6f4", to: "#e7eefc" }] };
      const review = ok(await call(user, "POST", target + "/creative-project-packages/brand-preview", { ...selection, brand_target }));
      Object.assign(body, { brand_target, brand_review_hash: review.review_hash, confirm_brand_review: true }); }
    return { upload, selection, preview, body };
  };
  return { user, tenant, sourceId, targetId, base, target, asset, product, evidence, rows, input, source, original, createBody, key, archive, prepare, sourceBrand, targetBrand, targetLogo };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function detail(f: Fixture, id = f.original.id, base = f.base, version?: number) { return ok(await call(f.user, "GET", `${base}/editable-projects/${id}${version ? "?version=" + version : ""}`)); }
async function download(f: Fixture, file: any, base = f.base) { const r = await call(f.user, "GET", `${base}/assets/${file.asset_id}/download`); assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(hash(r.raw.rawPayload), file.sha256); return r.raw.rawPayload; }

for (const kind of ["vector", "presentation"] as const) test(`${kind}: real fixed source creates a shared workspace, version history and actual editable image/chart deliverables`, async () => {
  const f = await fixture(kind), before = await counts(f.tenant);
  assert.deepEqual(ok(await call(f.user, "POST", f.base + "/editable-projects", f.createBody, f.key)), f.original);
  assert.equal(ok(await call(f.user, "GET", f.base + "/editable-projects/requests/" + f.key + "?operation=create")).result.id, f.original.id);
  assert.ok(ok(await call(f.user, "GET", f.base + "/editable-projects/sources")).items.some((v: any) => v.source_version_id === f.source.version.id));
  const p = await detail(f), input = structuredClone(p.input), scene = kind === "vector" ? input.scene : input.slides[0].scene;
  scene.layers[0].text = "Revised and ready."; if (kind === "presentation") { input.slides.reverse(); input.slides[0].notes = "Edited notes"; }
  const update = { name: "Edited campaign", expected_version: 1, input }, updateKey = randomUUID(), saved = ok(await call(f.user, "PUT", `${f.base}/editable-projects/${p.id}`, update, updateKey)); assert.equal(saved.version, 2);
  assert.deepEqual(ok(await call(f.user, "PUT", `${f.base}/editable-projects/${p.id}`, update, updateKey)), saved);
  assert.equal((await call(f.user, "PUT", `${f.base}/editable-projects/${p.id}`, update)).status, 409);
  assert.deepEqual((await detail(f, p.id, f.base, 1)).input, f.input); assert.deepEqual((await detail(f)).input, input);
  for (const version of [1, 2]) { const preview = ok(await call(f.user, "GET", `${f.base}/editable-projects/${p.id}/preview?version=${version}&page=1`));
    assert.equal(hash(Buffer.from(preview.base64, "base64")), preview.sha256); const image = PNG.sync.read(Buffer.from(preview.base64, "base64")); assert.equal(image.width, 800); }
  const renderKey = randomUUID(), rendered = ok(await call(f.user, "POST", `${f.base}/editable-projects/${p.id}/render`, { expected_version: 2 }, renderKey));
  assert.deepEqual(ok(await call(f.user, "POST", `${f.base}/editable-projects/${p.id}/render`, { expected_version: 2 }, renderKey)), rendered);
  assert.equal(rendered.data_provenance, "user_attested_import");
  const file = (suffix: string) => { const file = rendered.files.find((v: any) => v.name.endsWith(suffix)); assert.ok(file, suffix); return file; };
  const png = PNG.sync.read(await download(f, file(".png"))); assert.deepEqual([...png.data.subarray((200 * png.width + 100) * 4, (200 * png.width + 100) * 4 + 4)], [188, 200, 208, 255]);
  assert.equal((await PDFDocument.load(await download(f, file("review.pdf")))).getPageCount(), kind === "vector" ? 1 : 2);
  assert.match((await download(f, file("evidence.csv"))).toString(), /123\.450000000001/);
  if (kind === "presentation") { const parts = unzipSync(await download(f, file("presentation.pptx"))); assert.ok(parts["ppt/slides/slide2.xml"]); assert.match(Buffer.from(parts["ppt/notesSlides/notesSlide1.xml"]).toString(), /Edited notes/); }
  const zipped = unzipSync(await download(f, file("editable-design.zip"))); assert.ok(zipped["manifest.json"]); assert.ok(zipped["fonts/CopyPasteSansTC-Regular.ttf"]);
  const after = await counts(f.tenant); assert.equal(after.projects, before.projects); assert.equal(after.ledger, before.ledger); assert.equal(after.model_calls, before.model_calls);
});

for (const kind of ["vector", "presentation"] as const) test(`${kind}: portable ZIP preserves exact imagery, all fonts, pages, notes and chart precision, restores new IDs and supports another saved delivery`, async () => {
  const f = await fixture(kind), bytes = await f.archive(), files = unzipSync(bytes), manifest = JSON.parse(Buffer.from(files["manifest.json"]).toString());
  assert.ok(files["fonts/NotoSansTC-VF.ttf"] && files["fonts/CopyPasteSansTC-Regular.ttf"] && files["fonts/CopyPasteSansTC-Bold.ttf"] && files["fonts/OFL.txt"]);
  assert.equal(Object.keys(files).filter(v => v.startsWith("previews/")).length, kind === "vector" ? 1 : 2);
  const media = manifest.media.find((m: any) => m.mime_type === "image/png"); assert.deepEqual(Buffer.from(files[media.path]), pixels("#bcc8d0"));
  const prepared = await f.prepare(bytes); assert.equal(prepared.preview.evidence_rows.length, 2); assert.equal(prepared.preview.evidence_rows[0].value, "123.450000000001");
  const before = await counts(f.tenant), key = randomUUID(), restored = ok(await call(f.user, "POST", f.target + "/creative-project-packages/restore", prepared.body, key));
  assert.notEqual(restored.id, f.original.id); assert.equal(restored.imported_assets, 2);
  assert.deepEqual(ok(await call(f.user, "POST", f.target + "/creative-project-packages/restore", prepared.body, key)), restored);
  const p = await detail(f, restored.id, f.target), scene = kind === "vector" ? p.input.scene : p.input.slides[0].scene, chart = scene.layers.find((l: any) => l.kind === "chart");
  assert.equal(p.imported_evidence, true); assert.notEqual(chart.source_version_id, f.evidence.version.id); assert.ok(chart.evidence_ids.every((id: string) => !f.rows.some(r => r.id === id)));
  if (kind === "presentation") assert.equal(p.input.slides[1].notes, "Keep both pages");
  const t = { id: randomUUID(), tenant_id: f.tenant, project_id: f.targetId, created_by: f.user.id, private_owner: null, status: "queued" };
  const read = await s.db.tx(tx => readDesignChart(tx, s.storage, t, { source_version_id: chart.source_version_id, offset: 0 }), f.tenant, false, f.user.id);
  assert.equal(read.data_provenance, "user_attested_import"); assert.equal(read.evidence[0].value, f.rows[0].value); assert.equal(read.evidence[1].value, null);
  scene.layers[0].text = "A restored new version."; ok(await call(f.user, "PUT", `${f.target}/editable-projects/${p.id}`, { name: "Restored edited", expected_version: 1, input: p.input }));
  const delivery = ok(await call(f.user, "POST", `${f.target}/editable-projects/${p.id}/render`, { expected_version: 2 }));
  const source = delivery.files.find((v: any) => v.name.endsWith(".source.json")), parsed = await s.db.tx(tx => readDesignSource(tx, s.storage, t, source.asset_version_id, source.sha256), f.tenant, false, f.user.id);
  assert.equal(parsed.kind, kind); assert.ok(await f.archive(p.id, 2, f.target));
  await s.db.control.query("UPDATE assets SET state='quarantined' WHERE id=ANY($1::uuid[])", [[f.product.id, f.evidence.id, prepared.upload.id]]);
  assert.equal((await call(f.user, "GET", `${f.target}/editable-projects/${p.id}/preview?version=2&page=1`)).status, 200, "Restored inputs are independent new copies");
  const after = await counts(f.tenant); assert.equal(after.projects - before.projects, 1); assert.equal(after.model_calls, before.model_calls); assert.equal(after.ledger, before.ledger);
});

test("destination brand mapping is explicit for every page, preserves literal copy, replaces only authorized Logo/color and never imports old brand authority", async () => {
  const f = await fixture("presentation", true), prepared = await f.prepare(), body = prepared.body, before = await counts(f.tenant);
  assert.equal(prepared.preview.brand_requirements.texts.length, 2); assert.equal(prepared.preview.brand_requirements.logos.length, 2);
  for (const invalid of [{ ...body, brand_target: undefined }, { ...body, confirm_brand_review: undefined }, { ...body, brand_review_hash: "0".repeat(64) }]) {
    assert.ok([409, 422].includes((await call(f.user, "POST", f.target + "/creative-project-packages/restore", invalid)).status)); assert.deepEqual(await counts(f.tenant), before);
  }
  const restored = ok(await call(f.user, "POST", f.target + "/creative-project-packages/restore", body)), p = await detail(f, restored.id, f.target);
  assert.equal(restored.reused_brand_assets, 1); assert.equal(p.input.brand.id, f.targetBrand.id); assert.notEqual(p.input.brand.id, f.sourceBrand.id);
  for (const slide of p.input.slides) { assert.equal(slide.scene.background, "#e7eefc"); assert.equal(slide.scene.layers[0].text, "A new chapter."); assert.equal(slide.scene.layers[3].asset_version_id, f.targetLogo.version.id); }
  const rendered = ok(await call(f.user, "POST", `${f.target}/editable-projects/${p.id}/render`, { expected_version: 1 })), image = PNG.sync.read(await download(f, rendered.files.find((v: any) => v.name.endsWith(".png")), f.target));
  assert.deepEqual([...image.data.subarray((50 * image.width + 700) * 4, (50 * image.width + 700) * 4 + 4)], [35, 82, 223, 255]);
  const roundTrip = JSON.parse(Buffer.from(unzipSync(await f.archive(p.id, 1, f.target))["manifest.json"]).toString()); assert.equal(roundTrip.brand_requirements.source_name, "Destination brand");
});

test("imported data acknowledgement, exact source version, sharing consent, incompatible data scopes and unknown evidence are enforced before writes", async () => {
  const f = await fixture(), prepared = await f.prepare(), before = await counts(f.tenant);
  for (const body of [{ ...prepared.body, confirm_imported_evidence: undefined }, { ...prepared.body, confirm_media_rights: false }, { ...prepared.body, preview_hash: "0".repeat(64) }]) {
    const response = await call(f.user, "POST", f.target + "/creative-project-packages/restore", body); assert.ok([409, 422].includes(response.status), `${response.status} ${JSON.stringify(response.data)}`); assert.deepEqual(await counts(f.tenant), before);
  }
  assert.equal((await call(f.user, "POST", f.base + "/editable-projects", { ...f.createBody, sha256: "0".repeat(64) })).status, 409);
  assert.equal((await call(f.user, "POST", f.base + "/editable-projects", { ...f.createBody, confirm_project_sharing: false })).status, 422);
  const input: any = structuredClone(f.input); input.slides[0].scene.layers[2].evidence_ids = [randomUUID()];
  assert.equal((await call(f.user, "PUT", `${f.base}/editable-projects/${f.original.id}`, { name: "Invalid evidence", expected_version: 1, input })).status, 422);
  assert.equal((await detail(f)).version, 1); assert.deepEqual(await counts(f.tenant), before);
});

test("a self-consistent malicious archive still cannot replace the pinned font, omit chart values, forge media roles or traverse paths", async () => {
  const f = await fixture(), original = unzipSync(await f.archive());
  for (const mutate of [(files: any, m: any) => { files["fonts/OFL.txt"] = Buffer.from("Forged font license"); },
    (files: any, m: any) => { const media = m.media.find((v: any) => v.mime_type === "application/json"), data = JSON.parse(Buffer.from(files[media.path]).toString()); data.rows.pop(); files[media.path] = Buffer.from(JSON.stringify(data)); },
    (files: any, m: any) => { m.media.find((v: any) => v.mime_type === "application/json").mime_type = "image/png"; },
    (files: any, m: any) => { files["../escape.txt"] = Buffer.from("Escape"); }]) {
    const files: any = { ...original }, m = JSON.parse(Buffer.from(files["manifest.json"]).toString()); mutate(files, m);
    for (const file of m.files) if (files[file.path]) { file.bytes = files[file.path].length; file.sha256 = hash(files[file.path]); }
    files["manifest.json"] = Buffer.from(JSON.stringify(m)); files["SHA256SUMS"] = Buffer.from([...m.files.map((v: any) => `${v.sha256}  ${v.path}`), `${hash(files["manifest.json"])}  manifest.json`, ""].join("\n"));
    const upload = await f.asset(f.targetId, "Invalid.zip", Buffer.from(zipSync(files, { level: 0 })), "application/zip"), before = await counts(f.tenant),
      result = await call(f.user, "POST", f.target + "/creative-project-packages/preview", { asset_id: upload.id, version: 1, sha256: upload.version.sha256 });
    assert.equal(result.status, 422, JSON.stringify(result.data)); assert.deepEqual(await counts(f.tenant), before);
  }
});

test("tenant boundaries, viewer access and private asset exclusion apply to creation, history, preview, render and receipts", async () => {
  const f = await fixture("vector"), stranger = await historyLogin(s);
  for (const suffix of ["", "/sources", "/" + f.original.id, "/" + f.original.id + "/preview?version=1", "/requests/" + f.key + "?operation=create"])
    assert.equal((await call(stranger, "GET", f.base + "/editable-projects" + suffix)).status, 404);
  assert.equal((await call(null, "GET", f.base + "/editable-projects")).status, 401);
  const viewer = await historyLogin(s); viewer.tenant = f.tenant;
  await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role,status) VALUES($1,$2,'viewer','active')", [f.tenant, viewer.id]);
  await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'viewer')", [f.tenant, f.sourceId, viewer.id]);
  assert.equal(ok(await call(viewer, "GET", f.base + "/editable-projects")).can_write, false);
  assert.equal((await call(viewer, "GET", `${f.base}/editable-projects/${f.original.id}/preview?version=1`)).status, 200);
  assert.equal((await call(viewer, "POST", f.base + "/editable-projects", f.createBody)).status, 403);
  assert.equal((await call(viewer, "POST", `${f.base}/editable-projects/${f.original.id}/render`, { expected_version: 1 })).status, 403);
  const privateSource = await f.asset(f.sourceId, "Private source.json", Buffer.from(JSON.stringify({ schema: editableDesignSchema, kind: "vector", input: f.input, input_sha256: hash(canonical(f.input)), data_mode: "simulated" })), "application/json", { editable_design_schema: editableDesignSchema, design_kind: "vector", data_mode: "simulated" }, f.user.id);
  assert.equal((await call(f.user, "POST", f.base + "/editable-projects", { ...f.createBody, source_version_id: privateSource.version.id, sha256: privateSource.version.sha256 })).status, 404);
});

test("quarantined sources and projects hide delivery bytes, invalidate result receipts, prevent repeat creation and leave immutable versions intact", async () => {
  const f = await fixture("vector"), key = randomUUID(), rendered = ok(await call(f.user, "POST", `${f.base}/editable-projects/${f.original.id}/render`, { expected_version: 1 }, key)), file = rendered.files[0];
  await assert.rejects(s.db.control.query("UPDATE editable_project_versions SET input='{}' WHERE creative_id=$1", [f.original.id]), /immutable/);
  await s.db.control.query("UPDATE assets SET state='quarantined' WHERE id=$1", [f.evidence.id]);
  assert.equal((await call(f.user, "GET", `${f.base}/assets/${file.asset_id}/download`)).status, 404);
  assert.equal(ok(await call(f.user, "GET", `${f.base}/editable-projects/requests/${key}?operation=render`)).state, "removed");
  const before = await counts(f.tenant); assert.equal((await call(f.user, "POST", `${f.base}/editable-projects/${f.original.id}/render`, { expected_version: 1 }, key)).status, 410);
  assert.equal(ok(await call(f.user, "GET", `${f.base}/editable-projects/requests/${f.key}?operation=create`)).state, "removed");
  assert.equal((await call(f.user, "POST", f.base + "/editable-projects", f.createBody, f.key)).status, 410); assert.deepEqual(await counts(f.tenant), before);
  await s.db.control.query("UPDATE assets SET state='active' WHERE id=$1", [f.evidence.id]); await s.db.control.query("UPDATE creative_projects SET content_state='quarantined' WHERE id=$1", [f.original.id]);
  assert.equal((await call(f.user, "GET", `${f.base}/assets/${file.asset_id}/download`)).status, 404);
});

test("brand withdrawal between reviewed restore and write prevents partial projects or assets", async () => {
  const f = await fixture("vector", true), p = await f.prepare(), before = await counts(f.tenant);
  await s.db.control.query("UPDATE brand_profiles SET content_state='quarantined' WHERE id=$1", [f.targetBrand.id]);
  assert.equal((await call(f.user, "POST", f.target + "/creative-project-packages/restore", p.body)).status, 409);
  assert.deepEqual(await counts(f.tenant), before);
});

test("the actual presentation specialist reads restored chart values and emits another editable PPTX with explicit imported-data provenance", async () => {
  const f = await fixture(), p = await f.prepare(), restored = ok(await call(f.user, "POST", f.target + "/creative-project-packages/restore", p.body)), d = await detail(f, restored.id, f.target);
  // A project-shared independent copy is now available to the normal company tools.
  delete d.input.brand;
  ok(await call(f.user, "POST", `/v1/tenants/${f.tenant}/demo-credit`, {}));
  const template = ok(await call(f.user, "GET", "/v1/agent-templates?limit=30")).items.find((v: any) => v.role_key === "presentation"); assert.ok(template);
  const args = { project_id: f.targetId, template_version: template.version };
  ok(await call(f.user, "POST", `/v1/agent-templates/${template.id}/preflights`, args));
  const agent = ok(await call(f.user, "POST", `/v1/agent-templates/${template.id}/instances`, args)), conversation = ok(await call(f.user, "POST", f.target + "/conversations", { name: "Restored chart revision", agent_id: agent.id }));
  const accepted = ok(await call(f.user, "POST", `${f.target}/conversations/${conversation.id}/messages`, { body: "Revise the imported campaign slides, retaining exact chart values.", expected_version: 1, intent: "delegate", mode: "execute", budget_micros: 1000000, client_message_id: randomUUID() }));
  let failure: unknown, result: any;
  class Runtime extends CodexRuntimeAdapter {
    override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
      try { const tool = (name: string) => { const t = ctx.tools.find(t => t.name === name); assert.ok(t, name); return t; }, chart = d.input.slides[0].scene.layers.find((l: any) => l.kind === "chart"),
        facts: any = await tool("design_chart_read").run({ source_version_id: chart.source_version_id, offset: 0 }, randomUUID());
        assert.equal(facts.data_provenance, "user_attested_import"); assert.equal(facts.evidence[0].value, "123.450000000001");
        const prepared: any = await tool("slides_build").run(d.input, randomUUID()); result = await tool("slides_render").run({ source_version_id: prepared.source_version_id, sha256: prepared.sha256 }, randomUUID());
      } catch (e) { failure = e; throw e; }
      return { status: "completed", text: "Synthetic model; actual restored-chart PPTX delivered.", inputTokens: 20, outputTokens: 10, usageKnown: true, accepted: true, thread: "editable-import", turn: randomUUID() };
    }
  }
  await new Worker(s.db, s.catalog, s.storage, new Runtime(s.db.config)).run(f.tenant, accepted.task.id); if (failure) throw failure;
  assert.equal(result.data_provenance, "user_attested_import"); assert.ok(result.files.some((v: any) => v.filename === "presentation.pptx"));
});
