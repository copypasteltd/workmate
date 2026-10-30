import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { historyLogin, historyOk, type HistoryClient } from "./admin-history-fixture.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { defaults } from "../src/plans.js";
import { Worker } from "../src/worker.js";
import { CodexRuntimeAdapter, type RuntimeContext, type RuntimeResult } from "../src/runtime.js";
import { saveAsset } from "../src/storage.js";
import { hash } from "../src/lib.js";
import { desktopRuntime } from "../src/desktop-runtime.js";
import { desktopImageFixture } from "./desktop-image-fixture.js";
import { assertTaskContentSources } from "../src/task-content-sources.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>;
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", WORKER_ENABLED: "false", DEMO_MODE: "false", DEV_MAILBOX: "true",
    AI_BASE_URL: "http://127.0.0.1:9/v1", AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "controlled-fixture", AI_MODEL: "controlled-fixture", AI_VERIFIED: "true",
    AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000" }), { worker: false });
});
after(async () => { try { await s?.app.close(); } finally { await isolated?.cleanup(); } });
async function fixture() {
  const owner = await historyLogin(s), w = await historyOk(s, owner, "POST", "/v1/tenants", { name: "Revision fixture (synthetic)", project_name: "Fixed source revisions" });
  const tenant = w.tenant.id, project = w.project.id, base = `/v1/tenants/${tenant}/projects/${project}`; owner.tenant = tenant;
  await s.db.control.query("UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1", [tenant]);
  await s.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Synthetic revision fixture only',$2)", [tenant, defaults.business]);
  const agent = await historyOk(s, owner, "POST", base + "/agents", { name: "Revision assistant", role_key: "assistant", instructions: "Keep the approved original role" });
  return { owner, tenant, project, base, agent };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Client = HistoryClient | { access_token: string } | null;
async function call(f: Fixture, client: Client, method: string, url: string, body?: any, key: string = randomUUID()) {
  const headers: Record<string, string> = { origin: s.db.config.WEB_ORIGIN, "x-tenant-id": f.tenant, "idempotency-key": key };
  if (client && "cookie" in client) { headers.cookie = client.cookie; headers["x-csrf-token"] = client.csrf; }
  if (client && "access_token" in client) headers.authorization = "Bearer " + client.access_token;
  const raw = await s.app.inject({ method: method as any, url, headers, ...(body === undefined ? {} : { payload: body }) });
  return { status: raw.statusCode, data: raw.json(), raw };
}
async function ok(f: Fixture, method: string, url: string, body?: any, client: Client = f.owner, key?: string) {
  const r = await call(f, client, method, url, body, key); assert.ok(r.status >= 200 && r.status < 300, `${r.status}: ${JSON.stringify(r.data)}`); return r.data;
}
const sourceText = "Original 😀 香港 campaign. Keep the source unchanged.";
class OriginalRuntime extends CodexRuntimeAdapter {
  constructor(private f: Fixture) { super(s.db.config); }
  override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
    await ctx.tools.find(t => t.name === "deliver_text")!.run({ filename: "original.md", content: sourceText, mime_type: "text/markdown" }, "original-file");
    for (const [name, mime, bytes, metadata] of [
      ["original.png", "image/png", desktopImageFixture(), {}],
      ["metadata-only-video.mp4", "video/mp4", Buffer.from("Explicit synthetic video metadata fixture, not a playable video"), { probe: { duration_seconds: 3 } }],
      ["unknown-duration.mp4", "video/mp4", Buffer.from("Explicit synthetic unknown-duration fixture"), {}],
    ] as const) await s.db.tx(tx => saveAsset(tx, s.storage, { tenant: this.f.tenant, project: this.f.project, user: this.f.owner.id,
      name, mime, bytes, metadata: { ...metadata, task_id: ctx.taskId } }), this.f.tenant, false, this.f.owner.id);
    return { text: sourceText, inputTokens: 10, outputTokens: 20, accepted: true, usageKnown: true, status: "completed", thread: "synthetic-revision-original", turn: "1" };
  }
}
async function original(f: Fixture, conversation = false) {
  let task: any;
  if (conversation) {
    const c = await ok(f, "POST", f.base + "/conversations", { name: "Original revision conversation", agent_id: f.agent.id });
    const sent = await ok(f, "POST", f.base + `/conversations/${c.id}/messages`, { client_message_id: randomUUID(), expected_version: c.version,
      intent: "delegate", body: "Prepare a clearly synthetic original marketing campaign", budget_micros: 1000000 }); task = sent.task;
  } else task = await ok(f, "POST", f.base + "/tasks", { title: "Original synthetic campaign", prompt: "Prepare clearly synthetic deliverables for revision checks", role_key: "assistant", budget_micros: 1000000 });
  await new Worker(s.db, s.catalog, s.storage, new OriginalRuntime(f)).run(f.tenant, task.id);
  assert.equal((await s.db.control.query("SELECT status FROM tasks WHERE id=$1", [task.id])).rows[0].status, "succeeded");
  return ok(f, "GET", f.base + `/tasks/${task.id}/revision-context`);
}
const requestBody = (c: any, target: any = { kind: "whole" }) => ({ source_task_id: c.source_task_id, expected_version: c.expected_version,
  expected_delivery_hash: c.expected_delivery_hash, target, instructions: "Please update the headline and preserve all original files.", budget_micros: 1000000,
  ...(c.conversation_version ? { expected_conversation_version: c.conversation_version } : {}) });
