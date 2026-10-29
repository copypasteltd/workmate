import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createConnection } from "node:net";
import { randomBytes, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";

const delivery = process.cwd(), platform = path.resolve("../copypaste-platform-publication-125"), attempt = process.argv[2];
assert.equal(path.basename(delivery), "copypaste-delivery");
assert.match(attempt ?? "", /^\d{2}$/);
const prefix = path.join(delivery, "evidence/publication-consent-" + attempt);
await assert.rejects(readFile(prefix + ".json"), error => (error as NodeJS.ErrnoException).code === "ENOENT");
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const sourceFiles: Record<string, string> = {};
for (const name of ["src/publication-fixture.ts", "src/publication-provider.ts", "src/config.ts"]) {
  const bytes = await readFile(path.join(platform, name));
  sourceFiles["copypaste-platform/" + name] = sha(bytes);
  const target = path.join(prefix + "-sources", name);
  await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: "wx" });
}
const verifierBytes = await readFile(import.meta.filename);
await writeFile(prefix + "-verifier.ts", verifierBytes, { flag: "wx" });
const load = (name: string) => import(pathToFileURL(path.join(platform, name)).href);
const servers: Server[] = [], ports: number[] = [], checks: string[] = [], errors: string[] = [], requests: unknown[] = [];
let browser: Browser | undefined, fixture: any, browserClosed = false, fixtureClosed = false;
let callbackRequests = 0, webLandings = 0, hostilePosts = 0, stage = "setup";
async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as AddressInfo).port; ports.push(port);
  return `http://localhost:${port}`;
}
try {
  const [{ startPublicationFixture }, { loadConfig }, { publicationAuthorizationURL }] = await Promise.all([
    load("src/publication-fixture.ts"), load("src/config.ts"), load("src/publication-provider.ts"),
  ]);
  const allowed = new Map<string, string>();
  const web = await listen(createServer((req, res) => {
    const u = new URL(req.url!, "http://localhost");
    if (u.pathname === "/app/publications") webLandings++;
    res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
    res.end("<!doctype html><title>Owned publishing landing</title><h1>Publishing workspace</h1>");
  }));
  const api = await listen(createServer((req, res) => {
    const u = new URL(req.url!, "http://localhost");
    if (u.pathname !== "/v1/publication/callback" || !allowed.has(u.searchParams.get("state") ?? "")) {
      res.writeHead(400); res.end(); return;
    }
    callbackRequests++;
    const approved = allowed.get(u.searchParams.get("state")!) === "approve";
    if (approved !== !!u.searchParams.get("code") || !approved && u.searchParams.get("error") !== "access_denied") {
      res.writeHead(400); res.end(); return;
    }
    res.writeHead(302, { location: web + "/app/publications?publication=" + (approved ? "connected" : "denied"),
      "cache-control": "no-store", "referrer-policy": "no-referrer" }); res.end();
  }));
  const hostile = await listen(createServer((req, res) => {
    if (req.method === "POST") hostilePosts++;
    res.writeHead(200); res.end("This owned negative-test destination must not receive a form POST");
  }));
  fixture = await startPublicationFixture(loadConfig({ NODE_ENV: "test", DEMO_MODE: "true", HOST: "127.0.0.1",
    API_ORIGIN: api, WEB_ORIGIN: web, ADMIN_ORIGIN: web }));
  ports.push(Number(new URL(fixture.origin).port));
  browser = await chromium.launch({ executablePath: path.join(delivery, ".data/browsers/chromium-1248/chrome-win64/chrome.exe"), headless: true });
  const page = await browser.newPage(); page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => {
    const u = new URL(response.url());
    if (["/approve", "/v1/publication/callback", "/app/publications"].includes(u.pathname))
      requests.push({ origin: u.origin, pathname: u.pathname, status: response.status() });
  });
  for (const decision of ["approve", "deny"]) {
    stage = "actual form " + decision + " and two-origin redirect chain";
    const state = randomBytes(32).toString("base64url"); allowed.set(state, decision);
    await page.goto(publicationAuthorizationURL(fixture.config, state));
    await Promise.all([
      page.waitForURL(url => url.origin === web && url.pathname === "/app/publications" &&
        url.searchParams.get("publication") === (decision === "approve" ? "connected" : "denied")),
      page.getByRole("button", { name: decision === "approve" ? "授權模擬帳戶" : "取消", exact: true }).click(),
    ]);
    checks.push(stage);
  }
  stage = "unconfigured form destination remains blocked by the actual browser";
  await page.goto(publicationAuthorizationURL(fixture.config, randomBytes(32).toString("base64url")));
  await page.locator("form").evaluate((node, target) => { (node as HTMLFormElement).action = target; }, hostile + "/accept");
  await Promise.all([
    page.waitForEvent("console", { predicate: message => message.type() === "error" && message.text().includes("form-action") }),
    page.getByRole("button", { name: "授權模擬帳戶", exact: true }).click({ noWaitAfter: true }),
  ]);
  assert.equal(hostilePosts, 0); assert.equal(new URL(page.url()).origin, fixture.origin);
  checks.push(stage);
  assert.equal(callbackRequests, 2); assert.equal(webLandings, 2); assert.equal(errors.length, 0);
} catch (error) { errors.push(stage + ": " + String(error)); process.exitCode = 1; }
finally {
  if (browser) { await browser.close(); browserClosed = true; }
  if (fixture) { await fixture.close(); fixtureClosed = true; }
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  const portsClosed: Record<number, boolean> = {};
  for (const port of ports) portsClosed[port] = await new Promise<boolean>(resolve => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(false); }); socket.once("error", () => resolve(true));
  });
  let unchanged = true;
  for (const [name, expected] of Object.entries(sourceFiles))
    if (sha(await readFile(path.join(platform, name.slice("copypaste-platform/".length)))) !== expected) unchanged = false;
  const passed = !errors.length && checks.length === 3 && unchanged && browserClosed && fixtureClosed && Object.values(portsClosed).every(Boolean);
  const report = { at: new Date().toISOString(), status: passed ? "passed" : "failed", stage, checks, errors, requests,
    callback_requests: callbackRequests, web_landings: webLandings, hostile_posts: hostilePosts, source_files: sourceFiles,
    source_unchanged: unchanged, browser_closed: browserClosed, fixture_closed: fixtureClosed, ports_closed: portsClosed,
    verifier_sha256: sha(verifierBytes),
    limits: ["Actual browser and synthetic consent provider with owned callback/landing servers; no database, live account or full publishing acceptance"] };
  await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(report, null, 2)); if (!passed) process.exitCode = 1;
}
