import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { ClientFailure, clientFetch, clientJson, clientFailureMessage } from "../../copypaste-web/src/client-failure.ts";

async function service(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number };
  return { url: `http://127.0.0.1:${address.port}`, close: async () => {
    server.closeAllConnections();
    await new Promise<void>((r, reject) => server.close(e => e ? reject(e) : r()));
  } };
}
test("a real committed HTTP write with a lost reply is uncertain and is never retried by the transport", async () => {
  const committed: string[] = [];
  const s = await service((req, res) => {
    let body = "";
    req.on("data", b => body += b);
    req.on("end", () => { committed.push(body); res.destroy(); });
  });
  try {
    await assert.rejects(clientFetch(s.url, { method: "POST", body: "one explicit operation" }), (error: unknown) => {
      assert.ok(error instanceof ClientFailure);
      assert.equal(error.code, "CLIENT_RESULT_UNCONFIRMED");
      assert.equal(error.status, 0);
      assert.equal(error.message.includes(s.url), false);
      return true;
    });
    assert.deepEqual(committed, ["one explicit operation"]);
  } finally { await s.close(); }
});
test("a real dropped read has a connection message without native/provider exception details", async () => {
  let calls = 0;
  const s = await service((_req, res) => { ++calls; res.destroy(); });
  try {
    await assert.rejects(clientFetch(s.url), (error: unknown) => error instanceof ClientFailure && error.code === "CLIENT_CONNECTION_UNAVAILABLE");
    assert.equal(calls, 1);
  } finally { await s.close(); }
});
test("actual HTML replies are unreadable reads and uncertain writes without exposing their contents", async () => {
  const s = await service((_req, res) => res.writeHead(200, { "Content-Type": "text/html" }).end("<h1>Private upstream diagnostic</h1>"));
  try {
    for (const method of ["GET", "POST"]) {
      const response = await clientFetch(s.url, { method });
      await assert.rejects(clientJson(response, method), (error: unknown) => {
        assert.ok(error instanceof ClientFailure);
        assert.equal(error.code, method === "GET" ? "CLIENT_RESPONSE_INVALID" : "CLIENT_RESULT_UNCONFIRMED");
        assert.equal(error.message.includes("Private upstream"), false);
        return true;
      });
    }
  } finally { await s.close(); }
});
test("a user-aborted real in-flight request preserves cancellation instead of becoming a retry error", async () => {
  let received!: () => void;
  const entered = new Promise<void>(r => received = r);
  const s = await service(() => received());
  const controller = new AbortController();
  try {
    const pending = clientFetch(s.url, { signal: controller.signal });
    await entered;
    const reason = new DOMException("The view was closed", "AbortError");
    controller.abort(reason);
    await assert.rejects(pending, error => error === reason);
  } finally { await s.close(); }
});
test("locale changes resolve the same uncertain operation to one language without a misleading generic retry hint", () => {
  const error = new ClientFailure("CLIENT_RESULT_UNCONFIRMED");
  assert.equal(clientFailureMessage(error, "en"), "Your request may have been received. Check its result before retrying.");
  assert.equal(clientFailureMessage(error, "zh-HK"), "申請可能已收到。請先查收結果，再決定是否重試。");
  assert.equal(clientFailureMessage({ code: "VERSION_CONFLICT", message: "specific conflict" }, "en"), null);
  assert.equal(clientFailureMessage({ code: "__proto__" }, "en"), null);
});
test("all independently delivered clients and native main process carry identical transport rules", async () => {
  const source = await readFile("../copypaste-web/src/client-failure.ts");
  for (const file of ["../copypaste-desktop/renderer/src/client-failure.ts", "../copypaste-desktop/src/client-failure.ts", "../copypaste-admin/src/client-failure.ts", "../copypaste-extension/src/client-failure.ts"])
    assert.deepEqual(await readFile(file), source, file);
});
