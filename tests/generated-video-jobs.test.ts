import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { generatedVideoProvider } from "./generated-video-fixture.js";
import { nativeVideoFixture, startNativeVideo, videoSourceFixture, videoOK, videoCall, videoToolRequest, videoFinish, videoActor } from "./desktop-video-fixture.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { GeneratedVideoJobs } from "../src/video-jobs.js";
import { videoObservationSignature } from "../src/video-job-routes.js";
import { taskProviderBudgetReceipt } from "../src/provider-budgets.js";
import { projectAccess } from "../src/access.js";
import { videoAdmin, videoAdminCall } from "./generated-video-admin-fixture.js";
import { desktopRuntime } from "../src/desktop-runtime.js";
import { desktopImageFixture } from "./desktop-image-fixture.js";
import { saveAsset } from "../src/storage.js";
import { generatedVideoMetadata, generatedVideoList, generatedVideoPreview, generatedVideoAdminList, generatedVideoObservationReceipt, generatedVideoRecheckReceipt } from "../src/video-job-model.js";

let owned: Awaited<ReturnType<typeof isolatedTestEnvironment>>, provider: Awaited<ReturnType<typeof generatedVideoProvider>>,
  s: Awaited<ReturnType<typeof buildApp>>, jobs: GeneratedVideoJobs;
const webhookSecret = "synthetic-video-observation-signing-fixture";
before(async () => {
  owned = await isolatedTestEnvironment();
  provider = await generatedVideoProvider(owned.directory);
  s = await buildApp(loadConfig({ ...owned.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "false", DEMO_MODE: "false",
    AI_BASE_URL: provider.origin, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "synthetic-video-provider-fixture", AI_MODEL: "synthetic-video-reasoning-v1", AI_VERIFIED: "true",
    AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000", AI_INPUT_COUNT_VERIFIED: "true", AI_INPUT_COUNT_HKD_MICROS_PER_CALL: "0",
    AI_VIDEO_MODEL: "synthetic-video-async-v1", AI_VIDEO_VERIFIED: "true", AI_VIDEO_HKD_MICROS_PER_SECOND: "100000", AI_VIDEO_POLL_INTERVAL_MS: "250", AI_VIDEO_WEBHOOK_SECRET: webhookSecret,
  }), { worker: false });
  jobs = new GeneratedVideoJobs(s.db, s.catalog, s.storage);
});
beforeEach(async () => {
  provider.state.initial = "completed"; provider.state.initialUsage = 4; provider.state.dropCreate = false; provider.state.corruptContent = false;
  provider.state.lookupMissing = false; provider.state.cancelCompletes = false; provider.state.beforeCreateResponse = undefined; provider.state.beforeContent = undefined;
  provider.state.textCount = 10; provider.state.textItem = undefined;
  // Each test owns a fresh tenant/task. Retained unknown operations from earlier
  // cases are neither cleared nor assigned invented zero usage.
  const policy = (await s.db.control.query(`INSERT INTO ai_gateway_policy_versions(data_mode,version,global_slots,tenant_slots,actor_slots,text_slots,image_slots,video_slots,verification_slots,
    global_rpm,tenant_rpm,actor_rpm,text_rpm,image_rpm,video_rpm,verification_rpm,preparation_seconds,reason)
    VALUES('configured_services',(SELECT coalesce(max(version),0)+1 FROM ai_gateway_policy_versions WHERE data_mode='configured_services'),1000,1000,1000,1000,1000,1000,1000,
    100000,100000,100000,100000,100000,100000,100000,30,'Isolated generated video test capacity') RETURNING id`)).rows[0];
  await s.db.control.query("UPDATE ai_gateway_policy_heads SET policy_version_id=$1 WHERE data_mode='configured_services'", [policy.id]);
  await s.db.control.query("UPDATE execution_capacity_policy SET agent_slots=100 WHERE data_mode='configured_services'");
});
after(async () => {
  try { assert.deepEqual(provider?.errors ?? [], []); await s?.app.close(); }
  finally { try { await provider?.close(); } finally { await owned?.cleanup(); } }
});
const spec = { prompt: "An explicitly synthetic company video fixture", size: "1280x720" as const, seconds: 4 as const };
async function fixture(reference = false) {
  const f = await nativeVideoFixture(s), started = await startNativeVideo(s, f), task = (await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [started.task.task_id])).rows[0];
  const user = (await s.db.control.query("SELECT * FROM users WHERE id=$1", [f.c.id])).rows[0];
  const actor = { id: user.id, email: user.email, name: user.name, authVersion: user.auth_version, audience: "user" as const, sessionId: "", sessionHash: "" };
  const source = reference ? await videoSourceFixture(s, f, task.id) : null;
  const body = { ...spec, ...(source ? { reference: { asset_id: source.id, version: source.version.version } } : {}) };
  const authorize = async (tx: any) => {
    await projectAccess(tx, actor, f.tenant, f.project, "write");
    const current = (await tx.query("SELECT * FROM tasks WHERE id=$1 FOR UPDATE", [task.id])).rows[0];
    assert.equal(current.fencing_token, task.fencing_token); assert.equal(current.status, "running");
  };
  const prepare = (input = body, call = "generated_" + randomUUID()) => jobs.prepare(task, task.fencing_token, input, call, authorize);
  return { ...f, ...started, task, actor, source, body, prepare };
}
async function row(id: string) { return (await s.db.control.query("SELECT * FROM ai_video_jobs WHERE id=$1", [id])).rows[0]; }
async function due(id: string) { await s.db.control.query("UPDATE ai_video_jobs SET next_poll_at=clock_timestamp(),revision=revision+1 WHERE id=$1", [id]); }
async function receipt(task: any) { return s.db.tx(tx => taskProviderBudgetReceipt(tx, task.id), task.tenant_id, true, task.created_by); }
async function callback(job: any, body: unknown, options: { signature?: string; timestamp?: string } = {}) {
  const path = "/v1/internal/video-operations/" + job.operation_id + "/observations", timestamp = options.timestamp ?? String(Date.now());
  return s.app.inject({ method: "POST", url: path, headers: { "Content-Type": "application/json", "x-copypaste-video-timestamp": timestamp,
    "x-copypaste-video-signature": options.signature ?? videoObservationSignature(webhookSecret, path, timestamp, body) }, payload: JSON.stringify(body) });
}

