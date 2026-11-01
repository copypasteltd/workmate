import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import * as OTPAuth from "otpauth";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { loadConfig } from "../src/config.js";
import { buildApp } from "../src/server.js";
import { canonical, hash, seal } from "../src/lib.js";
import { capabilityBody } from "../src/capability-verification.js";
import { internalAIRequest } from "../src/internal-ai-gateway.js";
import { normalizedModelURL } from "../src/model-connections.js";
import { modelAddressAllowed } from "../src/model-connection-http.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>;
type Client = { cookie: string; csrf: string; id: string };
let admin: Client, reader: Client;
const root = "/v1/admin/capability-releases", alias = "gpt-6-luna";
const keyA = "fixture-a-" + randomUUID(), keyB = "fixture-b-" + randomUUID();
const requests: { vendor: string; path: string; key: string }[] = [];
const servers: ReturnType<typeof createServer>[] = [];
let baseA: string, baseB: string, a: any, b: any;
async function vendor(name: string, key: string) {
  const server = createServer(async (req, res) => {
    requests.push({ vendor: name, path: req.url!, key: String(req.headers.authorization) });
    if (req.headers.authorization !== "Bearer " + key) { res.writeHead(401).end(JSON.stringify({ secret: req.headers.authorization })); return; }
    for await (const _ of req) { /* consume the complete request */ }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(req.method === "GET" ? { data: [{ id: alias }] } : { vendor: name, model: alias }));
  });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as any).port}/v1`;
}
async function call(client: Client | undefined, method: string, url: string, body?: any, idem?: string) {
  const raw = await s.app.inject({ method: method as any, url, headers: {
    origin: s.db.config.ADMIN_ORIGIN, ...(client ? { cookie: client.cookie, "x-csrf-token": client.csrf } : {}),
    ...(body ? { "content-type": "application/json" } : {}), ...(idem ? { "idempotency-key": idem } : {}),
  }, ...(body ? { payload: JSON.stringify(body) } : {}) });
  return { status: raw.statusCode, data: raw.json(), raw };
}
async function operator(permissions?: string[]): Promise<Client> {
  const secret = new OTPAuth.Secret({ size: 20 }), email = randomUUID() + "@example.invalid";
  const principal = (await s.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Model operator',$2) RETURNING id",
    [email, seal(s.db.config.MASTER_KEY!, secret.base32)])).rows[0];
  const role = permissions ? "model-" + randomUUID() : "super_admin";
  if (permissions) await s.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)", [role, JSON.stringify(permissions)]);
  await s.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,$2,'global')", [principal.id, role]);
  const challenge = await call(undefined, "POST", "/v1/admin/auth/challenge", { email });
  assert.equal(challenge.status, 200);
  const mail = JSON.parse(await readFile(`${s.db.config.DATA_DIR}/mailbox/${challenge.data.challenge_id}.json`, "utf8"));
  const login = await call(undefined, "POST", "/v1/admin/auth/verify", { challenge_id: challenge.data.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0], totp: new OTPAuth.TOTP({ secret, digits: 6, period: 30, algorithm: "SHA1" }).generate() });
  assert.equal(login.status, 200);
  const cookie = login.raw.cookies.find(c => c.name === "cp_admin_session")!;
  return { id: principal.id, cookie: `${cookie.name}=${cookie.value}`, csrf: login.data.csrf_token };
}
function draftBody(base: string, key: string) { return {
  document: { profile_key: "internal-text-v1", kernel: "codex", gateway_policy: "company_internal_only", model_alias: alias,
    reasoning_effort: "low", rates: [1000000, 2000000] },
  connection: { base_url: base, api_key: key, allow_private_network: false }, reason: "Configure independently bound model upstream",
}; }
async function draft(base: string, key: string) {
  const response = await call(admin, "POST", root + "/drafts", draftBody(base, key), randomUUID());
  assert.equal(response.status, 202, JSON.stringify(response.data));
  const detail = await call(admin, "GET", root + "/" + response.data.result_ids[0]);
  assert.equal(detail.status, 200); return detail.data;
}
async function probe(release: any, client = admin) {
  return call(client, "POST", `${root}/${release.id}/connection-test`, { expected_version: release.version, reason: "Read upstream model list" });
}
async function version(release: any) {
  const body = capabilityBody(s.db.config, release.document);
  return (await s.db.control.query("INSERT INTO internal_capability_versions(fingerprint,profile_key,data_mode,body,ready) VALUES($1,$2,$3,$4,true) RETURNING id",
    [hash(canonical(body)), body.profile_key, body.data_mode, body])).rows[0].id;
}

before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", DEV_MAILBOX: "true", WORKER_ENABLED: "false" }), { worker: false });
  admin = await operator(); reader = await operator(["admin.catalog.read"]);
  baseA = await vendor("a", keyA); baseB = await vendor("b", keyB);
});
after(async () => {
  for (const server of servers) await new Promise<void>(resolve => server.close(() => resolve()));
  if (s) await s.app.close(); if (isolated) await isolated.cleanup();
});

test("each model stores its own upstream with an encrypted, non-returned API key", async () => {
  a = await draft(baseA, keyA); b = await draft(baseB, keyB);
  assert.equal(a.document.upstream.base_url, baseA); assert.equal(b.document.upstream.base_url, baseB);
  for (const r of [a, b]) { assert.equal(r.document.upstream.id, r.id); assert.equal(r.document.upstream.key_configured, true); }
  const rows = (await s.db.control.query("SELECT * FROM capability_model_connections")).rows;
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.encrypted_api_key !== keyA && r.encrypted_api_key !== keyB));
  const operations = await s.db.control.query("SELECT payload,result FROM admin_operations");
  const audits = await s.db.control.query("SELECT detail FROM audit_log");
  for (const value of [a,b,operations.rows,audits.rows]) { assert.ok(!JSON.stringify(value).includes(keyA)); assert.ok(!JSON.stringify(value).includes(keyB)); }
});
test("customer and queue database identities cannot read stored API keys", async () => {
  await assert.rejects(s.db.app.query("SELECT * FROM capability_model_connections"), (e: any) => e.code === "42501");
  await assert.rejects(s.db.queue.query("SELECT * FROM capability_model_connections"), (e: any) => e.code === "42501");
});
test("connection checks call two independent actual HTTP upstreams using the right key", async () => {
  const one = await probe(a), two = await probe(b);
  assert.equal(one.status, 200); assert.equal(two.status, 200);
  assert.equal(one.data.reachable, true); assert.equal(two.data.model_available, true);
  assert.ok(requests.some(r => r.vendor === "a" && r.key === "Bearer " + keyA));
  assert.ok(requests.some(r => r.vendor === "b" && r.key === "Bearer " + keyB));
});
test("wrong-key errors cannot return upstream response bodies or credentials", async () => {
  const secret = "fixture-invalid-" + randomUUID(), wrong = await draft(baseA, secret), result = await probe(wrong);
  assert.equal(result.data.error_code, "MODEL_AUTHENTICATION_FAILED"); assert.equal(result.data.reachable, false);
  assert.ok(!result.raw.body.includes(secret)); assert.equal((await probe(a)).data.reachable, true);
});
test("read-only administrators cannot save or test credentials", async () => {
  assert.equal((await call(reader, "POST", root + "/drafts", draftBody(baseA, keyA), randomUUID())).status, 403);
  assert.equal((await probe(a, reader)).status, 403);
  assert.equal((await call(undefined, "POST", root + "/drafts", draftBody(baseA, keyA), randomUUID())).status, 401);
});
test("lost-response retries recover the same configuration without duplicating credentials", async () => {
  const body = draftBody(baseB, keyB), key = randomUUID();
  const one = await call(admin, "POST", root + "/drafts", body, key), two = await call(admin, "POST", root + "/drafts", body, key);
  assert.equal(one.status, 202); assert.deepEqual(one.data.result_ids, two.data.result_ids);
  const records = (await s.db.control.query("SELECT input_hash,response FROM request_replays")).rows;
  assert.ok(records.length > 0);
  assert.ok(!JSON.stringify(records).includes(keyB));
});
test("a copied model can explicitly retain its original key while creating a separate binding", async () => {
  const body: any = draftBody(baseA, keyA); body.connection = { base_url: baseA, reuse_from_release_id: a.id };
  const made = await call(admin, "POST", root + "/drafts", body, randomUUID()); assert.equal(made.status, 202);
  const copy = await call(admin, "GET", root + "/" + made.data.result_ids[0]);
  assert.notEqual(copy.data.document.upstream.id, a.id); assert.equal((await probe(copy.data)).data.reachable, true);
  body.connection.base_url = baseB;
  assert.equal((await call(admin, "POST", root + "/drafts", body, randomUUID())).status, 422);
});
test("published capability bindings route inference independently and preserve old upstreams", async () => {
  const first = await version(a), second = await version(b);
  const execute = async (id: string) => internalAIRequest(s.db.config, { operation: "responses", model: alias,
    reasoningEffort: "low", tools: [], body: { model: alias, stream: true, input: [{ role: "user", content: "Use this model connection" }], tools: [], reasoning: { effort: "low" } },
    signal: AbortSignal.timeout(5000), authority: { taskId: randomUUID(), capabilityVersionId: id, authorize: async () => {} } });
  assert.equal((await (await execute(first)).json()).vendor, "a");
  assert.equal((await (await execute(second)).json()).vendor, "b");
  assert.equal((await (await execute(first)).json()).vendor, "a");
  await assert.rejects(internalAIRequest(s.db.config, { operation: "responses", model: "another-model", body: { input: "denied" },
    signal: AbortSignal.timeout(5000), authority: { taskId: randomUUID(), capabilityVersionId: first, authorize: async () => {} } }));
});
test("URL and network guards reject self-routing, credentials, metadata and unapproved private addresses", () => {
  for (const url of [s.db.config.API_ORIGIN + "/v1", "https://user:password@example.com/v1", "https://example.com/v1/responses", "https://example.com/v1?key=secret"])
    assert.throws(() => normalizedModelURL(s.db.config, url, false));
  assert.equal(modelAddressAllowed("169.254.169.254", true, false), false);
  assert.equal(modelAddressAllowed("127.0.0.1", true, false), false);
  assert.equal(modelAddressAllowed("10.2.3.4", false, false), false);
  assert.equal(modelAddressAllowed("10.2.3.4", true, false), true);
  assert.equal(modelAddressAllowed("::ffff:169.254.169.254", true, false), false);
});


test("published per-model capabilities remain available without environment URL or key", () => {
  const config = { ...s.db.config, AI_BASE_URL: undefined, AI_API_KEY: undefined, AI_VERIFIED: false };
  const body = capabilityBody(config, a.document);
  const map = new Map([["internal-text-v1", { id: randomUUID(), body, ready: true, revoked: false, publication_id: randomUUID() }]]);
  assert.equal(s.catalog.available(config, s.catalog.defaultAssistant, "execute", map).available, true);
});
test("a missing explicitly bound connection cannot fall back to the demo or another model", async () => {
  const body = { ...capabilityBody(s.db.config, a.document), model_connection_id: randomUUID() };
  const row = (await s.db.control.query("INSERT INTO internal_capability_versions(fingerprint,profile_key,data_mode,body,ready) VALUES($1,$2,$3,$4,true) RETURNING id",
    [hash(canonical(body)), body.profile_key, body.data_mode, body])).rows[0];
  const before = requests.length;
  await assert.rejects(s.db.config.MODEL_CONNECTION_RESOLVER!({ taskId: randomUUID(), capabilityVersionId: row.id, model: alias, operation: "responses" }),
    (error: any) => error.code === "MODEL_CONNECTION_UNAVAILABLE");
  assert.equal(requests.length, before);
});
