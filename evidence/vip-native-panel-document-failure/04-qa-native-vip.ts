import {
  chromium,
  _electron,
  type ElectronApplication,
  type CDPSession,
  type Browser,
  type BrowserContext,
  type BrowserServer,
  type Page,
} from "playwright";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { parseEnv } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { captureNativeSurfaces } from "./native-surface-integrity.mjs";
import assert from "node:assert/strict";

const platform = path.resolve("../copypaste-platform"),
  origin = "http://localhost:4310",
  admin = "http://localhost:4318",
  web = "http://localhost:4317",
  requirePlatform = createRequire(path.join(platform, "package.json")),
  pg = requirePlatform("pg"),
  OTPAuth = requirePlatform("otpauth"),
  sha = (data: string | Buffer) =>
    createHash("sha256").update(data).digest("hex");
type Client = { id: string; cookie: string; csrf: string; user?: boolean };
const clients: Client[] = [],
  principals: string[] = [],
  contexts: BrowserContext[] = [],
  samples: any[] = [],
  checks: any[] = [],
  errors: string[] = [],
  screenshots: string[] = [],
  screenshotFacts: any[] = [];
let db: any,
  browser: Browser | undefined,
  server: BrowserServer | undefined,
  stage = "initializing",
  closed = false,
  sessionsClosed = false,
  adminsDisabled = false,
  check: (schema: string, data: unknown) => void;
