import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createCompanyTransport } from "../src/company-transport.js";
import { clientFetch, ClientFailure, isConnectionFailure } from "../src/client-failure.js";
import { nativeExecutionRecords, nativeCommandSummary, nativeRecordFailed } from "../renderer/src/native-execution-state.js";

test("company transport confines credentials to its configured origin and forces isolated cookies and no redirects", async () => {
  let calls = 0;
  const send: typeof fetch = async (_input, init) => {
    ++calls; assert.equal(init?.credentials, "omit"); assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic"); return new Response("ok");
  };
  const transport = createCompanyTransport("https://company.example", send);
  await transport("https://company.example/v1/test", { headers: { Authorization: "Bearer synthetic" }, redirect: "follow", credentials: "include" });
  await transport(new Request("https://company.example/v1/test", { headers: { Authorization: "Bearer synthetic" } }));
  for (const url of ["https://foreign.example/test", "http://company.example/test", "https://user:pass@company.example/test", "https://company.example/test#secret"])
    await assert.rejects(transport(url), /COMPANY_REQUEST_DENIED/);
  await assert.rejects(transport("https://company.example/test", { headers: { Cookie: "session=synthetic" } }), /COMPANY_COOKIE_DENIED/);
  assert.equal(calls, 2);
});

test("Chromium read failures retry once; a received response, cancellation and uncertain writes are never replayed", async () => {
  for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
    let calls = 0;
    const send: typeof fetch = async () => { if (++calls === 1) throw Error("net::ERR_CONNECTION_RESET https://private.example/key"); return new Response("known"); };
    if (method === "GET") assert.equal(await (await clientFetch("https://company.example", { method }, send)).text(), "known");
    else await assert.rejects(clientFetch("https://company.example", { method, body: "one operation" }, send), (e: any) => e instanceof ClientFailure && e.code === "CLIENT_RESULT_UNCONFIRMED" && !e.message.includes("private.example"));
    assert.equal(calls, method === "GET" ? 2 : 1);
  }
  let calls = 0;
  const received: typeof fetch = async () => { ++calls; return new Response("no", { status: 503 }); };
  assert.equal((await clientFetch("https://company.example", {}, received)).status, 503); assert.equal(calls, 1);
  const abort = new AbortController(), reason = new DOMException("Closed", "AbortError"); abort.abort(reason);
  await assert.rejects(clientFetch("https://company.example", { signal: abort.signal }, async () => { throw reason; }), e => e === reason);
  assert.equal(isConnectionFailure(Error("net::ERR_CERT_AUTHORITY_INVALID")), false);
  assert.equal(isConnectionFailure(Error("net::ERR_ABORTED")), false);
});

test("real HTTP redirect cannot send the native token to a second company path", async () => {
  let redirected = 0;
  const server = createServer((request, response) => {
    if (request.url === "/redirect") response.writeHead(302, { Location: "/destination" }).end();
    else { ++redirected; response.end("must not be reached"); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  try {
    const company = createCompanyTransport(origin, fetch);
    await assert.rejects(company(origin + "/redirect", { headers: { Authorization: "Bearer synthetic" } }));
    assert.equal(redirected, 0);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("compact native records retain failure, bounded output and truncated streamed history", () => {
  const base = { workmate_task_id: "owned", turnId: "original" };
  const records = nativeExecutionRecords([
    { kind: "item/started", value: { ...base, item: { id: "cmd", type: "commandExecution", command: "a".repeat(5000) } } },
    { kind: "item/commandExecution/outputDelta", value: { ...base, itemId: "cmd", delta: "x".repeat(32768) } },
    { kind: "item/commandExecution/outputDelta", value: { ...base, itemId: "cmd", delta: "extra" } },
    { kind: "item/completed", value: { ...base, item: { id: "cmd", type: "commandExecution", exitCode: 9 } } },
  ], "owned");
  assert.equal(records.items.length, 1); const record = records.items[0];
  assert.equal(record.truncated, true); assert.equal(record.output?.length, 32768); assert.equal(record.command?.length, 4096);
  assert.equal(nativeRecordFailed(record), true); assert.equal(nativeCommandSummary(record.command!).length, 120);
  assert.equal(nativeCommandSummary(" echo\n  actual  "), "echo actual");
});
