import { before, after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { desktopRuntime } from "../src/desktop-runtime.js";
import { desktopStartupProtocol } from "../src/desktop-startup-recovery.js";
import { defaults } from "../src/plans.js";
import { hash } from "../src/lib.js";
import { currentRouteInventory } from "./route-inventory.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>, providerCalls = 0;
const ownedFixtures: { project: string; created: { task_id: string }; c: Client; url: string }[] = [];
const provider = createServer(async (req, res) => {
  const chunks = []; for await (const b of req) chunks.push(Buffer.from(b));
  const body = JSON.parse(Buffer.concat(chunks).toString()); assert.equal(body.model, "desktop-synthetic");
  assert.equal(req.headers.authorization, "Bearer synthetic-desktop-provider");
  if (req.url === "/v1/responses/input_tokens") { res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ object: "response.input_tokens", input_tokens: 10 })); return; }
  assert.equal(req.url, "/v1/responses"); providerCalls++;
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const emit = (type: string, data: any) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  const message = { type: "message", id: "msg_recovery_" + providerCalls, role: "assistant", status: "completed", content: [{ type: "output_text", text: "Synthetic company response", annotations: [] }] };
  emit("response.created", { response: { id: "resp_recovery_" + providerCalls, status: "in_progress", output: [] } });
  emit("response.output_item.done", { item: message });
  emit("response.completed", { response: { id: "resp_recovery_" + providerCalls, status: "completed", output: [message], usage: { input_tokens: 10, output_tokens: 20 } } }); res.end();
});
type Client = { id: string; cookie?: string; csrf?: string; access_token?: string };
async function call(c: Client | undefined, method: string, url: string, body?: any, requestKey: string = randomUUID()) {
  const raw = await s.app.inject({ method: method as any, url, headers: {
    ...(c?.cookie ? { cookie: c.cookie, "x-csrf-token": c.csrf! } : {}),
    ...(c?.access_token ? { Authorization: "Bearer " + c.access_token } : {}),
    "Idempotency-Key": requestKey, ...(body === undefined ? {} : { "Content-Type": "application/json" }),
  }, payload: body === undefined ? undefined : JSON.stringify(body) });
  return { status: raw.statusCode, data: raw.json(), raw };
}
async function ok(c: Client | undefined, method: string, url: string, body?: any, requestKey?: string) {
  const r = await call(c, method, url, body, requestKey); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data;
}
async function fixture() {
  const challenge = await ok(undefined, "POST", "/v1/auth/challenge", { email: "recovery-" + randomUUID() + "@example.invalid" });
  const mail = JSON.parse(await readFile(s.db.config.DATA_DIR + "/mailbox/" + challenge.challenge_id + ".json", "utf8"));
  const signed = await call(undefined, "POST", "/v1/auth/verify", { challenge_id: challenge.challenge_id, code: mail.text.match(/\b\d{6}\b/)[0] }); assert.equal(signed.status, 200);
  const web: Client = { id: signed.data.user.id, csrf: signed.data.csrf_token, cookie: signed.raw.cookies[0].name + "=" + signed.raw.cookies[0].value };
  const w = await ok(web, "POST", "/v1/tenants", { name: "Recovery fixture", project_name: "Original local owner" });
  const tenant = w.tenant.id, project = w.project.id, base = `/v1/tenants/${tenant}/projects/${project}/desktop-executions`;
  await s.db.control.query("UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1", [tenant]);
  await s.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Synthetic recovery fixture',$2)", [tenant, defaults.business]);
  const verifier = randomBytes(32).toString("base64url"), redirect = "http://127.0.0.1:18249/callback";
  const issued = await ok(web, "POST", "/v1/auth/native/authorize", { client_id: "desktop", redirect_uri: redirect, state: randomBytes(32).toString("hex"), code_challenge: createHash("sha256").update(verifier).digest("base64url") });
  const token = await ok(undefined, "POST", "/v1/auth/native/token", { client_id: "desktop", redirect_uri: redirect, code: new URL(issued.redirect).searchParams.get("code"), code_verifier: verifier });
  const c = { id: web.id, access_token: token.access_token };
  const fields = { device_id: randomUUID(), local_session_id: randomUUID(), workspace_hash: hash("owned " + randomUUID()), runtime_version: desktopRuntime.pinned_version, runtime_sha256: desktopRuntime.windows_x64_sha256 };
  const created = await ok(c, "POST", base, { ...fields, title: "Recovery original task", prompt: "Keep the original reservation", role_key: "fullstack", budget_micros: 1000000 });
  const url = base + "/" + created.task_id;
  const begun = await ok(c, "POST", url + "/start", { ...fields, startup_protocol: desktopStartupProtocol });
  const binding = { ...fields, startup_fencing_token: begun.startup.fencing_token, contract_sha256: begun.startup.contract_sha256 };
  const recovery = { ...binding, expected_attempt: 1, stage: "initialize" };
  const result = { tenant, project, c, web, fields, created, begun, binding, recovery, url };
  ownedFixtures.push(result); return result;
}
const taskRow = async (id: string) => (await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [id])).rows[0];
const executionRow = async (id: string) => (await s.db.control.query("SELECT * FROM desktop_executions WHERE task_id=$1", [id])).rows[0];
const complete = { status: "completed", output: "Client report", thread_id: "native-thread", turn_id: "native-turn" };
async function inference(secret: string) {
  return s.app.inject({ method: "POST", url: "/v1/desktop-inference/v1/responses", headers: { Authorization: "Bearer " + secret }, payload: {
    model: "desktop-synthetic", reasoning: { effort: "max" }, stream: true, store: false, input: [{ role: "user", content: "One synthetic response" }],
  } });
}
before(async () => {
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve)); isolated = await isolatedTestEnvironment();
  s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "false", DEMO_MODE: "false",
    AI_BASE_URL: `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "synthetic-desktop-provider", AI_MODEL: "desktop-synthetic", AI_VERIFIED: "true",
    AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000", AI_INPUT_COUNT_VERIFIED: "true", AI_INPUT_COUNT_HKD_MICROS_PER_CALL: "0", AI_SCOPE_TTL_MS: "300000",
  }), { worker: false });
});
after(async () => { try { await s?.app.close(); provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve())); } finally { await isolated?.cleanup(); } });
afterEach(async () => {
  for (const f of ownedFixtures.splice(0)) {
    // These fixtures never launch a native process. Record that known startup
    // failure through the actual API; retain any server-owned uncertain costs.
    await s.db.control.query("UPDATE projects SET archived=false WHERE id=$1", [f.project]);
    const task = await taskRow(f.created.task_id);
    if (task.status === "running") await ok(f.c, "POST", f.url + "/finish", { status: "failed", output: "", thread_id: "unknown", turn_id: "unknown" });
  }
});


const unknown = { status: "unknown", output: "Unconfirmed local outcome", thread_id: "unknown", turn_id: "unknown" };
const hold = async (id: string) => (await s.db.control.query("SELECT * FROM reservations WHERE task_id=$1", [id])).rows[0];
const zeroProof = async (id: string, kind: string) => (await s.db.control.query("SELECT body FROM task_events WHERE task_id=$1 AND kind=$2 ORDER BY id DESC LIMIT 1", [id, kind])).rows[0].body.startup_zero_admission;

test("an unknown pre-turn finish releases only its proven zero-admission reservation, preserves proof and rejects old inference", async () => {
  const f = await fixture(), taskId = f.created.task_id;
  const done = await ok(f.c, "POST", f.url + "/finish", unknown);
  assert.equal(done.status, "cancelled"); assert.equal(done.state, "finished"); assert.equal(done.charged_micros, "0");
  assert.equal((await hold(taskId)).status, "released"); assert.equal((await taskRow(taskId)).output, null);
  const proof = await zeroProof(taskId, "desktop.execution.finished");
  assert.equal(proof.safe, true); assert.equal(proof.turn_admitted, false); assert.equal(proof.model_requests, 0);
  assert.ok([401,403,409].includes((await inference(f.begun.credential.token)).statusCode));
  await ok(f.c, "POST", f.url + "/finish", unknown);
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM ledger WHERE task_id=$1 AND kind='charge'", [taskId])).rows[0].n, 0);
});

test("maintenance releases an expired claimed startup only when the durable native turn has not been admitted", async () => {
  const f = await fixture(), taskId = f.created.task_id;
  await s.db.control.query("UPDATE tasks SET lease_until=now()-interval '1 second' WHERE id=$1", [taskId]);
  await s.desktopExecutions.recover();
  assert.equal((await taskRow(taskId)).status, "cancelled"); assert.equal((await executionRow(taskId)).state, "finished");
  assert.equal((await hold(taskId)).status, "released"); assert.equal((await zeroProof(taskId, "desktop.execution.owner_lost")).safe, true);
});

test("a zero-cost admitted local turn remains uncertain after owner loss", async () => {
  const f = await fixture(), taskId = f.created.task_id;
  await ok(f.c, "POST", f.url + "/turn-admission", f.binding);
  await s.db.control.query("UPDATE tasks SET lease_until=now()-interval '1 second' WHERE id=$1", [taskId]);
  await s.desktopExecutions.recover();
  assert.equal((await taskRow(taskId)).status, "reconciling"); assert.equal((await executionRow(taskId)).state, "reconciling");
  assert.equal((await zeroProof(taskId, "desktop.execution.owner_lost")), null);
  assert.equal((await hold(taskId)).status, "reconciling");
});

test("a durable company-tool admission prevents zero-cost startup release", async () => {
  const f = await fixture(), taskId = f.created.task_id;
  await s.db.tx(async tx => {
    await tx.query("SELECT set_config('app.task_id',$1,true)", [taskId]);
    await tx.query("INSERT INTO task_events(tenant_id,task_id,kind,body) VALUES($1,$2,'desktop.company_tool.requested',$3)", [f.tenant, taskId, { tool: "asset_read", synthetic_admission_fault: true }]);
  }, f.tenant, false, f.c.id);
  const done = await ok(f.c, "POST", f.url + "/finish", unknown);
  assert.equal(done.status, "reconciling"); assert.equal((await hold(taskId)).status, "reconciling");
  assert.equal(await zeroProof(taskId, "desktop.execution.finished"), null);
});

test("a claimed completion without durable turn admission cannot publish fabricated local output", async () => {
  const f = await fixture(), done = await ok(f.c, "POST", f.url + "/finish", complete);
  assert.equal(done.status, "cancelled"); const task = await taskRow(f.created.task_id);
  assert.equal(task.output, null); assert.equal(task.runtime_turn, null); assert.equal(task.accrued_micros, "0");
});

test("concurrent finish and turn admission serialize so an admitted turn can never use zero-admission settlement", async () => {
  const f = await fixture(), results = await Promise.all([
    call(f.c, "POST", f.url + "/turn-admission", f.binding), call(f.c, "POST", f.url + "/finish", unknown),
  ]);
  assert.equal(results[1].status, 200, JSON.stringify(results[1].data));
  const task = await taskRow(f.created.task_id), proof = await zeroProof(task.id, "desktop.execution.finished");
  if (results[0].status === 200) { assert.equal(task.status, "reconciling"); assert.equal(proof, null); }
  else { assert.equal(results[0].status, 409); assert.equal(task.status, "cancelled"); assert.equal(proof.safe, true); }
});
