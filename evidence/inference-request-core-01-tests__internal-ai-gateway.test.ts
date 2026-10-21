import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  createServer,
  type IncomingHttpHeaders,
  type ServerResponse,
} from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "../src/config.js";
import { listenLoopbackHTTP } from "../src/loopback-http.js";
import {
  AIRequestFailure,
  internalAIRequest,
  startScopedInferenceGateway,
  type AIRequestAuthority,
  type AIRequestInfo,
} from "../src/internal-ai-gateway.js";

const model = "controlled-inference-fixture";
const completed = (usage: unknown = { input_tokens: 7, output_tokens: 11 }) =>
  `event: response.completed\ndata: ${JSON.stringify({
    type: "response.completed",
    response: { status: "completed", usage },
  })}\n\n`;
const body = () => ({
  model,
  reasoning: { effort: "high" },
  stream: true,
  input: [{ role: "user", content: "Controlled internal fixture" }],
  tools: [{ type: "function", name: "lookup", parameters: { type: "object" } }],
});
type Scope = Awaited<ReturnType<typeof startScopedInferenceGateway>>;
interface Sent {
  path: string;
  headers: IncomingHttpHeaders;
  body: any;
  raw: Buffer;
}

async function fixture(t: TestContext, overrides: NodeJS.ProcessEnv = {}) {
  const sent: Sent[] = [],
    scopes: Scope[] = [];
  let handler = async (_: Sent, res: ServerResponse) => {
    res
      .writeHead(200, { "Content-Type": "text/event-stream" })
      .end(completed());
  };
  const provider = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks);
      const record = {
        path: req.url!,
        headers: req.headers,
        raw,
        body: req.headers["content-type"]?.startsWith("application/json")
          ? JSON.parse(raw.toString())
          : undefined,
      };
      sent.push(record);
      await handler(record, res);
    } catch {
      res.destroy();
    }
  });
  const port = await listenLoopbackHTTP(provider);
  const c = loadConfig({
    NODE_ENV: "test",
    AI_BASE_URL: `http://127.0.0.1:${port}/v1`,
    AI_ALLOWED_HOSTS: "127.0.0.1",
    AI_API_KEY: randomBytes(32).toString("hex"),
    AI_MODEL: model,
    AI_VERIFIED: "true",
    AI_REASONING_EFFORT: "high",
    ...overrides,
  });
  const info: AIRequestInfo[] = [];
  const authority: AIRequestAuthority = {
    taskId: randomUUID(),
    tenantId: randomUUID(),
    projectId: randomUUID(),
    actorId: randomUUID(),
    capabilityVersionId: randomUUID(),
    attempt: 2,
    fencingToken: randomUUID(),
    authorize: async (value) => {
      info.push(value);
    },
  };
  t.after(async () => {
    for (const scope of scopes) await scope.close();
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  });
  return {
    c,
    sent,
    info,
    authority,
    setHandler(fn: typeof handler) {
      handler = fn;
    },
    async scope(selected = authority, signal = new AbortController().signal) {
      const scope = await startScopedInferenceGateway(c, {
        model,
        reasoningEffort: "high",
        tools: ["lookup"],
        authority: selected,
        signal,
      });
      scopes.push(scope);
      return scope;
    },
  };
}
const issue = (
  scope: Scope,
  value: unknown = body(),
  headers: Record<string, string> = {},
) =>
  fetch(scope.baseURL + "/responses", {
    method: "POST",
    signal: AbortSignal.timeout(5000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${scope.credential}`,
      ...headers,
    },
    body: JSON.stringify(value),
  });
const denied =
  (code: string, dispatched = false) =>
  (error: unknown) =>
    error instanceof AIRequestFailure &&
    error.code === code &&
    error.dispatched === dispatched;

test("scoped Responses forwards only trusted attribution, uses a separate opaque key and reauthorizes each request", async (t) => {
  const f = await fixture(t),
    scope = await f.scope();
  assert.notEqual(scope.credential, f.c.AI_API_KEY);
  assert.match(scope.credential, /^[a-f0-9]{64}$/);
  for (let i = 0; i < 2; i++) {
    const result = await issue(scope, body(), {
      "X-CopyPaste-Tenant-Id": "forged-tenant",
      "Idempotency-Key": "forged-operation",
      "X-CopyPaste-Billing-Account": "forged-wallet",
    });
    assert.equal(result.status, 200);
    assert.equal(await result.text(), completed());
  }
  assert.equal(scope.forwardedRequests, 2);
  assert.deepEqual(scope.measuredUsage, {
    allResponsesKnown: true,
    responses: 2,
    inputTokens: 14,
    outputTokens: 22,
  });
  assert.equal(f.info.length, 2);
  assert.notEqual(f.info[0].requestId, f.info[1].requestId);
  assert.equal("authorize" in f.info[0], false);
  for (const request of f.sent) {
    assert.equal(request.path, "/v1/responses");
    assert.equal(request.headers.authorization, "Bearer " + f.c.AI_API_KEY);
    assert.equal(
      request.headers["x-copypaste-tenant-id"],
      f.authority.tenantId,
    );
    assert.equal(
      request.headers["x-copypaste-project-id"],
      f.authority.projectId,
    );
    assert.equal(request.headers["x-copypaste-task-id"], f.authority.taskId);
    assert.equal(request.headers["x-copypaste-actor-id"], f.authority.actorId);
    assert.equal(
      request.headers["x-copypaste-capability-version-id"],
      f.authority.capabilityVersionId,
    );
    assert.equal(request.headers["x-copypaste-attempt"], "2");
    assert.equal(
      request.headers["x-copypaste-fencing-token"],
      f.authority.fencingToken,
    );
    assert.equal(request.headers["x-copypaste-billing-account"], undefined);
    assert.notEqual(request.headers["idempotency-key"], "forged-operation");
    assert.equal(request.body.model, model);
    assert.equal(request.body.reasoning.effort, "high");
    assert.equal(request.body.max_output_tokens, f.c.AI_MAX_OUTPUT_TOKENS);
    assert.ok(!JSON.stringify(request.body).includes(scope.credential));
  }
});

test("authority revocation between responses blocks the next provider call and does not expose callback errors", async (t) => {
  const f = await fixture(t);
  let active = true,
    checks = 0;
  const scope = await f.scope({
    ...f.authority,
    authorize: async () => {
      checks++;
      if (!active) throw new Error("private authorization diagnostic");
    },
  });
  assert.equal(await (await issue(scope)).text(), completed());
  active = false;
  const r = await issue(scope);
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), {
    error: {
      code: "AI_REQUEST_AUTHORIZATION_CHANGED",
      message: "AI_REQUEST_AUTHORIZATION_CHANGED",
    },
  });
  assert.equal(checks, 2);
  assert.equal(f.sent.length, 1);
  assert.equal(scope.forwardedRequests, 1);
});

test("credentials cannot cross runs and cannot authorize other paths, origins, methods or query endpoints", async (t) => {
  const f = await fixture(t),
    a = await f.scope(),
    b = await f.scope();
  assert.notEqual(a.credential, b.credential);
  assert.notEqual(a.baseURL, b.baseURL);
  for (const [url, token, method, extra, expected] of [
    [b.baseURL + "/responses", a.credential, "POST", {}, 401],
    [a.baseURL + "/responses", b.credential, "POST", {}, 401],
    [a.baseURL + "/responses", "", "POST", {}, 401],
    [a.baseURL + "/images/generations", a.credential, "POST", {}, 403],
    [a.baseURL + "/responses?model=other", a.credential, "POST", {}, 403],
    [a.baseURL + "/responses", a.credential, "GET", {}, 403],
    [
      a.baseURL + "/responses",
      a.credential,
      "POST",
      { Origin: "https://example.invalid" },
      415,
    ],
  ] as const) {
    const r = await fetch(url, {
      method,
      signal: AbortSignal.timeout(5000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...extra,
      },
      ...(method === "POST" ? { body: JSON.stringify(body()) } : {}),
    });
    assert.equal(r.status, expected);
    await r.arrayBuffer();
  }
  assert.equal(f.sent.length, 0);
  assert.equal(f.info.length, 0);
});

test("model, effort, hosted state, unregistered tools and output-limit overrides are rejected before authorization or dispatch", async (t) => {
  const f = await fixture(t),
    scope = await f.scope();
  for (const patch of [
    { model: "another-model" },
    { reasoning: { effort: "low" } },
    { reasoning: { effort: "high", mode: "fast" } },
    { stream: false },
    { background: true },
    { previous_response_id: "resp_other" },
    { conversation: "other-conversation" },
    { headers: { Authorization: "attacker" } },
    { base_url: "https://example.invalid" },
    { api_key: "attacker" },
    { tools: [{ type: "web_search" }] },
    { tools: [{ type: "function", name: "shell" }] },
    { tools: "lookup" },
    { max_output_tokens: f.c.AI_MAX_OUTPUT_TOKENS + 1 },
    { max_output_tokens: 1.5 },
    { max_output_tokens: -1 },
  ]) {
    const r = await issue(scope, { ...body(), ...patch });
    assert.equal(r.status, 400, JSON.stringify(patch));
    await r.arrayBuffer();
  }
  const r = await issue(scope, { ...body(), max_output_tokens: 32 });
  assert.equal(await r.text(), completed());
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].body.max_output_tokens, 32);
  assert.equal(f.info.length, 1);
});

test("declared and streamed oversized request bodies never reach the provider", async (t) => {
  const f = await fixture(t, { AI_MAX_REQUEST_BYTES: "1024" }),
    scope = await f.scope();
  const r = await issue(scope, { ...body(), input: "x".repeat(2000) });
  assert.equal(r.status, 413);
  await r.arrayBuffer();
  const encoded = Buffer.from(
    JSON.stringify({ ...body(), input: "x".repeat(2000) }),
  );
  const streamed = await fetch(scope.baseURL + "/responses", {
    method: "POST",
    duplex: "half",
    signal: AbortSignal.timeout(5000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${scope.credential}`,
    },
    body: new ReadableStream({
      start(out) {
        out.enqueue(encoded.subarray(0, 900));
        out.enqueue(encoded.subarray(900));
        out.close();
      },
    }),
  } as RequestInit);
  assert.equal(streamed.status, 413);
  await streamed.arrayBuffer();
  assert.equal(f.sent.length, 0);
  assert.equal(scope.forwardedRequests, 0);
});

