import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { createContext, runInContext } from "node:vm";
import path from "node:path";

const { build } = createRequire(path.resolve("../copypaste-desktop/package.json"))("esbuild");
async function fixture(handler: (req: IncomingMessage, res: ServerResponse) => void, client: string) {
  const server = createServer(handler);
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const entry = client === "desktop" ? "../copypaste-desktop/renderer/src/api.ts" : `../copypaste-${client}/src/api.ts`;
  const bundle = await build({ entryPoints: [entry], bundle: true, write: false, format: "iife", globalName: "apiModule", platform: "browser", define: { "import.meta.env.VITE_API_BASE": JSON.stringify(url) } });
  const store = new Map<string, string>();
  const window = new EventTarget();
  const context = createContext({ window, Event, Headers, Response, FormData, File, Blob, URL, DOMException, crypto, fetch,
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k),
      get length() { return store.size; }, key: (i: number) => [...store.keys()][i] ?? null }, console });
  runInContext(bundle.outputFiles[0].text, context);
  return { api: context.apiModule, window, close: async () => {
    server.closeAllConnections();
    await new Promise<void>((r, reject) => server.close(e => e ? reject(e) : r()));
  } };
}
for (const client of ["web", "desktop", "admin"]) {
  const protectedPath = client === "admin" ? "/v1/admin/me" : "/v1/me";
  const sessionEvent = client === "admin" ? "copypaste:admin-session-ended" : "copypaste:session-ended";
  test(`${client}: an actual HTML 401 clears the current session before parsing and emits its own audience event`, async () => {
    const f = await fixture((_req, res) => res.writeHead(401, { "Content-Type": "text/html" }).end("<h1>Private authentication proxy diagnostics</h1>"), client);
    try {
      let ended = 0;
      f.window.addEventListener(sessionEvent, () => ++ended);
      f.api.setCsrf("old-csrf");
      await assert.rejects(f.api.api(protectedPath), (error: any) => error.status === 401 && error.code === "AUTH_REQUIRED" && !error.message.includes("proxy"));
      assert.equal(f.api.csrfToken, ""); assert.equal(ended, 1);
    } finally { await f.close(); }
  });
  test(`${client}: a delayed old HTML 401 cannot clear a newer sign-in or its CSRF token`, async () => {
    let release!: () => void, entered!: () => void;
    const ready = new Promise<void>(r => entered = r);
    const f = await fixture((req, res) => {
      if (req.url === protectedPath) { release = () => res.writeHead(401).end("old unreadable response"); entered(); }
      else res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ csrf_token: "new-csrf" }));
    }, client);
    try {
      let ended = 0;
      f.window.addEventListener(sessionEvent, () => ++ended);
      const old = f.api.api(protectedPath);
      const rejected = assert.rejects(old, (error: any) => error.status === 409 && error.code === "SESSION_CHANGED");
      await ready;
      await f.api.api(client === "admin" ? "/v1/admin/auth/verify" : "/v1/auth/verify", { method: "POST", body: "{}" });
      release(); await rejected;
      assert.equal(f.api.csrfToken, "new-csrf"); assert.equal(ended, 0);
    } finally { await f.close(); }
  });
  test(`${client}: an unreadable successful write remains uncertain and retains the caller's exact request key`, async () => {
    const received: unknown[] = [];
    const f = await fixture((req, res) => {
      received.push([req.method, req.headers["idempotency-key"]]);
      res.writeHead(201, { "Content-Type": "text/html" }).end("committed but unreadable proxy output");
    }, client);
    try {
      await assert.rejects(f.api.post(client === "admin" ? "/v1/admin/support/sessions" : "/v1/support-grants", {}, "one-fixed-request-key"),
        (error: any) => error.code === "CLIENT_RESULT_UNCONFIRMED" && error.status === 0);
      assert.deepEqual(received, [["POST", "one-fixed-request-key"]]);
    } finally { await f.close(); }
  });
}
