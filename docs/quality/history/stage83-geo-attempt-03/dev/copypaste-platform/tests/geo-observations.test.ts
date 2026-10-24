import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { runMigrations } from "../scripts/migration-runner.js";
import { Worker } from "../src/worker.js";
import { CodexRuntimeAdapter, type RuntimeContext, type RuntimeResult } from "../src/runtime.js";
import { ErasureService } from "../src/erasure.js";
import { RetentionService } from "../src/retention.js";
import { hash } from "../src/lib.js";
import { seal } from "../src/lib.js";
import * as OTPAuth from "otpauth";
import { defaults } from "../src/plans.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string; admin?: boolean };
async function call(c: Client | undefined, method: string, url: string, body?: unknown, requestKey = randomUUID()) {
  const tenant = /^\/v1\/tenants\/([a-f0-9-]{36})/.exec(url)?.[1];
  const raw = await s.app.inject({ method: method as any, url, headers: { origin: c?.admin ? s.db.config.ADMIN_ORIGIN : s.db.config.WEB_ORIGIN,
    ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}), "idempotency-key": requestKey,
    ...(tenant ? { "x-tenant-id": tenant } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
  payload: body === undefined ? undefined : JSON.stringify(body) });
  let data: any; try { data = raw.json(); } catch { data = raw.body; }
  return { status: raw.statusCode, data, raw };
}
async function ok(c: Client | undefined, method: string, url: string, body?: unknown, key = randomUUID()) {
  const r = await call(c, method, url, body, key);
  assert.ok(r.status >= 200 && r.status < 300, `${method} ${url}: ${r.status} ${JSON.stringify(r.data)}`); return r.data;
}
async function user(): Promise<Client> {
  const ch = await ok(undefined, "POST", "/v1/auth/challenge", { email: `geo-${randomUUID()}@example.invalid` });
  const mail = JSON.parse(await readFile(`${s.db.config.DATA_DIR}/mailbox/${ch.challenge_id}.json`, "utf8"));
  const r = await call(undefined, "POST", "/v1/auth/verify", { challenge_id: ch.challenge_id, code: mail.text.match(/\b\d{6}\b/)[0] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const cookie = r.raw.cookies.find(c => c.name === "cp_session")!;
  return { id: r.data.user.id, cookie: cookie.name + "=" + cookie.value, csrf: r.data.csrf_token };
}
async function fixture() {
  const owner = await user(), w = await ok(owner, "POST", "/v1/tenants", { name: "GEO evidence", project_name: "Fixed observations" });
  const tenant = w.tenant.id, project = w.project.id, base = `/v1/tenants/${tenant}/projects/${project}`, root = base + "/geo";
  await s.db.control.query("UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1", [tenant]);
  await s.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Explicit synthetic GEO batch capacity',$2)", [tenant, defaults.business]);
  const agent = await ok(owner, "POST", base + "/agents", { name: "Unbranded GEO observer", role_key: "assistant", instructions: "Answer the user's question independently.", tool_ids: [], brand_id: null });
  const spec = { name: "Hong Kong brand observations", agent_id: agent.id, region: "Hong Kong", language: "English", questions: [{ key: "q1", text: "Which local design teams could help a Hong Kong company?" }, { key: "q2", text: "How can a Hong Kong marketing team choose its software partner?" }], brands: [{ name: "CopyPaste", aliases: ["CopyPaste", "copypaste.hk"] }] };
  const e = await ok(owner, "POST", root + "/experiments", { spec });
  return { owner, tenant, project, base, root, agent, spec, e };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const apiRun = (f: Fixture, name = "Observation") => ok(f.owner, "POST", f.root + "/experiments/" + f.e.id + "/runs", { name, per_question_budget_micros: "1000000" });
const manualBody = () => ({ name: "Consumer original answer", product: "Consumer fixture", reported_model: null, region: "Hong Kong", language: "English", retrieval: "unknown", observed_at: new Date(Date.now() - 10000).toISOString(), attested: true, samples: [{ question_key: "q1", answer: "CopyPaste offers design. Source https://example.invalid/design ." }] });
const manualRun = (f: Fixture) => ok(f.owner, "POST", f.root + "/experiments/" + f.e.id + "/manual", manualBody());
class SyntheticObservation extends CodexRuntimeAdapter {
  contexts: RuntimeContext[] = [];
  override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
    this.contexts.push(ctx);
    assert.deepEqual(ctx.tools, []); assert.ok(!ctx.prompt.includes('"brand":{"'));
    return { text: "A synthetic sample mentions CopyPaste. https://example.invalid/evidence", status: "completed", inputTokens: 100, outputTokens: 100, usageKnown: true, accepted: true, thread: randomUUID(), turn: randomUUID() };
  }
}
async function complete(f: Fixture, run: any, runtime = new SyntheticObservation(s.db.config)) {
  const samples = (await ok(f.owner, "GET", f.root + "/runs/" + run.id)).samples;
  for (const sample of samples) await new Worker(s.db, s.catalog, s.storage, runtime).run(f.tenant, sample.task_id);
  return runtime;
}
before(async () => { isolated = await isolatedTestEnvironment(); s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "false", DEMO_MODE: "true" }), { worker: false }); });
after(async () => { await s?.app.close(); await isolated?.cleanup(); });

