import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "../src/config.js";
import { listenLoopbackHTTP } from "../src/loopback-http.js";
import { AIRequestFailure, internalAIRequest, type AIOperation, type AIRequestAuthority } from "../src/internal-ai-gateway.js";
import { parseVideoJobObservation, videoJobCharge, videoJobProtocol, videoJobSpecification } from "../src/video-job-protocol.js";

const model = "synthetic-company-video-fixture";
const expected = { operationId: randomUUID(), model, size: "720x1280" as const, seconds: 4 as const };
const observation = (values: Record<string, unknown> = {}) => ({
  protocol: videoJobProtocol, object: "video", id: "video_fixture_01", operation_id: expected.operationId,
  event_id: randomUUID(), sequence: 1, model, size: expected.size, seconds: expected.seconds,
  status: "queued", progress: null, usage: null, content: null, error: null, ...values,
});
function form(reference = false) {
  const body = new FormData();
  for (const [name, value] of Object.entries({ model, prompt: "Explicit synthetic clip", size: expected.size, seconds: "4" })) body.set(name, value);
  if (reference) body.set("input_reference", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "reference.png");
  return body;
}
async function fixture(t: TestContext, env: NodeJS.ProcessEnv = {}) {
  const sent: { path: string; method: string; body: Buffer; headers: Record<string, any> }[] = [];
  const outcomes: any[] = [], authorized: any[] = [];
  let handler = async (_: (typeof sent)[number], res: ServerResponse) => { res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(observation())); };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const value = { path: req.url!, method: req.method!, body: Buffer.concat(chunks), headers: req.headers };
    sent.push(value);
    await handler(value, res);
  });
  const port = await listenLoopbackHTTP(server);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const c = loadConfig({ NODE_ENV: "test", DEMO_MODE: "true", AI_BASE_URL: `http://127.0.0.1:${port}/v1`, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: randomBytes(32).toString("hex"), ...env });
  const authority: AIRequestAuthority = {
    taskId: randomUUID(), tenantId: randomUUID(), projectId: randomUUID(), actorId: randomUUID(), capabilityVersionId: randomUUID(),
    authorize: async (info) => { authorized.push(info); return { dispatch: async () => {}, finish: async (outcome) => { outcomes.push(outcome); } }; },
  };
  return { c, sent, outcomes, authorized, authority, setHandler: (fn: typeof handler) => { handler = fn; },
    request: (operation: AIOperation, extra: Record<string, any> = {}) => internalAIRequest(c, { operation, model, body: {}, authority, signal: new AbortController().signal, ...extra }),
  };
}

test("video specification rejects client-selected providers, models, URLs and unsupported duration", () => {
  const base = { prompt: "A synthetic clip", size: "720x1280", seconds: 4 };
  assert.equal(videoJobSpecification.parse(base).seconds, 4);
  for (const values of [{ api_key: "fixture" }, { model: "another-model" }, { endpoint: "https://example.invalid" }, { seconds: 5 }, { seconds: "4" }, { size: "100x100" }, { prompt: " " }, { reference: { url: "https://example.invalid" } }])
    assert.equal(videoJobSpecification.safeParse({ ...base, ...values }).success, false);
});

test("video observations preserve unknown progress and unknown terminal cost", () => {
  const queued = parseVideoJobObservation(observation(), expected);
  assert.equal(queued.value.progress, null);
  assert.equal(queued.terminal, false);
  const terminal = parseVideoJobObservation(observation({ status: "cancelled", usage: null }), expected);
  assert.equal(terminal.terminal, true);
  assert.equal(terminal.value.usage, null);
  assert.equal(parseVideoJobObservation(observation({ status: "cancelled", usage: { billable_seconds: 0 } }), expected).value.usage?.billable_seconds, 0);
});

test("video observations bind the exact operation, model, specification and provider object", () => {
  const value = observation();
  for (const change of [{ operationId: randomUUID() }, { model: "another" }, { size: "1280x720" }, { seconds: 8 }, { videoId: "video_other" }])
    assert.throws(() => parseVideoJobObservation(value, { ...expected, ...change } as any), { code: "VIDEO_OPERATION_MISMATCH" });
  assert.equal(parseVideoJobObservation(value, expected).hash, parseVideoJobObservation(value, expected).hash);
});

