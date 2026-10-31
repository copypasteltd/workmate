import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { listenLoopbackHTTP } from "../src/loopback-http.js";
import { CodexRuntimeAdapter, RuntimeFailure, type RuntimeContext } from "../src/runtime.js";
import { captureInjectedReplies, injectNativeFrame, interceptNativeRPC, suspendOwnedNative, withOwnedNativeProcesses,
  type OwnedNativeProcess } from "./native-runtime-faults.js";

const pinFile = path.resolve("../copypaste-desktop/contracts/local-codex-runtime.json");
const pin = JSON.parse(await readFile(pinFile, "utf8"));
const binary = await realpath(process.env.COPYPASTE_RUNTIME_STARTUP_TEST_BIN
  ?? path.resolve("../copypaste-desktop/.data/runtime/windows-x64/codex.exe"));
assert.equal(createHash("sha256").update(await readFile(binary)).digest("hex"),
  process.env.COPYPASTE_RUNTIME_STARTUP_TEST_SHA256 ?? pin.windows_x64_sha256,
  "The test must use the actual locked native executable");
const version = process.env.COPYPASTE_RUNTIME_STARTUP_TEST_VERSION ?? pin.runtime_version;

async function fixture(t: { signal: AbortSignal }, options: { tool?: boolean; hold?: boolean } = {}) {
  const parent = path.resolve(".data/test/runtime-startup");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "case-"));
  const secret = "fixture-" + randomBytes(32).toString("hex");
  const events: { kind: string; body: any; at: number }[] = [];
  const calls: { authorized: boolean; model: string; tools: any[] }[] = [];
  let release!: () => void;
  const ready = options.hold ? new Promise<void>(resolve => { release = resolve; }) : Promise.resolve();
  let serverError: unknown;
  let toolCalls = 0;
  let providerObserved = () => {};
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      calls.push({ authorized: req.headers.authorization === "Bearer " + secret, model: body.model, tools: body.tools });
      assert.equal(req.url, "/v1/responses");
      assert.ok(calls.at(-1)!.authorized, "Only the fixture company gateway may receive this request");
      providerObserved();
      await ready;
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const response = { id: "resp_startup_" + calls.length, object: "response", model: "copypaste-startup-fixture",
        created_at: 1, status: "in_progress", output: [] };
      const emit = (type: string, data: any) => res.write("event: " + type + "\ndata: " + JSON.stringify({ type, ...data }) + "\n\n");
      emit("response.created", { response });
      let item: any;
      if (options.tool && calls.length === 1) {
        item = { id: "fc_startup", type: "function_call", name: "fixture_lookup", call_id: "call_startup_real",
          arguments: JSON.stringify({ fixture: "ok" }) };
        emit("response.output_item.added", { output_index: 0, item: { ...item, arguments: "" } });
        emit("response.function_call_arguments.delta", { output_index: 0, item_id: item.id, delta: item.arguments });
        emit("response.function_call_arguments.done", { output_index: 0, item_id: item.id, arguments: item.arguments });
      } else {
        item = { id: "msg_startup", type: "message", role: "assistant", status: "completed",
          content: [{ type: "output_text", text: "Startup fixture delivered.", annotations: [] }] };
        emit("response.output_item.added", { output_index: 0, item: { ...item, content: [] } });
        emit("response.content_part.added", { output_index: 0, item_id: item.id, content_index: 0,
          part: { type: "output_text", text: "", annotations: [] } });
        emit("response.output_text.delta", { output_index: 0, item_id: item.id, content_index: 0, delta: item.content[0].text });
        emit("response.output_text.done", { output_index: 0, item_id: item.id, content_index: 0, text: item.content[0].text });
      }
      emit("response.output_item.done", { output_index: 0, item });
      emit("response.completed", { response: { ...response, status: "completed", output: [item], usage: {
        input_tokens: 17, output_tokens: 5, total_tokens: 22, input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      } } });
      res.end();
    } catch (error) { serverError = error; res.destroy(); }
  });
  await listenLoopbackHTTP(server);
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const config = loadConfig({ ...process.env, NODE_ENV: "test", DEMO_MODE: "false", CODEX_BIN: binary, CODEX_VERSION: version,
    AI_BASE_URL: `http://127.0.0.1:${address.port}/v1`, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: secret,
    AI_MODEL: "copypaste-startup-fixture", AI_VERIFIED: "true", AI_REASONING_EFFORT: "medium" });
  const controller = new AbortController();
  const context: RuntimeContext = {
    taskId: randomUUID(), prompt: "Return the controlled startup fixture.", workspace: root, skills: [],
    signal: AbortSignal.any([t.signal, controller.signal]),
    onEvent: async (kind, body) => { events.push({ kind, body, at: Date.now() }); },
    tools: options.tool ? [{ name: "fixture_lookup", description: "Read the controlled test fixture.",
      inputSchema: { type: "object", properties: { fixture: { type: "string" } }, required: ["fixture"], additionalProperties: false },
      run: async (args) => { toolCalls++; assert.deepEqual(args, { fixture: "ok" }); return { actual_fixture: "ok" }; } }] : [],
  };
  return { root, config, context, calls, events, controller, toolCalls: () => toolCalls, release: () => release?.(),
    onProvider: (callback: () => void) => { providerObserved = callback; },
    close: async () => {
      release?.(); controller.abort(); server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      const absolute = await realpath(root), ownedParent = await realpath(parent);
      assert.equal(path.dirname(absolute), ownedParent, "Recursive cleanup must remain inside this test's private parent");
      await rm(absolute, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 });
      if (serverError) throw serverError;
    } };
}

