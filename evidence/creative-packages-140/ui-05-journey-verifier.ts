import assert from "node:assert/strict";
import { chromium, _electron, type Browser, type BrowserContext, type ElectronApplication, type Page, type CDPSession } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { unzipSync } from "fflate";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";

const attempt = process.argv[2]; assert.match(attempt ?? "", /^\d{2}$/);
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), extension = path.resolve("../copypaste-extension"), prefix = `evidence/creative-packages-140/ui-${attempt}`;
const owned = process.env.COPYPASTE_BUSINESS_INPUTS_OWNED!, checks: string[] = [], screenshots: any[] = [], recordings: any[] = [], layouts: any[] = [], archives: any[] = [], errors: string[] = [], diagnostics: any[] = [];
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex"), load = (file: string) => import(pathToFileURL(path.join(platform, file)).href);
let isolated: any, system: any, browser: Browser | undefined, extensionContext: BrowserContext | undefined, electron: ElectronApplication | undefined,
  recording: WorkmateRecording | undefined, panel: any, browserClosed = false, extensionClosed = false, desktopClosed = false, apiClosed = false, fixtureClosed = false, failure: string | null = null, stage = "setup";
const pass = (name: string) => { checks.push(name); console.log("PASS: " + name); };
async function until(read: () => Promise<any>, valid: (v: any) => boolean, name: string, ms = 45000) { const end = Date.now() + ms;
  for (;;) { const value = await read(); if (valid(value)) return value; assert.ok(Date.now() < end, name); await new Promise(r => setTimeout(r, 120)); } }
