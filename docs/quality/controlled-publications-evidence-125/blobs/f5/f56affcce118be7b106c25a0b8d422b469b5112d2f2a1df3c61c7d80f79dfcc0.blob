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
import { desktopImageFixture } from "./desktop-image-fixture.js";
import { desktopLocalRoleKeys } from "../src/desktop-executions.js";
import { demoVectorInput, demoSlidesInput } from "../src/editable-design-demo.js";
import { saveAsset } from "../src/storage.js";
import { presetBrandDefinition } from "./preset-brand-fixture.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>;
let mode: "known" | "unknown" = "known", providerCalls = 0, countCalls = 0;
let imageCalls = 0, imageUnknown = false;
const imageBytes = desktopImageFixture();
const provider = createServer(async (req, res) => {
  const bytes = []; for await (const part of req) bytes.push(Buffer.from(part));
  if (req.url === "/v1/images/generations" || req.url === "/v1/images/edits") {
    assert.equal(req.headers.authorization, "Bearer synthetic-desktop-provider"); imageCalls++;
    if (req.url.endsWith("/edits")) {
      const form = await new Response(Buffer.concat(bytes), { headers: { "Content-Type": req.headers["content-type"]! } }).formData();
      assert.equal(form.get("model"), "desktop-image-synthetic");
      assert.deepEqual(Buffer.from(await (form.get("image") as Blob).arrayBuffer()), imageBytes);
    } else assert.equal(JSON.parse(Buffer.concat(bytes).toString()).model, "desktop-image-synthetic");
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(imageUnknown ? { data: [] } : { data: [{ b64_json: imageBytes.toString("base64") }] }));
    return;
  }
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
    AI_IMAGE_MODEL: "desktop-image-synthetic", AI_IMAGE_VERIFIED: "true", AI_IMAGE_HKD_MICROS_PER_IMAGE: "1000000",
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
  assert.equal((await call(f.c, "POST", f.base, { ...f.input, role_key: "unconnected-native-role" })).data.error.code, "DESKTOP_ROLE_NOT_READY");
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

test("native template instantiation loads the saved instructions and exact brand, preserves session identity and rechecks revoked content", async () => {
  const f = await fixture(), projectBase = f.base.replace(/\/desktop-executions$/, "");
  const scoped = async (client: Client, method: string, url: string, body?: any, key = randomUUID()) => {
    const response = await s.app.inject({ method: method as any, url, headers: {
      ...(client.access_token ? { Authorization: "Bearer " + client.access_token } : { cookie: client.cookie!, "x-csrf-token": client.csrf! }),
      "x-tenant-id": f.tenant, "idempotency-key": key,
    }, ...(body === undefined ? {} : { payload: body }) });
    return { status: response.statusCode, data: response.json() };
  };
  const published = await call(f.c, "POST", projectBase + "/brand/definitions", presetBrandDefinition());
  assert.equal(published.status, 201, JSON.stringify(published.data)); const brand = published.data;
  const options = await scoped(f.c, "GET", `/v1/brand-version-options?project_id=${f.project}`);
  assert.equal(options.status, 200); const revision = options.data.items.find((v: any) => v.brand_id === brand.id);
  const directory = await scoped(f.c, "GET", "/v1/agent-templates"), fullstack = directory.data.items.find((v: any) => v.role_key === "fullstack");
  assert.equal(fullstack.available, true, JSON.stringify(fullstack));
  const input = { project_id: f.project, template_version: fullstack.version, overrides: { name: "Native pinned expert", role_description: "NATIVE_PRESET_SAVED_INSTRUCTIONS", brand_version_id: revision.id } };
  const checkKey = randomUUID(), preview = await scoped(f.c, "POST", `/v1/agent-templates/${fullstack.id}/preflights`, input, checkKey);
  assert.equal(preview.data.state, "ready", JSON.stringify(preview.data));
  assert.equal((await scoped(f.web, "POST", `/v1/agent-templates/${fullstack.id}/preflights`, input, checkKey)).status, 409, "A web receipt cannot replay a native preflight");
  const expert = await scoped(f.c, "POST", `/v1/agent-templates/${fullstack.id}/instances`, input);
  assert.equal(expert.status, 201, JSON.stringify(expert.data));
  const agent = expert.data, body = { ...f.input, agent_id: agent.id, agent_version: 1 };
  const selected = await ok(f.c, "GET", f.base + `/specialists/${agent.id}?version=1`);
  assert.deepEqual(selected, { id: agent.id, version: 1, name: input.overrides.name, role_key: "fullstack" });
  assert.equal((await call(await native(f.web, "extension"), "GET", f.base + `/specialists/${agent.id}?version=1`)).status, 403);
  const k = randomUUID(), created = await ok(f.c, "POST", f.base, body, k);
  assert.equal((await ok(f.c, "POST", f.base, body, k)).task_id, created.task_id);
  const task = await taskRow(created.task_id);
  assert.equal(task.input_context.agent_id, agent.id); assert.equal(task.input_context.agent_version, 1);
  await assert.rejects(s.db.control.query("UPDATE tasks SET input_context=jsonb_set(input_context,'{agent_version}','2') WHERE id=$1", [task.id]), { code: "23514" });
  await assert.rejects(s.db.control.query("UPDATE tasks SET input_context='{}' WHERE id=$1", [task.id]), { code: "23514" });
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM reservations WHERE task_id=$1", [task.id])).rows[0].n, 1);
  await ok(f.c, "PUT", projectBase + "/brand/" + brand.id, { expected_version: 1, definition: presetBrandDefinition("PRESET_BRAND_LATER_GUIDANCE") });
  const url = f.base + "/" + task.id, begun = await ok(f.c, "POST", url + "/start", f.fields);
  assert.ok(begun.prompt.includes("NATIVE_PRESET_SAVED_INSTRUCTIONS")); assert.ok(begun.prompt.includes("PRESET_BRAND_ORIGINAL_GUIDANCE"));
  assert.ok(!begun.prompt.includes("PRESET_BRAND_LATER_GUIDANCE")); assert.ok(begun.skills.length > 0);
  assert.equal((await inference(begun.credential.token)).statusCode, 200);
  await ok(f.c, "POST", url + "/finish", complete);
  assert.equal((await call(f.c, "POST", f.base, { ...body, agent_version: 2 })).data.error.code, "DESKTOP_SESSION_BINDING_CHANGED");
  assert.equal((await call(f.c, "POST", f.base, f.input)).data.error.code, "DESKTOP_SESSION_BINDING_CHANGED");
  assert.equal((await call(f.c, "POST", f.base, { ...f.input, local_session_id: randomUUID(), agent_id: agent.id })).status, 400);
  const next = await ok(f.c, "POST", f.base, body), nextTask = await taskRow(next.task_id);
  assert.deepEqual(nextTask.input_context.memories, task.input_context.memories);
  assert.equal(nextTask.input_context.agent_version, 1);
  await s.db.control.query("UPDATE brand_profiles SET content_state='quarantined' WHERE id=$1", [brand.id]);
  const callsBefore = providerCalls;
  assert.equal((await call(f.c, "POST", f.base + "/" + next.task_id + "/start", f.fields)).status, 409);
  assert.equal(providerCalls, callsBefore);
  await ok(f.c, "POST", f.base + "/" + next.task_id + "/cancel", {});
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM outbox WHERE payload->>'task_id'=ANY($1::text[])", [[task.id, next.task_id]])).rows[0].n, 0);
});

test("saved specialist company tools retain their configured subset and inaccessible experts cannot reserve local work", async () => {
  const f = await fixture(), projectBase = f.base.replace(/\/desktop-executions$/, "");
  const agent = await ok(f.c, "POST", projectBase + "/agents", { name: "Read-only company tools", role_key: "designer", instructions: "Use the supplied company tools", tool_ids: ["asset.read"] });
  const input = { ...f.input, role_key: "designer", agent_id: agent.id, agent_version: 1 };
  const created = await ok(f.c, "POST", f.base, input), url = f.base + "/" + created.task_id, begun = await ok(f.c, "POST", url + "/start", f.fields);
  assert.ok(!begun.company_tools.some((v: any) => ["design_render", "image2_generate", "image2_edit", "deliver_text"].includes(v.name)));
  const before = providerCalls;
  assert.equal((await call(f.c, "POST", url + "/tools", { tool: "image2_generate", arguments: {}, call_id: "subset-denied", thread_id: "native", turn_id: "turn" })).status, 403);
  assert.equal(providerCalls, before); await ok(f.c, "POST", url + "/cancel", {});
  const other = await fixture();
  assert.equal((await call(other.c, "POST", other.base, { ...other.input, role_key: "designer", agent_id: agent.id, agent_version: 1 })).status, 404);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE project_id=$1", [other.project])).rows[0].n, 0);
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

test("eighteen native specialists and the default helper load exact Skills and company descriptors without cloud dispatch", async () => {
  const f = await fixture(); assert.equal(desktopLocalRoleKeys.length, 19); assert.ok(desktopLocalRoleKeys.includes("assistant"));
  assert.deepEqual((await ok(f.c, "GET", f.base + "/runtime")).role_keys, desktopLocalRoleKeys);
  for (const role of desktopLocalRoleKeys) {
    const fields = { ...f.fields, local_session_id: randomUUID() };
    const r = await start({ ...f, fields, input: { ...f.input, ...fields, role_key: role } });
    assert.ok(r.begun.skills.length > 0); r.begun.skills.forEach((skill: any) => assert.equal(hash(skill.content), skill.sha256));
    assert.ok(r.begun.company_tools.every((tool: any) => tool.inputSchema.type === "object" && !["code_write", "request_input"].includes(tool.name)
      && (role === "video-motion" || !tool.name.startsWith("video_project"))));
    if (role === "designer") assert.ok(r.begun.company_tools.some((tool: any) => tool.name === "image2_generate"));
    if (role === "marketing-analyst") assert.ok(r.begun.company_tools.some((tool: any) => tool.name === "marketing_metrics"));
    if (["marketing-analyst", "information-design", "presentation"].includes(role))
      for (const name of ["analysis_sources", "analysis_file_inspect", "sheet_calculate", "analysis_source_read", "chart_render"])
        assert.ok(r.begun.company_tools.some((tool: any) => tool.name === name), role + ": " + name);
    if (["brand-visual", "presentation"].includes(role))
      assert.ok(r.begun.company_tools.some((tool: any) => tool.name === (role === "brand-visual" ? "vector_render" : "slides_render")));
    await ok(f.c, "POST", r.url + "/finish", { ...complete, status: "failed", output: "Admission fixture only; no native business qualification claimed" });
    assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM outbox WHERE topic='task.run' AND payload->>'task_id'=$1", [r.created.task_id])).rows[0].n, 0);
  }
});

for (const role of ["brand-visual", "presentation"])
  test(`${role}: native bridge delivers editable files, scopes private sources to its actual desktop session and preserves revisions`, async () => {
    const f = await fixture();
    f.input.role_key = role;
    const first = await start(f);
    const invoke = async (r: { url: string }, name: string, args: any, callId = randomUUID()) =>
      (await ok(f.c, "POST", r.url + "/tools", { tool: name, arguments: args, call_id: callId, thread_id: "fixed-native-design-thread", turn_id: "fixed-native-design-turn" })).output;
    const input = role === "brand-visual" ? demoVectorInput() : demoSlidesInput();
    if (role === "presentation") {
      const projectBase = `/v1/tenants/${f.tenant}/projects/${f.project}`;
      const dataset = await ok(f.web, "POST", projectBase + "/analytics/import", {
        name: "Actual fixed native chart source",
        csv: "date,channel,campaign,impressions,clicks,spend,conversions,revenue,currency\n2026-10-01,Google,Launch,100,10,10,1,20,HKD\n2026-10-02,Google,Launch,1000,200,90,3,180,HKD",
        currency: "HKD", account_id: "native-account", attribution_definition: "7d click", conversion_definition: "Purchase",
      });
      const specification = { prompt: "Calculate the exact captured spend", snapshot_ids: [dataset.id], date_from: "2026-10-01", date_to: "2026-10-02", timezone: "Asia/Hong_Kong", currency_policy: "group_by_currency", metrics: ["spend"], dimensions: [] };
      const calculation = await invoke(first, "sheet_calculate", { specification });
      const analysis = await invoke(first, "chart_render", { specification, calculation_sha256: calculation.calculation_sha256, title: "Exact native evidence", locale: "en-HK", metrics: ["spend"], scope_ids: calculation.scopes.map((s: any) => s.id) });
      const source = analysis.files.find((file: any) => file.filename === "analysis.source.json");
      const read = await invoke(first, "analysis_source_read", { source_version_id: source.asset_version_id });
      assert.equal(read.calculation_sha256, calculation.calculation_sha256);
      const chart = await invoke(first, "design_chart_read", { source_version_id: source.asset_version_id });
      const evidence = chart.evidence.find((row: any) => row.metric_id === "spend");
      assert.equal(evidence.value, "100.00000000");
      if (!("slides" in input)) throw new Error("Expected presentation input");
      input.slides[0].scene.layers = [{ kind: "chart", id: "native-chart", x: 64, y: 150, w: 1000, h: 350, title: "Captured spend", color: "#1F5EFF", source_version_id: source.asset_version_id, sha256: chart.sha256, evidence_ids: [evidence.id] }];
    }
    const writerName = role === "brand-visual" ? "vector_render" : "slides_build";
    const descriptor = first.begun.company_tools.find((tool: any) => tool.name === writerName);
    assert.ok(descriptor);
    const declaration = { type: "namespace", name: "copypaste", tools: [{ type: "function", name: descriptor.name, description: descriptor.description, parameters: descriptor.inputSchema }] };
    assert.equal((await inference(first.begun.credential.token, { tools: [declaration] })).statusCode, 200);
    const save = async (r: { url: string }, args: any) => {
      const id = randomUUID();
      const prepared = await invoke(r, writerName, args, id);
      assert.deepEqual(await invoke(r, writerName, args, id), prepared);
      if (role === "brand-visual") return prepared;
      return invoke(r, "slides_render", { source_version_id: prepared.source_version_id, sha256: prepared.sha256 });
    };
    const delivered = await save(first, input);
    assert.equal(delivered.state, "delivered");
    const editableName = role === "brand-visual" ? "brand-vector.svg" : "presentation.pptx";
    const oldFile = delivered.files.find((file: any) => file.filename === editableName);
    const oldVersion = (await s.db.control.query("SELECT v.storage_key,a.private_owner FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=$1", [oldFile.asset_version_id])).rows[0];
    const oldBytes = await s.storage.get(oldVersion.storage_key);
    assert.equal(hash(oldBytes), oldFile.sha256);
    assert.equal(oldVersion.private_owner, f.c.id);
    const sourceId = delivered.editable_source.asset_version_id;
    const ownSourceFile = delivered.files.find((file: any) => file.asset_version_id === sourceId);
    const ownRead = await invoke(first, "asset_text_read", { asset_id: ownSourceFile.asset_id });
    assert.equal(JSON.parse(ownRead.text).kind, role === "brand-visual" ? "vector" : "presentation");
    assert.equal((await invoke(first, "design_source_read", { source_version_id: sourceId })).sha256, delivered.editable_source.sha256);
    await ok(f.c, "POST", first.url + "/finish", complete);
    assert.equal((await taskRow(first.created.task_id)).execution_location, "desktop");
    assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM outbox WHERE payload->>'task_id'=$1", [first.created.task_id])).rows[0].n, 0);
    for (const patch of [{ device_id: randomUUID() }, { workspace_hash: hash("different native directory") }])
      assert.equal((await call(f.c, "POST", f.base, { ...f.input, ...patch })).data.error.code, "DESKTOP_SESSION_BINDING_CHANGED");
    const otherFields = { ...f.fields, local_session_id: randomUUID() };
    const other = await start({ ...f, fields: otherFields, input: { ...f.input, ...otherFields } });
    const deniedSource = await call(f.c, "POST", other.url + "/tools", { tool: "design_source_read", arguments: { source_version_id: sourceId }, call_id: randomUUID(), thread_id: "other-native-thread", turn_id: "other-native-turn" });
    assert.equal(deniedSource.status, 404);
    assert.equal(deniedSource.data.error.code, "NOT_FOUND");
    const sourceFile = delivered.files.find((file: any) => file.asset_version_id === sourceId);
    const otherDirectory = await invoke(other, "project_assets", {});
    assert.ok(!otherDirectory.items.some((file: any) => file.id === sourceFile.asset_id));
    const genericDenied = await call(f.c, "POST", other.url + "/tools", { tool: "asset_text_read", arguments: { asset_id: sourceFile.asset_id }, call_id: randomUUID(), thread_id: "other-native-thread", turn_id: "other-native-turn" });
    assert.equal(genericDenied.status, 404);
    await ok(f.c, "POST", other.url + "/finish", { ...complete, status: "failed", output: "Source access was correctly denied" });
    const next = await start(f);
    const source = await invoke(next, "design_source_read", { source_version_id: sourceId });
    const revised = source.input;
    revised.title += " revised";
    const scene = role === "brand-visual" ? revised.scene : revised.slides[1].scene;
    const text = scene.layers.find((layer: any) => layer.kind === "text");
    text.text = "Revised native delivery";
    revised.revision_of = { source_version_id: sourceId, sha256: source.sha256 };
    const revision = await save(next, revised);
    assert.notEqual(revision.files.find((file: any) => file.filename === editableName).sha256, oldFile.sha256);
    assert.deepEqual(await s.storage.get(oldVersion.storage_key), oldBytes);
    assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM reservations WHERE task_id=ANY($1::uuid[])", [[first.created.task_id, next.created.task_id]])).rows[0].n, 2);
    await ok(f.c, "POST", next.url + "/finish", complete);
  });

test("native company tools recheck owner, native family, role and the complete call binding before any effect", async () => {
  const f = await fixture(), r = await start(f), body = { tool: "deliver_text", arguments: { filename: "native-note.md", mime_type: "text/markdown", content: "Native company tool fixture" }, call_id: "call_company_binding", thread_id: "native-thread", turn_id: "native-turn" };
  assert.equal((await call(f.web, "POST", r.url + "/tools", body)).status, 403);
  const extension = await native(f.web, "extension"); assert.equal((await call(extension, "POST", r.url + "/tools", body)).status, 403);
  const otherFamily = await native(f.web); assert.equal((await call(otherFamily, "POST", r.url + "/tools", body)).status, 404);
  assert.equal((await call(f.c, "POST", r.url + "/tools", { ...body, tool: "code_write" })).status, 403);
  const result = await ok(f.c, "POST", r.url + "/tools", body);
  const retried = await ok(f.c, "POST", r.url + "/tools", body); assert.equal(result.output.id, retried.output.id);
  assert.equal(result.output.private_owner, f.c.id);
  for (const patch of [{ tool: "project_assets", arguments: {} }, { turn_id: "different-turn" }, { arguments: { ...body.arguments, content: "Changed" } }])
    assert.equal((await call(f.c, "POST", r.url + "/tools", { ...body, ...patch })).status, 409);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM assets WHERE id=$1", [result.output.id])).rows[0].n, 1);
  await ok(f.c, "POST", r.url + "/cancel", {});
  assert.equal((await call(f.c, "POST", r.url + "/tools", body)).status, 409);
});

test("native designer generation and editing share exact company prices and never duplicate accepted images", async () => {
  const f = await fixture(); imageUnknown = false;
  const r = await start({ ...f, input: { ...f.input, role_key: "designer", budget_micros: 5000000 } }), before = imageCalls;
  const generated = { tool: "image2_generate", arguments: { filename: "native-design.png", prompt: "A synthetic company design fixture" }, call_id: "call_designer_generate", thread_id: "native-design-thread", turn_id: "native-design-turn" };
  const first = await ok(f.c, "POST", r.url + "/tools", generated);
  assert.equal(imageCalls, before + 1);
  assert.equal((await ok(f.c, "POST", r.url + "/tools", generated)).output.id, first.output.id); assert.equal(imageCalls, before + 1);
  assert.deepEqual(await s.storage.get((await s.db.control.query("SELECT storage_key FROM asset_versions WHERE id=$1", [first.output.version.id])).rows[0].storage_key), imageBytes);
  const edit = { ...generated, tool: "image2_edit", call_id: "call_designer_edit", arguments: { ...generated.arguments, filename: "native-design-edit.png", asset_id: first.output.id } };
  const edited = await ok(f.c, "POST", r.url + "/tools", edit); assert.notEqual(edited.output.id, first.output.id);
  assert.equal(imageCalls, before + 2); assert.equal(edited.output.private_owner, f.c.id);
  const finished = await ok(f.c, "POST", r.url + "/finish", complete); assert.equal(finished.status, "succeeded"); assert.equal(finished.charged_micros, "2000000");
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM tool_operations WHERE task_id=$1 AND state='succeeded'", [r.created.task_id])).rows[0].n, 2);
  const fields = { ...f.fields, local_session_id: randomUUID() };
  const other = await start({ ...f, fields, input: { ...f.input, ...fields, role_key: "designer", budget_micros: 5000000 } });
  const denied = await call(f.c, "POST", other.url + "/tools", { ...edit, call_id: randomUUID(), arguments: { ...edit.arguments, asset_id: first.output.id } });
  assert.equal(denied.status, 404);
  assert.equal(imageCalls, before + 2, "An unauthorized private source must not reach the image provider");
  await ok(f.c, "POST", other.url + "/finish", { ...complete, status: "failed", output: "Cross-session image editing was correctly denied" });
});

test("native company namespace rejects altered schemas and unregistered names before provider dispatch", async () => {
  const f = await fixture(), r = await start({ ...f, input: { ...f.input, role_key: "designer" } }); mode = "known";
  const tool = r.begun.company_tools.find((item: any) => item.name === "design_render"); const before = providerCalls;
  const declared = { type: "namespace", name: "copypaste", tools: [{ type: "function", name: tool.name, description: tool.description, parameters: tool.inputSchema }] };
  assert.equal((await inference(r.begun.credential.token, { tools: [{ ...declared, tools: [{ ...declared.tools[0], parameters: { type: "object", properties: { override: { type: "string" } } } }] }] })).statusCode, 400);
  assert.equal((await inference(r.begun.credential.token, { tools: [{ ...declared, tools: [{ ...declared.tools[0], name: "unregistered" }] }] })).statusCode, 400);
  const altered = structuredClone(declared); altered.tools[0].parameters.properties.format.enum.push("arbitrary-executable");
  assert.equal((await inference(r.begun.credential.token, { tools: [altered] })).statusCode, 400);
  assert.equal(providerCalls, before);
  assert.equal((await inference(r.begun.credential.token, { tools: [declared] })).statusCode, 200);
  const invalid = await call(f.c, "POST", r.url + "/tools", { tool: "design_render", arguments: { filename: "invalid", format: "png", document: { width: 1, height: 1, background: "#ffffff", layers: [] } }, call_id: "native_invalid_dimensions", thread_id: "native-thread", turn_id: "native-turn" });
  assert.equal(invalid.status, 400); assert.equal(invalid.data.error.code, "VALIDATION_ERROR");
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM asset_versions WHERE metadata->>'task_id'=$1", [r.created.task_id])).rows[0].n, 0, "Original business dimensions remain enforced even though the native schema omits numeric bounds");
  await ok(f.c, "POST", r.url + "/finish", complete);
});

test("an unknown native company image result fences further calls and keeps the original reconciliation hold", async () => {
  const f = await fixture(); imageUnknown = true;
  try {
    const r = await start({ ...f, input: { ...f.input, role_key: "designer", budget_micros: 5000000 } }), before = imageCalls;
    const body = { tool: "image2_generate", arguments: { filename: "unknown-image.png", prompt: "Synthetic unknown image result" }, call_id: "call_unknown_image", thread_id: "native-thread", turn_id: "native-turn" };
    assert.equal((await call(f.c, "POST", r.url + "/tools", body)).data.error.code, "DESKTOP_COMPANY_TOOL_UNCERTAIN");
    assert.equal(imageCalls, before + 1); assert.equal((await taskRow(r.created.task_id)).cancel_requested, true);
    assert.equal((await call(f.c, "POST", r.url + "/tools", { ...body, call_id: "different_call_after_unknown" })).status, 409);
    assert.equal(imageCalls, before + 1);
    const finished = await ok(f.c, "POST", r.url + "/finish", complete); assert.equal(finished.status, "reconciling");
    assert.equal((await s.db.control.query("SELECT status FROM reservations WHERE task_id=$1", [r.created.task_id])).rows[0].status, "reconciling");
  } finally { imageUnknown = false; }
});

async function localMethod(f: Fixture, required = false) {
  const nativeCall = async (c:Client, method:string, url:string, body?:any, requestKey:string=randomUUID()) => {
    const raw = await s.app.inject({method:method as any,url,headers:{"x-tenant-id":f.tenant,"idempotency-key":requestKey,
      ...(c.access_token?{authorization:"Bearer "+c.access_token}:{cookie:c.cookie!,"x-csrf-token":c.csrf!})},...(body===undefined?{}:{payload:body})});
    return {status:raw.statusCode,data:raw.json()};
  };
  const good = async (method:string,url:string,body?:any,key?:string) => {
    const r=await nativeCall(f.c,method,url,body,key); assert.ok(r.status>=200 && r.status<300,JSON.stringify(r));return r.data;
  };
  const templates = (await good("GET", "/v1/agent-templates")).items;
  const method = await good("POST","/v1/solution-versions",{project_id:f.project,name:"Native reviewed method",
    instructions:"Read the approved fixed source and implement the requested result locally. Use exact company source readers for approved cloud inputs.",
    agent_template_ids:["fullstack","backend-api"].map(role=>templates.find((v:any)=>v.role_key===role).id),skill_version_ids:[],required_assets:required?["Source brief"]:[],required_connectors:[]});
  let bindings:any={assets:[],connectors:[]};
  if(required){
    const asset=await s.db.tx(tx=>saveAsset(tx,s.storage,{tenant:f.tenant,project:f.project,user:f.web.id,name:"brief.txt",bytes:Buffer.from("Synthetic approved local method source"),mime:"text/plain",privateOwner:f.web.id}),f.tenant,false,f.web.id);
    const version=(await s.db.control.query("SELECT id,sha256 FROM asset_versions WHERE asset_id=$1",[asset.id])).rows[0];
    bindings.assets.push({requirement:"Source brief",asset_version_id:version.id,sha256:version.sha256});
  }
  const p=await good("POST",`/v1/solution-versions/${method.id}/previews`,{project_id:f.project,bindings});
  assert.equal(p.execution_location,"desktop"); assert.equal(p.state,"ready",JSON.stringify(p.missing_requirements));
  const body={trial:{project_id:f.project,bindings,expected_preview_hash:p.preview_hash,budget_micros:1000001,brief:"Implement the exact synthetic method in the selected local folders",approval:true},
    sessions:["fullstack","backend-api"].map(role_key=>({...f.fields,local_session_id:randomUUID(),role_key}))};
  return {method,body,good,nativeCall,preview:p};
}

test("native methods reserve the complete pinned batch once, never enter the cloud queue, and require actual source reads and every local delivery before publication",async()=>{
  const f=await fixture(), m=await localMethod(f,true), endpoint=`/v1/solution-versions/${m.method.id}/desktop-trials`, requestKey=randomUUID();
  const run=await m.good("POST",endpoint,m.body,requestKey);
  assert.equal(run.execution_location,"desktop");assert.equal(run.tasks.length,2);
  assert.equal((await m.good("POST",endpoint,m.body,requestKey)).id,run.id);
  const rows=(await s.db.control.query("SELECT t.*,d.local_session_id,d.device_id,d.workspace_hash FROM tasks t JOIN desktop_executions d ON d.task_id=t.id WHERE t.id=ANY($1::uuid[]) ORDER BY t.budget_micros DESC",[run.tasks.map((v:any)=>v.task_id)])).rows;
  assert.deepEqual(rows.map(v=>Number(v.budget_micros)),[500001,500000]);assert.ok(rows.every(v=>v.execution_location==="desktop" && v.private_owner===f.c.id));
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM outbox WHERE topic='task.run' AND payload->>'task_id'=ANY($1::text[])",[run.tasks.map((v:any)=>v.task_id)])).rows[0].n,0);
  await recoverQueuedClaims(s.db);
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM tasks WHERE id=ANY($1::uuid[]) AND attempt<>0",[run.tasks.map((v:any)=>v.task_id)])).rows[0].n,0);
  for(let position=0;position<run.tasks.length;position++){
    const {role_key,...fields}=m.body.sessions[position],url=f.base+"/"+run.tasks[position].task_id;
    const begun=await ok(f.c,"POST",url+"/start",fields);
    assert.ok(begun.company_tools.some((t:any)=>t.name==="solution_source_read"),"All admitted native roles receive the exact required-source reader");
    assert.equal((await inference(begun.credential.token)).statusCode,200);
    if(position===0){
      const read=await ok(f.c,"POST",url+"/tools",{tool:"solution_source_read",arguments:{asset_version_id:m.body.trial.bindings.assets[0].asset_version_id},call_id:"native_solution_source",thread_id:"native_method_thread",turn_id:"native_method_turn"});
      assert.ok(JSON.stringify(read).includes("Synthetic approved local method source"));
    }
    await ok(f.c,"POST",url+"/finish",{...complete,output:"Synthetic local delivery for "+role_key});
  }
  const detail=await m.good("GET","/v1/solution-trials/"+run.id);
  assert.equal(detail.execution_location,"desktop");assert.deepEqual(detail.unread_required_sources,[]);
  assert.ok(detail.tasks.every((t:any)=>t.status==="succeeded" && t.charged_micros>0));
  const review={approval:true,tasks:detail.tasks.map((t:any)=>({task_id:t.task_id,expected_version:t.task_version,expected_delivery_hash:t.delivery_hash})),comment:"Reviewed both exact local deliveries"};
  const incomplete=await m.nativeCall(f.c,"POST",`/v1/solution-trials/${run.id}/reviews`,{...review,tasks:review.tasks.slice(0,1)});assert.equal(incomplete.status,409);
  await m.good("POST",`/v1/solution-trials/${run.id}/reviews`,review);
  const published=await m.good("POST",`/v1/solution-versions/${m.method.id}/publications`,{expected_version:1,validation_task_id:detail.validation_task_id});
  assert.equal(published.state,"published");
  assert.equal((await m.nativeCall(f.c,"POST",endpoint,m.body,randomUUID())).data.error.code,"SOLUTION_LOCAL_SESSION_USED");
  await assert.rejects(s.db.control.query("UPDATE solution_trials SET execution_location='cloud',native_bindings=NULL WHERE id=$1",[run.id]),/immutable|binding/i);
});

test("native method admission rejects browser/extension/cloud fallbacks, stale previews, duplicate or altered sessions and insufficient total budgets without paid tasks",async()=>{
  const f=await fixture(),m=await localMethod(f),endpoint=`/v1/solution-versions/${m.method.id}/desktop-trials`;
  assert.equal((await m.nativeCall(f.web,"POST",endpoint,m.body)).status,403);
  assert.equal((await m.nativeCall(await native(f.web,"extension"),"POST",endpoint,m.body)).status,403);
  assert.equal((await m.nativeCall(f.c,"POST",`/v1/solution-versions/${m.method.id}/trials`,m.body.trial)).data.error.code,"SOLUTION_LOCAL_EXECUTION_REQUIRED");
  const browserPreview=await m.nativeCall(f.web,"POST",`/v1/solution-versions/${m.method.id}/previews`,{project_id:f.project,bindings:m.body.trial.bindings});
  assert.notEqual(browserPreview.data.preview_hash,m.preview.preview_hash);
  const cases=[
    {...m.body,trial:{...m.body.trial,expected_preview_hash:browserPreview.data.preview_hash}},
    {...m.body,sessions:m.body.sessions.map((v,i)=>i===1?{...v,device_id:randomUUID()}:v)},
    {...m.body,sessions:m.body.sessions.map((v,i)=>i===1?{...v,role_key:"designer"}:v)},
    {...m.body,sessions:[m.body.sessions[0],m.body.sessions[0]]},
    {...m.body,trial:{...m.body.trial,budget_micros:19999}},
    {...m.body,trial:{...m.body.trial,approval:false}},
  ];
  for(const body of cases){const rejected=await m.nativeCall(f.c,"POST",endpoint,body);assert.ok([400,403,409,422].includes(rejected.status),JSON.stringify(rejected));}
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM tasks WHERE tenant_id=$1",[f.tenant])).rows[0].n,0);
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM solution_trials WHERE tenant_id=$1",[f.tenant])).rows[0].n,0);
});
