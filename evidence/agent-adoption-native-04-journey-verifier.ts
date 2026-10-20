import {
  _electron,
  chromium,
  type ElectronApplication,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "playwright";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { captureNativeSurfaces } from "./native-surface-integrity.mjs";

const delivery = process.cwd(),
  root = path.resolve(".."),
  platform = path.join(root, "copypaste-platform"),
  desktop = path.join(root, "copypaste-desktop"),
  extension = path.join(root, "copypaste-extension"),
  attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const owned = path.join(delivery, ".data/agent-adoption-native", randomUUID()),
  artifactsOptions = {
    desktop,
    extension,
    executable: path.join(
      desktop,
      "release/adoption-54/win-unpacked/CopyPaste.exe",
    ),
    packaged: true,
  },
  checks: any[] = [],
  errors: string[] = [],
  screenshots: any[] = [],
  inspection: any = {},
  hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
let isolated: any,
  system: any,
  app: ElectronApplication | undefined,
  browser: Browser | undefined,
  context: BrowserContext | undefined,
  desktopClosed = false,
  browserClosed = false,
  extensionClosed = false,
  apiClosed = false,
  fixtureClosed = false,
  artifactsUnchanged = false,
  testedArtifacts: any,
  stage = "setup";
const pass = (name: string) => {
  checks.push({ name, status: "passed" });
  console.log("PASS: " + name);
};
async function until<T>(
  read: () => Promise<T>,
  ok: (v: T) => boolean,
  description: string,
): Promise<T> {
  const limit = Date.now() + 20000;
  do {
    const v = await read();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 100));
  } while (Date.now() < limit);
  throw new Error("Timed out: " + description);
}
async function attachTarget(parent: CDPSession, targetId: string) {
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
    const message = JSON.parse(event.message),
      entry = pending.get(message.id);
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
        }, 15000);
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
        entry.reject(new Error("Owned side panel closed"));
      }
      pending.clear();
      await parent
        .send("Target.detachFromTarget", { sessionId })
        .catch(() => {});
    },
  };
}
async function mailLogin(page: Page, email: string) {
  await page.locator('input[name="email"]').fill(email);
  const [r] = await Promise.all([
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/v1/auth/challenges",
    ),
    page.locator('form button[type="submit"]').click(),
  ]);
  assert.equal(r.status(), 202);
  const challenge = await r.json(),
    mail = JSON.parse(
      await readFile(
        path.join(
          isolated.directory,
          "mailbox",
          challenge.challenge_id + ".json",
        ),
        "utf8",
      ),
    );
  assert.equal(mail.to, email);
  await page
    .locator('input[name="code"]')
    .fill(mail.text.match(/\b\d{6}\b/)[0]);
  const [session] = await Promise.all([
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/v1/auth/sessions",
    ),
    page.locator('form button[type="submit"]').click(),
  ]);
  assert.equal(session.status(), 201);
  return session.json();
}
async function shot(page: Page, repo: string, name: string) {
  const file = path.join(
    root,
    repo,
    "assets/screenshots",
    `adoption-native-${attempt}-${name}.png`,
  );
  await mkdir(path.dirname(file), { recursive: true });
  await assert.rejects(access(file), (e: any) => e.code === "ENOENT");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: file,
    animations: "disabled",
    fullPage: false,
  });
  screenshots.push({
    path: path.relative(root, file).replaceAll("\\", "/"),
    sha256: hash(await readFile(file)),
    edited: false,
  });
}
const deadline = setTimeout(() => {
  errors.push("Owned native journey timed out");
  void app?.close();
  void browser?.close();
  void context?.close();
}, 300000);
try {
  testedArtifacts = await captureNativeSurfaces(artifactsOptions);
  const { isolatedTestEnvironment } = await import(
      pathToFileURL(path.join(platform, "tests/native-test-environment.ts"))
        .href
    ),
    { buildApp } = await import(
      pathToFileURL(path.join(platform, "src/server.ts")).href
    ),
    { loadConfig } = await import(
      pathToFileURL(path.join(platform, "src/config.ts")).href
    );
  process.chdir(platform);
  isolated = await isolatedTestEnvironment();
  system = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEV_MAILBOX: "true",
      WORKER_ENABLED: "false",
      DEMO_MODE: "true",
    }),
    { worker: false },
  );
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  // Keep the platform working directory while its catalog verifies relative skill paths.
  const email = `native-adoption-${randomUUID()}@example.invalid`;
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN,
    headless: true,
    args: ["--disable-gpu"],
  });
  const authContext = await browser.newContext();
  await authContext.addInitScript(() =>
    localStorage.setItem("cp_locale", "en"),
  );
  const auth = await authContext.newPage();
  await auth.goto("http://localhost:4317/login");
  const session = await mailLogin(auth, email),
    cookie = (await authContext.cookies()).find(
      (c) => c.name === "cp_session",
    )!;
  async function call(method: string, url: string, body?: unknown) {
    const r = await system.app.inject({
      method,
      url,
      headers: {
        origin: "http://localhost:4317",
        cookie: `cp_session=${cookie.value}`,
        "x-csrf-token": session.csrf_token,
        "idempotency-key": randomUUID(),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal(r.statusCode, 200, JSON.stringify(r.json()));
    return r.json();
  }
  const created = await call("POST", "/v1/tenants", {
      name: "Native version review",
      project_name: "Side panel and desktop",
    }),
    tenant = created.tenant.id,
    project = created.project.id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  const agent = await call("POST", base + "/agents", {
    name: "Native campaign analyst",
    role_key: "marketing-analyst",
    instructions: "Initial brief",
    brand_id: null,
  });
  await call("POST", base + "/conversations", {
    name: "Original native conversation",
    agent_id: agent.id,
  });
  stage = "packaged frameless desktop";
  app = await _electron.launch({
    executablePath: artifactsOptions.executable,
    args: ["--disable-gpu"],
    timeout: 30000,
    env: { ...process.env, COPYPASTE_USER_DATA: path.join(owned, "desktop") },
  });
  const page = await app.firstWindow({ timeout: 30000 });
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForURL(/file:.*index\.html/);
  await page.evaluate(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Minimize window", exact: true })
    .waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({
      x: 60,
      y: 40,
      width: 1440,
      height: 980,
    }),
  );
  inspection.desktop = await app.evaluate(({ BrowserWindow, Menu }) => {
    const w = BrowserWindow.getAllWindows()[0],
      p = w.webContents.getLastWebPreferences();
    return {
      no_application_menu: Menu.getApplicationMenu() === null,
      menu_bar_visible: w.isMenuBarVisible(),
      auto_hide_menu: w.autoHideMenuBar,
      bounds: w.getBounds(),
      content_bounds: w.getContentBounds(),
      preferences: {
        contextIsolation: p.contextIsolation,
        nodeIntegration: p.nodeIntegration,
        sandbox: p.sandbox,
      },
    };
  });
  assert.equal(inspection.desktop.no_application_menu, true);
  assert.equal(inspection.desktop.menu_bar_visible, false);
  assert.equal(inspection.desktop.auto_hide_menu, true);
  assert.deepEqual(
    inspection.desktop.bounds,
    inspection.desktop.content_bounds,
  );
  assert.deepEqual(inspection.desktop.preferences, {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  });
  const geometry = await page.evaluate(() => {
    const b = document.querySelector("#copypaste-titlebar")!,
      r = document.querySelector("#root")!;
    return {
      bar_height: b.getBoundingClientRect().height,
      root_y: r.getBoundingClientRect().y,
      drag: getComputedStyle(b).getPropertyValue("-webkit-app-region"),
      controls: [...b.querySelectorAll("button")].map((e) =>
        getComputedStyle(e).getPropertyValue("-webkit-app-region"),
      ),
      node_exposed: typeof (globalThis as any).require !== "undefined",
    };
  });
  assert.equal(geometry.bar_height, 40);
  assert.equal(geometry.root_y, 40);
  assert.equal(geometry.drag, "drag");
  assert.deepEqual(geometry.controls, ["no-drag", "no-drag", "no-drag"]);
  assert.equal(geometry.node_exposed, false);
  inspection.desktop.geometry = geometry;
  await page.keyboard.press("Alt");
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isMenuBarVisible(),
    ),
    false,
  );
  pass(
    "new packaged Desktop has no native frame, application menu or Alt menu; custom title bar and sandbox isolation are intact",
  );
  await page
    .getByRole("button", { name: "Maximize window", exact: true })
    .click();
  await until(
    () =>
      app!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isMaximized(),
      ),
    Boolean,
    "native maximize",
  );
  await page
    .getByRole("button", { name: "Restore window", exact: true })
    .click();
  await until(
    () =>
      app!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isMaximized(),
      ),
    (v) => !v,
    "native restore",
  );
  await page
    .getByRole("button", { name: "Minimize window", exact: true })
    .click();
  await until(
    () =>
      app!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isMinimized(),
      ),
    Boolean,
    "native minimize",
  );
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.restore();
    w.focus();
  });
  pass(
    "custom maximize, restore and minimize controls change the actual native window state",
  );
  // Capture only this owned app's external authorization URL; complete its real PKCE callback.
  await app.evaluate(({ shell }) => {
    shell.openExternal = async (url: string) => {
      (globalThis as any).__adoptionAuthURL = url;
    };
  });
  await page
    .getByRole("button", { name: "Sign in securely in your browser" })
    .click({ noWaitAfter: true });
  const url = await until<string>(
    () => app!.evaluate(() => (globalThis as any).__adoptionAuthURL ?? ""),
    Boolean,
    "desktop PKCE URL",
  );
  await auth.goto(url);
  await auth
    .getByRole("link", { name: /Authorize & return|授權並返回應用/ })
    .click();
  await page.waitForURL("**#/app");
  await page.locator(".sidebar").waitFor();
  pass(
    "packaged Desktop signs in through the actual browser session, PKCE authorization and localhost callback",
  );
  await page.evaluate(() => {
    location.hash = "/app/specialists";
  });
  const card = page
    .locator(".specialist-card")
    .filter({
      has: page.getByRole("heading", {
        name: "Native campaign analyst",
        exact: true,
      }),
    });
  await card.getByRole("button", { name: "Settings", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Working instructions", { exact: true })
    .fill("Native explicitly reviewed brief");
  await dialog
    .getByRole("button", { name: "Compare changes", exact: true })
    .click();
  await dialog.locator(".adoption-columns").waitFor();
  assert.equal(
    await dialog
      .getByRole("button", { name: "Confirm adoption and save", exact: true })
      .isEnabled(),
    false,
  );
  assert.ok((await dialog.boundingBox())!.y >= 40);
  await shot(page, "copypaste-desktop", "comparison-en");
  assert.equal(
    (
      await system.db.control.query("SELECT version FROM agents WHERE id=$1", [
        agent.id,
      ])
    ).rows[0].version,
    1,
  );
  await dialog
    .getByRole("checkbox", {
      name: "I have reviewed these models and rates",
      exact: true,
    })
    .check();
  await dialog
    .getByRole("button", { name: "Confirm adoption and save", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    (
      await system.db.control.query("SELECT version FROM agents WHERE id=$1", [
        agent.id,
      ])
    ).rows[0].version,
    2,
  );
  pass(
    "real packaged Desktop compares models, effort and rates above the native shell, then creates exactly one version after explicit consent",
  );
  await page.evaluate(() => {
    localStorage.setItem("cp_locale", "zh-HK");
    localStorage.setItem("cp_theme", "dark");
  });
  await page.reload();
  await card.getByRole("button", { name: "設定", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("工作要求", { exact: true }).fill("繁中原生確認");
  await dialog.getByRole("button", { name: "比較變更", exact: true }).click();
  await dialog.locator(".adoption-columns").waitFor();
  await page.getByRole("button", { name: "關閉視窗", exact: true }).waitFor();
  assert.ok((await dialog.boundingBox())!.y >= 40);
  await shot(page, "copypaste-desktop", "comparison-dark-zh");
  pass(
    "Traditional Chinese and dark comparison stays below the custom title bar with an accessible close-window control",
  );
  const closing = app.waitForEvent("close");
  await page
    .getByRole("button", { name: "關閉視窗", exact: true })
    .click({ noWaitAfter: true })
    .catch((e) => {
      if (!/closed/i.test(String(e))) throw e;
    });
  await closing;
  desktopClosed = true;
  app = undefined;
  await authContext.close();
  await browser.close();
  browserClosed = true;
  browser = undefined;
  pass("custom close-window button exits the owned packaged Desktop");
  stage = "actual Chrome Side Panel";
  const id = (
      await readFile(path.join(extension, "extension-id.txt"), "utf8")
    ).trim(),
    manifest = JSON.parse(
      await readFile(path.join(extension, "dist/manifest.json"), "utf8"),
    );
  assert.equal(manifest.side_panel.default_path, "sidepanel.html");
  assert.equal(manifest.action.default_popup, undefined);
  context = await chromium.launchPersistentContext(path.join(owned, "chrome"), {
    executablePath: process.env.CHROME_BIN,
    headless: false,
    viewport: null,
    timeout: 20000,
    args: [
      "--disable-gpu",
      "--window-size=1480,980",
      "--enable-unsafe-extension-debugging",
      "--disable-extensions-except=" + path.join(extension, "dist"),
      "--load-extension=" + path.join(extension, "dist"),
    ],
  });
  await context.addInitScript(() => localStorage.setItem("cp_locale", "en"));
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  assert.ok(worker.url().includes(id));
  await until(
    () => worker.evaluate(() => chrome.sidePanel.getPanelBehavior()),
    (v) => v.openPanelOnActionClick === true,
    "side panel action behavior",
  );
  const main = context.pages()[0];
  await main.goto("http://localhost:4317/");
  const width = await main.evaluate(() => innerWidth),
    tabs = context.pages().length,
    cdp = await context.browser()!.newBrowserCDPSession();
  const target = (
    await cdp.send("Target.getTargets", { filter: [{}] })
  ).targetInfos.find(
    (t) => t.type === "tab" && t.url.startsWith("http://localhost:4317"),
  );
  assert.ok(target);
  await (cdp as any).send("Extensions.triggerAction", {
    id,
    targetId: target.targetId,
  });
  const native = await until(
    () =>
      worker.evaluate(() =>
        chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] }),
      ),
    (v) => v.length === 1,
    "actual native SIDE_PANEL",
  );
  assert.equal(
    native[0].documentUrl,
    `chrome-extension://${id}/sidepanel.html`,
  );
  assert.equal(context.pages().length, tabs);
  const narrow = await until(
    () => main.evaluate(() => innerWidth),
    (v) => v < width - 250,
    "page narrows beside native panel",
  );
  const layout = await worker.evaluate(() => chrome.sidePanel.getLayout());
  assert.equal(layout.side, "right");
  inspection.extension = {
    browser: context.browser()!.version(),
    browser_executable: process.env.CHROME_BIN,
    browser_executable_sha256: hash(await readFile(process.env.CHROME_BIN!)),
    side: layout.side,
    main_width_before: width,
    main_width_after: narrow,
    native_context_type: native[0].contextType,
    trigger: "actual browser toolbar action via Extensions.triggerAction",
    extra_popup_or_tab: false,
  };
  pass(
    "clicking the real extension toolbar action opens a right-hand native SIDE_PANEL, reduces page width and creates no popup or extra tab",
  );
  const panelTarget = await until(
    async () =>
      (await cdp.send("Target.getTargets", { filter: [{}] })).targetInfos.find(
        (t) => t.type === "page" && t.url === native[0].documentUrl,
      ),
    Boolean,
    "native panel document target",
  );
  assert.ok(panelTarget);
  const panel = await attachTarget(cdp, panelTarget.targetId);
  async function evaluate(expression: string) {
    const r = await panel.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      userGesture: true,
      awaitPromise: true,
    });
    assert.equal(r.exceptionDetails, undefined);
    return r.result.value;
  }
  async function panelShot(name: string) {
    const file = path.join(
      extension,
      "assets/screenshots",
      `adoption-native-${attempt}-${name}.png`,
    );
    await mkdir(path.dirname(file), { recursive: true });
    await assert.rejects(access(file), (e: any) => e.code === "ENOENT");
    const result = await panel.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    await writeFile(file, Buffer.from(result.data, "base64"), { flag: "wx" });
    screenshots.push({
      path: path.relative(root, file).replaceAll("\\", "/"),
      sha256: hash(await readFile(file)),
      edited: false,
      native_context: "SIDE_PANEL",
    });
  }
  try {
    const metrics = await until(
      () =>
        evaluate(
          "({width:innerWidth,scroll:document.documentElement.scrollWidth,ready:document.readyState,fonts:document.fonts.status})",
        ),
      (v) => v.ready === "complete" && v.fonts === "loaded" && v.width >= 300,
      "native panel fonts and layout",
    );
    assert.ok(metrics.scroll <= metrics.width);
    inspection.extension.metrics = metrics;
    const popupEvent = context.waitForEvent("page");
    await evaluate("document.querySelector('#sign-in').click()");
    const popup = await popupEvent;
    await popup.waitForLoadState();
    await mailLogin(popup, email);
    await popup
      .getByRole("link", { name: /Authorize & return|授權並返回應用/ })
      .click();
    await until(
      () =>
        evaluate(
          "document.querySelector('#workspace').hidden === false && document.querySelector('#project').options.length>0",
        ),
      Boolean,
      "native panel signed in",
    );
    await until(
      () => evaluate("document.querySelector('#review-models').textContent.trim()"),
      (v) => typeof v === "string" && v.length > 0,
      "review button label",
    );
    await panelShot("sidepanel-zh");
    const label = await evaluate(
      "document.querySelector('#review-models').textContent.trim()",
    );
    assert.equal(label, "檢視模型與費率版本");
    await evaluate("document.querySelector('#locale').click()");
    await until(
      () => evaluate("document.querySelector('#review-models').textContent.trim()"),
      (v) => v === "Review model and rate versions",
      "English model review label",
    );
    await panelShot("sidepanel-en");
    pass(
      "actual native Side Panel completes email OTP and PKCE sign-in, renders the review entry in Traditional Chinese and English without horizontal overflow",
    );
    const opened = context.waitForEvent("page");
    await evaluate("document.querySelector('#review-models').click()");
    const workspace = await opened;
    await workspace.waitForURL("http://localhost:4317/app/specialists");
    await workspace
      .locator(".specialist-card")
      .filter({
        has: workspace.getByRole("heading", {
          name: "Native campaign analyst",
          exact: true,
        }),
      })
      .waitFor();
    const nativeCard = workspace
      .locator(".specialist-card")
      .filter({
        has: workspace.getByRole("heading", {
          name: "Native campaign analyst",
          exact: true,
        }),
      });
    await nativeCard
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    const review = workspace.getByRole("dialog");
    await review
      .getByLabel("Working instructions", { exact: true })
      .fill("Opened securely from native side panel");
    await review
      .getByRole("button", { name: "Compare changes", exact: true })
      .click();
    await review.locator(".adoption-columns").waitFor();
    assert.equal(
      await review
        .getByRole("button", { name: "Confirm adoption and save", exact: true })
        .isEnabled(),
      false,
    );
    await shot(workspace, "copypaste-extension", "workspace-comparison-en");
    assert.equal(
      (
        await system.db.control.query(
          "SELECT version FROM agents WHERE id=$1",
          [agent.id],
        )
      ).rows[0].version,
      2,
    );
    await workspace.close();
    await main.bringToFront();
    pass(
      "side-panel review button opens the company's exact specialist workspace; its authenticated comparison requires consent and leaves the previous native version unchanged",
    );
    await main.goto("http://localhost:4317/login");
    assert.equal(
      (
        await worker.evaluate(() =>
          chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] }),
        )
      )[0].contextId,
      native[0].contextId,
    );
    pass(
      "native Side Panel retains its document while the active browser page navigates",
    );
  } finally {
    await panel.close();
  }
  await (cdp as any).send("Extensions.triggerAction", {
    id,
    targetId: target.targetId,
  });
  await until(
    () =>
      worker.evaluate(() =>
        chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] }),
      ),
    (v) => v.length === 0,
    "toolbar closes actual side panel",
  );
  pass(
    "clicking the actual browser toolbar action again closes the native Side Panel",
  );
  await context.close();
  extensionClosed = true;
  context = undefined;
  assert.deepEqual(
    await captureNativeSurfaces(artifactsOptions),
    testedArtifacts,
  );
  artifactsUnchanged = true;
} catch (e) {
  errors.push(
    `${stage}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
  );
} finally {
  clearTimeout(deadline);
  if (app)
    await app
      .close()
      .then(() => {
        desktopClosed = true;
      })
      .catch(() => errors.push("Owned Desktop close failed"));
  if (browser)
    await browser
      .close()
      .then(() => {
        browserClosed = true;
      })
      .catch(() => errors.push("Owned authentication browser close failed"));
  if (context)
    await context
      .close()
      .then(() => {
        extensionClosed = true;
      })
      .catch(() => errors.push("Owned extension browser close failed"));
  if (system)
    await system.app
      .close()
      .then(() => {
        apiClosed = true;
      })
      .catch(() => errors.push("Owned API close failed"));
  if (isolated) {
    try {
      process.chdir(platform);
      await isolated.cleanup();
      fixtureClosed = true;
    } catch {
      errors.push("Owned fixture cleanup failed");
    }
  }
  process.chdir(delivery);
  const passed =
    errors.length === 0 &&
    desktopClosed &&
    browserClosed &&
    extensionClosed &&
    apiClosed &&
    fixtureClosed &&
    artifactsUnchanged;
  await writeFile(
    path.join(
      delivery,
      `evidence/agent-adoption-native-${attempt}-journey.json`,
    ),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: passed ? "passed" : "failed",
        scope:
          "New unsigned packaged frameless Desktop and real native Chrome Side Panel with actual identity, isolated PostgreSQL, model/rate review and labelled simulated AI; no installation, store publication or production qualification",
        checks,
        errors,
        inspection,
        screenshots,
        desktop_closed: desktopClosed,
        browser_closed: browserClosed,
        extension_closed: extensionClosed,
        owned_api_closed: apiClosed,
        isolated_database_dropped_or_deferred_fixture_queued: fixtureClosed,
        tested_artifacts: testedArtifacts,
        artifact_inventory_legacy_verifier_executed: false,
        artifacts_unchanged_after_run: artifactsUnchanged,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      passed,
      checks: checks.length,
      errors,
      desktop_closed: desktopClosed,
      browser_closed: browserClosed,
      extension_closed: extensionClosed,
      owned_api_closed: apiClosed,
    }),
  );
  process.exitCode = passed ? 0 : 1;
}