test("a frozen native video operation persists before HTTP and real MP4 delivery decodes, bills once and remains private", async () => {
  const f = await fixture(true), before = provider.calls.length, job = await f.prepare();
  assert.equal(provider.calls.length, before); assert.equal(job.quoted_micros, "400000"); assert.equal(job.actual_micros, null);
  assert.equal((await receipt(f.task)).uncertain, true);
  await jobs.advance(undefined, job.id);
  const done = await jobs.read(f.actor, f.tenant, f.project, job.id);
  const wire = await videoCall(s, f.c, "GET", f.base + "/generated-video-jobs/" + job.id);
  assert.equal(wire.status, 200); generatedVideoMetadata.parse(wire.data);
  generatedVideoList.parse(await videoOK(s, f.c, "GET", f.base + "/generated-video-jobs?task_id=" + f.task.id));
  generatedVideoPreview.parse(await videoOK(s, f.c, "GET", f.base + "/generated-video-jobs/" + job.id + "/preview"));
  assert.equal(done.state, "completed"); assert.equal(done.delivery_state, "available"); assert.equal(done.actual_micros, "400000");
  assert.equal(done.probe.fully_decoded, true); assert.equal(done.probe.decoded_video_frames, 48);
  assert.equal(done.assets.length, 1); assert.equal(done.assets[0].sha256, provider.sha256);
  const submitted = provider.calls.slice(before).find(call => call.path === "/v1/videos")!;
  assert.equal(submitted.operation, job.operation_id); assert.equal(submitted.fields!.reference_sha256, f.source!.version.sha256);
  const preview = await videoOK(s, f.c, "GET", f.base + "/generated-video-jobs/" + job.id + "/preview");
  assert.deepEqual(Buffer.from(preview.base64, "base64"), provider.bytes);
  const owner = (await s.db.control.query("SELECT private_owner FROM assets WHERE id=$1", [done.assets[0].id])).rows[0].private_owner;
  assert.equal(owner, f.c.id);
  await videoOK(s, f.c, "POST", f.url + "/finish", videoFinish);
  assert.equal((await receipt(f.task)).knownChargeMicros, 400000);
  assert.equal((await s.db.control.query("SELECT charged_micros FROM tasks WHERE id=$1", [f.task.id])).rows[0].charged_micros, "400000");
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'", [f.task.id])).rows[0].n, 1);
  await videoOK(s, f.c, "POST", f.url + "/finish", videoFinish);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'", [f.task.id])).rows[0].n, 1);
});

test("PNG and JPEG references are bounded before native decode and invalid sources never dispatch or consume a generation fee", async () => {
  const oversizedPNG = Buffer.from(desktopImageFixture()); oversizedPNG.writeUInt32BE(65535, 16); oversizedPNG.writeUInt32BE(65535, 20);
  const oversizedJPEG = Buffer.from([255, 216, 255, 192, 0, 17, 8, 255, 255, 255, 255, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217]);
  const canvas = createCanvas(64, 64); canvas.getContext("2d").fillRect(0, 0, 64, 64); const validJPEG = canvas.toBuffer("image/jpeg");
  for (const [bytes, mime, valid] of [[oversizedPNG, "image/png", false], [oversizedJPEG, "image/jpeg", false], [validJPEG, "image/jpeg", true]] as const) {
    const f = await fixture(), before = provider.calls.length;
    const source = await s.db.tx(async tx => { await tx.query("SELECT set_config('app.task_id',$1,true)", [f.task.id]);
      return saveAsset(tx, s.storage, { tenant: f.tenant, project: f.project, user: f.c.id, name: "bounded-reference" + (mime === "image/png" ? ".png" : ".jpg"), mime, kind: "fixture_source", bytes });
    }, f.tenant, false, f.c.id);
    const job = await f.prepare({ ...spec, reference: { asset_id: source.id, version: source.version.version } });
    await jobs.advance(undefined, job.id); const current = await row(job.id);
    assert.equal(provider.calls.slice(before).filter(call => call.path === "/v1/videos").length, valid ? 1 : 0);
    assert.equal(current.actual_micros, valid ? "400000" : "0");
    assert.equal(current.delivery_state, valid ? "available" : "blocked");
    if (!valid) assert.equal(current.error_code, "VIDEO_REFERENCE_INVALID");
  }
});

test("lost submit response resumes the original operation by lookup without a second generation POST", async () => {
  const f = await fixture(), job = await f.prepare(), before = provider.calls.length;
  provider.state.dropCreate = true;
  await jobs.advance(undefined, job.id);
  assert.equal((await row(job.id)).state, "unknown"); assert.equal((await receipt(f.task)).uncertain, true);
  provider.state.dropCreate = false; await due(job.id);
  await new GeneratedVideoJobs(s.db, s.catalog, s.storage).advance(undefined, job.id);
  assert.equal((await jobs.read(f.actor, f.tenant, f.project, job.id)).delivery_state, "available");
  assert.equal(provider.calls.slice(before).filter(call => call.method === "POST" && call.path === "/v1/videos").length, 1);
  assert.ok(provider.calls.slice(before).some(call => call.path === "/v1/videos/operations/" + job.operation_id));
});

