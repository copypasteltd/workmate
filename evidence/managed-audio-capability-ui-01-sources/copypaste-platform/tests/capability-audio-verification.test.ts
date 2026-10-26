import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { Ajv2020 } from "ajv/dist/2020.js";
import contract from "../contracts/managed-audio-capability-schemas.json" with { type: "json" };
import pg from "pg";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { audioProviderFixture } from "./audio-production-fixture.js";
import { videoAdmin, videoAdminCall } from "./generated-video-admin-fixture.js";
import { nativeVideoFixture, videoOK, type VideoClient } from "./desktop-video-fixture.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { CapabilityAudioVerification } from "../src/capability-audio-verification.js";
import { seedProviderBudgetPolicy } from "../src/provider-budgets.js";
import { capabilityDocument, capabilityBody, type CapabilityDocument } from "../src/capability-verification.js";
import { capabilityAudioPlan } from "../src/capability-audio-plan.js";
import { taskCapabilities } from "../src/capability-bindings.js";
import { runMigrations } from "../scripts/migration-runner.js";

let owned: Awaited<ReturnType<typeof isolatedTestEnvironment>>, provider: Awaited<ReturnType<typeof audioProviderFixture>>,
  s: Awaited<ReturnType<typeof buildApp>>, worker: CapabilityAudioVerification, owner: pg.Client;
const root = "/v1/admin/capability-releases";
const speech = (model = "synthetic-managed-speech-v1"): Extract<CapabilityDocument, { profile_key: "internal-speech-v1" }> => ({
  kernel: "codex", gateway_policy: "company_internal_only", profile_key: "internal-speech-v1",
  model_alias: model, reasoning_effort: null, rates: [100], voices: ["alloy"], locales: ["en"],
});
const transcription = (timestamps = true): Extract<CapabilityDocument, { profile_key: "internal-transcription-v1" }> => ({
  kernel: "codex", gateway_policy: "company_internal_only", profile_key: "internal-transcription-v1",
  model_alias: "synthetic-managed-transcription-v1", reasoning_effort: null, rates: [1], locales: ["en"], timestamps,
});
const command = (r: any) => ({ expected_version: r.version, reason: "Explicit synthetic managed audio verification" });
const legacyUsed = { name: "before_audio_validation_budget", text: "SELECT ai_budget_used($1::uuid,$2::uuid)::text AS used" };
const legacyBlocked = { name: "before_audio_validation_blocked", text: "SELECT ai_budget_subject_blocked($1::uuid) AS blocked" };
let oldOids: any;
const ajv = new Ajv2020({ allErrors: true }); createRequire(import.meta.url)("ajv-formats")(ajv);
const definitions = JSON.parse(JSON.stringify(contract.schemas).replaceAll("#/components/schemas/", "#/$defs/"));
const schemas = Object.fromEntries(["CapabilityRelease", "CapabilityValidation", "CapabilityPublicationPreview"]
  .map(name => [name, ajv.compile({ $defs: definitions, $ref: "#/$defs/" + name })]));
