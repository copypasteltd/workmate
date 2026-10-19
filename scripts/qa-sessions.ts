import {
  chromium,
  _electron,
  type Browser,
  type BrowserContext,
  type ElectronApplication,
  type Page,
} from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
import path from "node:path";
import assert from "node:assert/strict";
import { emailCode } from "./qa-auth.js";
const root = path.resolve(".."),
  platform = path.join(root, "copypaste-platform"),
  desktop = path.join(root, "copypaste-desktop"),
  extension = path.join(root, "copypaste-extension"),
  run = randomUUID(),
  email = `sessions-ui-${run}@example.invalid`;
const checks: { name: string; status: string }[] = [],
  errors: string[] = [];
const pendingRequests = new Map<string, number>();
const runtime: Record<string, string> = {};
const fixtureUsers: string[] = [];
const networkFailures: { resource: string; reason: string }[] = [];
const pass = (name: string) => {
  checks.push({ name, status: "passed" });
  console.log("PASS: " + name);
};
let browser: Browser | undefined,
  context: BrowserContext | undefined,
  mv3: BrowserContext | undefined,
  app: ElectronApplication | undefined,
  db: any,
  userId = "",
  browserClosed = false,
  desktopClosed = false,
  extensionClosed = false;
let releaseReads: (() => void) | undefined;
let authorizationCaptured = false;
async function until<T>(
  read: () => Promise<T>,
  accept: (v: T) => boolean,
  label: string,
  limit = 30000,
): Promise<T> {
  const end = Date.now() + limit;
  do {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((r) => setTimeout(r, 150));
  } while (Date.now() < end);
  throw new Error("Timed out: " + label);
}
function watch(page: Page) {
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => errors.push(e.message));
  const resource = (value: string) => {
    const url = new URL(value);
    return url.origin + url.pathname;
  };
  page.on("request", (r) => {
    const key = resource(r.url());
    pendingRequests.set(key, (pendingRequests.get(key) ?? 0) + 1);
  });
  const finished = (r: import("playwright").Request) => {
    const key = resource(r.url()),
      count = (pendingRequests.get(key) ?? 1) - 1;
    if (count > 0) pendingRequests.set(key, count);
    else pendingRequests.delete(key);
  };
  page.on("requestfinished", finished);
  page.on("requestfailed", (r) => {
    finished(r);
    networkFailures.push({
      resource: resource(r.url()),
      reason: r.failure()?.errorText ?? "unknown",
    });
  });
}
async function api(page: Page, url: string, method = "GET", body?: unknown) {
  return page.evaluate(
    async ({ url, method, body }) => {
      const me = await (await fetch("/v1/me")).json();
      const r = await fetch(url, {
        method,
        headers: {
          "X-CSRF-Token": me.csrf_token,
          "Idempotency-Key": crypto.randomUUID(),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await r.json();
      if (!r.ok)
        throw new Error(`${method} ${url}: ${r.status} ${data.error?.code}`);
      return data;
    },
    { url, method, body },
  );
}
async function authorize(page: Page) {
  await page.bringToFront();
  if (!authorizationCaptured) {
    await page
      .getByRole("link", { name: /Authorize & return|授權並返回應用/ })
      .waitFor();
    await page.screenshot({
      path: path.join(
        root,
        "copypaste-web/assets/screenshots/52-native-authorization.png",
      ),
      fullPage: true,
      animations: "disabled",
    });
    authorizationCaptured = true;
  }
  await page
    .getByRole("link", { name: /Authorize & return|授權並返回應用/ })
    .click();
}
async function openDesktop(native: Page) {
  await app!.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.show();
    window.focus();
  });
  await native.bringToFront();
  await app!.evaluate(() => {
    (globalThis as any).__sessionAuthURL = "";
  });
  await native
    .getByRole("button", {
      name: "Sign in securely in your browser",
      exact: true,
    })
    .click({ noWaitAfter: true });
  const url = await until(
    () => app!.evaluate(() => (globalThis as any).__sessionAuthURL as string),
    Boolean,
    "Desktop PKCE URL",
  );
  const auth = await context!.newPage();
  watch(auth);
  try {
    await auth.goto(url, { waitUntil: "domcontentloaded" });
    await authorize(auth);
    await native.waitForURL("**#/app");
  } finally {
    await auth.close();
  }
  await native.evaluate(() => {
    location.hash = "/app/settings";
  });
  await native.locator('.session-row[data-client="desktop"]').waitFor();
}
async function revokeUI(page: Page, client: string) {
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  const row = page.locator(`.session-row[data-client="${client}"]`);
  await row.getByRole("button", { name: /^Revoke / }).click();
  const modal = page.getByRole("dialog");
  await modal
    .getByRole("button", { name: "Confirm revocation", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
}
async function activeNative(client: string, owner = userId) {
  const result = await db.query(
    `SELECT s.id FROM sessions s JOIN refresh_tokens f ON f.session_id=s.id
    WHERE s.user_id=$1 AND f.client_id=$2 AND s.revoked_at IS NULL
      AND f.revoked_at IS NULL AND f.used_at IS NULL AND f.expires_at>now() ORDER BY s.created_at DESC`,
    [owner, client],
  );
  assert.equal(result.rows.length, 1);
  return result.rows[0].id as string;
}
async function rotationCount(client: string) {
  return Number(
    (
      await db.query(
        "SELECT count(*) AS n FROM refresh_tokens WHERE user_id=$1 AND client_id=$2",
        [userId, client],
      )
    ).rows[0].n,
  );
}
try {
  const config = await until<any>(
    async () => {
      try {
        return await (
          await fetch("http://localhost:4310/v1/public/config", {
            signal: AbortSignal.timeout(3000),
          })
        ).json();
      } catch {
        return null;
      }
    },
    Boolean,
    "native demo API readiness",
  );
  assert.equal(config.data_mode, "simulated");
  const env = parseEnv(await readFile(path.join(platform, ".env"), "utf8")),
    url = new URL(env.CONTROL_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(url.hostname));
  assert.equal(url.pathname, "/copypaste");
  const pg = createRequire(path.join(platform, "package.json"))("pg");
  db = new pg.Client({ connectionString: url.href });
  await db.connect();
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.WEB_CHROME_BIN ??
      process.env.CHROME_BIN ??
      chromium.executablePath(),
    // The controlled Windows diagnostic stalls the GPU path but passes normal
    // rAF/timer/click checks with software rendering. Keep product flags intact.
    args: ["--disable-gpu"],
  });
  runtime.chromium_version = browser.version();
  runtime.chromium_executable =
    process.env.WEB_CHROME_BIN ??
    process.env.CHROME_BIN ??
    chromium.executablePath();
  runtime.mv3_chromium_executable =
    process.env.CHROME_BIN ?? chromium.executablePath();
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const web = await context.newPage();
  watch(web);
  await web.goto("http://localhost:4317/login", {
    waitUntil: "domcontentloaded",
  });
  await web.locator('input[name="email"]').fill(email);
  const code = await emailCode(web, () =>
    web.locator('form button[type="submit"]').click(),
  );
  await web.locator('input[name="code"]').fill(code);
  await web.locator('form button[type="submit"]').click();
  await web.waitForURL("**/welcome");
  await web.locator('input[name="name"]').fill("Synthetic session acceptance");
  await web.locator('input[name="project_name"]').fill("Authentication checks");
  await web.locator('form button[type="submit"]').click();
  await web.waitForURL("**/app");
  userId = (await api(web, "/v1/me")).user.id;
  fixtureUsers.push(userId);
  await web.goto("http://localhost:4317/app/settings", {
    waitUntil: "domcontentloaded",
  });
  await web.locator('.session-row[data-client="web"]').waitFor();

  app = await _electron.launch({
    executablePath: path.join(
      desktop,
      "node_modules/electron/dist/electron.exe",
    ),
    args: [desktop, "--disable-gpu"],
    env: {
      ...process.env,
      COPYPASTE_USER_DATA: path.resolve(".data/sessions-desktop-" + run),
    },
  });
  const native = await app.firstWindow();
  Object.assign(
    runtime,
    await app.evaluate(() => ({
      electron_version: process.versions.electron!,
      electron_chromium_version: process.versions.chrome!,
    })),
  );
  watch(native);
  await native.waitForURL(/file:.*index\.html/);
  await native.waitForLoadState("load");
  await native.evaluate(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  await native.reload();
  await app.evaluate(({ shell }) => {
    shell.openExternal = async (value: string) => {
      (globalThis as any).__sessionAuthURL = value;
    };
  });
  await app.evaluate(() => {
    const scope = globalThis as any;
    scope.__codeFetch = globalThis.fetch;
    scope.__codeKeys = [];
    globalThis.fetch = async (input, init) => {
      if (
        String(input).endsWith("/v1/auth/token") &&
        JSON.parse(String(init?.body)).grant_type === "authorization_code"
      ) {
        scope.__codeKeys.push(
          new Headers(init?.headers).get("Idempotency-Key"),
        );
        const response = await scope.__codeFetch(input, init);
        if (scope.__codeKeys.length === 1 && response.status === 201) {
          await response.json();
          throw new TypeError(
            "Controlled response loss after committed Desktop code exchange",
          );
        }
        return response;
      }
      return scope.__codeFetch(input, init);
    };
  });
  await openDesktop(native);
  assert.deepEqual(
    await app.evaluate(() => {
      const scope = globalThis as any;
      globalThis.fetch = scope.__codeFetch;
      return {
        calls: scope.__codeKeys.length,
        same_key: scope.__codeKeys.every(
          (key: string) => Boolean(key) && key === scope.__codeKeys[0],
        ),
      };
    }),
    { calls: 2, same_key: true },
  );
  assert.equal(await rotationCount("desktop"), 1);
  pass(
    "real Desktop first sign-in recovers a committed code-exchange response loss with one bounded same-key retry and creates one native family",
  );

  mv3 = await chromium.launchPersistentContext(
    path.resolve(".data/sessions-extension-" + run),
    {
      executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
      headless: true,
      args: [
        "--disable-gpu",
        "--disable-extensions-except=" + path.join(extension, "dist"),
        "--load-extension=" + path.join(extension, "dist"),
      ],
      viewport: { width: 390, height: 950 },
    },
  );
  await mv3.addCookies(await context.cookies());
  await mv3.addInitScript(() => {
    try {
      localStorage.setItem("cp_locale", "en");
    } catch {}
  });
  const worker =
    mv3.serviceWorkers()[0] ??
    (await mv3.waitForEvent("serviceworker", { timeout: 20000 }));
  const id = (
    await readFile(path.join(extension, "extension-id.txt"), "utf8")
  ).trim();
  assert.ok(worker.url().includes(id));
  await worker.evaluate(() => {
    const scope = globalThis as any;
    scope.__codeFetch = globalThis.fetch;
    scope.__codeKeys = [];
    globalThis.fetch = async (input, init) => {
      if (
        String(input).endsWith("/v1/auth/token") &&
        JSON.parse(String(init?.body)).grant_type === "authorization_code"
      ) {
        scope.__codeKeys.push(
          new Headers(init?.headers).get("Idempotency-Key"),
        );
        const response = await scope.__codeFetch(input, init);
        if (scope.__codeKeys.length === 1 && response.status === 201) {
          await response.json();
          throw new TypeError(
            "Controlled response loss after committed MV3 code exchange",
          );
        }
        return response;
      }
      return scope.__codeFetch(input, init);
    };
  });
  const panel = await mv3.newPage();
  watch(panel);
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  const secondPanel = await mv3.newPage();
  watch(secondPanel);
  await secondPanel.goto(`chrome-extension://${id}/sidepanel.html`);
  await secondPanel.locator("#sign-in").waitFor({ state: "visible" });
  const openExtension = async () => {
    const popupPromise = mv3!.waitForEvent("page");
    await panel.locator("#sign-in").click();
    const popup = await popupPromise;
    watch(popup);
    await popup.waitForLoadState("domcontentloaded");
    await authorize(popup);
    await panel.locator("#workspace").waitFor({ state: "visible" });
    await secondPanel.locator("#workspace").waitFor({ state: "visible" });
  };
  await openExtension();
  assert.deepEqual(
    await worker.evaluate(() => {
      const scope = globalThis as any;
      globalThis.fetch = scope.__codeFetch;
      return {
        calls: scope.__codeKeys.length,
        same_key: scope.__codeKeys.every(
          (key: string) => Boolean(key) && key === scope.__codeKeys[0],
        ),
      };
    }),
    { calls: 2, same_key: true },
  );
  assert.equal(await rotationCount("extension"), 1);
  pass(
    "real MV3 identity sign-in recovers a committed code-exchange response loss under the original key without replaying the code into another family",
  );
  await web.getByRole("button", { name: "Reload", exact: true }).click();
  await web.locator('.session-row[data-client="extension"]').waitFor();
  const inventory = await api(web, "/v1/me/sessions");
  assert.deepEqual(inventory.items.map((s: any) => s.client_id).sort(), [
    "desktop",
    "extension",
    "web",
  ]);
  assert.equal(inventory.items.find((s: any) => s.current).client_id, "web");
  assert.equal(
    await native
      .locator('.session-row[data-client="desktop"] .session-current')
      .count(),
    1,
  );
  await web.screenshot({
    path: path.join(
      root,
      "copypaste-web/assets/screenshots/50-active-sessions.png",
    ),
    animations: "disabled",
    fullPage: true,
  });
  await native
    .getByRole("region", { name: "Active sessions", exact: true })
    .scrollIntoViewIfNeeded();
  await native.screenshot({
    path: path.join(desktop, "assets/screenshots/22-active-sessions.png"),
    animations: "disabled",
  });
  pass(
    "canonical Web login, browser S256 PKCE Desktop and MV3 share a credential-free inventory; both already-open MV3 panels automatically populate on sign-in",
  );

  const desktopRotations = await rotationCount("desktop");
  await app.evaluate(async ({ app }) => {
    const scope = globalThis as any;
    const path = process.getBuiltinModule("node:path"),
      fs = process.getBuiltinModule("node:fs/promises"),
      require = process
        .getBuiltinModule("node:module")
        .createRequire(path.join(app.getAppPath(), "package.json"));
    const { LocalVault } = require("./dist/vault.js");
    const { atomicFile } = require("./dist/files.js");
    const vault = new LocalVault(app.getPath("userData")),
      file = path.join(app.getPath("userData"), "auth.enc");
    const tokens = JSON.parse(await vault.decrypt(await fs.readFile(file)));
    scope.__recoveryOriginal = tokens;
    scope.__recoveryFetch = globalThis.fetch;
    scope.__recoveryKeys = [];
    globalThis.fetch = async (input, init) => {
      if (
        String(input).endsWith("/v1/auth/token") &&
        JSON.parse(String(init?.body)).grant_type === "refresh_token"
      ) {
        scope.__recoveryKeys.push(
          new Headers(init?.headers).get("Idempotency-Key"),
        );
        const response = await scope.__recoveryFetch(input, init);
        if (scope.__recoveryKeys.length === 1 && response.status === 201) {
          await response.json();
          throw new TypeError(
            "Controlled response loss after committed Desktop rotation",
          );
        }
        return response;
      }
      return scope.__recoveryFetch(input, init);
    };
    await atomicFile(
      file,
      await vault.encrypt(
        JSON.stringify({ ...tokens, expires_at: Date.now() - 1 }),
      ),
    );
  });
  const firstDesktop = await native.evaluate(async () => {
    try {
      return await (window as any).copyPasteBridge.request("/v1/me", {});
    } catch (e) {
      return { transport_error: e instanceof Error ? e.message : String(e) };
    }
  });
  assert.match(firstDesktop.transport_error, /Controlled response loss/);
  assert.equal(
    (
      await native.evaluate(() =>
        (window as any).copyPasteBridge.request("/v1/me", {}),
      )
    ).status,
    200,
  );
  const desktopRecovery = await app.evaluate(async ({ app }) => {
    const scope = globalThis as any,
      path = process.getBuiltinModule("node:path"),
      fs = process.getBuiltinModule("node:fs/promises"),
      require = process
        .getBuiltinModule("node:module")
        .createRequire(path.join(app.getAppPath(), "package.json"));
    globalThis.fetch = scope.__recoveryFetch;
    const { LocalVault } = require("./dist/vault.js");
    const tokens = JSON.parse(
      await new LocalVault(app.getPath("userData")).decrypt(
        await fs.readFile(path.join(app.getPath("userData"), "auth.enc")),
      ),
    );
    return {
      calls: scope.__recoveryKeys.length,
      same_key: scope.__recoveryKeys.every(
        (key: string) => key === scope.__recoveryOriginal.refresh_request_id,
      ),
      rotated: tokens.refresh_token !== scope.__recoveryOriginal.refresh_token,
      epoch_unchanged:
        tokens.session_epoch === scope.__recoveryOriginal.session_epoch,
    };
  });
  assert.deepEqual(desktopRecovery, {
    calls: 2,
    same_key: true,
    rotated: true,
    epoch_unchanged: true,
  });
  assert.equal(await rotationCount("desktop"), desktopRotations + 1);
  pass(
    "real Electron DPAPI credentials survive a response lost after committed rotation; the next request uses the same private key and receives that single rotation",
  );

  const extensionRotations = await rotationCount("extension");
  await worker.evaluate(async () => {
    const scope = globalThis as any,
      tokens = (await chrome.storage.session.get("tokens")).tokens as any;
    scope.__recoveryOriginal = tokens;
    scope.__recoveryFetch = globalThis.fetch;
    scope.__recoveryKeys = [];
    globalThis.fetch = async (input, init) => {
      if (
        String(input).endsWith("/v1/auth/token") &&
        JSON.parse(String(init?.body)).grant_type === "refresh_token"
      ) {
        scope.__recoveryKeys.push(
          new Headers(init?.headers).get("Idempotency-Key"),
        );
        const response = await scope.__recoveryFetch(input, init);
        if (scope.__recoveryKeys.length === 1 && response.status === 201) {
          await response.json();
          throw new TypeError(
            "Controlled response loss after committed MV3 rotation",
          );
        }
        return response;
      }
      return scope.__recoveryFetch(input, init);
    };
    await chrome.storage.session.set({
      tokens: { ...tokens, expires_at: Date.now() - 1 },
    });
  });
  const firstExtension = await panel.evaluate(() =>
    chrome.runtime.sendMessage({ type: "API", path: "/v1/me" }),
  );
  assert.equal(firstExtension.ok, false);
  assert.match(firstExtension.error, /Controlled response loss/);
  assert.equal(
    (
      await panel.evaluate(() =>
        chrome.runtime.sendMessage({ type: "API", path: "/v1/me" }),
      )
    ).ok,
    true,
  );
  const extensionRecovery = await worker.evaluate(async () => {
    const scope = globalThis as any,
      tokens = (await chrome.storage.session.get("tokens")).tokens as any;
    globalThis.fetch = scope.__recoveryFetch;
    return {
      calls: scope.__recoveryKeys.length,
      same_key: scope.__recoveryKeys.every(
        (key: string) => key === scope.__recoveryOriginal.refresh_request_id,
      ),
      rotated: tokens.refresh_token !== scope.__recoveryOriginal.refresh_token,
      epoch_unchanged:
        tokens.session_epoch === scope.__recoveryOriginal.session_epoch,
    };
  });
  assert.deepEqual(extensionRecovery, {
    calls: 2,
    same_key: true,
    rotated: true,
    epoch_unchanged: true,
  });
  assert.equal(await rotationCount("extension"), extensionRotations + 1);
  assert.equal(await panel.locator("#workspace").isVisible(), true);
  assert.equal(await secondPanel.locator("#workspace").isVisible(), true);
  pass(
    "real MV3 session storage recovers a lost committed refresh under the same key; rotation retains the identity epoch and both panels stay signed in",
  );

  await web.setViewportSize({ width: 375, height: 1000 });
  await web.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  assert.ok(
    await web.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await web.screenshot({
    path: path.join(
      root,
      "copypaste-web/assets/screenshots/51-sessions-mobile-dark.png",
    ),
    animations: "disabled",
    fullPage: true,
  });
  await web.setViewportSize({ width: 1440, height: 1000 });
  await web.reload();
  await web.locator('.session-row[data-client="desktop"]').waitFor();
  pass(
    "session inventory remains within the viewport at 1440px light and 375px dark, with labelled controls and a real confirmation modal",
  );

  const desktopSession = await activeNative("desktop");
  await revokeUI(web, "desktop");
  await native
    .getByRole("button", {
      name: "Sign in securely in your browser",
      exact: true,
    })
    .waitFor({ timeout: 45000 });
  assert.equal(await native.locator(".session-row").count(), 0);
  assert.ok(
    (
      await db.query(
        "SELECT revoked_at FROM sessions WHERE id=$1 AND user_id=$2",
        [desktopSession, userId],
      )
    ).rows[0].revoked_at,
  );
  assert.equal(await panel.locator("#workspace").isVisible(), true);
  pass(
    "Web confirmation revokes the Desktop family; its next protected read clears native credentials and private UI while Extension stays signed in",
  );

  await secondPanel.evaluate(() => {
    const scope = globalThis as any;
    scope.__oldReplyGate = new Promise<void>((resolve) => {
      scope.__releaseOldReply = resolve;
    });
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    (chrome.runtime as any).sendMessage = async (message: any) => {
      const response = await original(message);
      if (
        !scope.__oldReplyEntered &&
        message.type === "API" &&
        response?.code === "AUTH_REQUIRED"
      ) {
        scope.__oldReplyEntered = true;
        await scope.__oldReplyGate;
        scope.__oldReplyDelivered = true;
      }
      return response;
    };
  });
  await revokeUI(web, "extension");
  if (await secondPanel.locator("#workspace").isVisible())
    await secondPanel.locator("#refresh-notifications").click();
  await until(
    () =>
      secondPanel.evaluate(() =>
        Boolean((globalThis as any).__oldReplyEntered),
      ),
    Boolean,
    "old MV3 unauthorized reply gate",
  );
  await panel.locator("#sign-in").waitFor({ state: "visible" });
  await secondPanel.locator("#sign-in").waitFor({ state: "visible" });
  assert.equal(await panel.locator("#workspace").isVisible(), false);
  assert.equal(await panel.locator("#task-list").textContent(), "");
  assert.equal(await panel.locator("#user-name").textContent(), "");
  assert.equal(
    await worker.evaluate(
      async () => !!(await chrome.storage.session.get("tokens")).tokens,
    ),
    false,
  );
  await panel.screenshot({
    path: path.join(extension, "assets/screenshots/11-session-revoked.png"),
    fullPage: true,
  });
  pass(
    "Web revocation clears actual MV3 session storage and both open panels' account/task/file caches on the next request",
  );

  const replacementContext = await browser.newContext();
  const replacementWeb = await replacementContext.newPage();
  watch(replacementWeb);
  await replacementContext.addInitScript(() =>
    localStorage.setItem("cp_locale", "en"),
  );
  let replacementUser = "",
    replacementName = "";
  try {
    await replacementWeb.goto("http://localhost:4317/login", {
      waitUntil: "domcontentloaded",
    });
    await replacementWeb
      .locator('input[name="email"]')
      .fill(`sessions-replacement-${run}@example.invalid`);
    const code = await emailCode(replacementWeb, () =>
      replacementWeb.locator('form button[type="submit"]').click(),
    );
    await replacementWeb.locator('input[name="code"]').fill(code);
    await replacementWeb.locator('form button[type="submit"]').click();
    await replacementWeb.waitForURL("**/welcome");
    const me = await api(replacementWeb, "/v1/me");
    replacementUser = me.user.id;
    replacementName = me.user.name;
    fixtureUsers.push(replacementUser);
    await replacementWeb
      .locator('input[name="name"]')
      .fill("Replacement panel account");
    await replacementWeb
      .locator('input[name="project_name"]')
      .fill("Isolated account boundary");
    await replacementWeb.locator('form button[type="submit"]').click();
    await replacementWeb.waitForURL("**/app");
    await mv3.clearCookies();
    await mv3.addCookies(await replacementContext.cookies());
  } catch (error) {
    await replacementContext.close();
    throw error;
  }
  await openExtension();
  assert.equal(
    await panel.locator("#user-name").textContent(),
    replacementName,
  );
  assert.equal(
    await secondPanel.locator("#user-name").textContent(),
    replacementName,
  );
  await secondPanel.evaluate(() => (globalThis as any).__releaseOldReply());
  await until(
    () =>
      secondPanel.evaluate(() =>
        Boolean((globalThis as any).__oldReplyDelivered),
      ),
    Boolean,
    "delivery of old account unauthorized reply",
  );
  assert.equal(await secondPanel.locator("#workspace").isVisible(), true);
  assert.equal(
    await secondPanel.locator("#user-name").textContent(),
    replacementName,
  );
  assert.equal(await secondPanel.locator("#error").isVisible(), false);
  await secondPanel.screenshot({
    path: path.join(extension, "assets/screenshots/12-account-replacement.png"),
    fullPage: true,
  });
  pass(
    "a different account automatically populates both existing panels; releasing the previous account's delayed unauthorized reply cannot clear or contaminate the new workspace",
  );
  const expiring = await activeNative("extension", replacementUser);
  await worker.evaluate(() => {
    const scope = globalThis as any;
    scope.__sessionFetch = globalThis.fetch;
    scope.__sessionGetGate = new Promise<void>((resolve) => {
      scope.__releaseSessionGets = resolve;
    });
    globalThis.fetch = async (input, init) => {
      if ((init?.method ?? "GET") === "GET" && String(input).includes("/v1/"))
        await scope.__sessionGetGate;
      return scope.__sessionFetch(input, init);
    };
  });
  await db.query(
    "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id=$1 AND user_id=$2",
    [expiring, replacementUser],
  );
  assert.ok(
    (await api(replacementWeb, "/v1/me/sessions")).items.some(
      (i: any) => i.id === expiring,
    ),
  );
  await replacementContext.close();
  const before = Number(
    (
      await db.query(
        "SELECT count(*) AS n FROM refresh_tokens WHERE user_id=$1",
        [replacementUser],
      )
    ).rows[0].n,
  );
  await panel.locator("#sign-out").click();
  await panel.locator("#sign-in").waitFor({ state: "visible" });
  await until(
    async () =>
      (
        await db.query(
          "SELECT revoked_at FROM sessions WHERE id=$1 AND user_id=$2",
          [expiring, replacementUser],
        )
      ).rows[0].revoked_at,
    Boolean,
    "expired native revocation",
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) AS n FROM refresh_tokens WHERE user_id=$1",
          [replacementUser],
        )
      ).rows[0].n,
    ),
    before,
  );
  await worker.evaluate(() => {
    const scope = globalThis as any;
    scope.__releaseSessionGets();
    globalThis.fetch = scope.__sessionFetch;
  });
  pass(
    "Extension local sign-out revokes an already expired access session through refresh proof, without issuing another token",
  );

  await openDesktop(native);
  const offline = await activeNative("desktop");
  await app.evaluate(() => {
    const scope = globalThis as any;
    scope.__sessionFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith("/v1/auth/native/revoke"))
        throw new Error("Controlled offline revocation fixture");
      return scope.__sessionFetch(input, init);
    };
  });
  await native.getByRole("button", { name: "Sign out", exact: true }).click();
  await native
    .getByRole("button", {
      name: "Sign in securely in your browser",
      exact: true,
    })
    .waitFor();
  await native
    .getByRole("status")
    .filter({ hasText: "Remote revocation could not be confirmed" })
    .waitFor();
  await native.screenshot({
    path: path.join(desktop, "assets/screenshots/23-offline-signout.png"),
    animations: "disabled",
  });
  assert.equal(await native.locator(".session-row").count(), 0);
  assert.equal(
    await native.evaluate(() =>
      (window as any).copyPasteBridge
        .request("/v1/me", {})
        .then((r: { status: number }) => r.status),
    ),
    401,
  );
  await app.evaluate(() => {
    globalThis.fetch = (globalThis as any).__sessionFetch;
  });
  await revokeUI(web, "desktop");
  assert.ok(
    (
      await db.query(
        "SELECT revoked_at FROM sessions WHERE id=$1 AND user_id=$2",
        [offline, userId],
      )
    ).rows[0].revoked_at,
  );
  pass(
    "offline native sign-out clears the local session, explicitly reports unconfirmed remote revocation, and can be completed from another device",
  );

  const other = await context.newPage();
  watch(other);
  await other.goto("http://localhost:4317/app/settings", {
    waitUntil: "domcontentloaded",
  });
  await other.locator('.session-row[data-client="web"]').waitFor();
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
  releaseReads = release;
  await web.route(
    "**/v1/me/sessions",
    async (route) => {
      const response = await route.fetch();
      entered();
      await held;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await web.getByRole("button", { name: "Reload", exact: true }).click();
  await reached;
  await other.getByRole("button", { name: "Sign out", exact: true }).click();
  release();
  await web.waitForURL("**/login");
  await other.waitForURL("**/login");
  assert.equal(await web.locator(".session-row").count(), 0);
  assert.equal(
    await web.evaluate(() => localStorage.getItem("cp_tenant")),
    null,
  );
  pass(
    "browser sign-out propagates to the other owned tab; a delayed authorized response cannot restore its previous private view",
  );
} catch (error: any) {
  errors.push(error?.stack ?? String(error));
  console.error(error);
  process.exitCode = 1;
} finally {
  releaseReads?.();
  const cleanup = async (name: string, close: () => Promise<void>) => {
    try {
      await close();
    } catch (e: any) {
      errors.push(name + ": " + e.message);
    }
  };
  if (app)
    await cleanup("Desktop cleanup", async () => {
      await app!.close();
      desktopClosed = true;
    });
  if (mv3)
    await cleanup("MV3 cleanup", async () => {
      await mv3!.close();
      extensionClosed = true;
    });
  if (context) await cleanup("Owned context cleanup", () => context!.close());
  if (browser)
    await cleanup("Owned browser cleanup", async () => {
      await browser!.close();
      browserClosed = true;
    });
  if (db) {
    if (fixtureUsers.length)
      await cleanup("Owned fixture credential cleanup", async () => {
        await db.query(
          "UPDATE refresh_tokens SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=ANY($1::uuid[])",
          [fixtureUsers],
        );
        await db.query(
          "UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=ANY($1::uuid[])",
          [fixtureUsers],
        );
      });
    await cleanup("Database cleanup", () => db.end());
  }
  if (errors.length || !browserClosed || !desktopClosed || !extensionClosed)
    process.exitCode = 1;
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/sessions.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        dependency_mode: "simulated",
        rendering_mode:
          "software (--disable-gpu for owned Chromium and source Electron); product launch flags unchanged; controlled diagnostic retained in sessions-gpu-diagnostic.json",
        model_calls: 0,
        runtime,
        pending_requests: [...pendingRequests.keys()],
        network_failures: networkFailures,
        scope:
          "Real canonical browser/Electron/MV3 authentication and session lifecycle, lost committed refresh response recovery and two-panel different-account replacement; MV3 business documents are not native Side Panel appearance tests; only owned access-expiry/vault/storage, response-loss, offline fetch and delayed reply/GET gate fault fixtures",
        checks,
        errors,
        browser_closed: browserClosed,
        desktop_closed: desktopClosed,
        extension_closed: extensionClosed,
      },
      null,
      2,
    ) + "\n",
  );
}
