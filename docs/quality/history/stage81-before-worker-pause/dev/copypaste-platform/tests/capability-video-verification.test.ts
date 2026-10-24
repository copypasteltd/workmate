import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { capabilityVideoProvider } from "./capability-video-fixture.js";
import { videoAdmin, videoAdminCall } from "./generated-video-admin-fixture.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { CapabilityVideoVerification } from "../src/capability-video-verification.js";
import { seedProviderBudgetPolicy } from "../src/provider-budgets.js";
import { capabilityDocument } from "../src/capability-verification.js";
import { capabilityVideoPlan } from "../src/capability-video-plan.js";
import type { VideoClient } from "./desktop-video-fixture.js";
import { runMigrations } from "../scripts/migration-runner.js";
import { hash } from "../src/lib.js";

let owned: Awaited<ReturnType<typeof isolatedTestEnvironment>>, provider: Awaited<ReturnType<typeof capabilityVideoProvider>>,
  s: Awaited<ReturnType<typeof buildApp>>, worker: CapabilityVideoVerification;
let upgradeOwner: pg.Client;
const legacyUsed = { name: "before_video_verification_budget", text: "SELECT ai_budget_used($1::uuid,$2::uuid)::text AS used" };
const legacyBlocked = { name: "before_video_verification_blocked", text: "SELECT ai_budget_subject_blocked($1::uuid) AS blocked" };
const root = "/v1/admin/capability-releases", definition = (model = "synthetic-managed-video-v1") => ({
  kernel: "codex", gateway_policy: "company_internal_only", profile_key: "internal-video-v1", model_alias: model, reasoning_effort: null, rates: [100],
});
const command = (r: any) => ({ expected_version: r.version, reason: "Explicit synthetic video protocol verification" });
before(async () => {
  assert.ok(process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN, "Use the explicitly pinned real native Codex executable");
  owned = await isolatedTestEnvironment({ throughVersion: 97 });
  upgradeOwner = new pg.Client({ connectionString: owned.env.OWNER_DATABASE_URL }); await upgradeOwner.connect();
  const before = (await upgradeOwner.query("SELECT 'ai_budget_used(uuid,uuid)'::regprocedure::oid AS used,'ai_budget_subject_blocked(uuid)'::regprocedure::oid AS blocked")).rows[0];
  assert.equal((await upgradeOwner.query({ ...legacyUsed, values: [null, null] })).rows[0].used, "0");
  assert.equal((await upgradeOwner.query({ ...legacyBlocked, values: [null] })).rows[0].blocked, false);
  await runMigrations(upgradeOwner, "managed video forward-only upgrade");
  assert.deepEqual((await upgradeOwner.query("SELECT 'ai_budget_used(uuid,uuid)'::regprocedure::oid AS used,'ai_budget_subject_blocked(uuid)'::regprocedure::oid AS blocked")).rows[0], before);
  provider = await capabilityVideoProvider(owned.directory);
  s = await buildApp(loadConfig({ ...owned.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "false", DEMO_MODE: "false",
    CODEX_BIN: process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN!, AI_BASE_URL: provider.origin, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "synthetic-video-capability-fixture",
    AI_MODEL: "synthetic-reasoning-v1", AI_VERIFIED: "true", AI_INPUT_HKD_MICROS_PER_MILLION: "100", AI_OUTPUT_HKD_MICROS_PER_MILLION: "100",
    AI_VIDEO_VERIFIED: "false", AI_VIDEO_POLL_INTERVAL_MS: "250", AI_VERIFICATION_PER_RUN_BUDGET_MICROS: "1000000",
    AI_PLATFORM_VERIFICATION_DAILY_BUDGET_MICROS: "1000000000000",
  }), { worker: false }); worker = new CapabilityVideoVerification(s.db, s.catalog);
});
async function capacity(slots = 1000) {
  const p = (await s.db.control.query(`INSERT INTO ai_gateway_policy_versions(data_mode,version,reason,
    global_slots,tenant_slots,actor_slots,text_slots,image_slots,video_slots,verification_slots,
    global_rpm,tenant_rpm,actor_rpm,text_rpm,image_rpm,video_rpm,verification_rpm,preparation_seconds)
    SELECT 'configured_services',coalesce(max(version),0)+1,'Isolated managed-video verification capacity',
    $1,$1,$1,$1,$1,$1,$1,100000,100000,100000,100000,100000,100000,100000,30
    FROM ai_gateway_policy_versions WHERE data_mode='configured_services' RETURNING id`, [slots])).rows[0];
  await s.db.control.query("UPDATE ai_gateway_policy_heads SET policy_version_id=$1 WHERE data_mode='configured_services'", [p.id]);
  return p.id;
}
async function budgets(run = 1000000, daily = 1000000000000) {
  s.db.config.AI_VERIFICATION_PER_RUN_BUDGET_MICROS = run; s.db.config.AI_PLATFORM_VERIFICATION_DAILY_BUDGET_MICROS = daily;
  await seedProviderBudgetPolicy(s.db);
}
beforeEach(async () => {
  Object.assign(provider.state, { dropCreate: false, lookupMissing: false, corruptContent: false, cancelCompletes: false,
    queued: false, usageUnknown: false, billableExtra: 0, beforeCreate: undefined, beforeContent: undefined });
  await capacity(); await budgets();
});
after(async () => {
  try { if (s) await s.app.close(); if (provider) await provider.close(); if (upgradeOwner) await upgradeOwner.end(); }
  finally { if (owned) await owned.cleanup(); }
  assert.deepEqual(provider?.errors ?? [], []);
});
async function call(a: VideoClient, method: string, url: string, body?: unknown, key?: string) {
  return videoAdminCall(s, a, method, url, body, key);
}
async function draft(a: VideoClient, doc = definition()) {
  const r = await call(a, "POST", root + "/drafts", { document: doc, reason: "Create managed video fixture" });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  const result = await call(a, "GET", root + "/" + r.data.result_ids[0]);
  assert.equal(result.status, 200); return result.data;
}
async function start(a?: VideoClient, doc = definition()) {
  a ??= await videoAdmin(s); const r = await draft(a, doc), key = randomUUID();
  const v = await call(a, "POST", `${root}/${r.id}/validations`, command(r), key);
  assert.equal(v.status, 202, JSON.stringify(v.data)); assert.equal(v.data.state, "running");
  return { a, r, v: v.data, key };
}
async function tick(id: string) {
  await s.db.control.query("UPDATE capability_video_suites SET next_poll_at=clock_timestamp() WHERE validation_id=$1", [id]);
  return worker.advance(undefined, id);
}
async function read(f: Awaited<ReturnType<typeof start>>) {
  const r = await call(f.a, "GET", `${root}/validations/${f.v.id}`);
  assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data;
}
async function run(id: string) { for (let i = 0; i < 16; i++) assert.equal(await tick(id), id); }
async function publish(a: VideoClient, reviewer: VideoClient, r: any, rollback = false) {
  const suffix = rollback ? "rollbacks" : "publications", b = command(r);
  const p = await call(a, "POST", `${root}/${r.id}/${suffix}-previews`, b);
  assert.equal(p.status, 200, JSON.stringify(p.data));
  const op = await videoAdminCall(s, a, "POST", `${root}/${r.id}/${suffix}`, b, randomUUID());
  // Publication requires the exact preview header; perform through the real API.
  assert.equal(op.status, 400);
  const response = await s.app.inject({ method: "POST", url: `${root}/${r.id}/${suffix}`, headers: {
    origin: s.db.config.ADMIN_ORIGIN, cookie: a.cookie!, "x-csrf-token": a.csrf!, "idempotency-key": randomUUID(),
    "x-admin-preview-id": p.data.preview_id, "content-type": "application/json",
  }, payload: JSON.stringify(b) });
  assert.equal(response.statusCode, 202, response.body); const pending = response.json(); assert.equal(pending.state, "pending_approval");
  const approval = await call(reviewer, "GET", `/v1/admin/operations/${pending.id}/approval`); assert.equal(approval.status, 200);
  const self = await call(a, "POST", `/v1/admin/approvals/${approval.data.id}/decisions`, { expected_version: approval.data.version,
    payload_hash: approval.data.payload_hash, decision: "approve", reason: "Self review must fail" }); assert.equal(self.status, 403);
  const accepted = await call(reviewer, "POST", `/v1/admin/approvals/${approval.data.id}/decisions`, { expected_version: approval.data.version,
    payload_hash: approval.data.payload_hash, decision: "approve", reason: "Independent managed video review" });
  assert.equal(accepted.status, 202, JSON.stringify(accepted.data)); assert.equal(accepted.data.state, "succeeded");
}