before(async () => {
  assert.ok(process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN);
  owned = await isolatedTestEnvironment({ throughVersion: 120 });
  owner = new pg.Client({ connectionString: owned.env.OWNER_DATABASE_URL }); await owner.connect();
  oldOids = (await owner.query("SELECT 'ai_budget_used(uuid,uuid)'::regprocedure::oid AS used,'ai_budget_subject_blocked(uuid)'::regprocedure::oid AS blocked")).rows[0];
  assert.equal((await owner.query({ ...legacyUsed, values: [null, null] })).rows[0].used, "0");
  assert.equal((await owner.query({ ...legacyBlocked, values: [null] })).rows[0].blocked, false);
  await runMigrations(owner, "Forward-only managed audio capability upgrade");
  provider = await audioProviderFixture(owned.directory, { allowPlatformVerification: true });
  s = await buildApp(loadConfig({ ...owned.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "false", DEMO_MODE: "false",
    CODEX_BIN: process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN!, AI_BASE_URL: provider.origin, AI_ALLOWED_HOSTS: "127.0.0.1",
    AI_API_KEY: "synthetic-video-provider-fixture", AI_MODEL: "synthetic-reasoning-v1", AI_VERIFIED: "true",
    AI_INPUT_HKD_MICROS_PER_MILLION: "100", AI_OUTPUT_HKD_MICROS_PER_MILLION: "100", AI_INPUT_COUNT_VERIFIED: "true", AI_INPUT_COUNT_HKD_MICROS_PER_CALL: "0",
    AI_SPEECH_VERIFIED: "false", AI_TRANSCRIPTION_VERIFIED: "false", AI_VERIFICATION_PER_RUN_BUDGET_MICROS: "1000000",
    AI_PLATFORM_VERIFICATION_DAILY_BUDGET_MICROS: "1000000000000",
  }), { worker: false }); worker = new CapabilityAudioVerification(s.db, s.catalog);
});
async function capacity(slots = 1000) {
  const row = (await s.db.control.query(`INSERT INTO ai_gateway_policy_versions(data_mode,version,reason,
    global_slots,tenant_slots,actor_slots,text_slots,image_slots,video_slots,audio_slots,verification_slots,
    global_rpm,tenant_rpm,actor_rpm,text_rpm,image_rpm,video_rpm,audio_rpm,verification_rpm,preparation_seconds)
    SELECT 'configured_services',coalesce(max(version),0)+1,'Isolated managed audio capacity',
    1000,1000,1000,1000,1000,1000,$1,1000,100000,100000,100000,100000,100000,100000,100000,100000,30
    FROM ai_gateway_policy_versions WHERE data_mode='configured_services' RETURNING id`, [slots])).rows[0];
  await s.db.control.query("UPDATE ai_gateway_policy_heads SET policy_version_id=$1 WHERE data_mode='configured_services'", [row.id]);
  return row.id;
}
async function budgets(run = 1000000, daily = 1000000000000) {
  s.db.config.AI_VERIFICATION_PER_RUN_BUDGET_MICROS = run; s.db.config.AI_PLATFORM_VERIFICATION_DAILY_BUDGET_MICROS = daily;
  await seedProviderBudgetPolicy(s.db);
}
beforeEach(async () => {
  Object.assign(provider.state, { drop: false, corrupt: false, status: 200, timestamps: true, beforeReply: undefined });
  await capacity(); await budgets();
});
after(async () => {
  try { if (s) await s.app.close(); if (provider) await provider.close(); if (owner) await owner.end(); }
  finally { if (owned) await owned.cleanup(); }
  assert.deepEqual(provider?.errors ?? [], []);
});
async function call(a: VideoClient | undefined, method: string, path: string, body?: unknown, key?: string) {
  const r = await videoAdminCall(s, a, method, path, body, key);
  const schema = r.status < 300 && (r.data.document ? "CapabilityRelease" : r.data.audio_suite ? "CapabilityValidation"
    : r.data.decision === "independent_approval" ? "CapabilityPublicationPreview" : null);
  if (schema) assert.ok(schemas[schema]!(r.data), schema + ": " + JSON.stringify(schemas[schema]!.errors));
  return r;
}
async function draft(a: VideoClient, document: CapabilityDocument = speech()) {
  const r = await call(a, "POST", root + "/drafts", { document, reason: "Create an explicit synthetic audio configuration" });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  const result = await call(a, "GET", root + "/" + r.data.result_ids[0]); assert.equal(result.status, 200); return result.data;
}
async function start(document: CapabilityDocument = speech(), a?: VideoClient) {
  a ??= await videoAdmin(s); const r = await draft(a, document), key = randomUUID();
  const v = await call(a, "POST", `${root}/${r.id}/validations`, command(r), key);
  assert.equal(v.status, 202, JSON.stringify(v.data)); assert.equal(v.data.state, "running");
  return { a, r, v: v.data, key };
}
async function tick(id: string) {
  await s.db.control.query("UPDATE capability_audio_suites SET next_poll_at=clock_timestamp() WHERE validation_id=$1", [id]);
  return worker.advance(undefined, id);
}
async function read(f: Awaited<ReturnType<typeof start>>) {
  const r = await call(f.a, "GET", `${root}/validations/${f.v.id}`); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data;
}
async function run(f: Awaited<ReturnType<typeof start>>) {
  for (let i = 0; i < f.v.audio_suite.total_cases; i++) assert.equal(await tick(f.v.id), f.v.id);
  return read(f);
}
async function publish(a: VideoClient, reviewer: VideoClient, r: any, rollback = false) {
  const suffix = rollback ? "rollbacks" : "publications", b = command(r);
  const p = await call(a, "POST", `${root}/${r.id}/${suffix}-previews`, b); assert.equal(p.status, 200, JSON.stringify(p.data));
  const response = await s.app.inject({ method: "POST", url: `${root}/${r.id}/${suffix}`, headers: {
    origin: s.db.config.ADMIN_ORIGIN, cookie: a.cookie!, "x-csrf-token": a.csrf!, "idempotency-key": randomUUID(),
    "x-admin-preview-id": p.data.preview_id, "content-type": "application/json",
  }, payload: JSON.stringify(b) });
  assert.equal(response.statusCode, 202, response.body); const op = response.json(); assert.equal(op.state, "pending_approval");
  const approval = (await call(reviewer, "GET", `/v1/admin/operations/${op.id}/approval`)).data;
  const body = { expected_version: approval.version, payload_hash: approval.payload_hash, decision: "approve", reason: "Independent synthetic audio publication review" };
  assert.equal((await call(a, "POST", `/v1/admin/approvals/${approval.id}/decisions`, body)).status, 403);
  const accepted = await call(reviewer, "POST", `/v1/admin/approvals/${approval.id}/decisions`, body);
  assert.equal(accepted.status, 202, JSON.stringify(accepted.data)); assert.equal(accepted.data.state, "succeeded");
  return p.data;
}

