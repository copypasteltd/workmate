import assert from "node:assert/strict";
import { chromium, _electron, type Page, type Browser, type ElectronApplication, type Route } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";

const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const prefix = `evidence/project-lifecycle-149/ui-${attempt}`, owned = process.env.COPYPASTE_BUSINESS_INPUTS_OWNED!;
const checks: string[] = [], screenshots: any[] = [], recordings: any[] = [], layouts: any[] = [], errors: string[] = [], diagnostics: any[] = [];
const load = (file: string) => import(pathToFileURL(path.join(platform, file)).href);
let isolated: any, system: any, browser: Browser | undefined, electron: ElectronApplication | undefined, recording: WorkmateRecording | undefined;
let browserClosed = false, desktopClosed = false, apiClosed = false, fixtureClosed = false, stage = "setup";
let releaseHeld: (() => void) | undefined;
async function until(fn: () => Promise<any>, valid: (v: any) => boolean, label: string) {
  const end = Date.now() + 45000;
  for (;;) { const v = await fn(); if (valid(v)) return v; assert.ok(Date.now() < end, label); await new Promise(r => setTimeout(r, 100)); }
}
async function stopRecording() { if (recording) { const r = recording; recording = undefined; recordings.push(await r.stop()); } }
async function shot(client: string, p: Page, name: string) {
  screenshots.push(await saveWorkmateScreenshot(client, `project-lifecycle-149-${attempt}`, name, await p.screenshot({ timeout: 15000 }),
    "Actual Web or packaged native Desktop; real OTP/PKCE, project archive-last and restore, synthetic company data, no model call", delivery));
}
function observe(p: Page) {
  p.setDefaultTimeout(25000);
  p.on("pageerror", e => errors.push(e.message));
  p.on("response", async r => { if (r.status() >= 400 && r.url().includes("/v1/")) diagnostics.push({ path: new URL(r.url()).pathname, status: r.status(), body: (await r.text().catch(() => "unreadable")).slice(0, 2000) }); });
}
const timer = setTimeout(() => { errors.push("Focused project journey deadline"); releaseHeld?.(); void electron?.close(); void browser?.close(); }, 480000);
try {
  const [{ isolatedTestEnvironment }, { buildApp }, { loadConfig }] = await Promise.all([
    load("tests/native-test-environment.ts"), load("src/server.ts"), load("src/config.ts"),
  ]);
  process.chdir(platform);
  isolated = await isolatedTestEnvironment();
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", WORKER_ENABLED: "false", DEMO_MODE: "true", DEV_MAILBOX: "true",
    API_ORIGIN: "http://localhost:4310", WEB_ORIGIN: "http://localhost:4317", ADMIN_ORIGIN: "http://localhost:4318" }), { worker: false });
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); });
  const web = await context.newPage(); observe(web);
  stage = "Actual Web OTP and new-workspace onboarding";
  const email = `project-journey-${randomUUID()}@example.invalid`;
  await web.goto("http://localhost:4317/login");
  await web.locator('input[name="email"]').fill(email);
  const [challengeResponse] = await Promise.all([
    web.waitForResponse(r => new URL(r.url()).pathname === "/v1/auth/challenges"),
    web.locator('form button[type="submit"]').click(),
  ]);
  assert.equal(challengeResponse.status(), 202);
  const challenge = await challengeResponse.json(), mail = JSON.parse(await readFile(path.join(isolated.directory, "mailbox", challenge.challenge_id + ".json"), "utf8"));
  await web.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);
  await web.locator('form button[type="submit"]').click();
  await web.waitForURL("**/welcome");
  await web.locator('input[name="name"]').fill("CopyPaste project studio");
  await web.locator('input[name="project_name"]').fill("Harbour launch");
  const [workspaceResponse] = await Promise.all([
    web.waitForResponse(r => new URL(r.url()).pathname === "/v1/tenants" && r.request().method() === "POST"),
    web.getByRole("button", { name: "Create workspace & continue", exact: true }).click(),
  ]);
  assert.equal(workspaceResponse.status(), 200);
  const workspace = await workspaceResponse.json(), tenant = workspace.tenant.id, project = workspace.project.id;
  await web.locator(".app-shell").waitFor();
  await until(() => web.getByRole("combobox", { name: "Current project", exact: true }).inputValue(), v => v === project, "Onboarded active project");
  checks.push("Actual Web email OTP, new company onboarding and initial active project selection");

  async function projectJourney(p: Page, client: string, delayedList: boolean) {
    stage = `${client}: edit, archive-last and restore`;
    if (client === "web") await p.goto("http://localhost:4317/app/projects");
    else await p.evaluate(() => { location.hash = "/app/projects"; });
    const card = p.locator(`[data-project-id="${project}"]`), selected = p.getByRole("combobox", { name: "Current project", exact: true });
    await card.waitFor();
    recording = new WorkmateRecording(client, "project-archive-restore", `project-lifecycle-149-${attempt}`,
      () => p.screenshot({ type: "jpeg", quality: 72, timeout: 15000 }),
      "Actual project metadata edit, explicit archive-last confirmation, retained management page and same-project restore; synthetic company data", delivery);
    await recording.start();
    await card.getByRole("button", { name: "Edit", exact: true }).click();
    let modal = p.getByRole("dialog");
    await modal.locator('input[name="name"]').fill(`Harbour ${client} launch`);
    await modal.locator('textarea[name="description"]').fill("A retained home for our campaign work.");
    await modal.getByRole("button", { name: "Save changes", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    await until(() => card.locator("h2").innerText(), v => v === `Harbour ${client} launch`, "Edited project name");

    let heldBody: string | undefined, heldStatus = 0, heldHeaders: Record<string, string> | undefined, oldRequest: any;
    const listURL = `**/v1/tenants/${tenant}/projects`;
    let delayedResponse: Promise<any> | undefined, handler: ((route: Route) => Promise<void>) | undefined;
    if (delayedList) {
      const gate = new Promise<void>(resolve => { releaseHeld = resolve; });
      let first = true;
      handler = async route => {
        if (!first || route.request().method() !== "GET") { await route.continue(); return; }
        first = false; oldRequest = route.request();
        const response = await route.fetch(); heldStatus = response.status(); heldHeaders = response.headers(); heldBody = await response.text();
        assert.equal(heldStatus, 200); assert.ok(JSON.parse(heldBody).items.some((p: any) => p.id === project));
        await gate;
        await route.fulfill({ status: heldStatus, headers: heldHeaders, body: heldBody });
      };
      await p.route(listURL, handler);
      await p.reload();
      await until(async () => !!heldBody, Boolean, "Captured real old active list");
      await card.waitFor();
      delayedResponse = p.waitForResponse(r => r.request() === oldRequest);
    }
    try {
      await card.getByRole("button", { name: "Archive", exact: true }).click(); modal = p.getByRole("dialog");
      await modal.getByRole("checkbox").check();
      await modal.getByRole("button", { name: "Confirm archive", exact: true }).click();
      await modal.waitFor({ state: "hidden" });
      await card.getByRole("button", { name: "Restore", exact: true }).waitFor();
      await until(() => selected.inputValue(), v => v === "", "Last active project removed from selection");
      assert.equal(await selected.locator("option").count(), 0);
      assert.equal((await system.db.control.query("SELECT archived FROM projects WHERE id=$1", [project])).rows[0].archived, true);
      if (delayedList) {
        releaseHeld!(); releaseHeld = undefined;
        await delayedResponse;
        await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        assert.equal(await selected.inputValue(), "", "Delayed pre-archive response cannot restore an archived selection");
        assert.equal(await selected.locator("option").count(), 0);
        checks.push("Actual delayed pre-archive active-list response cannot overwrite newer empty selection");
      }
      await shot(client, p, "last-project-archived-en");
      await card.getByRole("button", { name: "Restore", exact: true }).click(); modal = p.getByRole("dialog");
      await modal.getByRole("checkbox").check();
      await modal.getByRole("button", { name: "Confirm restore", exact: true }).click();
      await modal.waitFor({ state: "hidden" });
      await card.getByRole("button", { name: "Archive", exact: true }).waitFor();
      await until(() => selected.inputValue(), v => v === project, "Same project selected after restoration");
      const row = (await system.db.control.query("SELECT * FROM projects WHERE id=$1 AND tenant_id=$2", [project, tenant])).rows[0];
      assert.equal(row.archived, false); assert.equal(row.name, `Harbour ${client} launch`); assert.equal(row.description, "A retained home for our campaign work.");
      assert.equal(await p.evaluate(() => localStorage.getItem("cp_project")), project);
      await shot(client, p, "same-project-restored-en");
      checks.push(`${client}: edit, explicit archive-last, management still reachable, restore same ID and current selection with retained details`);
    } finally {
      releaseHeld?.(); releaseHeld = undefined;
      if (delayedResponse) await delayedResponse.catch(() => {});
      if (handler) await p.unroute(listURL, handler);
      await stopRecording();
    }
  }

  await projectJourney(web, "web", true);
  for (const width of [1440, 390]) {
    await web.setViewportSize({ width, height: 1000 });
    const v = await web.evaluate(() => ({ width: innerWidth, no_horizontal_overflow: document.documentElement.scrollWidth <= innerWidth }));
    assert.ok(v.no_horizontal_overflow); layouts.push({ client: "web", ...v });
  }
  stage = "Actual packaged Desktop native PKCE";
  electron = await _electron.launch({ executablePath: process.env.COPYPASTE_LOCAL_DESKTOP_CANDIDATE!, env: { ...process.env, COPYPASTE_USER_DATA: path.join(owned, "desktop") } });
  const desktop = await electron.firstWindow(); observe(desktop); await desktop.waitForURL(/^file:/);
  await desktop.evaluate(({ tenant, project }) => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); localStorage.setItem("cp_tenant", tenant); localStorage.setItem("cp_project", project); }, { tenant, project });
  await desktop.reload();
  await electron.evaluate(({ shell }: any) => { shell.openExternal = async (url: string) => { (globalThis as any).__project149Auth = url; }; });
  await desktop.getByRole("button", { name: "Sign in securely in your browser", exact: true }).click();
  const auth = await context.newPage();
  try {
    await auth.goto(await until(() => electron!.evaluate(() => (globalThis as any).__project149Auth), Boolean, "Native PKCE authorization URL"));
    await auth.getByRole("link", { name: /Authorize & return|授權並返回應用/ }).click();
    await desktop.locator(".app-shell").waitFor();
  } finally { await auth.close(); }
  checks.push("Actual packaged Windows Desktop authorization using the existing signed-in Web session and native PKCE");
  await projectJourney(desktop, "desktop", false);
  for (const width of [1360, 1000]) {
    await electron.evaluate(({ BrowserWindow }: any, w: number) => BrowserWindow.getAllWindows()[0].setSize(w, 960), width);
    const v = await desktop.evaluate(() => ({ width: innerWidth, no_horizontal_overflow: document.documentElement.scrollWidth <= innerWidth,
      rails_hidden: [...document.querySelectorAll(".sidebar,.main-content")].every(n => getComputedStyle(n).scrollbarWidth === "none") }));
    assert.ok(v.no_horizontal_overflow); assert.ok(v.rails_hidden); layouts.push({ client: "desktop", ...v });
  }
  assert.equal(await electron.evaluate(({ BrowserWindow }: any) => BrowserWindow.getAllWindows()[0].isMenuBarVisible()), false);
} catch (e) { errors.push(stage + ": " + String(e)); }
finally {
  clearTimeout(timer); releaseHeld?.();
  try { await stopRecording(); } catch (e) { errors.push(String(e)); }
  if (electron) try { await electron.close(); desktopClosed = true; } catch (e) { errors.push(String(e)); }
  if (browser) try { await browser.close(); browserClosed = true; } catch (e) { errors.push(String(e)); }
  if (system) try { await system.app.close(); apiClosed = true; } catch (e) { errors.push(String(e)); }
  if (isolated) try { await isolated.cleanup(); fixtureClosed = true; } catch (e) { errors.push(String(e)); }
  process.chdir(delivery);
  const result = { at: new Date().toISOString(), status: !errors.length && checks.length === 5 && browserClosed && desktopClosed && apiClosed && fixtureClosed ? "passed" : "failed",
    checks, errors, diagnostics, screenshots, recordings, layouts, browser_closed: browserClosed, desktop_closed: desktopClosed, api_closed: apiClosed, fixture_closed: fixtureClosed,
    scope: "Focused real Web OTP/onboarding, packaged frameless Desktop PKCE and project management. Delayed old active-list response is a real intercepted response. No model call, no aggregate deletion or whole-product acceptance; broad historical regression omitted." };
  await writeFile(path.join(delivery, prefix + "-journey.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: result.status, checks: checks.length, errors })); process.exitCode = result.status === "passed" ? 0 : 1;
}
