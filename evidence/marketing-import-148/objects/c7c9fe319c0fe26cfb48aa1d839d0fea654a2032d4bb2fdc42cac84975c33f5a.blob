import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { unzipSync, zipSync } from "fflate";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { historyLogin, type HistoryClient } from "./admin-history-fixture.js";
import { loadConfig } from "../src/config.js";
import { buildApp } from "../src/server.js";
import { saveAsset } from "../src/storage.js";
import { advanceVideoProjects } from "../src/video-projects.js";
import { videoDefinition } from "../src/video-project-model.js";
import { hash } from "../src/lib.js";
import { readCreativePackage } from "../src/creative-package-reader.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, system: Awaited<ReturnType<typeof buildApp>>;
before(async () => { isolated = await isolatedTestEnvironment(); system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", WORKER_ENABLED: "false", DEV_MAILBOX: "true" }), { worker: false }); });
after(async () => { try { await system?.app.close(); } finally { await isolated?.cleanup(); } });
async function call(c: HistoryClient | null, method: string, url: string, body?: unknown, requestKey = randomUUID()) {
  const raw = await system.app.inject({ method: method as any, url, headers: { origin: system.db.config.WEB_ORIGIN,
    ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf, ...(c.tenant ? { "x-tenant-id": c.tenant } : {}) } : {}), "idempotency-key": requestKey },
    ...(body === undefined ? {} : { payload: JSON.stringify(body), headers: { origin: system.db.config.WEB_ORIGIN, ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf, ...(c.tenant ? { "x-tenant-id": c.tenant } : {}) } : {}), "idempotency-key": requestKey, "content-type": "application/json" } }) });
  let data: any = null; try { data = raw.json(); } catch {}
  return { status: raw.statusCode, data, raw };
}
const ok = (r: Awaited<ReturnType<typeof call>>) => { assert.ok(r.status >= 200 && r.status < 300, `${r.status} ${JSON.stringify(r.data)}`); return r.data; };
async function fixture() { const owner = await historyLogin(system), w = ok(await call(owner, "POST", "/v1/tenants", { name: "Portable project fixture", project_name: "Original campaign" }));
  owner.tenant = w.tenant.id; const target = ok(await call(owner, "POST", `/v1/tenants/${w.tenant.id}/projects`, { name: "Restored campaign" }));
  return { owner, tenant: w.tenant.id as string, project: w.project.id as string, target: target.id as string,
    base: `/v1/tenants/${w.tenant.id}/projects/${w.project.id}`, destination: `/v1/tenants/${w.tenant.id}/projects/${target.id}` }; }
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function asset(f: Fixture, name: string, mime: string, bytes: Buffer, project = f.project, privateOwner?: string) {
  return system.db.tx(tx => saveAsset(tx, system.storage, { tenant: f.tenant, project, user: f.owner.id, name, mime, bytes, ...(privateOwner ? { privateOwner } : {}) }), f.tenant, false, f.owner.id);
}
function image() { const c = createCanvas(32, 32), ctx = c.getContext("2d"); ctx.fillStyle = "#2352df"; ctx.fillRect(0, 0, 32, 32); return c.toBuffer("image/png"); }
function poster(ref?: { id: string; version?: number }) { return { width: 256, height: 456, background: "#f6f6f4", layers: [
  { type: "text", text: "香港活動 · HK$128", x: 18, y: 280, font_size: 18, color: "#171717", font_family: "sans", weight: "normal" },
  ...(ref ? [{ type: "image", asset_id: ref.id, version: ref.version ?? 1, x: 20, y: 20, width: 216, height: 200 }] : [])] }; }
