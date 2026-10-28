import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { audioProviderFixture, withAudioCustomerConfirmation } from "./audio-production-fixture.js";
import { nativeVideoFixture, startNativeVideo, videoOK, videoCall, videoFinish } from "./desktop-video-fixture.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { AudioProduction } from "../src/audio-production.js";
import { taskProviderBudgetReceipt } from "../src/provider-budgets.js";
import { projectAccess } from "../src/access.js";
import { saveAsset } from "../src/storage.js";
import { canonical, hash } from "../src/lib.js";
import { desktopRuntime } from "../src/desktop-runtime.js";
import { videoAdmin, videoAdminCall } from "./generated-video-admin-fixture.js";
import { setTimeout as delay } from "node:timers/promises";

let owned: Awaited<ReturnType<typeof isolatedTestEnvironment>>, provider: Awaited<ReturnType<typeof audioProviderFixture>>,
  s: Awaited<ReturnType<typeof buildApp>>, audio: AudioProduction;
const speech = { kind: "speech" as const, text: "你好，香港。Hello!", locale: "yue-HK" as const, voice: "alloy", speed: 1,
  rights: { authorized: true as const, reference: "Customer-approved campaign script and verified built-in voice", purpose: "An explicitly synthetic marketing test" } };
before(async () => {
  owned = await isolatedTestEnvironment(); provider = await audioProviderFixture(owned.directory);
  s = await buildApp(loadConfig({ ...owned.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "false", DEMO_MODE: "false",
    AI_BASE_URL: provider.origin, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "synthetic-video-provider-fixture", AI_MODEL: "synthetic-audio-reasoning", AI_VERIFIED: "true",
    AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000", AI_INPUT_COUNT_VERIFIED: "true", AI_INPUT_COUNT_HKD_MICROS_PER_CALL: "0",
    AI_SPEECH_MODEL: "synthetic-speech-v1", AI_SPEECH_VERIFIED: "true", AI_SPEECH_VOICES: "alloy,coral", AI_SPEECH_LOCALES: "en,yue-HK", AI_SPEECH_HKD_MICROS_PER_CHARACTER: "100",
    AI_TRANSCRIPTION_MODEL: "synthetic-transcription-v1", AI_TRANSCRIPTION_VERIFIED: "true", AI_TRANSCRIPTION_LOCALES: "en,zh-HK", AI_TRANSCRIPTION_TIMESTAMPS: "true", AI_TRANSCRIPTION_HKD_MICROS_PER_MILLISECOND: "5",
  }), { worker: false });
  audio = new AudioProduction(s.db, s.catalog, s.storage);
});
beforeEach(async () => {
  provider.state.drop = false; provider.state.corrupt = false; provider.state.status = 200; provider.state.timestamps = true; provider.state.beforeReply = undefined;
  provider.text.state.textItem = undefined;
  const policy = (await s.db.control.query(`INSERT INTO ai_gateway_policy_versions(data_mode,version,global_slots,tenant_slots,actor_slots,text_slots,image_slots,video_slots,audio_slots,
    verification_slots,global_rpm,tenant_rpm,actor_rpm,text_rpm,image_rpm,video_rpm,audio_rpm,verification_rpm,reason)
    VALUES('configured_services',(SELECT coalesce(max(version),0)+1 FROM ai_gateway_policy_versions WHERE data_mode='configured_services'),
      1000,1000,1000,1000,1000,1000,1000,1000,100000,100000,100000,100000,100000,100000,100000,100000,'Explicit synthetic audio test capacity') RETURNING id`)).rows[0];
  await s.db.control.query("UPDATE ai_gateway_policy_heads SET policy_version_id=$1 WHERE data_mode='configured_services'", [policy.id]);
  await s.db.control.query("UPDATE execution_capacity_policy SET agent_slots=100 WHERE data_mode='configured_services'");
});
after(async () => {
  try { assert.deepEqual(provider?.errors ?? [], []); assert.deepEqual(provider?.text.errors ?? [], []); }
  finally { try { await s?.app.close(); } finally { try { await provider?.close(); } finally { await owned?.cleanup(); } } }
});
async function fixture() {
  const f = await nativeVideoFixture(s), start = await startNativeVideo(s, f);
  const task = (await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [start.task.task_id])).rows[0];
  const u = (await s.db.control.query("SELECT * FROM users WHERE id=$1", [f.c.id])).rows[0];
  const actor = { id: u.id, email: u.email, name: u.name, authVersion: u.auth_version, audience: "user" as const, sessionId: "", sessionHash: "" };
  const authorize = async (tx: any) => {
    await projectAccess(tx, actor, f.tenant, f.project, "write");
    const current = (await tx.query("SELECT * FROM tasks WHERE id=$1 FOR UPDATE", [task.id])).rows[0];
    assert.equal(current.fencing_token, task.fencing_token); assert.equal(current.status, "running");
  };
  const prepareUnconfirmed = (input: unknown = speech, call = "audio_" + randomUUID(), signal?: AbortSignal) =>
    audio.prepare(task, task.fencing_token, input, call, authorize, signal);
  const prepare = (input: unknown = speech, call = "audio_" + randomUUID()) =>
    withAudioCustomerConfirmation(s, f.web, f.base, task.id, () => prepareUnconfirmed(input, call), hash(canonical(input)));
  const execute = (id: string, signal?: AbortSignal) => audio.execute(task, id, authorize, signal);
  const read = (id: string) => audio.read(actor, f.tenant, f.project, id);
  return { ...f, ...start, task, actor, authorize, prepare, prepareUnconfirmed, execute, read };
}
async function source(f: Awaited<ReturnType<typeof fixture>>, options: { bytes?: Buffer; task?: boolean } = {}) {
  return s.db.tx(async tx => {
    if (options.task) await tx.query("SELECT set_config('app.task_id',$1,true)", [f.task.id]);
    return saveAsset(tx, s.storage, { tenant: f.tenant, project: f.project, user: f.c.id, name: "explicit-synthetic-tone.wav",
      mime: "audio/wav", kind: "fixture_source", bytes: options.bytes ?? provider.bytes });
  }, f.tenant, false, f.c.id);
}
function transcription(a: any, timestamps = true) {
  return { kind: "transcription", source: { asset_id: a.id, version: a.version.version }, locale: "zh-HK", timestamps,
    rights: { authorized: true, reference: "Owned synthetic test tone", purpose: "Test transcription and subtitle versioning" } };
}
async function receipt(task: any) { return s.db.tx(tx => taskProviderBudgetReceipt(tx, task.id), task.tenant_id, true, task.created_by); }
async function assetBytes(asset: any) {
  const v = (await s.db.control.query("SELECT storage_key FROM asset_versions WHERE asset_id=$1 AND version=$2", [asset.id, asset.version])).rows[0];
  return s.storage.get(v.storage_key);
}
async function pendingAuthorization(f: Awaited<ReturnType<typeof fixture>>, input: unknown = speech, signal?: AbortSignal) {
  const result = f.prepareUnconfirmed(input, "pending_" + randomUUID(), signal).then(value => ({ value }), error => ({ error }));
  const deadline = Date.now() + 10000;
  for (;;) {
    const rows = await videoOK(s, f.web, "GET", f.base + "/audio-authorizations?task_id=" + f.task.id);
    const request = rows.items.find((row: any) => row.state === "pending" && row.specification_hash === hash(canonical(input)));
    if (request) return { request, result };
    assert.ok(Date.now() < deadline, "A current explicit customer proposal is visible"); await delay(20);
  }
}
const decision = (row: any) => ({ expected_revision: row.revision, specification_hash: row.specification_hash, quoted_micros: row.quoted_micros });
const humanConfirmation = (row: any) => ({ ...decision(row), confirm_authorized_use: true,
  rights_reference: "Customer-owned campaign and explicitly synthetic source", purpose: "This customer's exact independent campaign use" });