test("managed video drafts reject alternate kernels, endpoints, missing or zero prices and scoped administrators", async () => {
  const plan = capabilityVideoPlan(); assert.equal(plan.cases.length, 16); assert.equal(plan.seconds, 184);
  for (const bad of [{ ...definition(), rates: [0] }, { ...definition(), rates: [] }, { ...definition(), kernel: "dsh" },
    { ...definition(), endpoint: "https://outside.invalid" }, { ...definition(), rates: [1.2] }]) assert.equal(capabilityDocument.safeParse(bad).success, false);
  const scoped = await videoAdmin(s, ["admin.catalog.draft", "admin.catalog.publish", "admin.catalog.read"], "tenant", randomUUID());
  assert.equal((await call(scoped, "POST", root + "/drafts", { document: definition(), reason: "Restricted scope" })).status, 403);
  const a = await videoAdmin(s), r = await draft(a); await budgets(18399);
  const count = provider.calls.length;
  const rejected = await call(a, "POST", `${root}/${r.id}/validations`, command(r));
  assert.equal(rejected.status, 409); assert.equal(rejected.data.error.code, "VERIFICATION_BUDGET_EXHAUSTED"); assert.equal(provider.calls.length, count);
});

test("all 15 actual MP4 specifications, PNG/JPEG references and observed cancellation publish only after independent review and can roll back", async () => {
  const f = await start(), reviewer = await videoAdmin(s), before = provider.calls.length;
  assert.equal((await read(f)).video_suite.quoted_micros, "18400");
  provider.state.beforeCreate = async operation => {
    const row = (await s.db.control.query("SELECT * FROM capability_video_probes WHERE operation_id=$1", [operation])).rows[0];
    assert.equal(row.state, "submitting"); assert.ok(row.dispatched_at); assert.ok(row.envelope_id && row.platform_period_id);
  };
  await run(f.v.id); const receipt = await read(f);
  assert.equal(receipt.state, "passed", JSON.stringify(receipt)); assert.equal(receipt.video_suite.verified_cases, 16);
  assert.equal(receipt.result.known_cost_micros, "18100"); assert.equal(receipt.result.usage_known, true);
  assert.equal(receipt.video_suite.cases.filter((c: any) => c.media?.fully_decoded).length, 15);
  const cancelled = receipt.video_suite.cases[15], calls = provider.calls.slice(before);
  const cancelIndex = calls.findIndex(c => c.path.endsWith("/cancel") && c.operation === cancelled.operation_id);
  assert.ok(cancelIndex >= 0 && calls.slice(cancelIndex + 1).some(c => c.method === "GET" && c.path === calls[cancelIndex].path.replace(/\/cancel$/, "")), "Cancellation is followed by a real resource observation");
  assert.deepEqual(new Set(provider.calls.slice(before).map(c => c.reference).filter(Boolean)), new Set(["image/png", "image/jpeg"]));
  assert.equal(provider.calls.slice(before).filter(c => c.method === "POST" && c.path === "/v1/videos").length, 16);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM tasks")).rows[0].n, 0);
  await publish(f.a, reviewer, f.r);
  const first = (await s.db.control.query("SELECT * FROM current_internal_capabilities WHERE profile_key='internal-video-v1' AND data_mode='configured_services'")).rows[0];
  assert.equal(first.body.model_alias, definition().model_alias); assert.equal(s.db.config.AI_VIDEO_VERIFIED, false);
  const next = await start(f.a, { ...definition("synthetic-managed-video-v2"), rates: [200] }); await run(next.v.id); await publish(next.a, reviewer, next.r);
  assert.equal((await s.db.control.query("SELECT body FROM current_internal_capabilities WHERE profile_key='internal-video-v1' AND data_mode='configured_services'")).rows[0].body.model_alias, "synthetic-managed-video-v2");
  assert.deepEqual((await s.db.control.query("SELECT body FROM internal_capability_versions WHERE id=$1", [first.id])).rows[0].body, first.body);
  await publish(f.a, reviewer, f.r, true);
  assert.equal((await s.db.control.query("SELECT release_id FROM current_internal_capabilities WHERE profile_key='internal-video-v1' AND data_mode='configured_services'")).rows[0].release_id, f.r.id);
});

