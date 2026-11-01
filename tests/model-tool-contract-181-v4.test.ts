import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { cloudExecGrammar, cloudToolDeclarations } from "../src/cloud-tool-contract.js";
import { startScopedInferenceGateway, type AIRequestOutcome } from "../src/internal-ai-gateway.js";
import { listenLoopbackHTTP } from "../src/loopback-http.js";
import { CodexRuntimeAdapter } from "../src/runtime.js";
import { removeOwnedUUIDDirectory } from "../src/owned-directory-cleanup.js";

const model = "gpt-6-luna";
const registration = { name: "campaign_lookup", description: "Return an authorized campaign receipt.", inputSchema: {
  type: "object", properties: { campaign: { type: "string" } }, required: ["campaign"], additionalProperties: false,
} };
const exec = { type: "custom", name: "exec", description: "Native wrapper, not tool authority", format: {
  type: "grammar", syntax: "lark", definition: cloudExecGrammar,
} };
const body = () => ({ model, stream: true, reasoning: { effort: "high" }, input: [
  { type: "additional_tools", id: "tools_181", role: "developer", tools: [
    { type: "namespace", name: "functions", tools: [exec, { type: "function", name: "request_user_input" }] },
    { type: "namespace", name: "collaboration", tools: [{ type: "function", name: "spawn_agent" }] },
  ] }, { role: "user", content: "Fixed protocol fixture" },
] });
const frame = (type: string, value: any) => `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`;
const complete = (output: any[], n = 0) => frame("response.completed", { response: {
  id: "resp_181_" + n, object: "response", model, created_at: 1, status: "completed", output,
  usage: { input_tokens: 17, output_tokens: 5 },
} });

test("native additional_tools is scoped to trusted registrations; controls and foreign declarations cannot create authority", () => {
  const original = body(), wire = cloudToolDeclarations(original, [registration.name], [registration]);
  assert.equal(wire.programmatic, true);
  const input: any = wire.body.input;
  assert.deepEqual(input[0].tools.map((n: any) => n.name), ["functions"]);
  assert.deepEqual(input[0].tools[0].tools.map((n: any) => n.name), ["exec"]);
  assert.match(input[0].tools[0].tools[0].description, /campaign_lookup/);
  assert.doesNotMatch(input[0].tools[0].tools[0].description, /spawn_agent|exec_command/);
  assert.equal(original.input[0].tools?.length, 2, "Do not mutate native request/history");
  for (const tool of [{ ...exec, format: { type: "text" } }, { ...exec, name: "exec_command" },
    { type: "function", name: "campaign_lookup", parameters: { type: "object", properties: { injected: { type: "string" } } } }]) {
    const invalid = body(); (invalid.input[0] as any).tools = [{ type: "namespace", name: "functions", tools: [tool] }];
    assert.throws(() => cloudToolDeclarations(invalid, [registration.name], [registration]), /AI_TOOL_NOT_ALLOWED/);
  }
  assert.throws(() => cloudToolDeclarations(body(), [registration.name]), /AI_TOOL_NOT_ALLOWED/);
});

async function fixture(t: any, native = false) {
  const requests: any[] = [], outcomes: AIRequestOutcome[] = [], rejections: any[] = [];
  let frames = "";
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(Buffer.from(c));
    const sent = JSON.parse(Buffer.concat(chunks).toString()); requests.push(sent);
    if (native) {
      const index = requests.length, response = { id: "resp_181_" + index, object: "response", model, created_at: 1, status: "in_progress", output: [] };
      let output: any;
      if (index === 1) output = { id: "exec_181", type: "custom_tool_call", name: "exec", call_id: "call_181", input:
        'text({osAvailable:typeof tools.exec_command,delegationAvailable:typeof tools.spawn_agent}); text(await tools.campaign_lookup({campaign:"FIXTURE"}));' };
      else output = { id: "msg_181", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Campaign receipt delivered.", annotations: [] }] };
      frames = frame("response.created", { response }) + frame("response.output_item.added", { output_index: 0, item: { ...output, ...(index === 1 ? { input: "" } : { content: [] }) } });
      if (index === 1) frames += frame("response.custom_tool_call_input.delta", { output_index: 0, item_id: output.id, delta: output.input }) + frame("response.custom_tool_call_input.done", { output_index: 0, item_id: output.id, input: output.input });
      else frames += frame("response.output_text.delta", { output_index: 0, item_id: output.id, content_index: 0, delta: "Campaign receipt delivered." });
      frames += frame("response.output_item.done", { output_index: 0, item: output }) + complete([output], index);
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    // Exercise validation across transport chunk boundaries.
    for (let offset = 0; offset < frames.length; offset += 23) res.write(frames.slice(offset, offset + 23));
    res.end();
  });
  const port = await listenLoopbackHTTP(server), scopes: any[] = [];
  const c = loadConfig({ NODE_ENV: "test", AI_BASE_URL: `http://127.0.0.1:${port}/v1`, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: randomBytes(32).toString("hex"), AI_MODEL: model, AI_VERIFIED: "true", AI_REASONING_EFFORT: "high" });
  const authority = { taskId: randomUUID(), authorize: async () => {
    let finished = false;
    return { dispatch: async () => {}, finish: async (outcome: AIRequestOutcome) => { if (!finished) { finished = true; outcomes.push(outcome); } } };
  } };
  t.after(async () => { for (const scope of scopes) await scope.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); });
  return { c, requests, outcomes, rejections, authority, setFrames(value: string) { frames = value; }, async scope() {
    const s = await startScopedInferenceGateway(c, { model, reasoningEffort: "high", tools: [registration.name], cloudTools: [registration], authority, signal: t.signal, onRejected: async v => { rejections.push(v); } }); scopes.push(s); return s;
  } };
}
const issue = (s: any) => fetch(s.baseURL + "/responses", { method: "POST", headers: { Authorization: "Bearer " + s.credential, "Content-Type": "application/json" }, body: JSON.stringify(body()), signal: AbortSignal.timeout(5000) });