const counts = async (f: Fixture) => (await s.db.control.query(`SELECT
  (SELECT count(*)::int FROM tasks WHERE tenant_id=$1) AS tasks,
  (SELECT count(*)::int FROM reservations WHERE tenant_id=$1) AS holds,
  (SELECT count(*)::int FROM ledger WHERE tenant_id=$1) AS ledger,
  (SELECT count(*)::int FROM current_ai_provider_requests WHERE tenant_id=$1) AS requests`, [f.tenant])).rows[0];
const row = async (id: string) => (await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [id])).rows[0];
async function revise(f: Fixture, c: any, target?: any, key?: string) { return ok(f, "POST", f.base + `/tasks/${c.source_task_id}/revisions`, requestBody(c, target), f.owner, key); }

test("free context and exact PNG/text previews disclose no storage keys and create no tasks, holds or model usage", async () => {
  const f = await fixture(), c = await original(f), before = await counts(f);
  assert.equal(c.can_start, true); assert.equal(c.artifacts.length, 4); assert.equal(c.output, sourceText);
  assert.ok(!JSON.stringify(c).includes("storage_key"));
  for (const mime of ["image/png", "text/markdown"]) {
    const file = c.artifacts.find((a: any) => a.mime_type === mime), q = new URLSearchParams({ expected_version: String(c.expected_version), expected_delivery_hash: c.expected_delivery_hash });
    const raw = await call(f, f.owner, "GET", f.base + `/tasks/${c.source_task_id}/revision-preview/${file.asset_version_id}?${q}`);
    assert.equal(raw.status, 200, JSON.stringify(raw.data)); assert.equal(raw.raw.headers["cache-control"], "no-store");
    assert.equal(hash(Buffer.from(raw.data.base64, "base64")), file.sha256); assert.equal(raw.data.sha256, file.sha256);
  }
  assert.deepEqual(await counts(f), before);
});

