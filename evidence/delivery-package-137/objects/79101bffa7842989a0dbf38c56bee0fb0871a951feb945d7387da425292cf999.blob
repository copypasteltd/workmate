import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { saveAsset } from "../src/storage.js";
import { advancePublications } from "../src/publication-worker.js";
import { Worker } from "../src/worker.js";
import { CodexRuntimeAdapter, type RuntimeContext } from "../src/runtime.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>;
let s: Awaited<ReturnType<typeof buildApp>>;
let serial = 0;
type Client = { id: string; cookie: string; csrf: string; ip: string };
before(async () => {
  isolated = await isolatedTestEnvironment();
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const address = server.address() as any; server.close(error => error ? reject(error) : resolve(address.port)); });
  });
  s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", WORKER_ENABLED: "false",
    DEV_MAILBOX: "true", PORT: String(port), API_ORIGIN: `http://127.0.0.1:${port}` }), { worker: false });
  await s.app.listen({ host: "127.0.0.1", port });
});
after(async () => { try { await s?.app.close(); } finally { await isolated?.cleanup(); } });

async function call(c: Client | undefined, method: string, url: string, body?: unknown, key = randomUUID(), extraHeaders: Record<string, string> = {}) {
  const raw = await s.app.inject({ method: method as any, url, remoteAddress: c?.ip ?? "127.0.0.1", headers: {
    origin: url.startsWith("/v1/admin/") ? s.db.config.ADMIN_ORIGIN : s.db.config.WEB_ORIGIN, "idempotency-key": key,
    ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
    ...(body === undefined ? {} : { "content-type": "application/json" }),
    ...extraHeaders,
  }, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
  let data: any; try { data = raw.json(); } catch { data = null; }
  return { raw, status: raw.statusCode, data };
}
const ok = (response: Awaited<ReturnType<typeof call>>, status?: number) => {
  if (status !== undefined) assert.equal(response.status, status, JSON.stringify(response.data));
  else assert.ok(response.status >= 200 && response.status < 300, `${response.status} ${JSON.stringify(response.data)}`);
  return response.data;
};
async function user(): Promise<Client> {
  const challenge = ok(await call(undefined, "POST", "/v1/auth/challenge", { email: `publication-${randomUUID()}@example.invalid` }));
  const mail = JSON.parse(await readFile(path.join(s.db.config.DATA_DIR, "mailbox", challenge.challenge_id + ".json"), "utf8"));
  const result = await call(undefined, "POST", "/v1/auth/verify", { challenge_id: challenge.challenge_id, code: mail.text.match(/\b\d{6}\b/)[0] });
  const value = ok(result);
  return { id: value.user.id, csrf: value.csrf_token, cookie: result.raw.cookies[0].name + "=" + result.raw.cookies[0].value,
    ip: `127.0.2.${++serial}` };
}
async function fixture() {
  const owner = await user(), workspace = ok(await call(owner, "POST", "/v1/tenants", { name: "Publishing QA", project_name: "HK brand" }));
  const tenant = workspace.tenant.id as string, project = workspace.project.id as string;
  const base = `/v1/tenants/${tenant}/projects/${project}/publications`;
  const pending = await call(owner, "POST", base + "/connections/authorize", { project_id: project });
  const authorization = ok(pending), consent = await fetch(authorization.authorization_url, { redirect: "manual" });
  assert.equal(consent.status, 200);
  const html = await consent.text(), nonce = html.match(/name="consent" value="([\w-]+)"/)?.[1]; assert.ok(nonce);
  const approved = await fetch(s.publicationFixture!.origin + "/approve", { method: "POST", redirect: "manual",
    body: new URLSearchParams({ consent: nonce, decision: "approve" }) });
  assert.equal(approved.status, 302); const location = new URL(approved.headers.get("location")!);
  const callbackOwner = { ...owner, cookie: owner.cookie + "; " + pending.raw.cookies.map(c => c.name + "=" + c.value).join("; ") };
  const callback = await call(callbackOwner, "GET", location.pathname + location.search); assert.equal(callback.status, 302, JSON.stringify(callback.data));
  const landing = new URL(String(callback.raw.headers.location));
  assert.equal(landing.pathname, "/app/publications"); assert.equal(landing.searchParams.get("tenant"), tenant);
  assert.equal(landing.searchParams.get("project"), project); assert.equal(landing.searchParams.get("publication"), "connected");
  const list = ok(await call(owner, "GET", base + "/connections")), connection = list.items[0];
  assert.equal(connection.targets.length, 2); assert.ok(connection.targets.every((target: any) => !target.enabled));
  const scope = ok(await call(owner, "PUT", base + "/connections/" + connection.id + "/scope", {
    expected_version: connection.version, project_ids: [project], target_ids: connection.targets.map((target: any) => target.id),
  }));
  for (const target of connection.targets) ok(await call(owner, "PUT", base + "/policy/" + target.id, {
    expected_version: 0, policy: { enabled: true, formats: target.capabilities.formats, maximum_daily_publications: 100,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), confirmation: "each_operation" },
  }));
  return { owner, tenant, project, base, connection: { ...connection, version: scope.version }, callbackOwner,
    callbackURL: location.pathname + location.search };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function media(f: Fixture, width = 640, height = 640, colour = "#1f5eff", bytes?: Buffer) {
  const canvas = createCanvas(width, height), context = canvas.getContext("2d");
  context.fillStyle = colour; context.fillRect(0, 0, width, height);
  const asset = await s.db.tx(tx => saveAsset(tx, s.storage, { tenant: f.tenant, project: f.project, user: f.owner.id,
    name: "approved-brand-asset", mime: "image/png", bytes: bytes ?? canvas.toBuffer("image/png") }), f.tenant, false, f.owner.id);
  const version = (await s.db.control.query("SELECT * FROM asset_versions WHERE asset_id=$1", [asset.id])).rows[0];
  return { asset_id: asset.id, version: version.version, expected_sha256: version.sha256 };
}

async function roleFixture(format: "facebook_photo" | "instagram_photo" = "facebook_photo") {
  const f = await fixture();
  ok(await call(f.owner, "POST", `/v1/tenants/${f.tenant}/demo-credit`, {}));
  const templates = ok(await call(f.owner, "GET", "/v1/agent-templates?limit=30", undefined, undefined, { "x-tenant-id": f.tenant }));
  const template = templates.items.find((item: any) => item.role_key === "social-content");
  assert.ok(template);
  const input = { project_id: f.project, template_version: template.version };
  const agent = ok(await call(f.owner, "POST", `/v1/agent-templates/${template.id}/instances`, input, undefined, { "x-tenant-id": f.tenant }));
  const projectBase = `/v1/tenants/${f.tenant}/projects/${f.project}`;
  const conversation = ok(await call(f.owner, "POST", projectBase + "/conversations", { name: "Native Codex publication preparation", agent_id: agent.id }));
  const source = await media(f);
  const target = f.connection.targets.find((item: any) => item.kind === (format.startsWith("instagram_") ? "instagram_professional" : "facebook_page"));
  const draft = { target_id: target.id, format, caption: "Clearly simulated HK campaign; explicit human confirmation required", sources: [source] };
  return { ...f, projectBase, conversation, draft, source };
}

async function runNative(f: Awaited<ReturnType<typeof roleFixture>>, mode = "execute", extra: Record<string, unknown> = {}) {
  const conversation = ok(await call(f.owner, "GET", f.projectBase + "/conversations/" + f.conversation.id));
  const accepted = ok(await call(f.owner, "POST", f.projectBase + `/conversations/${f.conversation.id}/messages`, {
    body: "Prepare this exact simulated draft and stop for the original customer's confirmation.\nApproved simulated publication draft: " + JSON.stringify({ ...f.draft, ...extra }),
    expected_version: conversation.version, intent: "delegate", mode, budget_micros: 1000000, client_message_id: randomUUID(),
  }));
  const calls: Array<{ name: string; args: unknown; id: string }> = [];
  const outcomes: Array<{ name: string; keys?: string[]; error_code?: string }> = [];
  let loadedControlledSkill = false;
  class CapturedCodex extends CodexRuntimeAdapter {
    override start(ctx: RuntimeContext) {
      loadedControlledSkill = ctx.skills.some(skill => skill.content.includes("First call publication_accounts."));
      return super.start({ ...ctx, tools: ctx.tools.map(tool => ({ ...tool, run: async (args, id) => {
        calls.push({ name: tool.name, args, id });
        try {
          const result = await tool.run(args, id);
          outcomes.push({ name: tool.name, keys: Object.keys(result ?? {}) });
          return result;
        } catch (error) {
          const code = (error as { code?: unknown }).code;
          outcomes.push({ name: tool.name, error_code: typeof code === "string" && /^[A-Z0-9_]{1,80}$/.test(code) ? code : "UNCLASSIFIED" });
          throw error;
        }
      } })) });
    }
  }
  await new Worker(s.db, s.catalog, s.storage, new CapturedCodex(s.db.config)).run(f.tenant, accepted.task.id);
  const task = ok(await call(f.owner, "GET", f.projectBase + "/tasks/" + accepted.task.id));
  const diagnostics = (await s.db.control.query("SELECT kind,body FROM task_events WHERE task_id=$1 AND kind=ANY($2::text[]) ORDER BY seq",
    [accepted.task.id, ["runtime.phase", "runtime.rpc.failed", "runtime.startup.retry", "runtime.thread", "runtime.turn", "gateway.request_rejected"]])).rows;
  assert.equal(task.status, "succeeded", JSON.stringify({ task, diagnostics }));
  assert.equal(loadedControlledSkill, true);
  return { task, calls, accepted, outcomes };
}

for (const format of ["facebook_photo", "instagram_photo"] as const) test(`${format}: pinned native Codex loads the publishing Skill and calls all four tools without confirming or dispatching`, { timeout: 180000 }, async () => {
  const f = await roleFixture(format), run = await runNative(f);
  assert.deepEqual(run.calls.map(call => call.name), ["publication_accounts", "publication_preview", "publication_prepare", "publication_status"], JSON.stringify(run.outcomes));
  assert.ok(run.calls.every(call => typeof call.id === "string" && call.id.length > 0));
  const operations = (await s.db.control.query("SELECT * FROM publication_operations WHERE task_id=$1", [run.task.id])).rows;
  assert.equal(operations.length, 1);
  const operation = operations[0];
  assert.equal(operation.state, "awaiting_confirmation"); assert.equal(operation.confirmed_at, null);
  assert.equal(operation.actor_id, f.owner.id); assert.equal(operation.tenant_id, f.tenant); assert.equal(operation.project_id, f.project);
  assert.equal(operation.target_id, f.draft.target_id); assert.equal(operation.format, format);
  assert.equal(operation.specification.sources[0].source_sha256, f.source.expected_sha256);
  assert.equal(operation.specification.sources[0].mime, format === "instagram_photo" ? "image/jpeg" : "image/png");
  const preview = (await s.db.control.query("SELECT * FROM publication_previews WHERE task_id=$1", [run.task.id])).rows;
  assert.equal(preview.length, 1);
  assert.deepEqual(run.calls[2].args, { preview_id: preview[0].id, payload_sha256: preview[0].payload_sha256 });
  assert.deepEqual(run.calls[3].args, { operation_id: operation.id });
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM publication_effects WHERE operation_id=$1", [operation.id])).rows[0].n, 0);
  assert.equal(s.publicationFixture!.calls.length, 0);
  await advancePublications(s.db, s.storage, { limit: 4, pollIntervalMs: 0 });
  assert.equal((await s.db.control.query("SELECT state FROM publication_operations WHERE id=$1", [operation.id])).rows[0].state, "awaiting_confirmation");
  assert.equal(s.publicationFixture!.calls.length, 0);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM reservations WHERE task_id=$1", [run.task.id])).rows[0].n, 1);
  assert.ok(Number(run.task.charged_micros) > 0);
});

for (const mode of ["ask", "plan"]) test(`${mode}: actual native Codex may inspect current accounts but cannot allocate previews or prepare a publication`, { timeout: 180000 }, async () => {
  const f = await roleFixture(), run = await runNative(f, mode);
  assert.deepEqual(run.calls.map(call => call.name), ["publication_accounts"]);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM publication_previews WHERE task_id=$1", [run.task.id])).rows[0].n, 0);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM publication_operations WHERE task_id=$1", [run.task.id])).rows[0].n, 0);
  assert.equal(s.publicationFixture!.calls.length, 0);
});

test("an extra self-confirmation field is rejected before native tool execution and cannot create a publication", { timeout: 180000 }, async () => {
  const f = await roleFixture(), run = await runNative(f, "execute", { confirm: true });
  assert.deepEqual(run.calls, []);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM publication_previews WHERE task_id=$1", [run.task.id])).rows[0].n, 0);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM publication_operations WHERE task_id=$1", [run.task.id])).rows[0].n, 0);
  assert.equal(s.publicationFixture!.calls.length, 0);
});