async function shot(component: string, page: Page, name: string) { screenshots.push(await saveWorkmateScreenshot(component, `creative-packages-140-${attempt}`, name, await page.screenshot(), "Actual project package upload, verified restore and continued editing; synthetic business data, no AI generation", delivery)); }
async function stopRecording() { if (recording) { const active = recording; recording = undefined; recordings.push(await active.stop()); } }
async function attachTarget(parent: CDPSession, targetId: string) {
  const { sessionId } = await parent.send("Target.attachToTarget", { targetId, flatten: false }); let sequence = 0; const pending = new Map<number, any>();
  const receive = (event: any) => { if (event.sessionId !== sessionId) return; const m = JSON.parse(event.message), p = pending.get(m.id); if (!p) return;
    clearTimeout(p.timer); pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); };
  parent.on("Target.receivedMessageFromTarget", receive);
  return { send(method: string, params: any = {}): Promise<any> { const id = ++sequence; return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("Side Panel command timed out: " + method)); }, 20000); pending.set(id, { resolve, reject, timer });
    void parent.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
  }); }, async close() { parent.removeListener("Target.receivedMessageFromTarget", receive); for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error("Owned target closed")); } pending.clear(); await parent.send("Target.detachFromTarget", { sessionId }).catch(() => {}); } };
}
async function evaluate(expression: string) { const r = await panel.send("Runtime.evaluate", { expression, returnByValue: true, userGesture: true, awaitPromise: true }); assert.equal(r.exceptionDetails, undefined, JSON.stringify(r.exceptionDetails)); return r.result.value; }
try {
  await mkdir(owned, { recursive: true });
  const [{ isolatedTestEnvironment }, { buildApp }, { loadConfig }, fixtures, { saveAsset }, { createCanvas }, { advanceVideoProjects }] = await Promise.all([
    load("tests/native-test-environment.ts"), load("src/server.ts"), load("src/config.ts"), load("tests/admin-history-fixture.ts"), load("src/storage.ts"), load("node_modules/@napi-rs/canvas/index.js"), load("src/video-projects.ts")]);
  process.chdir(platform); isolated = await isolatedTestEnvironment();
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", WORKER_ENABLED: "false", DEMO_MODE: "true", DEV_MAILBOX: "true",
    API_ORIGIN: "http://localhost:4310", WEB_ORIGIN: "http://localhost:4317", ADMIN_ORIGIN: "http://localhost:4318" }), { worker: false });
  system.app.addHook("onError", async (req: any, _reply: any, error: Error) => diagnostics.push({ url: req.url, error: error.stack }));
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  const owner = await fixtures.historyLogin(system), workspace = await fixtures.historyOk(system, owner, "POST", "/v1/tenants", { name: "CopyPaste campaign studio", project_name: "Original creative source" });
  owner.tenant = workspace.tenant.id; const tenant = workspace.tenant.id, project = workspace.project.id;
  const target = await fixtures.historyOk(system, owner, "POST", `/v1/tenants/${tenant}/projects`, { name: "Restored campaign workspace" });
  const base = `/v1/tenants/${tenant}/projects/${project}`, destination = `/v1/tenants/${tenant}/projects/${target.id}`;
  const canvas = createCanvas(64, 64), ctx = canvas.getContext("2d"); ctx.fillStyle = "#b8c5cf"; ctx.fillRect(0, 0, 64, 64); ctx.fillStyle = "#15171a"; ctx.fillRect(15, 15, 34, 34);
  const media = await system.db.tx((tx: any) => saveAsset(tx, system.storage, { tenant, project, user: owner.id, name: "Campaign source.png", mime: "image/png", bytes: canvas.toBuffer("image/png") }), tenant, false, owner.id);
  const source = await fixtures.historyOk(system, owner, "POST", base + "/creative", { name: "Hong Kong launch poster", body: { width: 720, height: 900, background: "#f6f6f4", layers: [
    { type: "image", asset_id: media.id, version: 1, x: 48, y: 60, width: 624, height: 520 },
    { type: "text", text: "Make room for possibility.", x: 48, y: 690, font_size: 36, color: "#15171a", font_family: "sans", weight: "normal" },
    { type: "text", text: "COPYPASTE · HONG KONG", x: 48, y: 800, font_size: 20, color: "#15171a", font_family: "sans", weight: "normal" }] } });
  const video = await fixtures.historyOk(system, owner, "POST", base + "/video-projects", { name: "Hong Kong campaign film", definition: {
    schema_version: "copypaste-video-1", template: "campaign-cuts-1", locale: "en", width: 512, height: 768, frame_rate: { numerator: 30, denominator: 1 }, duration_frames: 90,
    script: { title: "A fresh start", brief: "Restore this campaign and continue editing.", narration: "Made for Hong Kong teams.", call_to_action: "Discover more" },
    brand: { label: "CopyPaste", background: "#f6f6f4", ink: "#15171a", accent: "#2458df", logo: null },
    storyboard: [{ key: "opening", start_frame: 0, end_frame: 90, direction: "Opening campaign", headline: "Make room.", body: "For what comes next.", image: { asset_id: media.id, version: 1 } }],
    subtitles: [{ key: "caption", start_frame: 0, end_frame: 90, text: "Made for Hong Kong teams." }], audio: null } });
  const inputFiles: Record<string, string> = {};
  for (const [kind, id] of [["canvas", source.id], ["video", video.id]]) { const raw = await system.app.inject({ method: "GET", url: `${base}/creative-project-packages/${id}?expected_version=1`, headers: { cookie: owner.cookie, "x-tenant-id": tenant } });
    assert.equal(raw.statusCode, 200, raw.body.slice(0, 200)); const file = path.join(owned, kind + ".zip"); await writeFile(file, raw.rawPayload, { flag: "wx" }); inputFiles[kind] = file;
    archives.push({ kind, purpose: "actual exported source package used for cross-project restore", path: path.relative(delivery, file).replaceAll("\\", "/"), sha256: sha(raw.rawPayload), files: Object.keys(unzipSync(raw.rawPayload)).length }); }
  async function login(page: Page, url: string) {
    await system.db.control.query("UPDATE auth_challenges SET created_at=clock_timestamp()-interval '2 minutes' WHERE email=$1", [owner.email]);
    await page.goto(url); await page.locator('input[name="email"]').fill(owner.email);
    const [response] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === "/v1/auth/challenges"), page.locator('form button[type="submit"]').click()]); assert.equal(response.status(), 202);
    const challenge = await response.json(), mail = JSON.parse(await readFile(path.join(isolated.directory, "mailbox", challenge.challenge_id + ".json"), "utf8"));
    await page.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]); await page.locator('form button[type="submit"]').click();
  }
  async function restoreUI(page: Page, file: string, name: string, component: string) {
    const region = page.getByRole("region", { name: "Project packages & restore", exact: true }); await region.waitFor();
    await region.getByRole("checkbox").first().check(); await region.locator('input[type="file"]').setInputFiles(file);
    await region.getByRole("button", { name: "Upload or resume", exact: true }).click(); await Promise.race([region.locator("[data-package-preview]").waitFor({ timeout: 60000 }), region.getByRole("alert").waitFor({ timeout: 60000 }).then(async () => { throw new Error(await region.getByRole("alert").innerText()); })]);
    await region.getByLabel("New project name", { exact: true }).fill(name); await region.getByRole("checkbox").nth(1).check();
    await region.locator("[data-package-preview]").scrollIntoViewIfNeeded(); await shot(component, page, "verified-restore-review-en");
    await region.getByRole("button", { name: "Restore a new project", exact: true }).click(); await region.locator("[data-package-restored]").waitFor();
    assert.match(await region.locator("[data-package-restored]").innerText(), new RegExp(name));
    return (await system.db.control.query("SELECT * FROM creative_projects WHERE project_id=$1 AND name=$2", [target.id, name])).rows[0];
  }
  stage = "Web restore and source editing";
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true }); const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, acceptDownloads: true });
  await context.addInitScript(({ tenant, project }) => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); localStorage.setItem("cp_tenant", tenant); localStorage.setItem("cp_project", project); }, { tenant, project: target.id });
  const web = await context.newPage(); web.on("pageerror", e => errors.push(e.message)); await login(web, "http://localhost:4317/login"); await web.waitForURL("**/app**"); await web.goto("http://localhost:4317/app/creative");
  recording = new WorkmateRecording("web", "project-restore", `creative-packages-140-${attempt}`, () => web.screenshot({ type: "jpeg", quality: 72 }), "Actual browser upload, package verification, restore, layer edit and real PNG render; synthetic business data", delivery); await recording.start();
  const webRestored = await restoreUI(web, inputFiles.canvas, "Web restored campaign", "web"); assert.ok(webRestored); assert.notEqual(webRestored.id, source.id);
  const card = web.locator("article.project-card").filter({ has: web.getByRole("heading", { name: "Web restored campaign", exact: true }) });
  await card.getByRole("button", { name: "Edit layered source", exact: true }).click(); const modal = web.getByRole("dialog");
  const text = modal.locator('textarea[name="source"]'), definition = JSON.parse(await text.inputValue()); definition.layers[1].text = "Restored. Edited. Ready."; await text.fill(JSON.stringify(definition));
  await modal.getByRole("button", { name: "Save new version", exact: true }).click(); await modal.waitFor({ state: "hidden" });
  await card.getByRole("button", { name: "PNG", exact: true }).click(); await card.locator(".design-export-result").waitFor(); await card.scrollIntoViewIfNeeded();
  const downloaded = web.waitForEvent("download"); await card.getByRole("button", { name: "Download export", exact: true }).click(); const png = await downloaded, pngFile = path.join(owned, "web-restored.png"); await png.saveAs(pngFile);
  assert.equal((await readFile(pngFile)).subarray(0, 8).toString("hex"), "89504e470d0a1a0a"); await shot("web", web, "restored-edited-rendered-en"); await stopRecording();
  pass("Web OTP login uploads and verifies a source ZIP, restores into a different project, edits layers and downloads an actual PNG");
  stage = "Frameless packaged Desktop restore and video editing";
  electron = await _electron.launch({ executablePath: process.env.COPYPASTE_LOCAL_DESKTOP_CANDIDATE!, env: { ...process.env, COPYPASTE_USER_DATA: path.join(owned, "desktop") } });
  const desktop = await electron.firstWindow(); desktop.on("pageerror", e => errors.push(e.message)); desktop.setDefaultTimeout(30000); await desktop.waitForURL(/^file:/);
  await desktop.evaluate(({ tenant, project }) => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); localStorage.setItem("cp_tenant", tenant); localStorage.setItem("cp_project", project); }, { tenant, project: target.id }); await desktop.reload();
  const savedZip = path.join(owned, "desktop-restored-project.zip");
  await electron.evaluate(({ shell, dialog }, file) => { shell.openExternal = async (url: string) => { (globalThis as any).__cp140Auth = url; }; dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, savedZip);
  await desktop.getByRole("button", { name: "Sign in securely in your browser", exact: true }).click();
  const authContext = await browser.newContext(); await authContext.addInitScript(() => localStorage.setItem("cp_locale", "en"));
  const auth = await authContext.newPage(); await login(auth, await until(() => electron!.evaluate(() => (globalThis as any).__cp140Auth), Boolean, "native PKCE link")); await auth.getByRole("link", { name: /Authorize & return|授權並返回應用/ }).click();
  await desktop.locator(".app-shell").waitFor(); await authContext.close(); await desktop.evaluate(() => { location.hash = "/app/creative"; });
  const nativeRestored = await restoreUI(desktop, inputFiles.video, "Desktop restored film", "desktop"); assert.equal(nativeRestored.kind, "video");
  const videoRegion = desktop.getByRole("region", { name: "Video production", exact: true }); await videoRegion.getByRole("combobox").first().selectOption(nativeRestored.id);
  await videoRegion.getByRole("button", { name: "Edit project", exact: true }).click(); const videoEditor = desktop.getByRole("dialog"); await videoEditor.getByLabel("Script title", { exact: true }).fill("Restored campaign. A fresh start.");
  await videoEditor.locator('button[type="submit"]').click(); await videoEditor.waitFor({ state: "hidden" });
  await videoRegion.getByRole("button", { name: /Render.*MP4|Render video/ }).click();
  await until(async () => (await system.db.control.query("SELECT * FROM video_renders WHERE video_id=$1", [nativeRestored.id])).rows[0], Boolean, "queued real render");
  assert.equal((await advanceVideoProjects(system.db, system.storage)).state, "succeeded");
  await until(async () => (await system.db.control.query("SELECT state FROM video_renders WHERE video_id=$1", [nativeRestored.id])).rows[0]?.state, v => v === "succeeded", "native MP4 render");
  await videoRegion.scrollIntoViewIfNeeded(); await shot("desktop", desktop, "restored-video-rerendered-en");
  const packageRegion = desktop.getByRole("region", { name: "Project packages & restore", exact: true }); await packageRegion.getByRole("combobox").selectOption(nativeRestored.id); await packageRegion.getByRole("button", { name: "Download complete project ZIP", exact: true }).click();
  const savedBytes = await until(async () => { try { return await readFile(savedZip); } catch { return null; } }, v => !!v?.length, "native dialog-selected ZIP download");
  assert.ok(unzipSync(savedBytes)["fonts/NotoSansTC-VF.ttf"]); archives.push({ kind: "video", purpose: "actual packaged Desktop export after restoring and editing", path: path.relative(delivery, savedZip).replaceAll("\\", "/"), sha256: sha(savedBytes), files: Object.keys(unzipSync(savedBytes)).length });
  for (const width of [1360, 960]) { await electron.evaluate(({ BrowserWindow }, width) => { BrowserWindow.getAllWindows()[0].setSize(width, 900); }, width);
    const layout = await desktop.evaluate(() => ({ width: innerWidth, no_horizontal_overflow: document.documentElement.scrollWidth <= innerWidth, rails_hidden: [...document.querySelectorAll(".sidebar,.main-content")].every(n => getComputedStyle(n).scrollbarWidth === "none") })); layouts.push({ client: "desktop", ...layout }); assert.ok(layout.no_horizontal_overflow); }
  assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarVisible()), false);
  pass("Actual frameless Windows package uses OTP/PKCE, restores full video sources and font, edits the script, renders MP4 and saves a new complete ZIP through a native dialog");
  await electron.close(); electron = undefined; desktopClosed = true;
  stage = "Actual Chrome native right SIDE_PANEL restore";
  const id = (await readFile(path.join(extension, "extension-id.txt"), "utf8")).trim();
  extensionContext = await chromium.launchPersistentContext(path.join(owned, "chrome"), { executablePath: process.env.CHROME_BIN, headless: false, viewport: null,
    args: ["--disable-gpu", "--window-size=1480,1080", "--enable-unsafe-extension-debugging", "--disable-extensions-except=" + path.join(extension, "dist"), "--load-extension=" + path.join(extension, "dist")] });
  const worker = extensionContext.serviceWorkers()[0] ?? await extensionContext.waitForEvent("serviceworker"); await worker.evaluate(() => chrome.storage.local.set({ locale: "en" }));
  const main = extensionContext.pages()[0]; await main.goto("http://localhost:4317/"); const width = await main.evaluate(() => innerWidth), tabs = extensionContext.pages().length, cdp = await extensionContext.browser()!.newBrowserCDPSession();
  const tab = (await cdp.send("Target.getTargets", { filter: [{}] })).targetInfos.find(t => t.type === "tab" && t.url.startsWith("http://localhost:4317")); assert.ok(tab);
  await until(() => worker.evaluate(() => chrome.sidePanel.getPanelBehavior()), v => v.openPanelOnActionClick, "toolbar binding"); await (cdp as any).send("Extensions.triggerAction", { id, targetId: tab.targetId });
  const native = await until(() => worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] })), v => v.length === 1, "actual native side panel");
  assert.equal((await worker.evaluate(() => chrome.sidePanel.getLayout())).side, "right"); await until(() => main.evaluate(() => innerWidth), v => v < width - 250, "right panel reduces page width"); assert.equal(extensionContext.pages().length, tabs);
  const nativeTarget = await until(async () => (await cdp.send("Target.getTargets", { filter: [{}] })).targetInfos.find(t => t.type === "page" && t.url === native[0].documentUrl), Boolean, "side panel target"); panel = await attachTarget(cdp, nativeTarget.targetId);
  await until(() => evaluate("document.querySelector('#sign-in') && !document.querySelector('#sign-in').disabled"), Boolean, "native sign-in control");
  await system.db.control.query("UPDATE auth_challenges SET created_at=clock_timestamp()-interval '2 minutes' WHERE email=$1", [owner.email]);
  const popupEvent = extensionContext.waitForEvent("page"); await evaluate("document.querySelector('#sign-in').click()"); const popup = await popupEvent;
  await login(popup, popup.url()); await popup.getByRole("link", { name: /Authorize & return|授權並返回應用/ }).click();
  await until(() => evaluate("!document.querySelector('#workspace').hidden"), Boolean, "side panel authenticated");
  await evaluate(`document.querySelector('#project').value=${JSON.stringify(target.id)};document.querySelector('#project').dispatchEvent(new Event('change',{bubbles:true}));`);
  await until(() => evaluate("!document.querySelector('#creative-package-workspace').hidden"), Boolean, "project packages loaded");
  await evaluate("document.querySelector('#workspace-tools').open=true;document.querySelector('#creative-package-workspace').open=true;document.querySelector('#creative-package-workspace .creative-package-consent input').click();");
  const panelDocument = await panel.send("DOM.getDocument"), input = await panel.send("DOM.querySelector", { nodeId: panelDocument.root.nodeId, selector: '#creative-package-workspace input[type="file"]' }); await panel.send("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [inputFiles.video] });
  await evaluate("document.querySelector('#creative-package-workspace .creative-package-panel>button:last-of-type').click()");
  await until(() => evaluate("!!document.querySelector('#creative-package-workspace [data-package-preview]')"), Boolean, "actual large archive part upload and inspection", 90000);
  await evaluate("document.querySelector('#creative-package-workspace [aria-label=\"New project name\"]').value='Extension restored film';document.querySelector('#creative-package-workspace [data-package-preview] input[type=checkbox]').click();document.querySelector('#creative-package-workspace [data-package-preview]').scrollIntoView({block:'start'});");
  screenshots.push(await saveWorkmateScreenshot("extension", `creative-packages-140-${attempt}`, "native-sidepanel-restore-review-en", Buffer.from((await panel.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })).data, "base64"), "Actual Chrome native right SIDE_PANEL verifies a multi-part video ZIP with source media and font", delivery));
  await evaluate("document.querySelector('#creative-package-workspace [data-package-preview] button').click()");
  await until(() => evaluate("document.querySelector('#creative-package-workspace [data-package-restored]')?.textContent"), v => typeof v === "string" && v.includes("Extension restored film"), "native side panel restore");
  const extensionRestored = (await system.db.control.query("SELECT * FROM creative_projects WHERE project_id=$1 AND name='Extension restored film'", [target.id])).rows[0]; assert.ok(extensionRestored);
  const layout = await evaluate("({width:innerWidth,no_horizontal_overflow:document.documentElement.scrollWidth<=innerWidth})"); assert.ok(layout.no_horizontal_overflow); layouts.push({ client: "extension_side_panel", ...layout });
  assert.equal((await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] }))).length, 1);
  pass("Toolbar opens the actual native right SIDE_PANEL, performs real PKCE login, uploads a video ZIP larger than chat-attachment limits in verified parts and restores it without opening a replacement app tab");
  await panel.close(); panel = undefined; await cdp.detach(); await extensionContext.close(); extensionContext = undefined; extensionClosed = true;
  const originals = (await system.db.control.query("SELECT id,version FROM creative_projects WHERE id=ANY($1::uuid[]) ORDER BY id", [[source.id, video.id]])).rows; assert.equal(originals.length, 2); assert.ok(originals.every((r: any) => r.version === 1));
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM current_ai_provider_requests WHERE tenant_id=$1", [tenant])).rows[0].n, 0);
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM creative_projects WHERE project_id=$1", [target.id])).rows[0].n, 3);
  pass("All three clients create one new target copy each; original versions stay intact and no model request or AI fee is created");
} catch (e) { failure = String(e); diagnostics.push({ stage, stack: (e as Error).stack }); }
finally {
  try { await stopRecording(); } catch (e) { failure ??= String(e); }
  if (panel) await panel.close().catch(() => {});
  if (electron) try { await electron.close(); desktopClosed = true; } catch (e) { failure ??= String(e); }
  if (extensionContext) try { await extensionContext.close(); extensionClosed = true; } catch (e) { failure ??= String(e); }
  if (browser) try { await browser.close(); browserClosed = true; } catch (e) { failure ??= String(e); }
  if (system) try { await system.app.close(); apiClosed = true; } catch (e) { failure ??= String(e); }
  if (isolated) try { await isolated.cleanup(); fixtureClosed = true; } catch (e) { failure ??= String(e); }
  process.chdir(delivery);
}
const passed = !failure && !errors.length && checks.length === 4 && screenshots.length === 5 && recordings.length === 1 && archives.length === 3 && layouts.length === 3
  && recordings.every(r => r.distinct_frames > 1 && r.skipped_capture_errors === 0) && browserClosed && extensionClosed && desktopClosed && apiClosed && fixtureClosed;
const report = { at: new Date().toISOString(), status: passed ? "passed" : "failed", stage, failure, checks, screenshots, recordings, layouts, archives, errors, diagnostics,
  browser_closed: browserClosed, extension_closed: extensionClosed, desktop_closed: desktopClosed, api_closed: apiClosed, fixture_closed: fixtureClosed,
  model_mode: "No model requests. Synthetic campaign assets; real OTP/PKCE, native PostgreSQL, source ZIP bytes, Web upload/edit/render, actual unsigned frameless Windows package, actual Chrome native SIDE_PANEL. Native save dialog destination is explicitly controlled." };
await writeFile(prefix + "-journey.json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" }); console.log(JSON.stringify({ status: report.status, checks: checks.length, stage, failure })); process.exitCode = passed ? 0 : 1;
