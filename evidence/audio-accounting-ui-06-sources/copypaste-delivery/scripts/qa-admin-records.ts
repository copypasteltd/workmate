import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { emailCode, verifyAdmin } from "./qa-auth.js";

const platform = path.resolve("../copypaste-platform"),
  run = randomUUID(),
  requirePlatform = createRequire(path.join(platform, "package.json")),
  pg = requirePlatform("pg"),
  OTPAuth = requirePlatform("otpauth");
const checks: any[] = [],
  samples: any[] = [],
  errors: string[] = [],
  contexts: BrowserContext[] = [],
  ids: string[] = [];
let browser: Browser | undefined,
  db: any,
  principal: string | undefined,
  closed = false;
function passed(name: string) {
  checks.push({ name, status: "passed" });
}
async function request(
  page: Page,
  url: string,
  method = "GET",
  body?: unknown,
  admin = false,
) {
  return page.evaluate(
    async ({ url, method, body, admin }) => {
      const me = await (
        await fetch(admin ? "/v1/admin/me" : "/v1/session/context")
      ).json();
      const response = await fetch(url, {
        method,
        headers: {
          "X-CSRF-Token": me.csrf_token ?? "",
          "Idempotency-Key": crypto.randomUUID(),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    },
    { url, method, body, admin },
  );
}
async function call(page: Page, url: string, method = "GET", body?: unknown) {
  const result = await request(page, url, method, body);
  assert.ok(
    result.status >= 200 && result.status < 300,
    `${method} ${url}: ${result.status}`,
  );
  return result.body;
}
async function waitFor(
  page: Page,
  probe: () => Promise<boolean>,
  message: string,
) {
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    if (await probe()) return;
    await page.waitForTimeout(100);
  }
  throw new Error(message);
}
async function shot(page: Page, name: string) {
  const folder = path.resolve("../copypaste-admin/assets/screenshots");
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
  db = new pg.Client({ connectionString: url.href });
  await db.connect();
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
  });
  const client = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  contexts.push(client);
  await client.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const user = await client.newPage();
  await user.goto("http://localhost:4317/login");
  await user
    .getByLabel("Work email")
    .fill(`cleanup-user-${run}@example.invalid`);
  const code = await emailCode(user, () =>
    user
      .getByRole("button", { name: "Send sign-in code", exact: true })
      .click(),
  );
  await user.locator('input[name="code"]').fill(code);
  await user.locator('form button[type="submit"]').click();
  await user.waitForURL("**/welcome");
  await user.locator('input[name="name"]').fill("Synthetic cleanup review");
  await user.locator('input[name="project_name"]').fill("Visible review scope");
  await user.locator('form button[type="submit"]').click();
  await user.waitForURL("**/app");
  const me = await call(user, "/v1/session/context"),
    tenant = me.memberships[0].id,
    project = (await call(user, `/v1/tenants/${tenant}/projects`)).items[0].id,
    deniedProject = await call(user, `/v1/tenants/${tenant}/projects`, "POST", {
      name: "Explicitly denied scope",
    }),
    outsider = await call(user, "/v1/tenants", "POST", {
      name: "Excluded synthetic enterprise",
      project_name: "Outside reviewer access",
    });
  const { seal } = await import(
      pathToFileURL(path.join(platform, "dist/src/lib.js")).href
    ),
    secret = new OTPAuth.Secret({ size: 20 }).base32,
    address = `cleanup-reviewer-${run}@example.invalid`,
    role = "qa_cleanup_" + run.replaceAll("-", "");
  principal = (
    await db.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Cleanup metadata reviewer',$2) RETURNING id",
      [address, seal(env.MASTER_KEY, secret)],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Synthetic cleanup metadata reviewer',$2)",
    [role, JSON.stringify(["admin.overview.read", "admin.content.read"])],
  );
  await db.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,'tenant',$3,'allow'),($1,$2,'project',$4,'deny')",
    [principal, role, tenant, deniedProject.id],
  );
  // Explicit journal-only fixtures: no real objects or deletion side effects.
  // Future due dates prevent the live cleanup worker from consuming them.
  const visible: { id: string; target: string; state: string; type: string }[] =
    [];
  for (let i = 0; i < 64; i++) {
    const id = randomUUID(),
      target = randomUUID(),
      state = i % 3 ? "completed" : "failed",
      type = i % 2 ? "workspace_nodes" : "assets";
    const tenantId = i >= 60 ? outsider.tenant.id : tenant,
      projectId =
        i >= 60 ? outsider.project.id : i >= 58 ? deniedProject.id : project;
    await db.query(
      "INSERT INTO deletion_jobs(id,tenant_id,project_id,target_type,target_id,state,next_attempt_at,created_at) VALUES($1,$2,$3,$4,$5,$6,'2100-01-01','2026-10-01')",
      [id, tenantId, projectId, type, target, state],
    );
    ids.push(id);
    if (i < 58) visible.push({ id, target, state, type });
  }
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  contexts.push(context);
  context.setDefaultTimeout(20000);
  await context.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://localhost:4318");
  await page.getByLabel("Administrator email").fill(address);
  const otp = await emailCode(
    page,
    () =>
      page
        .getByRole("button", { name: "Send admin sign-in code", exact: true })
        .click(),
    true,
  );
  await page.locator('input[name="code"]').fill(otp);
  await verifyAdmin(page, secret);
  await page.waitForURL("**/overview");
  await page.goto("http://localhost:4318/content");
  const panel = page.getByRole("region", {
      name: "Permanent deletion and cleanup",
      exact: true,
    }),
    rows = panel.locator("tbody tr");
  await waitFor(
    page,
    async () => (await rows.count()) === 50,
    "Default page did not show 50 visible records",
  );
  assert.match(await panel.innerText(), /Visible after filtering: 58/);
  assert.equal(
    await panel
      .getByRole("button", { name: "Retry cleanup", exact: true })
      .count(),
    0,
  );
  const first = await rows.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-cleanup-id")),
  );
  await panel
    .getByRole("button", { name: "Next cleanup page", exact: true })
    .click();
  await waitFor(
    page,
    async () => (await rows.count()) === 8,
    "Second page did not show remaining eight records",
  );
  const second = await rows.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-cleanup-id")),
  );
  assert.deepEqual(
    [...first, ...second],
    visible
      .map((row) => row.id)
      .sort()
      .reverse(),
  );
  await panel
    .getByLabel("Cleanup records per page", { exact: true })
    .selectOption("25");
  await waitFor(
    page,
    async () => (await rows.count()) === 25,
    "Page size did not reset the page",
  );
  assert.ok(!new URL(page.url()).searchParams.has("cleanup_page"));
  const deniedRetry = await request(
    page,
    `/v1/admin/deletions/${visible.find((row) => row.state === "failed")!.id}/retry`,
    "POST",
    { reason: "Read-only fixture must be denied" },
    true,
  );
  assert.equal(deniedRetry.status, 403);
  const sample = await request(
    page,
    "/v1/admin/deletions?page_size=1",
    "GET",
    undefined,
    true,
  );
  assert.equal(sample.status, 200);
  samples.push({ schema: "AdminCleanupPage", response: sample.body });
  passed(
    "separate email/MFA login, SQL-scoped 58-record total, default 50, disjoint tied-timestamp pages, explicit page size and read-only retry denial",
  );

  await panel
    .getByLabel("Cleanup state", { exact: true })
    .selectOption("failed");
  await panel
    .getByLabel("Content type", { exact: true })
    .selectOption("assets");
  const filtered = visible.filter(
    (row) => row.state === "failed" && row.type === "assets",
  );
  await waitFor(
    page,
    async () => (await rows.count()) === filtered.length,
    "Combined filters did not constrain the page",
  );
  await page.reload();
  await rows.first().waitFor();
  assert.equal(
    await panel.getByLabel("Cleanup state", { exact: true }).inputValue(),
    "failed",
  );
  assert.equal(
    await panel.getByLabel("Content type", { exact: true }).inputValue(),
    "assets",
  );
  await panel
    .getByLabel("Search cleanup IDs", { exact: true })
    .fill(filtered[0].target.toUpperCase());
  await waitFor(
    page,
    async () => (await rows.count()) === 1,
    "Target ID search failed",
  );
  await panel.getByLabel("Search cleanup IDs", { exact: true }).fill("");
  await waitFor(
    page,
    async () => (await rows.count()) === filtered.length,
    "Cleared search did not restore scoped results",
  );
  await panel.getByLabel("Cleanup state", { exact: true }).selectOption("");
  await panel.getByLabel("Content type", { exact: true }).selectOption("");
  await panel
    .getByLabel("Cleanup records per page", { exact: true })
    .selectOption("50");
  await waitFor(
    page,
    async () => (await rows.count()) === 50,
    "List did not return to the default page",
  );
  passed(
    "state/type/ID filters apply to visible totals, URL survives reload and changing a filter resets paging",
  );

  const scroll = panel.getByRole("region", {
    name: "Scrollable cleanup records",
    exact: true,
  });
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1080 });
    await page.waitForTimeout(100);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `Page overflow at ${width}`,
    );
    assert.ok((await scroll.boundingBox())!.height <= 420);
  }
  await scroll.focus();
  assert.ok(await scroll.evaluate((node) => node === document.activeElement));
  await shot(page, "26-cleanup-mobile");
  await page.setViewportSize({ width: 1440, height: 1080 });
  await shot(page, "24-cleanup-pagination");
  await page
    .getByTitle("Theme: light / dark / system", { exact: true })
    .click();
  await page.getByTitle("切換至繁體中文", { exact: true }).click();
  await shot(page, "25-cleanup-pagination-dark");
  await page.getByTitle("Switch to English", { exact: true }).click();
  passed(
    "50-row journal has bounded keyboard-focusable scrolling, four viewport widths, two themes and Traditional Chinese/English labels",
  );

  const pattern = "**/v1/admin/deletions?**";
  let inFlight = 0,
    intercepted = false;
  await page.route(pattern, async (route) => {
    inFlight++;
    intercepted = true;
    await page.waitForTimeout(6200);
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "FORBIDDEN",
          message: "Synthetic permission recheck failed",
        },
      }),
    });
  });
  await panel
    .getByRole("button", { name: "Refresh cleanup records", exact: true })
    .click();
  await waitFor(
    page,
    async () => intercepted,
    "Permission probe did not start",
  );
  await page.waitForTimeout(5300);
  assert.equal(inFlight, 1, "Slow poll overlapped a second permission check");
  await panel.getByRole("alert").waitFor();
  assert.equal(await rows.count(), 0);
  await page.unroute(pattern);
  await panel
    .getByRole("button", { name: "Refresh cleanup records", exact: true })
    .click();
  await waitFor(
    page,
    async () => (await rows.count()) === 50,
    "Scoped list did not recover after a valid refresh",
  );
  passed(
    "a delayed permission denial never overlaps another poll, clears old records and can recover through a successful current check",
  );

  // A separately tested privileged UI state must also lose an already-open
  // retry dialog when the current collection no longer authorizes its row.
  await db.query(
    "UPDATE admin_roles SET permissions=$2,version=version+1 WHERE key=$1",
    [
      role,
      JSON.stringify([
        "admin.overview.read",
        "admin.content.read",
        "admin.content.delete",
      ]),
    ],
  );
  await page.reload();
  await panel
    .getByRole("button", { name: "Retry cleanup", exact: true })
    .first()
    .click();
  const retryDialog = page.getByRole("dialog", {
    name: "Retry permanent cleanup",
    exact: true,
  });
  await retryDialog.waitFor();
  await db.query(
    "UPDATE admin_bindings SET expires_at=now()-interval '1 second' WHERE principal_id=$1 AND effect='allow'",
    [principal],
  );
  await panel
    .getByText("No matching cleanup records.", { exact: true })
    .waitFor();
  await retryDialog.waitFor({ state: "hidden" });
  assert.equal(await rows.count(), 0);
  const revoked = await request(
    page,
    "/v1/admin/deletions",
    "GET",
    undefined,
    true,
  );
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.total, 0);
  samples.push({ schema: "AdminCleanupPage", response: revoked.body });
  assert.deepEqual(errors, []);
  passed(
    "actual grant expiry hides records, totals and an open retry dialog in the still-open authenticated Admin session without submitting a cleanup command",
  );
} catch (error: any) {
  checks.push({
    name: "Admin record management journey",
    status: "failed",
    detail: error.message,
  });
  throw error;
} finally {
  try {
    if (db && principal) {
      await db.query(
        "UPDATE admin_principals SET status='suspended',auth_version=auth_version+1 WHERE id=$1",
        [principal],
      );
      await db.query(
        "UPDATE sessions SET revoked_at=now() WHERE admin_id=$1 AND revoked_at IS NULL",
        [principal],
      );
    }
    if (db) await db.end();
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    if (browser) {
      await browser.close();
      closed = true;
    }
    await mkdir("evidence", { recursive: true });
    if (samples.length)
      await writeFile(
        "evidence/admin-records-contract-samples.json",
        JSON.stringify(
          {
            at: new Date().toISOString(),
            origin:
              "actual local HTTP responses under a separately MFA-authenticated Admin session before and after grant expiry",
            samples,
          },
          null,
          2,
        ) + "\n",
      );
    await writeFile(
      "evidence/admin-records.json",
      JSON.stringify(
        {
          at: new Date().toISOString(),
          dependency_mode: "simulated",
          fixture_scope:
            "journal-only synthetic rows in fresh local enterprises; no real objects erased",
          checks,
          errors,
          browser_closed: closed,
        },
        null,
        2,
      ) + "\n",
    );
  }
}
