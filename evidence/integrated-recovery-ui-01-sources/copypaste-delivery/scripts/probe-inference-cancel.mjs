import { createServer } from "node:http";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
import { loadConfig } from "../../copypaste-platform/src/config.ts";
import { CodexRuntimeAdapter, RuntimeFailure } from "../../copypaste-platform/src/runtime.ts";
import { listenLoopbackHTTP } from "../../copypaste-platform/src/loopback-http.ts";
import { removeOwnedUUIDDirectory } from "../../copypaste-platform/src/owned-directory-cleanup.ts";

const id = process.argv[2] ?? "01";
assert.match(id, /^\d{2}$/);
const base = path.resolve(".data/inference-cancel-probes"), fixture = randomUUID();
const workspace = path.join(base, fixture);
await mkdir(workspace, { recursive: true });
let calls = 0, failure, cleanup = false;
const provider = createServer((req, res) => { calls++; req.resume(); res.writeHead(503).end(); });
const port = await listenLoopbackHTTP(provider), controller = new AbortController();
try {
  const config = loadConfig({ ...process.env, NODE_ENV: "test", DEMO_MODE: "false", AI_BASE_URL: `http://127.0.0.1:${port}/v1`, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "owned-cancel-probe-key-not-a-provider-key", AI_MODEL: "owned-cancel-probe", AI_VERIFIED: "true" });
  try {
    await new CodexRuntimeAdapter(config).start({ taskId: randomUUID(), workspace, prompt: "Cancellation must precede any provider request", skills: [], tools: [], signal: controller.signal,
      onEvent: async (kind) => { if (kind === "runtime.thread") controller.abort(); },
    });
  } catch (error) { failure = error; }
} finally {
  provider.closeAllConnections();
  await new Promise((resolve, reject) => provider.close((error) => error ? reject(error) : resolve()));
  await removeOwnedUUIDDirectory(base, fixture);
  cleanup = true;
}
const result = { at: new Date().toISOString(), scope: "Actual pinned Codex cancelled immediately after thread creation, before turn/start or provider dispatch; owned fake provider and workspace only",
  provider_calls: calls, code: failure instanceof RuntimeFailure ? failure.code : "UNEXPECTED_FAILURE",
  accepted: failure instanceof RuntimeFailure ? failure.accepted : null,
  usage_known: failure instanceof RuntimeFailure ? failure.usageKnown : null,
  input_tokens: failure instanceof RuntimeFailure ? failure.inputTokens : null,
  output_tokens: failure instanceof RuntimeFailure ? failure.outputTokens : null,
  actual_fixture_cleanup: cleanup,
  runtime_source_sha256: createHash("sha256").update(await readFile(path.resolve("../copypaste-platform/src/runtime.ts"))).digest("hex"),
  verifier_sha256: createHash("sha256").update(await readFile(import.meta.filename)).digest("hex"),
};
await writeFile(`evidence/inference-request-cancel-probe-${id}.json`, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(result));
assert.equal(calls, 0);
assert.equal(result.accepted, false);
assert.equal(result.usage_known, true);