test("one revision executes a bound source reader and produces a separate deliverable in the original conversation and fixed role", async () => {
  const f = await fixture(), c = await original(f, true), initial = await row(c.source_task_id), created = await revise(f, c);
  const task = await row(created.task_id); assert.equal(task.parent_id, initial.id); assert.equal(task.conversation_id, initial.conversation_id);
  assert.equal(task.private_owner, initial.private_owner); assert.equal(task.role_hash, initial.role_hash);
  assert.equal(task.input_context.agent_version, initial.input_context.agent_version); assert.equal(task.input_context.plan_source_task_id, initial.id);
  assert.equal(task.input_context.delivery_revision.expected_delivery_hash, c.expected_delivery_hash);
  let read = false;
  class RevisionRuntime extends CodexRuntimeAdapter {
    constructor() { super(s.db.config); }
    override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
      const tool = ctx.tools.find(t => t.name === "delivery_revision_read"); assert.ok(tool);
      const source: any = await tool.run({ offset: 0, limit: 16000 }, "bound-original-read"); read = true;
      assert.equal(source.source_task_id, initial.id); assert.equal(source.output, sourceText); assert.equal(source.artifacts.length, 4);
      await assert.rejects(tool.run({ source_task_id: randomUUID() }, "cannot-read-other-task"));
      await ctx.tools.find(t => t.name === "deliver_text")!.run({ filename: "revised.md", content: "Revised synthetic headline", mime_type: "text/markdown" }, "new-file");
      return { text: "Synthetic revised delivery", inputTokens: 10, outputTokens: 20, usageKnown: true, accepted: true, status: "completed", thread: "synthetic-revision", turn: "2" };
    }
  }
  await new Worker(s.db, s.catalog, s.storage, new RevisionRuntime()).run(f.tenant, task.id);
  assert.equal(read, true); assert.equal((await row(task.id)).status, "succeeded");
  const after = await row(initial.id); assert.equal(after.output, initial.output); assert.equal(after.charged_micros, initial.charged_micros); assert.equal(after.version, initial.version);
  const fresh = await ok(f, "GET", f.base + `/tasks/${initial.id}/revision-context`); assert.equal(fresh.expected_delivery_hash, c.expected_delivery_hash);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM reservations WHERE task_id=$1", [task.id])).rows[0].n, 1);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM task_events WHERE task_id=$1 AND kind='delivery.revision.read'", [task.id])).rows[0].n, 1);
});

test("parallel replay preserves one task, hold and outbox event; a changed request under the same key conflicts", async () => {
  const f = await fixture(), c = await original(f), before = await counts(f), key = randomUUID(), body = requestBody(c), url = f.base + `/tasks/${c.source_task_id}/revisions`;
  const [a, b] = await Promise.all([call(f, f.owner, "POST", url, body, key), call(f, f.owner, "POST", url, body, key)]);
  assert.equal(a.status, 201, JSON.stringify(a.data)); assert.equal(b.status, 201, JSON.stringify(b.data)); assert.equal(a.data.task_id, b.data.task_id);
  const after = await counts(f); assert.equal(after.tasks, before.tasks + 1); assert.equal(after.holds, before.holds + 1);
  const conflict = await call(f, f.owner, "POST", url, { ...body, instructions: "A different requested change" }, key); assert.equal(conflict.status, 409);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM outbox WHERE payload->>'task_id'=$1", [a.data.task_id])).rows[0].n, 1);
});

test("Unicode code-point text anchors accept emoji exactly and reject wrong quote, stale task version and changed delivery hash before a hold", async () => {
  const f = await fixture(), c = await original(f), before = await counts(f), url = f.base + `/tasks/${c.source_task_id}/revisions`;
  const start = Array.from(sourceText).indexOf("😀"), target = { kind: "text", start, end: start + 4, quote: Array.from(sourceText).slice(start, start + 4).join("") };
  for (const body of [{ ...requestBody(c, target), target: { ...target, quote: "wrong quote" } }, { ...requestBody(c), expected_version: c.expected_version + 1 }, { ...requestBody(c), expected_delivery_hash: "f".repeat(64) }]) {
    const denied = await call(f, f.owner, "POST", url, body); assert.equal(denied.status, 409, JSON.stringify(denied.data)); assert.deepEqual(await counts(f), before);
  }
  assert.ok((await revise(f, c, target)).task_id);
});