for (const fault of ["connection", "timeout"] as const) {
  test(`an actual native ${fault} during initialize restarts once only after old cleanup and dispatches one model turn`,
    { timeout: fault === "timeout" ? 150000 : 60000 }, async t => {
      const f = await fixture(t);
      const seen: OwnedNativeProcess[] = [];
      const emit = f.context.onEvent;
      f.context.onEvent = async (kind, body) => {
        if (kind === "runtime.startup.retry") {
          assert.equal(seen.length, 1); assert.equal(seen[0].closed, true);
          assert.equal(f.calls.length, 0); assert.equal(f.toolCalls(), 0);
        }
        await emit(kind, body);
      };
      try {
        await withOwnedNativeProcesses(binary, f.root, (row, index) => {
          seen.push(row);
          if (index === 1) {
            if (fault === "timeout") suspendOwnedNative(row, binary);
            else row.child.kill("SIGKILL");
          } else { assert.equal(index, 2); assert.equal(seen[0].closed, true); }
        }, async owned => {
          const result = await new CodexRuntimeAdapter(f.config).start(f.context);
          assert.equal(result.status, "completed"); assert.equal(result.text, "Startup fixture delivered.");
          assert.equal(result.usageKnown, true); assert.equal(result.inputTokens, 17); assert.equal(result.outputTokens, 5);
          assert.equal(owned.length, 2); assert.ok(owned.every(row => row.closed)); assert.equal(f.calls.length, 1);
          assert.equal(f.events.filter(e => e.kind === "runtime.startup.retry").length, 1);
          assert.equal(f.events.filter(e => e.kind === "runtime.turn").length, 1);
          const diagnostic = f.events.find(e => e.kind === "runtime.rpc.failed")?.body;
          assert.equal(diagnostic?.method, "initialize"); assert.equal(diagnostic?.provider_requests, 0);
          assert.equal(diagnostic?.code, fault === "timeout" ? "CODEX_RPC_TIMEOUT" : "CODEX_CONNECTION_LOST");
          if (fault === "timeout") assert.ok(diagnostic.elapsed_ms >= 59000, "The production 60-second RPC deadline must actually expire");
          assert.deepEqual(Object.keys(diagnostic).sort(), ["attempt", "code", "elapsed_ms", "method", "provider_requests", "stderr_bytes", "stdout_bytes"]);
        });
      } finally { await f.close(); }
    });
}

test("a second initialization connection loss stops without an unbounded restart or provider request", { timeout: 60000 }, async t => {
  const f = await fixture(t);
  try {
    await withOwnedNativeProcesses(binary, f.root, row => { row.child.kill("SIGKILL"); }, async owned => {
      await assert.rejects(new CodexRuntimeAdapter(f.config).start(f.context),
        error => error instanceof RuntimeFailure && error.code === "CODEX_CONNECTION_LOST" && !error.accepted && error.usageKnown);
      assert.equal(owned.length, 2); assert.ok(owned.every(row => row.closed)); assert.equal(f.calls.length, 0);
      assert.equal(f.events.filter(e => e.kind === "runtime.startup.retry").length, 1);
    });
  } finally { await f.close(); }
});

