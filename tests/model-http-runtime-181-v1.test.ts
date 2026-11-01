import { test, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { internalAIRequest } from "../src/internal-ai-gateway.js";
import { listenLoopbackHTTP } from "../src/loopback-http.js";

test("production inference accepts a resolved per-model public HTTP upstream; legacy HTTPS policy remains separate", async () => {
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    calls++;
    let wire = ""; for await (const c of req) wire += c;
    assert.equal(JSON.parse(wire).model, "fixture-181");
    assert.equal(req.headers.authorization, "Bearer fixture-only-181");
    res.writeHead(200, { "Content-Type": "application/json" }).end('{"accepted":true}');
  });
  const port = await listenLoopbackHTTP(server), request = http.request;
  const transport = mock.method(http, "request", (url: URL, options: any, callback: any) => {
    assert.equal(url.origin, "http://93.184.216.34:9841");
    return request(new URL(`http://127.0.0.1:${port}${url.pathname}`), { ...options, lookup: undefined }, callback);
  });
  try {
    const config = { ...loadConfig({ NODE_ENV: "test", AI_BASE_URL: "https://legacy.fixture.invalid/v1", AI_API_KEY: "fixture-only-181", AI_ALLOWED_HOSTS: "legacy.fixture.invalid" }), NODE_ENV: "production" as const,
      MODEL_CONNECTION_RESOLVER: async () => ({ id: randomUUID(), baseURL: "http://93.184.216.34:9841/v1", apiKey: "fixture-only-181", allowPrivateNetwork: false }) };
    const response = await internalAIRequest(config, { operation: "responses", model: "fixture-181", reasoningEffort: "high", tools: [], body: { model: "fixture-181", reasoning: { effort: "high" }, stream: true, input: [{ role: "user", content: "Fixed fixture" }] }, authority: { taskId: randomUUID(), authorize: async () => {} }, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { accepted: true }); assert.equal(calls, 1);
  } finally { transport.mock.restore(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});
