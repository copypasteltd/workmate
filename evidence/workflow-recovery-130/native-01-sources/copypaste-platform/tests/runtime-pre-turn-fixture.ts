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
export const binary = await realpath(process.env.COPYPASTE_RUNTIME_STARTUP_TEST_BIN
  ?? path.resolve("../copypaste-desktop/.data/runtime/windows-x64/codex.exe"));
assert.equal(createHash("sha256").update(await readFile(binary)).digest("hex"),
  process.env.COPYPASTE_RUNTIME_STARTUP_TEST_SHA256 ?? pin.windows_x64_sha256,
  "The test must use the actual locked native executable");
const version = process.env.COPYPASTE_RUNTIME_STARTUP_TEST_VERSION ?? pin.runtime_version;

export async function fixture(t: { signal: AbortSignal }, options: { tool?: boolean; hold?: boolean } = {}) {
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
