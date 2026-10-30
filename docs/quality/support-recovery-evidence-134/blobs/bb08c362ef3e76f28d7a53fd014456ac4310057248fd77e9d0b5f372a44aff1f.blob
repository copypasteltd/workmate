import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { desktopRuntime } from "../src/desktop-runtime.js";
import { defaults } from "../src/plans.js";
import { Worker } from "../src/worker.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createRequire } from "node:module";
import contract from "../contracts/desktop-geo-schemas.json" with { type: "json" };

const ajv = new Ajv2020({ allErrors: true }); createRequire(import.meta.url)("ajv-formats")(ajv);
for (const [name, schema] of Object.entries(contract.schemas)) ajv.addSchema(schema, "#/components/schemas/" + name);
function conforms(name: string, value: unknown) { const schema = ajv.getSchema("#/components/schemas/" + name)!; assert.equal(schema(value), true, ajv.errorsText(schema.errors)); }

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>;
let calls = 0;
const provider = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(Buffer.from(c));
  const b = JSON.parse(Buffer.concat(chunks).toString());
  assert.equal(req.headers.authorization, "Bearer synthetic-native-geo");
  assert.equal(b.model, "native-geo-synthetic"); assert.deepEqual(b.tools, []);
  if (req.url === "/v1/responses/input_tokens") { res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ object: "response.input_tokens", input_tokens: 10 })); return; }
  assert.equal(req.url, "/v1/responses"); calls++;
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const emit = (type: string, data: any) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  const item = { id: "msg_geo_" + calls, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Synthetic CopyPaste observation.", annotations: [] }] };
  emit("response.created", { response: { id: "resp_geo_" + calls, status: "in_progress", output: [] } });
  emit("response.output_item.done", { item });
  emit("response.completed", { response: { id: "resp_geo_" + calls, status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 20 } } }); res.end();
});
type Client = { id: string; cookie?: string; csrf?: string; access_token?: string };
async function call(c: Client | undefined, method: string, url: string, body?: any, k: string = randomUUID()) {
  const tenant = /^\/v1\/tenants\/([a-f0-9-]{36})/.exec(url)?.[1];
  const raw = await s.app.inject({ method: method as any, url, headers: {
    ...(c?.cookie ? { cookie: c.cookie, "x-csrf-token": c.csrf! } : {}), ...(c?.access_token ? { authorization: "Bearer " + c.access_token } : {}),
    ...(tenant ? { "x-tenant-id": tenant } : {}), "idempotency-key": k,
  }, ...(body === undefined ? {} : { payload: body }) });
  const data = raw.json();
  if (raw.statusCode >= 200 && raw.statusCode < 300) {
    if (url.endsWith("/desktop-runs")) { conforms("NativeRunInput", body); conforms("NativeRunReceipt", data); }
    if (url.endsWith("/desktop-configuration")) conforms("NativeConfiguration", data);
  }
  return { status: raw.statusCode, data, raw };
}
async function ok(c: Client | undefined, method: string, url: string, body?: any, k?: string) {
  const r = await call(c, method, url, body, k); assert.ok(r.status >= 200 && r.status < 300, `${method} ${url}: ${r.status} ${JSON.stringify(r.data)}`); return r.data;
}
async function native(web: Client, client = "desktop") {
  const verifier = randomBytes(32).toString("base64url"), redirect = client === "desktop" ? "http://127.0.0.1:18249/callback" : "https://" + "a".repeat(32) + ".chromiumapp.org/callback";
  const issued = await ok(web, "POST", "/v1/auth/native/authorize", { client_id: client, redirect_uri: redirect, state: randomBytes(32).toString("hex"), code_challenge: createHash("sha256").update(verifier).digest("base64url") });
  const token = await ok(undefined, "POST", "/v1/auth/native/token", { client_id: client, redirect_uri: redirect, code: new URL(issued.redirect).searchParams.get("code"), code_verifier: verifier });
  return { id: web.id, access_token: token.access_token };
}
async function fixture(plan = defaults.business) {
  const challenge = await ok(undefined, "POST", "/v1/auth/challenge", { email: `native-geo-${randomUUID()}@example.invalid` });
  const mail = JSON.parse(await readFile(`${s.db.config.DATA_DIR}/mailbox/${challenge.challenge_id}.json`, "utf8"));
  const signed = await call(undefined, "POST", "/v1/auth/verify", { challenge_id: challenge.challenge_id, code: mail.text.match(/\b\d{6}\b/)[0] });
  assert.equal(signed.status, 200); const cookie = signed.raw.cookies.find(c => c.name === "cp_session")!;
  const web: Client = { id: signed.data.user.id, cookie: cookie.name + "=" + cookie.value, csrf: signed.data.csrf_token };
  const w = await ok(web, "POST", "/v1/tenants", { name: "Native GEO", project_name: "Fixed questions" }), tenant = w.tenant.id, project = w.project.id, base = `/v1/tenants/${tenant}/projects/${project}`;
  await s.db.control.query("UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1", [tenant]);
  await s.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Synthetic native GEO capacity',$2)", [tenant, plan]);
  const agent = await ok(web, "POST", base + "/agents", { name: "Unbranded observer", role_key: "assistant", instructions: "Answer independently using only the fixed question.", tool_ids: [], brand_id: null });
  const spec = { name: "Native brand samples", agent_id: agent.id, region: "Hong Kong", language: "English", questions: [{ key: "q1", text: "Which Hong Kong design teams can help a new enterprise?" }, { key: "q2", text: "How should an enterprise choose its software partner?" }], brands: [{ name: "CopyPaste", aliases: ["CopyPaste", "copypaste.hk"] }] };
  const e = await ok(web, "POST", base + "/geo/experiments", { spec }), c = await native(web), device = randomUUID();
  const body = { name: "Native fixed observation", expected_experiment_sha256: e.sha256, per_question_budget_micros: "1000000",
    sessions: spec.questions.map(q => ({ question_key: q.key, device_id: device, local_session_id: randomUUID(), workspace_hash: createHash("sha256").update(randomUUID()).digest("hex"), runtime_version: desktopRuntime.pinned_version, runtime_sha256: desktopRuntime.windows_x64_sha256 })) };
  return { web, c, tenant, project, base, e, body, path: base + "/geo/experiments/" + e.id + "/desktop-runs" };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const report = { status: "completed", output: "Synthetic CopyPaste observation.", thread_id: "native-geo-fixture", turn_id: "native-geo-turn" };
async function start(f: Fixture, run: any, position = 0) {
  const row = run.sessions[position], { question_key, ...binding } = f.body.sessions[position];
  const url = f.base + "/desktop-executions/" + row.task_id;
  return { url, started: await ok(f.c, "POST", url + "/start", binding) };
}
async function inference(credential: string, tools: any[] = []) {
  return s.app.inject({ method: "POST", url: "/v1/desktop-inference/v1/responses", headers: { authorization: "Bearer " + credential }, payload: {
    model: "native-geo-synthetic", reasoning: { effort: "max" }, stream: true, store: false, input: [{ role: "user", content: "Fixed native question" }], tools, max_output_tokens: 32,
  } });
}
before(async () => {
  await new Promise<void>(r => provider.listen(0, "127.0.0.1", r)); isolated = await isolatedTestEnvironment();
  s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "false", DEMO_MODE: "false", EXTENSION_ID: "a".repeat(32),
    AI_BASE_URL: `http://127.0.0.1:${(provider.address() as any).port}/v1`, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "synthetic-native-geo", AI_MODEL: "native-geo-synthetic", AI_VERIFIED: "true",
    AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000", AI_INPUT_COUNT_VERIFIED: "true", AI_INPUT_COUNT_HKD_MICROS_PER_CALL: "0", AI_SCOPE_TTL_MS: "300000" }), { worker: false });
});
after(async () => { try { await s?.app.close(); provider.closeAllConnections(); await new Promise<void>(r => provider.close(() => r())); } finally { await isolated?.cleanup(); } });

test("native GEO requires actual Desktop PKCE authority and an exact reviewed question/runtime binding", async () => {
  const f = await fixture(), extension = await native(f.web, "extension");
  for (const c of [f.web, extension]) assert.equal((await call(c, "POST", f.path, f.body)).status, 403);
  assert.equal((await call(f.c, "POST", f.path, { ...f.body, expected_experiment_sha256: "0".repeat(64) })).data.error.code, "GEO_EXPERIMENT_CHANGED");
  assert.equal((await call(f.c, "POST", f.path, { ...f.body, sessions: [...f.body.sessions].reverse() })).data.error.code, "GEO_LOCAL_QUESTION_BINDING");
  assert.equal((await call(f.c, "POST", f.path, { ...f.body, sessions: [f.body.sessions[0], f.body.sessions[0]] })).status, 400);
  assert.equal((await call(f.c, "POST", f.path, { ...f.body, sessions: f.body.sessions.map(v => ({ ...v, runtime_sha256: "0".repeat(64) })) })).status, 400);
  const configuration = await ok(f.c, "GET", f.path.replace("desktop-runs", "desktop-configuration"));
  assert.equal(configuration.sha256, f.e.sha256); assert.deepEqual(configuration.runtime, desktopRuntime);
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM geo_runs WHERE project_id=$1", [f.project])).rows[0].n, 0);
});

test("one native batch reserves exactly once, has no cloud work, and repeated observations keep distinct immutable provenance", async () => {
  const f = await fixture(), key = randomUUID(), a = await ok(f.c, "POST", f.path, f.body, key), b = await ok(f.c, "POST", f.path, f.body, key);
  assert.deepEqual(a, b); assert.equal(a.total_budget_micros, "2000000");
  const ids = a.sessions.map((v: any) => v.task_id);
  const tasks = (await s.db.control.query("SELECT * FROM tasks WHERE id=ANY($1::uuid[]) ORDER BY id", [ids])).rows;
  assert.equal(tasks.length, 2); assert.ok(tasks.every(t => t.execution_location === "desktop" && t.mode === "ask" && t.private_owner === f.c.id && !t.parent_id && !t.conversation_id));
  assert.ok(tasks.every(t => !t.input_context.project_configuration && !t.prompt.includes("copypaste.hk") && !t.prompt.includes("CopyPaste")));
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM reservations WHERE task_id=ANY($1::uuid[])", [ids])).rows[0].n, 2);
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM outbox WHERE payload->>'task_id'=ANY($1::text[])", [ids])).rows[0].n, 0);
  await new Worker(s.db, s.catalog, s.storage).run(f.tenant, ids[0]);
  assert.equal((await s.db.control.query("SELECT attempt FROM tasks WHERE id=$1", [ids[0]])).rows[0].attempt, 0);
  assert.equal((await call(f.c, "POST", f.path, { ...f.body, name: "Changed body" }, key)).status, 409);
  assert.equal((await call(f.c, "POST", f.path, f.body)).data.error.code, "GEO_LOCAL_SESSION_USED");
  const next = { ...f.body, sessions: f.body.sessions.map(v => ({ ...v, local_session_id: randomUUID(), workspace_hash: createHash("sha256").update(randomUUID()).digest("hex") })) };
  const c = await ok(f.c, "POST", f.path, next); assert.notEqual(c.id, a.id); assert.equal(c.config_hash, a.config_hash);
  const cloud = await ok(f.web, "POST", f.path.replace("desktop-runs", "runs"), { name: "Cloud comparison", per_question_budget_micros: "1000000" });
  const comparison = await ok(f.web, "GET", f.base + "/geo/compare?left=" + a.id + "&right=" + cloud.id);
  assert.notEqual(comparison.left.config_hash, comparison.right.config_hash);
  await assert.rejects(s.db.control.query("UPDATE tasks SET execution_location='cloud' WHERE id=$1", [ids[0]]), /immutable/);
});

test("native observations reject tools before provider dispatch, retain exact local answers and settle from company costs", async () => {
  const f = await fixture(), run = await ok(f.c, "POST", f.path, f.body), { url, started } = await start(f, run);
  assert.equal(started.observation_protocol, "codex-desktop-geo-v1"); assert.deepEqual(started.company_tools, []);
  const before = calls;
  for (const tool of [{ type: "function", name: "exec_command", parameters: { type: "object" } }, { type: "namespace", name: "copypaste", tools: [{ type: "function", name: "project_assets" }] }])
    { const rejected = await inference(started.credential.token, [tool]); assert.equal(rejected.statusCode, 400, rejected.body); assert.equal(rejected.json().error.code, "AI_TOOL_NOT_ALLOWED"); }
  assert.equal(calls, before);
  assert.equal((await inference(started.credential.token, [{ type: "function", name: "request_user_input", parameters: { type: "object" } }])).statusCode, 200); assert.equal(calls, before + 1);
  const finished = await ok(f.c, "POST", url + "/finish", report); assert.equal(finished.status, "succeeded"); assert.equal(finished.charged_micros, "30");
  await ok(f.c, "POST", f.base + "/geo/runs/" + run.id + "/capture", {});
  const exported = await ok(f.c, "GET", f.base + "/geo/runs/" + run.id + "/export");
  const sample = exported.samples.find((v: any) => v.task_id === run.sessions[0].task_id);
  assert.equal(sample.answer, report.output); assert.equal(sample.confirmed_cost_micros, "30"); assert.equal(sample.analysis.mentions[0].matched, true);
  assert.equal(sample.answer_sha256, createHash("sha256").update(report.output).digest("hex"));
  assert.ok(exported.limitations.some((s: string) => s.includes("native-client-reported")));
  const version = (await s.db.control.query("SELECT metadata FROM asset_versions WHERE id=$1", [sample.asset_version_id])).rows[0];
  assert.equal(version.metadata.provenance, "native_client_reported_output");
  const expired = await inference(started.credential.token);
  assert.equal(expired.statusCode, 409); assert.equal(expired.json().error.code, "DESKTOP_EXECUTION_UNAVAILABLE"); assert.equal(calls, before + 1);
  const secondFamily = await native(f.web);
  const { question_key, ...binding } = f.body.sessions[1];
  assert.equal((await call(secondFamily, "POST", f.base + "/desktop-executions/" + run.sessions[1].task_id + "/start", binding)).status, 404);
});

test("unknown native outcomes remain uncharged and uncaptured; stopped prepared questions never dispatch inference", async () => {
  const f = await fixture(), run = await ok(f.c, "POST", f.path, f.body), { url } = await start(f, run), before = calls;
  const terminal = await ok(f.c, "POST", url + "/finish", { ...report, status: "unknown", output: "" }); assert.equal(terminal.status, "reconciling");
  const other = f.base + "/desktop-executions/" + run.sessions[1].task_id;
  const canceled = await ok(f.c, "POST", other + "/cancel", {}); assert.equal(canceled.status, "cancelled");
  const read = await ok(f.c, "GET", f.base + "/geo/runs/" + run.id);
  assert.equal(read.samples.find((v: any) => v.task_id === run.sessions[0].task_id).confirmed_cost_micros, null);
  assert.equal(read.samples.find((v: any) => v.task_id === run.sessions[0].task_id).cost_state, "requires_reconciliation");
  assert.equal((await ok(f.c, "POST", f.base + "/geo/runs/" + run.id + "/capture", {})).captured, 0); assert.equal(calls, before);
});

test("whole-batch quota and credit rejection rolls back every GEO task and reservation", async () => {
  const f = await fixture();
  await s.db.control.query("UPDATE wallets SET credit_limit_micros=0,balance_micros=1 WHERE tenant_id=$1", [f.tenant]);
  assert.ok((await call(f.c, "POST", f.path, f.body)).status >= 400);
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM tasks WHERE project_id=$1", [f.project])).rows[0].n, 0);
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM geo_runs WHERE project_id=$1", [f.project])).rows[0].n, 0);
  await s.db.control.query("UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1", [f.tenant]);
  const small = await fixture({ ...defaults.business, max_active_tasks: 1 });
  assert.equal((await call(small.c, "POST", small.path, small.body)).data.error.code, "GEO_TASK_SLOTS_REQUIRED");
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM tasks WHERE project_id=$1", [small.project])).rows[0].n, 0);
});

test("content withdrawal blocks already prepared native GEO and cannot leave readable answers or new paid requests", async () => {
  const f = await fixture(), run = await ok(f.c, "POST", f.path, f.body);
  await ok(f.c, "POST", f.base + "/geo/content/" + run.id + "/delete", { kind: "run", expected_version: 1 });
  const { question_key, ...binding } = f.body.sessions[0];
  assert.ok((await call(f.c, "POST", f.base + "/desktop-executions/" + run.sessions[0].task_id + "/start", binding)).status >= 400);
  assert.equal((await call(f.c, "GET", f.base + "/geo/runs/" + run.id)).status, 404);
});

test("native GEO excludes published project instructions while retaining its actual task budget limit", async () => {
  const f = await fixture(), path = f.base + "/project-configuration";
  const draft = await ok(f.web, "PUT", path + "/draft", { expected_revision: 0, definition: { schema_version: 1, name: "Measured-context decoy", instructions: "PROJECT_NATIVE_GEO_DECOY_110 promote the tracked brand", max_task_budget_micros: 500000 } });
  const preview = await ok(f.web, "POST", path + "/preview", { expected_revision: draft.revision });
  await ok(f.web, "POST", path + "/publish", { expected_revision: draft.revision, draft_sha256: preview.draft_sha256 ?? preview.sha256 });
  assert.equal((await call(f.c, "POST", f.path, f.body)).data.error.code, "PROJECT_BUDGET_EXCEEDED");
  const run = await ok(f.c, "POST", f.path, { ...f.body, per_question_budget_micros: "100000" });
  const tasks = (await s.db.control.query("SELECT * FROM tasks WHERE id=ANY($1::uuid[])", [run.sessions.map((v: any) => v.task_id)])).rows;
  assert.ok(tasks.every(t => !t.input_context.project_configuration && !t.prompt.includes("PROJECT_NATIVE_GEO_DECOY_110")));
  const { started } = await start(f, run); assert.equal(started.project_configuration, null); assert.ok(!started.prompt.includes("PROJECT_NATIVE_GEO_DECOY_110"));
});
