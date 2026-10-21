import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import * as OTPAuth from "otpauth";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { loadConfig } from "../src/config.js";
import { buildApp } from "../src/server.js";
import { advanceVideoProjects } from "../src/video-projects.js";
import { renderVideoProject } from "../src/video-render.js";
import { videoDefinition, videoCreated, videoQueued, videoCancelled, videoList, videoDetail, videoPreview } from "../src/video-project-model.js";
import { saveAsset } from "../src/storage.js";
import { ErasureService } from "../src/erasure.js";
import { canonical, hash, seal } from "../src/lib.js";
import { Worker } from "../src/worker.js";
import { CodexRuntimeAdapter, type RuntimeContext } from "../src/runtime.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string };
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", WORKER_ENABLED: "false", DEV_MAILBOX: "true" }), { worker: false });
});
beforeEach(async () => { await s.db.control.query("UPDATE video_renders SET state='cancelled',revision=revision+1,finished_at=clock_timestamp() WHERE state IN('queued','rendering')"); });
after(async () => { try { await s?.app.close(); } finally { await isolated?.cleanup(); } });
async function call(c: Client | undefined, method: string, url: string, body?: unknown, requestKey = randomUUID()) {
  const raw = await s.app.inject({ method: method as any, url, headers: { origin: url.startsWith("/v1/admin/") ? s.db.config.ADMIN_ORIGIN : s.db.config.WEB_ORIGIN, ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}), "idempotency-key": requestKey, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
  let data: any; try { data = raw.json(); } catch { data = null; }
  if (raw.statusCode === 200 && url.includes("/video-projects")) {
    const dto = url.endsWith("/preview") ? videoPreview : url.endsWith("/cancel") ? videoCancelled : url.endsWith("/renders") ? videoQueued : method === "POST" ? videoCreated : /\/video-projects(?:\?|$)/.test(url) ? videoList : videoDetail;
    assert.ok(dto.safeParse(data).success, JSON.stringify(dto.safeParse(data)));
  }
  return { status: raw.statusCode, data, raw };
}
const ok = (r: Awaited<ReturnType<typeof call>>) => { assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
async function user(): Promise<Client> {
  const c = ok(await call(undefined, "POST", "/v1/auth/challenge", { email: `video-${randomUUID()}@example.invalid` }));
  const mail = JSON.parse(await readFile(`${s.db.config.DATA_DIR}/mailbox/${c.challenge_id}.json`, "utf8"));
  const r = await call(undefined, "POST", "/v1/auth/verify", { challenge_id: c.challenge_id, code: mail.text.match(/\b\d{6}\b/)[0] }); const b = ok(r);
  return { id: b.user.id, csrf: b.csrf_token, cookie: r.raw.cookies[0].name + "=" + r.raw.cookies[0].value };
}
async function fixture() {
  const owner = await user(), w = ok(await call(owner, "POST", "/v1/tenants", { name: "Video fixture", project_name: "Campaign" }));
  return { owner, tenant: w.tenant.id as string, project: w.project.id as string, base: `/v1/tenants/${w.tenant.id}/projects/${w.project.id}` };
}
function definition() {
  return videoDefinition.parse({ schema_version: "copypaste-video-1", template: "campaign-cuts-1", locale: "zh-HK", width: 256, height: 456, frame_rate: { numerator: 30, denominator: 1 }, duration_frames: 90,
    script: { title: "原創活動", brief: "可重做工程", narration: "提供的文稿，不是合成配音。", call_to_action: "了解更多" },
    brand: { label: "CopyPaste", background: "#f1f2f4", ink: "#17202c", accent: "#2458df", logo: null },
    storyboard: [{ key: "one", start_frame: 0, end_frame: 45, direction: "開場", headline: "創意開始", body: "團隊合作", image: null }, { key: "two", start_frame: 45, end_frame: 90, direction: "結尾", headline: "一起完成", body: "完整交付", image: null }],
    subtitles: [{ key: "caption", start_frame: 0, end_frame: 90, text: "香港企業的下一步" }], audio: null });
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const create = async (f: Fixture, d = definition()) => ok(await call(f.owner, "POST", f.base + "/video-projects", { name: "Campaign video", definition: d })).id as string;
const detail = async (f: Fixture, id: string) => ok(await call(f.owner, "GET", `${f.base}/video-projects/${id}`));
const queue = async (f: Fixture, id: string, version = 1) => ok(await call(f.owner, "POST", `${f.base}/video-projects/${id}/renders`, { expected_version: version }));
const outputIds = (r: any) => [r.mp4_asset_id, r.project_asset_id, r.script_asset_id, r.storyboard_asset_id, r.subtitles_asset_id, r.probe_asset_id] as string[];
async function png(f: Fixture) {
  const canvas = createCanvas(32, 32), ctx = canvas.getContext("2d"); ctx.fillStyle = "#2458df"; ctx.fillRect(0, 0, 32, 32);
  return s.db.tx((tx) => saveAsset(tx, s.storage, { tenant: f.tenant, project: f.project, user: f.owner.id, name: "Versioned source.png", mime: "image/png", bytes: canvas.toBuffer("image/png") }), f.tenant, true, f.owner.id);
}
function held() {
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>((r) => entered = r), gate = new Promise<void>((r) => release = r);
  return { ready, release, render: async (...args: Parameters<typeof renderVideoProject>) => { entered(); await gate; return renderVideoProject(...args); } };
}
async function erase() {
  const service = new ErasureService(s.db, s.storage);
  for (let i = 0; i < 8; i++) { await s.db.control.query("UPDATE deletion_jobs SET next_attempt_at=now() WHERE state='queued'"); await service.advance(30); }
}
async function operator(role: string, tenant: string): Promise<Client> {
  const email = `video-admin-${randomUUID()}@example.invalid`, secret = new OTPAuth.Secret({ size: 20 });
  const p = (await s.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,$2,$3) RETURNING id", [email, role, seal(s.db.config.MASTER_KEY!, secret.base32)])).rows[0];
  await s.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'tenant',$3)", [p.id, role, tenant]);
  const c = ok(await call(undefined, "POST", "/v1/admin/auth/challenge", { email }));
  const mail = JSON.parse(await readFile(`${s.db.config.DATA_DIR}/mailbox/${c.challenge_id}.json`, "utf8"));
  const r = await call(undefined, "POST", "/v1/admin/auth/verify", { challenge_id: c.challenge_id, code: mail.text.match(/\b\d{6}\b/)[0], totp: new OTPAuth.TOTP({ secret, digits: 6, period: 30, algorithm: "SHA1" }).generate() });
  const b = ok(r), cookie = r.raw.cookies.find((v) => v.name === "cp_admin_session")!;
  return { id: p.id, csrf: b.csrf_token, cookie: cookie.name + "=" + cookie.value };
}

test("video project admission rejects invalid timelines, fabricated costs and missing source versions before persistence", async () => {
  const f = await fixture(), d = definition();
  const bad = structuredClone(d); bad.storyboard[0].end_frame--;
  for (const body of [{ name: "Bad", definition: bad }, { name: "Bad", definition: d, ai_cost_micros: 1 }, { name: "Missing", definition: { ...d, brand: { ...d.brand, logo: { asset_id: randomUUID(), version: 1 } } } }]) assert.ok([400, 422].includes((await call(f.owner, "POST", f.base + "/video-projects", body)).status));
  assert.equal(Number((await s.db.control.query("SELECT count(*) FROM creative_projects WHERE project_id=$1", [f.project])).rows[0].count), 0);
});
test("video create and render idempotency returns one durable record and rejects conflicting reuse", async () => {
  const f = await fixture(), requestKey = randomUUID(), b = { name: "One project", definition: definition() };
  const first = ok(await call(f.owner, "POST", f.base + "/video-projects", b, requestKey));
  assert.deepEqual(ok(await call(f.owner, "POST", f.base + "/video-projects", b, requestKey)), first);
  assert.equal((await call(f.owner, "POST", f.base + "/video-projects", { ...b, name: "Changed" }, requestKey)).status, 409);
  const key = randomUUID(), url = `${f.base}/video-projects/${first.id}/renders`, r = ok(await call(f.owner, "POST", url, { expected_version: 1 }, key));
  assert.deepEqual(ok(await call(f.owner, "POST", url, { expected_version: 1 }, key)), r);
  assert.equal((await call(f.owner, "POST", url, { expected_version: 1 })).status, 409);
  assert.equal(Number((await s.db.control.query("SELECT count(*) FROM video_renders WHERE video_id=$1", [first.id])).rows[0].count), 1);
});
test("video creates six real scoped deliverables with a decoded MP4, editable source and zero fabricated AI charge", async () => {
  const f = await fixture(), id = await create(f); await queue(f, id); assert.equal((await advanceVideoProjects(s.db, s.storage))?.state, "succeeded");
  const d = await detail(f, id), r = d.renders[0]; assert.equal(r.output_available, true); assert.equal(r.probe.duration_frames, 90); assert.equal(r.probe.fully_decoded, true);
  const preview = ok(await call(f.owner, "GET", `${f.base}/video-projects/${id}/renders/${r.id}/preview`)); assert.equal(hash(Buffer.from(preview.base64, "base64")), preview.sha256);
  for (const asset of outputIds(r)) assert.equal((await call(f.owner, "GET", `${f.base}/assets/${asset}/download`)).status, 200);
  const project = ok(await call(f.owner, "GET", `${f.base}/assets/${r.project_asset_id}/download`)); assert.equal(project.definition.storyboard.length, 2); assert.equal(project.definition.script.title, "原創活動");
  assert.equal(d.cost.ai_cost_micros, "0"); assert.equal(Number((await s.db.control.query("SELECT count(*) FROM ledger WHERE tenant_id=$1", [f.tenant])).rows[0].count), 0);
});
test("video edit uses optimistic versions and an in-flight old revision remains frozen", async () => {
  const f = await fixture(), id = await create(f), q = await queue(f, id), hold = held(), pending = advanceVideoProjects(s.db, s.storage, hold.render);
  await hold.ready;
  try {
    const d = definition(); d.storyboard[0].headline = "第二版本";
    const edit = { name: "Revised", definition: d, expected_version: 1 };
    assert.equal(ok(await call(f.owner, "POST", `${f.base}/video-projects/${id}/edit`, edit)).version, 2);
    assert.equal((await call(f.owner, "POST", `${f.base}/video-projects/${id}/edit`, edit)).status, 409);
  } finally { hold.release(); }
  assert.equal((await pending)?.state, "succeeded");
  const d = await detail(f, id); assert.equal(d.version, 2); assert.equal(d.renders[0].version, 1); assert.equal(d.renders[0].id, q.id);
  const source = ok(await call(f.owner, "GET", `${f.base}/assets/${d.renders[0].project_asset_id}/download`)); assert.equal(source.definition.storyboard[0].headline, "創意開始");
});
test("video rejects readers and other enterprises, while accessible viewers can read project metadata", async () => {
  const f = await fixture(), id = await create(f), viewer = await user(), other = await fixture();
  await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'viewer')", [f.tenant, viewer.id]);
  await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'viewer')", [f.tenant, f.project, viewer.id]);
  assert.equal((await call(viewer, "GET", `${f.base}/video-projects/${id}`)).status, 200);
  assert.equal((await call(viewer, "POST", `${f.base}/video-projects/${id}/renders`, { expected_version: 1 })).status, 403);
  assert.equal((await call(other.owner, "GET", `${f.base}/video-projects/${id}`)).status, 404);
  assert.equal((await call(undefined, "GET", `${f.base}/video-projects/${id}`)).status, 401);
});
test("video queued cancellation is optimistic and cannot be silently restarted", async () => {
  const f = await fixture(), id = await create(f), q = await queue(f, id), url = `${f.base}/video-projects/${id}/renders/${q.id}/cancel`;
  assert.equal((await call(f.owner, "POST", url, { expected_revision: 2 })).status, 409);
  assert.equal(ok(await call(f.owner, "POST", url, { expected_revision: 1 })).state, "cancelled"); assert.equal(await advanceVideoProjects(s.db, s.storage), null);
  assert.equal((await detail(f, id)).renders[0].state, "cancelled");
  const next = await queue(f, id); assert.notEqual(next.id, q.id);
});
test("video cancellation during native rendering aborts and fences late completion without publishing outputs", async () => {
  const f = await fixture(), id = await create(f); await queue(f, id); const hold = held(), pending = advanceVideoProjects(s.db, s.storage, hold.render); await hold.ready;
  try { const r = (await detail(f, id)).renders[0]; ok(await call(f.owner, "POST", `${f.base}/video-projects/${id}/renders/${r.id}/cancel`, { expected_revision: r.revision })); }
  finally { hold.release(); }
  await pending; const r = (await detail(f, id)).renders[0]; assert.equal(r.state, "cancelled"); assert.ok(outputIds(r).every((id) => id === null));
});
test("video current authorization is rechecked after rendering and explicit owner retry preserves the denial", async () => {
  const f = await fixture(), id = await create(f); await queue(f, id); const hold = held(), pending = advanceVideoProjects(s.db, s.storage, hold.render); await hold.ready;
  try { await s.db.control.query("UPDATE users SET auth_version=auth_version+1 WHERE id=$1", [f.owner.id]); } finally { hold.release(); }
  assert.equal((await pending)?.state, "failed"); const r = (await s.db.control.query("SELECT state,error_code FROM video_renders WHERE video_id=$1", [id])).rows[0]; assert.equal(r.error_code, "AUTHORIZATION_CHANGED");
});
test("video source quarantine immediately denies every derived download and restore keeps immutable fixed versions", async () => {
  const f = await fixture(), image = await png(f), d = definition(); d.storyboard[0].image = { asset_id: image.id, version: 1 }; const id = await create(f, d); await queue(f, id); await advanceVideoProjects(s.db, s.storage);
  let r = (await detail(f, id)).renders[0]; assert.equal(r.state, "succeeded");
  await s.db.control.query("UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1", [image.id]);
  r = (await detail(f, id)).renders[0]; assert.equal(r.output_available, false);
  assert.equal((await call(f.owner, "GET", `${f.base}/video-projects/${id}/renders/${r.id}/preview`)).status, 404);
  for (const asset of outputIds(r)) assert.equal((await call(f.owner, "GET", `${f.base}/assets/${asset}/download`)).status, 404);
  assert.equal((await call(f.owner, "POST", `${f.base}/video-projects/${id}/renders`, { expected_version: 1 })).status, 422);
  await s.db.control.query("UPDATE assets SET state='active',moderation_version=moderation_version+1 WHERE id=$1", [image.id]); assert.equal((await detail(f, id)).renders[0].output_available, true);
});
test("video source removal during rendering prevents publication", async () => {
  const f = await fixture(), image = await png(f), d = definition(); d.brand.logo = { asset_id: image.id, version: 1 }; const id = await create(f, d); await queue(f, id);
  const hold = held(), pending = advanceVideoProjects(s.db, s.storage, hold.render); await hold.ready;
  try { await s.db.control.query("UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1", [image.id]); } finally { hold.release(); }
  assert.equal((await pending)?.state, "failed"); assert.equal((await detail(f, id)).renders[0].output_available, false);
});
test("video expired leases become interrupted facts and late workers cannot replace them", async () => {
  const f = await fixture(), id = await create(f); await queue(f, id); const hold = held(), pending = advanceVideoProjects(s.db, s.storage, hold.render, { leaseSeconds: 1 }); await hold.ready;
  try { await s.db.control.query("SELECT pg_sleep(1.05)"); await advanceVideoProjects(s.db, s.storage); } finally { hold.release(); }
  await pending; const r = (await detail(f, id)).renders[0]; assert.equal(r.state, "failed"); assert.equal(r.error_code, "VIDEO_RENDER_INTERRUPTED"); assert.ok(outputIds(r).every((id) => id === null));
});
test("video storage failure rolls back all six references and explicit retry retains the first failed record", async () => {
  const f = await fixture(), id = await create(f); await queue(f, id); const put = s.storage.put.bind(s.storage); let count = 0;
  s.storage.put = async (...args: Parameters<typeof s.storage.put>) => { if (++count === 3) throw new Error("Injected owned storage failure"); return put(...args); };
  try { assert.equal((await advanceVideoProjects(s.db, s.storage))?.state, "failed"); } finally { s.storage.put = put; }
  assert.equal(Number((await s.db.control.query("SELECT count(*) FROM assets WHERE project_id=$1", [f.project])).rows[0].count), 0);
  await queue(f, id); await advanceVideoProjects(s.db, s.storage); const r = (await detail(f, id)).renders; assert.equal(r.length, 2); assert.equal(r[0].state, "succeeded"); assert.equal(r[1].state, "failed");
});
test("video finished receipts, source references and project versions remain immutable for the control identity", async () => {
  const f = await fixture(), image = await png(f), d = definition(); d.brand.logo = { asset_id: image.id, version: 1 }; const id = await create(f, d); await queue(f, id); await advanceVideoProjects(s.db, s.storage);
  await assert.rejects(s.db.control.query("UPDATE video_project_versions SET definition='{}' WHERE video_id=$1", [id]), /immutable/);
  await assert.rejects(s.db.control.query("UPDATE video_project_sources SET sha256=$2 WHERE video_id=$1", [id, "0".repeat(64)]), /immutable/);
  await assert.rejects(s.db.control.query("UPDATE video_renders SET error_code='REPLACED' WHERE video_id=$1", [id]), /immutable/);
});
test("video deletion clears every script version, replay copy, probe body and all six physical objects", async () => {
  const f = await fixture(), id = await create(f); await queue(f, id); await advanceVideoProjects(s.db, s.storage);
  const r = (await detail(f, id)).renders[0], files = (await s.db.control.query("SELECT storage_key FROM asset_versions WHERE asset_id=ANY($1::uuid[])", [outputIds(r)])).rows;
  await s.db.control.query("UPDATE creative_projects SET content_state='deleted',moderation_version=moderation_version+1 WHERE id=$1", [id]); await erase();
  assert.equal((await call(f.owner, "GET", `${f.base}/video-projects/${id}`)).status, 404);
  assert.ok((await s.db.control.query("SELECT definition FROM video_project_versions WHERE video_id=$1", [id])).rows.every((v) => canonical(v.definition) === "{}"));
  assert.equal(canonical((await s.db.control.query("SELECT probe FROM video_renders WHERE video_id=$1", [id])).rows[0].probe), "{}");
  for (const file of files) await assert.rejects(s.storage.get(file.storage_key));
  assert.ok((await s.db.control.query("SELECT response FROM request_replays WHERE action LIKE $1", [`%${id}`])).rows.every((v) => canonical(v.response) === "{}"));
});
test("video source erasure propagates to every embedded derived object through deletion dependencies", async () => {
  const f = await fixture(), image = await png(f), d = definition(); d.storyboard[0].image = { asset_id: image.id, version: 1 }; const id = await create(f, d); await queue(f, id); await advanceVideoProjects(s.db, s.storage);
  const r = (await detail(f, id)).renders[0], ids = [image.id, ...outputIds(r)];
  await s.db.control.query("UPDATE assets SET state='deleted',moderation_version=moderation_version+1 WHERE id=$1", [image.id]); await erase();
  const files = (await s.db.control.query("SELECT v.storage_key,v.erased_at,a.state FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE a.id=ANY($1::uuid[])", [ids])).rows; assert.equal(files.length, 7);
  for (const file of files) { assert.equal(file.state, "deleted"); assert.ok(file.erased_at); await assert.rejects(s.storage.get(file.storage_key)); }
});
test("video workers enforce one tenant slot and two global slots without duplicate claims", async () => {
  const a = await fixture(), b = await fixture(), a1 = await create(a), a2 = await create(a), b1 = await create(b); await queue(a, a1); await queue(a, a2); await queue(b, b1);
  const h1 = held(), p1 = advanceVideoProjects(s.db, s.storage, h1.render); await h1.ready; const h2 = held(), p2 = advanceVideoProjects(s.db, s.storage, h2.render); await h2.ready;
  try { assert.equal(await advanceVideoProjects(s.db, s.storage), null); const rows = (await s.db.control.query("SELECT tenant_id,count(*)::int AS n FROM video_renders WHERE state='rendering' GROUP BY tenant_id")).rows; assert.equal(rows.length, 2); assert.ok(rows.every((r) => r.n === 1)); }
  finally { h1.release(); h2.release(); } assert.equal((await p1)?.state, "succeeded"); assert.equal((await p2)?.state, "succeeded");
});
test("video rejects private and other-project inputs and corrupt bytes cannot publish fallback outputs", async () => {
  const f = await fixture(), other = await fixture(), image = await png(f), foreign = await png(other), d = definition();
  d.brand.logo = { asset_id: foreign.id, version: 1 }; assert.equal((await call(f.owner, "POST", f.base + "/video-projects", { name: "Foreign", definition: d })).status, 422);
  await s.db.control.query("UPDATE assets SET private_owner=$2 WHERE id=$1", [image.id, f.owner.id]); d.brand.logo = { asset_id: image.id, version: 1 }; assert.equal((await call(f.owner, "POST", f.base + "/video-projects", { name: "Private", definition: d })).status, 422);
  await s.db.control.query("UPDATE assets SET private_owner=NULL WHERE id=$1", [image.id]); const id = await create(f, d); await queue(f, id);
  const get = s.storage.get.bind(s.storage); s.storage.get = async () => Buffer.from("corrupt fixed media");
  try { assert.equal((await advanceVideoProjects(s.db, s.storage))?.state, "failed"); } finally { s.storage.get = get; }
  assert.equal((await detail(f, id)).renders[0].error_code, "VIDEO_SOURCE_INTEGRITY"); assert.equal((await detail(f, id)).renders[0].output_available, false);
});
test("video Admin body access is independent and tenant scoped, and content actions stop and erase actual outputs", async () => {
  const f = await fixture(), id = await create(f); await queue(f, id); await advanceVideoProjects(s.db, s.storage);
  const r = (await detail(f, id)).renders[0], admin = await operator("super_admin", f.tenant), support = await operator("support_agent", f.tenant), other = await operator("super_admin", randomUUID()), url = "/v1/admin/content/" + id;
  assert.equal((await call(support, "GET", url + "/body")).status, 403); assert.equal((await call(other, "GET", url + "/body")).status, 403);
  const body = JSON.parse(ok(await call(admin, "GET", url + "/body")).text); assert.equal(body.versions.length, 1); assert.equal(body.versions[0].definition.script.title, "原創活動"); assert.equal(body.renders[0].id, r.id); assert.ok(!JSON.stringify(body).includes("lease_token"));
  await queue(f, id); ok(await call(admin, "POST", url + "/action", { action: "quarantine", version: 1, reason: "Review actual video content" }));
  assert.equal((await call(f.owner, "GET", `${f.base}/assets/${r.mp4_asset_id}/download`)).status, 404);
  assert.equal((await s.db.control.query("SELECT state FROM video_renders WHERE video_id=$1 ORDER BY created_at DESC LIMIT 1", [id])).rows[0].state, "cancelled");
  ok(await call(admin, "POST", url + "/action", { action: "restore", version: 2, reason: "Restore reviewed video" })); assert.equal((await detail(f, id)).renders.length, 2);
  ok(await call(admin, "POST", url + "/action", { action: "delete", version: 3, reason: "Erase actual video content" })); assert.equal((await call(admin, "GET", url + "/body")).status, 410); await erase();
  assert.ok((await s.db.control.query("SELECT definition FROM video_project_versions WHERE video_id=$1", [id])).rows.every((v) => canonical(v.definition) === "{}"));
});
test("video RLS hides all new tables across tenants and queue identity has no business access", async () => {
  const f = await fixture(), other = await fixture(), image = await png(f), d = definition(); d.brand.logo = { asset_id: image.id, version: 1 }; const id = await create(f, d); await queue(f, id);
  for (const table of ["video_project_versions", "video_project_sources", "video_renders"]) {
    const result = await s.db.tx((tx) => tx.query(`SELECT count(*)::int AS n FROM ${table} WHERE video_id=$1`, [id]), other.tenant); assert.equal(result.rows[0].n, 0);
    await assert.rejects(s.db.queue.query(`SELECT * FROM ${table} LIMIT 1`), { code: "42501" });
  }
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM pg_class WHERE relname=ANY($1) AND relrowsecurity AND relforcerowsecurity", [["video_project_versions", "video_project_sources", "video_renders"]])).rows[0].n, 3);
});
test("Codex controlled video tool queues one idempotent shared project and never exposes a shared writer in private or read-only modes", async () => {
  const f = await fixture(); ok(await call(f.owner, "POST", `/v1/tenants/${f.tenant}/demo-credit`, {})); let delivered: any;
  class ControlledRuntime extends CodexRuntimeAdapter {
    override async start(ctx: RuntimeContext) {
      const tool = ctx.tools.find((v) => v.name === "video_project_queue"); assert.ok(tool, ctx.tools.map((t) => t.name).join(","));
      const args = { name: "Queued by controlled Codex fixture", definition: definition() }, key = randomUUID();
      delivered = await tool.run(args, key); assert.deepEqual(await tool.run(args, key), delivered); assert.equal(delivered.delivery_state, "queued"); assert.equal(delivered.render.state, "queued");
      await assert.rejects(tool.run({ ...args, name: "Conflicting reuse" }, key), { code: "IDEMPOTENCY_CONFLICT" });
      return { text: "Simulated Codex tool fixture. Video is queued, not completed.", inputTokens: 10, outputTokens: 5, usageKnown: true, accepted: true, status: "completed", thread: "fixture", turn: "fixture" };
    }
  }
  const task = ok(await call(f.owner, "POST", f.base + "/tasks", { title: "Prepare video", prompt: "Create a controlled project and queue its video.", role_key: "video-motion", mode: "execute", budget_micros: 1000000 }));
  const worker = new Worker(s.db, s.catalog, s.storage, new ControlledRuntime(s.db.config)); await worker.run(f.tenant, task.id);
  assert.equal(ok(await call(f.owner, "GET", f.base + "/tasks/" + task.id)).status, "succeeded"); assert.ok(delivered);
  assert.equal((await detail(f, delivered.project.id)).renders.length, 1); assert.equal((await advanceVideoProjects(s.db, s.storage))?.state, "succeeded");
  for (const t of [{ mode: "ask" }, { mode: "plan" }, { mode: "execute", private_owner: f.owner.id }]) assert.ok(!(worker as any).tools(t, {}, "fixture", { tool_ids: ["video.render"] }).some((v: any) => v.name === "video_project_queue"));
});