test("same-key validation replay and lost create response recover the original operation without another generation POST", async () => {
  const f = await start(), before = provider.calls.length;
  const replay = await call(f.a, "POST", `${root}/${f.r.id}/validations`, command(f.r), f.key); assert.equal(replay.data.id, f.v.id);
  provider.state.dropCreate = true; await tick(f.v.id);
  let receipt = await read(f); assert.equal(receipt.video_suite.cases[0].state, "unknown"); assert.equal(receipt.video_suite.usage_known, false);
  const probe = (await s.db.control.query("SELECT * FROM capability_video_probes WHERE validation_id=$1", [f.v.id])).rows[0];
  assert.equal((await upgradeOwner.query({ ...legacyUsed, values: [probe.envelope_id, null] })).rows[0].used, "400000000", "A statement prepared before SQL098 sees new video holds");
  assert.equal((await upgradeOwner.query({ ...legacyBlocked, values: [probe.envelope_id] })).rows[0].blocked, true);
  provider.state.dropCreate = false; await tick(f.v.id);
  receipt = await read(f); assert.equal(receipt.video_suite.verified_cases, 1);
  assert.equal(provider.calls.slice(before).filter(c => c.method === "POST" && c.path === "/v1/videos").length, 1);
  assert.equal(receipt.state, "running");
});

