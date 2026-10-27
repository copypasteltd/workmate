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
async function call(page: Page, url: string, tenant?: string) {
  return page.evaluate(
    async ({ url, tenant }) => {
      const r = await fetch(url, {
        headers: tenant ? { "X-Tenant-ID": tenant } : {},
      });
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.json();
    },
    { url, tenant },
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
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:4317/login");
  await page
    .getByLabel("Work email")
    .fill(`input-ui-${randomUUID()}@example.invalid`);
  const code = await emailCode(page, () =>
    page.getByRole("button", { name: "Send sign-in code" }).click(),
  );
  await page.locator('input[name="code"]').fill(code);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/welcome");
  await page.locator('input[name="name"]').fill("Harbour source studio");
  await page
    .locator('input[name="project_name"]')
    .fill("Approved launch materials");
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
  const project = (await call(page, `/v1/tenants/${tenant}/projects`)).items[0]
    .id;
  const base = `/v1/tenants/${tenant}/projects/${project}`;
  await page
    .getByRole("button", { name: "Create campaign visuals", exact: false })
    .click();
  const form = page.getByRole("dialog");
  await form
    .getByLabel("Task name", { exact: true })
    .fill("Launch plan with approved source");
  await form
    .getByLabel("What would you like to make?", { exact: true })
    .fill(
      "Write a campaign plan with explicitly simulated product facts. Deliver an editable Markdown file after I select the approved source.",
    );
  await form
    .getByLabel("Inputs needed before starting?", { exact: true })
    .selectOption("file");
  await form.getByLabel("Task budget limit (HKD)", { exact: true }).fill("1");
  await form.getByRole("button", { name: "Start task", exact: true }).click();
  await page.waitForURL("**/app/conversations/*");
  const card = page.getByRole("region", {
    name: "Provide task inputs",
    exact: true,
  });
  await card
    .getByRole("heading", { name: "Ready the inputs, then begin", exact: true })
    .waitFor();
  const task = (await call(page, base + "/tasks")).items[0];
  const originalId = task.id;
  assert.equal(task.status, "needs_input");
  const before = await call(page, base + "/tasks/" + originalId);
  assert.equal(before.attempt, 0);
  assert.equal(Number(before.input_tokens), 0);
  assert.equal(Number(before.charged_micros), 0);
  assert.equal(
    Number(
      (await call(page, `/v1/tenants/${tenant}/billing`)).wallet
        .reserved_micros,
    ),
    1000000,
  );
  const requests = await call(
    page,
    `/v1/tasks/${originalId}/dependencies`,
    tenant,
  );
  samples.push({ schema: "DependencyRequestList", response: requests });
  assert.equal(requests.items.length, 1);
  assert.equal(requests.items[0].state, "pending");
  await card.getByText("No matching inputs.", { exact: false }).waitFor();
  assert.equal(
    await card
      .getByRole("button", { name: "Confirm this input", exact: true })
      .isDisabled(),
    true,
  );
  await shot(page, "32-task-input-wait");
  checks.push({
    name: "a fresh user submits an explicit file prerequisite, stays in the same private conversation, holds exactly HKD 1 and calls no model while the input is missing",
    status: "passed",
  });

  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `input wait overflow at ${width}`,
    );
  }
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await shot(page, "33-task-input-dark");
  await page.getByTitle("切換至繁體中文").click();
  await page
    .getByRole("heading", { name: "準備好資料，再開始", exact: true })
    .waitFor();
  await page.setViewportSize({ width: 375, height: 960 });
  await shot(page, "34-task-input-mobile");
  await page.getByTitle("Switch to English").click();
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.setViewportSize({ width: 1440, height: 1080 });
  checks.push({
    name: "the waiting conversation and its input form fit 375/768/1024/1440 widths, both themes and Traditional Chinese/English",
    status: "passed",
  });

  await page.route("**/task-dependencies/*/resources?*", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "FORBIDDEN",
          message: "This input is no longer authorized",
        },
      }),
    }),
  );
  await card
    .getByRole("button", { name: "Refresh input requests", exact: true })
    .click();
  await card
    .getByRole("alert")
    .filter({ hasText: "no longer authorized" })
    .waitFor();
  assert.equal(
    await card
      .getByRole("button", { name: "Confirm this input", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await card
      .getByLabel("Choose a current file version", { exact: true })
      .isDisabled(),
    true,
  );
  await page.unroute("**/task-dependencies/*/resources?*");
  await card
    .getByRole("button", { name: "Refresh input requests", exact: true })
    .click();
  await card.getByText("No matching inputs.", { exact: false }).waitFor();
  checks.push({
    name: "an injected resource authorization error clears candidates and disables confirmation; refreshing restores the current scoped list",
    status: "passed",
  });

  await card
    .getByRole("button", { name: "Upload required file", exact: true })
    .click();
  const upload = page.getByRole("dialog");
  await upload.locator('input[type="file"]').setInputFiles({
    name: "approved-source.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Clearly simulated product source for this private conversation. No real customer data.",
    ),
  });
  await upload
    .getByRole("button", { name: "Upload or resume", exact: true })
    .click();
  await upload.waitFor({ state: "hidden" });
  const picker = card.getByLabel("Choose a current file version", {
    exact: true,
  });
  await picker
    .locator("option")
    .filter({ hasText: "approved-source.txt" })
    .waitFor({ state: "attached" });
  assert.equal(
    await picker.inputValue(),
    "",
    "upload must not select an input without confirmation",
  );
  await card
    .getByLabel("Search available inputs", { exact: true })
    .fill("approved-source");
  await card.getByRole("button", { name: "Search", exact: true }).click();
  const option = picker
    .locator("option")
    .filter({ hasText: "approved-source.txt" });
  await option.waitFor({ state: "attached" });
  const version = await option.getAttribute("value");
  assert.ok(version);
  const source = (await call(page, base + "/assets")).items.find(
    (a: any) => a.name === "approved-source.txt",
  );
  assert.equal(source.private_owner, me.user.id);
  const candidates = await call(
    page,
    `/v1/tenants/${tenant}/task-dependencies/${requests.items[0].id}/resources?q=approved-source`,
  );
  samples.push({ schema: "DependencyResourceList", response: candidates });
  assert.equal(candidates.items[0].id, version);
  assert.equal(candidates.items[0].version, 1);
  await picker.selectOption(version!);
  await card
    .getByRole("button", { name: "Confirm this input", exact: true })
    .click();
  await card.waitFor({ state: "hidden" });
  const deadline = Date.now() + 60000;
  let final: any;
  while (Date.now() < deadline) {
    final = await call(page, base + "/tasks/" + originalId);
    if (
      ["succeeded", "failed", "cancelled", "reconciling"].includes(final.status)
    )
      break;
    await new Promise((r) => setTimeout(r, 300));
  }
  assert.equal(
    final.status,
    "succeeded",
    JSON.stringify({ status: final.status, error: final.error_code }),
  );
  assert.equal(final.id, originalId);
  assert.equal(final.attempt, 1);
  assert.equal((await call(page, base + "/tasks")).items.length, 1);
  assert.equal((await call(page, base + "/conversations")).items.length, 1);
  assert.equal(
    Number(
      (await call(page, `/v1/tenants/${tenant}/billing`)).wallet
        .reserved_micros,
    ),
    0,
  );
  const resolved = await call(
    page,
    `/v1/tasks/${originalId}/dependencies`,
    tenant,
  );
  samples.push({ schema: "DependencyRequestList", response: resolved });
  assert.equal(resolved.items[0].state, "resolved");
  assert.equal(resolved.items[0].version, 2);
  const output = (await call(page, base + "/assets")).items.find(
    (a: any) => a.name === "demo-report.md",
  );
  assert.ok(output);
  assert.equal(output.private_owner, me.user.id);
  const body = await page.evaluate(
    async (url) => (await fetch(url)).text(),
    base + "/assets/" + output.id + "/download",
  );
  assert.match(body, /Simulated deliverable/);
  await page
    .locator(".message-assistant")
    .filter({ hasText: "Simulated data" })
    .waitFor();
  await shot(page, "35-task-input-result");
  checks.push({
    name: "a real private multipart upload and explicit current-version selection resume the original task once; real Codex with a synthetic model produces an actual private file and settles the original hold",
    status: "passed",
  });
  const notifications = await call(page, `/v1/tenants/${tenant}/notifications`);
  const related = notifications.items.filter(
    (n: any) => n.task_id === originalId,
  );
  assert.ok(related.some((n: any) => n.kind === "needs_input"));
  assert.ok(related.some((n: any) => n.kind === "succeeded"));
  assert.ok(
    related.every((n: any) => n.conversation_id === final.conversation_id),
  );
  checks.push({
    name: "input-wait and completion notifications retain the exact same task and private conversation",
    status: "passed",
  });
  assert.deepEqual(errors, []);
} catch (e: any) {
  checks.push({
    name: "task input browser regression",
    status: "failed",
    detail: e.message,
  });
  throw e;
} finally {
  if (context) await context.close();
  if (browser) {
    await browser.close();
    closed = true;
  }
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/task-dependencies.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        dependency_mode: "simulated",
        real_codex: true,
        checkpoint: "explicit prerequisites before first model turn only",
        checks,
        errors,
        browser_closed: closed,
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    "evidence/task-dependencies-contract-samples.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        origin:
          "actual local HTTP responses under an authenticated browser session",
        samples,
      },
      null,
      2,
    ) + "\n",
  );
}
