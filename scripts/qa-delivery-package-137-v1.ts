import assert from "node:assert/strict";
import { chromium, _electron, type Browser, type BrowserContext, type Page, type ElectronApplication, type CDPSession } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { unzipSync } from "fflate";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";

const attempt = process.argv[2]; assert.match(attempt ?? "", /^\d{2}$/);
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), prefix = `evidence/delivery-package-137/ui-${attempt}`;
const owned = process.env.COPYPASTE_BUSINESS_INPUTS_OWNED!, load = (name: string) => import(pathToFileURL(path.join(platform, name)).href);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const checks: string[] = [], screenshots: any[] = [], recordings: any[] = [], layouts: any[] = [], errors: string[] = [], archives: any[] = [], diagnostics: any[] = [];
let isolated: any, system: any, browser: Browser | undefined, extensionContext: BrowserContext | undefined, electron: ElectronApplication | undefined, recording: WorkmateRecording | undefined;
let stage = "setup", failure: string | null = null, browserClosed = false, extensionClosed = false, desktopClosed = false, apiClosed = false, fixtureClosed = false;
const pass = (name: string) => { checks.push(name); console.log("PASS: " + name); };
async function until(read: () => Promise<any>, valid: (v: any) => boolean, label: string, ms = 30000) { const end = Date.now() + ms; for (;;) { const value = await read(); if (valid(value)) return value; assert.ok(Date.now() < end, label); await new Promise(r => setTimeout(r, 100)); } }
async function stopRecording() { if (recording) { const r = recording; recording = undefined; recordings.push(await r.stop()); } }
async function shot(client: string, page: Page, name: string) { screenshots.push(await saveWorkmateScreenshot(client, `delivery-package-137-${attempt}`, name, await page.screenshot(), "Actual fixed-version delivery download with synthetic campaign content", delivery)); }
async function validateArchive(client: string, file: string, task: string) {
  const bytes = await readFile(file), entries = unzipSync(bytes), manifest = JSON.parse(Buffer.from(entries["manifest.json"]).toString());
  assert.equal(manifest.task_id, task); assert.equal(manifest.complete_task, true); assert.equal(manifest.files.length, 3);
  for (const f of manifest.files) { assert.equal(sha(entries[f.path]), f.sha256); assert.equal(entries[f.path].length, f.bytes); }
  for (const line of Buffer.from(entries["SHA256SUMS"]).toString().trim().split("\n")) { const [digest, name] = line.split("  "); assert.equal(sha(entries[name]), digest); }
  assert.match(Buffer.from(entries["README.md"]).toString(), /Continue editing/);
  const saved = `${prefix}-${client}-delivery.zip`; await writeFile(path.resolve(delivery, saved), bytes, { flag: "wx" });
  archives.push({ client, path: saved, sha256: sha(bytes), task_id: task, task_version: manifest.task_version, files: manifest.files.length }); return manifest;
}
async function attachTarget(parent: CDPSession, targetId: string) {
  const { sessionId } = await parent.send("Target.attachToTarget", { targetId, flatten: false }); let sequence = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const receive = (event: any) => { if (event.sessionId !== sessionId) return; const message = JSON.parse(event.message), entry = pending.get(message.id); if (!entry) return;
    clearTimeout(entry.timer); pending.delete(message.id); if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result); };
  parent.on("Target.receivedMessageFromTarget", receive);
  return {
    send(method: string, params: Record<string, unknown> = {}): Promise<any> { const id = ++sequence; return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("Side-panel CDP timed out: " + method)); }, 15000); pending.set(id, { resolve, reject, timer });
      void parent.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) }).catch(e => { clearTimeout(timer); pending.delete(id); reject(e); }); }); },
    async close() { parent.removeListener("Target.receivedMessageFromTarget", receive); for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error("Side-panel session closed")); } pending.clear(); await parent.send("Target.detachFromTarget", { sessionId }).catch(() => {}); },
  };
}
try {
  const [{ isolatedTestEnvironment }, { buildApp }, { loadConfig }, { Worker }, { CodexRuntimeAdapter }, fixtures] = await Promise.all([
    load("tests/native-test-environment.ts"), load("src/server.ts"), load("src/config.ts"), load("src/worker.ts"), load("src/runtime.ts"), load("tests/support-access-fixture.ts")]);
  process.chdir(platform); isolated = await isolatedTestEnvironment();
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", WORKER_ENABLED: "false", DEMO_MODE: "true", DEV_MAILBOX: "true",
    API_ORIGIN: "http://localhost:4310", WEB_ORIGIN: "http://localhost:4317", ADMIN_ORIGIN: "http://localhost:4318", AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000" }), { worker: false });
  await system.app.listen({ host: "127.0.0.1", port: 4310 }); const f = await fixtures.supportFixture(system, false);
  class CampaignRuntime extends CodexRuntimeAdapter {
    constructor() { super(system.db.config); }
    async start(ctx: any) {
      const write = ctx.tools.find((t: any) => t.name === "deliver_text");
      await write.run({ filename: "campaign-brief.md", mime_type: "text/markdown", content: "# Harbour launch\n\nExplicit synthetic campaign fixture. Audience: Hong Kong retail founders. Deliverable: editable SVG and campaign brief." }, "brief");
      await write.run({ filename: "launch-banner.svg", mime_type: "image/svg+xml", content: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="628"><rect width="1200" height="628" fill="#f7f7f4"/><text x="70" y="170" fill="#15171a" font-size="70" font-family="sans-serif">Bring your next idea to life.</text><rect x="70" y="270" width="360" height="90" rx="45" fill="#1f5eff"/><text x="105" y="327" fill="white" font-size="34" font-family="sans-serif">CopyPaste</text></svg>' }, "editable-banner");
      return { text: "Your campaign brief and editable banner are ready. Download the complete delivery package below.", status: "completed", inputTokens: 100, outputTokens: 50, usageKnown: true, accepted: true, thread: "synthetic-delivery-" + ctx.taskId, turn: "1" };
    }
  }
  async function make(name: string) {
    const work = await fixtures.historyOk(system, f.owner, "POST", f.base + "/delegations", { title: name, prompt: "Prepare a simulated campaign brief and editable SVG banner", mode: "execute", budget_micros: 1000000, client_message_id: randomUUID() });
    await new Worker(system.db, system.catalog, system.storage, new CampaignRuntime()).run(f.tenant, work.task.id);
    assert.equal((await system.db.control.query("SELECT status FROM tasks WHERE id=$1", [work.task.id])).rows[0].status, "succeeded"); return work;
  }
  const originals: any[] = [];
  async function retain(work: any) { originals.push({ id: work.task.id, ...(await system.db.control.query("SELECT charged_micros::text,version FROM tasks WHERE id=$1", [work.task.id])).rows[0] }); }
  async function login(page: Page, url = "http://localhost:4317/login") {
    await system.db.control.query("UPDATE auth_challenges SET created_at=clock_timestamp()-interval '2 minutes' WHERE email=$1", [f.owner.email]);
    await page.goto(url); await page.locator('input[name="email"]').fill(f.owner.email);
    const [response] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === "/v1/auth/challenges"), page.locator('form button[type="submit"]').click()]); assert.equal(response.status(), 202);
    const mail = JSON.parse(await readFile(path.join(isolated.directory, "mailbox", (await response.json()).challenge_id + ".json"), "utf8"));
    await page.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]); await page.locator('form button[type="submit"]').click();
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.addInitScript(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); });
  const web = await context.newPage(); web.on("pageerror", e => errors.push(e.message));
  stage = "Web original-conversation export and review"; const webWork = await make("Web complete campaign delivery"); await retain(webWork); await login(web); await web.locator(".app-shell").waitFor();
  await web.goto("http://localhost:4317/app/conversations/" + webWork.conversation.id);
  const webButton = web.getByRole("button", { name: "Download delivery package", exact: true }); await webButton.waitFor(); await shot("web", web, "conversation-en");
  recording = new WorkmateRecording("web", "delivery-download", `delivery-package-137-${attempt}`, () => web.screenshot({ type: "jpeg", quality: 72 }), "Original conversation download, actual ZIP and fixed-version customer review", delivery); await recording.start();
  const [webDownload] = await Promise.all([web.waitForEvent("download"), webButton.click()]); const webFile = path.join(owned, "web.zip"); await webDownload.saveAs(webFile); await validateArchive("web", webFile, webWork.task.id);
  pass("Web: real OTP login, original-conversation download and exact independently extracted archive");
  await web.goto("http://localhost:4317/app/tasks/" + webWork.task.id); await web.locator(".delivery-quality").waitFor(); await web.locator(".delivery-quality").scrollIntoViewIfNeeded();
  await web.getByLabel("Your feedback (optional)", { exact: true }).fill("Approved the delivered brief and editable banner."); await web.getByRole("button", { name: "Save review", exact: true }).click();
  await until(async () => (await system.db.control.query("SELECT count(*)::int AS n FROM delivery_reviews WHERE task_id=$1", [webWork.task.id])).rows[0].n, n => n === 1, "Actual fixed-version review");
  await web.getByTitle("切換至繁體中文", { exact: true }).click(); await web.getByRole("button", { name: "下載完整交付包", exact: true }).waitFor(); await shot("web", web, "review-zh");
  await web.getByRole("button", { name: "下載完整交付包", exact: true }).scrollIntoViewIfNeeded(); await shot("web", web, "reviewed-delivery"); await stopRecording();
  pass("Web: accepted review keeps its delivery version and Chinese download remains available");
  for (const width of [375, 768, 1440]) { await web.setViewportSize({ width, height: 1000 }); const view = await web.evaluate(() => ({ client: "web", width: innerWidth, horizontal: document.documentElement.scrollWidth > innerWidth + 1 })); assert.equal(view.horizontal, false); layouts.push(view); }

  stage = "Packaged native Desktop export"; const nativeWork = await make("Desktop complete campaign delivery"); await retain(nativeWork);
  electron = await _electron.launch({ executablePath: process.env.COPYPASTE_LOCAL_DESKTOP_CANDIDATE!, env: { ...process.env, COPYPASTE_USER_DATA: path.join(owned, "desktop") } });
  const native = await electron.firstWindow(); native.setDefaultTimeout(30000); native.on("pageerror", e => errors.push(e.message)); await native.waitForURL(/^file:/);
  await native.evaluate(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); }); await native.reload();
  const nativeFile = path.join(owned, "desktop.zip");
  await electron.evaluate(({ shell, dialog }, file) => { shell.openExternal = async (url: string) => { (globalThis as any).__deliveryAuth = url; }; dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, nativeFile);
  await native.getByRole("button", { name: "Sign in securely in your browser", exact: true }).click();
  const nativeContext = await browser.newContext(); await nativeContext.addInitScript(() => { localStorage.setItem("cp_locale", "en"); }); const customer = await nativeContext.newPage();
  await login(customer, await until(() => electron!.evaluate(() => (globalThis as any).__deliveryAuth), Boolean, "Native PKCE link"));
  await customer.getByRole("link", { name: /Authorize & return|授權並返回應用/ }).click(); await native.locator(".app-shell").waitFor();
  await native.evaluate(id => { window.location.hash = "/app/tasks/" + id; }, nativeWork.task.id); await native.locator(".delivery-quality").waitFor(); await native.locator(".delivery-quality").scrollIntoViewIfNeeded(); await shot("desktop", native, "delivery-en");
  recording = new WorkmateRecording("desktop", "delivery-download", `delivery-package-137-${attempt}`, () => native.screenshot({ type: "jpeg", quality: 72 }), "Real packaged Desktop IPC download; native save dialog result selects owned test destination", delivery); await recording.start();
  await native.getByTitle("切換至繁體中文", { exact: true }).click(); await native.getByRole("button", { name: "下載完整交付包", exact: true }).scrollIntoViewIfNeeded(); await shot("desktop", native, "delivery-zh");
  await native.getByRole("button", { name: "下載完整交付包", exact: true }).click(); await native.getByText("交付包已交給下載管理器。", { exact: true }).waitFor(); await validateArchive("desktop", nativeFile, nativeWork.task.id); await shot("desktop", native, "downloaded"); await stopRecording();
  pass("Desktop: real PKCE and packaged native IPC save verify archive bytes; save-dialog selection is controlled");
  const nativeWindow = await electron.browserWindow(native);
  for (const width of [1000, 1240, 1440]) { await nativeWindow.evaluate((win, width) => win.setBounds({ width, height: 980 }), width);
    const frame = await nativeWindow.evaluate(win => ({ bounds: win.getBounds(), content: win.getContentBounds(), menu_visible: win.isMenuBarVisible() }));
    const view = await native.evaluate(() => ({ client: "desktop", width: innerWidth, horizontal: document.documentElement.scrollWidth > innerWidth,
      visible_scrollbars: [...document.querySelectorAll("body *")].filter(n => n.getClientRects().length && n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY) && getComputedStyle(n).scrollbarWidth !== "none" && getComputedStyle(n, "::-webkit-scrollbar").display !== "none").map(n => String(n.className)) }));
    assert.deepEqual(frame.bounds, frame.content); assert.equal(frame.menu_visible, false); assert.equal(view.horizontal, false); assert.deepEqual(view.visible_scrollbars, []); layouts.push({ ...view, frame }); }
  assert.equal(await electron.evaluate(({ Menu }) => Menu.getApplicationMenu() === null), true); pass("Desktop: three native widths retain frameless presentation, no menu and no visible scrolling rails");
  await electron.close(); electron = undefined; desktopClosed = true;

  stage = "Actual Chrome right SIDE_PANEL export"; const extensionWork = await make("Side panel complete campaign delivery"); await retain(extensionWork);
  const extension = path.resolve(delivery, "../copypaste-extension"), extensionId = (await readFile(path.join(extension, "extension-id.txt"), "utf8")).trim(), downloads = path.join(owned, "browser-downloads"); await mkdir(downloads, { recursive: true });
  extensionContext = await chromium.launchPersistentContext(path.join(owned, "extension"), { executablePath: process.env.CHROME_BIN, headless: false, viewport: null,
    args: ["--disable-gpu", "--window-size=1480,980", "--enable-unsafe-extension-debugging", "--disable-extensions-except=" + path.join(extension, "dist"), "--load-extension=" + path.join(extension, "dist")] });
  const worker = extensionContext.serviceWorkers()[0] ?? await extensionContext.waitForEvent("serviceworker"); await worker.evaluate(() => chrome.storage.local.set({ locale: "en" }));
  const main = extensionContext.pages()[0]; await main.goto("http://localhost:4317/"); const width = await main.evaluate(() => innerWidth), tabs = extensionContext.pages().length;
  const cdp = await extensionContext.browser()!.newBrowserCDPSession(); await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads, eventsEnabled: true });
  const target = (await cdp.send("Target.getTargets", { filter: [{}] })).targetInfos.find(t => t.type === "tab" && t.url.startsWith("http://localhost:4317")); assert.ok(target);
  await (cdp as any).send("Extensions.triggerAction", { id: extensionId, targetId: target.targetId });
  const side = await until(() => worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] })), v => v.length === 1, "Actual native SIDE_PANEL document");
  const panelTarget = await until(async () => (await cdp.send("Target.getTargets", { filter: [{}] })).targetInfos.find(t => t.type === "page" && t.url === side[0].documentUrl), Boolean, "Native panel target");
  const panel = await attachTarget(cdp, panelTarget.targetId);
  const evaluate = async (expression: string) => { const value = await panel.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); assert.equal(value.exceptionDetails, undefined); return value.result.value; };
  const click = (selector: string) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click();true`);
  const capture = async () => Buffer.from((await panel.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })).data, "base64");
  try {
    await until(() => main.evaluate(() => innerWidth), v => v < width - 250, "Right dock consumes browser content width"); assert.equal((await worker.evaluate(() => chrome.sidePanel.getLayout())).side, "right"); assert.equal(extensionContext.pages().length, tabs);
    pass("Extension: actual native right SIDE_PANEL opens through the toolbar with no normal panel tab");
    await until(() => evaluate("document.documentElement.lang"), v => v === "en", "Panel English locale");
    const popupEvent = extensionContext.waitForEvent("page"); await click("#sign-in"); const popup = await popupEvent;
    await popup.waitForURL(url => url.hostname === "localhost" && url.port === "4317"); await popup.waitForLoadState(); await login(popup, popup.url()); await popup.getByRole("link", { name: /Authorize & return|授權並返回應用/ }).click();
    await until(() => evaluate("!document.querySelector('#workspace').hidden && !!document.querySelector('#project').value"), Boolean, "Panel real OAuth callback");
    await until(() => evaluate(`!!document.querySelector('#chat-history option[value="${extensionWork.conversation.id}"]')`), Boolean, "Original chat in panel history");
    await evaluate(`document.querySelector('#chat-history').value=${JSON.stringify(extensionWork.conversation.id)};document.querySelector('#chat-history').dispatchEvent(new Event('change'));true`);
    await until(() => evaluate("[...document.querySelectorAll('#chat-messages button')].some(b=>b.textContent==='Download delivery package')"), Boolean, "Download inside original panel chat");
    assert.equal(await evaluate("document.querySelector('#workspace-tools').open"), false);
    screenshots.push(await saveWorkmateScreenshot("extension", `delivery-package-137-${attempt}`, "conversation-en", await capture(), "Actual native right panel original-conversation delivery button", delivery));
    recording = new WorkmateRecording("extension", "delivery-download", `delivery-package-137-${attempt}`, capture, "Native Chrome downloads manager saves and independently extracts the exact cloud task package", delivery); await recording.start();
    await click("#locale"); await until(() => evaluate("document.documentElement.lang"), v => v === "zh-Hant-HK", "Panel Chinese locale");
    screenshots.push(await saveWorkmateScreenshot("extension", `delivery-package-137-${attempt}`, "conversation-zh", await capture(), "Native side-panel bilingual delivery action", delivery));
    await evaluate("[...document.querySelectorAll('#chat-messages button')].find(b=>b.textContent==='下載完整交付包').click();true");
    const saved = await until(() => worker.evaluate(task => chrome.downloads.search({ filenameRegex: "workmate-" + task + "-v" }), extensionWork.task.id), v => v.some((d: any) => d.state === "complete"), "Actual Chrome manager completed the ZIP", 60000);
    const item = saved.find((d: any) => d.state === "complete"); assert.equal(item.mime, "application/zip"); await validateArchive("extension", item.filename, extensionWork.task.id);
    await until(() => evaluate("document.querySelector('#chat-messages').textContent.includes('已交給瀏覽器下載管理器。')"), Boolean, "Native panel download handoff status");
    screenshots.push(await saveWorkmateScreenshot("extension", `delivery-package-137-${attempt}`, "downloaded", await capture(), "Completed native Chrome download from original side-panel chat", delivery)); await stopRecording();
    pass("Extension: real OTP/PKCE and original-chat action complete an authenticated native Chrome ZIP download");
    const rejected = await evaluate(`chrome.runtime.sendMessage(${JSON.stringify({ type: "DELIVERY_DOWNLOAD", selection: { tenant: f.tenant, project: f.project, task: extensionWork.task.id, version: 99999, deliveryHash: "a".repeat(64) } })})`);
    assert.equal(rejected.ok, false); assert.match(rejected.error, /Delivery changed/);
    assert.equal((await worker.evaluate(task => chrome.downloads.search({ filenameRegex: "workmate-" + task + "-v" }), extensionWork.task.id)).length, 1);
    pass("Extension: a stale fixed-version selection is rejected without creating another browser download");
    const layout = await evaluate("({client:'extension',width:innerWidth,horizontal:document.documentElement.scrollWidth>innerWidth+1})"); assert.equal(layout.horizontal, false); layouts.push(layout);
  } catch (e) { diagnostics.push({ client: "extension", visible: await evaluate("({locale:document.documentElement.lang,chat:document.querySelector('#chat-messages').textContent,error:document.querySelector('#error').textContent})").catch(String) }); throw e; }
  finally { await panel.close(); await cdp.detach(); }
  await extensionContext.close(); extensionContext = undefined; extensionClosed = true;
  for (const original of originals) { const row = (await system.db.control.query("SELECT charged_micros::text FROM tasks WHERE id=$1", [original.id])).rows[0]; assert.equal(row.charged_micros, original.charged_micros);
    assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'", [original.id])).rows[0].n, 1); }
  pass("All three client exports preserve the original task charges and never create another model execution");
} catch (e) { failure = String(e); console.error(stage + ": " + failure);
  if (electron) try { const page = electron.windows()[0]; if (page) diagnostics.push({ client: "desktop", url: page.url(), text: (await page.locator("body").innerText()).slice(0, 10000) }); } catch (error) { diagnostics.push({ error: String(error) }); }
}
finally {
  await stopRecording().catch(e => { failure ??= String(e); });
  if (electron) try { await electron.close(); desktopClosed = true; } catch (e) { failure ??= String(e); }
  if (extensionContext) try { await extensionContext.close(); extensionClosed = true; } catch (e) { failure ??= String(e); }
  if (browser) try { await browser.close(); browserClosed = true; } catch (e) { failure ??= String(e); }
  if (system) try { await system.app.close(); apiClosed = true; } catch (e) { failure ??= String(e); }
  if (isolated) try { await isolated.cleanup(); fixtureClosed = true; } catch (e) { failure ??= String(e); }
  process.chdir(delivery);
}
const passed = !failure && errors.length === 0 && checks.length === 8 && screenshots.length === 9 && archives.length === 3 && recordings.length === 3 && layouts.length === 7
  && recordings.every(r => r.distinct_frames > 1 && r.skipped_capture_errors === 0) && browserClosed && extensionClosed && desktopClosed && apiClosed && fixtureClosed;
const result = { at: new Date().toISOString(), status: passed ? "passed" : "failed", stage, failure, checks, screenshots, recordings, archives, layouts, errors, diagnostics,
  browser_closed: browserClosed, extension_closed: extensionClosed, desktop_closed: desktopClosed, api_closed: apiClosed, fixture_closed: fixtureClosed,
  model_mode: "Controlled runtime adapter and synthetic business content; actual login, task execution, database, file bytes, right SIDE_PANEL and native client downloads. Desktop save-dialog result is a controlled owned test destination. This journey does not requalify local Codex tool coverage or professional campaign quality." };
await writeFile(prefix + "-journey.json", JSON.stringify(result, null, 2) + "\n", { flag: "wx" }); console.log(JSON.stringify({ status: result.status, checks: checks.length, failure })); process.exitCode = passed ? 0 : 1;