test("cancel before dispatch proves zero cost and never starts a generation, including replay and explicit resource recheck", async () => {
  const f = await start(), before = provider.calls.length, key = randomUUID(), url = `${root}/validations/${f.v.id}/video-cancellations`;
  const c = await call(f.a, "POST", url, command(f.r), key); assert.equal(c.status, 202); assert.equal(c.data.video_suite.cancel_requested, true);
  assert.deepEqual((await call(f.a, "POST", url, command(f.r), key)).data, c.data);
  await tick(f.v.id); const receipt = await read(f); assert.equal(receipt.state, "cancelled"); assert.equal(receipt.result.known_cost_micros, "0");
  assert.deepEqual((await call(f.a, "POST", url, command(f.r), key)).data, c.data);
  assert.equal((await call(f.a, "POST", url, command(f.r))).data.error.code, "CAPABILITY_VERIFICATION_TERMINAL");
  assert.equal(provider.calls.length, before);
  assert.equal((await call(f.a, "POST", `${root}/validations/${f.v.id}/video-rechecks`, command(f.r))).status, 202);
  assert.equal(await tick(f.v.id), null); assert.equal(provider.calls.length, before);
});

test("unknown final video usage retains capacity and quote, then reconciles without reopening cancelled eligibility", async () => {
  const f = await start(); provider.state.usageUnknown = true; await tick(f.v.id);
  const receipt = await read(f), p = receipt.video_suite.cases[0]; assert.equal(p.usage_known, false); assert.equal(p.verified, false);
  const before = provider.calls.length;
  await call(f.a, "POST", `${root}/validations/${f.v.id}/video-cancellations`, command(f.r)); await tick(f.v.id);
  assert.equal((await read(f)).state, "reconciling");
  await provider.complete(p.operation_id, 4); await tick(f.v.id);
  const after = await read(f); assert.equal(after.state, "reconciling"); assert.equal(after.video_suite.usage_known, true); assert.equal(after.video_suite.known_cost_micros, "400");
  assert.equal(provider.calls.slice(before).filter(c => c.method === "POST" && c.path === "/v1/videos").length, 0);
  assert.equal(provider.calls.slice(before).some(c => c.path.endsWith("/content")), false);
});