test("the populated 120 checkpoint retains budget function OIDs and prepared callers after SQL121", async () => {
  assert.deepEqual((await owner.query("SELECT 'ai_budget_used(uuid,uuid)'::regprocedure::oid AS used,'ai_budget_subject_blocked(uuid)'::regprocedure::oid AS blocked")).rows[0], oldOids);
  assert.equal((await owner.query({ ...legacyUsed, values: [null, null] })).rows[0].used, "0");
  assert.equal((await owner.query({ ...legacyBlocked, values: [null] })).rows[0].blocked, false);
  assert.equal((await owner.query("SELECT max(version) AS version FROM schema_migrations")).rows[0].version, 121);
});

test("voice/locale/speed matrix decodes real WAV responses, charges only the platform and requires independent publication", async () => {
  const f = await start(), calls = provider.calls.length, customers = (await s.db.control.query("SELECT count(*)::int AS n FROM tasks")).rows[0].n;
  assert.equal(f.r.audio_verification_plan.total_cases, 3);
  const receipt = await run(f), plan = capabilityAudioPlan(speech());
  assert.equal(receipt.state, "passed", JSON.stringify(receipt));
  assert.equal(receipt.audio_suite.known_cost_micros, plan.quoted_micros);
  assert.equal(receipt.audio_suite.verified_cases, 3);
  assert.ok(receipt.audio_suite.cases.every((c: any) => c.media.fully_decoded && c.response_sha256 && c.usage_known));
  assert.deepEqual(provider.calls.slice(calls).map(c => c.fields.speed), [0.25, 1, 4]);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM tasks")).rows[0].n, customers);
  await publish(f.a, await videoAdmin(s), f.r);
  const head = (await s.db.control.query("SELECT * FROM current_internal_capabilities WHERE profile_key='internal-speech-v1' AND data_mode='configured_services'")).rows[0];
  assert.equal(head.id, receipt.capability_version_id); assert.deepEqual(head.body.limits.voices, ["alloy"]);
});

test("transcription checks WAV and MP3 plus ordinary JSON and actual ordered segment times", async () => {
  const f = await start(transcription()), count = provider.calls.length, receipt = await run(f);
  assert.equal(receipt.state, "passed", JSON.stringify(receipt)); assert.equal(receipt.audio_suite.total_cases, 4);
  assert.ok(receipt.audio_suite.cases.every((c: any) => c.source_sha256 && c.media.input.fully_decoded && c.media.utf8_json));
  assert.deepEqual(new Set(receipt.audio_suite.cases.map((c: any) => c.mime_type)), new Set(["audio/wav", "audio/mpeg"]));
  assert.deepEqual(new Set(provider.calls.slice(count).map(c => c.fields.response_format)), new Set(["json", "verbose_json"]));
  assert.equal(receipt.result.known_cost_micros, receipt.audio_suite.cases.reduce((n: bigint, c: any) => n + BigInt(c.actual_micros), 0n).toString());
  assert.ok(BigInt(receipt.result.known_cost_micros) < BigInt(f.v.audio_suite.quoted_micros));
  await publish(f.a, await videoAdmin(s), f.r);
});

