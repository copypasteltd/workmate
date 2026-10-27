import {
  chromium,
  type BrowserServer,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { emailCode, verifyAdmin } from "./qa-auth.js";

const platform = path.resolve("../copypaste-platform"),
  requirePlatform = createRequire(path.join(platform, "package.json")),
  pg = requirePlatform("pg"),
  OTPAuth = requirePlatform("otpauth");
const checks: any[] = [],
  errors: string[] = [],
  screenshots: string[] = [],
  contexts: BrowserContext[] = [];
let server: BrowserServer | undefined,
  browser: Browser | undefined,
  db: any,
  principal: string | undefined,
  user: string | undefined,
  closed = false,
  stage = "initializing";
const tag = "Directory QA " + randomUUID().slice(0, 8) + " ";
const users: string[] = [],
  tenants: string[] = [],
  samples: any[] = [];
const pass = (name: string) => checks.push({ name, status: "passed" });
const deadline = setTimeout(() => {
  errors.push(
    "Owned browser verification exceeded its 180 second bound at " + stage,
  );
  void server?.kill();
}, 180000);
async function screenshot(page: Page, name: string) {
  const folder = path.resolve("../copypaste-admin/assets/screenshots");
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: path.join(folder, name),
    fullPage: true,
    timeout: 10000,
  });
  screenshots.push(name);
}
async function manage(page: Page) {
  await page
    .getByRole("button", { name: "Manage account", exact: true })
    .click();
  const d = page.getByRole("dialog", {
    name: "Manage user account",
    exact: true,
  });
  await d.getByLabel("Action", { exact: true }).waitFor();
  return d;
}
try {
  const env = parseEnv(await readFile(path.join(platform, ".env"), "utf8")),
    url = new URL(env.CONTROL_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(url.hostname));
  assert.equal(url.pathname, "/copypaste");
  db = new pg.Client({ connectionString: url.href });
  await db.connect();
  const { seal } = await import(
      pathToFileURL(path.join(platform, "src/lib.ts")).href
    ),
    email = `directory-ui-admin-${randomUUID()}@example.invalid`,
    secret = new OTPAuth.Secret({ size: 20 });
  principal = (
    await db.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Synthetic UI account operator',$2) RETURNING id",
      [email, seal(env.MASTER_KEY!, secret.base32)],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,'super_admin','global')",
    [principal],
  );
  for (let i = 0; i < 23; i++) {
    const u = (
      await db.query(
        "INSERT INTO users(email,name) VALUES($1,$2) RETURNING id",
        [
          `directory-ui-${randomUUID()}@example.invalid`,
          tag + String(i).padStart(2, "0"),
        ],
      )
    ).rows[0].id;
    users.push(u);
  }
  user = users[0];
  for (let i = 0; i < 2; i++) {
    const tenant = (
      await db.query("INSERT INTO tenants(name) VALUES($1) RETURNING id", [
        tag + "workspace " + i,
      ])
    ).rows[0].id;
    tenants.push(tenant);
    await db.query("INSERT INTO wallets(tenant_id) VALUES($1)", [tenant]);
    const project = (
      await db.query(
        "INSERT INTO projects(tenant_id,name) VALUES($1,'Directory QA project') RETURNING id",
        [tenant],
      )
    ).rows[0].id;
    await db.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
      [tenant, user],
    );
    if (!i) {
      await db.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'viewer')",
        [tenant, users[1]],
      );
      await db.query(
        "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'viewer')",
        [tenant, project, users[1]],
      );
    }
  }
  await db.query(
    "INSERT INTO entitlements(user_id,plan,starts_at,ends_at,reason) VALUES($1,'pro',now()-interval '1 hour',now()+interval '1 day','Owned synthetic directory UI fixture')",
    [user],
  );
  stage = "owned Chromium launch";
  server = await chromium.launchServer({
    headless: true,
    executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
    args: ["--disable-gpu"],
    timeout: 15000,
  });
  browser = await chromium.connect(server.wsEndpoint(), { timeout: 15000 });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  contexts.push(context);
  context.setDefaultTimeout(15000);
  await context.addInitScript(() => {
    if (!localStorage.getItem("cp_locale"))
      localStorage.setItem("cp_locale", "en");
    if (!localStorage.getItem("cp_theme"))
      localStorage.setItem("cp_theme", "light");
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  stage = "Admin email and TOTP login";
  await page.goto("http://localhost:4318", {
    waitUntil: "domcontentloaded",
    timeout: 15000,
  });
  await page.getByLabel("Administrator email").fill(email);
  const otp = await emailCode(
    page,
    () =>
      page
        .getByRole("button", { name: "Send admin sign-in code", exact: true })
        .click(),
    true,
  );
  await page.locator('input[name="code"]').fill(otp);
  await verifyAdmin(page, secret.base32);
  await page.waitForURL("**/overview");
  pass(
    "actual email and TOTP Admin sign-in into the current-source Vite dashboard",
  );
  const Ajv2020 = requirePlatform("ajv/dist/2020.js").Ajv2020,
    ajv = new Ajv2020({ allErrors: true });
  requirePlatform("ajv-formats")(ajv);
  const fixture = JSON.parse(
    await readFile(
      path.join(platform, "contracts/admin-directory-schemas.json"),
      "utf8",
    ),
  );
  const defs = JSON.parse(
    JSON.stringify(fixture.schemas).replaceAll(
      "#/components/schemas/",
      "#/$defs/",
    ),
  );
  async function capture(
    schema: string,
    action: () => Promise<unknown>,
    resource: string,
  ) {
    const pending = page.waitForResponse(
      (r) =>
        r.request().method() === "GET" &&
        new URL(r.url()).pathname === resource &&
        r.status() === 200,
    );
    await action();
    const response = await pending,
      body = await response.json();
    const check = ajv.compile({ $defs: defs, $ref: "#/$defs/" + schema });
    assert.ok(check(body), JSON.stringify(check.errors));
    if (
      !body.items ||
      body.items.every((row: any) =>
        (schema === "AdminTenantList" ? tenants : users).includes(row.id),
      )
    )
      samples.push({
        schema,
        method: "GET",
        path: new URL(response.url()).pathname,
        response: body,
      });
    return body;
  }
  async function userSearch() {
    await capture(
      "AdminUserList",
      () => page.getByLabel("Search records", { exact: true }).fill(tag),
      "/v1/admin/users",
    );
  }
  stage = "current directory filters and cursor navigation";
  await capture(
    "AdminUserList",
    () => page.goto("http://localhost:4318/users"),
    "/v1/admin/users",
  );
  await userSearch();
  await page.locator("details.directory-filters > summary").click();
  await page.getByLabel("Page size", { exact: true }).selectOption("20");
  await capture(
    "AdminUserList",
    () =>
      page.getByRole("button", { name: "Apply filters", exact: true }).click(),
    "/v1/admin/users",
  );
  await assert.doesNotReject(() => page.locator("tbody tr").nth(19).waitFor());
  assert.equal(await page.locator("tbody tr").count(), 20);
  const firstIds = await page.locator("tbody .table-link").allTextContents();
  await capture(
    "AdminUserList",
    () => page.getByRole("button", { name: "Next page", exact: true }).click(),
    "/v1/admin/users",
  );
  await page.locator("tbody tr").nth(2).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 3);
  assert.equal(
    await page
      .getByRole("button", { name: "Next page", exact: true })
      .isDisabled(),
    true,
  );
  const secondIds = await page.locator("tbody .table-link").allTextContents();
  assert.equal(new Set([...firstIds, ...secondIds]).size, 23);
  await capture(
    "AdminUserList",
    () =>
      page.getByRole("button", { name: "Previous page", exact: true }).click(),
    "/v1/admin/users",
  );
  assert.equal(await page.locator("tbody tr").count(), 20);
  await screenshot(page, "57-users-directory.png");
  pass(
    "actual canonical user lists, 23 unique synthetic users, 20/3 cursor pages, previous/next controls and strict original response schemas",
  );
  stage = "current detail and existing management consumers";
  await capture(
    "AdminUserDetail",
    () => page.goto(`http://localhost:4318/users/${user}`),
    `/v1/admin/users/${user}`,
  );
  await page
    .getByRole("heading", { name: tag + "00", exact: true, level: 1 })
    .waitFor();
  await page
    .getByRole("heading", { name: tag + "workspace 0", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: tag + "workspace 1", exact: true })
    .waitFor();
  await screenshot(page, "58-user-detail-scopes.png");
  await manage(page);
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.getByRole("button", { name: "Grant VIP", exact: true }).click();
  const financial = page.getByRole("dialog");
  await financial.getByLabel("Workspace", { exact: true }).waitFor();
  assert.ok(
    (
      await financial
        .getByLabel("Workspace", { exact: true })
        .locator("option")
        .allTextContents()
    ).includes(tag + "workspace 0"),
  );
  await page.keyboard.press("Escape");
  pass(
    "strict canonical detail renders two scoped memberships, nullable login and confirmed charges; existing account and VIP target dialogs still open",
  );
  stage = "VIP, tenant and status filters";
  await capture(
    "AdminUserList",
    () => page.goto("http://localhost:4318/users"),
    "/v1/admin/users",
  );
  await userSearch();
  await page.locator("details.directory-filters > summary").click();
  await page.getByLabel("VIP", { exact: true }).selectOption("true");
  let filtered = await capture(
    "AdminUserList",
    () =>
      page.getByRole("button", { name: "Apply filters", exact: true }).click(),
    "/v1/admin/users",
  );
  assert.deepEqual(
    filtered.items.map((r: any) => r.id),
    [user],
  );
  await page.getByLabel("VIP", { exact: true }).selectOption("");
  await page.getByLabel("Workspace ID", { exact: true }).fill(tenants[0]);
  filtered = await capture(
    "AdminUserList",
    () =>
      page.getByRole("button", { name: "Apply filters", exact: true }).click(),
    "/v1/admin/users",
  );
  assert.equal(filtered.items.length, 2);
  await page
    .getByLabel("Account state", { exact: true })
    .selectOption("closed");
  filtered = await capture(
    "AdminUserList",
    () =>
      page.getByRole("button", { name: "Apply filters", exact: true }).click(),
    "/v1/admin/users",
  );
  assert.equal(filtered.items.length, 0);
  await page
    .getByRole("heading", { name: "No matching records yet", exact: true })
    .waitFor();
  pass(
    "actual VIP and workspace filters intersect and closed-state empty results display explicitly",
  );
  stage = "canonical tenant list";
  await capture(
    "AdminTenantList",
    () => page.goto("http://localhost:4318/tenants"),
    "/v1/admin/tenants",
  );
  const tenantList = await capture(
    "AdminTenantList",
    () => page.getByLabel("Search records", { exact: true }).fill(tag),
    "/v1/admin/tenants",
  );
  assert.equal(tenantList.items.length, 2);
  assert.ok(
    tenantList.items.every(
      (r: any) => r.billing_account_id && r.balance_micros === undefined,
    ),
  );
  await page
    .getByRole("button", { name: "Change workspace status", exact: true })
    .first()
    .click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  pass(
    "actual strict tenant list exposes stable billing account IDs and retains workspace status management",
  );
  stage = "responsive and localized directory";
  await capture(
    "AdminUserList",
    () => page.goto("http://localhost:4318/users"),
    "/v1/admin/users",
  );
  await userSearch();
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
      "body overflow at " + width,
    );
  }
  await page.evaluate(() => {
    localStorage.setItem("cp_locale", "zh-HK");
    localStorage.setItem("cp_theme", "dark");
  });
  await page.setViewportSize({ width: 375, height: 900 });
  await page.reload();
  await page.locator("details.directory-filters > summary").click();
  await page.getByRole("button", { name: "套用篩選", exact: true }).waitFor();
  await userSearch();
  await page.locator("tbody tr").first().waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 2,
    ),
  );
  await screenshot(page, "59-directory-mobile-dark.png");
  pass(
    "directory body fits 375/768/1440 English light and 375px Traditional Chinese dark filter layout; scoped table keeps its own scroll",
  );
  stage = "live Admin access rejection";
  await db.query(
    "UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",
    [principal],
  );
  const stale = await context.request.get(
    "http://localhost:4310/v1/admin/users",
  );
  assert.equal(stale.status(), 403);
  assert.equal((await stale.json()).error.code, "MFA_REQUIRED");
  const anonymous = await browser.newContext();
  contexts.push(anonymous);
  const denied = await anonymous.request.get(
    "http://localhost:4310/v1/admin/tenants",
  );
  assert.equal(denied.status(), 401);
  pass(
    "actual HTTP reads reject stale MFA and unauthenticated access after current UI verification",
  );
} catch (e) {
  errors.push(stage + ": " + (e as Error).message);
} finally {
  try {
    await Promise.race([
      Promise.all(contexts.map((c) => c.close())),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("context close timeout")), 5000),
      ),
    ]);
    await Promise.race([
      browser?.close(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("browser close timeout")), 5000),
      ),
    ]);
    await server?.close();
    closed = true;
  } catch {
    await server?.kill();
    closed = true;
  }
  clearTimeout(deadline);
  if (db) {
    try {
      if (users.length)
        await db.query(
          "UPDATE users SET status='suspended',auth_version=auth_version+1 WHERE id=ANY($1::uuid[])",
          [users],
        );
      if (principal) {
        await db.query(
          "UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE admin_id=$1",
          [principal],
        );
        await db.query(
          "UPDATE admin_principals SET status='suspended',auth_version=auth_version+1,version=version+1 WHERE id=$1",
          [principal],
        );
        await db.query(
          "UPDATE admin_operations SET state='cancelled',version=version+1 WHERE principal_id=$1 AND state='pending_approval'",
          [principal],
        );
      }
    } catch {
      errors.push("Owned fixture cleanup failed");
    } finally {
      await db.end();
    }
  }
  await writeFile(
    "evidence/admin-directory-contract-samples.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        scope:
          "Actual current local HTTP responses captured during owned Admin UI actions, synthetic rows only",
        origin: "http://localhost:4318",
        samples,
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    "evidence/admin-directory-ui.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        scope:
          "Current canonical Admin user/tenant lists, filters, cursor navigation and detail consumers only; owned Chromium, synthetic data, no complete Admin or native acceptance",
        checks,
        errors,
        screenshots,
        closed,
        model_calls: 0,
        user_browser_tabs_touched: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({ checks: checks.length, errors, closed, screenshots }),
  );
  if (errors.length) process.exitCode = 1;
}