test("a revoked original admin session permits only original-resource cancellation and cost recovery", async () => {
  const f = await start(), inspector = await videoAdmin(s); provider.state.queued = true; await tick(f.v.id);
  const before = provider.calls.length; await s.db.control.query("UPDATE sessions SET revoked_at=now() WHERE admin_id=$1", [f.a.id]);
  await tick(f.v.id); const receipt = await call(inspector, "GET", `${root}/validations/${f.v.id}`);
  assert.equal(receipt.data.state, "cancelled"); assert.equal(receipt.data.video_suite.known_cost_micros, "100");
  const calls = provider.calls.slice(before); assert.ok(calls.some(c => c.path.endsWith("/cancel")));
  assert.equal(calls.some(c => c.path.endsWith("/content") || c.path === "/v1/videos"), false);
});

test("corrupt actual media, over-quote usage and cancellation losing to completion never produce a publishable capability", async t => {
  for (const scenario of ["corrupt", "overquote", "cancel_race"] as const) await t.test(scenario, async () => {
    const f = await start(); provider.state.corruptContent = scenario === "corrupt"; provider.state.billableExtra = scenario === "overquote" ? 1 : 0;
    provider.state.cancelCompletes = scenario === "cancel_race";
    if (scenario === "cancel_race") await run(f.v.id); else await tick(f.v.id);
    const receipt = await read(f); assert.equal(receipt.state, "failed", JSON.stringify(receipt)); assert.equal(receipt.capability_version_id, null);
    assert.ok(BigInt(receipt.video_suite.known_cost_micros) > 0n);
    assert.equal((await call(f.a, "POST", `${root}/${f.r.id}/publications-previews`, command(f.r))).status, 409);
    Object.assign(provider.state, { corruptContent: false, billableExtra: 0, cancelCompletes: false });
  });
});

test("current lower run/daily budgets and shared global admission stop additional video calls without discarding known fees", async () => {
  const f = await start(); await tick(f.v.id); await budgets(450);
  const count = provider.calls.length; await tick(f.v.id);
  const receipt = await read(f); assert.equal(receipt.state, "failed"); assert.equal(receipt.result.known_cost_micros, "400"); assert.equal(provider.calls.length, count);
  await budgets(); const g = await start(); await budgets(1000000, 1); await tick(g.v.id);
  assert.equal((await read(g)).state, "failed"); assert.equal(provider.calls.length, count);
  await budgets(); const blocker = await start(); provider.state.queued = true; await tick(blocker.v.id);
  const h = await start(); await capacity(1);
  const policy = (await s.db.control.query("SELECT policy_version_id AS id FROM ai_gateway_policy_heads WHERE data_mode='configured_services'")).rows[0].id;
  assert.equal((await s.db.control.query("SELECT ai_gateway_limit_reason($1,NULL,$2,'text','validation') AS reason", [policy, h.a.id])).rows[0].reason, "GLOBAL_CAPACITY");
  const heldCount = provider.calls.length;
  await tick(h.v.id); assert.equal(provider.calls.length, heldCount); assert.equal((await read(h)).state, "running");
});