async function confirmedResult(result: Promise<any>) {
  const outcome = await result; if ("error" in outcome) throw outcome.error; return outcome.value;
}

test("model audio declarations cannot dispatch or reserve audio before an independent customer confirms exact contents and quote", async () => {
  const f = await fixture(), count = provider.calls.length, pending = await pendingAuthorization(f), row = pending.request;
  assert.equal((await receipt(f.task)).requests, 0); assert.equal(provider.calls.length, count);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM ai_audio_jobs WHERE task_id=$1", [f.task.id])).rows[0].n, 0);
  await assert.rejects(audio.authorizations.decide(f.actor, f.tenant, f.project, row.id, "confirm", humanConfirmation(row), randomUUID()), /customer session/);
  for (const [patch, status] of [
    [{ confirm_authorized_use: false }, 400], [{ rights_reference: "" }, 400],
    [{ purpose: "\u0000invalid" }, 400], [{ quoted_micros: "1" }, 409], [{ specification_hash: "f".repeat(64) }, 409],
  ] as const) assert.equal((await videoCall(s, f.web, "POST", `${f.base}/audio-authorizations/${row.id}/confirm`, { ...humanConfirmation(row), ...patch })).status, status);
  const confirmed = await videoOK(s, f.web, "POST", `${f.base}/audio-authorizations/${row.id}/confirm`, humanConfirmation(row));
  assert.equal(confirmed.state, "confirmed"); assert.equal(confirmed.confirmation.rights_reference, humanConfirmation(row).rights_reference);
  const job = await confirmedResult(pending.result); assert.equal(job.authorization_id, row.id);
  assert.equal(job.authorization_basis, "independent_customer_session"); assert.equal(provider.calls.length, count);
  await f.execute(job.id); assert.equal(provider.calls.length, count + 1);
});

test("customer confirmation requires CSRF/current session and cannot be forged by a privileged model-style update", async () => {
  const f = await fixture(), abort = new AbortController(), p = await pendingAuthorization(f, speech, abort.signal);
  try {
    const forged = await s.app.inject({ method: "POST", url: `${f.base}/audio-authorizations/${p.request.id}/confirm`,
      headers: { cookie: f.web.cookie!, "Idempotency-Key": randomUUID() }, payload: humanConfirmation(p.request) });
    assert.equal(forged.statusCode, 403);
    await assert.rejects(s.db.tx(async tx => {
      await tx.query("SELECT set_config('app.task_id',$1,true)", [f.task.id]);
      await tx.query(`UPDATE audio_authorizations SET state='confirmed',confirmed_by=actor_id,
        confirmed_session_id=(SELECT id FROM sessions WHERE user_id=actor_id AND audience='user' LIMIT 1),
        confirmed_at=clock_timestamp(),confirmation=$2,confirmation_hash=$3,revision=revision+1 WHERE id=$1`,
      [p.request.id, { confirm_authorized_use: true, rights_reference: "Forged model claim", purpose: "This is not an independent session action" }, "a".repeat(64)]);
    }, f.tenant, true, f.c.id), /independent current customer session/);
  } finally { abort.abort(); assert.ok("error" in await p.result); }
  assert.equal((await audio.authorizations.read(f.actor, f.tenant, f.project, p.request.id)).state, "cancelled");
});

test("customer decline terminates the waiting tool without audio spend and cannot be revived by model replay", async () => {
  const f = await fixture(), count = provider.calls.length, p = await pendingAuthorization(f);
  const denied = await videoOK(s, f.web, "POST", `${f.base}/audio-authorizations/${p.request.id}/decline`, decision(p.request));
  assert.equal(denied.state, "declined"); assert.ok("error" in await p.result); await assert.rejects(f.prepareUnconfirmed());
  assert.equal(provider.calls.length, count); assert.equal((await receipt(f.task)).requests, 0);
  await assert.rejects(s.db.control.query("UPDATE audio_authorizations SET state='pending',revision=revision+1 WHERE id=$1", [p.request.id]), /cannot be restored/);
});

test("confirmation retries retain one immutable decision and return current withdrawn state instead of stale success", async () => {
  const f = await fixture(), p = await pendingAuthorization(f), b = humanConfirmation(p.request), key = randomUUID(), count = provider.calls.length;
  const first = await videoOK(s, f.web, "POST", `${f.base}/audio-authorizations/${p.request.id}/confirm`, b, key);
  const job = await confirmedResult(p.result);
  const same = await videoOK(s, f.web, "POST", `${f.base}/audio-authorizations/${p.request.id}/confirm`, b, key);
  assert.equal(same.confirmation_hash, first.confirmation_hash); assert.equal(same.revision, first.revision);
  const withdrawn = await videoOK(s, f.c, "POST", `${f.base}/audio-authorizations/${p.request.id}/withdraw`, decision(first));
  const replayed = await videoOK(s, f.web, "POST", `${f.base}/audio-authorizations/${p.request.id}/confirm`, b, key);
  assert.equal(withdrawn.state, "withdrawn"); assert.equal(replayed.state, "withdrawn");
  const stopped = await f.execute(job.id); assert.equal(stopped.state, "cancelled"); assert.equal(stopped.actual_micros, "0");
  assert.equal(provider.calls.length, count); assert.equal((await receipt(f.task)).uncertain, false);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM audio_authorization_events WHERE authorization_id=$1 AND state='confirmed'", [p.request.id])).rows[0].n, 1);
});