test("explicit audio definitions reject duplicates, unknown locale/fields, empty voices and unsafe prices", () => {
  for (const document of [{ ...speech(), voices: ["alloy", "alloy"] }, { ...speech(), voices: [] },
    { ...speech(), locales: ["xx"] }, { ...speech(), locales: ["en", "en"] }, { ...speech(), rates: [1_000_000_001] },
    { ...speech(), endpoint: "https://untrusted.invalid" }, { ...transcription(), timestamps: "true" }])
    assert.equal(capabilityDocument.safeParse(document).success, false, JSON.stringify(document));
  const document = capabilityDocument.parse({ ...speech(), voices: ["z", "alloy"], locales: ["yue-HK", "en"] });
  assert.equal(capabilityAudioPlan(document).cases.length, 12);
  const limits = capabilityBody(s.db.config, document).limits;
  assert.ok("locales" in limits); assert.deepEqual(limits.locales, ["en", "yue-HK"]);
});

test("validation replay returns its original durable receipt and never creates another audio POST", async () => {
  const f = await start(), count = provider.calls.length;
  await tick(f.v.id);
  const replay = await call(f.a, "POST", `${root}/${f.r.id}/validations`, command(f.r), f.key);
  assert.equal(replay.status, 202); assert.equal(replay.data.id, f.v.id);
  assert.equal(provider.calls.length, count + 1);
  await run({ ...f, v: { ...f.v, audio_suite: { ...f.v.audio_suite, total_cases: 2 } } });
  assert.equal((await read(f)).state, "passed");
});

test("dropped audio POST holds its original quote and processor restart never replays it", async () => {
  const f = await start(), count = provider.calls.length; provider.state.drop = true;
  await tick(f.v.id); const receipt = await read(f);
  assert.equal(receipt.state, "reconciling", JSON.stringify(receipt)); assert.equal(receipt.audio_suite.usage_known, false);
  assert.equal(receipt.audio_suite.cases[0].state, "unknown"); assert.equal(receipt.result.known_cost_micros, "0");
  assert.equal(await new CapabilityAudioVerification(s.db, s.catalog).advance(undefined, f.v.id), null);
  assert.equal(provider.calls.length, count + 1);
  const budget = (await s.db.control.query(`SELECT ai_budget_used(p.envelope_id,NULL)::text AS used,ai_budget_subject_blocked(p.envelope_id) AS blocked
    FROM capability_audio_probes p WHERE validation_id=$1`, [f.v.id])).rows[0];
  assert.equal(budget.used, String(BigInt(receipt.audio_suite.cases[0].quoted_micros) * 1000000n)); assert.equal(budget.blocked, true);
  assert.equal((await call(f.a, "POST", `${root}/${f.r.id}/publications-previews`, command(f.r))).status, 409);
});

test("invalid audio bytes keep uncertain provider cost and cannot grant publication", async () => {
  const f = await start(); provider.state.corrupt = true; await tick(f.v.id); const receipt = await read(f);
  assert.equal(receipt.state, "reconciling"); assert.equal(receipt.capability_version_id, null);
  assert.equal(receipt.audio_suite.cases[0].verified, false); assert.equal(receipt.audio_suite.cases[0].actual_micros, null);
});

test("missing provider segment timestamps never become a verified timestamp capability", async () => {
  const f = await start(transcription()); await tick(f.v.id); provider.state.timestamps = false;
  await tick(f.v.id); const receipt = await read(f);
  assert.equal(receipt.state, "reconciling"); assert.equal(receipt.audio_suite.verified_cases, 1);
  assert.equal(receipt.audio_suite.cases[1].error_code, "AUDIO_TRANSCRIPTION_TIMESTAMPS_MISSING");
  assert.ok(BigInt(receipt.result.known_cost_micros) > 0n);
});