const pass = (name: string) => checks.push({ name, status: "passed" });
async function sourceSnapshot() {
  const files: string[] = [];
  for (const repo of [
    "copypaste-platform",
    "copypaste-admin",
    "copypaste-web",
    "copypaste-desktop",
    "copypaste-extension",
  ]) {
    const list = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: path.resolve("..", repo), encoding: "utf8", windowsHide: true },
    ).split("\0");
    for (const f of list)
      if (
        /^(src|renderer|migrations|catalog|contracts|public)\//.test(f) ||
        /^(package(-lock)?|tsconfig)\.json$/.test(f)
      )
        files.push(`${repo}/${f}`);
  }
  files.push("copypaste-delivery/scripts/qa-native-vip.ts");
  files.push("copypaste-delivery/scripts/native-surface-integrity.mjs", "copypaste-delivery/package.json", "copypaste-delivery/package-lock.json");
  return Object.fromEntries(
    await Promise.all(
      files
        .sort()
        .map(async (f) => [f, sha(await readFile(path.resolve("..", f)))]),
    ),
  );
}
const beforeSources = await sourceSnapshot();
const deadline = setTimeout(() => {
  errors.push("Owned VIP QA exceeded 480 seconds at " + stage);
  void server?.kill();
}, 480000);
async function call(
  c: Client | undefined,
  method: string,
  endpoint: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const r = await fetch(origin + endpoint, {
    method,
    headers: {
      Origin:
        c?.user ||
        endpoint.startsWith("/v1/auth/") ||
        endpoint === "/v1/tenants" ||
        endpoint.startsWith("/v1/effective-entitlements") ||
        endpoint.startsWith("/v1/plans")
          ? web
          : admin,
      "Idempotency-Key": randomUUID(),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(c ? { Cookie: c.cookie, "X-CSRF-Token": c.csrf } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return { status: r.status, data: await r.json(), headers: r.headers };
}
function sample(
  name: string,
  operation: string,
  schema: string,
  data: unknown,
  status = 200,
) {
  check(schema, data);
  samples.push({ name, operation, schema, status, response: data });
}
async function login(email: string, secret: any) {
  const challenge = await call(undefined, "POST", "/v1/admin/auth/challenge", {
    email,
  });
  assert.equal(challenge.status, 200);
  const until = Date.now() + 15000;
  let mail: any;
  while (Date.now() < until) {
    try {
      mail = JSON.parse(
        await readFile(
          path.join(
            platform,
            ".data/mailbox",
            challenge.data.challenge_id + ".json",
          ),
          "utf8",
        ),
      );
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.equal(mail?.to, email);
  const result = await call(undefined, "POST", "/v1/admin/auth/verify", {
    challenge_id: challenge.data.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
    totp: new OTPAuth.TOTP({
      secret,
      digits: 6,
      period: 30,
      algorithm: "SHA1",
    }).generate(),
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const c = {
    id: "",
    cookie: result.headers
      .getSetCookie()
      .find((v) => v.startsWith("cp_admin_session="))!
      .split(";")[0],
    csrf: result.data.csrf_token,
  };
  clients.push(c);
  const me = await call(c, "GET", "/v1/admin/me");
  assert.equal(me.status, 200);
  c.id = me.data.user.id;
  c.csrf = me.data.csrf_token;
  return c;
}
async function pageFor(
  c: Client,
  width = 1440,
  locale = "en",
  theme = "light",
) {
  const context = await browser!.newContext({
    viewport: { width, height: 1080 },
  });
  contexts.push(context);
  context.setDefaultTimeout(15000);
  const i = c.cookie.indexOf("=");
  await context.addCookies([
    {
      name: c.cookie.slice(0, i),
      value: c.cookie.slice(i + 1),
      url: c.user ? web : admin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await context.addInitScript(
    ({ locale, theme }) => {
      localStorage.setItem("cp_locale", locale);
      localStorage.setItem("cp_theme", theme);
    },
    { locale, theme },
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return page;
}
async function capture(page: Page, name: string, repo = "copypaste-admin") {
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    document
      .querySelectorAll(".modal-backdrop")
      .forEach((e) => (e.scrollTop = 0));
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Page must not overflow horizontally",
  );
  const folder = path.resolve("..", repo, "assets/screenshots");
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, name);
  await page.screenshot({
    path: file,
    fullPage: (await page.locator(".modal-backdrop").count()) === 0,
  });
  screenshots.push(name);
  screenshotFacts.push({
    file: "dev/" + repo + "/assets/screenshots/" + name,
    sha256: sha(await readFile(file)),
    url: page.url(),
    viewport: page.viewportSize(),
    locale: await page.evaluate(() => document.documentElement.lang),
    theme: await page.evaluate(() => document.documentElement.dataset.theme),
  });
}
async function waitResponse(
  page: Page,
  suffix: string,
  click: () => Promise<unknown>,
) {
  const pending = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname.endsWith(suffix),
  );
  await click();
  return pending;
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

const desktop = path.resolve("../copypaste-desktop"),
  extension = path.resolve("../copypaste-extension"),
  run = randomUUID();
const executable = path.join(
  desktop,
  "release/frameless/win-unpacked/CopyPaste.exe",
);
let nativeApp: ElectronApplication | undefined,
  mv3: BrowserContext | undefined,
  panel: Awaited<ReturnType<typeof attachTarget>> | undefined;
let desktopClosed = false,
  extensionClosed = false,
  nativeCredentialsCleared = false;
let testedArtifacts: any,
  artifactsUnchanged = false;
async function until<T>(
  read: () => Promise<T>,
  ok: (v: T) => boolean,
  label: string,
  ms = 20000,
): Promise<T> {
  const end = Date.now() + ms;
  do {
    const v = await read();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 150));
  } while (Date.now() < end);
  throw new Error("Timed out: " + label);
}
async function panelEval(expression: string): Promise<any> {
  const result = await panel!.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  assert.equal(
    result.exceptionDetails,
    undefined,
    "Actual native side-panel evaluation failed",
  );
  return result.result.value;
}
async function panelRights(tenant: string) {
  const value = await panelEval(
    "chrome.runtime.sendMessage(" +
      JSON.stringify({
        type: "API",
        path: "/v1/effective-entitlements",
        tenantId: tenant,
      }) +
      ")",
  );
  assert.equal(value.ok, true);
  check("EffectiveEntitlements", value.data);
  return value.data;
}
async function panelCapture(name: string) {
  await panelEval(
    "document.querySelector('#entitlement-heading').scrollIntoView({block:'start'})",
  );
  const size = await panelEval(
    "({width:innerWidth,scroll:document.documentElement.scrollWidth})",
  );
  assert.ok(size.width >= 300 && size.scroll <= size.width + 1);
  const result = await panel!.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    }),
    file = path.join(extension, "assets/screenshots", name);
  await writeFile(file, Buffer.from(result.data, "base64"));
  screenshots.push(name);
  screenshotFacts.push({
    file: "dev/copypaste-extension/assets/screenshots/" + name,
    sha256: sha(await readFile(file)),
    context_type: "SIDE_PANEL",
    viewport: size,
  });
}

try {
  const configured = await (await fetch(origin + "/v1/public/config")).json();
  assert.equal(configured.data_mode, "simulated");
  const env = parseEnv(await readFile(path.join(platform, ".env"), "utf8")),
    url = new URL(env.CONTROL_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(url.hostname));
  assert.equal(url.pathname, "/copypaste");
  db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const fixture = JSON.parse(
      await readFile(
        path.join(platform, "contracts/admin-vip-schemas.json"),
        "utf8",
      ),
    ),
    specBytes = await readFile("../../docs/contracts/openapi.json"),
    spec = JSON.parse(specBytes.toString());
  assert.equal(fixture.normative_source_sha256, sha(specBytes));
  for (const [name, schema] of Object.entries(fixture.schemas))
    assert.deepEqual(schema, spec.components.schemas[name]);
  const { Ajv2020 } = requirePlatform("ajv/dist/2020.js"),
    ajv = new Ajv2020({ allErrors: true });
  requirePlatform("ajv-formats")(ajv);
  const defs = JSON.parse(
    JSON.stringify(fixture.schemas).replaceAll(
      "#/components/schemas/",
      "#/$defs/",
    ),
  );
  check = (schema, data) => {
    const v = ajv.compile({ $defs: defs, $ref: "#/$defs/" + schema });
    assert.ok(v(data), schema + JSON.stringify(v.errors));
  };
  const { seal } = await import(
    pathToFileURL(path.join(platform, "src/lib.ts")).href
  );
  for (let n = 0; n < 2; n++) {
    const secret = new OTPAuth.Secret({ size: 20 }),
      email = `vip-ui-${randomUUID()}@example.invalid`,
      p = (
        await db.query(
          "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,$2,$3) RETURNING id",
          [
            email,
            n ? "Synthetic VIP reviewer" : "Synthetic VIP operator",
            seal(env.MASTER_KEY!, secret.base32),
          ],
        )
      ).rows[0];
    principals.push(p.id);
    await db.query(
      "INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,'super_admin','global')",
      [p.id],
    );
    await login(email, secret);
  }
  const [operator, reviewer] = clients;

  stage = "owned user sign-in";
  const email = "vip-user-" + randomUUID() + "@example.invalid";
  const challenge = await call(undefined, "POST", "/v1/auth/challenge", {
    email,
  });
  assert.equal(challenge.status, 200);
  let mail: any;
  const mailboxDeadline = Date.now() + 15000;
  while (Date.now() < mailboxDeadline) {
    try {
      mail = JSON.parse(
        await readFile(
          path.join(
            platform,
            ".data/mailbox",
            challenge.data.challenge_id + ".json",
          ),
          "utf8",
        ),
      );
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.equal(mail?.to, email);
  const signedIn = await call(undefined, "POST", "/v1/auth/verify", {
    challenge_id: challenge.data.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
  });
  assert.equal(signedIn.status, 200);
  const user: Client = {
    id: signedIn.data.user.id,
    user: true,
    cookie: signedIn.headers
      .getSetCookie()
      .find((v) => v.startsWith("cp_session="))!
      .split(";")[0],
    csrf: signedIn.data.csrf_token,
  };
  clients.push(user);
  const workspace = await call(user, "POST", "/v1/tenants", {
    name: "Synthetic VIP UI workspace",
    project_name: "Campaign",
  });
  assert.equal(workspace.status, 200, JSON.stringify(workspace.data));
  const tenant = workspace.data.tenant.id;
  const fixedPlan = (
    await db.query(
      "SELECT published_version_id AS id FROM commercial_plans WHERE legacy_key='pro'",
    )
  ).rows[0].id;
  const walletBefore = (
    await db.query(
      "SELECT id,balance_micros,reserved_micros,version FROM wallets WHERE user_id=$1 ORDER BY id",
      [user.id],
    )
  ).rows;
  pass(
    "real email user session and independent email/TOTP administrators; no model or external payment",
  );
  stage = "packaged Desktop browser PKCE";
  testedArtifacts = await captureNativeSurfaces({
    desktop,
    extension,
    executable,
    packaged: true,
  });
  server = await chromium.launchServer({
    headless: true,
    executablePath:
      process.env.WEB_CHROME_BIN ??
      process.env.CHROME_BIN ??
      chromium.executablePath(),
    args: ["--disable-gpu"],
  });
  browser = await chromium.connect(server.wsEndpoint());
  const auth = await pageFor(user);
  nativeApp = await _electron.launch({
    executablePath: executable,
    args: ["--disable-gpu"],
    timeout: 60000,
    env: {
      ...process.env,
      COPYPASTE_USER_DATA: path.resolve(".data/native-vip", run, "desktop"),
    },
  });
  const native = await nativeApp.firstWindow({ timeout: 45000 });
  native.on("pageerror", (e) => errors.push(e.message));
  native.setDefaultTimeout(20000);
  await native.waitForURL(/file:.*index\.html/);
  await native.evaluate(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  await native.reload();
  await nativeApp.evaluate(({ shell, BrowserWindow }) => {
    shell.openExternal = async (url: string) => {
      (globalThis as any).__vipAuthorizationURL = url;
    };
    BrowserWindow.getAllWindows()[0].setBounds({
      width: 1440,
      height: 1000,
      x: 40,
      y: 40,
    });
  });
  await native
    .getByRole("button", {
      name: "Sign in securely in your browser",
      exact: true,
    })
    .click({ noWaitAfter: true });
  const authorization = await until<string>(
    () =>
      nativeApp!.evaluate(
        () => (globalThis as any).__vipAuthorizationURL ?? "",
      ),
    Boolean,
    "owned browser authorization URL",
  );
  await auth.goto(authorization);
  await auth
    .getByRole("link", { name: /Authorize & return|授權並返回應用/ })
    .click();
  await native.waitForURL("**#/app");
  await native.evaluate(() => {
    location.hash = "/app/usage";
  });
  await native
    .getByRole("heading", { name: "Current entitlements", exact: true })
    .waitFor();
  const desktopRights = async () => {
    const result = await native.evaluate(
      async (tenant) =>
        (window as any).copyPasteBridge.request("/v1/effective-entitlements", {
          tenantId: tenant,
        }),
      tenant,
    );
    assert.equal(result.status, 200, JSON.stringify(result.body));
    check("EffectiveEntitlements", result.body);
    return result.body;
  };
  const initial = await desktopRights();
  assert.ok(!initial.plan_version_ids.includes(fixedPlan));
  assert.ok(
    await native
      .getByRole("button", { name: "Close window", exact: true })
      .isVisible(),
  );
  pass(
    "new packaged frameless Desktop performs actual browser S256 PKCE and reads server entitlements through its restricted bridge",
  );

  stage = "native browser Side Panel sign-in";
  mv3 = await chromium.launchPersistentContext(
    path.resolve(".data/native-vip", run, "chrome"),
    {
      executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
      headless: false,
      viewport: null,
      timeout: 30000,
      args: [
        "--disable-gpu",
        "--window-size=1480,1000",
        "--enable-unsafe-extension-debugging",
        "--disable-extensions-except=" + path.join(extension, "dist"),
        "--load-extension=" + path.join(extension, "dist"),
      ],
    },
  );
  await mv3.addCookies(await auth.context().cookies());
  const id = (
    await readFile(path.join(extension, "extension-id.txt"), "utf8")
  ).trim();
  const worker =
    mv3.serviceWorkers()[0] ?? (await mv3.waitForEvent("serviceworker"));
  assert.ok(worker.url().includes(id), "The owned service worker must match the bundled extension ID");
  await until(
    () => worker.evaluate(() => chrome.sidePanel.getPanelBehavior()),
    (behavior) => behavior.openPanelOnActionClick === true,
    "native toolbar behavior installed",
  );
  const main = mv3.pages()[0];
  await main.goto(web + "/app/usage");
  const cdp = await mv3.browser()!.newBrowserCDPSession();
  const target = await until(
    async () => (await cdp.send("Target.getTargets", { filter: [{}] })).targetInfos.find(
      (t) => t.type === "tab" && t.url.startsWith(web),
    ),
    Boolean,
    "owned ordinary browser tab CDP target",
  );
  assert.ok(target, "The actual ordinary browser tab must be exposed as a CDP tab target");
  const ordinaryTabs = mv3.pages().length;
  await (cdp as any).send("Extensions.triggerAction", {
    id,
    targetId: target.targetId,
  });
  const side = await until(
    () =>
      worker.evaluate(() =>
        chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] }),
      ),
    (v) => v.length === 1,
    "actual SIDE_PANEL",
  );
  assert.equal(mv3.pages().length, ordinaryTabs);
  assert.equal(
    (await worker.evaluate(() => chrome.sidePanel.getLayout())).side,
    "right",
  );
  const panelTarget = await until(
    async () => (await cdp.send("Target.getTargets", { filter: [{}] })).targetInfos.find(
      (t) => t.type === "page" && t.url === side[0].documentUrl,
    ),
    Boolean,
    "actual native SIDE_PANEL document target",
  );
  assert.ok(panelTarget, "The actual native SIDE_PANEL document must have a CDP page target");
  panel = await attachTarget(cdp, panelTarget.targetId);
  await until(
    () =>
      panelEval(
        "!!document.querySelector('#sign-in') && document.readyState==='complete'",
      ),
    Boolean,
    "side-panel DOM",
  );
  const popupPromise = mv3.waitForEvent("page");
  await panelEval("document.querySelector('#sign-in').click()");
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  await popup
    .getByRole("link", { name: /Authorize & return|授權並返回應用/ })
    .click();
  await until(
    () =>
      panelEval(
        "!!document.querySelector('#workspace') && !document.querySelector('#workspace').hidden && !!document.querySelector('#entitlement-summary').textContent",
      ),
    Boolean,
    "signed-in Side Panel entitlement card",
  );
  const panelInitial = await panelRights(tenant);
  assert.deepEqual(panelInitial.plan_version_ids, initial.plan_version_ids);
  pass(
    "actual right-docked Chrome SIDE_PANEL signs in with native browser authorization and consumes the same scoped server rights",
  );

  stage = "grant reaches both native clients";
  const subject = await call(
    operator,
    "GET",
    "/v1/admin/entitlement-grants/subjects/user/" + user.id,
  );
  assert.equal(subject.status, 200);
  const command = {
    subject: { kind: "user", id: user.id },
    plan_version_id: fixedPlan,
    starts_at: new Date(Date.now() - 1000).toISOString(),
    ends_at: new Date(Date.now() + 3600000).toISOString(),
    overlap_policy: "reject",
    source: "manual",
    auto_renew: false,
    expected_subject_version: subject.data.version,
    reason: "Synthetic packaged Desktop and native Side Panel VIP acceptance",
  };
  const preview = await call(
    operator,
    "POST",
    "/v1/admin/entitlement-previews",
    command,
  );
  assert.equal(preview.status, 200);
  check("AdminPreview", preview.data);
  const committed = await call(
    operator,
    "POST",
    "/v1/admin/entitlement-grants",
    command,
    { "X-Admin-Preview-ID": preview.data.preview_id },
  );
  assert.equal(committed.status, 202);
  assert.equal(committed.data.state, "succeeded");
  sample(
    "native-vip-grant",
    "createAdminVipGrant",
    "AdminOperation",
    committed.data,
    202,
  );
  const grantId = committed.data.result_ids[0];
  await native
    .getByRole("button", { name: "Refresh access", exact: true })
    .click();
  const section = native
    .getByRole("heading", { name: "Current entitlements", exact: true })
    .locator("..")
    .locator("..");
  await section.getByText("Images", { exact: true }).waitFor();
  await panelEval("document.querySelector('#refresh-entitlements').click()");
  await until(
    () =>
      panelEval("document.querySelector('#entitlement-summary').textContent"),
    (s) => /圖片|Images/.test(s),
    "Side Panel updated features",
  );
  const desktopGranted = await desktopRights(),
    panelGranted = await panelRights(tenant);
  sample(
    "packaged-desktop-effective-rights",
    "getEffectiveEntitlements",
    "EffectiveEntitlements",
    desktopGranted,
  );
  sample(
    "native-sidepanel-effective-rights",
    "getEffectiveEntitlements",
    "EffectiveEntitlements",
    panelGranted,
  );
  assert.ok(desktopGranted.plan_version_ids.includes(fixedPlan));
  assert.deepEqual(
    panelGranted.plan_version_ids,
    desktopGranted.plan_version_ids,
  );
  await native
    .getByRole("heading", { name: "Current entitlements", exact: true })
    .scrollIntoViewIfNeeded();
  await capture(native, "26-vip-effective-rights.png", "copypaste-desktop");
  await panelCapture("15-vip-effective-rights.png");
  pass(
    "one canonical manual grant reaches the packaged Desktop and actual Side Panel; both display the added features and retain resource/budget conditions",
  );

  stage = "own persistent entitlement notifications";
  let notice: any;
  await until(
    async () => {
      const r = await call(
        user,
        "GET",
        "/v1/entitlement-notifications",
        undefined,
        { "X-Tenant-ID": tenant },
      );
      assert.equal(r.status, 200);
      notice = r.data.items[0];
      return !!notice;
    },
    Boolean,
    "bounded worker delivery",
    30000,
  );
  await native
    .getByRole("button", { name: "Refresh access", exact: true })
    .click();
  await section
    .getByRole("button", { name: "Mark read", exact: true })
    .first()
    .click();
  const notices = await call(
    user,
    "GET",
    "/v1/entitlement-notifications",
    undefined,
    { "X-Tenant-ID": tenant },
  );
  assert.equal(
    notices.data.items.find((n: any) => n.id === notice.id).read,
    true,
  );
  const nativeNotices = await panelEval(
    "chrome.runtime.sendMessage(" +
      JSON.stringify({
        type: "API",
        path: "/v1/entitlement-notifications",
        tenantId: tenant,
      }) +
      ")",
  );
  assert.equal(nativeNotices.ok, true);
  assert.equal(
    nativeNotices.data.items.find((n: any) => n.id === notice.id).read,
    true,
  );
  pass(
    "persistent own-user entitlement notifications reach native consumers and a Desktop read action is visible to the same account in Side Panel",
  );

  stage = "suspension reaches both native clients";
  const change = {
      expected_version: 1,
      reason: "Synthetic native access suspension",
    },
    suspensionPath = "/v1/admin/entitlement-grants/" + grantId + "/suspensions";
  const suspensionPreview = await call(
    operator,
    "POST",
    suspensionPath + "/previews",
    change,
  );
  assert.equal(suspensionPreview.status, 200);
  const suspended = await call(operator, "POST", suspensionPath, change, {
    "X-Admin-Preview-ID": suspensionPreview.data.preview_id,
  });
  assert.equal(suspended.status, 202);
  assert.equal(suspended.data.state, "succeeded");
  await native
    .getByRole("button", { name: "Refresh access", exact: true })
    .click();
  await section
    .getByText("Images", { exact: true })
    .waitFor({ state: "hidden" });
  await panelEval("document.querySelector('#refresh-entitlements').click()");
  await until(
    () =>
      panelEval("document.querySelector('#entitlement-summary').textContent"),
    (s) => s.length > 0 && !/圖片|Images/.test(s),
    "Side Panel suspended rights",
  );
  const desktopSuspended = await desktopRights(),
    panelSuspended = await panelRights(tenant);
  assert.ok(!desktopSuspended.plan_version_ids.includes(fixedPlan));
  assert.deepEqual(
    panelSuspended.plan_version_ids,
    desktopSuspended.plan_version_ids,
  );
  sample(
    "packaged-desktop-suspended-rights",
    "getEffectiveEntitlements",
    "EffectiveEntitlements",
    desktopSuspended,
  );
  sample(
    "native-sidepanel-suspended-rights",
    "getEffectiveEntitlements",
    "EffectiveEntitlements",
    panelSuspended,
  );
  assert.deepEqual(
    (
      await db.query(
        "SELECT id,balance_micros,reserved_micros,version FROM wallets WHERE user_id=$1 ORDER BY id",
        [user.id],
      )
    ).rows,
    walletBefore,
  );
  await capture(native, "27-vip-suspended-rights.png", "copypaste-desktop");
  await panelCapture("16-vip-suspended-rights.png");
  await native.evaluate(async () => (window as any).copyPasteBridge.signOut());
  await native
    .getByRole("button", {
      name: "Sign in securely in your browser",
      exact: true,
    })
    .waitFor();
  assert.equal(
    await native
      .getByRole("heading", { name: "Current entitlements", exact: true })
      .count(),
    0,
  );
  const loggedOut = await panelEval(
    "chrome.runtime.sendMessage({type:'LOGOUT'})",
  );
  assert.equal(loggedOut.ok, true);
  await until(
    () =>
      panelEval(
        "document.querySelector('#entitlement-summary').textContent==='' && document.querySelector('#workspace').hidden",
      ),
    Boolean,
    "Side Panel local rights cleared",
  );
  assert.equal(
    await worker.evaluate(
      async () => !!(await chrome.storage.session.get("tokens")).tokens,
    ),
    false,
  );
  nativeCredentialsCleared = true;
  pass(
    "suspension removes active VIP from both native clients without posting money; actual native sign-out clears credentials and visible entitlement caches",
  );
} catch (e) {
  errors.push(
    stage +
      ": " +
      (e instanceof Error ? e.message : String(e)).replace(
        /https?:\/\/[^\s'\"]+/g,
        (url) => {
          try {
            const u = new URL(url);
            return u.origin + u.pathname;
          } catch {
            return "[owned URL]";
          }
        },
      ),
  );
} finally {
  // Failure cleanup still uses the real native logout paths before closing the
  // owned processes. This does not turn a failed business check into a pass.
  if (!nativeCredentialsCleared && nativeApp) {
    try {
      const page = nativeApp.windows()[0];
      if (page && !page.isClosed())
        await page.evaluate(async () => (window as any).copyPasteBridge.signOut());
    } catch {
      errors.push("Owned Desktop failure-path logout failed");
    }
  }
  if (!nativeCredentialsCleared && panel) {
    try {
      await panelEval("chrome.runtime.sendMessage({type:'LOGOUT'})");
    } catch {
      errors.push("Owned Side Panel failure-path logout failed");
    }
  }
  try {
    await panel?.close();
    await mv3?.close();
    extensionClosed = true;
  } catch {
    errors.push("Owned Side Panel browser cleanup failed");
  }
  try {
    await nativeApp?.close();
    desktopClosed = true;
  } catch {
    errors.push("Owned packaged Desktop cleanup failed");
  }
  try {
    for (const c of contexts) await c.close();
    await browser?.close();
    await server?.close();
    closed = true;
  } catch {
    await server?.kill();
    errors.push("Owned authorization browser cleanup failed");
  }
  clearTimeout(deadline);
  for (const c of clients)
    try {
      assert.equal(
        (
          await call(
            c,
            "POST",
            c.user ? "/v1/auth/logout" : "/v1/admin/auth/logout",
          )
        ).status,
        200,
      );
    } catch {
      errors.push("Owned HTTP logout failed");
    }
  if (db)
    try {
      const users = clients.filter((c) => c.user).map((c) => c.id);
      const active = (
        await db.query(
          "SELECT count(*)::int AS n FROM sessions WHERE (admin_id=ANY($1::uuid[]) OR user_id=ANY($2::uuid[])) AND revoked_at IS NULL",
          [principals, users],
        )
      ).rows[0].n;
      if (active)
        errors.push("Owned session remained active before fallback cleanup");
      await db.query(
        "UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE admin_id=ANY($1::uuid[]) OR user_id=ANY($2::uuid[])",
        [principals, users],
      );
      await db.query(
        "UPDATE admin_principals SET status='suspended',auth_version=auth_version+1,version=version+1 WHERE id=ANY($1::uuid[])",
        [principals],
      );
      sessionsClosed =
        (
          await db.query(
            "SELECT count(*)::int AS n FROM sessions WHERE (admin_id=ANY($1::uuid[]) OR user_id=ANY($2::uuid[])) AND revoked_at IS NULL",
            [principals, users],
          )
        ).rows[0].n === 0;
      adminsDisabled =
        (
          await db.query(
            "SELECT count(*)::int AS n FROM admin_principals WHERE id=ANY($1::uuid[]) AND status='active'",
            [principals],
          )
        ).rows[0].n === 0;
    } catch {
      errors.push("Owned principal cleanup failed");
    } finally {
      await db.end();
    }
  const afterSources = await sourceSnapshot(),
    unchanged = JSON.stringify(beforeSources) === JSON.stringify(afterSources);
  if (!unchanged) errors.push("Native VIP source changed during verification");
  try {
    assert.deepEqual(
      await captureNativeSurfaces({
        desktop,
        extension,
        executable,
        packaged: true,
      }),
      testedArtifacts,
    );
    artifactsUnchanged = true;
  } catch {
    errors.push("Native artifacts changed during verification");
  }
  const at = new Date().toISOString();
  await writeFile(
    "evidence/native-vip.json",
    JSON.stringify(
      {
        at,
        status: errors.length ? "failed" : "passed",
        scope:
          "Bounded packaged Desktop browser PKCE, actual right-docked Chrome SIDE_PANEL sign-in, live grant/suspend rights, own notification read and sign-out only; full installer/system/SSO/production acceptance and all 102 TC remain separate",
        checks,
        errors,
        screenshots,
        browser_closed: closed,
        desktop_closed: desktopClosed,
        extension_closed: extensionClosed,
        user_browser_tabs_touched: false,
        owned_sessions_closed: sessionsClosed,
        owned_admin_principals_disabled: adminsDisabled,
        owned_native_credentials_cleared: nativeCredentialsCleared,
        source_unchanged: unchanged,
        source_files: beforeSources,
        tested_artifacts: testedArtifacts,
        artifacts_unchanged_after_run: artifactsUnchanged,
        model_calls: 0,
        external_payments: 0,
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    "evidence/native-vip-contract-samples.json",
    JSON.stringify(
      {
        at,
        origin,
        scope:
          "Actual packaged Desktop bridge and native SIDE_PANEL original effective entitlement DTOs plus canonical grant operation",
        samples,
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    "evidence/native-vip-screenshots.json",
    JSON.stringify(
      {
        at,
        scope:
          "Actual unedited owned packaged Desktop and native SIDE_PANEL screenshots",
        screenshots: screenshotFacts,
        source_files: beforeSources,
        browser_closed: closed,
        desktop_closed: desktopClosed,
        extension_closed: extensionClosed,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      checks: checks.length,
      samples: samples.length,
      errors,
      browser_closed: closed,
      desktop_closed: desktopClosed,
      extension_closed: extensionClosed,
      owned_native_credentials_cleared: nativeCredentialsCleared,
      artifacts_unchanged_after_run: artifactsUnchanged,
    }),
  );
  if (errors.length) process.exitCode = 1;
}