async function archive(f: Fixture, id: string, version = 1) {
  const response = await call(f.owner, "GET", `${f.base}/creative-project-packages/${id}?expected_version=${version}`);
  assert.equal(response.status, 200, JSON.stringify(response.data)); assert.equal(response.raw.headers["content-type"], "application/zip");
  const bytes = response.raw.rawPayload; assert.equal(hash(bytes), response.raw.headers["x-content-sha256"]); return bytes;
}
async function prepare(f: Fixture, bytes: Buffer, destination = f.destination) {
  const project = destination.split("/").at(-1)!, checksum = hash(bytes);
  const accepted = ok(await call(f.owner, "POST", destination + "/uploads", { project_id: project, filename: "source-project.zip", content_type: "application/zip", size_bytes: bytes.length, sha256: checksum }));
  for (let offset = 0, index = 0; offset < bytes.length; offset += accepted.part_size_bytes, index++) {
    const part = bytes.subarray(offset, offset + accepted.part_size_bytes);
    ok(await call(f.owner, "POST", destination + "/uploads/" + accepted.upload_id + "/parts/" + index, { sha256: hash(part), base64: part.toString("base64") }));
  }
  const a = ok(await call(f.owner, "POST", destination + "/uploads/" + accepted.upload_id + "/complete", { size_bytes: bytes.length, sha256: checksum }));
  const selection = { asset_id: a.id, version: 1, sha256: a.version.sha256 }, preview = ok(await call(f.owner, "POST", destination + "/creative-project-packages/preview", selection));
  return { a, selection, preview, body: { ...selection, name: "Restored source", preview_hash: preview.preview_hash, confirm_project_sharing: true, confirm_media_rights: true } };
}
const counts = async (tenant: string) => (await system.db.control.query(`SELECT
  (SELECT count(*)::int FROM creative_projects WHERE tenant_id=$1) AS projects,
  (SELECT count(*)::int FROM assets WHERE tenant_id=$1) AS assets,
  (SELECT count(*)::int FROM ledger WHERE tenant_id=$1) AS ledger,
  (SELECT count(*)::int FROM current_ai_provider_requests WHERE tenant_id=$1) AS model_calls`, [tenant])).rows[0];

test("canvas moves to a different project with exact media, remains editable and repeats without duplicate resources or AI charges", async () => {
  const f = await fixture(), media = await asset(f, "Campaign.png", "image/png", image());
  const source = ok(await call(f.owner, "POST", f.base + "/creative", { name: "Original layered source", body: poster({ id: media.id }) }));
  const bytes = await archive(f, source.id), files = unzipSync(bytes), manifest = JSON.parse(Buffer.from(files["manifest.json"]).toString());
  assert.equal(manifest.media.length, 1); assert.deepEqual(Buffer.from(files[manifest.media[0].path]), image());
  assert.ok(files["SHA256SUMS"] && files["project.json"] && files["preview.svg"]);
  const p = await prepare(f, bytes), before = await counts(f.tenant), requestKey = randomUUID();
  const restored = ok(await call(f.owner, "POST", f.destination + "/creative-project-packages/restore", p.body, requestKey));
  const repeated = ok(await call(f.owner, "POST", f.destination + "/creative-project-packages/restore", p.body, requestKey)); assert.deepEqual(repeated, restored);
  const after = await counts(f.tenant); assert.equal(after.projects - before.projects, 1); assert.equal(after.assets - before.assets, 1); assert.equal(after.model_calls, before.model_calls); assert.equal(after.ledger, before.ledger);
  assert.equal(restored.imported_assets, 1); assert.equal(restored.ai_cost_micros, "0"); assert.notEqual(restored.id, source.id);
  const row = ok(await call(f.owner, "GET", f.destination + "/creative")).items.find((x: any) => x.id === restored.id);
  assert.notEqual(row.body.layers[1].asset_id, media.id); assert.equal(row.body.layers[1].version, 1); row.body.layers[0].text = "已恢復並編輯 · HK$168";
  ok(await call(f.owner, "PUT", f.destination + "/creative/" + restored.id, { name: "Edited restored source", version: 1, body: row.body }));
  const rendered = ok(await call(f.owner, "POST", f.destination + "/creative/" + restored.id + "/render", { expected_version: 2, format: "png" }));
  const pngResponse = await call(f.owner, "GET", f.destination + "/assets/" + rendered.id + "/download");
  assert.equal(pngResponse.status, 200); const png = pngResponse.raw.rawPayload; assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const unchanged = ok(await call(f.owner, "GET", f.base + "/creative")).items.find((x: any) => x.id === source.id); assert.equal(unchanged.version, 1); assert.equal(unchanged.body.layers[0].text, "香港活動 · HK$128");
  const receipt = ok(await call(f.owner, "GET", f.destination + "/creative-project-packages/requests/" + requestKey)); assert.equal(receipt.state, "completed"); assert.equal(receipt.result.id, restored.id);
});