test("file-text anchors verify actual UTF-8 bytes and cannot select a file from another task", async () => {
  const f = await fixture(), c = await original(f), other = await original(f), file = c.artifacts.find((a: any) => a.mime_type === "text/markdown"), foreign = other.artifacts[0];
  const body = requestBody(c, { kind: "text", asset_version_id: file.asset_version_id, start: 0, end: 8, quote: "Original" });
  const bad = await call(f, f.owner, "POST", f.base + `/tasks/${c.source_task_id}/revisions`, { ...body, target: { ...body.target, asset_version_id: foreign.asset_version_id } });
  assert.equal(bad.status, 409); assert.ok((await ok(f, "POST", f.base + `/tasks/${c.source_task_id}/revisions`, body)).task_id);
});

test("image rectangles and verified video intervals are checked against the selected file, MIME and duration", async () => {
  const f = await fixture(), c = await original(f), image = c.artifacts.find((a: any) => a.mime_type === "image/png"), text = c.artifacts.find((a: any) => a.mime_type === "text/markdown"), video = c.artifacts.find((a: any) => a.duration_ms), unknown = c.artifacts.find((a: any) => a.name === "unknown-duration.mp4"), before = await counts(f);
  for (const [target, status] of [
    [{ kind: "image", asset_version_id: image.asset_version_id, x: .8, y: 0, width: .3, height: 1 }, 400],
    [{ kind: "image", asset_version_id: text.asset_version_id, x: 0, y: 0, width: 1, height: 1 }, 400],
    [{ kind: "video", asset_version_id: video.asset_version_id, start_ms: 0, end_ms: 3001 }, 400],
    [{ kind: "video", asset_version_id: unknown.asset_version_id, start_ms: 0, end_ms: 100 }, 409],
  ] as const) { const r = await call(f, f.owner, "POST", f.base + `/tasks/${c.source_task_id}/revisions`, requestBody(c, target)); assert.equal(r.status, status, JSON.stringify(r.data)); assert.deepEqual(await counts(f), before); }
  const a = await revise(f, c, { kind: "image", asset_version_id: image.asset_version_id, x: .1, y: .2, width: .5, height: .4 });
  const b = await revise(f, c, { kind: "video", asset_version_id: video.asset_version_id, start_ms: 250, end_ms: 2500 });
  assert.equal((await row(a.task_id)).input_context.delivery_revision.target.kind, "image"); assert.equal((await row(b.task_id)).input_context.delivery_revision.target.end_ms, 2500);
});

test("a changed source head fences an already admitted revision reader and completion; original bytes are retained", async () => {
  const f = await fixture(), c = await original(f), created = await revise(f, c), file = c.artifacts.find((a: any) => a.mime_type === "text/markdown");
  await s.db.tx(tx => saveAsset(tx, s.storage, { tenant: f.tenant, project: f.project, user: f.owner.id, asset: file.asset_id, expectedVersion: file.version,
    name: "new-head.md", mime: "text/markdown", bytes: Buffer.from("New source version"), metadata: { task_id: c.source_task_id } }), f.tenant, false, f.owner.id);
  await assert.rejects(s.db.tx(tx => assertTaskContentSources(tx, { id: created.task_id }), f.tenant, false, f.owner.id), /original delivery|source|delivery/i);
  let called = false;
  class ShouldNotRun extends CodexRuntimeAdapter { constructor() { super(s.db.config); } override async start(): Promise<RuntimeResult> { called = true; throw new Error("Stale source must not reach runtime"); } }
  await new Worker(s.db, s.catalog, s.storage, new ShouldNotRun()).run(f.tenant, created.task_id); assert.equal(called, false); assert.notEqual((await row(created.task_id)).status, "succeeded");
  const denied = await call(f, f.owner, "POST", f.base + `/tasks/${c.source_task_id}/revisions`, requestBody(c)); assert.equal(denied.status, 409);
});

test("later source reviews do not change file identity; a withdrawn source still fences completed derived results", async () => {
  const f = await fixture(), c = await original(f), created = await revise(f, c), q = await ok(f, "GET", f.base + `/tasks/${c.source_task_id}/quality`);
  await ok(f, "POST", f.base + `/tasks/${c.source_task_id}/reviews`, { expected_version: q.task_version, expected_delivery_hash: q.delivery_hash, decision: "accepted" });
  await s.db.tx(tx => assertTaskContentSources(tx, { id: created.task_id }), f.tenant, false, f.owner.id);
  await s.db.control.query("UPDATE assets SET state='quarantined' WHERE id=$1", [c.artifacts[0].asset_id]);
  await assert.rejects(s.db.tx(tx => assertTaskContentSources(tx, { id: created.task_id }), f.tenant, false, f.owner.id));
});