test("withdrawing during an audio POST retains the actual late charge and blocks every delivery", async () => {
  const f = await fixture(), job = await f.prepare();
  let arrived!: () => void, release!: () => void;
  const waiting = new Promise<void>(r => arrived = r), barrier = new Promise<void>(r => release = r);
  provider.state.beforeReply = async () => { arrived(); await barrier; };
  const executing = f.execute(job.id);
  try {
    await waiting;
    const row = await videoOK(s, f.web, "GET", f.base + "/audio-authorizations/" + job.authorization_id);
    await videoOK(s, f.web, "POST", `${f.base}/audio-authorizations/${row.id}/withdraw`, decision(row));
    assert.equal((await f.read(job.id)).state, "unknown");
  } finally { release(); }
  const done = await executing; assert.equal(done.state, "completed"); assert.equal(done.actual_micros, job.quoted_micros);
  assert.equal(done.delivery_state, "blocked"); assert.deepEqual(done.assets, []); assert.equal((await receipt(f.task)).uncertain, false);
});

test("withdrawal after task completion blocks original previews/downloads without rewriting original cost or bytes", async () => {
  const f = await fixture(), job = await f.prepare(), done = await f.execute(job.id);
  await videoOK(s, f.c, "POST", f.url + "/finish", videoFinish);
  const row = await videoOK(s, f.web, "GET", f.base + "/audio-authorizations/" + job.authorization_id);
  await videoOK(s, f.web, "POST", `${f.base}/audio-authorizations/${row.id}/withdraw`, decision(row));
  assert.equal((await f.read(job.id)).actual_micros, done.actual_micros); assert.deepEqual((await f.read(job.id)).assets, []);
  assert.notEqual((await videoCall(s, f.c, "GET", `${f.base}/audio-jobs/${job.id}/preview?kind=audio`)).status, 200);
  assert.notEqual((await videoCall(s, f.c, "GET", `${f.base}/assets/${done.assets[0].id}/download?version=1`)).status, 200);
  assert.deepEqual(await assetBytes(done.assets[0]), provider.bytes);
});

test("revoked confirming session blocks dispatch even while another current native session still owns the task", async () => {
  const f = await fixture(), job = await f.prepare(), count = provider.calls.length;
  const row = (await s.db.control.query("SELECT * FROM audio_authorizations WHERE id=$1", [job.authorization_id])).rows[0];
  await s.db.control.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1", [row.confirmed_session_id]);
  await assert.rejects(f.execute(job.id), /current authority/); assert.equal(provider.calls.length, count);
  const stopped = await f.read(job.id); assert.equal(stopped.state, "cancelled"); assert.equal(stopped.actual_micros, "0");
});

test("source quarantine before human confirmation rejects approval and terminates waiting without dispatch", async () => {
  const f = await fixture(), input = await source(f), count = provider.calls.length, p = await pendingAuthorization(f, transcription(input));
  await s.db.control.query("UPDATE assets SET state='quarantined' WHERE id=$1", [input.id]);
  assert.equal((await videoCall(s, f.web, "POST", `${f.base}/audio-authorizations/${p.request.id}/confirm`, humanConfirmation(p.request))).status, 409);
  assert.ok("error" in await p.result); assert.equal(provider.calls.length, count); assert.equal((await receipt(f.task)).requests, 0);
});

test("audio authorization metadata, customer action and independently audited Admin bodies respect separate owner/project/cost scopes", async () => {
  const f = await fixture(), other = await fixture(), abort = new AbortController(), p = await pendingAuthorization(f, speech, abort.signal);
  try {
    await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role,status) VALUES($1,$2,'member','active')", [f.tenant, other.c.id]);
    await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')", [f.tenant, f.project, other.c.id]);
    assert.deepEqual((await videoOK(s, other.c, "GET", f.base + "/audio-authorizations")).items, []);
    assert.equal((await videoCall(s, other.c, "POST", `${f.base}/audio-authorizations/${p.request.id}/confirm`, humanConfirmation(p.request))).status, 404);
    const reader = await videoAdmin(s, ["admin.ai.requests.read"], "project", f.project);
    const list = await videoAdminCall(s, reader, "GET", "/v1/admin/ai/audio-authorizations?task_id=" + f.task.id);
    assert.equal(list.status, 200); assert.equal(list.data.items[0].cost, null);
    for (const body of ["proposal", "confirmation", "specification", "source_probe"]) assert.equal(body in list.data.items[0], false);
    assert.equal((await videoAdminCall(s, reader, "GET", `/v1/admin/ai/audio-authorizations/${p.request.id}/content`)).status, 403);
    const bodyReader = await videoAdmin(s, ["admin.ai.requests.read", "admin.content.body.read"], "project", f.project);
    const body = await videoAdminCall(s, bodyReader, "GET", `/v1/admin/ai/audio-authorizations/${p.request.id}/content`);
    assert.equal(body.status, 200); assert.deepEqual(body.data.proposal, speech); assert.deepEqual(body.data.confirmation, {});
    assert.equal("quoted_micros" in body.data, false);
    assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM audit_log WHERE action='admin.audio.authorization.content.read' AND target=$1", [p.request.id])).rows[0].n, 1);
  } finally { abort.abort(); assert.ok("error" in await p.result); }
});

