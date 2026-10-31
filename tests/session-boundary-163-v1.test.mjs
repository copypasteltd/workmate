import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";

const root = process.cwd();
const output = path.resolve(".data/session-fence-163/http-" + randomUUID());
await mkdir(output, { recursive: true });
function storage() {
  const values = new Map();
  return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k), key: n => [...values.keys()][n] ?? null, get length() { return values.size; } };
}
for (const component of ["web", "desktop", "admin"]) {
  await test(component + ": current HTTP identity and stale-response boundaries", async t => {
    let handler = (_req, res) => res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
    const server = createServer((req, res) => handler(req, res));
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = "http://127.0.0.1:" + server.address().port;
    const outfile = path.join(output, component + ".mjs");
    const repo = path.resolve("../copypaste-" + component);
    await build({ entryPoints: [path.join(repo, component === "desktop" ? "renderer/src/api.ts" : "src/api.ts")], outfile, bundle: true, platform: "node", format: "esm", define: { "import.meta.env.VITE_API_BASE": JSON.stringify(origin) } });
    const login = component === "admin" ? "/v1/admin/auth/verify" : "/v1/auth/sessions";
    const challenge = component === "admin" ? "/v1/admin/auth/challenge" : "/v1/auth/challenges";
    const event = component === "admin" ? "copypaste:admin-session-ended" : "copypaste:session-ended";
    async function fresh() {
      const win = new EventTarget(); let ended = 0;
      win.addEventListener(event, () => ++ended);
      globalThis.window = win;
      globalThis.localStorage = storage(); globalThis.sessionStorage = storage();
      const api = await import(pathToFileURL(outfile).href + "?instance=" + randomUUID());
      api.setCsrf("current-session-csrf");
      return { api, ended: () => ended };
    }
    const send = (res, status, body, html = false) => res.writeHead(status, { "Content-Type": html ? "text/html" : "application/json" }).end(html ? body : JSON.stringify(body));
    try {
      const business = component === "admin" ? ["/v1/admin/overview", "/v1/admin/users?page=2"] : ["/v1/dataset-imports", "/v1/reports", "/v1/evidence/00000000-0000-4000-8000-000000000001", "/v1/brand-version-options?project_id=00000000-0000-4000-8000-000000000002", "/v1/scope-deletions?page=1"];
      await t.test("HTML401 on every affected real business path ends the current shell without leaking the body", async () => {
        for (const endpoint of business) {
          const f = await fresh(); let calls = 0;
          handler = (req, res) => { ++calls; assert.equal(req.url, endpoint); send(res, 401, "<html>Private upstream diagnostics</html>", true); };
          await assert.rejects(f.api.api(endpoint, endpoint === "/v1/dataset-imports" ? { method: "POST", body: "{}" } : {}), e => e.status === 401 && e.code === "AUTH_REQUIRED" && !e.message.includes("Private upstream"));
          assert.equal(f.ended(), 1); assert.equal(f.api.csrfToken, ""); assert.equal(calls, 1);
        }
      });
      await t.test("a public sign-in or expired OAuth launch401 keeps the current identity", async () => {
        for (const endpoint of [challenge, ...(component === "admin" ? [] : ["/v1/connections/launch/" + "a".repeat(43), "/v1/public/config", "/v1/catalog/roles"])]) {
          const f = await fresh();
          handler = (_req, res) => send(res, 401, { error: { code: "INVALID_CODE", message: "Expired sign-in exchange" } });
          await assert.rejects(f.api.api(endpoint, endpoint === challenge ? { method: "POST", body: "{}" } : {}), e => e.status === 401 && e.code === "INVALID_CODE");
          assert.equal(f.ended(), 0); assert.equal(f.api.csrfToken, "current-session-csrf");
        }
      });
      for (const [kind, status, endpoint] of [["business success", 200, business[0]], ["business401", 401, business[0]], ["old challenge success", 200, challenge], ["old challenge401", 401, challenge], ["old login success", 200, login]]) {
        await t.test(kind + " cannot overwrite or clear a newer accepted sign-in", async () => {
          const f = await fresh(); let release, arrived; const entered = new Promise(r => arrived = r); let calls = 0;
          handler = (req, res) => {
            ++calls;
            if (calls === 1) { assert.equal(req.url, endpoint); release = () => send(res, status, status === 401 ? "<html>Old private failure</html>" : { csrf_token: "obsolete-csrf", private_result: "obsolete" }, status === 401); arrived(); }
            else { assert.equal(req.url, login); send(res, 200, { csrf_token: "new-session-csrf", user: { id: "new-synthetic-identity" } }); }
          };
          const pending = assert.rejects(f.api.api(endpoint, [login, challenge].includes(endpoint) || endpoint === "/v1/dataset-imports" ? { method: "POST", body: "{}" } : {}), e => e.code === "SESSION_CHANGED" && e.status === 409);
          await entered; await f.api.post(login, { synthetic: true }); const generation = f.api.clientSessionGeneration();
          release(); await pending;
          assert.equal(f.api.csrfToken, "new-session-csrf"); assert.equal(f.api.clientSessionGeneration(), generation); assert.equal(f.ended(), 0); assert.equal(calls, 2);
        });
      }
      await t.test("a denied business permission403 retains sign-in and its exact error", async () => {
        const f = await fresh(); handler = (_req, res) => send(res, 403, { error: { code: "ACCESS_DENIED", message: "No permission for this project" } });
        await assert.rejects(f.api.api(business[0]), e => e.code === "ACCESS_DENIED" && e.status === 403);
        assert.equal(f.ended(), 0); assert.equal(f.api.csrfToken, "current-session-csrf");
      });
      if (component === "desktop") await t.test("the actual renderer also fences a delayed native-bridge result", async () => {
        const f = await fresh(); let release;
        window.copyPasteBridge = { request: async () => new Promise(r => release = r) };
        const pending = assert.rejects(f.api.api("/v1/reports"), e => e.code === "SESSION_CHANGED");
        f.api.changeClientSession(); f.api.setCsrf("new-native-session");
        release({ status: 200, body: { csrf_token: "obsolete", private_result: "old-native-identity" } });
        await pending; assert.equal(f.api.csrfToken, "new-native-session"); assert.equal(f.ended(), 0);
      });
    } finally {
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
      delete globalThis.window; delete globalThis.localStorage; delete globalThis.sessionStorage;
    }
  });
}