test("viewer access, tenant boundaries and private conversation ownership cannot be used to reserve revisions", async () => {
  const f = await fixture(), c = await original(f), privateSource = await original(f, true), viewer = await historyLogin(s), outsider = await fixture(); viewer.tenant = f.tenant;
  await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role,status) VALUES($1,$2,'member','active')", [f.tenant, viewer.id]);
  await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'viewer')", [f.tenant, f.project, viewer.id]);
  const context = await ok(f, "GET", f.base + `/tasks/${c.source_task_id}/revision-context`, undefined, viewer); assert.equal(context.can_start, false);
  const before = await counts(f);
  assert.equal((await call(f, viewer, "POST", f.base + `/tasks/${c.source_task_id}/revisions`, requestBody(c))).status, 403);
  assert.equal((await call(f, outsider.owner, "GET", f.base + `/tasks/${c.source_task_id}/revision-context`)).status, 404);
  assert.equal((await call(f, viewer, "GET", f.base + `/tasks/${privateSource.source_task_id}/revision-context`)).status, 404);
  assert.deepEqual(await counts(f), before);
});

test("conversation version, archive state and active work prevent silently forking an old private conversation", async () => {
  const f = await fixture(), c = await original(f, true), url = f.base + `/tasks/${c.source_task_id}/revisions`, before = await counts(f);
  const bad = await call(f, f.owner, "POST", url, { ...requestBody(c), expected_conversation_version: c.conversation_version + 1 }); assert.equal(bad.status, 409); assert.deepEqual(await counts(f), before);
  await s.db.control.query("UPDATE conversations SET archived=true WHERE id=$1", [c.conversation_id]);
  assert.equal((await call(f, f.owner, "POST", url, requestBody(c))).status, 409); assert.deepEqual(await counts(f), before);
});

test("damaged stored text fails exact preview and anchored admission without another model call or hold", async () => {
  const f = await fixture(), c = await original(f), file = c.artifacts.find((a: any) => a.mime_type === "text/markdown"), before = await counts(f);
  const object = (await s.db.control.query("SELECT storage_key FROM asset_versions WHERE id=$1", [file.asset_version_id])).rows[0];
  await writeFile(path.resolve(s.db.config.DATA_DIR, object.storage_key), "deliberately damaged source");
  const q = new URLSearchParams({ expected_version: String(c.expected_version), expected_delivery_hash: c.expected_delivery_hash });
  assert.equal((await call(f, f.owner, "GET", f.base + `/tasks/${c.source_task_id}/revision-preview/${file.asset_version_id}?${q}`)).status, 409);
  assert.equal((await call(f, f.owner, "POST", f.base + `/tasks/${c.source_task_id}/revisions`, requestBody(c, { kind: "text", asset_version_id: file.asset_version_id, start: 0, end: 8, quote: "Original" }))).status, 409);
  assert.deepEqual(await counts(f), before);
});