test("an elapsed immutable proposal expires without an audio job and cannot be approved after its real database deadline", async () => {
  const template = await fixture(), original = await template.prepare(), f = await fixture(), count = provider.calls.length;
  // Represent a genuinely old persisted proposal at INSERT; no trigger is
  // disabled, published fact updated, fake clock or product timeout bypass.
  const expired = await s.db.tx(async tx => {
    await tx.query("SELECT set_config('app.task_id',$1,true)", [f.task.id]);
    return (await tx.query(`INSERT INTO audio_authorizations(tenant_id,project_id,task_id,actor_id,actor_auth_version,
      private_owner,origin_fencing,origin_attempt,data_mode,call_id,capability_version_id,model_alias,gateway_fingerprint,
      specification,specification_hash,quoted_units,rate_micros,quoted_micros,created_at,expires_at)
      SELECT $2,$3,$4,$5,$6,$5,$7,$8,data_mode,'explicit_elapsed_fixture',capability_version_id,model_alias,gateway_fingerprint,
      specification,specification_hash,quoted_units,rate_micros,quoted_micros,clock_timestamp()-interval '5 minutes',
      clock_timestamp()-interval '1 second' FROM audio_authorizations WHERE id=$1 RETURNING *`,
    [original.authorization_id, f.tenant, f.project, f.task.id, f.c.id, f.task.actor_auth_version, f.task.fencing_token, f.task.attempt])).rows[0];
  }, f.tenant, true, f.c.id);
  await assert.rejects(f.prepareUnconfirmed(), (error: any) => error.code === "AUDIO_AUTHORIZATION_EXPIRED");
  const row = await videoOK(s, f.web, "GET", f.base + "/audio-authorizations/" + expired.id);
  assert.equal(row.state, "expired");
  assert.equal((await videoCall(s, f.web, "POST", `${f.base}/audio-authorizations/${row.id}/confirm`, humanConfirmation(row))).status, 409);
  assert.equal(provider.calls.length, count); assert.equal((await receipt(f.task)).requests, 0);
});

test("actual native Stop cancels a waiting authorization without audio fees and task deletion erases confirmed rights bodies but retains hashes", async () => {
  const f = await fixture(), count = provider.calls.length, p = await pendingAuthorization(f);
  await videoOK(s, f.c, "POST", f.url + "/cancel", {});
  assert.ok("error" in await p.result); assert.equal(provider.calls.length, count);
  const stopped = await videoOK(s, f.web, "GET", f.base + "/audio-authorizations/" + p.request.id);
  assert.equal(stopped.state, "cancelled"); assert.equal((await receipt(f.task)).requests, 0);
  const other = await fixture(), job = await other.prepare(); await other.execute(job.id);
  const before = (await s.db.control.query("SELECT * FROM audio_authorizations WHERE id=$1", [job.authorization_id])).rows[0];
  await s.db.control.query("UPDATE tasks SET content_state='deleted' WHERE id=$1", [other.task.id]);
  const after = (await s.db.control.query("SELECT * FROM audio_authorizations WHERE id=$1", [job.authorization_id])).rows[0];
  assert.deepEqual(after.specification, {}); assert.deepEqual(after.confirmation, {}); assert.ok(after.erased_at);
  assert.equal(after.confirmation_hash, before.confirmation_hash); assert.equal(after.specification_hash, before.specification_hash);
  assert.equal((await videoCall(s, other.web, "GET", other.base + "/audio-authorizations/" + job.authorization_id)).status, 404);
  const eventRows = (await s.db.control.query("SELECT * FROM audio_authorization_events WHERE authorization_id=$1 ORDER BY revision", [job.authorization_id])).rows;
  await assert.rejects(s.db.control.query("UPDATE audio_authorization_events SET state='confirmed' WHERE authorization_id=$1", [job.authorization_id]), { code: "42501" });
  const owner = new pg.Client({ connectionString: owned.env.OWNER_DATABASE_URL });
  try {
    await owner.connect();
    await assert.rejects(owner.query("UPDATE audio_authorization_events SET state='confirmed' WHERE authorization_id=$1", [job.authorization_id]), /immutable/i);
  } finally { await owner.end(); }
  assert.deepEqual((await s.db.control.query("SELECT * FROM audio_authorization_events WHERE authorization_id=$1 ORDER BY revision", [job.authorization_id])).rows, eventRows);
});