test("cancellation before dispatch is idempotent, free and prevents every provider call", async () => {
  const f = await start(), count = provider.calls.length, k = randomUUID(), url = `${root}/validations/${f.v.id}/audio-cancellations`;
  const stopped = await call(f.a, "POST", url, command(f.r), k); assert.equal(stopped.status, 202);
  assert.equal((await call(f.a, "POST", url, command(f.r), k)).data.id, f.v.id);
  await tick(f.v.id); const receipt = await read(f);
  assert.equal(receipt.state, "cancelled"); assert.equal(receipt.result.known_cost_micros, "0"); assert.equal(provider.calls.length, count);
});

test("cancellation while a complete reply arrives preserves actual cost and stops later cases", async () => {
  const f = await start(), count = provider.calls.length;
  provider.state.beforeReply = async () => { provider.state.beforeReply = undefined;
    assert.equal((await call(f.a, "POST", `${root}/validations/${f.v.id}/audio-cancellations`, command(f.r))).status, 202); };
  await tick(f.v.id); const receipt = await read(f);
  assert.equal(receipt.state, "cancelled", JSON.stringify(receipt)); assert.equal(receipt.result.usage_known, true);
  assert.ok(BigInt(receipt.result.known_cost_micros) > 0n); assert.equal(provider.calls.length, count + 1);
});

test("permission removal before the next case stops dispatch without overwriting already recorded fees", async () => {
  const f = await start(), count = provider.calls.length; await tick(f.v.id);
  await s.db.control.query("DELETE FROM admin_bindings WHERE principal_id=$1", [f.a.id]);
  await tick(f.v.id);
  const v = (await s.db.control.query("SELECT * FROM capability_validations WHERE id=$1", [f.v.id])).rows[0];
  assert.equal(v.state, "failed"); assert.ok(BigInt(v.result.known_cost_micros) > 0n); assert.equal(provider.calls.length, count + 1);
});

test("current audio capacity is enforced before preparation and dispatch and resumes safely when capacity returns", async () => {
  const f = await start(), count = provider.calls.length; await capacity(0); await tick(f.v.id);
  assert.equal((await read(f)).state, "running"); assert.equal(provider.calls.length, count);
  await capacity(); await tick(f.v.id); assert.equal(provider.calls.length, count + 1);
  await run({ ...f, v: { ...f.v, audio_suite: { ...f.v.audio_suite, total_cases: 2 } } });
});

test("the complete plan must fit platform run funding before a durable validation is admitted", async () => {
  const a = await videoAdmin(s), r = await draft(a); await budgets(1);
  const count = provider.calls.length, response = await call(a, "POST", `${root}/${r.id}/validations`, command(r));
  assert.equal(response.status, 409, JSON.stringify(response.data)); assert.equal(response.data.error.code, "VERIFICATION_BUDGET_EXHAUSTED");
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM capability_validations WHERE release_id=$1", [r.id])).rows[0].n, 0);
  assert.equal(provider.calls.length, count);
});

test("a completed verification receipt and its probe media/fee evidence are immutable", async () => {
  const f = await start(); const receipt = await run(f), probe = receipt.audio_suite.cases[0];
  await assert.rejects(s.db.control.query("UPDATE capability_audio_probes SET billable_units=0 WHERE id=$1", [probe.id]), /Immutable/);
  await assert.rejects(s.db.control.query("UPDATE capability_audio_suites SET plan='[]' WHERE validation_id=$1", [f.v.id]), /Immutable/);
  await assert.rejects(s.db.control.query("UPDATE capability_validations SET result='{}' WHERE id=$1", [f.v.id]), /Immutable/);
});

test("a second processor cannot own the same pending POST", async () => {
  const f = await start(), count = provider.calls.length;
  provider.state.beforeReply = async () => { provider.state.beforeReply = undefined;
    assert.equal(await new CapabilityAudioVerification(s.db, s.catalog).advance(undefined, f.v.id), null); };
  await tick(f.v.id); assert.equal(provider.calls.length, count + 1);
  await run({ ...f, v: { ...f.v, audio_suite: { ...f.v.audio_suite, total_cases: 2 } } });
});