test("an unconfirmed lookup, terminal status without usage and repeated tool ids retain the original budget hold", async () => {
  const f = await fixture(), call = "original_" + randomUUID(), job = await f.prepare(f.body, call);
  assert.equal((await f.prepare(f.body, call)).id, job.id);
  assert.equal((await f.prepare(f.body, "changed_call_" + randomUUID())).id, job.id, "Same frozen specification does not create a second paid operation");
  await assert.rejects(f.prepare({ ...f.body, prompt: "A different paid operation" }, call), /replay changed/);
  provider.state.initialUsage = null; provider.state.dropCreate = true; await jobs.advance(undefined, job.id);
  provider.state.lookupMissing = true; await due(job.id); await jobs.advance(undefined, job.id);
  assert.equal((await row(job.id)).usage_known, false); assert.equal((await row(job.id)).state, "unknown");
  provider.state.lookupMissing = false; provider.state.dropCreate = false; await due(job.id); await jobs.advance(undefined, job.id);
  const observed = await jobs.read(f.actor, f.tenant, f.project, job.id);
  assert.equal(observed.state, "completed"); assert.equal(observed.actual_micros, null); assert.equal(observed.usage_state, "awaiting_confirmation");
  assert.equal((await receipt(f.task)).uncertain, true);
  const envelope = (await row(job.id)).envelope_id;
  assert.equal((await s.db.tx(tx => tx.query("SELECT ai_budget_used($1,NULL)::text AS amount", [envelope]), f.tenant, true, f.c.id)).rows[0].amount, "400000000000");
  provider.complete(job.operation_id, 0); await due(job.id); await jobs.advance(undefined, job.id);
  assert.equal((await jobs.read(f.actor, f.tenant, f.project, job.id)).actual_micros, "0");
  assert.equal((await receipt(f.task)).uncertain, false);
});

test("concurrent video quotes share the original budget and exactly one of three excess admissions is refused before HTTP", async () => {
  const f = await fixture(), before = provider.calls.length;
  const outcomes = await Promise.allSettled([1, 2, 3].map(index => f.prepare({ ...f.body, prompt: "Distinct quoted clip " + index })));
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 2);
  assert.equal(outcomes.filter(result => result.status === "rejected").length, 1);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM ai_video_jobs WHERE task_id=$1", [f.task.id])).rows[0].n, 2);
  assert.equal(provider.calls.length, before);
});

test("cancelling before dispatch proves zero while cancel versus completion retains actual paid usage", async () => {
  const first = await fixture(), prepared = await first.prepare(), before = provider.calls.length;
  const key = randomUUID();
  const cancelled = await videoOK(s, first.c, "POST", first.base + "/generated-video-jobs/" + prepared.id + "/cancel", { expected_revision: prepared.revision }, key);
  assert.deepEqual(await videoOK(s, first.c, "POST", first.base + "/generated-video-jobs/" + prepared.id + "/cancel", { expected_revision: prepared.revision }, key), cancelled);
  await jobs.advance(undefined, prepared.id);
  assert.equal((await row(prepared.id)).actual_micros, "0"); assert.equal(provider.calls.length, before);
  const second = await fixture(), active = await second.prepare(); provider.state.initial = "queued"; provider.state.cancelCompletes = true;
  await jobs.advance(undefined, active.id);
  const current = await jobs.read(second.actor, second.tenant, second.project, active.id);
  await jobs.cancel(second.actor, second.tenant, second.project, active.id, current.revision);
  await due(active.id); await jobs.advance(undefined, active.id);
  const terminal = await row(active.id);
  assert.equal(terminal.state, "completed"); assert.equal(terminal.actual_micros, "400000"); assert.equal(terminal.output_asset_id, null);
  assert.equal(terminal.delivery_state, "blocked"); assert.ok(terminal.cancel_requested_at);
});

test("customer and Admin revisions ignore background leases but reject a stale changed video outcome", async () => {
  const f = await fixture(), prepared = await f.prepare(); provider.state.initial = "queued";
  await jobs.advance(undefined, prepared.id);
  const visible = await jobs.read(f.actor, f.tenant, f.project, prepared.id), internal = await row(prepared.id);
  await due(prepared.id); await jobs.advance(undefined, prepared.id);
  await s.db.control.query("UPDATE ai_video_jobs SET lease_token=$2,lease_until=clock_timestamp()+interval '45 seconds',revision=revision+1 WHERE id=$1", [prepared.id, randomUUID()]);
  await s.db.control.query("UPDATE ai_video_jobs SET lease_until=clock_timestamp()+interval '45 seconds',revision=revision+1 WHERE id=$1", [prepared.id]);
  await s.db.control.query("UPDATE ai_video_jobs SET lease_token=NULL,lease_until=NULL,revision=revision+1 WHERE id=$1", [prepared.id]);
  assert.ok((await row(prepared.id)).revision > internal.revision);
  assert.equal((await jobs.read(f.actor, f.tenant, f.project, prepared.id)).revision, visible.revision);
  const operator = await videoAdmin(s, ["admin.ai.requests.read", "admin.ai.cost.reconcile"], "tenant", f.tenant);
  const recheck = await videoAdminCall(s, operator, "POST", "/v1/admin/ai/video-jobs/" + prepared.id + "/recheck",
    { expected_revision: visible.revision, reason: "Recheck original operation after background maintenance" });
  assert.equal(recheck.status, 200, JSON.stringify(recheck.data));
  assert.equal(recheck.data.revision, visible.revision + 1);
  const progress = provider.update(prepared.operation_id, { status: "in_progress", progress: 35 });
  assert.equal((await callback(prepared, progress)).statusCode, 200);
  const base = f.base + "/generated-video-jobs/" + prepared.id + "/cancel";
  const stale = await videoCall(s, f.c, "POST", base, { expected_revision: recheck.data.revision });
  assert.equal(stale.status, 409); assert.equal(stale.data.error.code, "VIDEO_REVISION_CONFLICT");
  assert.equal((await row(prepared.id)).cancel_requested_at, null);
  const current = await jobs.read(f.actor, f.tenant, f.project, prepared.id), key = randomUUID();
  const cancelled = await videoOK(s, f.c, "POST", base, { expected_revision: current.revision }, key);
  assert.equal(cancelled.cancel_requested, true); assert.equal(cancelled.revision, current.revision + 1);
  assert.deepEqual(await videoOK(s, f.c, "POST", base, { expected_revision: current.revision }, key), cancelled);
});