test("video package embeds PNG, WAV, pinned font and license; restored timeline edits and actually re-renders MP4", async () => {
  const f = await fixture(), media = await asset(f, "Scene.png", "image/png", image());
  const wav = Buffer.alloc(44 + 48000 * 2 * 3); wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
  const audio = await asset(f, "Owned.wav", "audio/wav", wav), definition = videoDefinition.parse({ schema_version: "copypaste-video-1", template: "campaign-cuts-1", locale: "zh-HK", width: 256, height: 456,
    frame_rate: { numerator: 30, denominator: 1 }, duration_frames: 90, script: { title: "活動", brief: "恢復工程", narration: "香港", call_to_action: "了解更多" },
    brand: { label: "CopyPaste", background: "#f6f6f4", ink: "#171717", accent: "#2352df", logo: null },
    storyboard: [{ key: "one", start_frame: 0, end_frame: 90, direction: "開場", headline: "創意活動", body: "團隊合作", image: { asset_id: media.id, version: 1 } }],
    subtitles: [{ key: "caption", start_frame: 0, end_frame: 90, text: "香港活動" }], audio: { source: { asset_id: audio.id, version: 1 }, source_in_frame: 0, gain_db: -6, role: "music", rights_basis: "owned", rights_reference: "Explicit synthetic owned audio" } });
  const source = ok(await call(f.owner, "POST", f.base + "/video-projects", { name: "Source campaign", definition })), bytes = await archive(f, source.id), files = unzipSync(bytes);
  assert.ok(files["fonts/NotoSansTC-VF.ttf"]?.length > 1000000); assert.ok(files["fonts/OFL.txt"]?.length > 1000);
  const p = await prepare(f, bytes), before = await counts(f.tenant), restored = ok(await call(f.owner, "POST", f.destination + "/creative-project-packages/restore", p.body));
  const details = ok(await call(f.owner, "GET", f.destination + "/video-projects/" + restored.id)); assert.equal(details.definition.audio.gain_db, -6); assert.equal(details.definition.duration_frames, 90);
  assert.notEqual(details.definition.storyboard[0].image.asset_id, media.id); assert.notEqual(details.definition.audio.source.asset_id, audio.id);
  details.definition.subtitles[0].text = "工程恢復後已修改";
  ok(await call(f.owner, "POST", f.destination + "/video-projects/" + restored.id + "/edit", { expected_version: 1, name: "Edited restored video", definition: details.definition }));
  const render = ok(await call(f.owner, "POST", f.destination + "/video-projects/" + restored.id + "/renders", { expected_version: 2 }));
  await advanceVideoProjects(system.db, system.storage);
  const finished = ok(await call(f.owner, "GET", f.destination + "/video-projects/" + restored.id));
  const result = finished.renders.find((r: any) => r.id === render.id); assert.equal(result.state, "succeeded", JSON.stringify(result)); assert.equal(result.ai_cost_micros, "0"); assert.ok(result.output_available);
  const preview = ok(await call(f.owner, "GET", f.destination + "/video-projects/" + restored.id + "/renders/" + render.id + "/preview")); assert.equal(hash(Buffer.from(preview.base64, "base64")), preview.sha256);
  const after = await counts(f.tenant); assert.equal(after.ledger, before.ledger); assert.equal(after.model_calls, before.model_calls);
});