test("concurrent processors claim one suite and control-only immutable verification facts are unavailable to user/queue roles", async () => {
  const f = await start(), before = provider.calls.length;
  const results = await Promise.all([tick(f.v.id), worker.advance(undefined, f.v.id)]);
  assert.equal(results.filter(Boolean).length, 1); assert.equal((await read(f)).video_suite.verified_cases, 1);
  assert.equal(provider.calls.slice(before).filter(c => c.path === "/v1/videos").length, 1);
  const suite = (await s.db.control.query("SELECT * FROM capability_video_suites WHERE validation_id=$1", [f.v.id])).rows[0];
  await assert.rejects(s.db.control.query("UPDATE capability_video_suites SET plan_hash=$2 WHERE validation_id=$1", [f.v.id, "a".repeat(64)]), /Immutable/);
  const probe = (await s.db.control.query("SELECT * FROM capability_video_probes WHERE validation_id=$1", [f.v.id])).rows[0];
  await assert.rejects(s.db.control.query("UPDATE capability_video_probes SET billable_seconds=0 WHERE id=$1", [probe.id]), /Immutable/);
  await assert.rejects(s.db.app.query("SELECT * FROM capability_video_probes"), /permission denied/);
  await assert.rejects(s.db.queue.query("SELECT * FROM capability_video_suites"), /permission denied/);
  assert.equal(suite.plan_hash, capabilityVideoPlan().hash);
});

test("an expired processor cannot overwrite the replacement lease or repeat its persisted generation", async () => {
  const f = await start(), before = provider.calls.length;
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  provider.state.beforeCreate = async () => { entered(); await gate; };
  const old = tick(f.v.id);
  try {
    await started;
    await s.db.control.query("UPDATE capability_video_suites SET lease_until=clock_timestamp()-interval '1 second',next_poll_at=clock_timestamp() WHERE validation_id=$1", [f.v.id]);
    provider.state.beforeCreate = undefined;
    assert.equal(await worker.advance(undefined, f.v.id), f.v.id);
  } finally { release(); await old; provider.state.beforeCreate = undefined; }
  assert.equal((await read(f)).video_suite.verified_cases, 1);
  assert.equal(provider.calls.slice(before).filter(c => c.path === "/v1/videos").length, 1);
});

test("a bounded queued grant survives MFA aging but cannot authorize a new validation or publication", async () => {
  const f = await start(), inspector = await videoAdmin(s);
  await s.db.control.query("UPDATE sessions SET mfa_at=clock_timestamp()-interval '45 minutes' WHERE admin_id=$1", [f.a.id]);
  await tick(f.v.id);
  const receipt = await call(inspector, "GET", `${root}/validations/${f.v.id}`);
  assert.equal(receipt.data.video_suite.verified_cases, 1);
  assert.equal((await call(f.a, "POST", `${root}/${f.r.id}/validations`, command(f.r))).data.error.code, "MFA_REQUIRED");
  assert.equal((await call(f.a, "POST", `${root}/${f.r.id}/publications-previews`, command(f.r))).data.error.code, "MFA_REQUIRED");
});

test("a restored expired grant stops before HTTP and retains immutable terminal eligibility", async () => {
  const f = await start(), expired = randomUUID(), before = provider.calls.length;
  await s.db.control.query(`INSERT INTO capability_validations(id,release_id,principal_id,session_id,idempotency_hash,payload_hash,execution_nonce,lease_until)
    SELECT $2,release_id,principal_id,session_id,$3,payload_hash,$4,clock_timestamp()-interval '1 second' FROM capability_validations WHERE id=$1`,
  [f.v.id, expired, hash(randomUUID()), randomUUID()]);
  await s.db.control.query(`INSERT INTO capability_video_suites(validation_id,auth_version,binary_sha256,plan,plan_hash,quoted_micros)
    SELECT $2,auth_version,binary_sha256,plan,plan_hash,quoted_micros FROM capability_video_suites WHERE validation_id=$1`, [f.v.id, expired]);
  await tick(expired); const receipt = await call(f.a, "GET", `${root}/validations/${expired}`);
  assert.equal(receipt.data.state, "cancelled"); assert.equal(receipt.data.result.known_cost_micros, "0"); assert.equal(provider.calls.length, before);
  assert.equal(await tick(expired), null);
});