test("recovery rechecks a renewed task lease after the actual row-lock wait and preserves its confirmed unsubmitted audio", async () => {
  const f = await fixture(), job = await f.prepare(), count = provider.calls.length;
  const owner = new pg.Client({ connectionString: owned.env.OWNER_DATABASE_URL });
  let recovery: Promise<number> | undefined;
  try {
    await owner.connect();
    await s.db.control.query("UPDATE tasks SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [f.task.id]);
    await owner.query("BEGIN");
    await owner.query("SELECT id FROM tasks WHERE id=$1 FOR UPDATE", [f.task.id]);
    // A real concurrent heartbeat renews the lease but has not committed. The
    // recovery scan observes the previous committed expiry, then waits on it.
    await owner.query("UPDATE tasks SET lease_until=clock_timestamp()+interval '10 minutes' WHERE id=$1", [f.task.id]);
    const pid = (await owner.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    recovery = audio.authorizations.recover();
    void recovery.catch(() => {});
    const deadline = Date.now() + 10000;
    for (;;) {
      // This owner keeps the heartbeat transaction open. Refresh its statistics
      // snapshot so each poll can observe a newly blocked recovery connection.
      await owner.query("SELECT pg_stat_clear_snapshot()");
      const waiting = (await owner.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE wait_event_type='Lock' AND $1::int=ANY(pg_blocking_pids(pid))
        AND query='SELECT id FROM tasks WHERE id=$1 FOR UPDATE') AS waiting`, [pid])).rows[0].waiting;
      if (waiting) break;
      assert.ok(Date.now() < deadline, "Observe the actual recovery row-lock wait before committing the heartbeat");
      await delay(10);
    }
    await owner.query("COMMIT");
    await recovery;
    const current = (await s.db.control.query("SELECT * FROM audio_authorizations WHERE id=$1", [job.authorization_id])).rows[0];
    assert.equal(current.state, "confirmed", "A stale pre-lock expiry cannot cancel a current confirmed operation");
    assert.equal((await f.read(job.id)).state, "prepared");
    assert.equal(provider.calls.length, count);
    const done = await f.execute(job.id);
    assert.equal(done.state, "completed"); assert.equal(done.delivery_state, "available");
    assert.equal(provider.calls.length, count + 1);
  } finally {
    await owner.query("ROLLBACK").catch(() => {});
    await owner.end().catch(() => {});
    await recovery?.catch(() => {});
  }
});

test("audio speech persists before network, delivers decoded WAV and settles its company tariff exactly once", async () => {
  const f = await fixture(), count = provider.calls.length, job = await f.prepare();
  assert.equal(provider.calls.length, count); assert.equal(job.actual_micros, null); assert.equal((await receipt(f.task)).uncertain, true);
  const done = await f.execute(job.id);
  assert.equal(done.state, "completed"); assert.equal(done.delivery_state, "available"); assert.equal(done.actual_micros, String([...speech.text].length * 100));
  assert.equal(done.supplier_cost_micros, null); assert.equal(done.decoded_media.fully_decoded, true); assert.equal(done.duration_ms, 2000);
  assert.equal(done.assets.length, 1); assert.equal(done.assets[0].sha256, hash(provider.bytes));
  assert.deepEqual(provider.calls[count].fields, { model: "synthetic-speech-v1", input: speech.text, voice: "alloy", speed: 1, response_format: "wav" });
  assert.equal(provider.calls[count].operation, job.operation_id);
  const preview = await videoOK(s, f.c, "GET", f.base + "/audio-jobs/" + job.id + "/preview?kind=audio");
  assert.deepEqual(Buffer.from(preview.base64, "base64"), provider.bytes); assert.equal(preview.ai_generated, true);
  assert.equal((await s.db.control.query("SELECT private_owner FROM assets WHERE id=$1", [done.assets[0].id])).rows[0].private_owner, f.c.id);
  await videoOK(s, f.c, "POST", f.url + "/finish", videoFinish); await videoOK(s, f.c, "POST", f.url + "/finish", videoFinish);
  assert.equal((await s.db.control.query("SELECT charged_micros FROM tasks WHERE id=$1", [f.task.id])).rows[0].charged_micros, done.actual_micros);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'", [f.task.id])).rows[0].n, 1);
});
test("transcription pins actual source bytes, retains exact raw JSON and exports provider timed SRT and VTT", async () => {
  const f = await fixture(), input = await source(f), start = provider.calls.length, job = await f.prepare(transcription(input)), done = await f.execute(job.id);
  assert.equal(done.state, "completed"); assert.equal(done.actual_micros, "10000"); assert.equal(done.assets.length, 4);
  assert.equal(provider.calls[start].source_sha256, input.version.sha256);
  assert.deepEqual(provider.calls[start].fields, { model: "synthetic-transcription-v1", language: "zh", response_format: "verbose_json", "timestamp_granularities[]": "segment" });
  assert.equal((await assetBytes(done.assets.find(a => a.kind === "raw_response"))).toString(), JSON.stringify(provider.state.transcript));
  const doc = await videoOK(s, f.c, "GET", f.base + "/audio-jobs/" + job.id + "/preview?kind=transcript");
  assert.equal(doc.document.timing_source, "provider_segments_rounded_to_millisecond"); assert.equal(doc.document.cues[1].start_ms, 1000);
  assert.match((await assetBytes(done.assets.find(a => a.kind === "srt"))).toString(), /00:00:01,000 --> 00:00:02,000/);
  assert.match((await assetBytes(done.assets.find(a => a.kind === "vtt"))).toString(), /^WEBVTT/);
});
test("text-only transcription never fabricates subtitle times or empty timed exports", async () => {
  const f = await fixture(), input = await source(f); provider.state.timestamps = false;
  const job = await f.prepare(transcription(input, false)), done = await f.execute(job.id);
  assert.equal(done.state, "completed"); assert.deepEqual(done.assets.map(a => a.kind).sort(), ["raw_response", "transcript"]);
  const doc = (await audio.preview(f.actor, f.tenant, f.project, job.id, "transcript") as any).document;
  assert.equal(doc.timing_source, "none"); assert.deepEqual(doc.cues, []);
});
test("subtitle edits preserve original response and audio, enforce exact revisions, and make no new AI request", async () => {
  const f = await fixture(), input = await source(f), job = await f.prepare(transcription(input)), done = await f.execute(job.id), count = provider.calls.length;
  const cues = [{ start_ms: 100, end_ms: 1900, text: "Approved revised subtitle" }], edit = { expected_revision: done.revision, text: cues[0].text, cues, reason: "Customer corrected the copy" }, key = randomUUID();
  const updated = await videoOK(s, f.c, "POST", f.base + "/audio-jobs/" + job.id + "/subtitles", edit, key);
  assert.equal(updated.subtitle_revision, 2); assert.equal(updated.assets.length, 7); assert.equal(provider.calls.length, count);
  assert.equal((await videoOK(s, f.c, "POST", f.base + "/audio-jobs/" + job.id + "/subtitles", edit, key)).revision, updated.revision);
  assert.equal((await videoCall(s, f.c, "POST", f.base + "/audio-jobs/" + job.id + "/subtitles", edit)).status, 409);
  for (const patch of [{ cues: [{ ...cues[0], end_ms: 2001 }] }, { text: "silently missing words" }]) {
    const result = await videoCall(s, f.c, "POST", f.base + "/audio-jobs/" + job.id + "/subtitles", { ...edit, expected_revision: updated.revision, ...patch });
    assert.equal(result.status, 422);
  }
  const original = (await audio.preview(f.actor, f.tenant, f.project, job.id, "transcript", 1) as any).document;
  assert.equal(original.text, provider.state.transcript.text); assert.equal((await receipt(f.task)).knownChargeMicros, 10000);
});
test("audio rights, verified voices, malformed Unicode and cross-project sources reject before provider dispatch", async () => {
  const f = await fixture(), other = await fixture(), file = await source(other), count = provider.calls.length;
  for (const input of [{ ...speech, rights: { ...speech.rights, authorized: false } }, { ...speech, voice: "unverified" }, { ...speech, locale: "zh-HK" }, { ...speech, text: "\ud800" }, transcription(file)])
    await assert.rejects(f.prepare(input));
  assert.equal(provider.calls.length, count); assert.equal((await receipt(f.task)).requests, 0);
});

test("retained audio previews and downloads recheck current source quarantine, while exact files match their recorded hashes", async () => {
  const f = await fixture(), input = await source(f), job = await f.prepare(transcription(input)), done = await f.execute(job.id);
  for (const asset of done.assets) {
    const preview = await videoOK(s, f.c, "GET", `${f.base}/audio-jobs/${job.id}/preview?kind=${asset.kind}&revision=${asset.revision}`);
    const bytes = Buffer.from(preview.base64, "base64");
    assert.equal(hash(bytes), asset.sha256); assert.equal(bytes.length, Number(asset.bytes)); assert.deepEqual(bytes, await assetBytes(asset));
    const response = await s.app.inject({ method: "GET", url: `${f.base}/assets/${asset.id}/download?version=${asset.version}`,
      headers: { authorization: `Bearer ${f.c.access_token}`, "X-Tenant-ID": f.tenant } });
    assert.equal(response.statusCode, 200); assert.equal(hash(response.rawPayload), asset.sha256);
  }
  await s.db.control.query("UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1", [input.id]);
  assert.deepEqual((await f.read(job.id)).assets, []);
  for (const asset of done.assets) {
    assert.notEqual((await videoCall(s, f.c, "GET", `${f.base}/audio-jobs/${job.id}/preview?kind=${asset.kind}&revision=${asset.revision}`)).status, 200);
    assert.notEqual((await videoCall(s, f.c, "GET", `${f.base}/assets/${asset.id}/download?version=${asset.version}`)).status, 200);
  }
});

test("subtitle revisions reject malformed Unicode and overlapping or out-of-duration timing without AI calls", async () => {
  const f = await fixture(), input = await source(f), job = await f.prepare(transcription(input)), done = await f.execute(job.id), count = provider.calls.length;
  for (const patch of [
    { text: "\ud800", cues: [] }, { text: "\u0000", cues: [] },
    { text: "first\nsecond", cues: [{ start_ms: 0, end_ms: 1200, text: "first" }, { start_ms: 1100, end_ms: 1900, text: "second" }] },
    { text: "outside", cues: [{ start_ms: 0, end_ms: 2001, text: "outside" }] },
  ]) {
    const response = await videoCall(s, f.c, "POST", `${f.base}/audio-jobs/${job.id}/subtitles`, { expected_revision: done.revision, reason: "Invalid manual revision fixture", ...patch });
    assert.equal(response.status, patch.text === "\ud800" || patch.text === "\u0000" ? 400 : 422);
  }
  assert.equal(provider.calls.length, count); assert.equal((await f.read(job.id)).subtitle_revision, 1);
});

test("database rejects cross-project or mismatched artifact origin even through a privileged insert", async () => {
  const f = await fixture(), other = await fixture(), job = await f.prepare();
  const foreign = await s.db.tx(tx => saveAsset(tx, s.storage, { tenant: other.tenant, project: other.project, user: other.c.id,
    name: "forged-origin.wav", kind: "audio_production", mime: "audio/wav", bytes: provider.bytes,
    metadata: { audio_job_id: job.id, artifact_kind: "audio", subtitle_revision: 0 } }), other.tenant, false, other.c.id);
  await assert.rejects(s.db.control.query(`INSERT INTO ai_audio_job_artifacts(job_id,revision,kind,asset_id,asset_version,created_by,reason)
    VALUES($1,0,'audio',$2,$3,$4,'Forged cross-project fixture')`, [job.id, foreign.id, foreign.version.version, f.c.id]), /exact origin/);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM ai_audio_job_artifacts WHERE job_id=$1", [job.id])).rows[0].n, 0);
  await audio.cancel(f.actor, f.tenant, f.project, job.id, job.revision, randomUUID());
});
test("audio same-call and same-specification replays retain one operation and changed input conflicts", async () => {
  const f = await fixture(), key = "audio_" + randomUUID(), first = await f.prepare(speech, key);
  assert.equal((await f.prepare(speech, key)).id, first.id); assert.equal((await f.prepare(speech)).id, first.id);
  await assert.rejects(f.prepare({ ...speech, text: "Changed" }, key));
  await f.execute(first.id); await f.execute(first.id);
  assert.equal(provider.calls.filter(c => c.operation === first.operation_id).length, 1);
});
test("concurrent audio quotes share the original budget and cannot reserve three unaffordable operations", async () => {
  const f = await fixture(), result = await Promise.allSettled([0, 1, 2].map(i => f.prepare({ ...speech, text: String(i) + "x".repeat(3999) })));
  assert.equal(result.filter(r => r.status === "fulfilled").length, 2);
  const used = (await s.db.control.query("SELECT ai_budget_used(id,NULL)::text AS n FROM ai_request_budget_envelopes WHERE task_id=$1", [f.task.id])).rows[0];
  assert.equal(used.n, "800000000000");
});
test("audio capacity is a separate explicit policy and shares global slots with text image and video", async () => {
  const f = await fixture(), first = await f.prepare();
  const old = (await s.db.control.query("SELECT p.* FROM ai_gateway_policy_versions p JOIN ai_gateway_policy_heads h ON h.policy_version_id=p.id WHERE h.data_mode='configured_services'")).rows[0];
  const policy = (await s.db.control.query("INSERT INTO ai_gateway_policy_versions(data_mode,version,global_slots,audio_slots,audio_rpm,reason) VALUES('configured_services',$1,1,1,10,'Audio boundary fixture') RETURNING id", [old.version + 1])).rows[0];
  for (const kind of ["text", "image", "video", "audio"]) assert.equal((await s.db.control.query("SELECT ai_gateway_limit_reason($1,$2,$3,$4,'task') AS r", [policy.id, f.tenant, f.c.id, kind])).rows[0].r, "GLOBAL_CAPACITY");
  assert.equal((await s.db.control.query("SELECT ai_gateway_limit_reason($1,$2,$3,'audio','task',$4) AS r", [old.id, f.tenant, f.c.id, first.id])).rows[0].r, null);
  const disabled = (await s.db.control.query("INSERT INTO ai_gateway_policy_versions(data_mode,version,global_slots,reason) VALUES('configured_services',$1,1000,'Audio disabled by default fixture') RETURNING id", [old.version + 2])).rows[0];
  assert.equal((await s.db.control.query("SELECT ai_gateway_limit_reason($1,$2,$3,'audio','task',$4) AS r", [disabled.id, f.tenant, f.c.id, first.id])).rows[0].r, "CAPABILITY_CAPACITY");
});
test("lost audio POST remains unknown, holds the original funds and never resubmits on replay or recovery", async () => {
  const f = await fixture(), job = await f.prepare(); provider.state.drop = true;
  const done = await f.execute(job.id); assert.equal(done.state, "unknown"); assert.equal(done.actual_micros, null); assert.equal(done.assets.length, 0);
  provider.state.drop = false; await f.execute(job.id); await audio.recover(); assert.equal((await f.prepare()).id, job.id);
  assert.equal(provider.calls.filter(c => c.operation === job.operation_id).length, 1);
  await videoOK(s, f.c, "POST", f.url + "/finish", videoFinish);
  assert.equal((await receipt(f.task)).uncertain, true);
  const state = (await s.db.control.query("SELECT t.status,r.status AS reservation FROM tasks t JOIN reservations r ON r.task_id=t.id WHERE t.id=$1", [f.task.id])).rows[0];
  assert.equal(state.status, "reconciling"); assert.equal(state.reservation, "reconciling");
});
test("corrupt speech bytes and incomplete transcription retain uncertainty without claiming delivery or zero cost", async () => {
  const f = await fixture(), input = await source(f); provider.state.corrupt = true;
  for (const spec of [speech, transcription(input)]) {
    // Unknown spend blocks further operations in the same original envelope.
    const current = spec.kind === "speech" ? f : await fixture();
    const actual = spec.kind === "speech" ? spec : transcription(await source(current));
    const job = await current.prepare(actual), done = await current.execute(job.id);
    assert.equal(done.state, "unknown"); assert.equal(done.actual_micros, null); assert.deepEqual(done.assets, []);
  }
});
test("cancelling prepared audio proves zero and cannot later start HTTP", async () => {
  const f = await fixture(), job = await f.prepare(), count = provider.calls.length;
  const done = await audio.cancel(f.actor, f.tenant, f.project, job.id, job.revision, randomUUID());
  assert.equal(done.state, "cancelled"); assert.equal(done.actual_micros, "0"); await f.execute(job.id); assert.equal(provider.calls.length, count);
  assert.equal((await receipt(f.task)).uncertain, false);
});
test("cancel racing a validated audio response preserves actual charge and blocks late content delivery", async () => {
  const f = await fixture(), job = await f.prepare();
  let arrived!: () => void, release!: () => void;
  const waiting = new Promise<void>(r => arrived = r), barrier = new Promise<void>(r => release = r);
  provider.state.beforeReply = async () => { arrived(); await barrier; };
  const executing = f.execute(job.id); await waiting;
  const current = await f.read(job.id); const cancelled = await audio.cancel(f.actor, f.tenant, f.project, job.id, current.revision, randomUUID());
  assert.equal(cancelled.state, "unknown"); assert.equal(cancelled.actual_micros, null); release();
  const done = await executing; assert.equal(done.state, "completed"); assert.equal(done.actual_micros, job.quoted_micros);
  assert.equal(done.delivery_state, "blocked"); assert.deepEqual(done.assets, []); assert.equal((await receipt(f.task)).uncertain, false);
});
test("source quarantine while transcription is in flight blocks delivery and generated files inherit exact sources", async () => {
  const f = await fixture(), input = await source(f), job = await f.prepare(transcription(input));
  let arrived!: () => void, release!: () => void;
  const waiting = new Promise<void>(r => arrived = r), barrier = new Promise<void>(r => release = r);
  provider.state.beforeReply = async () => { arrived(); await barrier; };
  const executing = f.execute(job.id); await waiting;
  await s.db.control.query("UPDATE assets SET state='quarantined' WHERE id=$1", [input.id]); release();
  const done = await executing; assert.equal(done.state, "completed"); assert.equal(done.delivery_state, "blocked"); assert.deepEqual(done.assets, []);
  assert.equal((await receipt(f.task)).knownChargeMicros, 10000);
});
test("private audio list, source and transcript previews are isolated from same-project peers", async () => {
  const f = await fixture(), other = await fixture(), job = await f.prepare(), done = await f.execute(job.id);
  await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role,status) VALUES($1,$2,'member','active')", [f.tenant, other.c.id]);
  await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')", [f.tenant, f.project, other.c.id]);
  const list = await videoOK(s, other.c, "GET", f.base + "/audio-jobs"); assert.deepEqual(list.items, []);
  assert.equal((await videoCall(s, other.c, "GET", f.base + "/audio-jobs/" + job.id)).status, 404);
  assert.equal((await videoCall(s, other.c, "GET", f.base + "/audio-jobs/" + job.id + "/preview?kind=audio")).status, 404);
  const client = await s.db.app.connect();
  try { await assert.rejects(client.query("SELECT specification FROM ai_audio_jobs"), /permission denied/); } finally { client.release(); }
  assert.equal(done.assets.length, 1);
});
test("Admin audio metadata uses distinct request and cost scopes and returns no prompt rights or transcript bodies", async () => {
  const f = await fixture(), job = await f.prepare(); await f.execute(job.id);
  const admin = await videoAdmin(s);
  const result = await videoAdminCall(s, admin, "GET", "/v1/admin/ai/audio-jobs?task_id=" + f.task.id);
  assert.equal(result.status, 200, JSON.stringify(result.data)); assert.equal(result.data.items.length, 1);
  assert.equal(result.data.items[0].cost.actual_micros, job.quoted_micros);
  for (const forbidden of ["specification", "rights", "text", "source_probe", "assets"]) assert.equal(forbidden in result.data.items[0], false);
  const metadataOnly = await videoAdmin(s, ["admin.ai.requests.read"], "project", f.project);
  const withoutCost = await videoAdminCall(s, metadataOnly, "GET", "/v1/admin/ai/audio-jobs?task_id=" + f.task.id);
  assert.equal(withoutCost.status, 200); assert.equal(withoutCost.data.items[0].cost, null);
  assert.equal((await videoAdminCall(s, metadataOnly, "GET", `/v1/admin/ai/audio-jobs/${job.id}/content`)).status, 403);
  const bodyReader = await videoAdmin(s, ["admin.ai.requests.read", "admin.content.body.read"], "project", f.project);
  const body = await videoAdminCall(s, bodyReader, "GET", `/v1/admin/ai/audio-jobs/${job.id}/content`);
  assert.equal(body.status, 200, JSON.stringify(body.data)); assert.deepEqual(body.data.specification, speech);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM audit_log WHERE action='admin.audio.content.read' AND target=$1", [job.id])).rows[0].n, 1);
});
test("audio immutable operation and usage facts reject direct intent rewrites", async () => {
  const f = await fixture(), job = await f.prepare(); await f.execute(job.id);
  for (const update of ["model_alias='rewritten'", "specification='{}'", "billable_units=0", "state='prepared'"])
    await assert.rejects(s.db.control.query(`UPDATE ai_audio_jobs SET ${update},revision=revision+1 WHERE id=$1`, [job.id]));
});
test("audio waiting locks the task before authorization even with an access-only caller", { timeout: 30000 }, async () => {
  const f = await fixture();
  let enterWait!: () => void, continueWait!: () => void;
  const entered = new Promise<void>(resolve => { enterWait = resolve; }), proceed = new Promise<void>(resolve => { continueWait = resolve; });
  const abort = new AbortController(), blocker = await s.db.control.connect();
  let calls = 0, waitingPid = 0;
  const authorize = async (tx: any) => {
    await projectAccess(tx, f.actor, f.tenant, f.project, "write");
    if (++calls === 2) {
      waitingPid = (await tx.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      enterWait(); await proceed;
    }
  };
  const preparing = audio.prepare(f.task, f.task.fencing_token, speech, "lock_order_" + randomUUID(), authorize, abort.signal);
  void preparing.catch(() => {});
  try {
    await entered;
    const list = await videoOK(s, f.web, "GET", f.base + "/audio-authorizations?task_id=" + f.task.id);
    const pending = list.items.find((r: any) => r.state === "pending"); assert.ok(pending);
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM tasks WHERE id=$1 FOR UPDATE", [f.task.id]);
    continueWait();
    const deadline = Date.now() + 5000;
    while (!(await blocker.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted) AS waiting", [waitingPid])).rows[0].waiting) {
      assert.ok(Date.now() < deadline, "The actual waiter must reach its contested row lock"); await delay(20);
    }
    // The waiter must not hold this row while blocked on the parent task.
    // NOWAIT makes the former authorization -> task inversion deterministic.
    assert.equal((await blocker.query("SELECT id FROM audio_authorizations WHERE id=$1 FOR UPDATE NOWAIT", [pending.id])).rows[0].id, pending.id);
    await blocker.query("ROLLBACK");
    await videoOK(s, f.web, "POST", f.base + "/audio-authorizations/" + pending.id + "/confirm", {
      expected_revision: pending.revision, specification_hash: pending.specification_hash, quoted_micros: pending.quoted_micros,
      confirm_authorized_use: true, rights_reference: "Owned concurrency test script", purpose: "An actual customer confirms after a deliberately contended task lock",
    }, "lock-order-confirm-" + pending.id);
    const job = await preparing;
    assert.equal(job.authorization_id, pending.id); assert.equal(job.state, "prepared");
    assert.equal(provider.calls.filter(c => c.operation === job.operation_id).length, 0);
  } finally {
    abort.abort(); continueWait();
    try { await blocker.query("ROLLBACK"); } finally { blocker.release(); }
    await preparing.catch(() => {});
  }
});

test("real local Codex calls audio through company tools, keeps its native task and settles one charge", { timeout: 180000 }, async t => {
  const executable = process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN; assert.ok(executable && path.isAbsolute(executable));
  const { LocalAgentController } = await import(new URL("../../copypaste-desktop/src/local-agent.ts", import.meta.url).href);
  const f = await nativeVideoFixture(s), directory = path.join(owned.directory, "audio-native-" + randomUUID()); await mkdir(directory);
  await s.app.listen({ host: "127.0.0.1", port: 0 }); const origin = "http://127.0.0.1:" + (s.app.server.address() as any).port;
  let journal: any, callId = "", doneJob: any;
  provider.text.state.textItem = (body, serial) => {
    if (!callId) {
      callId = "call_audio_native_" + serial;
      assert.ok(body.tools.some((namespace: any) => namespace.name === "copypaste" && namespace.tools?.some((entry: any) => entry.name === "audio_produce")),
        "Actual native tools: " + JSON.stringify(body.tools.map((namespace: any) => ({ name: namespace.name, tools: namespace.tools?.map((tool: any) => tool.name) }))));
      return { type: "function_call", id: "fc_audio_native_" + serial, call_id: callId, namespace: "copypaste", name: "audio_produce", arguments: JSON.stringify(speech) };
    }
    const result = body.input.find((entry: any) => entry.type === "function_call_output" && entry.call_id === callId); assert.ok(result);
    doneJob = JSON.parse(typeof result.output === "string" ? result.output : result.output[0].text);
    assert.equal(doneJob.state, "completed"); assert.equal(doneJob.assets[0].sha256, hash(provider.bytes));
    return { type: "message", id: "msg_audio_native_" + serial, role: "assistant", status: "completed",
      content: [{ type: "output_text", text: "Explicit synthetic speech was decoded and delivered through the company task.", annotations: [] }] };
  };
  const controller = new LocalAgentController({ read: async () => journal, write: async (j: any) => { journal = structuredClone(j); },
    identity: async () => ({ actorId: f.c.id, epoch: "owned-audio-login" }), localEpoch: async () => "owned-audio-login",
    chooseWorkspace: async () => directory, consent: async () => true, approval: async () => "decline", changed: () => {},
    stateRoot: path.join(directory, "codex-state"), companyOrigin: origin, executable,
    runtime: { version: desktopRuntime.pinned_version, sha256: desktopRuntime.windows_x64_sha256 },
    request: async (url: string, options: any = {}) => {
      const r = await fetch(origin + url, { method: options.method ?? "GET", headers: { Authorization: "Bearer " + f.c.access_token,
        "Content-Type": "application/json", "Idempotency-Key": options.idempotencyKey ?? randomUUID(), "X-Tenant-ID": f.tenant },
        body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: options.signal });
      return { status: r.status, body: await r.json() };
    } });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const session = await controller.create({ tenant: f.tenant, project: f.project }, "video-motion");
    deadline = setTimeout(() => { t.diagnostic("Stopping only this owned native audio session after its 60 second verification deadline"); void controller.stop(session.id).catch(() => {}); }, 60000);
    await controller.permission(session.id, "full-access");
    await withAudioCustomerConfirmation(s, f.web, f.base, undefined,
      () => controller.send(session.id, "Propose the explicit synthetic speech request; wait for separate customer confirmation.", 1000000));
    const state = (await controller.list({ tenant: f.tenant, project: f.project })).sessions[0];
    if (state.task?.status !== "succeeded") t.diagnostic(JSON.stringify({ native_state: state, errors: provider.errors }));
    assert.equal(state.task?.status, "succeeded"); assert.ok(doneJob?.id);
    const task = (await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [state.task.task_id])).rows[0];
    assert.equal(task.execution_location, "desktop"); assert.equal(task.charged_micros, String([...speech.text].length * 100 + 60));
    assert.equal(provider.calls.filter(c => c.operation === doneJob.operation_id).length, 1);
    assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM outbox WHERE topic='task.run' AND payload->>'task_id'=$1", [task.id])).rows[0].n, 0);
    t.diagnostic(JSON.stringify({ local_codex_sha256: desktopRuntime.windows_x64_sha256, speech: "explicit synthetic 440 Hz WAV", cloud_agent_dispatches: 0, native_tool: "audio_produce", company_tariff: task.charged_micros }));
  } finally { if (deadline) clearTimeout(deadline); provider.text.state.textItem = undefined; await controller.close(); }
});