test("authorization, selected version and explicit project-sharing / rights confirmations are enforced", async () => {
  const f = await fixture(), source = ok(await call(f.owner, "POST", f.base + "/creative", { name: "Source", body: poster() }));
  assert.equal((await call(null, "GET", `${f.base}/creative-project-packages/${source.id}?expected_version=1`)).status, 401);
  assert.equal((await call(f.owner, "GET", `${f.base}/creative-project-packages/${source.id}?expected_version=2`)).status, 409);
  const outsider = await historyLogin(system); assert.equal((await call(outsider, "GET", f.base + "/creative-project-packages")).status, 404);
  const p = await prepare(f, await archive(f, source.id)), before = await counts(f.tenant);
  for (const body of [{ ...p.body, confirm_project_sharing: false }, { ...p.body, confirm_media_rights: false }, { ...p.body, preview_hash: "0".repeat(64) }, { ...p.body, sha256: "0".repeat(64) }])
    assert.ok([400, 409].includes((await call(f.owner, "POST", f.destination + "/creative-project-packages/restore", body)).status));
  assert.deepEqual(await counts(f.tenant), before);
  assert.equal((await call(f.owner, "POST", f.base + "/creative-project-packages/preview", p.selection)).status, 404);
});

test("archive member tampering, missing sources, unsafe paths and compression bombs fail before creating project content", async () => {
  const f = await fixture(), media = await asset(f, "Source.png", "image/png", image()), source = ok(await call(f.owner, "POST", f.base + "/creative", { name: "Source", body: poster({ id: media.id }) }));
  const original = unzipSync(await archive(f, source.id));
  const variants: Uint8Array[] = [];
  const changed = { ...original, "project.json": Buffer.from("{}") }; variants.push(zipSync(changed, { level: 0 }));
  const missing = { ...original }; delete missing["media/001.png"]; variants.push(zipSync(missing, { level: 0 }));
  variants.push(zipSync({ ...original, "../escape.txt": Buffer.from("denied") }, { level: 0 }));
  variants.push(zipSync(original, { level: 9 }));
  for (const [index, bytes] of variants.entries()) {
    const a = await asset(f, `Invalid-${index}.zip`, "application/zip", Buffer.from(bytes), f.target), before = await counts(f.tenant);
    const result = await call(f.owner, "POST", f.destination + "/creative-project-packages/preview", { asset_id: a.id, version: 1, sha256: a.version.sha256 });
    assert.equal(result.status, 422, JSON.stringify(result.data)); assert.deepEqual(await counts(f.tenant), before);
  }
  const data = Buffer.from(zipSync(original, { level: 0 }));
  const directory = await mkdtemp(path.join(isolated.directory, "bounded-package-"));
  try { const file = path.join(directory, "truncated.zip"); await writeFile(file, data.subarray(0, data.length - 30)); await assert.rejects(readCreativePackage(file, directory, AbortSignal.timeout(5000))); }
  finally { await rm(directory, { recursive: true, force: true }); }
});

test("withdrawn upload and removed restored content are never replayed into new resources", async () => {
  const f = await fixture(), source = ok(await call(f.owner, "POST", f.base + "/creative", { name: "Source", body: poster() })), p = await prepare(f, await archive(f, source.id)), requestKey = randomUUID();
  const restored = ok(await call(f.owner, "POST", f.destination + "/creative-project-packages/restore", p.body, requestKey));
  await system.db.control.query("UPDATE creative_projects SET retention_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [restored.id]);
  const before = await counts(f.tenant);
  assert.equal(ok(await call(f.owner, "GET", f.destination + "/creative-project-packages/requests/" + requestKey)).state, "removed");
  assert.equal((await call(f.owner, "POST", f.destination + "/creative-project-packages/restore", p.body, requestKey)).status, 410);
  await system.db.control.query("UPDATE assets SET retention_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [p.a.id]);
  assert.equal((await call(f.owner, "POST", f.destination + "/creative-project-packages/preview", p.selection)).status, 404);
  assert.deepEqual(await counts(f.tenant), before);
  assert.equal((await readdir(system.db.config.DATA_DIR)).filter(f => f.startsWith("creative-package-")).length, 0);
});