test("cancellation after first native cleanup prevents a second startup", { timeout: 60000 }, async t => {
  const f = await fixture(t);
  const emit = f.context.onEvent;
  f.context.onEvent = async (kind, body) => { await emit(kind, body); if (kind === "runtime.phase" && body.phase === "closed") f.controller.abort(); };
  try {
    await withOwnedNativeProcesses(binary, f.root, row => { row.child.kill("SIGKILL"); }, async owned => {
      await assert.rejects(new CodexRuntimeAdapter(f.config).start(f.context),
        error => error instanceof RuntimeFailure && error.code === "CODEX_CANCELLED" && !error.accepted);
      assert.equal(owned.length, 1); assert.ok(owned[0].closed); assert.equal(f.calls.length, 0);
      assert.equal(f.events.filter(e => e.kind === "runtime.startup.retry").length, 0);
    });
  } finally { await f.close(); }
});

test("an explicit initialize rejection is not retried and never exposes native error content", { timeout: 60000 }, async t => {
  const f = await fixture(t);
  try {
    await withOwnedNativeProcesses(binary, f.root, row => {
      interceptNativeRPC(row, "initialize", (request, complete) => {
        complete(); queueMicrotask(() => injectNativeFrame(row,
          { id: request.id, error: { code: -32600, message: "PRIVATE_FIXTURE_CONTENT_MUST_NOT_ESCAPE" } }));
      });
    }, async owned => {
      await assert.rejects(new CodexRuntimeAdapter(f.config).start(f.context),
        error => error instanceof RuntimeFailure && error.code === "CODEX_RPC_REJECTED" && !error.accepted && error.usageKnown);
      assert.equal(owned.length, 1); assert.ok(owned[0].closed); assert.equal(f.calls.length, 0);
      assert.equal(f.events.filter(e => e.kind === "runtime.startup.retry").length, 0);
      assert.equal(f.events.find(e => e.kind === "runtime.rpc.failed")?.body.method, "initialize");
      assert.equal(JSON.stringify(f.events).includes("PRIVATE_FIXTURE_CONTENT"), false);
    });
  } finally { await f.close(); }
});

for (const phase of ["thread", "provider"] as const) test(`a connection lost after ${phase} admission never restarts native work`,
  { timeout: 60000 }, async t => {
    const f = await fixture(t, { hold: phase === "provider" });
    let native!: OwnedNativeProcess;
    const emit = f.context.onEvent;
    if (phase === "thread") f.context.onEvent = async (kind, body) => {
      await emit(kind, body); if (kind === "runtime.thread") native.child.kill("SIGKILL");
    };
    else f.onProvider(() => native.child.kill("SIGKILL"));
    try {
      await withOwnedNativeProcesses(binary, f.root, row => { native = row; }, async owned => {
        await assert.rejects(new CodexRuntimeAdapter(f.config).start(f.context), error => {
          assert.ok(error instanceof RuntimeFailure); assert.equal(error.code, "CODEX_CONNECTION_LOST");
          assert.equal(error.accepted, phase === "provider"); assert.equal(error.usageKnown, phase !== "provider");
          return true;
        });
        assert.equal(owned.length, 1); assert.ok(owned[0].closed);
        assert.equal(f.calls.length, phase === "provider" ? 1 : 0);
        assert.equal(f.events.filter(e => e.kind === "runtime.startup.retry").length, 0);
      });
    } finally { await f.close(); }
  });

test("an exhausted original task deadline cannot be reset by initialization recovery", { timeout: 60000 }, async t => {
  const f = await fixture(t), deadline = Date.now() + 15 * 60000;
  const emit = f.context.onEvent;
  f.context.onEvent = async (kind, body) => {
    await emit(kind, body);
    if (kind === "runtime.phase" && body.phase === "closed") t.mock.method(Date, "now", () => deadline + 1000);
  };
  try {
    await withOwnedNativeProcesses(binary, f.root, row => { row.child.kill("SIGKILL"); }, async owned => {
      await assert.rejects(new CodexRuntimeAdapter(f.config).start(f.context),
        error => error instanceof RuntimeFailure && error.code === "CODEX_CONNECTION_LOST" && !error.accepted);
      assert.equal(owned.length, 1); assert.ok(owned[0].closed); assert.equal(f.calls.length, 0);
      assert.equal(f.events.filter(e => e.kind === "runtime.startup.retry").length, 0);
    });
  } finally { t.mock.restoreAll(); await f.close(); }
});

