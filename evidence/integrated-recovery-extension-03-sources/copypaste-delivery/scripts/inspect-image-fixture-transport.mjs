import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

// Diagnostic only: actual loopback HTTP, no database, Codex or AI requests.
const attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const prefix = `evidence/image-fixture-transport-${attempt}`,
  source = await readFile(import.meta.filename),
  observations = [];
await writeFile(prefix + "-verifier.mjs", source, { flag: "wx" });
for (const connectionClose of [false, true]) {
  const usedPorts = new Set();
  for (let index = 0; index < 150; index++) {
    let calls = 0, errorCode = null;
    const server = createServer(async (request, response) => {
      for await (const _ of request) { /* Receive the complete POST. */ }
      calls++;
      response.writeHead(200, {
        "content-type": "application/json",
        ...(connectionClose ? { connection: "close" } : {}),
      }).end(JSON.stringify({ data: [{ b64_json: "A".repeat(8192) }] }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/images/generations`, {
        method: "POST", signal: AbortSignal.timeout(2000),
        headers: { "content-type": "application/json", "idempotency-key": randomUUID() },
        body: JSON.stringify({ model: "synthetic", n: 1, size: "1024x1024" }),
      });
      const reader = response.body.getReader();
      try { while (!(await reader.read()).done) { /* Same bounded-consumer lifecycle. */ } }
      finally { await reader.cancel(); }
    } catch (error) {
      errorCode = String(error.cause?.code ?? error.name);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    observations.push({ index, connection_close: connectionClose, port, reused_port: usedPorts.has(port), received_calls: calls, error_code: errorCode });
    usedPorts.add(port);
  }
}
const summary = [false, true].map((mode) => {
  const rows = observations.filter((row) => row.connection_close === mode);
  return { connection_close: mode, attempts: rows.length,
    reused_ports: rows.filter((row) => row.reused_port).length,
    failures: rows.filter((row) => row.error_code || row.received_calls !== 1).length };
});
await writeFile(prefix + ".json", JSON.stringify({
  at: new Date().toISOString(), status: "completed", node: process.version,
  scope: "Loopback transport diagnostic only; no product acceptance inference",
  verifier_sha256: createHash("sha256").update(source).digest("hex"), summary, observations,
}, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ summary }));
