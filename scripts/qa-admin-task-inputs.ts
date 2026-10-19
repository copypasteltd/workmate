import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
import { emailCode, verifyAdmin } from "./qa-auth.js";
let browser: Browser | undefined,
  closed = false;
const contexts: BrowserContext[] = [],
  checks: any[] = [],
  errors: string[] = [];
async function call(page: Page, url: string, method = "GET", body?: unknown) {
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
        throw new Error(
          `${method} ${url}: ${r.status} ${JSON.stringify(data)}`,
        );
      return data;
    },
    { url, method, body },
  );
}
async function shot(page: Page, name: string) {
  const dir = path.resolve("../copypaste-admin/assets/screenshots");
  await mkdir(dir, { recursive: true });
  await page.screenshot({
    path: path.join(dir, name + ".png"),
    fullPage: false,
    animations: "disabled",
  });
}
try {
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
  user.on("pageerror", (e) => errors.push(e.message));
  await user.goto("http://localhost:4317/login");
  await user
    .getByLabel("Work email")
    .fill(`admin-input-${randomUUID()}@example.invalid`);
  const code = await emailCode(user, () =>
    user.getByRole("button", { name: "Send sign-in code" }).click(),
  );
  await user.locator('input[name="code"]').fill(code);
  await user.locator('form button[type="submit"]').click();
  await user.waitForURL("**/welcome");
  await user.locator('input[name="name"]').fill("Harbour oversight studio");
  await user
    .locator('input[name="project_name"]')
    .fill("Approved campaign sources");
  await user.locator('form button[type="submit"]').click();
  await user.waitForURL("**/app");
  const me = await call(user, "/v1/me"),
    tenant = me.memberships[0].id,
    project = (await call(user, `/v1/tenants/${tenant}/projects`)).items[0].id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  await call(user, `/v1/tenants/${tenant}/demo-credit`, "POST", {});
  const title = "Source review " + randomUUID().slice(0, 8);
  const waiting = await call(user, base + "/delegations", "POST", {
    title,
    prompt:
      "Prepare a clearly simulated written campaign after I provide approved materials.",
    mode: "execute",
    budget_micros: 1000000,
    client_message_id: randomUUID(),
    dependencies: [
      {
        kind: "file",
        description: "Approved artwork source required before model execution.",
      },
    ],
  });
  assert.equal(waiting.task.status, "needs_input");
  assert.equal(waiting.task.attempt, 0);
  checks.push({
    name: "a real private task waits with a reserved budget and no model call before administrative review",
    status: "passed",
  });

  const operator = JSON.parse(
    await readFile(
      path.resolve("../copypaste-platform/.data/qa/operator.json"),
      "utf8",
    ),
  );
  const adminContext = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  contexts.push(adminContext);
  adminContext.setDefaultTimeout(20000);
  await adminContext.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const admin = await adminContext.newPage();
  admin.on("pageerror", (e) => errors.push(e.message));
  await admin.goto("http://localhost:4318");
  await admin.getByLabel("Administrator email").fill(operator.email);
  const otp = await emailCode(
    admin,
    () =>
      admin
        .getByRole("button", { name: "Send admin sign-in code", exact: true })
        .click(),
    true,
  );
  await admin.locator('input[name="code"]').fill(otp);
  await verifyAdmin(admin, operator.totp_secret);
  await admin.goto("http://localhost:4318/content");
  await admin.getByLabel("Search records", { exact: true }).fill(title);
  let row = admin
    .getByRole("row")
    .filter({ hasText: title })
    .filter({ has: admin.getByRole("cell", { name: "tasks", exact: true }) });
  await row.getByTitle("Read content", { exact: true }).click();
  const content = admin.locator(".content-body");
  await content
    .filter({
      hasText: "Approved artwork source required before model execution.",
    })
    .waitFor();
  const reviewed = JSON.parse(await content.innerText());
  assert.equal(reviewed.dependencies[0].state, "pending");
  assert.deepEqual(reviewed.dependencies[0].resource_ids, []);
  await shot(admin, "20-task-input-review");
  await admin.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await shot(admin, "21-task-input-review-dark");
  checks.push({
    name: "an independently authenticated administrator with body-read permission sees input descriptions, state and selected IDs in the original task body",
    status: "passed",
  });

  await admin.goto("http://localhost:4318/execution");
  await admin.getByLabel("Search records", { exact: true }).fill(title);
  row = admin.getByRole("row").filter({ hasText: title });
  await row.getByTitle("Manage task", { exact: true }).click();
  const modal = admin.getByRole("dialog");
  await modal.locator('select[name="action"]').selectOption("cancel");
  await modal
    .locator('textarea[name="reason"]')
    .fill("Cancel the unstarted fixture after reviewing its requested source.");
  await modal
    .getByRole("button", { name: "Confirm action", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  const final = await call(user, base + "/tasks/" + waiting.task.id);
  assert.equal(final.status, "cancelled");
  assert.equal(final.attempt, 0);
  assert.equal(Number(final.charged_micros), 0);
  const deps = await call(
    user,
    base + "/tasks/" + waiting.task.id + "/dependencies",
  );
  assert.equal(deps.items[0].state, "dismissed");
  assert.equal(
    Number(
      (await call(user, `/v1/tenants/${tenant}/billing`)).wallet
        .reserved_micros,
    ),
    0,
  );
  checks.push({
    name: "the Admin execution action cancels the same unstarted private task, dismisses its input request and releases the original hold without a charge",
    status: "passed",
  });
  assert.deepEqual(errors, []);
} catch (e: any) {
  checks.push({
    name: "Admin task input journey",
    status: "failed",
    detail: e.message,
  });
  throw e;
} finally {
  for (const c of contexts) await c.close();
  if (browser) {
    await browser.close();
    closed = true;
  }
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/admin-task-inputs.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        dependency_mode: "simulated",
        checks,
        errors,
        browser_closed: closed,
      },
      null,
      2,
    ) + "\n",
  );
}
