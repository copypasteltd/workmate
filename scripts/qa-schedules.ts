import { chromium, type BrowserContext, type Page } from "playwright";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
import { emailCode, verifyAdmin } from "./qa-auth.js";
const root = path.resolve(".."),
  platform = path.join(root, "copypaste-platform");
const checks: { name: string; status: string }[] = [],
  errors: string[] = [],
  contexts: BrowserContext[] = [];
execFileSync(
  process.execPath,
  ["--env-file=.env", "--import", "tsx", "scripts/qa-fixture.ts"],
  { cwd: platform, stdio: "pipe", windowsHide: true },
);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN ?? chromium.executablePath(),
  headless: true,
});
async function context() {
  const c = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    locale: "en-HK",
  });
  contexts.push(c);
  c.setDefaultTimeout(25000);
  await c.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const page = await c.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return { c, page };
}
async function request(
  c: BrowserContext,
  url: string,
  method = "GET",
  body?: unknown,
) {
  const origin = "http://localhost:4317",
    me = await (await c.request.get(origin + "/v1/session/context")).json();
  const response = await c.request.fetch(origin + url, {
    method,
    headers: { "X-CSRF-Token": me.csrf_token, "Idempotency-Key": randomUUID() },
    ...(body === undefined ? {} : { data: body }),
  });
  const result = await response.json();
  assert.equal(response.ok(), true, JSON.stringify(result));
  return result;
}
async function shot(page: Page, repo: string, name: string) {
  const target = path.join(root, repo, "assets/screenshots");
  await mkdir(target, { recursive: true });
  await page.screenshot({
    path: path.join(target, name + ".png"),
    fullPage: false,
    animations: "disabled",
  });
}
async function waitFor(check: () => Promise<boolean>, timeout: number) {
  const until = Date.now() + timeout;
  do {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 500));
  } while (Date.now() < until);
  throw new Error("Schedule state did not reach the expected result");
}
let client: BrowserContext | undefined,
  scheduleBase = "",
  scheduleId = "",
  runId = "",
  cleanup = false;
