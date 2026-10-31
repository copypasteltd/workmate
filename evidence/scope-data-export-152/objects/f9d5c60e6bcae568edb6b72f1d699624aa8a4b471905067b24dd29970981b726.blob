import assert from "node:assert/strict";
import { chromium, _electron, type Page, type Browser, type ElectronApplication } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), attempt = process.argv[2], prefix = `evidence/scope-data-export-152/ui-${attempt}`, owned = process.env.COPYPASTE_BUSINESS_INPUTS_OWNED!;
assert.match(attempt ?? "", /^\d{2}$/);
const load = (file: string) => import(pathToFileURL(path.join(platform, file)).href), hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const { unzipSync } = createRequire(path.join(platform, "package.json"))("fflate");
const checks: string[] = [], screenshots: any[] = [], recordings: any[] = [], layouts: any[] = [], errors: string[] = [], diagnostics: any[] = [], downloads: any[] = [];
let isolated: any, system: any, browser: Browser | undefined, electron: ElectronApplication | undefined, recording: WorkmateRecording | undefined;
let browserClosed = false, desktopClosed = false, apiClosed = false, fixtureClosed = false, stage = "setup";
async function until(fn: () => Promise<any>, valid: (x: any) => boolean, label: string) { const end = Date.now() + 45000; for (;;) { const x = await fn(); if (valid(x)) return x; assert.ok(Date.now() < end, label); await new Promise(r => setTimeout(r, 100)); } }
function observe(p: Page) { p.setDefaultTimeout(25000); p.on("pageerror", e => errors.push(e.message)); p.on("response", async r => { if (r.status() >= 400 && r.url().includes("/v1/")) diagnostics.push({ path: new URL(r.url()).pathname, status: r.status(), body: (await r.text().catch(() => "")).slice(0, 1200) }); }); }
async function shot(client: string, p: Page, name: string) { screenshots.push(await saveWorkmateScreenshot(client, `scope-data-export-152-${attempt}`, name, await p.screenshot({ timeout: 15000 }), "Actual export preview/save with synthetic customer files and real HTTP/SQL. Browser capability fallback and native OS destination are controlled test inputs; responses and files are not mocked.", delivery)); }
async function stopRecording() { if (recording) { const r = recording; recording = undefined; recordings.push(await r.stop()); } }
async function login(p: Page, email: string) {
  await p.goto("http://localhost:4317/login"); await p.locator('input[name="email"]').fill(email);
  const [response] = await Promise.all([p.waitForResponse(r => new URL(r.url()).pathname === "/v1/auth/challenges"), p.locator('form button[type="submit"]').click()]); assert.equal(response.status(), 202);
  const c = await response.json(), mail = JSON.parse(await readFile(path.join(isolated.directory, "mailbox", c.challenge_id + ".json"), "utf8"));
  await p.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]); await p.locator('form button[type="submit"]').click();
}
async function context() {
  const c = await browser!.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await c.addInitScript(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light");
    // Exercise the shipped, bounded browser fallback without an unattended OS picker.
    Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true }); }); return c;
}
function verify(bytes: Buffer, expected: any[], client: string, destination: string) {
  const entries = unzipSync(bytes), text = (key: string) => Buffer.from(entries[key]).toString("utf8"), manifest = JSON.parse(text("manifest.json"));
  for (const line of text("SHA256SUMS").trim().split("\n")) { const [digest, name] = line.split("  "); assert.equal(hash(Buffer.from(entries[name])), digest); }
  for (const file of expected) { const row = manifest.files.find((r: any) => r.version_id === file.version.id); assert.ok(row); assert.deepEqual(Buffer.from(entries[row.path]), file.bytes); }
  assert.equal(manifest.versions, expected.length); assert.doesNotMatch(text("manifest.json"), /storage_key/);
  downloads.push({ client, file: path.relative(delivery, destination).replaceAll("\\", "/"), sha256: hash(bytes), versions: manifest.versions, audience: manifest.audience }); return manifest;
}
async function browserSave(p: Page, modal: any, client: string, files: any[]) {
  await modal.getByRole("checkbox").check(); const saved = p.waitForEvent("download");
  await modal.getByRole("button", { name: "Download data archive", exact: true }).click();
  const download = await saved, destination = path.join(owned, client + ".zip"); await download.saveAs(destination);
  await modal.getByRole("status").filter({ hasText: "Archive saved" }).waitFor(); verify(await readFile(destination), files, client, destination);
}
const timer = setTimeout(() => { errors.push("Focused scope export journey deadline"); void electron?.close(); void browser?.close(); }, 480000);
try {
  const [{ isolatedTestEnvironment }, { buildApp }, { loadConfig }, { saveAsset }] = await Promise.all([load("tests/native-test-environment.ts"), load("src/server.ts"), load("src/config.ts"), load("src/storage.ts")]);
  process.chdir(platform); isolated = await isolatedTestEnvironment(); system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", WORKER_ENABLED: "false", DEMO_MODE: "true", DEV_MAILBOX: "true", API_ORIGIN: "http://localhost:4310", WEB_ORIGIN: "http://localhost:4317", ADMIN_ORIGIN: "http://localhost:4318" }), { worker: false }); await system.app.listen({ host: "127.0.0.1", port: 4310 });
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true }); const customerContext = await context(), web = await customerContext.newPage(); observe(web);
  stage = "Actual customer OTP and onboarding"; const email = `export-owner-${randomUUID()}@example.invalid`; await login(web, email); await web.waitForURL("**/welcome");
  await web.locator('input[name="name"]').fill("CopyPaste Harbour Studio"); await web.locator('input[name="project_name"]').fill("Launch campaign");
  const [created] = await Promise.all([web.waitForResponse(r => new URL(r.url()).pathname === "/v1/tenants" && r.request().method() === "POST"), web.getByRole("button", { name: "Create workspace & continue", exact: true }).click()]); assert.equal(created.status(), 200);
  const workspace = await created.json(), tenant = workspace.tenant.id, project = workspace.project.id, owner = (await system.db.control.query("SELECT id FROM users WHERE email=$1", [email])).rows[0].id; await web.locator(".app-shell").waitFor();
  async function file(bytes: Buffer, existing?: any, privateFile = false) { const row = await system.db.tx((tx: any) => saveAsset(tx, system.storage, { tenant, project, user: owner, name: privateFile ? "Private campaign brief.txt" : "Campaign source.csv", mime: privateFile ? "text/plain" : "text/csv", bytes, ...(existing ? { asset: existing.id, expectedVersion: 1 } : {}), ...(privateFile ? { privateOwner: owner } : {}) }), tenant, false, owner); return { ...row, bytes }; }
  const first = await file(Buffer.from("campaign,spend\nHarbour,120\n")), second = await file(Buffer.from("campaign,spend\nHarbour,180\n"), first), personal = await file(Buffer.from("Owner private launch guidance"), undefined, true); checks.push("Actual customer email OTP and workspace onboarding, with two retained original CSV versions and a private file");
  stage = "Actual packaged Desktop native PKCE";
  electron = await _electron.launch({ executablePath: process.env.COPYPASTE_LOCAL_DESKTOP_CANDIDATE!, env: { ...process.env, COPYPASTE_USER_DATA: path.join(owned, "desktop") } }); const desktop = await electron.firstWindow(); observe(desktop); await desktop.waitForURL(/^file:/);
  await desktop.evaluate(({ tenant, project }) => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); localStorage.setItem("cp_tenant", tenant); localStorage.setItem("cp_project", project); }, { tenant, project }); await desktop.reload();
  await electron.evaluate(({ shell }: any) => { shell.openExternal = async (url: string) => { (globalThis as any).__scope152Auth = url; }; }); await desktop.getByRole("button", { name: "Sign in securely in your browser", exact: true }).click();
  const auth = await customerContext.newPage(); try { await auth.goto(await until(() => electron!.evaluate(() => (globalThis as any).__scope152Auth), Boolean, "Native authorization URL")); await auth.getByRole("link", { name: /Authorize & return|授權並返回應用/ }).click(); await desktop.locator(".app-shell").waitFor(); } finally { await auth.close(); }
  checks.push("Actual packaged frameless Desktop signs in through the customer browser and native PKCE");
  stage = "Web project archive preview and exact download"; await web.goto("http://localhost:4317/app/projects"); await web.locator(`[data-project-id="${project}"]`).getByRole("button", { name: "Export data", exact: true }).click(); let modal = web.getByRole("dialog"); await modal.getByRole("button", { name: "Refresh preview", exact: true }).waitFor();
  recording = new WorkmateRecording("web", "scope-export", `scope-data-export-152-${attempt}`, () => web.screenshot({ type: "jpeg", quality: 72, timeout: 15000 }), "Actual project preview and verified download through the shipped small-archive browser fallback", delivery); await recording.start(); await shot("web", web, "project-preview-en");
  await browserSave(web, modal, "web", [first, second, personal]); await shot("web", web, "project-saved-en"); await stopRecording(); checks.push("Web actual project preview, explicit scope acknowledgement and independently verified original/history/private file archive");
  stage = "Desktop workspace export through native save IPC"; await desktop.evaluate(() => { location.hash = "/app/projects"; }); await desktop.getByRole("button", { name: "Preview workspace export", exact: true }).click(); modal = desktop.getByRole("dialog"); await modal.getByRole("button", { name: "Refresh preview", exact: true }).waitFor();
  const nativeDestination = path.join(owned, "desktop.zip"); await electron.evaluate(({ dialog }: any, file: string) => { (globalThis as any).__scope152Saves = 0; dialog.showSaveDialog = async () => { (globalThis as any).__scope152Saves++; return { canceled: false, filePath: file }; }; }, nativeDestination);
  recording = new WorkmateRecording("desktop", "scope-export", `scope-data-export-152-${attempt}`, () => desktop.screenshot({ type: "jpeg", quality: 72, timeout: 15000 }), "Actual packaged Desktop preview, native authenticated save IPC and streamed bytes; OS destination is a controlled fixture", delivery); await recording.start(); await shot("desktop", desktop, "workspace-preview-en"); await modal.getByRole("checkbox").check(); await modal.getByRole("button", { name: "Download data archive", exact: true }).click(); await modal.getByRole("status").filter({ hasText: "Archive saved" }).waitFor(); verify(await readFile(nativeDestination), [first, second, personal], "desktop", nativeDestination); assert.equal(await electron.evaluate(() => (globalThis as any).__scope152Saves), 1); await shot("desktop", desktop, "workspace-saved-en"); await stopRecording();
  assert.equal(await electron.evaluate(({ BrowserWindow }: any) => BrowserWindow.getAllWindows()[0].isMenuBarVisible()), false);
  for (const width of [1360, 1000]) { await electron.evaluate(({ BrowserWindow }: any, w: number) => BrowserWindow.getAllWindows()[0].setSize(w, 960), width); const v = await desktop.evaluate(() => ({ width: innerWidth, no_horizontal_overflow: document.documentElement.scrollWidth <= innerWidth, rails_hidden: [...document.querySelectorAll(".sidebar,.main-content")].every(n => getComputedStyle(n).scrollbarWidth === "none") })); assert.ok(v.no_horizontal_overflow && v.rails_hidden); layouts.push({ client: "desktop", ...v }); }
  checks.push("Desktop actual workspace native streamed save preserves exact files, hidden native menu and no horizontal overflow");
  stage = "Scoped administrator recent MFA session"; const { historyAdmin } = await load("tests/admin-history-fixture.ts"), operator = await historyAdmin(system, project, system.catalog.admin.permissions.map((p: any) => p.key));
  const adminContext = await context(), cookie = operator.client.cookie.split("="); await adminContext.addCookies([{ name: cookie[0], value: cookie.slice(1).join("="), url: "http://localhost:4318", httpOnly: true, sameSite: "Lax" }]); const admin = await adminContext.newPage(); observe(admin); await admin.goto("http://localhost:4318/content");
  const panel = admin.locator("section").filter({ has: admin.getByRole("heading", { name: "Export shared scope data", exact: true }) }); await panel.getByLabel("Scope ID", { exact: true }).fill(project); await panel.getByRole("button", { name: "Preview export", exact: true }).click(); modal = admin.getByRole("dialog"); await modal.getByText("Export shared data under current admin permissions.", { exact: false }).waitFor(); checks.push("Administrator project-scoped export and independent body-read permissions use a recent real OTP/TOTP MFA session");
  stage = "Administrator shared-only archive"; recording = new WorkmateRecording("admin", "scope-export", `scope-data-export-152-${attempt}`, () => admin.screenshot({ type: "jpeg", quality: 72, timeout: 15000 }), "Actual scoped MFA Admin shared-data preview and independently verified download; no private impersonation", delivery); await recording.start(); await shot("admin", admin, "shared-preview-en"); await browserSave(admin, modal, "admin", [first, second]); await shot("admin", admin, "shared-saved-en"); await stopRecording(); checks.push("Admin actual shared-only archive excludes the customer's private file and verifies both retained CSV originals");
  for (const width of [1440, 390]) { await web.setViewportSize({ width, height: 1000 }); const v = await web.evaluate(() => ({ width: innerWidth, no_horizontal_overflow: document.documentElement.scrollWidth <= innerWidth })); assert.ok(v.no_horizontal_overflow); layouts.push({ client: "web", ...v }); }
} catch (e) { errors.push(stage + ": " + String(e)); } finally {
  clearTimeout(timer); try { await stopRecording(); } catch (e) { errors.push(String(e)); }
  if (electron) try { await electron.close(); desktopClosed = true; } catch (e) { errors.push(String(e)); }
  if (browser) try { await browser.close(); browserClosed = true; } catch (e) { errors.push(String(e)); }
  if (system) try { await system.app.close(); apiClosed = true; } catch (e) { errors.push(String(e)); }
  if (isolated) try { await isolated.cleanup(); fixtureClosed = true; } catch (e) { errors.push(String(e)); } process.chdir(delivery);
  const result = { at: new Date().toISOString(), status: !errors.length && checks.length === 6 && browserClosed && desktopClosed && apiClosed && fixtureClosed ? "passed" : "failed", checks, errors, diagnostics, screenshots, recordings, downloads, layouts, browser_closed: browserClosed, desktop_closed: desktopClosed, api_closed: apiClosed, fixture_closed: fixtureClosed, scope: "Focused actual Web/Desktop/Admin project/workspace archives with real auth, SQL and exact object bytes. Browser fallback capability and OS save destination are controlled fixtures. Large FileSystemAccess streaming, production, cross-OS and broad historical regression omitted; no model request." };
  await writeFile(prefix + "-journey.json", JSON.stringify(result, null, 2) + "\n", { flag: "wx" }); console.log(JSON.stringify({ status: result.status, checks: checks.length, errors })); process.exitCode = result.status === "passed" ? 0 : 1;
}
