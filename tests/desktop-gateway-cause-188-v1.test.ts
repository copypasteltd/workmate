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
  // This isolated suite intentionally retains multiple unknown paid outcomes.
  // Provision enough platform slots for its accumulated fixtures; per-user and
  // per-tenant limits, real admission guards and unknown holds stay unchanged.
  await s.db.control.query("UPDATE execution_capacity_policy SET agent_slots=100 WHERE data_mode='live'");
});
after(async () => {
  try { await s?.app.close(); provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve())); }
  finally { await isolated?.cleanup(); }
});

test("native gateway rejection retains a bounded original cause without dispatching or exposing credentials", async()=>{
 const f=await fixture(),r=await start(f),before=providerCalls;
 const response=await inference(r.begun.credential.token,{tools:[{type:"function",name:"unregistered_owned_test",parameters:{type:"object"}}]});
 assert.equal(response.statusCode,400,response.body);assert.equal(providerCalls,before);
 const rows=await s.db.tx(async tx=>(await tx.query("SELECT body FROM task_events WHERE task_id=$1 AND kind=$2",[r.created.task_id,"gateway.request_rejected"])).rows,f.tenant,false,f.web.id);
 assert.equal(rows.length,1);assert.deepEqual(rows[0].body,{code:"AI_DESKTOP_TOOL_NOT_ALLOWED",dispatched:false});
 assert.ok(!JSON.stringify(rows).includes(r.begun.credential.token));assert.ok(!JSON.stringify(rows).includes("synthetic-desktop-provider"));
 await ok(f.c,"POST",r.url+"/finish",{...complete,status:"failed",output:"Protocol rejection recorded, no model call made."});
 const row=await taskRow(r.created.task_id);assert.equal(row.status,"failed");assert.equal(row.charged_micros,"0");
});