test("a run has one in-flight request and a hard forwarded-request ceiling", async (t) => {
  const f = await fixture(t, { AI_MAX_REQUESTS_PER_TURN: "1" });
  let ready!: () => void, finish!: () => void;
  const arrived = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const release = new Promise<void>((resolve) => {
    finish = resolve;
  });
  t.after(() => finish());
  f.setHandler(async (_, res) => {
    ready();
    await release;
    res
      .writeHead(200, { "Content-Type": "text/event-stream" })
      .end(completed());
  });
  const scope = await f.scope(),
    pending = issue(scope);
  await arrived;
  const busy = await issue(scope);
  assert.equal(busy.status, 429);
  await busy.arrayBuffer();
  finish();
  assert.equal(await (await pending).text(), completed());
  const limit = await issue(scope);
  assert.equal(limit.status, 429);
  await limit.arrayBuffer();
  assert.equal(scope.forwardedRequests, 1);
  assert.equal(f.sent.length, 1);
});

test("expiry and explicit cancellation revoke a scoped credential without a provider request", async (t) => {
  const f = await fixture(t, { AI_SCOPE_TTL_MS: "30" });
  const expired = await f.scope();
  await delay(60);
  const r = await issue(expired);
  assert.equal(r.status, 403);
  await r.arrayBuffer();
  const cancelled = new AbortController(),
    scope = await f.scope(f.authority, cancelled.signal);
  cancelled.abort();
  const denied = await issue(scope);
  assert.equal(denied.status, 403);
  await denied.arrayBuffer();
  assert.equal(f.sent.length, 0);
});