test("Desktop revisions require the same native session and stay absent from the cloud queue", async () => {
  const f = await fixture(), verifier = randomBytes(32).toString("base64url"), redirect = "http://127.0.0.1:18249/callback";
  const auth = await ok(f, "POST", "/v1/auth/native/authorize", { client_id: "desktop", redirect_uri: redirect, state: randomBytes(32).toString("hex"), code_challenge: createHash("sha256").update(verifier).digest("base64url") });
  const c = await ok(f, "POST", "/v1/auth/native/token", { client_id: "desktop", redirect_uri: redirect, code: new URL(auth.redirect).searchParams.get("code"), code_verifier: verifier }, null);
  const fields = { device_id: randomUUID(), local_session_id: randomUUID(), workspace_hash: hash("owned revision fixture directory"), runtime_version: desktopRuntime.pinned_version, runtime_sha256: desktopRuntime.windows_x64_sha256 };
  const body = { ...fields, title: "Original local revision fixture", prompt: "Produce an explicit synthetic local result", role_key: "fullstack", budget_micros: 1000000 }, base = f.base + "/desktop-executions";
  const first = await ok(f, "POST", base, body, c); const originalStarted = await ok(f, "POST", base + `/${first.task_id}/start`, fields, c);
  await ok(f, "POST", base + `/${first.task_id}/finish`, { status: "failed", output: "Retained local fixture output", thread_id: "synthetic-native", turn_id: "1" }, c);
  const source = await ok(f, "GET", f.base + `/tasks/${first.task_id}/revision-context`, undefined, c), selection = requestBody(source, { kind: "output" });
  assert.equal((await call(f, c, "POST", f.base + `/tasks/${first.task_id}/revisions`, selection)).data.error.code, "DESKTOP_LOCAL_EXECUTION_REQUIRED");
  const reference = { source_task_id: first.task_id, expected_version: source.expected_version, expected_delivery_hash: source.expected_delivery_hash, target: { kind: "output" } };
  const wrong = await call(f, c, "POST", base, { ...body, local_session_id: randomUUID(), delivery_revision: reference }); assert.equal(wrong.status, 409);
  const key = randomUUID(), next = await ok(f, "POST", base, { ...body, prompt: "Revise the previous local result", delivery_revision: reference }, c, key);
  assert.equal((await ok(f, "POST", base, { ...body, prompt: "Revise the previous local result", delivery_revision: reference }, c, key)).task_id, next.task_id);
  const task = await row(next.task_id); assert.equal(task.execution_location, "desktop"); assert.equal(task.parent_id, first.task_id);
  assert.equal(task.input_context.delivery_revision.source_task_id, first.task_id);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM outbox WHERE payload->>'task_id'=$1", [next.task_id])).rows[0].n, 0);
  const started = await ok(f, "POST", base + `/${next.task_id}/start`, fields, c); assert.match(started.prompt, /project_assets/); assert.deepEqual(started.company_tools, originalStarted.company_tools); assert.equal(started.company_tools.some((tool: any) => tool.name === "delivery_revision_read"), false);
  assert.ok(started.company_tools.length <= 32); await ok(f, "POST", base + `/${next.task_id}/finish`, { status: "failed", output: "Retained local revision fixture output", thread_id: "synthetic-native", turn_id: "2" }, c);
  const follow = await ok(f, "POST", base, { ...body, prompt: "Continue the same local work after the revision" }, c);
  assert.equal((await row(follow.task_id)).input_context.delivery_revision.source_task_id, first.task_id);
  await s.db.tx(tx => assertTaskContentSources(tx, { id: follow.task_id }), f.tenant, false, f.owner.id);
  await ok(f, "POST", base + `/${follow.task_id}/cancel`, {}, c);
});

test("database guards retain immutable revision identity and also permit an authorized teammate to revise shared work", async () => {
  const f = await fixture(), source = await original(f), teammate = await historyLogin(s); teammate.tenant = f.tenant;
  await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role,status) VALUES($1,$2,'member','active')", [f.tenant, teammate.id]);
  await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')", [f.tenant, f.project, teammate.id]);
  const created = await ok(f, "POST", f.base + `/tasks/${source.source_task_id}/revisions`, requestBody(source), teammate);
  await assert.rejects(s.db.control.query("UPDATE tasks SET input_context=jsonb_set(input_context,'{delivery_revision,expected_delivery_hash}',to_jsonb($2::text)) WHERE id=$1", [created.task_id, "f".repeat(64)]), { code: "23514" });
  await assert.rejects(s.db.control.query("UPDATE tasks SET input_context=input_context-'delivery_revision' WHERE id=$1", [created.task_id]), { code: "23514" });
  assert.equal((await row(created.task_id)).input_context.delivery_revision.expected_delivery_hash, source.expected_delivery_hash);
});
