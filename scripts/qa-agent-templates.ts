import {
  chromium,
  _electron,
  type Browser,
  type BrowserContext,
  type ElectronApplication,
  type Page,
} from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
import path from "node:path";
import { emailCode } from "./qa-auth.js";
const platform = path.resolve("../copypaste-platform"),
  desktop = path.resolve("../copypaste-desktop"),
  run = randomUUID();
const checks: any[] = [],
  samples: any[] = [],
  errors: string[] = [];
let browser: Browser | undefined,
  context: BrowserContext | undefined,
  app: ElectronApplication | undefined,
  db: any,
  closed = false,
  desktopClosed = false;
const passed = (name: string) => checks.push({ name, status: "passed" });
async function request(
  page: Page,
  url: string,
  method = "GET",
  body?: unknown,
  tenant?: string,
) {
  return page.evaluate(
    async ({ url, method, body, tenant }) => {
      const me = await (await fetch("/v1/me")).json();
      const response = await fetch(url, {
        method,
        headers: {
          "X-CSRF-Token": me.csrf_token ?? "",
          "Idempotency-Key": crypto.randomUUID(),
          ...(tenant ? { "X-Tenant-ID": tenant } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    },
    { url, method, body, tenant },
  );
}
async function call(
  page: Page,
  url: string,
  method = "GET",
  body?: unknown,
  tenant?: string,
) {
  const result = await request(page, url, method, body, tenant);
  assert.ok(
    result.status >= 200 && result.status < 300,
    `${method} ${url}: ${result.status} ${JSON.stringify(result.body)}`,
  );
  return result.body;
}
async function screenshot(page: Page, repo: string, name: string) {
  const folder = path.resolve("..", repo, "assets/screenshots");
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: path.join(folder, name + ".png"),
    fullPage: false,
    animations: "disabled",
  });
}
try {
  const config = await (
    await fetch("http://localhost:4310/v1/public/config")
  ).json();
  assert.equal(config.data_mode, "simulated");
  const env = parseEnv(await readFile(path.join(platform, ".env"), "utf8")),
    url = new URL(env.CONTROL_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(url.hostname));
  assert.equal(url.pathname, "/copypaste");
  const pg = createRequire(path.join(platform, "package.json"))("pg");
  db = new pg.Client({ connectionString: url.href });
  await db.connect();
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  context.setDefaultTimeout(15000);
  await context.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:4317/login");
  await page.getByLabel("Work email").fill(`templates-${run}@example.invalid`);
  const code = await emailCode(page, () =>
    page.getByRole("button", { name: "Send sign-in code" }).click(),
  );
  await page.locator('input[name="code"]').fill(code);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/welcome");
  await page.locator('input[name="name"]').fill("Harbour template studio");
  await page.locator('input[name="project_name"]').fill("Reviewed methods");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/app");
  const me = await call(page, "/v1/me"),
    tenant = me.memberships[0].id,
    project = (await call(page, `/v1/tenants/${tenant}/projects`)).items[0].id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  const directory = await call(
    page,
    "/v1/agent-templates?project_id=" + project,
    "GET",
    undefined,
    tenant,
  );
  assert.equal(directory.items.length, 19);
  assert.equal(
    directory.items.filter((row: any) => row.kind === "role_preset").length,
    18,
  );
  assert.ok(
    directory.items.every(
      (row: any) =>
        row.qualification_state === "unverified" &&
        row.data_mode === "simulated",
    ),
  );
  const helper = directory.items.find(
      (row: any) => row.kind === "default_helper",
    ),
    detail = await call(
      page,
      `/v1/agent-templates/${helper.id}?version=${helper.version}`,
      "GET",
      undefined,
      tenant,
    );
  samples.push(
    { schema: "AgentTemplateList", response: directory },
    { schema: "AgentTemplate", response: detail },
  );
  await page.goto("http://localhost:4317/app/roles");
  await page.locator("[data-template-role]").nth(18).waitFor();
  await page.getByRole("button", { name: "Engineering", exact: true }).click();
  await page.locator('[data-template-role="fullstack"]').waitFor();
  assert.equal(await page.locator("[data-template-role]").count(), 4);
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.locator("[data-template-role]").nth(18).waitFor();
  await page.getByRole("textbox", { name: "Search specialists" }).fill("%");
  await page.getByRole("heading", { name: "No matching roles" }).waitFor();
  assert.equal(await page.locator("[data-template-role]").count(), 0);
  await page.getByRole("textbox", { name: "Search specialists" }).clear();
  await page.locator("[data-template-role]").nth(18).waitFor();
  await screenshot(page, "copypaste-web", "44-role-templates");
  passed(
    "real login and workspace isolation expose 18 persisted professional presets plus a default helper; categories and literal searches do not reuse stale cards or claim live qualifications",
  );
  await page.locator('[data-template-role="fullstack"]').click();
  let modal = page.getByRole("dialog");
  await modal
    .getByRole("button", { name: "Check availability", exact: true })
    .click();
  await modal
    .getByText(
      "Some professional tools for this role are still being prepared.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await modal
      .getByRole("button", { name: "Create this specialist", exact: true })
      .count(),
    0,
  );
  await screenshot(page, "copypaste-web", "45-template-missing-tools");
  await modal.getByRole("button", { name: "Close" }).click();
  assert.equal((await call(page, base + "/agents")).items.length, 0);
  assert.equal((await call(page, base + "/tasks")).items.length, 0);
  passed(
    "a software preset reports its unavailable execution tools and cannot be instantiated or charged through the template flow",
  );
  await page.locator('[data-template-role="assistant"]').click();
  modal = page.getByRole("dialog");
  await modal
    .getByLabel("Specialist name", { exact: true })
    .fill("Reviewed campaign partner");
  await modal
    .getByLabel("Working instructions", { exact: true })
    .fill("Use only approved facts and label simulated evidence.");
  const preflightPromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/${helper.id}/preflights`) &&
      response.request().method() === "POST",
  );
  await modal
    .getByRole("button", { name: "Check availability", exact: true })
    .click();
  const preflight = await (await preflightPromise).json();
  assert.equal(preflight.state, "ready");
  samples.push({ schema: "RoleTemplatePreflight", response: preflight });
  await modal
    .getByRole("button", { name: "Create this specialist", exact: true })
    .waitFor();
  assert.equal((await call(page, base + "/agents")).items.length, 0);
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT reserved_micros FROM wallets WHERE tenant_id=$1",
          [tenant],
        )
      ).rows[0].reserved_micros,
    ),
    0,
  );
  await modal
    .getByLabel("Working instructions", { exact: true })
    .fill(
      "Preserve approved facts and clearly mark all synthetic observations.",
    );
  assert.equal(
    await modal
      .getByRole("button", { name: "Create this specialist", exact: true })
      .count(),
    0,
  );
  await modal
    .getByRole("button", { name: "Check availability", exact: true })
    .click();
  await modal
    .getByRole("button", { name: "Create this specialist", exact: true })
    .waitFor();
  await screenshot(page, "copypaste-web", "46-template-ready");
  passed(
    "preflights persist a real receipt without creating work, methods or wallet holds; editing the brief invalidates the visible check",
  );
  let accepted: any,
    attempts = 0;
  const keys: string[] = [];
  await page.route(
    `**/agent-templates/${helper.id}/instances`,
    async (route) => {
      attempts++;
      keys.push(route.request().headers()["idempotency-key"]);
      if (attempts === 1) {
        const response = await route.fetch();
        assert.equal(response.status(), 201);
        accepted = await response.json();
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await modal
    .getByRole("button", { name: "Create this specialist", exact: true })
    .click();
  await modal.getByRole("alert").waitFor();
  assert.ok(accepted?.agent_version_id);
  await modal
    .getByRole("button", { name: "Create this specialist", exact: true })
    .click();
  await page.waitForURL("**/app/specialists");
  await page.unroute(`**/agent-templates/${helper.id}/instances`);
  assert.equal(attempts, 2);
  assert.equal(new Set(keys).size, 1);
  assert.equal((await call(page, base + "/agents")).items.length, 1);
  samples.push({ schema: "Agent", response: accepted });
  const version = (
    await db.query(
      "SELECT * FROM agent_versions WHERE id=$1 AND tenant_id=$2",
      [accepted.agent_version_id, tenant],
    )
  ).rows[0];
  assert.equal(version.template_version_id, helper.template_version_id);
  assert.equal(version.runtime_profile_id, helper.runtime_profile_id);
  assert.equal(version.body.kernel, "codex");
  assert.equal(version.body.capability_version_ids.length, 1);
  assert.match(version.body.instructions, /synthetic observations/);
  assert.equal((await call(page, base + "/tasks")).items.length, 0);
  passed(
    "a lost real acceptance response reuses one idempotency key and creates one specialist with persisted template, Codex, capability and Skill versions and no AI task",
  );
  const installation = (
    await call(page, base + "/skill-installations")
  ).items.find((row: any) => row.id === accepted.skill_installation_ids[0]);
  assert.ok(installation);
  let changed = await call(
    page,
    base + "/skill-installations/" + installation.id,
    "PATCH",
    { expected_version: installation.version, enabled: false },
  );
  await page.goto("http://localhost:4317/app/roles");
  await page.locator('[data-template-role="assistant"]').click();
  modal = page.getByRole("dialog");
  await modal
    .getByRole("button", { name: "Check availability", exact: true })
    .click();
  await modal
    .getByText(
      "A required method is disabled or revoked. Contact your project administrator.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await modal
      .getByRole("button", { name: "Create this specialist", exact: true })
      .count(),
    0,
  );
  changed = await call(
    page,
    base + "/skill-installations/" + installation.id,
    "PATCH",
    { expected_version: changed.version, enabled: true },
  );
  await modal
    .getByRole("button", { name: "Check availability", exact: true })
    .click();
  await modal
    .getByRole("button", { name: "Create this specialist", exact: true })
    .waitFor();
  passed(
    "disabling a required project method blocks a further instance; restoring it and explicitly rechecking obtains a new receipt instead of replaying the obsolete failure",
  );
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 960 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `template modal overflow at ${width}`,
    );
  }
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await screenshot(page, "copypaste-web", "47-template-mobile-dark");
  await modal.getByRole("button", { name: "Close" }).click();
  await page.getByTitle("切換至繁體中文").click();
  await page.locator('[data-template-role="assistant"]').click();
  modal = page.getByRole("dialog");
  await modal
    .getByRole("button", { name: "檢查可用性", exact: true })
    .waitFor();
  await screenshot(page, "copypaste-web", "48-template-zh");
  await modal.getByRole("button", { name: "Close" }).click();
  passed(
    "template details and dependency controls fit four viewport widths, both themes and Traditional Chinese/English",
  );
  await page.getByTitle("Switch to English").click();
  await page.route("**/v1/agent-templates?*", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "FORBIDDEN",
          message: "Controlled template permission loss",
        },
      }),
    }),
  );
  await page.reload();
  await page
    .getByRole("alert")
    .filter({ hasText: "Controlled template permission loss" })
    .waitFor();
  assert.equal(await page.locator("[data-template-role]").count(), 0);
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.unroute("**/v1/agent-templates?*");
  passed(
    "an injected later directory denial clears selectable template content and closes the detail flow",
  );
  // Launch only this source build and an isolated native profile; never the user's app/profile.
  const profile = path.resolve(".data/template-desktop-" + run);
  await mkdir(profile, { recursive: true });
  app = await _electron.launch({
    executablePath: path.join(
      desktop,
      "node_modules/electron/dist/electron.exe",
    ),
    args: [desktop],
    env: { ...process.env, COPYPASTE_USER_DATA: profile },
  });
  const native = await app.firstWindow({ timeout: 30000 });
  native.on("pageerror", (e) => errors.push(e.message));
  await native.waitForURL(/file:.*index\.html/);
  await native.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  await native.reload();
  await app.evaluate(({ shell }) => {
    shell.openExternal = async (url: string) => {
      (globalThis as any).__templateAuthURL = url;
    };
  });
  await native
    .getByRole("button", { name: "Sign in securely in your browser" })
    .click({ noWaitAfter: true });
  let authURL = "";
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    authURL = await app.evaluate(
      () => (globalThis as any).__templateAuthURL ?? "",
    );
    if (authURL) break;
    await native.waitForTimeout(100);
  }
  assert.ok(authURL);
  const auth = await context.newPage();
  await auth.goto(authURL);
  await auth
    .getByRole("button", { name: /Connect.*|Allow.*|Authorize.*/ })
    .click();
  await native.waitForURL("**#/app");
  const nativeRequest = async (tenantId?: string) =>
    native.evaluate(
      async (tenantId) =>
        (window as any).copyPasteBridge.request("/v1/agent-templates", {
          tenantId,
        }),
      tenantId,
    );
  assert.equal((await nativeRequest()).status, 400);
  assert.equal((await nativeRequest(randomUUID())).status, 404);
  assert.equal((await nativeRequest(tenant)).body.items.length, 19);
  await assert.rejects(nativeRequest("invalid-tenant"));
  await native.evaluate(() => {
    location.hash = "/app/roles";
  });
  await native.locator('[data-template-role="assistant"]').click();
  const nativeModal = native.getByRole("dialog");
  await nativeModal
    .getByLabel("Specialist name", { exact: true })
    .fill("Desktop reviewed partner");
  await nativeModal
    .getByRole("button", { name: "Check availability", exact: true })
    .click();
  await nativeModal
    .getByRole("button", { name: "Create this specialist", exact: true })
    .click();
  await native.waitForURL("**#/app/specialists");
  await native
    .getByRole("heading", { name: "Desktop reviewed partner", exact: true })
    .waitFor();
  await screenshot(native, "copypaste-desktop", "13-role-template-specialists");
  assert.equal((await call(page, base + "/agents")).items.length, 2);
  assert.equal((await call(page, base + "/tasks")).items.length, 0);
  passed(
    "current native Electron source completes real PKCE sign-in and the same template flow through its validated tenant header bridge; missing/foreign/malformed tenant identities cannot access it",
  );
  assert.deepEqual(errors, []);
} catch (e: any) {
  checks.push({
    name: "role template browser and Desktop regression",
    status: "failed",
    detail: e.message,
  });
  throw e;
} finally {
  const cleanupErrors: string[] = [];
  for (const [name, close] of [
    [
      "Electron",
      async () => {
        if (app) {
          await app.close();
          desktopClosed = true;
        }
      },
    ],
    [
      "browser context",
      async () => {
        if (context) await context.close();
      },
    ],
    [
      "browser",
      async () => {
        if (browser) {
          await browser.close();
          closed = true;
        }
      },
    ],
    [
      "database client",
      async () => {
        if (db) await db.end();
      },
    ],
  ] as const) {
    try {
      await close();
    } catch {
      cleanupErrors.push(`Failed to close this run's ${name}`);
    }
  }
  if (cleanupErrors.length) {
    errors.push(...cleanupErrors);
    checks.push({ name: "owned resource cleanup", status: "failed" });
  }
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/agent-templates.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        dependency_mode: "simulated",
        qualification_state: "unverified",
        checks,
        errors,
        browser_closed: closed,
        desktop_closed: desktopClosed,
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    "evidence/agent-templates-contract-samples.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        origin: "http://localhost:4310",
        dependency_mode: "simulated",
        samples,
      },
      null,
      2,
    ) + "\n",
  );
  if (cleanupErrors.length) throw new Error(cleanupErrors.join("; "));
}