test("redirects are not followed and an uncertain dispatched request cannot be replayed", async (t) => {
  const f = await fixture(t);
  let followed = 0;
  const target = createServer((_, res) => {
    followed++;
    res.end("unexpected");
  });
  const port = await listenLoopbackHTTP(target);
  t.after(async () => {
    target.closeAllConnections();
    await new Promise<void>((resolve) => target.close(() => resolve()));
  });
  f.setHandler(async (_, res) => {
    res.writeHead(307, { Location: `http://127.0.0.1:${port}/leak` }).end();
  });
  const scope = await f.scope(),
    r = await issue(scope);
  assert.equal(r.status, 502);
  assert.equal((await r.json()).error.code, "AI_UPSTREAM_UNCERTAIN");
  const next = await issue(scope);
  assert.equal(next.status, 403);
  await next.arrayBuffer();
  assert.equal(f.sent.length, 1);
  assert.equal(followed, 0);
});

test("truncated streams, absent terminal usage and upstream failures keep the grant unusable for replay", async (t) => {
  for (const [status, bytes] of [
    [200, 'event: response.created\ndata: {"type":"response.created"}\n\n'],
    [
      200,
      'data: {"type":"response.failed","response":{"status":"failed"}}\n\n',
    ],
    [
      200,
      completed(undefined).replace(
        '"usage":{"input_tokens":7,"output_tokens":11}',
        '"usage":null',
      ),
    ],
    [503, '{"error":{"code":"CONTROLLED_UPSTREAM_FAILURE"}}'],
  ] as const) {
    const f = await fixture(t);
    f.setHandler(async (_, res) => {
      res.writeHead(status, { "Content-Type": "text/event-stream" }).end(bytes);
    });
    const scope = await f.scope(),
      r = await issue(scope);
    assert.equal(r.status, status);
    assert.equal(await r.text(), bytes);
    const next = await issue(scope);
    assert.equal(next.status, 403);
    await next.arrayBuffer();
    assert.equal(f.sent.length, 1);
  }
});