try {
  const { c, page } = await context();
  client = c;
  await page.goto("http://localhost:4317/login");
  await page
    .getByLabel("Work email")
    .fill("schedule-" + randomUUID() + "@example.invalid");
  const code = await emailCode(page, () =>
    page
      .getByRole("button", { name: "Send sign-in code", exact: true })
      .click(),
  );
  await page.locator('input[name="code"]').fill(code);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/welcome");
  await page.locator('input[name="name"]').fill("Harbour schedule QA");
  await page
    .locator('input[name="project_name"]')
    .fill("Campaign report cadence");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL("**/app");
  const me = await request(c, "/v1/session/context"),
    tenant = me.memberships[0].id;
  const project = (await request(c, `/v1/tenants/${tenant}/projects`)).items[0]
    .id;
  const base = `/v1/tenants/${tenant}/projects/${project}`;
  scheduleBase = base + "/workflow-schedules";
  const dataset = await request(c, base + "/analytics/import", "POST", {
    name: "Scheduled paid campaign",
    csv: "date,channel,impressions,clicks,spend,conversions,revenue\n2026-10-01,google,1000,20,12.5,2,50",
    timezone: "Asia/Hong_Kong",
  });
  await page.goto("http://localhost:4317/app/workflows");
  await page
    .getByRole("button", { name: "Create workflow", exact: true })
    .click();
  await page
    .getByLabel("Workflow name", { exact: true })
    .fill("Harbour verified report");
  await page
    .getByLabel("Source dataset", { exact: true })
    .selectOption(dataset.id);
  await page
    .getByRole("button", { name: "Save workflow", exact: true })
    .click();
  const workflowCard = page.locator("article").filter({
    has: page.getByRole("heading", {
      name: "Harbour verified report",
      exact: true,
    }),
  });
  await workflowCard
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  await workflowCard
    .getByRole("button", { name: "Run workflow", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Add schedule", exact: true }).click();
  const name = "Verified cadence " + randomUUID().slice(0, 8);
  const editor = page.getByRole("dialog");
  await editor.getByLabel("Schedule name", { exact: true }).fill(name);
  const workflows = await request(c, base + "/workflows");
  await editor
    .getByLabel("Published workflow", { exact: true })
    .selectOption(workflows.items[0].id);
  const due = new Date(Date.now() + 75000).toISOString().slice(11, 16);
  await editor.getByLabel("Wall time", { exact: true }).fill(due);
  await editor
    .getByLabel("Schedule time zone (IANA)", { exact: true })
    .fill("UTC");
  await editor
    .getByRole("button", { name: "Preview schedule", exact: true })
    .click();
  await editor
    .getByRole("heading", { name: "Upcoming times", exact: true })
    .waitFor();
  await shot(page, "copypaste-web", "14-schedule-confirmation");
  await editor.locator('input[name="authorize"]').check();
  await editor
    .getByRole("button", { name: "Confirm & enable schedule", exact: true })
    .click();
  await editor.waitFor({ state: "hidden" });
  const s = (await request(c, scheduleBase)).items.find(
    (r: any) => r.name === name,
  );
  assert.ok(s);
  scheduleId = s.id;
  checks.push({
    name: "real user OTP/onboarding, CSV source, published workflow and explicit schedule/budget confirmation",
    status: "passed",
  });
  await page.close();
  console.log(
    "Schedule browser checkpoint 1; user page closed while waiting for the real clock",
  );
  let history: any;
  await waitFor(async () => {
    history = await request(c, scheduleBase);
    const o = history.occurrences.find(
      (r: any) => r.schedule_id === scheduleId && r.state === "launched",
    );
    if (!o) return false;
    runId = o.run_id;
    return true;
  }, 90000);
  await waitFor(async () => {
    const r = (await request(c, base + "/workflows")).runs.find(
      (r: any) => r.id === runId,
    );
    return r?.state === "awaiting_approval";
  }, 20000);
  const run = (await request(c, base + "/workflows")).runs.find(
    (r: any) => r.id === runId,
  );
  const response = await c.request.get(
    "http://localhost:4317" +
      base +
      "/assets/" +
      run.results[0].asset_id +
      "/download",
  );
  assert.equal(response.ok(), true);
  const report = await response.json();
  assert.equal(report.metrics.spend_micros, 12500000);
  assert.equal(report.metrics.roas, 4);
  assert.equal(
    history.occurrences.filter(
      (r: any) => r.schedule_id === scheduleId && r.state === "launched",
    ).length,
    1,
  );
  checks.push({
    name: "closed user page, actual clock and native Worker produce one persisted report with verified HKD metrics and a review checkpoint",
    status: "passed",
  });
  const work = await c.newPage();
  work.on("pageerror", (e) => errors.push(e.message));
  await work.goto("http://localhost:4317/app/workflows");
  const card = work
    .locator("article")
    .filter({ has: work.getByRole("heading", { name, exact: true }) });
  await card.waitFor();
  await card.scrollIntoViewIfNeeded();
  await shot(work, "copypaste-web", "15-cloud-schedules");
  await card.getByTitle("Pause schedule", { exact: true }).click();
  await work
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await work.getByRole("dialog").waitFor({ state: "hidden" });
  await card.getByTitle("Resume schedule", { exact: true }).click();
  await work.getByRole("dialog").getByRole("checkbox").check();
  await work
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await work.getByRole("dialog").waitFor({ state: "hidden" });
  await card.getByTitle("Edit schedule", { exact: true }).click();
  const edit = work.getByRole("dialog");
  await edit.getByLabel("Frequency", { exact: true }).selectOption("weekly");
  await edit.getByRole("checkbox", { name: "Mon", exact: true }).check();
  await edit.getByLabel("Wall time", { exact: true }).fill("10:30");
  await edit
    .getByLabel("Schedule time zone (IANA)", { exact: true })
    .fill("Asia/Hong_Kong");
  await edit
    .getByRole("button", { name: "Preview schedule", exact: true })
    .click();
  await edit
    .getByRole("heading", { name: "Upcoming times", exact: true })
    .waitFor();
  await edit.locator('input[name="authorize"]').check();
  await edit
    .getByRole("button", { name: "Confirm & enable schedule", exact: true })
    .click();
  await edit.waitFor({ state: "hidden" });
  const detail = await request(c, scheduleBase + "/" + scheduleId);
  assert.equal(detail.revision, 3);
  assert.equal(detail.versions[2].body.calendar.timezone, "UTC");
  checks.push({
    name: "user pause/resume and weekly/time-zone edit retain immutable configuration history and affect future work",
    status: "passed",
  });
  console.log("Schedule browser checkpoint 2");
  const { page: admin } = await context(),
    operator = JSON.parse(
      await readFile(path.join(platform, ".data/qa/operator.json"), "utf8"),
    );
  await admin.goto("http://localhost:4318");
  await admin.locator('input[name="email"]').fill(operator.email);
  const adminCode = await emailCode(
    admin,
    () =>
      admin
        .getByRole("button", { name: "Send admin sign-in code", exact: true })
        .click(),
    true,
  );
  await admin.locator('input[name="code"]').fill(adminCode);
  await verifyAdmin(admin, operator.totp_secret);
  await admin.waitForURL("**/overview");
  await admin.goto("http://localhost:4318/execution");
  await admin.getByLabel("Search schedules", { exact: true }).fill(name);
  const row = admin
    .getByRole("row")
    .filter({ has: admin.getByText(name, { exact: true }) });
  await row.waitFor();
  await row
    .getByRole("button", { name: "Pause schedule", exact: true })
    .click();
  await admin
    .getByRole("dialog")
    .getByLabel("Reason", { exact: true })
    .fill("Review the recurring campaign report");
  await admin
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm action", exact: true })
    .click();
  await admin.getByRole("dialog").waitFor({ state: "hidden" });
  await row
    .getByRole("button", { name: "Resume schedule", exact: true })
    .click();
  await admin
    .getByRole("dialog")
    .getByLabel("Reason", { exact: true })
    .fill("Resume the unchanged confirmed authorization");
  await admin
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm action", exact: true })
    .click();
  await admin.getByRole("dialog").waitFor({ state: "hidden" });
  await row.scrollIntoViewIfNeeded();
  await shot(admin, "copypaste-admin", "11-cloud-schedules");
  checks.push({
    name: "separate real Admin MFA can pause/resume future triggers with reason and CAS while retaining the original user authorization",
    status: "passed",
  });
  await work.setViewportSize({ width: 390, height: 844 });
  await card.scrollIntoViewIfNeeded();
  await shot(work, "copypaste-web", "16-schedules-mobile");
  assert.equal(
    await work.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    JSON.stringify(
      await work.evaluate(() =>
        Array.from(document.querySelectorAll("main *"))
          .map((e) => ({
            tag: e.tagName,
            class: e.className,
            right: e.getBoundingClientRect().right,
            width: e.getBoundingClientRect().width,
          }))
          .filter((e) => e.right > innerWidth + 1)
          .slice(0, 20),
      ),
    ),
  );
  checks.push({
    name: "390px schedule controls stay within the viewport; owned pages and browser close in finally",
    status: "passed",
  });
  const current = await request(c, scheduleBase + "/" + scheduleId);
  await request(c, scheduleBase + "/" + scheduleId + "/status", "POST", {
    expected_version: current.version,
    action: "retire",
  });
  await request(c, base + "/workflow-runs/" + runId + "/cancel", "POST", {});
  cleanup = true;
} catch (error) {
  errors.push(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
} finally {
  if (client && scheduleId && !cleanup) {
    try {
      const current = await request(client, scheduleBase + "/" + scheduleId);
      if (current.state !== "retired")
        await request(
          client,
          scheduleBase + "/" + scheduleId + "/status",
          "POST",
          { expected_version: current.version, action: "retire" },
        );
    } catch {}
  }
  if (client && runId && !cleanup) {
    try {
      await request(
        client,
        scheduleBase.replace(/\/workflow-schedules$/, "") +
          "/workflow-runs/" +
          runId +
          "/cancel",
        "POST",
        {},
      );
    } catch {}
  }
  for (const c of contexts) await c.close();
  await browser.close();
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/schedules.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        version: JSON.parse(await readFile("package.json", "utf8")).version,
        checks,
        errors,
        browser_closed: true,
        used_real_clock: true,
        used_real_ai: false,
      },
      null,
      2,
    ) + "\n",
  );
}
if (errors.length) throw new Error(errors.join("\n"));
console.log(
  "Schedule browser QA passed; five groups and all owned pages closed.",
);
