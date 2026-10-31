import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import path from "node:path";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";

const fixture = JSON.parse(await readFile(process.argv[2], "utf8")), root = process.cwd();
const req = createRequire(path.resolve("../copypaste-platform/package.json")), pg = req("pg");
const sql = new pg.Client({ connectionString: fixture.database_url });
const checks: string[] = [], errors: string[] = [], screenshots: any[] = [], recordings: any[] = [];
let browser: Browser | undefined, recording: WorkmateRecording | undefined, closed = false;
const source = "Actual Web email OTP, SQL session revocation and real server SSE reset. Synthetic users and queued task; worker disabled, no model or provider. Not installed Desktop or Extension acceptance.";
async function stopRecording() { if (recording) { const r = recording; recording = undefined; recordings.push(await r.stop()); } }
try {
  await sql.connect();
  browser = await chromium.launch({ executablePath: path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe"), headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  await context.addInitScript(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); });
  const page = await context.newPage(); page.setDefaultTimeout(20000); page.on("pageerror", e => errors.push(e.message));
  const shot = async (name: string) => screenshots.push(await saveWorkmateScreenshot("web", "session-boundary-163-04", name, await page.screenshot(), source, root));
  async function login() {
    await page.locator('input[name="email"]').fill(fixture.email);
    const [challenge] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === "/v1/auth/challenges"), page.getByRole("button", { name: "Send sign-in code", exact: true }).click()]);
    assert.equal(challenge.status(), 202);
    const mail = JSON.parse(await readFile(path.join(fixture.mailbox, (await challenge.json()).challenge_id + ".json"), "utf8"));
    await page.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);
    await page.getByRole("button", { name: "Verify & continue", exact: true }).click();
    await page.locator(".app-shell").waitFor();
  }
  await page.goto("http://localhost:4317/login"); await login();
  checks.push("Actual email OTP signs the synthetic customer into its real SQL workspace");
  await page.evaluate(() => {
    const actualFetch = window.fetch.bind(window);
    (window as any).__sessionStreamFrames = "";
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await actualFetch(...args);
      const input = args[0], url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (/\/v1\/tasks\/[^/]+\/events$/.test(new URL(url, location.href).pathname) && response.ok && response.body) {
        const reader = response.clone().body!.getReader(), decoder = new TextDecoder();
        void (async () => { try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; (window as any).__sessionStreamFrames = ((window as any).__sessionStreamFrames + decoder.decode(chunk.value, { stream: true })).slice(-100000); } } catch { /* Preserve observed real frames when the client cancels. */ } finally { await reader.cancel().catch(() => {}); } })();
      }
      return response;
    };
  });
  const streamPromise = page.waitForResponse(r => new URL(r.url()).pathname === `/v1/tasks/${fixture.task}/events`);
  await page.evaluate((id: string) => { history.pushState({}, "", "/app/tasks/" + id); dispatchEvent(new PopStateEvent("popstate")); }, fixture.task);
  const stream = await streamPromise; assert.equal(stream.status(), 200); assert.match(stream.headers()["content-type"], /text\/event-stream/);
  await page.getByRole("heading", { name: "Synthetic campaign accounting", exact: true }).waitFor(); await shot("signed-in-live-task");
  const other401s: string[] = []; const observe401 = (r: any) => { if (r.status() === 401) other401s.push(new URL(r.url()).pathname); };
  page.on("response", observe401);
  recording = new WorkmateRecording("web", "session-revocation-to-signin", "session-boundary-163-04", () => page.screenshot({ type: "jpeg", quality: 72 }), source, root); await recording.start();
  const changed = await sql.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL RETURNING id", [fixture.user]); assert.ok(changed.rowCount > 0);
  await page.waitForFunction(() => /event: stream\.reset/.test((window as any).__sessionStreamFrames));
  const text = await page.evaluate(() => (window as any).__sessionStreamFrames); assert.match(text, /SESSION_EXPIRED|AUTH_REQUIRED/);
  await page.getByRole("button", { name: "Send sign-in code", exact: true }).waitFor(); assert.equal(await page.locator(".app-shell").count(), 0);
  page.off("response", observe401); assert.deepEqual(other401s, [], "SSE reset itself, rather than an unrelated401 request, clears the shell");
  await shot("revoked-stream-signin"); await stopRecording();
  checks.push("A real SQL revocation ends the live server SSE stream; its reset clears the actual customer shell before any other401 response");
  Object.assign(fixture, fixture.second);
  await login();
  await page.goto("http://localhost:4317/app/analytics"); await page.locator(".app-shell").waitFor();
  await page.waitForLoadState("networkidle");
  await page.route("**/v1/**", route => {
    const p = new URL(route.request().url()).pathname;
    return p === "/v1/dataset-imports" || p.startsWith("/v1/public/") || p.startsWith("/v1/catalog/") ? route.continue() : route.abort("blockedbyclient");
  });
  const import401s: string[] = [];
  const observeImport401 = (r: any) => { if (r.status() === 401) import401s.push(new URL(r.url()).pathname); };
  page.on("response", observeImport401);
  const changedAgain = await sql.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL RETURNING id", [fixture.user]); assert.ok(changedAgain.rowCount > 0);
  const result = await page.evaluate(async () => {
    const url = "/src/api.ts";
    const { post } = await import(url);
    try { await post("/v1/dataset-imports", {}); return "unexpected-success"; } catch (e: any) { return e.code; }
  });
  assert.equal(result, "AUTH_REQUIRED");
  page.off("response", observeImport401); assert.deepEqual(import401s, ["/v1/dataset-imports"]);
  await page.unroute("**/v1/**");
  await page.getByRole("button", { name: "Send sign-in code", exact: true }).waitFor(); assert.equal(await page.locator(".app-shell").count(), 0); await shot("independent-import-requires-signin");
  checks.push("The formerly omitted independent dataset-import endpoint returns a real server401 and removes the old workspace immediately");
  await context.close();
} catch (e) { errors.push(String(e)); }
finally {
  try { await stopRecording(); } catch (e) { errors.push("recording: " + String(e)); }
  if (browser) { try { await browser.close(); closed = true; } catch (e) { errors.push("browser close: " + String(e)); } }
  await sql.end(); await mkdir("evidence/session-boundary-163", { recursive: true });
  const status = !errors.length && checks.length === 3 && closed ? "passed" : "failed";
  await writeFile("evidence/session-boundary-163/ui-04.json", JSON.stringify({ at: new Date().toISOString(), status, checks, errors, screenshots, recordings, browser_closed: closed, verifier_sha256: createHash("sha256").update(await readFile(import.meta.filename)).digest("hex"), scope: source }, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status, checks: checks.length, errors })); assert.equal(status, "passed");
}
