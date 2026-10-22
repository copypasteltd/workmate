import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { desktopRuntime } from "../src/desktop-runtime.js";
import { Worker } from "../src/worker.js";
import { recoverQueuedClaims } from "../src/task-recovery.js";
import { defaults } from "../src/plans.js";
import { hash } from "../src/lib.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>;
let mode: "known" | "unknown" = "known", providerCalls = 0, countCalls = 0;
const provider = createServer(async (req, res) => {
  const bytes = []; for await (const part of req) bytes.push(Buffer.from(part));
  const b = JSON.parse(Buffer.concat(bytes).toString());
  assert.equal(req.headers.authorization, "Bearer synthetic-desktop-provider");
  assert.equal(b.model, "desktop-synthetic");
  if (req.url === "/v1/responses/input_tokens") {
    countCalls++; res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ object: "response.input_tokens", input_tokens: 10 })); return;
  }
  assert.equal(req.url, "/v1/responses"); providerCalls++;
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const emit = (type: string, data: any) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  const message = { type: "message", id: "msg_desktop_" + providerCalls, role: "assistant", status: "completed", content: [{ type: "output_text", text: "Synthetic company response", annotations: [] }] };
  emit("response.created", { response: { id: "resp_desktop_" + providerCalls, status: "in_progress", output: [] } });
  emit("response.output_item.done", { item: message });
  if (mode === "known") emit("response.completed", { response: { id: "resp_desktop_" + providerCalls, status: "completed", output: [message], usage: { input_tokens: 10, output_tokens: 20 } } });
  res.end();
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
async function native(web: Client, client = "desktop") {
  const verifier = randomBytes(32).toString("base64url"), redirect = client === "desktop" ? "http://127.0.0.1:18249/callback" : "https://" + "a".repeat(32) + ".chromiumapp.org/callback";
  const issued = await ok(web, "POST", "/v1/auth/native/authorize", { client_id: client, redirect_uri: redirect, state: randomBytes(32).toString("hex"), code_challenge: createHash("sha256").update(verifier).digest("base64url") });
  const t = await ok(undefined, "POST", "/v1/auth/native/token", { client_id: client, redirect_uri: redirect, code: new URL(issued.redirect).searchParams.get("code"), code_verifier: verifier });
  return { id: web.id, access_token: t.access_token };
}
async function fixture() {
  mode = "known";
  const ch = await ok(undefined, "POST", "/v1/auth/challenge", { email: "desktop-" + randomUUID() + "@example.invalid" });
  const mail = JSON.parse(await readFile(s.db.config.DATA_DIR + "/mailbox/" + ch.challenge_id + ".json", "utf8"));
  const signed = await call(undefined, "POST", "/v1/auth/verify", { challenge_id: ch.challenge_id, code: mail.text.match(/\b\d{6}\b/)[0] }); assert.equal(signed.status, 200);
  const web: Client = { id: signed.data.user.id, csrf: signed.data.csrf_token, cookie: signed.raw.cookies[0].name + "=" + signed.raw.cookies[0].value };
  const workspace = await ok(web, "POST", "/v1/tenants", { name: "Desktop execution fixture", project_name: "Native ownership" });
  const tenant = workspace.tenant.id, project = workspace.project.id, base = `/v1/tenants/${tenant}/projects/${project}/desktop-executions`;
  await s.db.control.query("UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1", [tenant]);
  await s.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Synthetic native ownership fixture',$2)", [tenant, defaults.business]);
  const c = await native(web), fields = { device_id: randomUUID(), local_session_id: randomUUID(), workspace_hash: hash("owned directory " + randomUUID()), runtime_version: desktopRuntime.pinned_version, runtime_sha256: desktopRuntime.windows_x64_sha256 };
  const input = { ...fields, title: "Local native task", prompt: "Work on the explicitly selected local project", role_key: "fullstack", budget_micros: 1000000 };
  return { web, c, tenant, project, base, fields, input };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const taskRow = async (id: string) => (await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [id])).rows[0];