test("GEO freezes actual harness, question versions and optimistic revisions without rewriting the previous configuration", async () => {
  const f = await fixture(), initial = (await ok(f.owner, "GET", f.root + "/experiments")).items[0];
  assert.equal(initial.body.harness.protocol, "codex-internal-no-retrieval-v1");
  assert.deepEqual(initial.body.context.memories, []); assert.deepEqual(initial.body.context.history, []);
  const input = { spec: { ...f.spec, region: "Singapore" }, previous_id: f.e.id, expected_sha256: f.e.sha256 };
  const results = await Promise.all([call(f.owner, "POST", f.root + "/experiments", input), call(f.owner, "POST", f.root + "/experiments", input)]);
  assert.deepEqual(results.map(v => v.status).sort(), [201, 409]);
  const rows = (await ok(f.owner, "GET", f.root + "/experiments")).items;
  assert.equal(rows.length, 2); assert.equal(rows.find((v: any) => v.version === 1).body.spec.region, "Hong Kong");
  await assert.rejects(s.db.control.query("UPDATE geo_experiments SET body=jsonb_set(body,'{spec,region}','\"Changed\"') WHERE id=$1", [f.e.id]), /new version/);
});
test("GEO reserves every independent question atomically and transport retries return only the same run receipt", async () => {
  const f = await fixture(), key = randomUUID(), body = { name: "Atomic observation", per_question_budget_micros: "1000000" };
  const a = await ok(f.owner, "POST", f.root + "/experiments/" + f.e.id + "/runs", body, key);
  assert.deepEqual(await ok(f.owner, "POST", f.root + "/experiments/" + f.e.id + "/runs", body, key), a);
  const tasks = (await s.db.control.query("SELECT t.* FROM geo_samples s JOIN tasks t ON t.id=s.task_id WHERE s.run_id=$1", [a.id])).rows;
  assert.equal(tasks.length, 2); assert.ok(tasks.every(t => t.private_owner === f.owner.id && t.mode === "ask" && t.execution_location === "cloud" && !t.parent_id));
  assert.ok(tasks.every(t => !t.prompt.includes("CopyPaste") && t.input_context.history.length === 0));
  const holds = (await s.db.control.query("SELECT count(*)::int AS n FROM reservations WHERE task_id=ANY($1::uuid[])", [tasks.map(t => t.id)])).rows[0]; assert.equal(holds.n, 2);
  await ok(f.owner, "POST", f.root + "/runs/" + a.id + "/cancel", {});
  const cancelled = await ok(f.owner, "GET", f.root + "/runs/" + a.id); assert.ok(cancelled.samples.every((v: any) => v.task_status === "cancelled"));
});
test("insufficient multi-question budget leaves no GEO run, sample, task or reservation", async () => {
  const f = await fixture();
  await s.db.control.query("UPDATE wallets SET credit_limit_micros=1500000,balance_micros=0 WHERE tenant_id=$1", [f.tenant]);
  const before = (await s.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE project_id=$1", [f.project])).rows[0].n;
  const r = await call(f.owner, "POST", f.root + "/experiments/" + f.e.id + "/runs", { name: "Should roll back", per_question_budget_micros: "1000000" }); assert.ok(r.status >= 400);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM geo_runs WHERE experiment_id=$1", [f.e.id])).rows[0].n, 0);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE project_id=$1", [f.project])).rows[0].n, before);
});
test("GEO displays the real active-task quota and cannot bypass a Starter slot limit for a multi-question run", async () => {
  const f = await fixture();
  await s.db.control.query("UPDATE entitlements SET state='revoked' WHERE tenant_id=$1", [f.tenant]);
  const page = await ok(f.owner, "GET", f.root + "/experiments"); assert.equal(page.quota.available, 1);
  const r = await call(f.owner, "POST", f.root + "/experiments/" + f.e.id + "/runs", { name: "Too many slots", per_question_budget_micros: "1000000" });
  assert.equal(r.status, 409); assert.equal(r.data.error.code, "GEO_TASK_SLOTS_REQUIRED");
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM geo_runs WHERE experiment_id=$1", [f.e.id])).rows[0].n, 0);
});
test("completed API capture uses actual task bytes, is immutable and repeat capture does not call or charge a model", async () => {
  const f = await fixture(), run = await apiRun(f), runtime = await complete(f, run);
  assert.equal(runtime.contexts.length, 2);
  assert.equal((await ok(f.owner, "POST", f.root + "/runs/" + run.id + "/capture", {})).captured, 2);
  assert.equal((await ok(f.owner, "POST", f.root + "/runs/" + run.id + "/capture", {})).captured, 0);
  const report = await ok(f.owner, "GET", f.root + "/runs/" + run.id + "/export");
  assert.equal(report.progress.captured, 2);
  for (const sample of report.samples) {
    assert.equal(hash(Buffer.from(sample.answer)), sample.answer_sha256);
    assert.equal(sample.analysis.links[0].provenance, "answer_text_unverified");
    assert.equal(sample.analysis.mentions[0].matched, true);
    assert.equal((await s.db.control.query("SELECT private_owner FROM assets WHERE id=$1", [sample.asset_id])).rows[0].private_owner, f.owner.id);
    await assert.rejects(s.db.control.query("UPDATE geo_samples SET analysis='{}' WHERE id=$1", [sample.id]), /immutable/);
  }
  assert.equal(runtime.contexts.length, 2);
});
test("manual answers preserve exact original text and user provenance without API tasks, billing or invented missing answers", async () => {
  const f = await fixture(), run = await manualRun(f), report = await ok(f.owner, "GET", f.root + "/runs/" + run.id + "/export");
  assert.equal(report.surface, "consumer_manual"); assert.equal(report.effective_config.provenance, "user_supplied_unverified");
  assert.equal(report.progress.total, 2); assert.equal(report.samples.length, 1);
  assert.equal(report.samples[0].task_id, null); assert.equal(report.samples[0].cost_state, "no_api_request");
  assert.equal(report.samples[0].answer, manualBody().samples[0].answer);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE project_id=$1", [f.project])).rows[0].n, 0);
  const bad = { ...manualBody(), samples: [{ question_key: "other", answer: "Unknown question" }] };
  assert.equal((await call(f.owner, "POST", f.root + "/experiments/" + f.e.id + "/manual", bad)).status, 422);
});
test("repeat runs compare under the same hash, different revisions and consumer surfaces stay explicitly separate", async () => {
  const f = await fixture(), a = await apiRun(f, "A"), b = await apiRun(f, "B");
  await complete(f, a); await complete(f, b);
  for (const r of [a, b]) await ok(f.owner, "POST", f.root + "/runs/" + r.id + "/capture", {});
  const same = await ok(f.owner, "GET", f.root + "/compare?left=" + a.id + "&right=" + b.id);
  assert.equal(same.comparison.same_configuration, true); assert.ok(same.comparison.questions.every((q: any) => q.answer_changed === false));
  const manual = await manualRun(f), mixed = await ok(f.owner, "GET", f.root + "/compare?left=" + a.id + "&right=" + manual.id + "&download=json");
  assert.equal(mixed.comparison.mixed_surfaces, true); assert.equal(mixed.comparison.aggregate, null); assert.equal(mixed.comparison.questions[1].answer_changed, null);
  assert.ok(mixed.left.samples[0].answer); assert.ok(mixed.right.samples[0].answer);
  const e = await ok(f.owner, "POST", f.root + "/experiments", { spec: { ...f.spec, language: "繁體中文" }, previous_id: f.e.id, expected_sha256: f.e.sha256 });
  const changed = await apiRun({ ...f, e }, "Different locale");
  assert.equal((await ok(f.owner, "GET", f.root + "/compare?left=" + a.id + "&right=" + changed.id)).comparison.same_configuration, false);
});
test("GEO private reads, exports, comparison and RLS deny a second user and unrelated project", async () => {
  const f = await fixture(), other = await user(), run = await manualRun(f);
  await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role,status) VALUES($1,$2,'admin','active')", [f.tenant, other.id]);
  assert.equal((await ok(other, "GET", f.root + "/experiments")).items.length, 0);
  for (const path of ["/runs/" + run.id, "/runs/" + run.id + "/export", "/compare?left=" + run.id + "&right=" + run.id]) assert.equal((await call(other, "GET", f.root + path)).status, 404);
  const rows = await s.db.tx(tx => tx.query("SELECT * FROM geo_samples WHERE run_id=$1", [run.id]), f.tenant, false, other.id); assert.equal(rows.rowCount, 0);
  const foreign = await fixture(); assert.equal((await call(foreign.owner, "GET", foreign.root + "/runs/" + run.id)).status, 404);
});
test("GEO fake source locators, swapped task bindings and continuation cannot bypass the reviewed observation protocol", async () => {
  const f = await fixture(), run = await apiRun(f), samples = (await ok(f.owner, "GET", f.root + "/runs/" + run.id)).samples;
  await assert.rejects(s.db.control.query("UPDATE tasks SET input_context=input_context-'geo_sample_id' WHERE id=$1", [samples[0].task_id]), /immutable/);
  await assert.rejects(s.db.control.query("UPDATE geo_samples SET task_id=$2 WHERE id=$1", [samples[0].id, samples[1].task_id]), /immutable/);
  const r = await call(f.owner, "POST", f.base + "/tasks", { title: "Bypass", prompt: "Run again", role_key: "assistant", parent_id: samples[0].task_id, budget_micros: 1000000 });
  assert.ok(r.status >= 400, JSON.stringify(r.data));
});
test("configuration quarantine fences API work, raw answer downloads and existing sample exports; no zero replacement", async () => {
  const f = await fixture(), a = await apiRun(f), m = await manualRun(f), report = await ok(f.owner, "GET", f.root + "/runs/" + m.id);
  await s.db.control.query("UPDATE geo_experiments SET content_state='quarantined',moderation_version=moderation_version+1 WHERE id=$1", [f.e.id]);
  assert.equal((await call(f.owner, "GET", f.root + "/runs/" + m.id + "/export")).status, 404);
  const file = report.samples[0]; assert.equal((await call(f.owner, "GET", f.base + "/assets/" + file.asset_id + "/download?version=" + file.asset_version)).status, 404);
  const tasks = (await s.db.control.query("SELECT task_id FROM geo_samples WHERE run_id=$1", [a.id])).rows;
  for (const t of tasks) assert.equal((await s.db.control.query("SELECT task_content_sources_available($1) AS ok", [t.task_id])).rows[0].ok, false);
});
test("an actual managed read and next-generation task retain the manual GEO source and are fenced when its experiment is quarantined", async () => {
  const f = await fixture(), run = await manualRun(f), sample = (await ok(f.owner, "GET", f.root + "/runs/" + run.id)).samples[0];
  const delegate = (asset: string, name: string) => ok(f.owner, "POST", f.base + "/delegations", { title: name, prompt: "Read the supplied observation and write a short grounded brief.", mode: "execute", budget_micros: 1000000, client_message_id: randomUUID(), dependencies: [{ kind: "file", description: "Retained GEO evidence", resource_ids: [asset] }] });
  class Reader extends CodexRuntimeAdapter {
    source = sample.asset_id;
    override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
      const result = await ctx.tools.find(t => t.name === "asset_text_read")!.run({ asset_id: this.source }, randomUUID()) as any;
      assert.ok(result.text.length > 0);
      await ctx.tools.find(t => t.name === "deliver_text")!.run({ filename: "observation-brief.txt", mime_type: "text/plain", content: "A brief grounded in the retained GEO answer." }, randomUUID());
      return { text: "Grounded brief saved", status: "completed", inputTokens: 100, outputTokens: 100, usageKnown: true, accepted: true, thread: randomUUID(), turn: randomUUID() };
    }
  }
  const runtime = new Reader(s.db.config), first = await delegate(sample.asset_version_id, "Read original GEO answer");
  await new Worker(s.db, s.catalog, s.storage, runtime).run(f.tenant, first.task.id);
  const output = (await s.db.control.query("SELECT id,asset_id FROM asset_versions WHERE metadata->>'task_id'=$1", [first.task.id])).rows[0]; assert.ok(output);
  const next = await delegate(output.id, "Read derived GEO brief"); runtime.source = output.asset_id;
  await new Worker(s.db, s.catalog, s.storage, runtime).run(f.tenant, next.task.id);
  const refs = (await s.db.control.query("SELECT content_source_manifest($1,$2,ARRAY[$3::uuid],'{}') AS refs", [f.tenant, f.project, next.task.id])).rows[0].refs;
  assert.ok(refs?.some((r: any) => r.kind === "geo_samples" && r.id === sample.id));
  await s.db.control.query("UPDATE geo_experiments SET content_state='quarantined' WHERE id=$1", [f.e.id]);
  assert.equal((await s.db.control.query("SELECT content_source_manifest($1,$2,ARRAY[$3::uuid],'{}') AS refs", [f.tenant, f.project, next.task.id])).rows[0].refs, null);
  assert.equal((await call(f.owner, "GET", f.base + "/assets/" + output.asset_id + "/download?version=1")).status, 404);
});
test("GEO Admin metadata, independent body permission and quarantine remain project-scoped and audited", async () => {
  const f = await fixture(), other = await fixture(), run = await manualRun(f), foreign = await manualRun(other);
  const email = `geo-admin-${randomUUID()}@example.invalid`, secret = new OTPAuth.Secret({ size: 20 });
  const principal = (await s.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'GEO reviewer',$2) RETURNING id", [email, seal(s.db.config.MASTER_KEY!, secret.base32)])).rows[0].id;
  async function grant(permissions: string[]) {
    const role = "geo_" + randomUUID(); await s.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Scoped GEO reviewer',$2)", [role, JSON.stringify(permissions)]);
    await s.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'project',$3)", [principal, role, f.project]);
  }
  await grant(["admin.content.read"]);
  const ch = await ok(undefined, "POST", "/v1/admin/auth/challenge", { email }), mail = JSON.parse(await readFile(`${s.db.config.DATA_DIR}/mailbox/${ch.challenge_id}.json`, "utf8"));
  const verified = await call(undefined, "POST", "/v1/admin/auth/verify", { challenge_id: ch.challenge_id, code: mail.text.match(/\b\d{6}\b/)[0], totp: new OTPAuth.TOTP({ secret, digits: 6, period: 30, algorithm: "SHA1" }).generate() }); assert.equal(verified.status, 200);
  const cookie = verified.raw.cookies.find(v => v.name === "cp_admin_session")!, admin: Client = { id: principal, cookie: cookie.name + "=" + cookie.value, csrf: verified.data.csrf_token, admin: true };
  const list = await ok(admin, "GET", "/v1/admin/content?page_size=100");
  assert.ok([f.e.id, run.id].every(id => list.items.some((r: any) => r.id === id))); assert.ok(!list.items.some((r: any) => r.id === foreign.id));
  assert.equal((await call(admin, "GET", "/v1/admin/content/" + run.id + "/body")).status, 403);
  await grant(["admin.content.body.read", "admin.content.quarantine"]);
  const body = await ok(admin, "GET", "/v1/admin/content/" + run.id + "/body"); assert.equal(JSON.parse(body.text).surface, "consumer_manual");
  assert.equal((await call(admin, "GET", "/v1/admin/content/" + foreign.id + "/body")).status, 403);
  await ok(admin, "POST", "/v1/admin/content/" + f.e.id + "/action", { action: "quarantine", version: 1, reason: "Observation source requires review" });
  assert.equal((await call(f.owner, "GET", f.root + "/runs/" + run.id + "/export")).status, 404);
  assert.equal((await ok(other.owner, "GET", other.root + "/runs/" + foreign.id)).id, foreign.id);
  assert.ok((await s.db.control.query("SELECT 1 FROM audit_log WHERE principal_id=$1 AND action='admin.content.body.read'", [principal])).rowCount);
});
test("GEO expiry and permanent deletion journal and physically erase private raw answer files and task copies", async () => {
  const f = await fixture(), a = await apiRun(f); await complete(f, a); await ok(f.owner, "POST", f.root + "/runs/" + a.id + "/capture", {});
  const m = await manualRun(f);
  const files = (await s.db.control.query("SELECT v.id,v.storage_key FROM geo_samples s JOIN asset_versions v ON v.id=s.asset_version_id JOIN geo_runs r ON r.id=s.run_id WHERE r.experiment_id=$1", [f.e.id])).rows;
  await s.db.control.query("UPDATE geo_experiments SET retention_expires_at=now()-interval '1 second' WHERE id=$1", [f.e.id]);
  assert.equal((await call(f.owner, "GET", f.root + "/runs/" + m.id)).status, 404);
  await new RetentionService(s.db, s.storage).expireContent();
  const eraser = new ErasureService(s.db, s.storage);
  for (let i = 0; i < 8; i++) { await eraser.advance(30); await s.db.control.query("UPDATE deletion_jobs SET next_attempt_at=now() WHERE tenant_id=$1 AND state='queued'", [f.tenant]); }
  const jobs = (await s.db.control.query("SELECT target_type,state,exceptions FROM deletion_jobs WHERE tenant_id=$1", [f.tenant])).rows;
  assert.ok(jobs.every(j => j.state === "completed"), JSON.stringify(jobs));
  for (const file of files) { await assert.rejects(s.storage.get(file.storage_key)); assert.ok((await s.db.control.query("SELECT erased_at FROM asset_versions WHERE id=$1", [file.id])).rows[0].erased_at); }
  assert.ok((await s.db.control.query("SELECT output FROM tasks WHERE project_id=$1", [f.project])).rows.every(t => t.output === null));
  assert.ok((await s.db.control.query("SELECT analysis FROM geo_samples WHERE project_id=$1", [f.project])).rows.every(t => t.analysis === null));
});
test("SQL099 upgrade preserves original source-function OIDs, a prepared query and all applied historical checksums", async () => {
  const old = await isolatedTestEnvironment({ throughVersion: 99 }), client = new pg.Client({ connectionString: old.env.OWNER_DATABASE_URL }); await client.connect();
  try {
    const before = (await client.query("SELECT oid,proname FROM pg_proc WHERE oid IN('content_source_manifest(uuid,uuid,uuid[],uuid[])'::regprocedure,'publication_input_sources(uuid)'::regprocedure) ORDER BY oid")).rows;
    const history = (await client.query("SELECT version,source_sha256 FROM schema_migrations ORDER BY version")).rows;
    await client.query("PREPARE preserved_geo_reader AS SELECT content_source_manifest('00000000-0000-4000-8000-000000000000','00000000-0000-4000-8000-000000000000','{}','{}') AS refs");
    await runMigrations(client, "GEO 099 to 100");
    assert.deepEqual((await client.query("SELECT oid,proname FROM pg_proc WHERE oid=ANY($1::oid[]) ORDER BY oid", [before.map(v => v.oid)])).rows, before);
    assert.deepEqual((await client.query("SELECT version,source_sha256 FROM schema_migrations WHERE version<=99 ORDER BY version")).rows, history);
    assert.deepEqual((await client.query("EXECUTE preserved_geo_reader")).rows[0].refs, []);
  } finally { await client.end(); await old.cleanup(); }
});
test("real pinned Codex processes repeat independent GEO questions through the synthetic company gateway with no business tools", async () => {
  const f = await fixture(), a = await apiRun(f, "Actual Codex A"), b = await apiRun(f, "Actual Codex B");
  for (const r of [a, b]) {
    const detail = await ok(f.owner, "GET", f.root + "/runs/" + r.id);
    for (const sample of detail.samples) await s.worker.run(f.tenant, sample.task_id);
    const completed = await ok(f.owner, "GET", f.root + "/runs/" + r.id);
    assert.ok(completed.samples.every((v: any) => v.task_status === "succeeded"), JSON.stringify(completed));
    await ok(f.owner, "POST", f.root + "/runs/" + r.id + "/capture", {});
    const report = await ok(f.owner, "GET", f.root + "/runs/" + r.id + "/export");
    assert.equal(report.progress.captured, 2);
    assert.ok(report.samples.every((v: any) => typeof v.answer === "string" && v.answer.length > 0));
    for (const sample of detail.samples) {
      const task = (await s.db.control.query("SELECT input_tokens,output_tokens,runtime_thread FROM tasks WHERE id=$1", [sample.task_id])).rows[0];
      assert.ok(Number(task.input_tokens) > 0 && Number(task.output_tokens) > 0 && task.runtime_thread);
      assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM tool_operations WHERE task_id=$1", [sample.task_id])).rows[0].n, 0);
    }
  }
  assert.equal((await ok(f.owner, "GET", f.root + "/compare?left=" + a.id + "&right=" + b.id)).comparison.same_configuration, true);
});