test("an actual processor crash after dispatch is recovered as an unknown original POST without a second service submission", { timeout: 120000 }, async () => {
  const f = await start(), count = provider.calls.length;
  let release: (() => void) | undefined, observe: (() => void) | undefined;
  const held = new Promise<void>(resolve => { release = resolve; }), seen = new Promise<void>(resolve => { observe = resolve; });
  provider.state.beforeReply = async () => { provider.state.beforeReply = undefined; observe!(); await held; };
  const child = spawn(process.execPath, ["--import", "tsx", "tests/fixtures/capability-audio-processor.ts", f.v.id], {
    env: { ...process.env, COPYPASTE_AUDIO_PROCESSOR_FIXTURE_CONFIG: JSON.stringify(s.db.config) },
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostic = "";
  child.stdout.on("data", () => {}); child.stderr.on("data", bytes => { diagnostic = (diagnostic + bytes).slice(-4096); });
  const closed = new Promise<number | null>(resolve => { child.once("close", resolve); child.once("error", () => resolve(-1)); });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([seen, closed.then(code => { throw new Error("Owned processor exited before dispatch: " + code + " " + diagnostic); }),
      new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("Owned processor dispatch deadline")), 90000); })]);
    const original = (await s.db.control.query("SELECT * FROM capability_audio_probes WHERE validation_id=$1", [f.v.id])).rows[0];
    assert.equal(original.state, "dispatched"); assert.ok(original.request_hash && original.dispatched_at);
    child.kill("SIGKILL"); await closed; release!();
    // Advance the owned fixture's processor lease to its real expired state;
    // immutable grant, original operation ID, quote and dispatch stay untouched.
    await s.db.control.query("UPDATE capability_audio_suites SET lease_until=clock_timestamp()-interval '1 second',next_poll_at=clock_timestamp() WHERE validation_id=$1", [f.v.id]);
    await tick(f.v.id); const receipt = await read(f);
    assert.equal(receipt.state, "reconciling"); assert.equal(receipt.audio_suite.cases[0].operation_id, original.operation_id);
    assert.equal(receipt.audio_suite.cases[0].state, "unknown"); assert.equal(provider.calls.length, count + 1);
    assert.equal(await worker.advance(undefined, f.v.id), null);
  } finally {
    if (deadline) clearTimeout(deadline); release!();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await closed;
  }
});

test("anonymous and read-only users cannot start or cancel platform-funded audio verification", async () => {
  const f = await start(), readOnly = await videoAdmin(s, ["admin.catalog.read"]);
  assert.equal((await call(undefined, "GET", `${root}/validations/${f.v.id}`)).status, 401);
  assert.equal((await call(readOnly, "POST", `${root}/${f.r.id}/validations`, command(f.r))).status, 403);
  assert.equal((await call(readOnly, "POST", `${root}/validations/${f.v.id}/audio-cancellations`, command(f.r))).status, 403);
  await call(f.a, "POST", `${root}/validations/${f.v.id}/audio-cancellations`, command(f.r)); await tick(f.v.id);
});

test("new tasks adopt independently published speech prices while old tasks retain their exact version after publication and rollback", async () => {
  const f = await start(), reviewer = await videoAdmin(s); await run(f); await publish(f.a, reviewer, f.r);
  const customer = await nativeVideoFixture(s);
  const task = async () => {
    const created = await videoOK(s, customer.web, "POST", customer.base + "/tasks", {
      title: "Frozen managed audio model", prompt: "Keep this confirmed speech configuration", role_key: "video-motion", budget_micros: 1000000,
    });
    return (await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [created.id])).rows[0];
  };
  const first = await task(), binding = async (t: any) => s.db.tx(tx => taskCapabilities(tx, s.db.config, s.catalog, t), undefined, true);
  const original = (await binding(first)).speech!; assert.equal(original.body.rates[0], 100);
  const next = await start({ ...speech("synthetic-managed-speech-v2"), rates: [200] }); await run(next); await publish(next.a, reviewer, next.r);
  const second = await task(); assert.equal((await binding(second)).speech!.body.rates[0], 200);
  assert.equal((await binding(first)).speech!.id, original.id);
  await publish(f.a, reviewer, f.r, true);
  const third = await task(); assert.equal((await binding(third)).speech!.id, original.id);
  assert.equal((await binding(second)).speech!.body.rates[0], 200);
});
