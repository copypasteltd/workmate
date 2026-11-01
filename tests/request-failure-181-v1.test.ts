import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { listenLoopbackHTTP } from "../src/loopback-http.js";
import { internalAIRequest, startScopedInferenceGateway, type AIRequestAuthority, type AIRequestOutcome } from "../src/internal-ai-gateway.js";

for (const kind of ["input count", "response protocol"])
  test(`${kind}: retain the real failure before cancelling an unread response`, async t => {
    const outcomes: AIRequestOutcome[] = [], paths: string[] = [];
    const server = createServer(async (req, res) => {
      paths.push(req.url!); for await (const _ of req) { /* consume fixture */ }
      res.writeHead(kind === "input count" ? 400 : 200, { "Content-Type": "application/json" }).end('{"error":"fixed fixture"}');
    });
    const port = await listenLoopbackHTTP(server);
    const c = loadConfig({ NODE_ENV: "test", AI_BASE_URL: `http://127.0.0.1:${port}/v1`, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "fixture-only-181", AI_MODEL: "fixture-181", AI_REASONING_EFFORT: "high" });
    const authority: AIRequestAuthority = { taskId: randomUUID(), actorId: randomUUID(), ...(kind === "input count" ? { budgeted: true as const } : {}), authorize: async () => {
      let done = false; return { requestId: randomUUID(), dispatch: async () => {}, finish: async outcome => { if (!done) { done = true; outcomes.push(outcome); } } };
    } };
    t.after(async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); });
    const body = { model: "fixture-181", reasoning: { effort: "high" }, stream: true, tools: [], input: [{ role: "user", content: "Fixed fixture" }] };
    if (kind === "input count") {
      await assert.rejects(internalAIRequest(c, { operation: "responses", model: "fixture-181", reasoningEffort: "high", tools: [], body, authority, signal: t.signal }), (e: any) => e.code === "AI_INPUT_COUNT_FAILED");
      assert.deepEqual(paths, ["/v1/responses/input_tokens"]);
    } else {
      const scope = await startScopedInferenceGateway(c, { model: "fixture-181", reasoningEffort: "high", tools: [], authority, signal: t.signal });
      try {
        const response = await fetch(scope.baseURL + "/responses", { method: "POST", headers: { Authorization: "Bearer " + scope.credential, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: t.signal });
        assert.equal(response.status, 502); assert.equal((await response.json()).error.code, "AI_RESPONSE_PROTOCOL_INVALID");
      } finally { await scope.close(); }
    }
    assert.equal(outcomes[0].state, "unknown");
    assert.equal((outcomes[0] as any).code, kind === "input count" ? "AI_INPUT_COUNT_FAILED" : "AI_RESPONSE_PROTOCOL_INVALID");
  });