test("split UTF-8, CRLF and multiline SSE data preserve raw bytes and legitimate terminal usage", async (t) => {
  const f = await fixture(t);
  const raw = Buffer.from(
    'event: response.completed\r\ndata: {"type":"response.completed",\r\ndata: "response":{"label":"香港","usage":{"input_tokens":7,"output_tokens":11}}}\r\n\r\n',
  );
  f.setHandler(async (_, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const byte of raw) {
      res.write(Buffer.from([byte]));
      await delay(1);
    }
    res.end();
  });
  const scope = await f.scope();
  assert.deepEqual(Buffer.from(await (await issue(scope)).arrayBuffer()), raw);
  assert.deepEqual(Buffer.from(await (await issue(scope)).arrayBuffer()), raw);
  assert.equal(f.sent.length, 2);
});

test("an unterminated SSE tool frame is never forwarded or treated as a known terminal result", async (t) => {
  const f = await fixture(t);
  f.setHandler(async (_, res) => {
    res
      .writeHead(200, { "Content-Type": "text/event-stream" })
      .end(completed().trimEnd());
  });
  const scope = await f.scope(),
    r = await issue(scope);
  assert.equal(r.status, 502);
  assert.equal((await r.json()).error.code, "AI_STREAM_INCOMPLETE");
  const next = await issue(scope);
  assert.equal(next.status, 403);
  await next.arrayBuffer();
  assert.equal(f.sent.length, 1);
});

test("the kernel question declaration is suppressed and unregistered response calls are blocked before Codex receives them", async (t) => {
  const f = await fixture(t),
    scope = await f.scope();
  const request = {
    ...body(),
    tools: [
      ...body().tools,
      {
        type: "function",
        name: "request_user_input",
        parameters: { type: "object" },
      },
    ],
  };
  assert.equal(await (await issue(scope, request)).text(), completed());
  assert.deepEqual(f.sent[0].body.tools, body().tools);
  for (const value of [
    {
      type: "response.output_item.added",
      item: {
        type: "function_call",
        id: "fc_forbidden",
        name: "view_image",
        arguments: "{}",
      },
    },
    {
      type: "response.output_item.done",
      item: {
        type: "function_call",
        id: "fc_forbidden",
        name: "request_user_input",
        arguments: "{}",
      },
    },
    {
      type: "response.completed",
      response: {
        usage: { input_tokens: 7, output_tokens: 11 },
        output: [
          { type: "function_call", name: "exec_command", arguments: "{}" },
        ],
      },
    },
    {
      type: "response.function_call_arguments.delta",
      item_id: "unregistered_item",
      delta: "{}",
    },
    {
      type: "response.output_item.added",
      item: {
        type: "custom_tool_call",
        name: "apply_patch",
        input: "Controlled fixture",
      },
    },
    { type: "response.web_search_call.in_progress", item_id: "not_registered" },
  ]) {
    const wire = `data: ${JSON.stringify(value)}\n\n`,
      blocked = await f.scope();
    f.setHandler(async (_, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const split = Math.floor(wire.length / 2);
      res.write(wire.slice(0, split));
      await delay(10);
      res.end(wire.slice(split));
    });
    const r = await issue(blocked, request);
    assert.equal(r.status, 502);
    assert.equal((await r.json()).error.code, "AI_TOOL_CALL_NOT_ALLOWED");
    const again = await issue(blocked);
    assert.equal(again.status, 403);
    await again.arrayBuffer();
    assert.equal(blocked.forwardedRequests, 1);
  }
});

