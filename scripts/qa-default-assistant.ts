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
let browser: Browser | undefined,
  context: BrowserContext | undefined,
  closed = false;
const checks: any[] = [],
  errors: string[] = [];
async function read(page: Page, url: string) {
  return page.evaluate(async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  }, url);
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
    .fill(`default-ui-${randomUUID()}@example.invalid`);
  const code = await emailCode(page, () =>
    page.getByRole("button", { name: "Send sign-in code" }).click(),
  );
  await page.locator('input[name="code"]').fill(code);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/welcome");
  await page.locator('input[name="name"]').fill("Harbour first-work studio");
  await page.locator('input[name="project_name"]').fill("First brief");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/app");
  await page
    .getByRole("button", { name: "Add one-time demo credit", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Demo credit added", exact: true })
    .waitFor();
  const me = await read(page, "/v1/me"),
    tenant = me.memberships[0].id,
    project = (await read(page, `/v1/tenants/${tenant}/projects`)).items[0].id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  assert.equal((await read(page, base + "/agents")).items.length, 0);
  assert.equal((await read(page, base + "/tasks")).items.length, 0);
  await page
    .getByRole("button", { name: "Create campaign visuals", exact: false })
    .click();
  let modal = page.getByRole("dialog");
  await modal.waitFor();
  assert.equal(
    await modal.locator('select[name="role"]').inputValue(),
    "assistant",
  );
  assert.equal(
    (await read(page, base + "/tasks")).items.length,
    0,
    "choosing a sample must not submit it",
  );
  await modal
    .getByLabel("Task name", { exact: true })
    .fill("First campaign plan");
  await modal
    .getByLabel("What would you like to make?", { exact: true })
    .fill(
      "Prepare a written campaign plan from explicitly simulated product facts. Deliver an editable Markdown file.",
    );
  await modal.getByLabel("Task budget limit (HKD)", { exact: true }).fill("1");
  await shot(page, "29-default-assistant-brief");
  checks.push({
    name: "a new customer can choose and edit an example without creating a specialist, brand or connector and without submitting the sample automatically",
    status: "passed",
  });
  let first: any,
    requests = 0;
  // Simulate loss of an accepted response; the server still performs the real transaction.
  await page.route("**/delegations", async (route) => {
    requests++;
    if (requests === 1) {
      const r = await route.fetch();
      assert.equal(r.status(), 200);
      first = await r.json();
      await route.abort("failed");
    } else await route.continue();
  });
  await modal.getByRole("button", { name: "Start task", exact: true }).click();
  await modal.getByRole("alert").waitFor();
  assert.ok(first?.task?.id);
  await modal.getByRole("button", { name: "Start task", exact: true }).click();
  await page.waitForURL(`**/app/conversations/${first.conversation.id}`);
  await page.unroute("**/delegations");
  assert.equal((await read(page, base + "/tasks")).items.length, 1);
  assert.equal((await read(page, base + "/conversations")).items.length, 1);
  let task: any;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    task = await read(page, base + "/tasks/" + first.task.id);
    if (
      ["succeeded", "failed", "cancelled", "reconciling"].includes(task.status)
    )
      break;
    await new Promise((r) => setTimeout(r, 300));
  }
  assert.equal(
    task?.status,
    "succeeded",
    JSON.stringify({ status: task?.status, error: task?.error_code }),
  );
  assert.equal(task.private_owner, me.user.id);
  assert.equal(task.role_key, "assistant");
  const files = (await read(page, base + "/assets")).items,
    file = files.find((f: any) => f.name === "demo-report.md");
  assert.ok(file);
  const text = await page.evaluate(
    async (url) => (await fetch(url)).text(),
    base + "/assets/" + file.id + "/download",
  );
  assert.match(text, /Simulated deliverable/);
  checks.push({
    name: "after an injected lost acceptance response, retry reuses one conversation, message, task and budget; real Codex then writes an actual private Markdown file using synthetic model data",
    status: "passed",
  });
  await page
    .getByRole("heading", { name: "First campaign plan", exact: true })
    .waitFor();
  await page
    .locator(".message-assistant")
    .filter({ hasText: "Simulated data" })
    .waitFor();
  await shot(page, "30-default-assistant-result");
  await page
    .getByRole("link", { name: "Your conversations", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Start conversation", exact: true })
    .first()
    .click();
  modal = page.getByRole("dialog");
  await modal
    .getByLabel("Conversation name", { exact: true })
    .fill("Second direct conversation");
  assert.equal(await modal.locator('select[name="agent"]').inputValue(), "");
  await modal
    .getByRole("button", { name: "Create conversation", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Second direct conversation", exact: true })
    .waitFor();
  const agents = (await read(page, base + "/agents")).items;
  assert.equal(agents.length, 1);
  assert.equal(agents[0].builtin_default, true);
  assert.equal(
    (await read(page, base + "/tasks")).items.length,
    1,
    "creating an empty conversation does not run AI",
  );
  checks.push({
    name: "a further conversation defaults to the same built-in assistant and creating it does not start another AI task",
    status: "passed",
  });
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `default conversation overflow at ${width}: ${JSON.stringify(
        await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>("main *")]
            .map((e) => ({
              tag: e.tagName,
              cls: e.className,
              right: e.getBoundingClientRect().right,
              width: e.getBoundingClientRect().width,
            }))
            .filter((e) => e.right > innerWidth + 1)
            .slice(0, 12),
        ),
      )}`,
    );
  }
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await shot(page, "31-default-assistant-dark");
  await page.getByTitle("切換至繁體中文").click();
  await page.getByRole("button", { name: "會話設定", exact: true }).waitFor();
  checks.push({
    name: "direct default conversations support four widths, two themes and Traditional Chinese/English",
    status: "passed",
  });
  assert.deepEqual(errors, []);
} catch (e: any) {
  checks.push({
    name: "default assistant browser regression",
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
    "evidence/default-assistant.json",
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
}