test("authenticated observations deduplicate and reject conflicting, stale-signature and cross-operation callbacks", async () => {
  const f = await fixture(), job = await f.prepare(); provider.state.initial = "queued"; await jobs.advance(undefined, job.id);
  const completed = provider.complete(job.operation_id);
  const first = await callback(job, completed); assert.equal(first.statusCode, 200, first.body); generatedVideoObservationReceipt.parse(first.json());
  const repeated = await callback(job, completed); assert.equal(repeated.statusCode, 200); assert.equal(repeated.json().duplicate, true);
  const forged = await callback(job, completed, { signature: "v1=" + "0".repeat(64) }); assert.equal(forged.statusCode, 401);
  assert.equal((await callback(job, completed, { timestamp: String(Date.now() - 300001) })).statusCode, 401);
  assert.equal((await callback(job, { ...completed, event_id: randomUUID(), usage: { billable_seconds: 3 } })).statusCode, 409);
  assert.equal((await callback(job, { ...completed, operation_id: randomUUID() })).statusCode, 502);
  assert.equal((await row(job.id)).actual_micros, "400000");
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM ai_video_observations WHERE job_id=$1", [job.id])).rows[0].n, 2);
});

test("revoking a reference while real media is in flight blocks publication and generic downloads retain source fences", async () => {
  const f = await fixture(true), job = await f.prepare();
  provider.state.beforeContent = async () => { await s.db.control.query("UPDATE assets SET state='quarantined' WHERE id=$1", [f.source!.id]); };
  await jobs.advance(undefined, job.id);
  const done = await row(job.id);
  assert.equal(done.state, "completed"); assert.equal(done.actual_micros, "400000"); assert.equal(done.output_asset_id, null); assert.equal(done.delivery_state, "blocked");
  provider.state.beforeContent = undefined;
  const other = await fixture(true), available = await other.prepare(); await jobs.advance(undefined, available.id);
  const asset = (await jobs.read(other.actor, other.tenant, other.project, available.id)).assets[0]; assert.ok(asset);
  await s.db.control.query("UPDATE assets SET retention_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [other.source!.id]);
  assert.equal((await videoCall(s, other.c, "GET", other.base + "/generated-video-jobs/" + available.id)).data.assets.length, 0);
  const download = await s.app.inject({ method: "GET", url: other.base + "/assets/" + asset.id + "/download?version=1", headers: { Authorization: "Bearer " + other.c.access_token } });
  assert.equal(download.statusCode, 404);
});

test("completed status with corrupt actual bytes cannot fabricate an MP4 asset or erase its measured fee", async () => {
  const f = await fixture(), job = await f.prepare(); provider.state.corruptContent = true;
  await jobs.advance(undefined, job.id);
  const done = await jobs.read(f.actor, f.tenant, f.project, job.id);
  assert.equal(done.state, "completed"); assert.equal(done.actual_micros, "400000"); assert.equal(done.delivery_state, "invalid"); assert.deepEqual(done.assets, []);
  assert.equal(done.delivery_error, "GENERATED_VIDEO_INTEGRITY_FAILED");
});

test("same-project peers and other tenants cannot list, read, preview or cancel a private generated operation", async () => {
  const f = await fixture(), job = await f.prepare(); await jobs.advance(undefined, job.id);
  const peer = await videoActor(s);
  await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role,status) VALUES($1,$2,'member','active')", [f.tenant, peer.c.id]);
  await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')", [f.tenant, f.project, peer.c.id]);
  const base = f.base + "/generated-video-jobs";
  assert.equal((await videoOK(s, peer.c, "GET", base)).items.length, 0);
  for (const suffix of ["", "/preview"]) assert.equal((await videoCall(s, peer.c, "GET", base + "/" + job.id + suffix)).status, 404);
  assert.equal((await videoCall(s, peer.c, "POST", base + "/" + job.id + "/cancel", { expected_revision: (await row(job.id)).revision })).status, 404);
  const outsider = await nativeVideoFixture(s);
  assert.equal((await videoCall(s, outsider.c, "GET", base + "/" + job.id)).status, 404);
});

test("over-quote final usage is retained as an immutable violation and cannot publish or silently consume a larger budget", async () => {
  const f = await fixture(), job = await f.prepare(); provider.state.initialUsage = 8;
  await jobs.advance(undefined, job.id);
  const observed = await row(job.id);
  assert.equal(observed.actual_micros, "800000"); assert.equal(observed.quoted_micros, "400000"); assert.equal(observed.delivery_state, "blocked");
  assert.equal((await receipt(f.task)).violation, true);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM ai_video_budget_violations WHERE job_id=$1", [job.id])).rows[0].n, 1);
  await assert.rejects(s.db.control.query("UPDATE ai_video_jobs SET billable_seconds=4,revision=revision+1 WHERE id=$1", [job.id]), /Immutable video usage/);
  await assert.rejects(f.prepare({ ...f.body, prompt: "Do not bypass the original uncertain budget" }));
});

