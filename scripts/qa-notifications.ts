import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import path from "node:path";
import { emailCode } from "./qa-auth.js";

const checks: any[] = [],
  errors: string[] = [],
  samples: any[] = [];
let browser: Browser | undefined,
  context: BrowserContext | undefined,
  closed = false;
async function call(
  page: Page,
  url: string,
  method = "GET",
  body?: unknown,
  tenant?: string,
) {
  return page.evaluate(
    async ({ url, method, body, tenant }) => {
      const me = await (await fetch("/v1/session/context")).json();
      const response = await fetch(url, {
        method,
        headers: {
          "X-CSRF-Token": me.csrf_token,
          "Idempotency-Key": crypto.randomUUID(),
          ...(tenant ? { "X-Tenant-ID": tenant } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          `${method} ${url}: ${response.status} ${JSON.stringify(data)}`,
        );
      return data;
    },
    { url, method, body, tenant },
  );
}
async function shot(page: Page, name: string) {
  const folder = path.resolve("../copypaste-web/assets/screenshots");
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: path.join(folder, name + ".png"),
    fullPage: true,
    animations: "disabled",
  });
}
try {
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
  await page.clock.install();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://localhost:4317/login");
  await page
    .getByLabel("Work email")
    .fill(`notifications-ui-${randomUUID()}@example.invalid`);
  const code = await emailCode(page, () =>
    page.getByRole("button", { name: "Send sign-in code" }).click(),
  );
  await page.locator('input[name="code"]').fill(code);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/welcome");
  await page.locator('input[name="name"]').fill("Harbour notification studio");
  await page.locator('input[name="project_name"]').fill("Main studio");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/app");
  await page
    .getByRole("button", { name: "Add one-time demo credit", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Demo credit added", exact: true })
    .waitFor();
  const me = await call(page, "/v1/session/context"),
    tenant = me.memberships[0].id;
  const first = (await call(page, `/v1/tenants/${tenant}/projects`)).items[0];
  const second = await call(page, `/v1/tenants/${tenant}/projects`, "POST", {
    name: "Campaign launch",
  });
  const base = `/v1/tenants/${tenant}/projects/${second.id}`;
  const agent = await call(page, base + "/agents", "POST", {
    name: "Campaign developer",
    role_key: "fullstack",
  });
  const conversation = await call(page, base + "/conversations", "POST", {
    name: "Launch files",
    agent_id: agent.id,
  });
  const sent = await call(
    page,
    `${base}/conversations/${conversation.id}/messages`,
    "POST",
    {
      client_message_id: randomUUID(),
      expected_version: conversation.version,
      intent: "delegate",
      mode: "execute",
      budget_micros: 1000000,
      body: "Create a small sample website with explicitly simulated campaign content and deliver the source ZIP.",
    },
  );
  let task: any;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    task = await call(page, base + "/tasks/" + sent.task.id);
    if (
      ["succeeded", "failed", "cancelled", "reconciling"].includes(task.status)
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert.equal(
    task?.status,
    "succeeded",
    JSON.stringify({ status: task?.status, error: task?.error_code }),
  );
  const inbox = await call(
    page,
    "/v1/notifications?unread=true",
    "GET",
    undefined,
    tenant,
  );
  samples.push({ schema: "NotificationList", response: inbox });
  assert.deepEqual(inbox.items.map((n: any) => n.kind).sort(), [
    "running",
    "succeeded",
  ]);
  assert.ok(
    inbox.items.every(
      (n: any) =>
        n.project_id === second.id &&
        n.conversation_id === conversation.id &&
        n.task_id === task.id,
    ),
  );
  checks.push({
    name: "a real Codex task using explicitly simulated model dependencies produces one running and one successful notification with its exact private conversation and task",
    status: "passed",
  });
  await page.reload();
  await page
    .getByLabel("Current project", { exact: true })
    .selectOption(first.id);
  await page.getByRole("link", { name: /Work notifications/ }).click();
  await page
    .getByRole("heading", { name: "Work notifications", exact: true })
    .waitFor();
  await page.locator(".notification-card").first().waitFor();
  assert.equal(await page.locator(".notification-card").count(), 2);
  await page.getByRole("button", { name: "Unread", exact: true }).click();
  const notification = inbox.items.find((n: any) => n.kind === "succeeded");
  const row = page.locator(`[data-notification="${notification.id}"]`);
  await row.getByRole("button", { name: "Mark read", exact: true }).click();
  await row.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "All", exact: true }).click();
  await row.getByRole("button", { name: "Mark unread", exact: true }).waitFor();
  const read = await call(
    page,
    `/v1/notifications/${notification.id}`,
    "PATCH",
    { read: true },
    tenant,
  );
  samples.push({ schema: "Notification", response: read });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await shot(page, "27-work-notifications");
  await row.getByRole("button", { name: "Open task", exact: true }).click();
  await page.waitForURL(`**/app/tasks/${task.id}`);
  assert.equal(
    await page.getByLabel("Current project", { exact: true }).inputValue(),
    second.id,
  );
  await page
    .getByRole("heading", { name: "Task details", exact: true })
    .waitFor();
  checks.push({
    name: "the inbox marks read/unread and opens the task after switching to its project, including when the user was browsing a different project",
    status: "passed",
  });
  await page.getByRole("link", { name: /Work notifications/ }).click();
  await page.locator(".notification-card").first().waitFor();
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `notification overflow at ${width}`,
    );
  }
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await shot(page, "28-work-notifications-dark");
  await page.getByTitle("切換至繁體中文").click();
  await page.getByRole("heading", { name: "工作通知", exact: true }).waitFor();
  checks.push({
    name: "the inbox supports four viewport widths, both themes, Traditional Chinese and English",
    status: "passed",
  });
  // This failure is explicitly injected at the HTTP boundary to verify safe stale-data handling.
  await page.route("**/notifications?**", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "FORBIDDEN",
          message: "Injected permission refresh failure",
        },
      }),
    }),
  );
  const rejected = page.waitForResponse(
    (r) => r.url().includes("/notifications?") && r.status() === 403,
  );
  await page.clock.fastForward(16000);
  await rejected;
  await page
    .getByRole("alert")
    .filter({ hasText: "Injected permission refresh failure" })
    .waitFor();
  assert.equal(await page.locator(".notification-card").count(), 0);
  assert.equal(await page.locator(".notification-dot").count(), 0);
  await page.unroute("**/notifications?**");
  checks.push({
    name: "an injected authorization refresh error hides stale inbox entries and the unread indicator",
    status: "passed",
  });
  assert.deepEqual(errors, []);
} catch (error: any) {
  checks.push({
    name: "notification browser regression",
    status: "failed",
    detail: error.message,
  });
  throw error;
} finally {
  if (context) await context.close();
  if (browser) {
    await browser.close();
    closed = true;
  }
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/notifications.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        dependency_mode: "simulated",
        real_codex: true,
        checks,
        errors,
        browser_closed: closed,
      },
      null,
      2,
    ),
  );
  await writeFile(
    "evidence/notifications-contract-samples.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        origin:
          "actual authenticated local browser HTTP responses with synthetic model dependencies",
        samples,
      },
      null,
      2,
    ),
  );
}