test("registered function-call frames and arguments are streamed unchanged after validation", async (t) => {
  const f = await fixture(t);
  const wire =
    [
      {
        type: "response.output_item.added",
        item: {
          type: "function_call",
          id: "fc_allowed",
          name: "lookup",
          arguments: "",
        },
      },
      {
        type: "response.function_call_arguments.delta",
        item_id: "fc_allowed",
        delta: "{}",
      },
      {
        type: "response.function_call_arguments.done",
        item_id: "fc_allowed",
        arguments: "{}",
      },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join("") + completed();
  f.setHandler(async (_, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" }).end(wire);
  });
  const scope = await f.scope();
  assert.equal(await (await issue(scope)).text(), wire);
  assert.equal(await (await issue(scope)).text(), wire);
  assert.equal(scope.forwardedRequests, 2);
});

test("malformed or oversized SSE frames are rejected before forwarding an event", async (t) => {
  for (const [wire, expected] of [
    ["data: {broken-json}\n\n", "AI_RESPONSE_PROTOCOL_INVALID"],
    [
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "x".repeat(2000) })}\n\n`,
      "AI_RESPONSE_EVENT_TOO_LARGE",
    ],
  ]) {
    const f = await fixture(t, { AI_MAX_REQUEST_BYTES: "1024" });
    f.setHandler(async (_, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" }).end(wire);
    });
    const scope = await f.scope(),
      r = await issue(scope);
    assert.equal(r.status, 502);
    assert.equal((await r.json()).error.code, expected);
    const again = await issue(scope);
    assert.equal(again.status, 403);
    await again.arrayBuffer();
    assert.equal(f.sent.length, 1);
  }
});

test("stream idle timeout aborts an accepted provider request and prevents another dispatch", async (t) => {
  const f = await fixture(t, { AI_STREAM_IDLE_TIMEOUT_MS: "30" });
  f.setHandler(async (_, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write('data: {"type":"response.created"}\n\n');
  });
  const scope = await f.scope(),
    r = await issue(scope);
  await assert.rejects(r.text());
  const next = await issue(scope);
  assert.equal(next.status, 403);
  await next.arrayBuffer();
  assert.equal(f.sent.length, 1);
});

test("request deadline aborts even a non-idle stream and a response with no first byte", async (t) => {
  for (const stream of [false, true]) {
    const f = await fixture(t, {
      AI_REQUEST_TIMEOUT_MS: "60",
      AI_STREAM_IDLE_TIMEOUT_MS: "40",
    });
    f.setHandler(async (_, res) => {
      if (!stream) return;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(": heartbeat\n\n");
      const timer = setInterval(() => res.write(": heartbeat\n\n"), 10);
      res.once("close", () => clearInterval(timer));
    });
    const scope = await f.scope(),
      r = await issue(scope);
    if (stream) await assert.rejects(r.text());
    else {
      assert.equal(r.status, 502);
      await r.arrayBuffer();
    }
    const next = await issue(scope);
    assert.equal(next.status, 403);
    await next.arrayBuffer();
    assert.equal(f.sent.length, 1);
  }
});

test("declared and chunked oversized responses are bounded and never automatically replayed", async (t) => {
  for (const declared of [true, false]) {
    const f = await fixture(t, { AI_MAX_RESPONSE_BYTES: "1024" });
    f.setHandler(async (_, res) => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        ...(declared
          ? { "Content-Length": "2048" }
          : { "Transfer-Encoding": "chunked" }),
      });
      if (!declared) {
        res.write(": " + "x".repeat(508) + "\n\n");
        await delay(15);
      }
      res.end("x".repeat(declared ? 2048 : 1536));
    });
    const scope = await f.scope(),
      r = await issue(scope);
    if (declared) {
      assert.equal(r.status, 502);
      assert.equal((await r.json()).error.code, "AI_RESPONSE_TOO_LARGE");
    } else await assert.rejects(r.text());
    const next = await issue(scope);
    assert.equal(next.status, 403);
    await next.arrayBuffer();
    assert.equal(f.sent.length, 1);
  }
});

test("image generation and multipart editing use the same trusted authorization and exact frozen specification", async (t) => {
  const f = await fixture(t);
  f.setHandler(async (_, res) => {
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end('{"data":[]}');
  });
  const image = {
    model,
    prompt: "Controlled image fixture",
    n: 1,
    size: "1024x1024",
    quality: "high",
    output_format: "png",
  };
  const generate = await internalAIRequest(f.c, {
    operation: "images.generate",
    model,
    body: image,
    authority: f.authority,
    signal: AbortSignal.timeout(5000),
  });
  await generate.arrayBuffer();
  const form = new FormData();
  for (const [key, value] of Object.entries(image))
    form.set(key, String(value));
  form.set(
    "image",
    new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    "fixture.png",
  );
  const edit = await internalAIRequest(f.c, {
    operation: "images.edit",
    model,
    body: form,
    authority: f.authority,
    signal: AbortSignal.timeout(5000),
  });
  await edit.arrayBuffer();
  assert.equal(f.info.length, 2);
  assert.equal(f.sent[0].path, "/v1/images/generations");
  assert.deepEqual(f.sent[0].body, image);
  assert.equal(f.sent[1].path, "/v1/images/edits");
  const decoded = await new Response(new Uint8Array(f.sent[1].raw), {
    headers: { "Content-Type": String(f.sent[1].headers["content-type"]) },
  }).formData();
  assert.equal(decoded.get("quality"), "high");
  assert.equal(decoded.get("size"), "1024x1024");
  assert.equal(decoded.get("n"), "1");
  assert.equal(decoded.get("model"), model);
  for (const patch of [
    { n: 2 },
    { model: "other" },
    { quality: "low" },
    { size: "512x512" },
    { output_format: "jpeg" },
    { headers: {} },
  ])
    await assert.rejects(
      internalAIRequest(f.c, {
        operation: "images.generate",
        model,
        body: { ...image, ...patch },
        authority: f.authority,
        signal: AbortSignal.timeout(5000),
      }),
      denied("AI_IMAGE_SPECIFICATION_CHANGED"),
    );
  form.append("image", new Blob(["second"], { type: "image/png" }));
  await assert.rejects(
    internalAIRequest(f.c, {
      operation: "images.edit",
      model,
      body: form,
      authority: f.authority,
      signal: AbortSignal.timeout(5000),
    }),
    denied("AI_IMAGE_SPECIFICATION_CHANGED"),
  );
  assert.equal(f.sent.length, 2);
});

test("invalid gateway settings, malformed scope and pre-dispatch denial fail closed without a provider call", async (t) => {
  const f = await fixture(t);
  const request = {
    operation: "responses" as const,
    model,
    reasoningEffort: "high",
    tools: ["lookup"],
    body: body(),
    authority: f.authority,
    signal: AbortSignal.timeout(5000),
  };
  for (const config of [
    { ...f.c, AI_BASE_URL: "ftp://127.0.0.1/v1" },
    { ...f.c, AI_BASE_URL: f.c.AI_BASE_URL + "?key=untrusted" },
    { ...f.c, AI_ALLOWED_HOSTS: "example.invalid" },
    { ...f.c, NODE_ENV: "production" as const },
  ])
    await assert.rejects(
      internalAIRequest(config, request),
      denied("AI_GATEWAY_NOT_ALLOWED"),
    );
  await assert.rejects(
    internalAIRequest(f.c, {
      ...request,
      authority: { ...f.authority, taskId: "bad\r\nscope" },
    }),
    denied("AI_REQUEST_SCOPE_INVALID"),
  );
  await assert.rejects(
    internalAIRequest(f.c, {
      ...request,
      authority: {
        ...f.authority,
        authorize: async () => {
          throw new Error("revoked");
        },
      },
    }),
    denied("AI_REQUEST_AUTHORIZATION_CHANGED"),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    internalAIRequest(f.c, { ...request, signal: controller.signal }),
    denied("AI_REQUEST_CANCELLED"),
  );
  assert.throws(
    () =>
      loadConfig({
        AI_BASE_URL: "ftp://127.0.0.1/v1",
        AI_ALLOWED_HOSTS: "127.0.0.1",
      }),
    /HTTP\(S\)/,
  );
  assert.throws(() => loadConfig({ AI_MAX_REQUESTS_PER_TURN: "0" }));
  assert.equal(f.sent.length, 0);
});
