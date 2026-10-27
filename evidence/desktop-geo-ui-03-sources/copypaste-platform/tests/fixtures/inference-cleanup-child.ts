// Exit normally: process.exit() would conceal a leaked request timer or socket.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { setImmediate as nextTick } from "node:timers/promises";
import { loadConfig } from "../../src/config.js";
import { listenLoopbackHTTP } from "../../src/loopback-http.js";
import {
  internalAIRequest,
  startScopedInferenceGateway,
} from "../../src/internal-ai-gateway.js";

const mode = process.argv[2];
if (
  !["abort-unread-image", "cancel-image", "invalid-response-protocol"].includes(
    mode,
  )
)
  throw new Error("Unknown owned fixture");
const provider = createServer((req, res) => {
  req.resume();
  res
    .writeHead(200, { "content-type": "application/json" })
    .end(JSON.stringify({ data: [], fixture: true }));
});
const port = await listenLoopbackHTTP(provider);
const c = loadConfig({
  NODE_ENV: "test",
  AI_BASE_URL: `http://127.0.0.1:${port}/v1`,
  AI_ALLOWED_HOSTS: "127.0.0.1",
  AI_API_KEY: "owned-cleanup-fixture-key-not-a-provider-key",
  AI_MODEL: "owned-cleanup-fixture",
  AI_VERIFIED: "true",
  AI_REQUEST_TIMEOUT_MS: "180000",
  AI_STREAM_IDLE_TIMEOUT_MS: "60000",
});
const controller = new AbortController();
const authority = { taskId: randomUUID(), authorize: async () => {} };
try {
  if (mode === "invalid-response-protocol") {
    const scope = await startScopedInferenceGateway(c, {
      model: c.AI_MODEL!,
      reasoningEffort: "high",
      tools: [],
      authority,
      signal: controller.signal,
    });
    try {
      const response = await fetch(scope.baseURL + "/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${scope.credential}`,
        },
        body: JSON.stringify({
          model: c.AI_MODEL,
          reasoning: { effort: "high" },
          stream: true,
          input: "Owned fixture",
          tools: [],
        }),
      });
      if (
        response.status !== 502 ||
        (await response.json()).error.code !== "AI_RESPONSE_PROTOCOL_INVALID"
      )
        throw new Error("Protocol guard failed");
    } finally {
      await scope.close();
    }
  } else {
    const response = await internalAIRequest(c, {
      operation: "images.generate",
      model: c.AI_MODEL!,
      authority,
      signal: controller.signal,
      body: {
        model: c.AI_MODEL,
        prompt: "Owned fixture",
        n: 1,
        size: "1024x1024",
        quality: "high",
        output_format: "png",
      },
    });
    await nextTick();
    if (mode === "cancel-image") await response.body?.cancel();
    else controller.abort(); // Intentionally leave the queued body unread.
  }
} finally {
  provider.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    provider.close((error) => (error ? reject(error) : resolve())),
  );
}
process.stdout.write("owned inference resources closed\n");
