import assert from "node:assert/strict";
import { chromium, _electron, type Browser, type BrowserContext, type Page, type ElectronApplication, type CDPSession } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";
const attempt = process.argv[2]; assert.match(attempt ?? "", /^\d{2}$/);
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), prefix = `evidence/business-inputs-136/ui-${attempt}`;
const load = (name: string) => import(pathToFileURL(path.join(platform, name)).href);
const diagnostics: any[] = [];
const checks: string[] = [], screenshots: any[] = [], recordings: any[] = [], layouts: any[] = [], errors: string[] = [];
let isolated: any, system: any, browser: Browser | undefined, extensionContext: BrowserContext | undefined, electron: ElectronApplication | undefined, recording: WorkmateRecording | undefined;
let stage = "setup", failure: string | null = null, browserClosed = false, extensionClosed = false, desktopClosed = false, apiClosed = false, fixtureClosed = false;
const pass = (name: string) => { checks.push(name); console.log("PASS: " + name); };
async function until(read: () => Promise<any>, valid: (v: any) => boolean, label: string, ms = 30000) { const end = Date.now() + ms; for (;;) { const value = await read(); if (valid(value)) return value; assert.ok(Date.now() < end, label); await new Promise(r => setTimeout(r, 100)); } }
async function stopRecording() { if (recording) { const owned = recording; recording = undefined; recordings.push(await owned.stop()); } }
async function shot(component: string, page: Page, name: string) { screenshots.push(await saveWorkmateScreenshot(component, `business-inputs-136-${attempt}`, name, await page.screenshot(), "Actual business clarification in the original conversation", delivery)); }
async function attachTarget(parent: CDPSession, targetId: string, observe?: (message:any)=>void) {
  const { sessionId } = await parent.send("Target.attachToTarget", {
    targetId,
    flatten: false,
  });
  let sequence = 0;
  const pending = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const receive = (event: any) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    observe?.(message);
    const entry = pending.get(message.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  };
  parent.on("Target.receivedMessageFromTarget", receive);
  return {
    send(method: string, params: Record<string, unknown> = {}): Promise<any> {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("Side-panel CDP timed out: " + method));
        }, 15_000);
        pending.set(id, { resolve, reject, timer });
        void parent
          .send("Target.sendMessageToTarget", {
            sessionId,
            message: JSON.stringify({ id, method, params }),
          })
          .catch((e) => {
            clearTimeout(timer);
            pending.delete(id);
            reject(e);
          });
      });
    },
    async close() {
      parent.removeListener("Target.receivedMessageFromTarget", receive);
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("Side-panel session closed"));
      }
      pending.clear();
      await parent
        .send("Target.detachFromTarget", { sessionId })
        .catch(() => {});
    },
  };
}