test("video observations cannot replace content with an external URL or omit a completed content identity", () => {
  const content = { sha256: "a".repeat(64), bytes: 123 };
  assert.equal(parseVideoJobObservation(observation({ status: "completed", content }), expected).terminal, true);
  for (const change of [{ status: "completed" }, { content }, { status: "completed", content: { ...content, url: "https://example.invalid" } }, { status: "completed", content: { ...content, bytes: 100_000_001 } }, { usage: { billable_seconds: 4 } }, { error: { code: "unsafe", message: "raw upstream content" } }, { sequence: -1 }, { event_id: "untrusted" }, { id: "../escape" }])
    assert.throws(() => parseVideoJobObservation(observation(change), expected), { code: "VIDEO_PROTOCOL_INVALID" });
});

test("video charges use exact frozen integer rates and retain legitimate zero usage", () => {
  assert.equal(videoJobCharge(8, 123457), 987656);
  assert.equal(videoJobCharge(0, 123457), 0);
  for (const [seconds, rate] of [[-1, 1], [1.5, 1], [1, NaN], [1, undefined], [Number.MAX_SAFE_INTEGER, 2]])
    assert.throws(() => videoJobCharge(seconds!, rate!), { code: seconds === Number.MAX_SAFE_INTEGER ? "VIDEO_USAGE_OUT_OF_RANGE" : "VIDEO_USAGE_INVALID" });
});

test("video create sends real multipart bytes and trusted company identity to the fixed internal endpoint", async (t) => {
  const f = await fixture(t);
  const response = await f.request("videos.create", { body: form(true), operationId: expected.operationId });
  await response.json();
  assert.equal(f.sent.length, 1);
  const sent = f.sent[0];
  assert.equal(sent.method, "POST");
  assert.equal(sent.path, "/v1/videos");
  assert.equal(sent.headers.authorization, "Bearer " + f.c.AI_API_KEY);
  assert.equal(sent.headers["idempotency-key"], expected.operationId);
  assert.equal(sent.headers["x-copypaste-task-id"], f.authority.taskId);
  const fields = await new Response(new Uint8Array(sent.body), { headers: { "Content-Type": sent.headers["content-type"] } }).formData();
  assert.equal(fields.get("model"), model);
  assert.equal(fields.get("seconds"), "4");
  assert.deepEqual(Buffer.from(await (fields.get("input_reference") as Blob).arrayBuffer()), Buffer.from([137, 80, 78, 71]));
  assert.equal(f.authorized[0].operation, "videos.create");
});

test("video reads, lookup, cancellation and content use explicit methods and hash their resource identity", async (t) => {
  const f = await fixture(t);
  for (const [operation, resource] of [["videos.retrieve", { videoId: "video_fixture_01" }], ["videos.lookup", { operationId: expected.operationId }], ["videos.cancel", { videoId: "video_fixture_01" }], ["videos.content", { videoId: "video_fixture_01" }], ["videos.retrieve", { videoId: "video_fixture_02" }]] as const) {
    const response = await f.request(operation, { videoResource: resource });
    await response.json();
  }
  assert.deepEqual(f.sent.map((x) => x.method), ["GET", "GET", "POST", "GET", "GET"]);
  assert.deepEqual(f.sent.map((x) => x.path), ["/v1/videos/video_fixture_01", "/v1/videos/operations/" + expected.operationId, "/v1/videos/video_fixture_01/cancel", "/v1/videos/video_fixture_01/content", "/v1/videos/video_fixture_02"]);
  assert.equal(f.sent[0].body.length, 0);
  assert.equal(f.sent[2].body.toString(), "{}");
  assert.equal(new Set(f.authorized.map((x) => x.requestHash)).size, 5);
});

test("video gateway rejects traversal, arbitrary URLs, mixed scopes and unknown operations before dispatch", async (t) => {
  const f = await fixture(t);
  for (const [operation, resource] of [["videos.retrieve", {}], ["videos.retrieve", { videoId: "../escape" }], ["videos.retrieve", { videoId: "https://example.invalid" }], ["videos.retrieve", { videoId: "safe", operationId: expected.operationId }], ["videos.lookup", { operationId: "bad" }], ["videos.create", { videoId: "safe" }], ["videos.evil", { videoId: "safe" }]] as const)
    await assert.rejects(f.request(operation as AIOperation, { videoResource: resource }), (error: any) => error instanceof AIRequestFailure && ["AI_VIDEO_SCOPE_INVALID", "AI_OPERATION_NOT_ALLOWED"].includes(error.code));
  assert.equal(f.sent.length, 0);
  assert.equal(f.authorized.length, 0);
});