test("an interrupted processor resumes only its retained operation and concurrent processors never dispatch twice", { timeout: 60000 }, async () => {
  const f = await fixture(), job = await f.prepare(), before = provider.calls.length;
  const abort = new AbortController();
  let entered!: () => void, release!: () => void;
  const submitted = new Promise<void>(resolve => { entered = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
  provider.state.beforeCreateResponse = async () => { entered(); await barrier; };
  const processing = jobs.advance(abort.signal, job.id);
  try {
    await Promise.race([submitted, processing.then(() => { throw new Error("Processor finished before dispatch"); })]);
    assert.equal(await new GeneratedVideoJobs(s.db, s.catalog, s.storage).advance(undefined, job.id), null);
    abort.abort();
  } finally { release(); }
  await processing;
  assert.equal((await row(job.id)).state, "unknown");
  assert.equal((await receipt(f.task)).uncertain, true);
  provider.state.beforeCreateResponse = undefined; await due(job.id);
  await new GeneratedVideoJobs(s.db, s.catalog, s.storage).advance(undefined, job.id);
  assert.equal((await jobs.read(f.actor, f.tenant, f.project, job.id)).delivery_state, "available");
  assert.equal(provider.calls.slice(before).filter(call => call.path === "/v1/videos").length, 1);
});

test("an expired processor cannot overwrite a replacement lease or publish a second paid result", { timeout: 60000 }, async () => {
  const f = await fixture(), job = await f.prepare(), before = provider.calls.length;
  let entered!: () => void, release!: () => void;
  const submitted = new Promise<void>(resolve => { entered = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
  provider.state.beforeCreateResponse = async () => { entered(); await barrier; };
  const first = jobs.advance(undefined, job.id);
  try {
    await Promise.race([submitted, first.then(() => { throw new Error("Processor finished before dispatch"); })]);
    await s.db.control.query("UPDATE ai_video_jobs SET lease_until=clock_timestamp()-interval '1 second',next_poll_at=clock_timestamp(),revision=revision+1 WHERE id=$1", [job.id]);
    await new GeneratedVideoJobs(s.db, s.catalog, s.storage).advance(undefined, job.id);
  } finally { release(); await first; provider.state.beforeCreateResponse = undefined; }
  const observed = await row(job.id);
  assert.equal(observed.delivery_state, "available"); assert.equal(observed.actual_micros, "400000");
  assert.equal(observed.lease_token, null);
  assert.equal(provider.calls.slice(before).filter(call => call.path === "/v1/videos").length, 1);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM asset_versions WHERE metadata->>'video_job_id'=$1", [job.id])).rows[0].n, 1);
});

test("revoked native login permits resource-only cost reconciliation while refusing content download and new generation", async () => {
  const f = await fixture(), job = await f.prepare(); provider.state.initial = "queued";
  await jobs.advance(undefined, job.id);
  const before = provider.calls.length;
  await videoOK(s, f.c, "POST", "/v1/auth/logout", {});
  provider.complete(job.operation_id); await due(job.id); await jobs.advance(undefined, job.id);
  const observed = await row(job.id);
  assert.equal(observed.actual_micros, "400000"); assert.equal(observed.delivery_state, "blocked"); assert.equal(observed.output_asset_id, null);
  assert.ok(provider.calls.slice(before).some(call => call.method === "GET" && call.path === "/v1/videos/" + observed.provider_id));
  assert.ok(provider.calls.slice(before).every(call => call.method === "GET" && !call.path.endsWith("/content")));
  assert.equal((await videoCall(s, f.c, "POST", f.url + "/tools", videoToolRequest("generated_video_create", { ...f.body, prompt: "Must not dispatch after logout" }))).status, 401);
});

test("higher sequence observations cannot regress active progress or replace a retained terminal state", async () => {
  const f = await fixture(), job = await f.prepare(); provider.state.initial = "queued"; await jobs.advance(undefined, job.id);
  const progress = provider.update(job.operation_id, { status: "in_progress", progress: 60 });
  assert.equal((await callback(job, progress)).statusCode, 200);
  assert.equal((await callback(job, { ...progress, event_id: randomUUID(), sequence: progress.sequence + 1, status: "queued", progress: null })).statusCode, 409);
  assert.equal((await callback(job, { ...progress, event_id: randomUUID(), sequence: progress.sequence + 1, progress: 30 })).statusCode, 409);
  assert.equal((await row(job.id)).progress, 60);
  const complete = provider.complete(job.operation_id);
  assert.equal((await callback(job, complete)).statusCode, 200);
  assert.equal((await callback(job, { ...complete, event_id: randomUUID(), sequence: complete.sequence + 1, status: "failed", content: null, error: { code: "SYNTHETIC_CONFLICT" } })).statusCode, 409);
  assert.equal((await row(job.id)).state, "completed"); assert.equal((await row(job.id)).actual_micros, "400000");
});

test("a pre-upgrade native video task keeps its frozen role, Skills and seven template tools without new paid capabilities", async () => {
  const f = await nativeVideoFixture(s), retainedHash = "eb97d58eb42e3f80fd784da3841b76f122862b7e39c17e75b7f89894c2e27384";
  const index = s.catalog.roles.findIndex(role => role.role_key === "video-motion"), current = s.catalog.roles[index], old = s.catalog.role("video-motion", retainedHash);
  assert.equal(s.catalog.digest(old), retainedHash); assert.equal(old.version, "1.1.0");
  assert.ok(!old.tool_ids.includes("video.generate.internal"));
  let created: any;
  try {
    s.catalog.roles[index] = old;
    created = await videoOK(s, f.c, "POST", f.base + "/desktop-executions", { ...f.fields,
      title: "Frozen role from before the upgrade", prompt: "Retain the original template composition authority", role_key: "video-motion", budget_micros: 1000000 });
  } finally { s.catalog.roles[index] = current; }
  const url = f.base + "/desktop-executions/" + created.task_id, started = await videoOK(s, f.c, "POST", url + "/start", f.fields);
  assert.equal((await s.db.control.query("SELECT role_hash FROM tasks WHERE id=$1", [created.task_id])).rows[0].role_hash, retainedHash);
  assert.equal(started.company_tools.filter((tool: any) => tool.name.startsWith("video_project") || tool.name === "video_projects").length, 7);
  assert.ok(started.company_tools.every((tool: any) => !tool.name.startsWith("generated_video_")));
  assert.ok(started.skills.every((skill: any) => skill.key !== "video-generation"));
  assert.equal((await videoCall(s, f.c, "POST", url + "/tools", videoToolRequest("generated_video_create", spec))).status, 403);
  assert.equal(s.catalog.role("video-motion").version, "1.3.0");
  const retainedVideo = s.catalog.historicalRoles.find(role => role.role_key === "video-motion" && role.version === "1.2.0");
  assert.ok(retainedVideo, "The published video-generation role remains addressable after audio is added");
  assert.ok(retainedVideo.tool_ids.includes("video.generate.internal"));
  assert.ok(!retainedVideo.tool_ids.includes("speech.generate.internal"));
  await videoOK(s, f.c, "POST", url + "/finish", videoFinish);
});

test("video Admin metadata, cost visibility and recheck obey separate scoped permissions and current MFA", async () => {
  const f = await fixture(), first = await f.prepare(); provider.state.initial = "queued"; await jobs.advance(undefined, first.id);
  const other = await fixture(), second = await other.prepare();
  const reader = await videoAdmin(s, ["admin.ai.requests.read"], "tenant", f.tenant);
  const listing = await videoAdminCall(s, reader, "GET", "/v1/admin/ai/video-jobs");
  assert.equal(listing.status, 200, JSON.stringify(listing.data));
  generatedVideoAdminList.parse(listing.data);
  assert.deepEqual(listing.data.items.map((j: any) => j.id), [first.id]); assert.equal(listing.data.items[0].cost, null);
  assert.ok(!JSON.stringify(listing.data).includes(spec.prompt)); assert.ok(!JSON.stringify(listing.data).includes("specification"));
  const route = "/v1/admin/ai/video-jobs/" + first.id + "/recheck";
  const body = { expected_revision: (await row(first.id)).public_revision, reason: "Recheck the retained company operation" };
  assert.equal((await videoAdminCall(s, reader, "POST", route, body)).status, 403);
  const operator = await videoAdmin(s, ["admin.ai.requests.read", "admin.ai.cost.read", "admin.ai.cost.reconcile"], "tenant", f.tenant);
  const costs = await videoAdminCall(s, operator, "GET", "/v1/admin/ai/video-jobs");
  assert.equal(costs.status, 200); assert.equal(costs.data.items[0].cost.quoted_micros, "400000"); assert.equal(costs.data.items[0].cost.actual_micros, null);
  const key = randomUUID(), count = provider.calls.length;
  const recheck = await videoAdminCall(s, operator, "POST", route, body, key);
  assert.equal(recheck.status, 200, JSON.stringify(recheck.data)); assert.equal(recheck.data.generation_submitted, false);
  generatedVideoRecheckReceipt.parse(recheck.data);
  assert.deepEqual((await videoAdminCall(s, operator, "POST", route, body, key)).data, recheck.data);
  assert.equal(provider.calls.length, count);
  assert.equal((await videoAdminCall(s, operator, "POST", "/v1/admin/ai/video-jobs/" + second.id + "/recheck",
    { ...body, expected_revision: (await row(second.id)).public_revision })).status, 403);
  await s.db.control.query("UPDATE sessions SET mfa_at=clock_timestamp()-interval '1 hour' WHERE admin_id=$1", [operator.id]);
  assert.equal((await videoAdminCall(s, operator, "POST", route, { ...body, expected_revision: (await row(first.id)).public_revision })).status, 403);
});

test("real native Codex completes generated video tools through the company gateway and persists exact job history with one settlement", { timeout: 180000 }, async t => {
  const executable = process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN;
  assert.ok(executable && path.isAbsolute(executable), "Use the explicit pinned native binary; no PATH fallback");
  const { LocalAgentController } = await import(new URL("../../copypaste-desktop/src/local-agent.ts", import.meta.url).href);
  const f = await nativeVideoFixture(s), directory = path.join(owned.directory, "generated-native-" + randomUUID()); await mkdir(directory);
  await s.app.listen({ host: "127.0.0.1", port: 0 });
  const origin = "http://127.0.0.1:" + (s.app.server.address() as any).port;
  let journal: any, step = 0, pending: { call: string; tool: string } | null = null, jobId = "";
  const observations: string[] = [], before = provider.calls.length;
  provider.state.textItem = (body, serial) => {
    if (pending) {
      const result = body.input.find((entry: any) => entry.type === "function_call_output" && entry.call_id === pending!.call);
      assert.ok(result, "The actual native tool result must reach company reasoning before it continues");
      const value = JSON.parse(typeof result.output === "string" ? result.output : result.output[0].text);
      generatedVideoMetadata.parse(value);
      assert.equal(value.state, "completed"); assert.equal(value.delivery_state, "available");
      assert.equal(value.assets[0].sha256, provider.sha256); assert.equal(value.actual_micros, "400000");
      if (jobId) assert.equal(value.id, jobId); jobId = value.id; observations.push(pending.tool); pending = null;
    }
    if (step < 2) {
      const tool = step++ === 0 ? "generated_video_create" : "generated_video_status", call = "call_generated_native_" + serial;
      assert.ok(body.tools.some((namespace: any) => namespace.name === "copypaste" && namespace.tools?.some((entry: any) => entry.name === tool)));
      pending = { call, tool };
      return { type: "function_call", id: "fc_generated_native_" + serial, call_id: call, namespace: "copypaste", name: tool,
        arguments: JSON.stringify(tool === "generated_video_create" ? spec : { job_id: jobId }) };
    }
    return { type: "message", id: "msg_generated_native_" + serial, role: "assistant", status: "completed",
      content: [{ type: "output_text", text: "The explicit synthetic clip is validated and available through the original company task.", annotations: [] }] };
  };
  const controller = new LocalAgentController({
    read: async () => journal, write: async (j: any) => { journal = structuredClone(j); },
    identity: async () => ({ actorId: f.c.id, epoch: "owned-generated-native-login" }), localEpoch: async () => "owned-generated-native-login",
    chooseWorkspace: async () => directory, consent: async () => true, approval: async () => "decline", changed: () => {},
    stateRoot: path.join(directory, "codex-state"), companyOrigin: origin, executable,
    runtime: { version: desktopRuntime.pinned_version, sha256: desktopRuntime.windows_x64_sha256 },
    request: async (url: string, options: any = {}) => {
      const raw = await fetch(origin + url, { method: options.method ?? "GET", headers: { Authorization: "Bearer " + f.c.access_token,
        "Content-Type": "application/json", "Idempotency-Key": options.idempotencyKey ?? randomUUID(), "X-Tenant-ID": f.tenant },
        body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal });
      return { status: raw.status, body: await raw.json() };
    },
  });
  try {
    const session = await controller.create({ tenant: f.tenant, project: f.project }, "video-motion");
    await controller.permission(session.id, "full-access");
    await controller.send(session.id, "Generate the explicitly synthetic four second company video, then check the original job.", 1000000);
    const state = (await controller.list({ tenant: f.tenant, project: f.project })).sessions[0];
    if (state.task?.status !== "succeeded") t.diagnostic(JSON.stringify({ native_state: state, provider_errors: provider.errors }));
    assert.equal(state.task?.status, "succeeded");
    assert.deepEqual(observations, ["generated_video_create", "generated_video_status"]);
    const current = (await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [state.task.task_id])).rows[0];
    assert.equal(current.execution_location, "desktop"); assert.equal(current.charged_micros, "400090");
    assert.ok(current.runtime_thread && current.runtime_turn);
    const history = state.events.filter((event: any) => event.kind === "local.company-tool.completed" && event.value.generated_video);
    assert.equal(history.length, 2);
    for (const event of history) assert.deepEqual(event.value.generated_video, { job_id: jobId, task_id: current.id });
    assert.equal(provider.calls.slice(before).filter(call => call.path === "/v1/videos" && call.method === "POST").length, 1);
    assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'", [current.id])).rows[0].n, 1);
    assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM outbox WHERE topic='task.run' AND payload->>'task_id'=$1", [current.id])).rows[0].n, 0);
    t.diagnostic(JSON.stringify({ native_binary_sha256: desktopRuntime.windows_x64_sha256, company_dynamic_tools: observations,
      generation_submissions: 1, charged_micros: current.charged_micros, cloud_agent_dispatches: 0, model_and_video_content: "explicit_synthetic_fixtures", actual_Electron_consent: "not_validated_here" }));
  } finally { provider.state.textItem = undefined; await controller.close(); }
});

test("a video-only uncertain task holds funds until final usage and settles exactly once through two independent Admins", async () => {
  const f = await fixture(), job = await f.prepare(); provider.state.initial = "queued"; await jobs.advance(undefined, job.id);
  await videoOK(s, f.c, "POST", f.url + "/finish", videoFinish);
  assert.equal((await s.db.control.query("SELECT status FROM tasks WHERE id=$1", [f.task.id])).rows[0].status, "reconciling");
  const operator = await videoAdmin(s), reviewer = await videoAdmin(s);
  const facts = await videoAdminCall(s, operator, "GET", "/v1/admin/ai/tasks/" + f.task.id + "/settlement");
  assert.equal(facts.status, 200, JSON.stringify(facts.data)); assert.equal(facts.data.reservation.status, "reconciling");
  const command = { action: "ai.tasks.settle", task_id: f.task.id, expected_task_version: facts.data.task.version,
    acknowledge_violation_ids: [], reason: "Settle the original video job after measured usage only" };
  assert.equal((await videoAdminCall(s, operator, "POST", "/v1/admin/ai/previews", command)).status, 409);
  provider.complete(job.operation_id); await due(job.id); await jobs.advance(undefined, job.id);
  assert.equal((await row(job.id)).actual_micros, "400000"); assert.equal((await row(job.id)).delivery_state, "blocked");
  const preview = await videoAdminCall(s, operator, "POST", "/v1/admin/ai/previews", command);
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.equal(preview.data.before.receipt.knownChargeMicros, 400000);
  assert.equal(preview.data.before.facts[0].channel, "video"); assert.equal(preview.data.before.facts[0].operation_id, job.operation_id);
  const submit = await videoAdminCall(s, operator, "POST", "/v1/admin/ai/operations", { command,
    preview_id: preview.data.preview_id });
  assert.equal(submit.status, 202, JSON.stringify(submit.data));
  const op = submit.data;
  const review = await videoAdminCall(s, reviewer, "GET", "/v1/admin/operations/" + op.id + "/approval");
  assert.equal(review.status, 200, JSON.stringify(review.data));
  const decisionPath = "/v1/admin/approvals/" + review.data.id + "/decisions";
  const decision = { decision: "approve", expected_version: review.data.version, payload_hash: review.data.payload_hash,
    reason: "Independently reviewed the exact retained video usage" };
  assert.equal((await videoAdminCall(s, operator, "POST", decisionPath, decision)).status, 403);
  const approval = await videoAdminCall(s, reviewer, "POST", decisionPath, decision);
  assert.equal(approval.status, 202, JSON.stringify(approval.data));
  const task = (await s.db.control.query("SELECT status,charged_micros FROM tasks WHERE id=$1", [f.task.id])).rows[0];
  assert.equal(task.status, "failed"); assert.equal(task.charged_micros, "400000");
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'", [f.task.id])).rows[0].n, 1);
  assert.equal((await videoAdminCall(s, operator, "POST", "/v1/admin/ai/previews", command)).status, 409);
});

test("video holds and measured native reasoning spend share the same original budget in both admission directions", async () => {
  const inference = (credential: string) => s.app.inject({ method: "POST", url: "/v1/desktop-inference/v1/responses",
    headers: { Authorization: "Bearer " + credential, "Content-Type": "application/json" },
    payload: JSON.stringify({ model: "synthetic-video-reasoning-v1", reasoning: { effort: "max" }, stream: true,
      input: "Explicit synthetic shared budget fixture", tools: [], max_output_tokens: 32 }) });
  const videoFirst = await fixture(), pending = await videoFirst.prepare(); provider.state.textCount = 700000;
  const start = provider.calls.length, denied = await inference(videoFirst.started.credential.token);
  assert.equal(denied.statusCode, 429, denied.body);
  assert.ok(provider.calls.slice(start).some(call => call.path.endsWith("/input_tokens")));
  assert.ok(provider.calls.slice(start).every(call => call.path !== "/v1/responses"));
  assert.equal((await row(pending.id)).quoted_micros, "400000");
  const textFirst = await fixture(), accepted = await inference(textFirst.started.credential.token);
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal((await receipt(textFirst.task)).knownChargeMicros, 700020);
  await assert.rejects(textFirst.prepare(), /Video task budget unavailable/);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM ai_video_jobs WHERE task_id=$1", [textFirst.task.id])).rows[0].n, 0);
});

test("video admission includes completed input counts in rate limits and shares live concurrency with reasoning", async () => {
  const limits = async (slots: number, rpm: number) => {
    const policy = (await s.db.control.query(`INSERT INTO ai_gateway_policy_versions(data_mode,version,global_slots,tenant_slots,actor_slots,text_slots,image_slots,video_slots,verification_slots,
      global_rpm,tenant_rpm,actor_rpm,text_rpm,image_rpm,video_rpm,verification_rpm,preparation_seconds,reason)
      VALUES('configured_services',(SELECT max(version)+1 FROM ai_gateway_policy_versions WHERE data_mode='configured_services'),1000,$1,1000,1000,1000,1000,1000,
      100000,$2,100000,100000,100000,100000,100000,30,'Canonical input-count/video admission regression') RETURNING id`, [slots, rpm])).rows[0];
    await s.db.control.query("UPDATE ai_gateway_policy_heads SET policy_version_id=$1 WHERE data_mode='configured_services'", [policy.id]);
  };
  const inference = (credential: string) => s.app.inject({ method: "POST", url: "/v1/desktop-inference/v1/responses",
    headers: { Authorization: "Bearer " + credential, "Content-Type": "application/json" },
    payload: JSON.stringify({ model: "synthetic-video-reasoning-v1", reasoning: { effort: "max" }, stream: true,
      input: "Explicit synthetic admission fixture", tools: [], max_output_tokens: 32 }) });
  const f = await fixture();
  await limits(1, 2);
  const before = provider.calls.length, accepted = await inference(f.started.credential.token);
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.deepEqual(provider.calls.slice(before).map(call => call.path), ["/v1/responses/input_tokens", "/v1/responses"]);
  const requests = (await s.db.control.query("SELECT channel,state,capacity_held FROM current_ai_provider_requests WHERE task_id=$1 ORDER BY channel", [f.task.id])).rows;
  assert.deepEqual(requests, [{ channel: "generation", state: "completed", capacity_held: false }, { channel: "input_count", state: "completed", capacity_held: false }]);
  assert.equal((await receipt(f.task)).knownChargeMicros, 30);
  await assert.rejects(f.prepare(), /Video provider capacity unavailable/);
  assert.equal(provider.calls.length, before + 2, "Completed counting and generation retain both minute charges, preventing another submit");
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM ai_video_jobs WHERE task_id=$1", [f.task.id])).rows[0].n, 0);

  const other = await fixture();
  await limits(1, 100000);
  const pending = await other.prepare(), beforeDenied = provider.calls.length;
  const denied = await inference(other.started.credential.token);
  assert.equal(denied.statusCode, 429, denied.body);
  assert.match(denied.body, /AI_REQUEST_TENANT_CAPACITY/);
  assert.equal(provider.calls.length, beforeDenied, "A retained video slot blocks even the input-count HTTP request");
  assert.equal((await row(pending.id)).state, "prepared");
  assert.equal((await row(pending.id)).dispatched_at, null);
});