test("failure to close the old native process forbids a second initialization", { timeout: 60000 }, async t => {
  const f = await fixture(t);
  let restore = () => {};
  try {
    await withOwnedNativeProcesses(binary, f.root, row => {
      const kill = row.child.kill, end = row.child.stdin.end;
      row.child.kill = () => false;
      row.child.stdin.end = (() => row.child.stdin) as typeof end;
      restore = () => { row.child.kill = kill; row.child.stdin.end = end; };
      interceptNativeRPC(row, "initialize", (_request, complete) => complete(new Error("Controlled owned pipe failure")));
    }, async owned => {
      try {
        await assert.rejects(new CodexRuntimeAdapter(f.config).start(f.context),
          error => error instanceof RuntimeFailure && error.code === "CODEX_CLEANUP_FAILED" && !error.accepted);
        assert.equal(owned.length, 1); assert.equal(owned[0].closed, false); assert.equal(f.calls.length, 0);
        assert.equal(f.events.filter(e => e.kind === "runtime.startup.retry").length, 0);
      } finally { restore(); }
    });
  } finally { restore(); await f.close(); }
});

test("initialization and foreign-turn protocol frames cannot invoke tools, pollute output or finish an actual native turn", { timeout: 90000 }, async t => {
  const f = await fixture(t, { tool: true, hold: true });
  let native!: OwnedNativeProcess;
  let replies: any[] = [];
  const emit = f.context.onEvent;
  const injectedCall = (name: string, scope: Record<string, unknown>) => ({ id: "copypaste_fixture_" + name, method: "item/tool/call",
    params: { threadId: "other-thread", turnId: "other-turn", callId: "call_" + name, tool: "fixture_lookup", arguments: { fixture: "ok" }, ...scope } });
  f.context.onEvent = async (kind, body) => {
    await emit(kind, body);
    if (kind === "runtime.phase" && body.phase === "initialize") injectNativeFrame(native, injectedCall("before_turn", {}));
    if (kind === "runtime.turn") {
      const scope = { threadId: body.thread_id, turnId: body.turn_id };
      for (const [name, fields] of [
        ["wrong_thread", { ...scope, threadId: "other-thread" }],
        ["wrong_turn", { ...scope, turnId: "other-turn" }],
        ["wrong_namespace", { ...scope, namespace: "unregistered" }],
        ["empty_call", { ...scope, callId: "" }],
      ] as const) injectNativeFrame(native, injectedCall(name, fields));
      for (const fields of [{ ...scope, threadId: "other-thread" }, { ...scope, turnId: "other-turn" }, { turnId: body.turn_id }]) {
        injectNativeFrame(native, { method: "item/agentMessage/delta", params: { ...fields, delta: "FOREIGN_OUTPUT" } });
        injectNativeFrame(native, { method: "turn/completed", params: { ...fields, turn: { id: fields.turnId, status: "completed" } } });
        injectNativeFrame(native, { method: "error", params: { ...fields, willRetry: false } });
      }
      injectNativeFrame(native, { method: "turn/completed", params: { ...scope, turn: { status: "completed" } } });
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(f.toolCalls(), 0);
      assert.equal(replies.length, 5); assert.ok(replies.every(reply => reply.result?.success === false));
      f.release();
    }
  };
  try {
    await withOwnedNativeProcesses(binary, f.root, row => { native = row; replies = captureInjectedReplies(row); }, async owned => {
      const result = await new CodexRuntimeAdapter(f.config).start(f.context);
      assert.equal(result.status, "completed"); assert.equal(result.text, "Startup fixture delivered.");
      assert.equal(f.toolCalls(), 1); assert.equal(f.calls.length, 2); assert.equal(owned.length, 1); assert.ok(owned[0].closed);
      assert.equal(f.events.some(e => e.kind === "message.delta" && String(e.body.text).includes("FOREIGN_OUTPUT")), false);
      assert.equal(f.events.filter(e => e.kind === "runtime.startup.retry").length, 0);
    });
  } finally { await f.close(); }
});