test("video gateway rejects unsupported multipart and JSON mutation before dispatch", async (t) => {
  const f = await fixture(t);
  const changed = form(); changed.set("model", "silent-fallback");
  const extra = form(); extra.set("url", "https://example.invalid");
  const doubled = form(); doubled.append("seconds", "4");
  const empty = form(); empty.set("input_reference", new Blob([], { type: "image/png" }), "empty.png");
  const wrong = form(); wrong.set("input_reference", new Blob(["fixture"], { type: "text/plain" }), "wrong.txt");
  for (const body of [changed, extra, doubled, empty, wrong])
    await assert.rejects(f.request("videos.create", { body }), (error: any) => error instanceof AIRequestFailure);
  await assert.rejects(f.request("videos.create", { body: { model, prompt: "fixture", seconds: 4 } }), { code: "AI_PROTOCOL_NOT_ALLOWED" });
  await assert.rejects(f.request("videos.retrieve", { videoResource: { videoId: "safe" }, body: { endpoint: "https://example.invalid" } }), { code: "AI_VIDEO_SPECIFICATION_CHANGED" });
  assert.equal(f.sent.length, 0);
});

test("video requests share the existing internal host and production HTTPS restrictions", async (t) => {
  const f = await fixture(t);
  f.c.AI_ALLOWED_HOSTS = "allowed.invalid";
  await assert.rejects(f.request("videos.create", { body: form() }), { code: "AI_GATEWAY_NOT_ALLOWED" });
  await assert.rejects(internalAIRequest({ ...f.c, NODE_ENV: "production", AI_ALLOWED_HOSTS: "127.0.0.1" }, { operation: "videos.create", model, body: form(), authority: f.authority, signal: new AbortController().signal }), { code: "AI_GATEWAY_NOT_ALLOWED" });
  assert.equal(f.sent.length, 0);
});

test("video redirects are rejected and a dispatched request retains an unknown outcome", async (t) => {
  const f = await fixture(t);
  f.setHandler(async (_request, res) => { res.writeHead(302, { Location: "https://example.invalid/video" }).end(); });
  await assert.rejects(f.request("videos.create", { body: form() }), { code: "AI_UPSTREAM_UNCERTAIN", dispatched: true });
  assert.equal(f.sent.length, 1);
  assert.equal(f.outcomes.at(-1).state, "unknown");
});

test("declared oversized video responses are bounded before exposing content", async (t) => {
  const f = await fixture(t, { AI_MAX_RESPONSE_BYTES: "1024" });
  f.setHandler(async (_request, res) => { res.writeHead(200, { "Content-Length": 1025 }).end(Buffer.alloc(1025)); });
  await assert.rejects(f.request("videos.content", { videoResource: { videoId: "video_fixture_01" } }), { code: "AI_RESPONSE_TOO_LARGE" });
  assert.equal(f.outcomes.at(-1).state, "unknown");
});

test("streamed oversized video data is bounded even without Content-Length", async (t) => {
  const f = await fixture(t, { AI_MAX_RESPONSE_BYTES: "1024" });
  f.setHandler(async (_request, res) => { res.writeHead(200, { "Content-Type": "video/mp4" }); res.write(Buffer.alloc(512)); await delay(10); res.end(Buffer.alloc(700)); });
  const response = await f.request("videos.content", { videoResource: { videoId: "video_fixture_01" } });
  await assert.rejects(response.arrayBuffer(), { code: "AI_RESPONSE_TOO_LARGE" });
  assert(f.outcomes.some((x) => x.state === "unknown"));
});

test("aborting a submitted video request does not turn uncertain usage into a free cancellation", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  f.setHandler(async (_request, res) => { controller.abort(); res.end(); });
  await assert.rejects(f.request("videos.retrieve", { videoResource: { videoId: "video_fixture_01" }, signal: controller.signal }));
  assert(f.outcomes.some((x) => x.state === "unknown"));
});

test("video errors retain their HTTP status for the durable caller and never confirm zero cost", async (t) => {
  const f = await fixture(t);
  f.setHandler(async (_request, res) => { res.writeHead(503).end("unavailable"); });
  const response = await f.request("videos.lookup", { videoResource: { operationId: expected.operationId } });
  assert.equal(response.status, 503);
  assert.equal(await response.text(), "unavailable");
  assert.equal(f.outcomes.length, 0);
});