test("registered native V8 calls and input fragments pass unchanged with measured usage", async t => {
  const f = await fixture(t), s = await f.scope(), item = { id: "exec_safe", call_id: "call_safe", type: "custom_tool_call", name: "exec", input: 'text(await tools.campaign_lookup({campaign:"FIXTURE"}));' };
  const wire = frame("response.output_item.added", { item: { ...item, input: "" } }) + frame("response.custom_tool_call_input.delta", { item_id: item.id, delta: item.input }) + frame("response.custom_tool_call_input.done", { item_id: item.id, input: item.input }) + frame("response.output_item.done", { item }) + complete([item]);
  f.setFrames(wire); const result = await issue(s); assert.equal(result.status, 200); assert.equal(await result.text(), wire);
  assert.deepEqual(s.measuredUsage, { inputTokens: 17, outputTokens: 5, allResponsesKnown: true, responses: 1 });
  assert.equal(f.outcomes[0].state, "completed"); assert.equal(f.rejections.length, 0);
});

for (const variant of ["unregistered", "foreign namespace", "orphan delta", "rebound identity"])
  test(`${variant}: reject before unsafe frame and retain specific accounting cause`, async t => {
    const f = await fixture(t), s = await f.scope(), item = { id: "bound_181", call_id: "call_safe", type: "custom_tool_call", name: "exec", input: "" };
    let wire = frame("response.output_item.added", { item: { ...item, name: "apply_patch" } });
    if (variant === "foreign namespace") wire = frame("response.output_item.added", { item: { ...item, namespace: "foreign" } });
    if (variant === "orphan delta") wire = frame("response.custom_tool_call_input.delta", { item_id: "unbound", delta: "unsafe" });
    if (variant === "rebound identity") wire = frame("response.output_item.added", { item }) + frame("response.output_item.done", { item: { ...item, call_id: "another" } });
    f.setFrames(wire + complete([]));
    try { const response = await issue(s); const text = await response.text(); assert.doesNotMatch(text, /unsafe|apply_patch/); } catch (error: any) { assert.match(error.message, /terminated|abort|fetch/i); }
    assert.equal(f.rejections[0].code, "AI_TOOL_CALL_NOT_ALLOWED");
    assert.equal(f.outcomes[0].state, "unknown"); assert.equal((f.outcomes[0] as any).code, "AI_TOOL_CALL_NOT_ALLOWED");
    assert.equal(s.measuredUsage.allResponsesKnown, false);
  });

test("actual pinned Codex completes a business tool round trip through code mode; OS and delegation tools stay absent", { timeout: 60000 }, async t => {
  const f = await fixture(t, true), pin = JSON.parse(await readFile(path.resolve("../copypaste-desktop/contracts/local-codex-runtime.json"), "utf8"));
  const binary = await realpath(path.resolve("../copypaste-desktop/.data/runtime/windows-x64/codex.exe"));
  const parent = path.resolve(".data/test/model-tool-contract-181"), id = randomUUID(), workspace = path.join(parent, id); await mkdir(workspace, { recursive: true });
  let calls = 0; const events: any[] = [];
  try {
    const result = await new CodexRuntimeAdapter({ ...f.c, CODEX_BIN: binary, CODEX_VERSION: pin.runtime_version }).start({ taskId: f.authority.taskId, workspace, prompt: "Look up the authorized campaign and report its receipt.", skills: [], signal: t.signal, requestAuthority: f.authority, onEvent: async (kind, value) => { if (kind.startsWith("gateway") || kind === "runtime.rpc.failed") events.push({kind, ...value}); }, tools: [{ ...registration, run: async args => { assert.deepEqual(args, { campaign: "FIXTURE" }); calls++; return { campaign: "FIXTURE", receipt: "fixture_receipt_181" }; } }] });
    if (result.status !== "completed") t.diagnostic(JSON.stringify({result,events,requests:f.requests.map(b=>({tools:b.tools,inputTypes:b.input?.map((i:any)=>i.type)}))}));
    assert.equal(result.status, "completed"); assert.equal(result.usageKnown, true); assert.equal(calls, 1); assert.equal(result.text, "Campaign receipt delivered."); assert.equal(f.requests.length, 2);
    const returned = JSON.stringify(f.requests[1].input);
    assert.match(returned, /fixture_receipt_181/);
    assert.match(returned, /osAvailable[^a-z]+undefined/);
    assert.match(returned, /delegationAvailable[^a-z]+undefined/);
    assert.equal(result.inputTokens, 34); assert.equal(result.outputTokens, 10);
  } finally { await removeOwnedUUIDDirectory(parent, id, { retry: false }); }
});
