import {
  _electron,
  chromium,
  type ElectronApplication,
  type Browser,
  type BrowserContext,
  type CDPSession,
} from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { emailCode } from "./qa-auth.js";

const run = randomUUID(),
  root = path.resolve(".."),
  desktop = path.join(root, "copypaste-desktop"),
  extension = path.join(root, "copypaste-extension");
const checks: { name: string; status: string }[] = [],
  errors: string[] = [];
const inspection: Record<string, any> = {};
let app: ElectronApplication | undefined,
  browser: Browser | undefined,
  context: BrowserContext | undefined;
let desktopClosed = false,
  browserClosed = false,
  extensionClosed = false;
const pass = (name: string) => {
  checks.push({ name, status: "passed" });
  console.log("PASS: " + name);
};
async function until<T>(
  read: () => Promise<T>,
  ok: (value: T) => boolean,
  description: string,
): Promise<T> {
  const deadline = Date.now() + 15_000;
  do {
    const value = await read();
    if (ok(value)) return value;
    await new Promise((r) => setTimeout(r, 100));
  } while (Date.now() < deadline);
  throw new Error("Timed out: " + description);
}

// Native side-panel documents are not ordinary browser tabs. Attach directly
// to their CDP target, preserving the real SIDE_PANEL context and dimensions.
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
  await mkdir(path.resolve(".data/native-surfaces", run), { recursive: true });
  const executable =
    process.env.COPYPASTE_DESKTOP_EXECUTABLE ??
    path.join(desktop, "node_modules/electron/dist/electron.exe");
  app = await _electron.launch({
    executablePath: executable,
    args: process.env.COPYPASTE_DESKTOP_EXECUTABLE ? [] : [desktop],
    env: {
      ...process.env,
      COPYPASTE_USER_DATA: path.resolve(
        ".data/native-surfaces",
        run,
        "desktop",
      ),
    },
  });
  const page = await app.firstWindow({ timeout: 30_000 });
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(20_000);
  await page.waitForURL(/file:.*index\.html/);
  await page.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Minimize window", exact: true })
    .waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setBounds({
      x: 60,
      y: 40,
      width: 1200,
      height: 820,
    });
  });
  const shell = await app.evaluate(({ BrowserWindow, Menu }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return {
      no_application_menu: Menu.getApplicationMenu() === null,
      menu_bar_visible: win.isMenuBarVisible(),
      auto_hide_menu: win.autoHideMenuBar,
      bounds: win.getBounds(),
      content_bounds: win.getContentBounds(),
      preferences: {
        contextIsolation:
          win.webContents.getLastWebPreferences().contextIsolation,
        nodeIntegration:
          win.webContents.getLastWebPreferences().nodeIntegration,
        sandbox: win.webContents.getLastWebPreferences().sandbox,
      },
    };
  });
  assert.equal(shell.no_application_menu, true);
  assert.equal(shell.menu_bar_visible, false);
  assert.equal(shell.auto_hide_menu, true);
  assert.deepEqual(shell.content_bounds, shell.bounds);
  assert.deepEqual(shell.preferences, {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  });
  const geometry = await page.evaluate(() => {
    const bar = document.querySelector("#copypaste-titlebar")!,
      root = document.querySelector("#root")!;
    return {
      bar_height: bar.getBoundingClientRect().height,
      root_y: root.getBoundingClientRect().y,
      drag: getComputedStyle(bar).getPropertyValue("-webkit-app-region"),
      controls: [...bar.querySelectorAll("button")].map((b) =>
        getComputedStyle(b).getPropertyValue("-webkit-app-region"),
      ),
      node_exposed: typeof (globalThis as any).require !== "undefined",
      window_ipc_exposed: "windowCommand" in (window as any).copyPasteBridge,
    };
  });
  assert.equal(geometry.bar_height, 40);
  assert.equal(geometry.root_y, 40);
  assert.equal(geometry.drag, "drag");
  assert.deepEqual(geometry.controls, ["no-drag", "no-drag", "no-drag"]);
  assert.equal(geometry.node_exposed, false);
  assert.equal(geometry.window_ipc_exposed, false);
  await page.keyboard.press("Alt");
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isMenuBarVisible(),
    ),
    false,
  );
  inspection.desktop = {
    executable_kind: process.env.COPYPASTE_DESKTOP_EXECUTABLE
      ? "packaged"
      : "source",
    shell,
    geometry,
  };
  pass(
    "real Electron window has no native non-client frame or application menu, including Alt; custom title bar reserves 40px and keeps sandbox isolation",
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
    "maximize",
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
    "restore",
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
    "minimize",
  );
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.restore();
    win.focus();
  });
  pass(
    "custom minimize, maximize and restore buttons change actual native window state and accessible labels",
  );
  const original = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBounds(),
  );
  const resize = page.locator('.cp-window-resize[data-edge="se"]');
  await resize.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  const resized = await until(
    () =>
      app!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].getBounds(),
      ),
    (v) => v.width === original.width + 10 && v.height === original.height + 10,
    "keyboard resize",
  );
  inspection.desktop.keyboard_resize = { original, resized };
  const corner = (await resize.boundingBox())!;
  await page.mouse.move(corner.x + 5, corner.y + 5);
  await page.mouse.down();
  await page.mouse.move(corner.x + 25, corner.y + 20, { steps: 3 });
  await page.mouse.up();
  const pointerResize = await until(
    () =>
      app!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].getBounds(),
      ),
    (v) => v.width === resized.width + 20 && v.height === resized.height + 15,
    "pointer corner resize",
  );
  const smaller = (await resize.boundingBox())!;
  await page.mouse.move(smaller.x + 5, smaller.y + 5);
  await page.mouse.down();
  await page.mouse.move(100, 100, { steps: 3 });
  await page.mouse.up();
  const minimum = await until(
    () =>
      app!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].getBounds(),
      ),
    (v) => v.width === 800 && v.height === 600,
    "minimum window dimensions",
  );
  assert.equal(minimum.x, original.x);
  assert.equal(minimum.y, original.y);
  inspection.desktop.pointer_resize = { pointerResize, minimum };
  await app.evaluate(
    ({ BrowserWindow }, bounds) =>
      BrowserWindow.getAllWindows()[0].setBounds(bounds),
    original,
  );
  const badSender = await app.evaluate(async ({ BrowserWindow }) => {
    const own = BrowserWindow.getAllWindows()[0],
      before = own.getBounds();
    const other = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
      },
    });
    try {
      await other.loadURL("data:text/html,<title>Owned IPC probe</title>");
      const rejected = await other.webContents.executeJavaScript(
        `require("electron").ipcRenderer.invoke("window:command","close").then(()=>false,()=>true)`,
      );
      await other.webContents.executeJavaScript(
        `require("electron").ipcRenderer.send("window:resize",{kind:"nudge",edge:"se",dx:50,dy:50})`,
      );
      await new Promise((r) => setTimeout(r, 100));
      return {
        rejected,
        before,
        after: own.getBounds(),
        alive: !own.isDestroyed(),
      };
    } finally {
      other.destroy();
    }
  });
  assert.equal(badSender.rejected, true);
  assert.equal(badSender.alive, true);
  assert.deepEqual(badSender.before, badSender.after);
  pass(
    "frameless keyboard and pointer resize honor 800x600 minimum dimensions; another renderer cannot close or resize the application through window IPC",
  );
  // Test the signed-in shared workspace below the native shell, including modal containment.
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
    headless: true,
  });
  const authContext = await browser.newContext();
  await app.evaluate(({ shell }) => {
    shell.openExternal = async (url: string) => {
      (globalThis as any).__surfaceAuthURL = url;
    };
  });
  await page
    .getByRole("button", { name: "Sign in securely in your browser" })
    .click({ noWaitAfter: true });
  const authURL = await until<string>(
    () => app!.evaluate(() => (globalThis as any).__surfaceAuthURL ?? ""),
    Boolean,
    "browser PKCE authorization URL",
  );
  const auth = await authContext.newPage();
  await auth.addInitScript(() => localStorage.setItem("cp_locale", "en"));
  await auth.goto(authURL);
  const user = JSON.parse(await readFile(".data/qa-user.json", "utf8"));
  await auth.locator('input[name="email"]').fill(user.email);
  const code = await emailCode(auth, () =>
    auth.locator('form button[type="submit"]').click(),
  );
  await auth.locator('input[name="code"]').fill(code);
  await auth.locator('form button[type="submit"]').click();
  await auth
    .getByRole("button", { name: /Authorize & return|授權並返回應用/ })
    .click();
  await page.waitForURL("**#/app");
  await page.locator(".sidebar").waitFor();
  assert.ok((await page.locator(".sidebar").boundingBox())!.y >= 40);
  await mkdir(path.join(desktop, "assets/screenshots"), { recursive: true });
  await page.screenshot({
    path: path.join(desktop, "assets/screenshots/18-frameless-workspace.png"),
    animations: "disabled",
  });
  await page.evaluate(() => {
    location.hash = "/app/analytics";
  });
  await page.getByRole("button", { name: "Import data", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.equal(
    await page.locator("#root").evaluate((e) => getComputedStyle(e).overflow),
    "hidden",
  );
  assert.ok((await dialog.boundingBox())!.y >= 40);
  assert.ok(
    await page
      .getByRole("button", { name: "Close window", exact: true })
      .isVisible(),
  );
  await page.screenshot({
    path: path.join(desktop, "assets/screenshots/19-frameless-dialog.png"),
    animations: "disabled",
  });
  pass(
    "real browser PKCE opens the workspace; fixed sidebar and modal remain below the custom title bar",
  );
  await page.evaluate(() => {
    document.documentElement.lang = "zh-Hant-HK";
    document.documentElement.dataset.theme = "dark";
  });
  await page.getByRole("button", { name: "關閉視窗", exact: true }).waitFor();
  const dark = await page
    .locator("#copypaste-titlebar")
    .evaluate((e) => getComputedStyle(e).backgroundColor);
  assert.equal(dark, "rgb(15, 19, 26)");
  await page.screenshot({
    path: path.join(desktop, "assets/screenshots/20-frameless-dark.png"),
    animations: "disabled",
  });
  pass(
    "custom title bar follows existing CopyPaste light/dark tokens and Chinese/English window-control labels",
  );
  const closed = app.waitForEvent("close");
  await page
    .getByRole("button", { name: "關閉視窗", exact: true })
    .click({ noWaitAfter: true })
    .catch((e) => {
      if (!/closed/i.test(String(e))) throw e;
    });
  await closed;
  desktopClosed = true;
  app = undefined;
  pass("custom close button exits the owned Electron application");
  await authContext.close();
  await browser.close();
  browserClosed = true;
  browser = undefined;

  const id = (
      await readFile(path.join(extension, "extension-id.txt"), "utf8")
    ).trim(),
    manifest = JSON.parse(
      await readFile(path.join(extension, "dist/manifest.json"), "utf8"),
    );
  assert.equal(manifest.side_panel.default_path, "sidepanel.html");
  assert.equal(manifest.action.default_popup, undefined);
  assert.ok(manifest.permissions.includes("sidePanel"));
  context = await chromium.launchPersistentContext(
    path.resolve(".data/native-surfaces", run, "chrome"),
    {
      executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
      headless: false,
      viewport: null,
      args: [
        "--window-size=1480,980",
        "--enable-unsafe-extension-debugging",
        "--disable-extensions-except=" + path.join(extension, "dist"),
        "--load-extension=" + path.join(extension, "dist"),
      ],
    },
  );
  let worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 20_000 }));
  assert.ok(worker.url().includes(id));
  await until(
    () => worker.evaluate(() => chrome.sidePanel.getPanelBehavior()),
    (b) => b.openPanelOnActionClick === true,
    "toolbar behavior",
  );
  const main = context.pages()[0];
  await main.goto("http://localhost:4317/");
  const beforeWidth = await main.evaluate(() => innerWidth),
    tabCount = context.pages().length;
  const cdp = await context.browser()!.newBrowserCDPSession();
  const tabTargets = await cdp.send("Target.getTargets", { filter: [{}] });
  const target = tabTargets.targetInfos.find(
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
    (items) => items.length === 1,
    "native SIDE_PANEL creation",
  );
  assert.equal(
    native[0].documentUrl,
    `chrome-extension://${id}/sidepanel.html`,
  );
  assert.equal(context.pages().length, tabCount);
  const afterWidth = await until(
    () => main.evaluate(() => innerWidth),
    (width) => width < beforeWidth - 250,
    "native panel docks beside page",
  );
  const layout = await worker.evaluate(() => chrome.sidePanel.getLayout());
  assert.equal(layout.side, "right");
  inspection.extension = {
    browser: context.browser()!.version(),
    action_trigger:
      "CDP Extensions.triggerAction on actual browser tab; no direct sidepanel.html tab or sidePanel.open substitute",
    side: layout.side,
    main_width_before: beforeWidth,
    main_width_after: afterWidth,
    native_context_type: native[0].contextType,
    normal_tab_count: tabCount,
  };
  pass(
    "browser extension action creates a real right-aligned SIDE_PANEL, shrinks the active page, and opens no popup or extra tab",
  );
  const panelTarget = (
    await cdp.send("Target.getTargets", { filter: [{}] })
  ).targetInfos.find(
    (t) => t.type === "page" && t.url === native[0].documentUrl,
  );
  assert.ok(panelTarget);
  const panel = await attachTarget(cdp, panelTarget.targetId);
  try {
    const metrics = await until(
      async () => {
        const result = await panel.send("Runtime.evaluate", {
          expression:
            "({width:innerWidth,scroll:document.documentElement.scrollWidth,ready:document.readyState,fonts:document.fonts.status,login:!!document.querySelector('#sign-in'),title:document.title})",
          returnByValue: true,
        });
        inspection.extension.panel = result.result.value;
        return result.result.value;
      },
      (m) => m.ready === "complete" && m.fonts === "loaded" && m.width >= 300,
      "native side-panel layout and bundled fonts settle",
    );
    assert.equal(metrics.login, true);
    assert.ok(metrics.scroll <= metrics.width, JSON.stringify(metrics));
    await mkdir(path.join(extension, "assets/screenshots"), {
      recursive: true,
    });
    const capture = await panel.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    await writeFile(
      path.join(extension, "assets/screenshots/09-native-sidepanel.png"),
      Buffer.from(capture.data, "base64"),
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
    const extra = await context.newPage();
    await extra.goto("http://localhost:4317/");
    await extra.bringToFront();
    assert.equal(
      (
        await worker.evaluate(() =>
          chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] }),
        )
      )[0].contextId,
      native[0].contextId,
    );
    await extra.close();
    await main.bringToFront();
    pass(
      "native panel renders without horizontal overflow and keeps the same global document across navigation and tab switching",
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
    (items) => items.length === 0,
    "second action closes native panel",
  );
  pass(
    "clicking the configured browser action again closes the native side panel",
  );
  // Browser restart must retain/reapply action behavior without reinstalling.
  await context.close();
  extensionClosed = true;
  context = await chromium.launchPersistentContext(
    path.resolve(".data/native-surfaces", run, "chrome"),
    {
      executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
      headless: false,
      viewport: null,
      args: [
        "--window-size=1480,980",
        "--enable-unsafe-extension-debugging",
        "--disable-extensions-except=" + path.join(extension, "dist"),
        "--load-extension=" + path.join(extension, "dist"),
      ],
    },
  );
  extensionClosed = false;
  worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 20_000 }));
  await until(
    () => worker.evaluate(() => chrome.sidePanel.getPanelBehavior()),
    (b) => b.openPanelOnActionClick === true,
    "browser restart restores native panel action",
  );
  assert.deepEqual(
    await worker.evaluate(() =>
      chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] }),
    ),
    [],
  );
  pass(
    "browser restart preserves the native side-panel entry without opening it automatically",
  );
  await context.close();
  extensionClosed = true;
  context = undefined;
  assert.deepEqual(errors, []);
} catch (e) {
  checks.push({
    name: e instanceof Error ? (e.stack ?? e.message) : String(e),
    status: "failed",
  });
  process.exitCode = 1;
} finally {
  if (app)
    await app
      .close()
      .then(() => {
        desktopClosed = true;
      })
      .catch(() => errors.push("Failed to close owned Electron"));
  if (browser)
    await browser
      .close()
      .then(() => {
        browserClosed = true;
      })
      .catch(() => errors.push("Failed to close owned auth browser"));
  if (context)
    await context
      .close()
      .then(() => {
        extensionClosed = true;
      })
      .catch(() => errors.push("Failed to close owned extension browser"));
  await mkdir("evidence", { recursive: true });
  const report = {
    at: new Date().toISOString(),
    dependency_mode: "simulated",
    qualification_state: "unverified",
    checks,
    inspection,
    errors,
    desktop_closed: desktopClosed,
    browser_closed: browserClosed,
    extension_closed: extensionClosed,
  };
  await writeFile(
    "evidence/native-surfaces.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
}
