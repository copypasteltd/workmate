import assert from "node:assert/strict";
import { chromium, _electron } from "playwright";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.ts";

const delivery = process.cwd(), platform = path.resolve("../copypaste-platform-publication-125"),
  extension = path.resolve("../copypaste-extension-publication-125"), attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const prefix = path.join(delivery, "evidence/native-publications-" + attempt),
  owned = path.join(delivery, ".data/native-publications", randomUUID());
const checks = [], errors = [], screenshots = [], recordings = [], layouts = [];
let system, isolated, context, electron, panel, cdp, recording, failurePage;
let stage = "setup", browserClosed = false, desktopClosed = false, apiClosed = false, fixtureClosed = false, modelCalls = -1;
const pass = name => { checks.push(name); console.log("PASS: " + name); };
const load = name => import(pathToFileURL(path.join(platform, name)).href);
async function until(read, ok, name) {
  const deadline = Date.now() + 40000;
  do { const value = await read(); if (ok(value)) return value; await new Promise(resolve => setTimeout(resolve, 120)); } while (Date.now() < deadline);
  throw new Error("Timed out: " + name);
}
async function stopRecording() {
  if (!recording) return;
  const item = recording; recording = undefined; recordings.push(await item.stop());
}
async function attachTarget(parent, targetId) {
  const { sessionId } = await parent.send("Target.attachToTarget", { targetId, flatten: false });
  let sequence = 0; const pending = new Map();
  const receive = event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message), request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer); pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  };
  parent.on("Target.receivedMessageFromTarget", receive);
  return {
    send(method, params = {}) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("Owned Side Panel CDP timeout: " + method)); }, 20000);
        pending.set(id, { resolve, reject, timer });
        void parent.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
      });
    },
    async close() {
      parent.removeListener("Target.receivedMessageFromTarget", receive);
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Owned panel closed")); }
      pending.clear(); await parent.send("Target.detachFromTarget", { sessionId }).catch(() => {});
    },
  };
}
async function evaluate(expression) {
  const result = await panel.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails)); return result.result.value;
}
try {
  await mkdir(owned, { recursive: true });
  const [{ isolatedTestEnvironment }, { buildApp }, { loadConfig }, { saveAsset }, { advancePublications }, { defaults }] = await Promise.all([
    load("tests/native-test-environment.ts"), load("src/server.ts"), load("src/config.ts"), load("src/storage.ts"),
    load("src/publication-worker.ts"), load("src/plans.ts"),
  ]);
  process.chdir(platform); isolated = await isolatedTestEnvironment();
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", WORKER_ENABLED: "false",
    API_ORIGIN: "http://localhost:4310", WEB_ORIGIN: "http://localhost:4317", ADMIN_ORIGIN: "http://localhost:4318" }), { worker: false });
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  const before = (await system.db.control.query("SELECT (SELECT count(*) FROM tasks)::text AS tasks,(SELECT count(*) FROM reservations)::text AS reservations,(SELECT count(*) FROM ai_gateway_requests)::text AS gateway")).rows[0];
  const extensionId = (await readFile(path.join(extension, "extension-id.txt"), "utf8")).trim();
  context = await chromium.launchPersistentContext(path.join(owned, "chrome"), { executablePath: process.env.CHROME_BIN,
    headless: false, viewport: null, args: ["--disable-gpu", "--window-size=1480,1080", "--enable-unsafe-extension-debugging",
      "--disable-extensions-except=" + path.join(extension, "dist"), "--load-extension=" + path.join(extension, "dist")] });
  await context.addInitScript(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); });
  const main = context.pages()[0] ?? await context.newPage(); await main.goto("http://localhost:4317/");
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  assert.equal(new URL(worker.url()).hostname, extensionId); await worker.evaluate(() => chrome.storage.local.set({ locale: "en" }));
  electron = await _electron.launch({ executablePath: process.env.COPYPASTE_LOCAL_DESKTOP_CANDIDATE,
    env: { ...process.env, COPYPASTE_USER_DATA: path.join(owned, "desktop") } });
  const page = await electron.firstWindow(); failurePage = page; page.setDefaultTimeout(30000);
  page.on("pageerror", error => errors.push(error.message));
  await page.waitForURL(/^file:/); await page.waitForFunction(() => !!window.copyPasteBridge);
  await page.evaluate(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); }); await page.reload();
  await electron.evaluate(({ shell }) => { shell.openExternal = async url => { globalThis.__ownedAuthURL = url; }; });
  stage = "actual Desktop browser identity and onboarding";
  await page.getByRole("button", { name: "Sign in securely in your browser", exact: true }).click();
  const authURL = await until(() => electron.evaluate(() => globalThis.__ownedAuthURL ?? ""), Boolean, "Desktop PKCE browser URL");
  const auth = await context.newPage(); await auth.goto(authURL);
  await auth.locator('input[name="email"]').fill(`native-publishing-${randomUUID()}@example.invalid`);
  const [challenge] = await Promise.all([auth.waitForResponse(response => new URL(response.url()).pathname === "/v1/auth/challenges"), auth.locator('form button[type="submit"]').click()]);
  assert.equal(challenge.status(), 202);
  const mail = JSON.parse(await readFile(path.join(isolated.directory, "mailbox", (await challenge.json()).challenge_id + ".json"), "utf8"));
  await auth.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]); await auth.locator('form button[type="submit"]').click();
  await auth.getByRole("link", { name: /Authorize & return|授權並返回應用/ }).click();
  async function api(url, method = "GET", body) {
    const response = await page.evaluate(async input => window.copyPasteBridge.request(input.url, {
      method: input.method, ...(input.body === undefined ? {} : { body: input.body }), headers: { "idempotency-key": input.key },
    }), { url, method, body, key: randomUUID() });
    assert.ok(response.status >= 200 && response.status < 300, `${method} ${url}: ${response.status} ${JSON.stringify(response.body)}`); return response.body;
  }
  await until(() => page.evaluate(async () => (await window.copyPasteBridge.request("/v1/session/context", {})).status), status => status === 200, "Desktop native session");
  await auth.close();
  await page.locator('input[name="name"]').fill("Harbour Studio · Native demo");
  await page.locator('input[name="project_name"]').fill("Approved launch");
  await page.getByRole("button", { name: "Create workspace & continue", exact: true }).click();
  const identity = await until(() => api("/v1/session/context"), value => value.memberships?.length === 1, "native onboarding context");
  const tenant = identity.memberships[0].id, project = (await api(`/v1/tenants/${tenant}/projects`)).items[0].id,
    base = `/v1/tenants/${tenant}/projects/${project}/publications`, landing = `http://localhost:4317/app/publications?tenant=${tenant}&project=${project}`;
  await api(`/v1/tenants/${tenant}/demo-credit`, "POST", {});
  await system.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Explicit synthetic native publishing fixture; no payment received',$2)", [tenant, defaults.business]);
  pass("Actual packaged Desktop completes browser OTP/PKCE and native workspace onboarding");

  stage = "actual browser account setup for native customer";
  await main.goto(landing); await main.getByRole("button", { name: "Connect Meta account", exact: true }).click();
  await main.getByRole("button", { name: "授權模擬帳戶", exact: true }).click();
  await main.waitForURL(url => url.searchParams.get("publication") === "connected");
  const card = main.locator(".publication-account").filter({ hasText: "Facebook Page" }).first();
  await card.locator(".publication-account-select").click(); await card.getByRole("button", { name: "Account & project scope", exact: true }).click();
  const dialog = main.getByRole("dialog");
  for (const checkbox of await dialog.locator('input[type="checkbox"]').all()) await checkbox.check();
  await dialog.getByRole("button", { name: "Save selected scope", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
  await main.getByRole("button", { name: "Set publishing policy", exact: true }).click();
  await dialog.getByLabel("Enable publishing for this account", { exact: true }).check();
  await dialog.getByLabel("Maximum in 24 hours", { exact: true }).fill("100");
  await dialog.getByRole("button", { name: "Save publishing policy", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
  assert.equal(system.publicationFixture.calls.length, 0);
  pass("Native customer explicitly connects a synthetic account and grants project scope and per-operation policy in Web");

  stage = "actual native protected image and frameless presentation";
  const { createCanvas } = createRequire(path.join(platform, "package.json"))("@napi-rs/canvas"), canvas = createCanvas(800, 800), draw = canvas.getContext("2d");
  draw.fillStyle = "#1f5eff"; draw.fillRect(0, 0, 800, 800); draw.fillStyle = "#fff"; draw.font = "bold 70px sans-serif";
  draw.fillText("Good work.", 50, 340); draw.fillText("Ready to go.", 50, 440); draw.font = "24px sans-serif"; draw.fillText("COPYPASTE · NATIVE DEMO", 50, 740);
  const asset = await system.db.tx(tx => saveAsset(tx, system.storage, { tenant, project, user: identity.user.id,
    name: "native-launch.png", mime: "image/png", bytes: canvas.toBuffer("image/png") }), tenant, false, identity.user.id);
  let captureWork = Promise.resolve();
  const serial = action => { const next = captureWork.then(action); captureWork = next.then(() => undefined, () => undefined); return next; };
  const capture = (jpeg = false) => serial(async () => Buffer.from(await electron.evaluate(async ({ BrowserWindow }, jpeg) => {
    const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage(); return (jpeg ? image.toJPEG(75) : image.toPNG()).toString("base64");
  }, jpeg), "base64"));
  const shot = async name => screenshots.push(await saveWorkmateScreenshot("desktop-publication-125", "native-publications-" + attempt, name,
    await capture(), "Actual unsigned packaged Electron publishing window and native media; account and image fixtures explicitly synthetic.", delivery));
  await page.evaluate(route => { location.hash = route; }, `/app/publications?tenant=${tenant}&project=${project}`);
  await page.getByRole("heading", { name: "Good work. Ready to go live.", exact: true }).waitFor();
  await page.getByLabel("Publication format", { exact: true }).selectOption("facebook_photo");
  recording = new WorkmateRecording("desktop-publication-125", "native-preview-and-confirm", "native-publications-" + attempt,
    () => capture(true), "Actual packaged Electron customer edits, reviews protected native media and explicitly confirms a synthetic publication.", delivery);
  await recording.start();
  const caption = "Approved native launch · CopyPaste · " + randomUUID();
  await page.getByLabel("Publication text", { exact: true }).fill(caption);
  await page.locator(".publication-asset-picker").getByRole("button").click();
  await page.getByRole("button", { name: "Preview outgoing content", exact: true }).click();
  const image = page.locator('img[src^="workmate-media:"]').first(); await image.waitFor();
  await image.evaluate(async node => { await node.decode(); if (node.naturalWidth !== 800 || node.naturalHeight !== 800) throw new Error("Native protected image dimensions differ"); });
  assert.equal(system.publicationFixture.calls.length, 0);
  await shot("protected-image-preview");
  pass("Actual Electron workmate-media protocol renders the selected protected image without exposing an HTTP Bearer URL");
  for (const width of [1000, 1240, 1440]) await serial(async () => {
    await electron.evaluate(({ BrowserWindow }, width) => { const win = BrowserWindow.getAllWindows()[0]; win.show(); win.setSize(width, 980); }, width);
    await page.waitForFunction(value => innerWidth === value, width);
    const native = await electron.evaluate(({ BrowserWindow, Menu }) => { const win = BrowserWindow.getAllWindows()[0]; return { bounds: win.getBounds(), content: win.getContentBounds(), menu: Menu.getApplicationMenu() === null, menu_visible: win.isMenuBarVisible() }; });
    const view = await page.evaluate(() => ({ width: innerWidth, horizontal: document.documentElement.scrollWidth > innerWidth,
      visible_scrollbars: [...document.querySelectorAll("body *")].filter(node => node.getClientRects().length && node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY) && getComputedStyle(node).scrollbarWidth !== "none" && getComputedStyle(node, "::-webkit-scrollbar").display !== "none").map(node => ({ tag: node.tagName, class: node.className })) }));
    assert.deepEqual(native.bounds, native.content); assert.equal(native.menu, true); assert.equal(native.menu_visible, false);
    assert.equal(view.horizontal, false); assert.deepEqual(view.visible_scrollbars, []); layouts.push({ component: "native-desktop", ...view, native });
  });
  await shot("frameless-publishing-1440");
  pass("Actual native window has no frame/menu, horizontal overflow or visible vertical scroll rails at three OS window widths");
  stage = "actual native customer confirmation and provider receipt";
  await page.getByRole("button", { name: "Next: review confirmation", exact: true }).click();
  const inspector = page.locator(".publication-inspector"), approval = inspector.getByLabel("I approve publishing this exact content to this account.", { exact: true });
  await approval.waitFor(); assert.equal(await approval.isChecked(), false);
  assert.equal(await inspector.getByRole("button", { name: "Confirm and publish", exact: true }).isDisabled(), true);
  const operation = (await api(base + "/operations?limit=20")).items[0];
  await advancePublications(system.db, system.storage, { limit: 2, pollIntervalMs: 0 }); assert.equal(system.publicationFixture.calls.length, 0);
  await approval.check(); await inspector.getByRole("button", { name: "Confirm and publish", exact: true }).click();
  await until(() => api(base + "/operations/" + operation.id), value => value.state === "queued", "native consent committed");
  let result;
  for (let step = 0; step < 40; step++) { result = await api(base + "/operations/" + operation.id); if (result.state === "succeeded") break; await advancePublications(system.db, system.storage, { limit: 1, pollIntervalMs: 0 }); }
  assert.equal(result.state, "succeeded");
  assert.equal(system.publicationFixture.calls.filter(call => ["feed", "videos", "media_publish"].includes(call.edge)).length, 1);
  await inspector.getByText("Publication confirmed by provider", { exact: true }).waitFor(); await shot("native-publication-receipt"); await stopRecording();
  pass("Unchecked native consent cannot dispatch; explicit customer confirmation creates one public write and a visible receipt");

  stage = "actual native Chrome Side Panel identity and read-only publication";
  cdp = await context.browser().newBrowserCDPSession(); const initialWidth = await main.evaluate(() => innerWidth), tabs = context.pages().length;
  const target = (await cdp.send("Target.getTargets", { filter: [{}] })).targetInfos.find(item => item.type === "tab" && item.url.startsWith("http://localhost:4317")); assert.ok(target);
  await until(() => worker.evaluate(() => chrome.sidePanel.getPanelBehavior()), value => value.openPanelOnActionClick, "toolbar native Side Panel binding");
  await cdp.send("Extensions.triggerAction", { id: extensionId, targetId: target.targetId });
  const panelContext = (await until(() => worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] })), value => value.length === 1, "native Side Panel context"))[0];
  assert.equal(panelContext.documentUrl, `chrome-extension://${extensionId}/sidepanel.html`);
  assert.equal((await worker.evaluate(() => chrome.sidePanel.getLayout())).side, "right");
  await until(() => main.evaluate(() => innerWidth), value => value < initialWidth - 250, "right dock consumes actual browser width"); assert.equal(context.pages().length, tabs);
  const panelTarget = await until(async () => (await cdp.send("Target.getTargets", { filter: [{}] })).targetInfos.find(item => item.type === "page" && item.url === panelContext.documentUrl), Boolean, "native panel CDP target");
  panel = await attachTarget(cdp, panelTarget.targetId);
  await until(() => evaluate("document.readyState==='complete' && !document.querySelector('#sign-in').disabled"), Boolean, "native sign-in ready");
  const popupEvent = context.waitForEvent("page"); await evaluate("document.querySelector('#sign-in').click()"); const popup = await popupEvent;
  await popup.getByRole("link", { name: /Authorize & return|授權並返回應用/ }).click();
  await until(() => evaluate("!document.querySelector('#workspace').hidden"), Boolean, "Side Panel PKCE authorized"); await popup.close().catch(() => {});
  await until(() => evaluate("document.querySelector('#project').value"), value => value === project, "native selected project");
  pass("Actual toolbar opens the native right Side Panel without another tab; independent extension PKCE authorizes the same customer");
  await evaluate("document.querySelector('#workspace-tools').open=true; document.querySelector('#publication-workspace').open=true");
  const selector = '[data-publication="' + operation.id + '"]';
  await until(() => evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), Boolean, "actual publication directory");
  assert.equal(await evaluate(`document.querySelector('#publication-workspace').textContent.includes(${JSON.stringify(caption)})`), false);
  const panelShot = async name => { const value = await panel.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); screenshots.push(await saveWorkmateScreenshot("extension-publication-125", "native-publications-" + attempt, name, Buffer.from(value.data, "base64"), "Actual native Chrome right Side Panel publication review; synthetic account and native customer identity.", delivery)); };
  recording = new WorkmateRecording("extension-publication-125", "native-panel-review-and-handoff", "native-publications-" + attempt,
    async () => Buffer.from((await panel.send("Page.captureScreenshot", { format: "jpeg", quality: 75, captureBeyondViewport: false })).data, "base64"),
    "Actual native right Side Panel explicitly reads private publication content and hands the exact project and operation to Web.", delivery);
  await recording.start();
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).querySelector('button').click()`);
  await until(() => evaluate(`document.querySelector('.publication-detail').textContent.includes(${JSON.stringify(caption)})`), Boolean, "explicit private publication detail");
  const panelLayout = await evaluate("({width:innerWidth,horizontal:document.documentElement.scrollWidth>innerWidth,confirmButtons:[...document.querySelectorAll('#publication-workspace button')].filter(n=>n.textContent==='Confirm and publish').length})");
  assert.equal(panelLayout.horizontal, false); assert.equal(panelLayout.confirmButtons, 0); layouts.push({ component: "native-side-panel", ...panelLayout });
  await panelShot("explicit-private-review");
  pass("Native Side Panel lists metadata without auto-reading the caption; explicit detail shows authorized content with no publication confirmation control");
  const handoffEvent = context.waitForEvent("page");
  await evaluate("[...document.querySelectorAll('#publication-workspace button')].find(n=>n.textContent==='Review media and publication').click()");
  const handoff = await handoffEvent; await handoff.waitForURL(url => url.pathname === "/app/publications");
  const handoffURL = new URL(handoff.url());
  assert.equal(handoffURL.origin, "http://localhost:4317"); assert.equal(handoffURL.searchParams.get("tenant"), tenant);
  assert.equal(handoffURL.searchParams.get("project"), project); assert.equal(handoffURL.searchParams.get("operation"), operation.id);
  assert.deepEqual([...handoffURL.searchParams.keys()].sort(), ["operation", "project", "tenant"]); assert.equal(handoffURL.hash, "");
  await handoff.close(); await stopRecording();
  pass("Actual Side Panel handoff opens only the fixed Web origin and exact UUID scope, without credentials or another publication");
  await evaluate("document.querySelector('#publication-workspace').open=false");
  await until(() => evaluate("document.querySelector('.publication-detail').textContent"), value => value === "", "fold clears private content");
  await evaluate("document.querySelector('#publication-workspace').open=true");
  await until(() => evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), Boolean, "reopened directory");
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).querySelector('button').click()`);
  await until(() => evaluate(`document.querySelector('.publication-detail').textContent.includes(${JSON.stringify(caption)})`), Boolean, "reopened explicit detail");
  await system.db.control.query("UPDATE assets SET retention_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [asset.id]);
  await until(() => evaluate(`document.querySelector('.publication-detail').textContent.includes(${JSON.stringify(caption)})`), value => value === false, "source withdrawal clears panel private content");
  await page.locator('.publication-inspector img[src^="workmate-media:"]').waitFor({ state: "hidden" });
  await panelShot("source-withdrawn");
  pass("Folding clears private detail; actual source expiry withdraws native Desktop media and Side Panel private content");
  await page.evaluate(() => window.copyPasteBridge.signOut());
  await until(() => page.evaluate(async () => (await window.copyPasteBridge.request("/v1/session/context", {})).status), status => status === 401, "native sign-out revokes session");
  assert.equal(await page.locator('img[src^="workmate-media:"]').count(), 0);
  const after = (await system.db.control.query("SELECT (SELECT count(*) FROM tasks)::text AS tasks,(SELECT count(*) FROM reservations)::text AS reservations,(SELECT count(*) FROM ai_gateway_requests)::text AS gateway")).rows[0];
  assert.deepEqual(after, before); modelCalls = 0;
  pass("Desktop sign-out withdraws native media and session authority; client review adds no AI task, reservation or model request");
} catch (failure) {
  errors.push(stage + ": " + String(failure)); console.error(errors.at(-1)); process.exitCode = 1;
  if (failurePage && !failurePage.isClosed()) try { screenshots.push(await saveWorkmateScreenshot("desktop-publication-125", "native-publications-" + attempt,
    "failed-current-stage", await failurePage.screenshot(), "Actual failure state, not a passing acceptance capture.", delivery)); } catch {}
} finally {
  try { await stopRecording(); } catch (failure) { errors.push("recording cleanup: " + String(failure)); }
  if (panel) try { await panel.close(); } catch (failure) { errors.push("panel cleanup: " + String(failure)); }
  if (cdp) await cdp.detach().catch(() => {});
  if (context) try { await context.close(); browserClosed = true; } catch (failure) { errors.push("browser cleanup: " + String(failure)); }
  if (electron) try { const pid = electron.process().pid; await electron.close(); assert.throws(() => process.kill(pid, 0)); desktopClosed = true; } catch (failure) { errors.push("Desktop cleanup: " + String(failure)); }
  if (system) try { await system.app.close(); apiClosed = true; } catch (failure) { errors.push("API cleanup: " + String(failure)); }
  if (isolated) try { await isolated.cleanup(); fixtureClosed = true; } catch (failure) { errors.push("fixture cleanup: " + String(failure)); }
  const passed = !errors.length && browserClosed && desktopClosed && apiClosed && fixtureClosed;
  await writeFile(prefix + "-journey.json", JSON.stringify({ at: new Date().toISOString(), status: passed ? "passed" : "failed", stage,
    checks, errors, screenshots, recordings, layouts, model_calls: modelCalls, browser_closed: browserClosed, desktop_closed: desktopClosed, api_closed: apiClosed, fixture_closed: fixtureClosed,
    limits: ["Owned synthetic account/media fixtures", "Unsigned development directory package; no signed installer acceptance", "No new native Codex publication-tool invocation or full professional-role acceptance"] }, null, 2) + "\n", { flag: "wx" });
  if (!passed) process.exitCode = 1;
}
