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
import { captureNativeSurfaces } from "./native-surface-integrity-seo.mjs";

const delivery = process.cwd(),
  root = path.resolve(".."),
  platform = path.join(root, "copypaste-platform"),
  desktop = path.join(root, "copypaste-desktop"),
  extension = path.join(root, "copypaste-extension"),
  attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const owned = path.join(delivery, ".data/scoped-seo-native", randomUUID()),
  artifactsOptions = {
    desktop,
    extension,
    executable: path.join(
      desktop,
      "release/scoped-seo-62/win-unpacked/CopyPaste.exe",
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
    `seo-native-${attempt}-${name}.png`,
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
}, 600000);
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
  async function call(
    method: string,
    url: string,
    body?: unknown,
    tenantId?: string,
  ) {
    const r = await system.app.inject({
      method,
      url,
      headers: {
        origin: "http://localhost:4317",
        cookie: `cp_session=${cookie.value}`,
        "x-csrf-token": session.csrf_token,
        ...(tenantId ? { "x-tenant-id": tenantId } : {}),
        "idempotency-key": randomUUID(),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.ok(
      r.statusCode >= 200 && r.statusCode < 300,
      JSON.stringify(r.json()),
    );
    return r.json();
  }
  const created = await call("POST", "/v1/tenants", {
      name: "Native version review",
      project_name: "Side panel and desktop",
    }),
    tenant = created.tenant.id,
    project = created.project.id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
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
  stage = "packaged Desktop marketing authorization";
  const { advanceConnectors } = await import(
    pathToFileURL(path.join(platform, "src/connectors.ts")).href
  );
  async function completeConnection(id: string) {
    for (let i = 0; i < 30; i++) {
      const active = (
        await system.db.control.query(
          "SELECT 1 FROM connector_jobs WHERE connection_id=$1 AND state IN('queued','running')",
          [id],
        )
      ).rowCount;
      if (!active) return;
      await advanceConnectors(system.db, system.storage);
    }
    throw new Error("Bounded native connector queue did not finish");
  }
  await page.evaluate(() => {
    location.hash = "/app/connections";
  });
  await page
    .getByRole("heading", { name: "Connections", exact: true })
    .waitFor();
  const providerCard = page.locator(".connection-card").filter({
    has: page.getByRole("heading", { name: "Meta Ads", exact: true }),
  });
  const previousExternal = await app.evaluate(
    () => (globalThis as any).__adoptionAuthURL,
  );
  await providerCard
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
  const companyLaunch = await until<string>(
    () => app!.evaluate(() => (globalThis as any).__adoptionAuthURL ?? ""),
    (v) => !!v && v !== previousExternal,
    "fixed company provider authorization page",
  );
  const launchURL = new URL(companyLaunch);
  assert.equal(launchURL.origin, "http://localhost:4317");
  assert.equal(launchURL.pathname, "/connect-provider");
  assert.match(launchURL.searchParams.get("state")!, /^[\w-]{43}$/);
  await auth.goto(companyLaunch);
  await auth
    .getByRole("button", {
      name: "允許模擬讀取 / Allow simulated read",
      exact: true,
    })
    .click();
  await auth.waitForURL("**/app/connections?connected=*");
  const connectionId = new URL(auth.url()).searchParams.get("connected")!;
  assert.ok(connectionId);
  await completeConnection(connectionId);
  // The supplier consent browser is a separate native window. Activate the
  // owned Desktop before sending pointer input, as a user returning to it does.
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.show();
    window.focus();
  });
  await page.bringToFront();
  await page.locator(".connector-account").first().waitFor();
  inspection.marketing = {
    connection_id: connectionId,
    authorization_launch_origin: launchURL.origin,
    authorization_launch_path: launchURL.pathname,
    source_mode: "simulated",
  };
  pass(
    "actual packaged Desktop launches the fixed company authorization page, completes supplier consent in a browser and restores the native account directory without exposing a provider token",
  );
  await page.locator(".connector-scope fieldset:not(:disabled)").waitFor();
  for (const box of await page
    .locator(".connector-account input:not(:disabled)")
    .all())
    await box.check();
  await page
    .getByRole("button", { name: "Confirm accounts & projects", exact: true })
    .click();
  await until(
    async () =>
      (
        await call(
          "GET",
          "/v1/connections/" + connectionId + "/detail",
          undefined,
          tenant,
        )
      ).connection.account_ids.length,
    (v) => v === 1,
    "native account binding",
  );
  await page
    .getByRole("button", { name: "Create snapshot", exact: true })
    .click();
  await until(
    async () =>
      (
        await call(
          "GET",
          "/v1/connections/" + connectionId + "/detail",
          undefined,
          tenant,
        )
      ).jobs.some((j: any) => j.kind === "sync" && j.status === "queued"),
    Boolean,
    "native durable sync submission",
  );
  await completeConnection(connectionId);
  await page
    .getByRole("button", { name: "Inspect facts & limits", exact: true })
    .first()
    .click();
  const factsModal = page.getByRole("dialog", {
    name: "Source snapshot",
    exact: true,
  });
  await factsModal
    .getByText(
      "Only the exact purchase action is used. Overlapping purchase types are not summed, and missing values remain unknown.",
      { exact: true },
    )
    .waitFor();
  assert.ok((await factsModal.boundingBox())!.y >= 40);
  const nativeDetail = await call(
      "GET",
      "/v1/connections/" + connectionId + "/detail",
      undefined,
      tenant,
    ),
    snapshot = nativeDetail.snapshots[0],
    facts = await call(
      "GET",
      "/v1/connector-snapshots/" + snapshot.id,
      undefined,
      tenant,
    );
  assert.equal(facts.row_count, 3);
  assert.equal(facts.data_as_of, null);
  assert.equal(facts.facts[0].metrics.conversions, "2");
  assert.equal(facts.facts.at(-1).metrics.conversions, null);
  inspection.marketing.snapshot_id = snapshot.id;
  inspection.marketing.row_count = facts.row_count;
  inspection.marketing.pages = nativeDetail.jobs[0].page_count;
  await shot(page, "copypaste-desktop", "facts-en");
  await page.keyboard.press("Escape");
  pass(
    "packaged Desktop confirms discovered account/project scope, completes two durable pages and displays immutable source facts, unknown values and attribution limits below the custom title bar",
  );
  const nativeDownload = path.join(owned, "native-marketing-snapshot.json");
  await app.evaluate(({ dialog }, destination: string) => {
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: destination,
    });
  }, nativeDownload);
  await page
    .locator(".connector-snapshot")
    .first()
    .getByRole("button", { name: "JSON", exact: true })
    .click();
  await until(
    async () => readFile(nativeDownload).catch(() => null),
    Boolean,
    "actual native snapshot save",
  );
  const saved = await readFile(nativeDownload),
    source = (
      await system.db.control.query(
        "SELECT sha256 FROM asset_versions WHERE asset_id=$1 AND version=1",
        [snapshot.asset_id],
      )
    ).rows[0];
  assert.equal(hash(saved), source.sha256);
  assert.equal(JSON.parse(saved.toString()).facts.length, 3);
  inspection.marketing.download = {
    sha256: hash(saved),
    bytes: saved.length,
    actual_native_save: true,
  };
  pass(
    "actual native JSON export uses the scoped company bridge and save dialog, and matches the immutable server asset SHA",
  );
  await page
    .getByRole("button", { name: "Create snapshot", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel remaining reads", exact: true })
    .first()
    .click();
  await until(
    async () =>
      (
        await call(
          "GET",
          "/v1/connections/" + connectionId + "/detail",
          undefined,
          tenant,
        )
      ).jobs[0].status,
    (v) => v === "cancelled",
    "native queued cancellation",
  );
  const callsAfterCancel = system.connectorFixture.calls.length;
  await advanceConnectors(system.db, system.storage);
  assert.equal(system.connectorFixture.calls.length, callsAfterCancel);
  pass(
    "actual Desktop cancels a queued synchronization through its authenticated bridge with no new supplier read",
  );
  await page.evaluate(() => {
    localStorage.setItem("cp_locale", "zh-HK");
    localStorage.setItem("cp_theme", "dark");
  });
  await page.reload();
  await page.getByRole("heading", { name: "連接應用", exact: true }).waitFor();
  await page
    .getByRole("button", { name: "檢查數據與限制", exact: true })
    .first()
    .click();
  const zhFacts = page.getByRole("dialog", { name: "來源快照", exact: true });
  await zhFacts
    .getByText(
      "只讀取 purchase 動作，不合計重疊購買類型；未返回的值保持未知。",
      { exact: true },
    )
    .waitFor();
  assert.ok((await zhFacts.boundingBox())!.y >= 40);
  await shot(page, "copypaste-desktop", "facts-zh-dark");
  await page.keyboard.press("Escape");
  pass(
    "Traditional Chinese dark marketing facts remain below the custom native controls and close with Escape",
  );
  for (const route of [
    "/v1/admin/connections",
    "/v1/connections/launch/" + "a".repeat(43),
  ]) {
    const denied = await page.evaluate(async (path: string) => {
      try {
        await (window as any).copyPasteBridge.api(path, { method: "GET" });
        return false;
      } catch {
        return true;
      }
    }, route);
    assert.equal(denied, true);
  }
  pass(
    "the actual sandboxed renderer cannot use its authenticated bridge to call Admin or the public provider-launch endpoint",
  );
  stage = "packaged Desktop confirmed website audit and scoped downloads";
  await call("POST", `/v1/tenants/${tenant}/demo-credit`, {});
  await page.evaluate(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
    location.hash = "/app/analytics?view=seo";
  });
  await page.reload();
  await page
    .getByRole("heading", { name: "Website audits & rechecks", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "New audit", exact: true }).click();
  const scopeDialog = page.getByRole("dialog");
  assert.equal(
    await scopeDialog
      .getByRole("button", { name: "Start audit", exact: true })
      .isEnabled(),
    false,
  );
  await scopeDialog
    .getByLabel("Page request limit", { exact: true })
    .fill("10");
  await scopeDialog.getByRole("checkbox").check();
  assert.ok((await scopeDialog.boundingBox())!.y >= 40);
  await shot(page, "copypaste-desktop", "seo-scope-en");
  await scopeDialog
    .getByRole("button", { name: "Start audit", exact: true })
    .click();
  const seoAudit = await until<any>(
    async () =>
      (
        await call(
          "GET",
          "/v1/seo/audits?project_id=" + project,
          undefined,
          tenant,
        )
      ).items[0],
    Boolean,
    "actual native website scope submission",
  );
  await scopeDialog.waitFor({ state: "hidden" });
  assert.equal(seoAudit.input.max_pages, 10);
  const { advanceSeoAudits } = await import(
    pathToFileURL(path.join(platform, "src/seo-audits.ts")).href
  );
  let clock = Date.now(),
    currentSeo = seoAudit;
  for (
    let n = 0;
    n < 100 && ["queued", "running"].includes(currentSeo.state);
    n++
  ) {
    clock = Math.max(
      clock + 1100,
      Date.parse(currentSeo.progress.next_attempt_at),
    );
    await advanceSeoAudits(system.db, system.catalog, system.storage, {
      now: () => clock,
    });
    currentSeo = await call(
      "GET",
      "/v1/seo/audits/" + seoAudit.id,
      undefined,
      tenant,
    );
  }
  assert.equal(currentSeo.state, "partial");
  const seoFindings = await call(
    "GET",
    "/v1/seo/audits/" + seoAudit.id + "/findings",
    undefined,
    tenant,
  );
  assert.ok(seoFindings.items.some((f: any) => f.code === "broken_link"));
  await page.reload();
  await page.locator(".seo-finding").first().waitFor();
  const broken = page.locator(".seo-finding").filter({
    has: page.getByRole("heading", { name: "Broken link", exact: true }),
  });
  await broken
    .getByRole("button", { name: "Inspect source evidence", exact: true })
    .click();
  const sourceDialog = page.getByRole("dialog", {
    name: "Source evidence",
    exact: true,
  });
  await sourceDialog.locator("pre").waitFor();
  assert.ok((await sourceDialog.boundingBox())!.y >= 40);
  await shot(page, "copypaste-desktop", "seo-source-en");
  await page.keyboard.press("Escape");
  pass(
    "actual packaged frameless Desktop confirms bounded website scope, reads synthetic HTTP findings and opens retained source evidence below native controls",
  );
  const seoSave = path.join(owned, "native-seo-evidence.json");
  await app.evaluate(({ dialog }, destination: string) => {
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: destination,
    });
  }, seoSave);
  await page
    .getByRole("button", { name: "Download evidence JSON", exact: true })
    .click();
  const savedSeo = await until(
    () => readFile(seoSave).catch(() => null),
    Boolean,
    "native tenant-bound SEO evidence save",
  );
  assert.ok(savedSeo);
  const frozenSeo = JSON.parse(savedSeo.toString());
  assert.equal(frozenSeo.run_id, seoAudit.id);
  assert.deepEqual(frozenSeo.findings, seoFindings.items);
  const seoVersion = (
    await system.db.control.query(
      "SELECT v.sha256 FROM asset_versions v JOIN seo_runs r ON r.result_asset_version_id=v.id WHERE r.id=$1",
      [seoAudit.id],
    )
  ).rows[0];
  assert.equal(hash(savedSeo), seoVersion.sha256);
  inspection.seo = {
    run_id: seoAudit.id,
    findings: seoFindings.items.length,
    evidence_sha256: hash(savedSeo),
    actual_native_save: true,
  };
  pass(
    "actual native website evidence export forwards the current tenant through the approved bridge and saves bytes matching the immutable result SHA",
  );
  await system.worker.run(tenant, seoAudit.task_id);
  const interpreted = await call(
    "GET",
    "/v1/seo/audits/" + seoAudit.id,
    undefined,
    tenant,
  );
  assert.equal(interpreted.task_status, "succeeded");
  const nativeTask = (
    await system.db.control.query(
      "SELECT runtime_thread,input_tokens,output_tokens FROM tasks WHERE id=$1",
      [seoAudit.task_id],
    )
  ).rows[0];
  assert.ok(
    nativeTask.runtime_thread &&
      Number(nativeTask.input_tokens) > 0 &&
      Number(nativeTask.output_tokens) > 0,
  );
  const reportSave = path.join(owned, "native-seo-report.html");
  await app.evaluate(({ dialog }, destination: string) => {
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: destination,
    });
  }, reportSave);
  await page.reload();
  await page
    .getByRole("button", { name: "Download report", exact: true })
    .click();
  const savedReport = await until(
    () => readFile(reportSave).catch(() => null),
    Boolean,
    "native SEO interpretation report save",
  );
  assert.ok(savedReport && savedReport.toString().includes(seoAudit.id));
  const reportVersion = (
    await system.db.control.query(
      "SELECT sha256 FROM asset_versions WHERE id=$1",
      [interpreted.report_asset_version_id],
    )
  ).rows[0];
  assert.equal(hash(savedReport!), reportVersion.sha256);
  inspection.seo.report_sha256 = hash(savedReport!);
  await page.locator(".seo-finding").first().scrollIntoViewIfNeeded();
  await shot(page, "copypaste-desktop", "seo-findings-en");
  pass(
    "actual locked Codex process interprets retained facts through the internal synthetic gateway and the packaged Desktop saves the matching report through its native bridge",
  );
  await page.evaluate(() => localStorage.setItem("cp_locale", "zh-HK"));
  await page.reload();
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
    (v) =>
      v.length === 1 &&
      v[0].documentUrl === `chrome-extension://${id}/sidepanel.html`,
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
      `seo-native-${attempt}-${name}.png`,
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
      () =>
        evaluate("document.querySelector('#review-models').textContent.trim()"),
      (v) => typeof v === "string" && v.length > 0,
      "review button label",
    );
    await panelShot("sidepanel-zh");
    const label = await evaluate(
      "document.querySelector('#review-models').textContent.trim()",
    );
    assert.equal(label, "檢視模型與費率版本");
    assert.equal(
      await evaluate(
        "document.querySelector('#video-workspace').textContent.trim()",
      ),
      "影片製作工作台",
    );
    await evaluate("document.querySelector('#locale').click()");
    await until(
      () =>
        evaluate("document.querySelector('#review-models').textContent.trim()"),
      (v) => v === "Review model and rate versions",
      "English model review label",
    );
    await panelShot("sidepanel-en");
    assert.equal(
      await evaluate(
        "document.querySelector('#video-workspace').textContent.trim()",
      ),
      "Open video production workspace",
    );
    pass(
      "actual native Side Panel completes email OTP and PKCE sign-in, renders the review entry in Traditional Chinese and English without horizontal overflow",
    );
    assert.equal(
      await evaluate(
        "document.querySelector('#marketing-connections').textContent.trim()",
      ),
      "Marketing accounts & sync",
    );
    const opened = context.waitForEvent("page");
    await evaluate("document.querySelector('#marketing-connections').click()");
    const workspace = await opened;
    await workspace.waitForURL("http://localhost:4317/app/connections");
    await workspace
      .getByRole("heading", { name: "Connections", exact: true })
      .waitFor();
    await workspace
      .getByRole("button", { name: "Inspect facts & limits", exact: true })
      .first()
      .click();
    await workspace
      .getByRole("dialog", { name: "Source snapshot", exact: true })
      .getByText(
        "Only the exact purchase action is used. Overlapping purchase types are not summed, and missing values remain unknown.",
        { exact: true },
      )
      .waitFor();
    await shot(workspace, "copypaste-extension", "marketing-facts-en");
    await workspace.close();
    await main.bringToFront();
    pass(
      "the native right Side Panel opens the fixed authorized company marketing workspace and preserves the Desktop's original immutable source snapshot",
    );
    assert.equal(
      await evaluate(
        "document.querySelector('#website-audits').textContent.trim()",
      ),
      "Website audits & rechecks",
    );
    const seoOpened = context.waitForEvent("page");
    await evaluate("document.querySelector('#website-audits').click()");
    const seoWorkspace = await seoOpened;
    await seoWorkspace.waitForURL(
      "http://localhost:4317/app/analytics?view=seo",
    );
    await seoWorkspace
      .getByRole("heading", { name: "Website audits & rechecks", exact: true })
      .waitFor();
    await seoWorkspace.locator(".seo-finding").first().waitFor();
    await seoWorkspace
      .getByRole("button", { name: "Download report", exact: true })
      .waitFor();
    await shot(seoWorkspace, "copypaste-extension", "seo-workspace-en");
    await seoWorkspace.close();
    await main.bringToFront();
    pass(
      "actual native Side Panel opens the fixed authorized website audit workspace with the Desktop's saved findings and Codex report, and closes its temporary workspace tab",
    );
    await evaluate(
      "chrome.runtime.sendMessage({type:'OPEN_WEB',section:'https://outside.example.invalid/collect'}).then(()=>true)",
    );
    const fallback = await until(
      () =>
        Promise.resolve(
          context!.pages().find((p) => p.url() === "http://localhost:4317/app"),
        ),
      Boolean,
      "fixed fallback destination",
    );
    assert.ok(fallback);
    await fallback.close();
    await main.bringToFront();
    pass(
      "unrecognized side-panel destination input resolves to the fixed company workspace and cannot open an arbitrary external URL",
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
  if (app) {
    const page = app.windows()[0];
    if (page && !page.isClosed()) {
      await shot(page, "copypaste-desktop", "failure").catch(() => {});
      inspection.failure_pointer_context = await page
        .evaluate(() => {
          const input = document.querySelector<HTMLInputElement>(
            ".connector-account input:not(:disabled)",
          );
          const rect = input?.getBoundingClientRect();
          return {
            focused: document.hasFocus(),
            checked: input?.checked,
            input_rect: rect?.toJSON(),
            pointer_target: rect
              ? document.elementFromPoint(
                  rect.x + rect.width / 2,
                  rect.y + rect.height / 2,
                )?.tagName
              : null,
            root_scroll: document.getElementById("root")?.scrollTop,
          };
        })
        .catch(() => null);
    }
  }
  console.error(
    "FAIL: " + stage + ": " + (e instanceof Error ? e.message : String(e)),
  );
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
    path.join(delivery, `evidence/scoped-seo-native-${attempt}-journey.json`),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: passed ? "passed" : "failed",
        scope:
          "New unsigned packaged frameless Desktop and real native Chrome Side Panel with actual identity, scoped synthetic website collection, tenant-bound native evidence/report saves, actual locked Codex process and preserved supplier synchronization. No public website/TLS, installation, store publication or production qualification.",
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