const complete = { status: "completed", output: "Client-reported local result", thread_id: "native-thread-fixture", turn_id: "native-turn-fixture" };
async function start(f: Fixture) {
  const created = await ok(f.c, "POST", f.base, f.input);
  const begun = await ok(f.c, "POST", f.base + "/" + created.task_id + "/start", f.fields);
  return { created, begun, url: f.base + "/" + created.task_id };
}
async function inference(secret: string, patch: Record<string, unknown> = {}) {
  return s.app.inject({ method: "POST", url: "/v1/desktop-inference/v1/responses", headers: { Authorization: "Bearer " + secret, "Content-Type": "application/json" }, payload: {
    model: "desktop-synthetic", reasoning: { effort: "max" }, stream: true, store: false, input: [{ role: "user", content: "Synthetic native check" }], tools: [], max_output_tokens: 32, ...patch,
  } });
}
before(async () => {
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  isolated = await isolatedTestEnvironment();
  s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "false", DEMO_MODE: "false", EXTENSION_ID: "a".repeat(32),
    AI_BASE_URL: `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "synthetic-desktop-provider", AI_MODEL: "desktop-synthetic", AI_VERIFIED: "true",
    AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000", AI_INPUT_COUNT_VERIFIED: "true", AI_INPUT_COUNT_HKD_MICROS_PER_CALL: "0", AI_SCOPE_TTL_MS: "300000",
  }), { worker: false });
});
after(async () => {
  try { await s?.app.close(); provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve())); }
  finally { await isolated?.cleanup(); }
});

test("only actual desktop native authorization can reserve local execution; no API can grant local full permission", async () => {
  const f = await fixture();
  assert.equal((await call(f.web, "POST", f.base, f.input)).status, 403);
  const extension = await native(f.web, "extension"); assert.equal((await call(extension, "POST", f.base, f.input)).status, 403);
  assert.equal((await call(f.c, "POST", f.base, { ...f.input, full_permission: true })).status, 400);
  assert.equal((await call(f.c, "POST", f.base, { ...f.input, runtime_sha256: "0".repeat(64) })).status, 400);
  assert.equal((await call(f.c, "POST", f.base, { ...f.input, role_key: "designer" })).data.error.code, "DESKTOP_ROLE_NOT_READY");
  const cloudBody = { title: "Desktop must stay local", prompt: "Do not enqueue from a desktop sign-in", role_key: "fullstack", budget_micros: 1000000 };
  const cloudPath = `/v1/tenants/${f.tenant}/projects/${f.project}/tasks`;
  assert.equal((await call(f.c, "POST", cloudPath, cloudBody)).data.error.code, "DESKTOP_LOCAL_EXECUTION_REQUIRED");
  assert.equal((await call(extension, "POST", cloudPath, cloudBody)).status, 200);
});

test("one immutable local owner and hold survive duplicate create; queue, cloud claims and recovery cannot run it", async () => {
  const f = await fixture(), k = randomUUID(), a = await ok(f.c, "POST", f.base, f.input, k), b = await ok(f.c, "POST", f.base, f.input, k);
  assert.equal(a.task_id, b.task_id);
  const t = await taskRow(a.task_id); assert.equal(t.execution_location, "desktop"); assert.equal(t.private_owner, f.c.id);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM reservations WHERE task_id=$1", [t.id])).rows[0].n, 1);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM outbox WHERE payload->>'task_id'=$1", [t.id])).rows[0].n, 0);
  await new Worker(s.db, s.catalog, s.storage).run(f.tenant, t.id); await recoverQueuedClaims(s.db);
  assert.equal((await taskRow(t.id)).attempt, 0);
  await assert.rejects(s.db.tx(tx => tx.query("SELECT claim_execution_capacity($1,'text',8,$2)", [t.id, randomUUID()]), f.tenant, false, f.c.id), /Cloud admission/);
  await assert.rejects(s.db.control.query("INSERT INTO outbox(tenant_id,topic,payload) VALUES($1,'task.run',$2)", [f.tenant, { task_id: t.id }]), /cannot enter the cloud/);
  await assert.rejects(s.db.control.query("UPDATE tasks SET execution_location='cloud' WHERE id=$1", [t.id]), /immutable/);
});

test("lost start acceptance replays a single encrypted credential without exposing it in public reads or replay storage", async () => {
  const f = await fixture(), created = await ok(f.c, "POST", f.base, f.input), url = f.base + "/" + created.task_id, k = randomUUID();
  const a = await ok(f.c, "POST", url + "/start", f.fields, k), b = await ok(f.c, "POST", url + "/start", f.fields, k);
  assert.equal(a.credential.token, b.credential.token); assert.equal((await taskRow(created.task_id)).attempt, 1);
  assert.equal(a.runtime.pinned_version, desktopRuntime.pinned_version); assert.ok(a.skills.length > 0);
  for (const skill of a.skills) assert.equal(hash(skill.content), skill.sha256);
  const publicRead = await ok(f.c, "GET", url); assert.equal(publicRead.credential, undefined);
  const replays = (await s.db.control.query("SELECT response FROM request_replays WHERE actor_id=$1", [f.c.id])).rows;
  assert.ok(!JSON.stringify(replays).includes(a.credential.token));
  const d = (await s.db.control.query("SELECT * FROM desktop_executions WHERE task_id=$1", [created.task_id])).rows[0];
  assert.notEqual(d.credential_cipher, a.credential.token); assert.equal(d.credential_hash, hash(a.credential.token));
  assert.equal((await call(f.c, "POST", url + "/start", f.fields)).status, 409);
});

test("company gateway meters actual native Responses and settles once from server facts, excluding client usage", async () => {
  const f = await fixture(), r = await start(f), before = providerCalls;
  const response = await inference(r.begun.credential.token); assert.equal(response.statusCode, 200, response.body); assert.ok(response.body.includes("response.completed"));
  assert.equal(providerCalls, before + 1); assert.ok(countCalls > 0);
  assert.equal((await call(f.c, "POST", r.url + "/finish", { ...complete, input_tokens: 0, cost_micros: 0 })).status, 400);
  const a = await ok(f.c, "POST", r.url + "/finish", complete), b = await ok(f.c, "POST", r.url + "/finish", complete);
  assert.equal(a.status, "succeeded"); assert.equal(b.charged_micros, "30"); assert.equal(a.result_origin, "desktop_client_report");
  const entries = (await s.db.control.query("SELECT * FROM ledger WHERE task_id=$1 AND kind='charge'", [a.task_id])).rows;
  assert.equal(entries.length, 1); assert.equal(entries[0].amount_micros, "-30");
  assert.equal((await inference(r.begun.credential.token)).statusCode, 409);
  assert.equal((await call(f.c, "POST", r.url + "/finish", { ...complete, output: "Different response" })).status, 409);
});

test("native tool declarations are explicit; hosted tools, model changes and arbitrary namespaces never dispatch", async () => {
  const f = await fixture(), r = await start(f), before = providerCalls;
  for (const patch of [{ model: "other-model" }, { tools: [{ type: "web_search" }] }, { tools: [{ type: "namespace", name: "external", tools: [{ type: "function", name: "exec_command", parameters: {} }] }] }, { tools: [{ type: "function", name: "arbitrary_mcp", parameters: {} }] }]) {
    const response = await inference(r.begun.credential.token, patch); assert.equal(response.statusCode, 400, response.body);
  }
  assert.equal(providerCalls, before);
  const allowed = await inference(r.begun.credential.token, { tools: [{ type: "namespace", name: "functions", tools: [{ type: "function", name: "exec_command", parameters: { type: "object" } }, { type: "custom", name: "apply_patch", format: { type: "grammar", syntax: "lark", definition: "start: /[\\s\\S]+/" } }] }] });
  assert.equal(allowed.statusCode, 200, allowed.body);
  await ok(f.c, "POST", r.url + "/finish", complete);
});

test("unknown company response cannot be replaced by a client zero report or release its reservation", async () => {
  const f = await fixture(), r = await start(f); mode = "unknown";
  await inference(r.begun.credential.token);
  const finished = await ok(f.c, "POST", r.url + "/finish", { ...complete, status: "failed", output: "Provider termination unknown" });
  assert.equal(finished.status, "reconciling");
  assert.equal((await s.db.control.query("SELECT status FROM reservations WHERE task_id=$1", [finished.task_id])).rows[0].status, "reconciling");
  assert.equal((await call(f.c, "POST", f.base, f.input)).status, 409);
});

test("unstarted cancellation releases only its original hold and a fresh task can continue the same local session", async () => {
  const f = await fixture(), a = await ok(f.c, "POST", f.base, f.input);
  const cancelled = await ok(f.c, "POST", f.base + "/" + a.task_id + "/cancel", {});
  assert.equal(cancelled.status, "cancelled"); assert.equal(cancelled.state, "finished");
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'", [a.task_id])).rows[0].n, 0);
  const next = await ok(f.c, "POST", f.base, { ...f.input, prompt: "A corrected local instruction" }); assert.notEqual(next.task_id, a.task_id);
});

test("an expired owner lease cannot revive through heartbeat or cloud recovery; its hold requires reconciliation", async () => {
  const f = await fixture(), r = await start(f);
  await s.db.control.query("UPDATE tasks SET lease_until=now()-interval '1 second' WHERE id=$1", [r.created.task_id]);
  assert.equal((await call(f.c, "POST", r.url + "/heartbeat", {})).status, 409);
  assert.equal((await inference(r.begun.credential.token)).statusCode, 409);
  await s.desktopExecutions.recover(); await recoverQueuedClaims(s.db);
  assert.equal((await taskRow(r.created.task_id)).status, "reconciling");
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM outbox WHERE payload->>'task_id'=$1", [r.created.task_id])).rows[0].n, 0);
});

test("revoking the desktop sign-in family fences already-issued model credentials", async () => {
  const f = await fixture(), r = await start(f), before = providerCalls;
  await s.db.control.query("UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND client_id='desktop'", [f.c.id]);
  assert.equal((await inference(r.begun.credential.token)).statusCode, 409); assert.equal(providerCalls, before);
});

test("a lost local outcome or expired lease cannot be reported as zero-cost successful completion", async () => {
  for (const condition of ["native_unknown", "expired_lease"]) {
    const f = await fixture(), r = await start(f);
    if (condition === "expired_lease") await s.db.control.query("UPDATE tasks SET lease_until=now()-interval '1 second' WHERE id=$1", [r.created.task_id]);
    const report = { ...complete, status: condition === "native_unknown" ? "unknown" : "completed" };
    const result = await ok(f.c, "POST", r.url + "/finish", report);
    assert.equal(result.status, "reconciling");
    assert.equal((await s.db.control.query("SELECT status FROM reservations WHERE task_id=$1", [result.task_id])).rows[0].status, "reconciling");
    assert.equal((await ok(f.c, "POST", r.url + "/finish", report)).status, "reconciling");
  }
});