try {
  const [{ isolatedTestEnvironment }, { buildApp }, { loadConfig }, { Worker }, { CodexRuntimeAdapter }, fixtures] = await Promise.all([load("tests/native-test-environment.ts"), load("src/server.ts"), load("src/config.ts"), load("src/worker.ts"), load("src/runtime.ts"), load("tests/support-access-fixture.ts")]);
  process.chdir(platform); isolated = await isolatedTestEnvironment();
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", WORKER_ENABLED: "false", DEMO_MODE: "true", DEV_MAILBOX: "true", API_ORIGIN: "http://localhost:4310", WEB_ORIGIN: "http://localhost:4317", ADMIN_ORIGIN: "http://localhost:4318", AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000" }), { worker: false });
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  const f = await fixtures.supportFixture(system, false);
  const questions = [ { kind: "question", description: "Which canvas size is required?", options: ["1080 × 1080", "1080 × 1920"] }, { kind: "question", description: "Who is the campaign audience?" } ];
  class BriefRuntime extends CodexRuntimeAdapter {
    calls = 0; thread = "ui-business-" + randomUUID();
    constructor(config: any) { super(config); }
    async start(ctx: any) {
      const n = ++this.calls, turn = "turn-" + n;
      if (n > 1) assert.equal(ctx.thread, this.thread);
      await ctx.onEvent("runtime.thread", { thread_id: this.thread }); await ctx.onEvent("runtime.turn", { turn_id: turn });
      if (n === 1) await ctx.tools.find((t: any) => t.name === "request_input").run({ requests: questions }, "essential-brief");
      else {
        assert.ok(ctx.prompt.includes("1200 × 628")); assert.ok(ctx.prompt.includes("Hong Kong retail founders"));
        await ctx.tools.find((t: any) => t.name === "deliver_text").run({ filename: "campaign-brief.txt", content: "Canvas: 1200 × 628\nAudience: Hong Kong retail founders", mime_type: "text/plain" }, "campaign-delivery");
      }
      return { text: n === 1 ? "Please confirm the canvas and campaign audience." : "Your approved campaign brief is ready.", status: "completed", inputTokens: 100, outputTokens: 50, usageKnown: true, accepted: true, thread: this.thread, turn };
    }
  }
  async function make(name: string) {
    const created = await fixtures.historyOk(system, f.owner, "POST", f.base + "/delegations", { title: name, prompt: "Prepare a launch brief for my approved campaign.", mode: "execute", budget_micros: 1000000, client_message_id: randomUUID() });
    const runtime = new BriefRuntime(system.db.config), worker = new Worker(system.db, system.catalog, system.storage, runtime); await worker.run(f.tenant, created.task.id);
    const task = (await system.db.control.query("SELECT * FROM tasks WHERE id=$1", [created.task.id])).rows[0]; assert.equal(task.status, "needs_input", task.error_code);
    const dependencies = (await system.db.control.query("SELECT * FROM task_dependencies WHERE task_id=$1 ORDER BY step_key", [task.id])).rows;
    assert.equal(dependencies.length, 2); return { ...created, runtime, worker, dependencies };
  }
  async function finish(work: any) {
    await until(async () => (await system.db.control.query("SELECT status FROM tasks WHERE id=$1", [work.task.id])).rows[0].status, v => v === "queued", "All answers queue the original task");
    await work.worker.run(f.tenant, work.task.id);
    const task = (await system.db.control.query("SELECT * FROM tasks WHERE id=$1", [work.task.id])).rows[0]; assert.equal(task.status, "succeeded", task.error_code); assert.equal(work.runtime.calls, 2); assert.equal(task.attempt, 2);
    assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM reservations WHERE task_id=$1", [task.id])).rows[0].n, 1);
    assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'", [task.id])).rows[0].n, 1);
    assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM conversation_messages WHERE conversation_id=$1 AND role='user' AND intent='note'", [work.conversation.id])).rows[0].n, 2);
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); });
  const web = await context.newPage(); web.on("pageerror", e => errors.push(e.message));
  async function login(page: Page, url = "http://localhost:4317/login") {
    await system.db.control.query("UPDATE auth_challenges SET created_at=clock_timestamp()-interval '2 minutes' WHERE email=$1", [f.owner.email]);
    await page.goto(url); await page.locator('input[name="email"]').fill(f.owner.email);
    const [challenge] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === "/v1/auth/challenges"), page.locator('form button[type="submit"]').click()]);
    assert.equal(challenge.status(), 202); const mail = JSON.parse(await readFile(path.join(isolated.directory, "mailbox", (await challenge.json()).challenge_id + ".json"), "utf8"));
    await page.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]); await page.locator('form button[type="submit"]').click();
  }
  async function reactJourney(page: Page, component: string, work: any, history?: Page) {
    await page.locator(".task-inputs").waitFor(); const size = page.locator(`[data-dependency="${work.dependencies[0].id}"]`), audience = page.locator(`[data-dependency="${work.dependencies[1].id}"]`);
    await size.scrollIntoViewIfNeeded(); assert.equal(await size.getByRole("button", { name: "Confirm answer", exact: true }).isDisabled(), true);
    assert.equal(await size.getByLabel("Your answer", { exact: true }).inputValue(), "");
    pass(component + (component === "desktop" ? ": questions appear in the existing cloud-task detail without an automatic answer" : ": questions appear in the original conversation without an automatic answer"));
    recording = new WorkmateRecording(component, "business-clarification", `business-inputs-136-${attempt}`, () => page.screenshot({ type: "jpeg", quality: 72 }), "Actual optional choice, free answer and continuation in the original conversation", delivery); await recording.start();
    await size.getByRole("button", { name: "1080 × 1080", exact: true }).click(); await size.getByLabel("Your answer", { exact: true }).fill("1200 × 628");
    await shot(component, page, "question-en");
    await page.getByTitle("切換至繁體中文", { exact: true }).click(); assert.equal(await size.getByLabel("你的回答", { exact: true }).inputValue(), "1200 × 628"); await size.scrollIntoViewIfNeeded(); await shot(component, page, "question-zh");
    await page.getByTitle("Switch to English", { exact: true }).click(); await size.getByRole("button", { name: "Confirm answer", exact: true }).click();
    await until(async () => (await system.db.control.query("SELECT state FROM task_dependencies WHERE id=$1", [work.dependencies[0].id])).rows[0].state, v => v === "resolved", "First answer is retained");
    assert.equal((await system.db.control.query("SELECT status FROM tasks WHERE id=$1", [work.task.id])).rows[0].status, "needs_input");
    pass(component + ": free text outside suggestions survives language changes; remaining input keeps the task waiting");
    await audience.getByLabel("Your answer", { exact: true }).fill("Hong Kong retail founders"); await audience.getByRole("button", { name: "Confirm answer", exact: true }).click();
    await finish(work); await page.getByText("Your approved campaign brief is ready.", { exact: true }).first().waitFor();
    pass(component + ": both answers resume one original task, one budget hold and one cumulative charge");
    if (history) await history.goto("http://localhost:4317/app/conversations/" + work.conversation.id);
    const note = (history ?? page).getByText(/Who is the campaign audience\?\s+Hong Kong retail founders/).first(); await note.waitFor(); await shot(component, page, "completed");
    pass(component + (history ? ": confirmed answers remain in the original cloud conversation, checked through signed-in Web" : ": confirmed business answers remain in the original conversation history")); await stopRecording();
  }
  stage = "Web original-conversation clarification"; const webWork = await make("Web campaign brief"); await login(web); await web.locator(".app-shell").waitFor(); await web.goto("http://localhost:4317/app/conversations/" + webWork.conversation.id); await reactJourney(web, "web", webWork);
  for (const width of [375, 768, 1440]) { await web.setViewportSize({ width, height: 1000 }); const layout = await web.evaluate(() => ({ client: "web", width: innerWidth, horizontal: document.documentElement.scrollWidth > innerWidth + 1 })); assert.equal(layout.horizontal, false); layouts.push(layout); }
  stage = "Unsigned packaged native Desktop clarification"; const nativeWork = await make("Desktop cloud campaign brief");
  electron = await _electron.launch({ executablePath: process.env.COPYPASTE_LOCAL_DESKTOP_CANDIDATE!, env: { ...process.env, COPYPASTE_USER_DATA: path.join(process.env.COPYPASTE_BUSINESS_INPUTS_OWNED!, "desktop") } });
  const native = await electron.firstWindow(); native.setDefaultTimeout(30000); native.on("pageerror", e => errors.push(e.message)); await native.waitForURL(/^file:/);
  await native.evaluate(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); }); await native.reload();
  await electron.evaluate(({ shell }) => { shell.openExternal = async (url: string) => { (globalThis as any).__businessAuth = url; }; });
  await native.getByRole("button", { name: "Sign in securely in your browser", exact: true }).click();
  const nativeContext = await browser.newContext(); await nativeContext.addInitScript(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); }); const customer = await nativeContext.newPage(); await login(customer, await until(() => electron!.evaluate(() => (globalThis as any).__businessAuth), Boolean, "Actual native PKCE link"));
  await customer.getByRole("link", { name: /Authorize & return|授權並返回應用/ }).click(); await native.locator(".app-shell").waitFor();
  await native.evaluate(id => { window.location.hash = "/app/tasks/" + id; }, nativeWork.task.id); await reactJourney(native, "desktop", nativeWork, customer);
  const nativeWindow = await electron.browserWindow(native);
  for (const width of [1000, 1240, 1440]) {
    await nativeWindow.evaluate((win, width) => win.setBounds({ width, height: 980 }), width);
    const frame = await nativeWindow.evaluate(win => ({ bounds: win.getBounds(), content: win.getContentBounds(), menu_visible: win.isMenuBarVisible() }));
    const view = await native.evaluate(() => ({ client: "desktop", width: innerWidth, horizontal: document.documentElement.scrollWidth > innerWidth,
      visible_scrollbars: [...document.querySelectorAll("body *")].filter(n => n.getClientRects().length && n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY) && getComputedStyle(n).scrollbarWidth !== "none" && getComputedStyle(n, "::-webkit-scrollbar").display !== "none").map(n => String(n.className)) }));
    assert.deepEqual(frame.bounds, frame.content); assert.equal(frame.menu_visible, false); assert.equal(view.horizontal, false); assert.deepEqual(view.visible_scrollbars, []); layouts.push({ ...view, frame });
  }
  assert.equal(await electron.evaluate(({ Menu }) => Menu.getApplicationMenu() === null), true); pass("Desktop remains frameless with no Electron menu, visible vertical rails or horizontal overflow at three native widths");
  await electron.close(); electron = undefined; desktopClosed = true;
  stage = "Actual native Chrome right SIDE_PANEL clarification"; const extensionWork = await make("Side panel campaign brief"), extension = path.resolve(delivery, "../copypaste-extension"), extensionId = (await readFile(path.join(extension, "extension-id.txt"), "utf8")).trim();
  extensionContext = await chromium.launchPersistentContext(path.join(process.env.COPYPASTE_BUSINESS_INPUTS_OWNED!, "extension"), { executablePath: process.env.CHROME_BIN, headless: false, viewport: null, args: ["--disable-gpu", "--window-size=1480,980", "--enable-unsafe-extension-debugging", "--disable-extensions-except=" + path.join(extension, "dist"), "--load-extension=" + path.join(extension, "dist")] });
  const worker = extensionContext.serviceWorkers()[0] ?? await extensionContext.waitForEvent("serviceworker"); await worker.evaluate(() => chrome.storage.local.set({ locale: "en" }));
  await until(() => worker.evaluate(() => chrome.sidePanel.getPanelBehavior()), v => v.openPanelOnActionClick === true, "Native panel toolbar behavior");
  const main = extensionContext.pages()[0]; await main.goto("http://localhost:4317/"); const width = await main.evaluate(() => innerWidth), tabs = extensionContext.pages().length;
  const cdp = await extensionContext.browser()!.newBrowserCDPSession();
  const target = (await cdp.send("Target.getTargets", { filter: [{}] })).targetInfos.find(t => t.type === "tab" && t.url.startsWith("http://localhost:4317")); assert.ok(target);
  await (cdp as any).send("Extensions.triggerAction", { id: extensionId, targetId: target.targetId });
  const side = await until(() => worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] })), v => v.length === 1 && v[0].documentUrl === `chrome-extension://${extensionId}/sidepanel.html`, "Actual native SIDE_PANEL document");
  const panelTarget = await until(async () => (await cdp.send("Target.getTargets", { filter: [{}] })).targetInfos.find(t => t.type === "page" && t.url === side[0].documentUrl), Boolean, "Native panel target");
  const panel = await attachTarget(cdp, panelTarget.targetId);
  const evaluate = async (expression: string) => { const value = await panel.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); assert.equal(value.exceptionDetails, undefined); return value.result.value; };
  const click = (selector: string) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click();true`);
  const capture = async () => Buffer.from((await panel.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })).data, "base64");
  try {
    await until(() => main.evaluate(() => innerWidth), v => v < width - 250, "Right docking consumes browser content width"); assert.equal((await worker.evaluate(() => chrome.sidePanel.getLayout())).side, "right"); assert.equal(extensionContext.pages().length, tabs);
    pass("Extension opens the actual native right SIDE_PANEL through its toolbar without creating a normal panel tab");
    await until(() => evaluate("document.documentElement.lang"), v => v === "en", "Panel English locale");
    const popupEvent = extensionContext.waitForEvent("page"); await click("#sign-in"); const popup = await popupEvent;
    await popup.waitForURL(url => url.hostname === "localhost" && url.port === "4317"); await popup.waitForLoadState(); await login(popup, popup.url()); await popup.getByRole("link", { name: /Authorize & return|授權並返回應用/ }).click();
    await until(() => evaluate("!document.querySelector('#workspace').hidden && !!document.querySelector('#project').value"), Boolean, "Panel real OAuth callback");
    await until(() => evaluate(`!!document.querySelector('#chat-history option[value="${extensionWork.conversation.id}"]')`), Boolean, "Original chat in native panel history");
    await evaluate(`document.querySelector('#chat-history').value=${JSON.stringify(extensionWork.conversation.id)};document.querySelector('#chat-history').dispatchEvent(new Event('change'));true`);
    await until(() => evaluate("document.querySelectorAll('#chat-messages .business-question').length"), v => v === 2, "Business questions inside original native panel chat");
    assert.equal(await evaluate("document.querySelector('#workspace-tools').open"), false); assert.equal(await evaluate("[...document.querySelectorAll('#chat-messages .business-question textarea')].every(n=>n.value==='')"), true);
    pass("extension: questions appear in the original conversation without an automatic answer");
    recording = new WorkmateRecording("extension", "business-clarification", `business-inputs-136-${attempt}`, capture, "Actual native Chrome right panel free-answer and same-task continuation", delivery); await recording.start();
    const size = `[data-dependency="${extensionWork.dependencies[0].id}"]`, audience = `[data-dependency="${extensionWork.dependencies[1].id}"]`;
    await evaluate(`(()=>{const row=document.querySelector('#chat-messages ${size}');row.scrollIntoView({block:'center'});row.querySelector('button.secondary').click();const input=row.querySelector('textarea');input.value='1200 × 628';input.dispatchEvent(new Event('input'));return true;})()`);
    screenshots.push(await saveWorkmateScreenshot("extension", `business-inputs-136-${attempt}`, "question-en", await capture(), "Actual right SIDE_PANEL business question with a free answer", delivery));
    await click("#locale"); await until(() => evaluate("document.documentElement.lang"), v => v === "zh-Hant-HK", "Panel Chinese locale");
    assert.equal(await evaluate(`document.querySelector('#chat-messages ${size} textarea').value`), "1200 × 628"); await evaluate(`document.querySelector('#chat-messages ${size}').scrollIntoView({block:'center'});true`);
    screenshots.push(await saveWorkmateScreenshot("extension", `business-inputs-136-${attempt}`, "question-zh", await capture(), "Native panel retains its free answer across a real language switch", delivery));
    await click("#locale"); await until(() => evaluate("document.documentElement.lang"), v => v === "en", "Panel returns to English"); await click("#chat-messages " + size + " button.primary");
    await until(async () => (await system.db.control.query("SELECT state FROM task_dependencies WHERE id=$1", [extensionWork.dependencies[0].id])).rows[0].state, v => v === "resolved", "First native panel answer persisted");
    assert.equal((await system.db.control.query("SELECT status FROM tasks WHERE id=$1", [extensionWork.task.id])).rows[0].status, "needs_input");
    pass("extension: free text outside suggestions survives language changes; remaining input keeps the task waiting");
    await until(() => evaluate(`!!document.querySelector('#chat-messages ${audience} textarea')`), Boolean, "Second pending business question");
    await evaluate(`(()=>{const input=document.querySelector('#chat-messages ${audience} textarea');input.value='Hong Kong retail founders';input.dispatchEvent(new Event('input'));input.scrollIntoView({block:'center'});return true;})()`); await click("#chat-messages " + audience + " button.primary"); await finish(extensionWork);
    await until(() => evaluate("document.querySelector('#chat-messages').textContent.includes('Your approved campaign brief is ready.')"), Boolean, "Native panel final response in original chat");
    pass("extension: both answers resume one original task, one budget hold and one cumulative charge");
    assert.equal(await evaluate("document.querySelector('#chat-messages').textContent.includes('Hong Kong retail founders')"), true); assert.equal(await evaluate("document.querySelector('#workspace-tools').open"), false);
    screenshots.push(await saveWorkmateScreenshot("extension", `business-inputs-136-${attempt}`, "completed", await capture(), "Actual confirmed answers and final response remain in the original native side-panel conversation", delivery));
    pass("extension: confirmed business answers remain in the original conversation history"); await stopRecording();
    const layout = await evaluate("({client:'extension',width:innerWidth,horizontal:document.documentElement.scrollWidth>innerWidth+1})"); assert.equal(layout.horizontal, false); layouts.push(layout);
  } catch (e) {
    diagnostics.push({ client: "extension", visible: await evaluate("({locale:document.documentElement.lang,chat:document.querySelector('#chat-messages').textContent,error:document.querySelector('#error').textContent})").catch(error => ({ diagnostic_error: String(error) })), screenshot: await saveWorkmateScreenshot("extension", `business-inputs-136-${attempt}`, "failure-diagnostic", await capture(), "Unedited native-panel failure diagnostic of this synthetic fixture", delivery).catch(error => ({ diagnostic_error: String(error) })) });
    throw e;
  } finally { await panel.close(); await cdp.detach(); }
  await extensionContext.close(); extensionContext = undefined; extensionClosed = true;
} catch (e) {
  failure = String(e); console.error(stage + ": " + failure);
  if (electron) try {
    const view = electron.windows()[0];
    if (view) diagnostics.push({ client: "desktop", url: view.url(), rendered_text: (await view.locator("body").innerText()).slice(0, 14000), screenshot: await saveWorkmateScreenshot("desktop", `business-inputs-136-${attempt}`, "failure-diagnostic", await view.screenshot(), "Unedited failure diagnostic of this synthetic fixture", delivery) });
  } catch (diagnostic) { diagnostics.push({ diagnostic_error: String(diagnostic) }); }
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
const passed = !failure && errors.length === 0 && checks.length === 14 && screenshots.length === 9 && recordings.length === 3 && layouts.length === 7 && recordings.every(r => r.distinct_frames > 1 && r.skipped_capture_errors === 0) && browserClosed && extensionClosed && desktopClosed && apiClosed && fixtureClosed;
const result = { at: new Date().toISOString(), status: passed ? "passed" : "failed", stage, failure, checks, screenshots, recordings, layouts, errors, diagnostics, browser_closed: browserClosed, extension_closed: extensionClosed, desktop_closed: desktopClosed, api_closed: apiClosed, fixture_closed: fixtureClosed, model_mode: "Scripted tool calls and synthetic business replies in UI journeys; actual native Codex is qualified separately by the backend native integration test." };
await writeFile(prefix + "-journey.json", JSON.stringify(result, null, 2) + "\n", { flag: "wx" }); console.log(JSON.stringify({ status: result.status, checks: checks.length, failure })); process.exitCode = passed ? 0 : 1;
