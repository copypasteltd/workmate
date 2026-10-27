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
  screenshotFacts: any[] = [],
  inspection: Record<string, unknown> = {};
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
  files.push("copypaste-delivery/scripts/qa-financial-ui.ts");
  files.push(
    "copypaste-delivery/scripts/native-surface-integrity.mjs",
    "copypaste-delivery/package.json",
    "copypaste-delivery/package-lock.json",
  );
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
    "document.querySelector('#financial-heading').scrollIntoView({block:'start'})",
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
        path.join(platform, "contracts/financial-notification-schemas.json"),
        "utf8",
      ),
    ),
    specBytes = await readFile("../../docs/contracts/openapi.json"),
    spec = JSON.parse(specBytes.toString());
  assert.equal(fixture.normative_source_sha256, sha(specBytes));
  assert.deepEqual(fixture.schemas.Money, spec.components.schemas.Money);
  const { Ajv2020 } = requirePlatform("ajv/dist/2020.js"),
    ajv = new Ajv2020({ allErrors: true });
  requirePlatform("ajv-formats")(ajv);
  const defs = JSON.parse(
    JSON.stringify({
      ...spec.components.schemas,
      ...fixture.schemas,
    }).replaceAll("#/components/schemas/", "#/$defs/"),
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

  const account = (
    await db.query(
      "SELECT id FROM wallets WHERE user_id=$1 AND data_mode='simulated'",
      [user.id],
    )
  ).rows[0];
  const billingRoot = "/v1/admin/billing/accounts/" + account.id;
  const money = (n: string) => ({ currency: "HKD", amount_micros: n });
  async function fee(command: any) {
    const preview = await call(
      operator,
      "POST",
      billingRoot + "/previews",
      command,
    );
    assert.equal(preview.status, 200, JSON.stringify(preview.data));
    const result = await call(
      operator,
      "POST",
      billingRoot +
        "/" +
        (command.action === "top_up"
          ? "top-up"
          : command.action === "credit_limit"
            ? "credit-limit"
            : command.action),
      command,
      { "X-Admin-Preview-ID": preview.data.preview_id },
    );
    assert.equal(result.status, 202, JSON.stringify(result.data));
    assert.equal(
      result.data.state,
      command.action === "refund" && command.destination === "payment_method"
        ? "reconciling"
        : "succeeded",
    );
    return result.data;
  }
  const giftVersion = (await call(operator, "GET", billingRoot)).data.version;
  const gift = {
    action: "gift",
    expected_version: giftVersion,
    reason: "Synthetic user notification gift; no real payment",
    amount: money("12500001"),
    expires_at: "2027-12-31T18:00:00.000Z",
  };
  const giftOp = await fee(gift);
  const giftEntry = (
    await db.query(
      "SELECT id FROM billing_journal WHERE operation_id=$1 AND kind='gift'",
      [giftOp.id],
    )
  ).rows[0];
  assert.ok(giftEntry);
  pass(
    "one canonical exact personal gift commits its durable financial source and audit with the account",
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
      COPYPASTE_USER_DATA: path.resolve(".data/financial-ui", run, "desktop"),
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
      (globalThis as any).__financialAuthorizationURL = url;
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
        () => (globalThis as any).__financialAuthorizationURL ?? "",
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

  const initialPlan = await native.evaluate(
    async (tenant) =>
      (window as any).copyPasteBridge.request(`/v1/tenants/${tenant}/plan`, {
        tenantId: tenant,
      }),
    tenant,
  );
  assert.equal(initialPlan.status, 200);
  await native
    .locator(".plan-card h2")
    .filter({ hasText: initialPlan.body.body.name })
    .waitFor();
  assert.equal(
    await native.locator(".plan-card h2").textContent(),
    initialPlan.body.body.name,
  );
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
    path.resolve(".data/financial-ui", run, "chrome"),
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
  assert.ok(
    worker.url().includes(id),
    "The owned service worker must match the bundled extension ID",
  );
  await until(
    () => worker.evaluate(() => chrome.sidePanel.getPanelBehavior()),
    (behavior) => behavior.openPanelOnActionClick === true,
    "native toolbar behavior installed",
  );
  const main = mv3.pages()[0];
  await main.goto(web + "/app/usage");
  await main.bringToFront();
  const cdp = await mv3.browser()!.newBrowserCDPSession();
  const target = await until(
    async () =>
      (await cdp.send("Target.getTargets", { filter: [{}] })).targetInfos.find(
        (t) => t.type === "tab" && t.url.startsWith(web),
      ),
    Boolean,
    "owned ordinary browser tab CDP target",
  );
  assert.ok(
    target,
    "The actual ordinary browser tab must be exposed as a CDP tab target",
  );
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
    (v) => {
      inspection.side_panel_contexts = v;
      return (
        v.length === 1 &&
        v[0].documentUrl === `chrome-extension://${id}/sidepanel.html`
      );
    },
    "actual SIDE_PANEL",
  );
  assert.equal(mv3.pages().length, ordinaryTabs);
  assert.equal(
    (await worker.evaluate(() => chrome.sidePanel.getLayout())).side,
    "right",
  );
  const panelTarget = await until(
    async () => {
      const targets = (await cdp.send("Target.getTargets", { filter: [{}] }))
        .targetInfos;
      inspection.panel_targets = targets.map((t) => ({
        type: t.type,
        url: t.url.split("?")[0].split("#")[0],
      }));
      return targets.find(
        (t) => t.type === "page" && t.url === side[0].documentUrl,
      );
    },
    Boolean,
    "actual native SIDE_PANEL document target",
  );
  assert.ok(
    panelTarget,
    "The actual native SIDE_PANEL document must have a CDP page target",
  );
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

  stage = "Web and three-client financial inbox";
  const personalPage = await pageFor(user);
  await personalPage.goto(web + "/app/usage");
  const inbox = personalPage.locator(".financial-inbox");
  await inbox
    .getByRole("heading", {
      name: "Financial account notifications",
      exact: true,
    })
    .waitFor();
  const personalCard = inbox.locator(
    '[data-financial-account="' + account.id + '"]',
  );
  await personalCard.getByText("HKD 12.500001", { exact: true }).waitFor();
  const financialAPI = async () => {
    const r = await call(
      user,
      "GET",
      "/v1/financial-notifications?category=all",
      undefined,
      { "X-Tenant-ID": tenant },
    );
    assert.equal(r.status, 200, JSON.stringify(r.data));
    check("FinancialNotificationList", r.data);
    return r.data;
  };
  const first = await until(
    financialAPI,
    (r) => r.items.some((n: any) => n.source_id === giftEntry.id),
    "real worker durable financial dispatch",
    40000,
  );
  const giftNotice = first.items.find((n: any) => n.source_id === giftEntry.id);
  sample(
    "financial-api-exact-gift",
    "listFinancialNotifications",
    "FinancialNotificationList",
    first,
  );
  const noticeSelector =
    '[data-financial-notification="' + giftNotice.id + '"]';
  await inbox
    .getByRole("button", { name: "Refresh accounts and notices", exact: true })
    .click();
  await inbox
    .locator(noticeSelector)
    .getByText("HKD 12.500001", { exact: true })
    .waitFor();
  await native
    .locator(".financial-inbox")
    .getByRole("button", { name: "Refresh accounts and notices", exact: true })
    .click();
  await native
    .locator(noticeSelector)
    .getByText("HKD 12.500001", { exact: true })
    .waitFor();
  await panelEval("document.querySelector('#refresh-financial').click()");
  await until(
    () =>
      panelEval(
        "document.querySelector(" +
          JSON.stringify("#financial-notices " + noticeSelector) +
          ")?.textContent||''",
      ),
    (v) => v.includes("12.500001"),
    "real Side Panel exact gift",
  );
  const nativeList = await native.evaluate(
    async (tenant) =>
      (window as any).copyPasteBridge.request(
        "/v1/financial-notifications?category=all",
        { tenantId: tenant },
      ),
    tenant,
  );
  assert.equal(nativeList.status, 200);
  sample(
    "financial-packaged-desktop",
    "listFinancialNotifications",
    "FinancialNotificationList",
    nativeList.body,
  );
  const panelList = await panelEval(
    "chrome.runtime.sendMessage(" +
      JSON.stringify({
        type: "API",
        path: "/v1/financial-notifications?category=all",
        tenantId: tenant,
      }) +
      ")",
  );
  assert.equal(panelList.ok, true);
  sample(
    "financial-native-sidepanel",
    "listFinancialNotifications",
    "FinancialNotificationList",
    panelList.data,
  );
  await capture(personalPage, "39-financial-inbox.png", "copypaste-web");
  await capture(native, "28-financial-inbox.png", "copypaste-desktop");
  await panelCapture("17-financial-inbox.png");
  pass(
    "current Web, actual packaged frameless Desktop and actual right Side Panel show the same durable gift and exact six-decimal personal balance",
  );

  stage = "persistent read and unread across clients";
  await inbox
    .locator(noticeSelector)
    .getByRole("button", { name: /^Mark read:/ })
    .click();
  await until(
    financialAPI,
    (r) => r.items.find((n: any) => n.id === giftNotice.id)?.read === true,
    "persistent actual read",
  );
  await native
    .locator(".financial-inbox")
    .getByRole("button", { name: "Refresh accounts and notices", exact: true })
    .click();
  await native
    .locator(noticeSelector)
    .getByRole("button", { name: /^Mark unread:/ })
    .waitFor();
  await panelEval("document.querySelector('#refresh-financial').click()");
  await until(
    () =>
      panelEval(
        "document.querySelector(" +
          JSON.stringify("#financial-notices " + noticeSelector + " button") +
          ")?.textContent||''",
      ),
    (v) => v.includes("未讀"),
    "Side Panel reads server receipt",
  );
  await panelEval(
    "document.querySelector(" +
      JSON.stringify("#financial-notices " + noticeSelector + " button") +
      ").click()",
  );
  await until(
    financialAPI,
    (r) => r.items.find((n: any) => n.id === giftNotice.id)?.read === false,
    "Side Panel actual unread",
  );
  await inbox
    .getByRole("checkbox", { name: "Unread only", exact: true })
    .check();
  await inbox
    .locator(noticeSelector)
    .getByRole("button", { name: /^Mark read:/ })
    .waitFor();
  pass(
    "real Web read receipt reaches both native clients; Side Panel can mark unread and Web unread filter reads the persisted state",
  );

  stage = "unknown actual refund outcome";
  // All facts use real APIs and the canonical receipt/confirmation/refund engine.
  // Evidence is a private synthetic text upload; no bank or payment provider is called.
  const form = new FormData();
  form.append(
    "file",
    new Blob(["Synthetic receipt " + run], { type: "text/plain" }),
    "receipt.txt",
  );
  const evidenceResponse = await fetch(
    origin +
      `/v1/tenants/${tenant}/projects/${workspace.data.project.id}/assets`,
    {
      method: "POST",
      headers: {
        Origin: web,
        Cookie: user.cookie,
        "X-CSRF-Token": user.csrf,
        "Idempotency-Key": randomUUID(),
      },
      body: form,
    },
  );
  assert.equal(evidenceResponse.status, 200);
  const asset = await evidenceResponse.json();
  // Controlled fixture ownership only: no bank statement is uploaded. The
  // receipt APIs still enforce real personal-subject evidence permissions.
  await db.query(
    "UPDATE assets SET private_owner=$2 WHERE id=$1 AND created_by=$2",
    [asset.id, user.id],
  );
  const evidence = (
    await db.query(
      "SELECT id FROM asset_versions WHERE asset_id=$1 ORDER BY version DESC LIMIT 1",
      [asset.id],
    )
  ).rows[0].id;
  const receiptCommand = {
    billing_account_id: account.id,
    amount: money("101000000"),
    external_reference: "synthetic-finance-" + run,
    received_at: new Date(Date.now() - 1000).toISOString(),
    evidence_asset_version_id: evidence,
    reason: "Synthetic receipt evidence; no payment received",
  };
  const receipt = await call(
    operator,
    "POST",
    "/v1/admin/billing/payments",
    receiptCommand,
  );
  assert.equal(receipt.status, 202, JSON.stringify(receipt.data));
  const paymentId = receipt.data.result_ids[0];
  const confirmation = await call(
    reviewer,
    "POST",
    "/v1/admin/billing/payments/" + paymentId + "/confirmations",
    {
      expected_version: 1,
      verified_reference: receiptCommand.external_reference,
      reason: "Independent synthetic evidence verification",
    },
  );
  assert.equal(confirmation.status, 202, JSON.stringify(confirmation.data));
  const paidVersion = (await call(operator, "GET", billingRoot)).data.version;
  const payment = await fee({
    action: "top_up",
    expected_version: paidVersion,
    reason: "Synthetic verified receipt posting",
    amount: money("101000000"),
    payment_record_id: paymentId,
  });
  const paidEntry = (
    await db.query(
      "SELECT id FROM billing_journal WHERE operation_id=$1 AND kind='top_up'",
      [payment.id],
    )
  ).rows[0];
  const refundVersion = (await call(operator, "GET", billingRoot)).data.version;
  const refund = await fee({
    action: "refund",
    expected_version: refundVersion,
    reason: "Synthetic payment-method refund hold",
    amount: money("60000000"),
    original_entry_id: paidEntry.id,
    destination: "payment_method",
  });
  const refundId = (
    await db.query("SELECT id FROM billing_refunds WHERE operation_id=$1", [
      refund.id,
    ])
  ).rows[0].id;
  const unknown = await call(
    reviewer,
    "POST",
    "/v1/admin/billing/refunds/" + refundId + "/outcomes",
    {
      expected_version: 1,
      reason: "Synthetic unconfirmed payout; no bank transfer",
      outcome: "unknown",
      observed_amount: null,
      evidence_asset_version_id: null,
      external_reference: null,
      occurred_at: null,
    },
  );
  assert.equal(unknown.status, 202, JSON.stringify(unknown.data));
  const refundInbox = await until(
    financialAPI,
    (r) => r.items.some((n: any) => n.event_type === "refund.unknown"),
    "worker delivery of real unknown outcome",
    40000,
  );
  const unknownNotice = refundInbox.items.find(
    (n: any) => n.event_type === "refund.unknown",
  );
  assert.equal(unknownNotice.amount, null);
  assert.deepEqual(unknownNotice.requested_amount, money("60000000"));
  sample(
    "financial-unknown-real-refund",
    "listFinancialNotifications",
    "FinancialNotificationList",
    refundInbox,
  );
  await inbox
    .getByRole("button", { name: "Refresh accounts and notices", exact: true })
    .click();
  const unknownSelector =
    '[data-financial-notification="' + unknownNotice.id + '"]';
  await inbox
    .locator(unknownSelector)
    .getByText("Amount unknown", { exact: true })
    .waitFor();
  await native
    .locator(".financial-inbox")
    .getByRole("button", { name: "Refresh accounts and notices", exact: true })
    .click();
  await native
    .locator(unknownSelector)
    .getByText("Amount unknown", { exact: true })
    .waitFor();
  await panelEval("document.querySelector('#refresh-financial').click()");
  await until(
    () =>
      panelEval(
        "document.querySelector(" +
          JSON.stringify("#financial-notices " + unknownSelector) +
          ")?.textContent||''",
      ),
    (v) => v.includes("金額待核對"),
    "Side Panel unknown stays unknown",
  );
  await capture(personalPage, "40-financial-unknown.png", "copypaste-web");
  await capture(native, "29-financial-unknown.png", "copypaste-desktop");
  await panelCapture("18-financial-unknown.png");
  const hintContrast = await panelEval(`(() => {
    const hint=document.querySelector('#financial-hint'), style=getComputedStyle(hint);
    const rgb=s=>(s.match(/[\\d.]+/g)||[]).slice(0,3).map(Number);
    const background=rgb(getComputedStyle(document.documentElement).backgroundColor),text=rgb(style.color),opacity=Number(style.opacity);
    const luminance=values=>values.map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
    const foreground=text.map((v,i)=>v*opacity+background[i]*(1-opacity)),a=luminance(foreground),b=luminance(background);
    return {ratio:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05),background,text,opacity};
  })()`);
  assert.ok(
    hintContrast.ratio >= 4.5,
    "Actual native financial hint contrast must reach 4.5:1",
  );
  inspection.financial_hint_contrast = hintContrast;
  pass(
    "real private receipt, independent confirmation and posting create distinct events; actual unknown cash outcome remains unknown and retains original requested amount in all three clients",
  );

  stage = "responsive financial UI and failed-read erasure";
  const small = await pageFor(user, 375, "zh-HK", "dark");
  await small.emulateMedia({ reducedMotion: "reduce" });
  await small.goto(web + "/app/usage");
  await small
    .locator(".financial-inbox")
    .getByRole("heading", { name: "費用與帳戶通知", exact: true })
    .waitFor();
  await small
    .locator(unknownSelector)
    .getByText("金額待核對", { exact: true })
    .waitFor();
  await capture(small, "41-financial-narrow-dark.png", "copypaste-web");
  await small.setViewportSize({ width: 812, height: 375 });
  await small.evaluate(
    () => (document.documentElement.style.fontSize = "28px"),
  );
  assert.ok(
    await small.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Large text landscape must not overflow",
  );
  await personalPage.route("**/v1/financial-notifications*", (route) =>
    route.abort("failed"),
  );
  await inbox
    .getByRole("button", { name: "Refresh accounts and notices", exact: true })
    .click();
  await until(
    () =>
      inbox
        .locator("[data-financial-notification],[data-financial-account]")
        .count(),
    (n) => n === 0,
    "failed financial read clears protected notices and balances",
  );
  await inbox.getByRole("alert").waitFor();
  await capture(personalPage, "42-financial-offline.png", "copypaste-web");
  await personalPage.unroute("**/v1/financial-notifications*");
  pass(
    "375px Traditional Chinese dark view, reduced motion and large-text landscape keep exact amounts readable; failed reload clears old balances and notices",
  );

  stage = "current membership revocation and native sign-out";
  await db.query(
    "UPDATE memberships SET role='member',version=version+1 WHERE user_id=$1 AND tenant_id=$2",
    [user.id, tenant],
  );
  const own = await financialAPI();
  assert.ok(
    own.items.every(
      (n: any) => n.subject.kind === "user" && n.subject.id === user.id,
    ),
  );
  await db.query(
    "UPDATE memberships SET status='removed',admin_suspended=true,version=version+1 WHERE user_id=$1 AND tenant_id=$2",
    [user.id, tenant],
  );
  const denied = await call(
    user,
    "GET",
    "/v1/financial-notifications",
    undefined,
    { "X-Tenant-ID": tenant },
  );
  assert.equal(denied.status, 404);
  await native
    .locator(".financial-inbox")
    .getByRole("button", { name: "Refresh accounts and notices", exact: true })
    .click();
  await until(
    () =>
      native
        .locator(
          ".financial-inbox [data-financial-notification],.financial-inbox [data-financial-account]",
        )
        .count(),
    (n) => n === 0,
    "packaged failure/revocation clears financial content",
  );
  await panelEval("document.querySelector('#refresh-financial').click()");
  await until(
    () =>
      panelEval(
        "document.querySelector('#financial-summary').children.length+document.querySelector('#financial-notices').children.length",
      ),
    (n) => n === 0,
    "native Side Panel revocation clears financial content",
  );
  await native.evaluate(async () => (window as any).copyPasteBridge.signOut());
  await native
    .getByRole("button", {
      name: "Sign in securely in your browser",
      exact: true,
    })
    .waitFor();
  assert.equal(await native.locator(".financial-inbox").count(), 0);
  const loggedOut = await panelEval(
    "chrome.runtime.sendMessage({type:'LOGOUT'})",
  );
  assert.equal(loggedOut.ok, true);
  await until(
    () =>
      panelEval(
        "document.querySelector('#financial-summary').textContent===''&&document.querySelector('#financial-notices').textContent===''&&document.querySelector('#workspace').hidden",
      ),
    Boolean,
    "native sign-out clears private funds",
  );
  assert.equal(
    await worker.evaluate(
      async () => !!(await chrome.storage.session.get("tokens")).tokens,
    ),
    false,
  );
  nativeCredentialsCleared = true;
  pass(
    "current demotion keeps only personal facts; administrative membership suspension denies the API and both native clients erase protected content; actual sign-out clears local credentials",
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
        await page.evaluate(async () =>
          (window as any).copyPasteBridge.signOut(),
        );
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
  if (!unchanged)
    errors.push("Financial UI source changed during verification");
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
    "evidence/financial-ui.json",
    JSON.stringify(
      {
        at,
        status: errors.length ? "failed" : "passed",
        scope:
          "Bounded actual Admin fees, Web financial account inbox, packaged frameless Desktop and native right Side Panel money/read/unknown/error/revocation workflows. All 102 TC and production acceptance remain separate",
        checks,
        errors,
        screenshots,
        inspection,
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
    "evidence/financial-ui-contract-samples.json",
    JSON.stringify(
      {
        at,
        origin,
        scope:
          "Actual financial notification supplementary DTOs and unchanged original account/fee/effective entitlement responses; not additions to the immutable original OpenAPI",
        samples,
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    "evidence/financial-ui-screenshots.json",
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
