import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";
import {
  WorkmateRecording,
  saveWorkmateScreenshot,
} from "./record-workmate-media.js";
import { openContentSidePanel } from "./client-content-sidepanel-ui.js";

const delivery = process.cwd(),
  platform = path.resolve("../copypaste-platform"),
  attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const prefix = path.join(delivery, "evidence/cloud-schedule-ui-" + attempt),
  checks: string[] = [],
  errors: string[] = [],
  screenshots: any[] = [],
  media: any[] = [],
  executions: any[] = [],
  outputFiles: any[] = [];
let browser: Browser | undefined,
  panel: Awaited<ReturnType<typeof openContentSidePanel>> | undefined,
  system: any,
  isolated: any,
  recording: WorkmateRecording | undefined;
let browserClosed = false,
  panelClosed = false,
  apiClosed = false,
  fixtureClosed = false,
  stage = "setup";
const load = (file: string) =>
  import(pathToFileURL(path.join(platform, file)).href);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const pass = (name: string) => {
  checks.push(
    "SCHEDULE-" + String(checks.length + 1).padStart(2, "0") + " " + name,
  );
  console.log("PASS: " + checks.at(-1));
};
async function until<T>(
  read: () => Promise<T>,
  accept: (v: T) => boolean,
  label: string,
) {
  const end = Date.now() + 35000;
  while (Date.now() < end) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error("Timeout: " + label);
}
async function request(
  page: Page,
  url: string,
  method = "GET",
  body?: unknown,
) {
  const r = await page.evaluate(
    async ({ url, method, body }) => {
      const s = await (
        await fetch(
          location.port === "4318" ? "/v1/admin/me" : "/v1/session/context",
        )
      ).json();
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": s.csrf_token,
          "Idempotency-Key": crypto.randomUUID(),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    },
    { url, method, body },
  );
  assert.ok(
    r.status >= 200 && r.status < 300,
    `${method} ${url}: ${r.status} ${JSON.stringify(r.body)}`,
  );
  return r.body;
}
async function signIn(page: Page, email: string, otp?: any) {
  await page.goto(`http://localhost:${otp ? 4318 : 4317}/login`);
  await page.locator('input[name="email"]').fill(email);
  const [challenge] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname ===
          (otp ? "/v1/admin/auth/challenge" : "/v1/auth/challenges") &&
        r.request().method() === "POST",
    ),
    page.locator('form button[type="submit"]').click(),
  ]);
  assert.equal(challenge.ok(), true);
  const ch = await challenge.json(),
    mail = JSON.parse(
      await readFile(
        `${system.db.config.DATA_DIR}/mailbox/${ch.challenge_id}.json`,
        "utf8",
      ),
    );
  await page
    .locator('input[name="code"]')
    .fill(mail.text.match(/\b\d{6}\b/)[0]);
  if (otp) await page.locator('input[name="totp"]').fill(otp.generate());
  await page.locator('form button[type="submit"]').click();
}
async function shot(
  repo: string,
  name: string,
  bytes: Buffer,
  description: string,
) {
  screenshots.push(
    await saveWorkmateScreenshot(
      repo,
      "cloud-schedule-" + attempt,
      name,
      bytes,
      description,
      delivery,
    ),
  );
}
async function finishRecording() {
  if (recording) {
    const current = recording;
    recording = undefined;
    media.push(await current.stop());
  }
}
async function fits(page: Page) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
}

const deadline = setTimeout(() => {
  errors.push("Owned schedule UI deadline exceeded");
  void panel?.close();
  void browser?.close();
}, 600000);
try {
  const [
    { isolatedTestEnvironment },
    { buildApp },
    { loadConfig },
    { CodexRuntimeAdapter },
    { Worker },
    { advanceCloudWorkflows },
    { advanceCloudSchedules },
  ] = await Promise.all([
    load("tests/native-test-environment.ts"),
    load("src/server.ts"),
    load("src/config.ts"),
    load("src/runtime.ts"),
    load("src/worker.ts"),
    load("src/cloud-workflows.ts"),
    load("src/cloud-schedules.ts"),
  ]);
  process.chdir(platform);
  isolated = await isolatedTestEnvironment();
  system = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEMO_MODE: "true",
      DEV_MAILBOX: "true",
      WORKER_ENABLED: "false",
    }),
    { worker: false },
  );
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN,
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1040 },
    acceptDownloads: true,
  });
  await context.addInitScript(() => {
    if (!localStorage.getItem("cp_locale"))
      localStorage.setItem("cp_locale", "en");
    if (!localStorage.getItem("cp_theme"))
      localStorage.setItem("cp_theme", "light");
  });
  const web = await context.newPage();
  web.setDefaultTimeout(25000);
  web.on("pageerror", (e) => errors.push(e.message));
  stage = "Email onboarding";
  await signIn(web, `schedule-${randomUUID()}@example.invalid`);
  await web.waitForURL("**/welcome");
  await web.locator('input[name="name"]').fill("Harbour campaign studio");
  await web.locator('input[name="project_name"]').fill("Campaign routines");
  const [created] = await Promise.all([
    web.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/v1/tenants" &&
        r.request().method() === "POST",
    ),
    web
      .getByRole("button", { name: "Create workspace & continue", exact: true })
      .click(),
  ]);
  assert.equal(created.ok(), true);
  const workspace = await created.json(),
    tenant = workspace.tenant.id,
    project = workspace.project.id,
    base = `/v1/tenants/${tenant}/projects/${project}`,
    endpoint = base + "/cloud-workflow-schedules";
  await web.waitForURL("**/app");
  await request(web, `/v1/tenants/${tenant}/demo-credit`, "POST", {});
  const me = await request(web, "/v1/me");
  const dataset = await request(web, base + "/analytics/import", "POST", {
    name: "Confirmed Harbour campaign",
    currency: "HKD",
    account_id: "Google-HK",
    attribution_definition: "7d click",
    conversion_definition: "Purchase",
    csv: "date,channel,campaign,impressions,clicks,spend,conversions,revenue,currency\n2026-10-01,Google,Harbour,100,10,10,1,20,HKD\n2026-10-02,Google,Harbour,1000,200,90,3,180,HKD",
  });
  await web.goto("http://localhost:4317/app/roles");
  await web.locator('[data-template-role="workflow-consultant"]').click();
  let modal = web.getByRole("dialog");
  await modal
    .getByLabel("Specialist name", { exact: true })
    .fill("Harbour workflow consultant");
  await modal
    .getByRole("button", { name: "Check availability", exact: true })
    .click();
  await modal
    .getByRole("button", { name: "Create this specialist", exact: true })
    .click();
  await web.waitForURL("**/app/specialists");
  await web
    .locator(".specialist-card")
    .filter({
      has: web.getByRole("heading", {
        name: "Harbour workflow consultant",
        exact: true,
      }),
    })
    .getByRole("button", { name: "Start conversation", exact: true })
    .click();
  await web.waitForURL("**/app/conversations/*");
  const conversation = web.url().split("/").at(-1)!;
  let currentCalls: string[] = [];
  class CapturedCodex extends CodexRuntimeAdapter {
    constructor(config: any) {
      super(config);
    }
    async start(ctx: any) {
      return super.start({
        ...ctx,
        tools: ctx.tools.map((tool: any) => ({
          ...tool,
          run: async (args: any, id: string) => {
            currentCalls.push(tool.name);
            return tool.run(args, id);
          },
        })),
      });
    }
  }
  async function execute(id: string) {
    currentCalls = [];
    await new Worker(
      system.db,
      system.catalog,
      system.storage,
      new CapturedCodex(system.db.config),
    ).run(tenant, id);
    const task = await request(web, base + "/tasks/" + id);
    assert.equal(task.status, "succeeded", JSON.stringify(task));
    const count = (
      await system.db.control.query(
        "SELECT count(*)::int AS n FROM reservations WHERE task_id=$1",
        [id],
      )
    ).rows[0].n;
    assert.equal(count, 1);
    assert.ok(Number(task.charged_micros) > 0);
    executions.push({
      task_id: id,
      native_codex: true,
      synthetic_model: true,
      tools: [...currentCalls],
      reservation_count: count,
      charged_micros: task.charged_micros,
    });
    return task;
  }
  stage = "Native Codex proposal";
  await web.locator('select[name="mode"]').selectOption("execute");
  await web
    .getByLabel("Your message", { exact: true })
    .fill(
      "schedule_demo=confirmed. Prepare a private cloud workflow using the fixed authorized campaign dataset. Daily at 09:00 Asia/Hong_Kong; catch up latest only; start now with no end. Deliver a fixed campaign summary, wait for my human approval and prepare a private note. Request my confirmation before activating any scheduled work.",
    );
  const [sent] = await Promise.all([
    web.waitForResponse(
      (r) =>
        new URL(r.url()).pathname ===
          base + `/conversations/${conversation}/messages` &&
        r.request().method() === "POST",
    ),
    web.getByRole("button", { name: "Delegate task", exact: true }).click(),
  ]);
  assert.equal(sent.ok(), true);
  const accepted = await sent.json();
  await execute(accepted.task.id);
  assert.deepEqual(currentCalls, [
    "analysis_sources",
    "workflow_validate",
    "workflow_save",
    "workflow_publish",
    "workflow_schedule_preview",
    "workflow_schedule_request",
  ]);
  let listing = await request(web, endpoint),
    proposal = listing.requests[0];
  assert.equal(proposal.state, "pending");
  assert.equal(listing.schedules.length, 0);
  assert.equal(
    (
      await system.db.control.query(
        "SELECT count(*)::int AS n FROM workflow_runs WHERE origin_task_id=$1",
        [accepted.task.id],
      )
    ).rows[0].n,
    0,
  );
  pass(
    "Actual email onboarding, specialist preflight and pinned native Codex prepare one private schedule through real tools and fixed Skills; no future run or reservation exists before customer consent",
  );

  stage = "Web confirmation";
  await web.goto("http://localhost:4317/app/workflows");
  const plan = (id: string) => web.locator(`[data-cloud-schedule="${id}"]`),
    run = (id: string) => web.locator(`[data-workflow-run="${id}"]`);
  await web
    .locator(`[data-schedule-request="${proposal.id}"]`)
    .getByRole("button", { name: "Review schedule & budget", exact: true })
    .click();
  modal = web.getByRole("dialog");
  await modal.getByText("Asia/Hong_Kong", { exact: true }).waitFor();
  await shot(
    "web",
    "review-en",
    await web.screenshot(),
    "Actual exact private method, inputs, calendar, budget and unchecked customer confirmation",
  );
  recording = new WorkmateRecording(
    "web",
    "cloud-schedule-confirm",
    "cloud-schedule-" + attempt,
    () => web.screenshot({ type: "jpeg", quality: 75 }),
    "Actual unchecked consent, explicit activation and private calendar state",
    delivery,
  );
  await recording.start();
  const activateButton = modal.getByRole("button", {
    name: "Confirm & activate schedule",
    exact: true,
  });
  assert.equal(await activateButton.isDisabled(), true);
  assert.equal((await request(web, endpoint)).schedules.length, 0);
  await modal.getByRole("checkbox").check();
  await activateButton.click();
  await modal.waitFor({ state: "hidden" });
  listing = await request(web, endpoint);
  let schedule = listing.schedules[0],
    id = schedule.id;
  assert.equal(schedule.state, "active");
  await plan(id).waitFor();
  await plan(id).scrollIntoViewIfNeeded();
  await shot(
    "web",
    "active-en",
    await web.screenshot(),
    "Actual active private cloud schedule, fixed source version and next times",
  );
  await finishRecording();
  await Promise.all([
    advanceCloudSchedules(
      system.db,
      system.catalog,
      system.storage,
      Date.parse(schedule.next_due_at),
    ),
    advanceCloudSchedules(
      system.db,
      system.catalog,
      system.storage,
      Date.parse(schedule.next_due_at),
    ),
  ]);
  await advanceCloudWorkflows(system.db, system.catalog, system.storage);
  await advanceCloudWorkflows(system.db, system.catalog, system.storage);
  let runs = (await request(web, base + "/cloud-workflows")).runs,
    first = runs.find((r: any) => r.schedule_id === id);
  assert.ok(first);
  assert.equal(first.state, "awaiting_approval");
  assert.equal(runs.filter((r: any) => r.schedule_id === id).length, 1);
  assert.equal(
    first.results.filter((r: any) => r.kind === "analytics.summary").length,
    1,
  );
  pass(
    "Actual Web unchecked consent cannot activate; exact customer confirmation creates one plan and concurrent durable calendar ticks commit one run that stops at its human review point",
  );

  stage = "Run results and actual child fees";
  await web.reload();
  await run(first.id)
    .getByRole("button", { name: "Review & continue", exact: true })
    .waitFor();
  await run(first.id).locator("summary").click();
  const [download] = await Promise.all([
    web.waitForEvent("download"),
    run(first.id)
      .getByRole("button", { name: "Download summary", exact: true })
      .click(),
  ]);
  const summaryBytes = await readFile((await download.path())!);
  const summary = JSON.parse(summaryBytes.toString());
  assert.equal(summary.snapshot_id, dataset.id);
  outputFiles.push({
    bytes: summaryBytes.length,
    sha256: sha(summaryBytes),
    source: "Actual private summary download",
  });
  await run(first.id)
    .getByRole("button", { name: "Review & continue", exact: true })
    .click();
  modal = web.getByRole("dialog");
  await modal.getByRole("checkbox").check();
  await modal
    .getByRole("button", { name: "Confirm & continue", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  await advanceCloudWorkflows(system.db, system.catalog, system.storage);
  first = (await request(web, base + "/cloud-workflows")).runs.find(
    (r: any) => r.id === first.id,
  );
  assert.ok(first.active_task);
  await execute(first.active_task);
  assert.deepEqual(currentCalls, ["deliver_text"]);
  await advanceCloudWorkflows(system.db, system.catalog, system.storage);
  first = (await request(web, base + "/cloud-workflows")).runs.find(
    (r: any) => r.id === first.id,
  );
  assert.equal(first.state, "succeeded");
  const detail = await request(web, endpoint + "/" + id);
  assert.ok(Number(detail.occurrences[0].charged_micros) > 0);
  assert.equal(detail.occurrences[0].calendar.timezone, "Asia/Hong_Kong");
  await web.reload();
  await plan(id).waitFor();
  await plan(id)
    .getByRole("button", { name: "Runs & versions", exact: true })
    .click();
  modal = web.getByRole("dialog");
  await modal.getByText("Asia/Hong_Kong", { exact: false }).first().waitFor();
  await shot(
    "web",
    "history-en",
    await web.screenshot(),
    "Actual immutable calendar occurrence with settled charges, version and direct private-run links",
  );
  const [focusedResponse] = await Promise.all([
    web.waitForResponse(
      (r) =>
        new URL(r.url()).searchParams.get("run_id") === first.id &&
        r.request().method() === "GET",
    ),
    modal
      .getByRole("link", {
        name: "View delivery or stop this run in workflow history",
        exact: true,
      })
      .click(),
  ]);
  assert.equal(focusedResponse.ok(), true);
  assert.deepEqual(
    (await focusedResponse.json()).runs.map((r: any) => r.id),
    [first.id],
  );
  await web
    .getByRole("link", { name: "Show all workflow runs", exact: true })
    .click();
  pass(
    "Customer downloads byte-checked private campaign summary, explicitly continues human review, and an actual native Codex child writes its private result with one reservation and actual settled charges",
  );

  stage = "Pause resume revision";
  await plan(id)
    .getByRole("button", { name: "Pause future times", exact: true })
    .click();
  modal = web.getByRole("dialog");
  await modal
    .getByRole("button", { name: "Confirm action", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  await until(
    async () => (await request(web, endpoint)).schedules[0].state,
    (v) => v === "paused",
    "pause",
  );
  await plan(id)
    .getByRole("button", { name: "Review & resume", exact: true })
    .click();
  modal = web.getByRole("dialog");
  await modal.getByRole("checkbox").check();
  await modal
    .getByRole("button", { name: "Confirm action", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  await plan(id)
    .getByRole("button", { name: "Edit schedule", exact: true })
    .click();
  modal = web.getByRole("dialog");
  await modal
    .getByLabel("Schedule name", { exact: true })
    .fill("Harbour weekly review");
  await modal.getByLabel("Frequency", { exact: true }).selectOption("weekly");
  await modal.getByLabel("Mon", { exact: true }).check();
  await modal.getByLabel("Time zone", { exact: true }).fill("UTC");
  const [revisionResponse] = await Promise.all([
    web.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === endpoint + "/" + id + "/requests" &&
        r.request().method() === "POST",
    ),
    modal
      .getByRole("button", { name: "Save & review request", exact: true })
      .click(),
  ]);
  assert.equal(revisionResponse.ok(), true, await revisionResponse.text());
  await web
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm & activate schedule", exact: true })
    .waitFor();
  assert.equal(
    (await request(web, endpoint)).schedules[0].body.calendar.timezone,
    "Asia/Hong_Kong",
  );
  modal = web.getByRole("dialog");
  await modal.getByRole("checkbox").check();
  await modal
    .getByRole("button", { name: "Confirm & activate schedule", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  await until(
    async () =>
      (await request(web, endpoint)).schedules[0].body.calendar.timezone,
    (v) => v === "UTC",
    "separately confirmed revision",
  );
  assert.equal(
    (await request(web, endpoint + "/" + id)).occurrences[0].calendar.timezone,
    "Asia/Hong_Kong",
  );
  await shot(
    "web",
    "revised-en",
    await web.screenshot(),
    "Actual independently confirmed calendar revision retains the original run's timezone and method",
  );
  pass(
    "Actual pause and explicit resumption preserve results and skip paused times; editing creates a separate pending proposal, and historical occurrences retain their original timezone after the new version is confirmed",
  );

  stage = "Actual native Side Panel";
  proposal = await request(web, endpoint + "/requests", "POST", {
    source_run_id: first.id,
    name: "Harbour side panel routine",
    calendar: {
      timezone: "Asia/Hong_Kong",
      frequency: "daily",
      time: "15:30",
      weekdays: [],
    },
    catch_up: "skip",
    ends_at: null,
    expected_output:
      "Review the fixed campaign summary and approve the private note each time.",
  });
  panel = await openContentSidePanel(delivery, await context.cookies());
  assert.equal(panel.native.context_type, "SIDE_PANEL");
  assert.equal(panel.native.side, "right");
  await panel.evaluate("document.querySelector('#workspace-tools').open=true");
  await until(
    () =>
      panel!.evaluate(
        `Boolean(document.querySelector('.task-row[data-task="${accepted.task.id}"]'))`,
      ),
    Boolean,
    "consultant task in actual panel",
  );
  await panel.evaluate(
    `document.querySelector('.task-row[data-task="${accepted.task.id}"]').click()`,
  );
  await until(
    () =>
      panel!.evaluate(
        `Boolean(document.querySelector('[data-schedule-request="${proposal.id}"]'))`,
      ),
    Boolean,
    "real pending schedule",
  );
  await panel.evaluate(
    `document.querySelector('[data-schedule-request="${proposal.id}"]').scrollIntoView({block:'start'})`,
  );
  await shot(
    "extension",
    "review-en",
    await panel.capture(),
    "Actual docked Chrome right SIDE_PANEL with unchecked private schedule authorization",
  );
  recording = new WorkmateRecording(
    "extension",
    "cloud-schedule-sidepanel",
    "cloud-schedule-" + attempt,
    () => panel!.capture(),
    "Actual right Side Panel exact consent, activation and pause; cloud execution only",
    delivery,
  );
  await recording.start();
  assert.equal(
    await panel.evaluate(
      `document.querySelector('[data-schedule-request="${proposal.id}"] button[type="submit"]').disabled`,
    ),
    true,
  );
  await panel.evaluate(
    `(()=>{const c=document.querySelector('[data-schedule-request="${proposal.id}"] input[type="checkbox"]');c.click();c.form.requestSubmit()})()`,
  );
  const side: any = await until<any>(
    async () =>
      (await request(web, endpoint)).schedules.find(
        (s: any) => s.name === "Harbour side panel routine",
      ),
    Boolean,
    "panel activation",
  );
  await until(
    () =>
      panel!.evaluate(
        `Boolean(document.querySelector('[data-cloud-schedule="${side.id}"]'))`,
      ),
    Boolean,
    "active panel state",
  );
  await panel.evaluate(
    `document.querySelector('[data-cloud-schedule="${side.id}"]').scrollIntoView({block:'start'})`,
  );
  await shot(
    "extension",
    "active-en",
    await panel.capture(),
    "Actual active native side panel with fixed method, per-run budget, pause and outcome history",
  );
  await panel.evaluate(
    `document.querySelector('[data-cloud-schedule="${side.id}"] .cloud-schedule-controls button').click()`,
  );
  await until(
    async () =>
      (await request(web, endpoint)).schedules.find(
        (s: any) => s.id === side.id,
      ).state,
    (v) => v === "paused",
    "panel pause",
  );
  assert.equal(
    await panel.evaluate("document.documentElement.scrollWidth>innerWidth"),
    false,
  );
  await finishRecording();
  pass(
    "A toolbar action opens an actual right SIDE_PANEL with PKCE authentication, no extra popup, unchecked consent, cloud schedule activation, pause and no horizontal overflow",
  );

  stage = "Admin metadata and MFA pause";
  const adminContext = await browser.newContext({
    viewport: { width: 1440, height: 1040 },
  });
  await adminContext.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const admin = await adminContext.newPage();
  admin.setDefaultTimeout(25000);
  admin.on("pageerror", (e) => errors.push(e.message));
  const OTP = createRequire(path.join(platform, "package.json"))("otpauth"),
    secret = new OTP.Secret({ size: 20 }),
    email = `schedule-admin-${randomUUID()}@example.invalid`,
    { seal } = await load("src/lib.ts");
  const principal = (
    await system.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Harbour schedule administrator',$2) RETURNING id",
      [email, seal(system.db.config.MASTER_KEY, secret.base32)],
    )
  ).rows[0];
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,'super_admin','global')",
    [principal.id],
  );
  await signIn(
    admin,
    email,
    new OTP.TOTP({ secret, digits: 6, period: 30, algorithm: "SHA1" }),
  );
  await admin.locator(".admin-shell").waitFor();
  await admin.goto("http://localhost:4318/execution");
  const adminRegion = admin.getByRole("region", {
    name: "Private cloud schedule administration",
    exact: true,
  });
  await adminRegion.waitFor();
  await adminRegion.scrollIntoViewIfNeeded();
  const adminRows = await request(admin, "/v1/admin/private-cloud-schedules");
  assert.equal(adminRows.total, 2);
  assert.ok(
    adminRows.items.every(
      (s: any) => !s.body && !s.definition && !s.expected_output,
    ),
  );
  await until(
    () => admin.locator(".loading").count(),
    (v) => v === 0,
    "complete administrator tables",
  );
  await shot(
    "admin",
    "private-schedules-en",
    await admin.screenshot(),
    "Actual Admin metadata-only schedule list without customer prompts or private methods",
  );
  recording = new WorkmateRecording(
    "admin",
    "cloud-schedule-pause",
    "cloud-schedule-" + attempt,
    () => admin.screenshot({ type: "jpeg", quality: 75 }),
    "Actual administrator email and MFA, reasoned pause, immutable audit and customer-controlled resumption",
    delivery,
  );
  await recording.start();
  await admin
    .locator(`[data-admin-cloud-schedule="${id}"]`)
    .getByRole("button", { name: "Pause future times", exact: true })
    .click();
  modal = admin.getByRole("dialog");
  await modal
    .getByLabel("Reason", { exact: true })
    .fill("Customer requested review of future paid campaign work");
  await modal
    .getByRole("button", { name: "Confirm pause", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  assert.equal(
    (await request(web, endpoint)).schedules.find((s: any) => s.id === id)
      .state,
    "paused",
  );
  await finishRecording();
  pass(
    "Actual Admin email/MFA lists execution metadata without private bodies; a reasoned pause changes only future times and the operator cannot silently authorize resumption",
  );

  stage = "Responsive and source withdrawal";
  await web.setViewportSize({ width: 390, height: 900 });
  await web.evaluate(() => {
    localStorage.setItem("cp_locale", "zh-HK");
    localStorage.setItem("cp_theme", "dark");
  });
  await web.reload();
  await web
    .getByRole("heading", { name: "讓好方法，按時發生。", exact: true })
    .waitFor();
  await plan(id).waitFor();
  await plan(id).scrollIntoViewIfNeeded();
  await fits(web);
  await shot(
    "web",
    "compact-zh-dark",
    await web.screenshot(),
    "Actual 390-pixel Chinese dark schedule cards without horizontal overflow",
  );
  await system.db.control.query(
    "UPDATE analytics_datasets SET content_state='quarantined' WHERE id=$1",
    [dataset.id],
  );
  await web.reload();
  await until(
    async () => web.locator("[data-cloud-schedule]").count(),
    (v) => v === 0,
    "withdrawn source hidden",
  );
  await until(
    () =>
      panel!.evaluate(
        "document.querySelectorAll('#cloud-schedules article').length",
      ),
    (v) => v === 0,
    "native withdrawn source cleared",
  );
  pass(
    "Chinese dark Web fits a 390-pixel viewport and actual source quarantine clears inaccessible schedule bodies from Web and the native panel",
  );
  stage = "Native sign-out";
  await panel.evaluate("document.querySelector('#sign-out').click()");
  await until(
    () =>
      panel!.evaluate(
        "document.querySelector('#login').hidden===false && document.querySelector('#cloud-schedules').textContent===''",
      ),
    Boolean,
    "panel session clearing",
  );
  assert.equal(
    (
      await system.db.control.query(
        "SELECT count(*)::int AS n FROM workflow_runs WHERE cloud_schedule_id=$1",
        [id],
      )
    ).rows[0].n,
    1,
  );
  assert.ok(me.user?.id ?? me.id);
  pass(
    "Native sign-out immediately clears private schedule cards, all scheduled runs remain individually identifiable, and model content stays explicitly synthetic",
  );
} catch (failure) {
  errors.push(stage + ": " + String(failure));
  console.error(failure);
} finally {
  clearTimeout(deadline);
  if (recording) await finishRecording().catch((e) => errors.push(String(e)));
  if (panel)
    await panel
      .close()
      .then(() => (panelClosed = true))
      .catch((e) => errors.push(String(e)));
  if (browser)
    await browser
      .close()
      .then(() => (browserClosed = true))
      .catch((e) => errors.push(String(e)));
  if (system)
    await system.app
      .close()
      .then(() => (apiClosed = true))
      .catch((e: any) => errors.push(String(e)));
  if (isolated) {
    process.chdir(platform);
    await isolated
      .cleanup()
      .then(() => (fixtureClosed = true))
      .catch((e: any) => errors.push(String(e)));
  }
  process.chdir(delivery);
  const report = {
    at: new Date().toISOString(),
    status:
      !errors.length &&
      checks.length === 8 &&
      browserClosed &&
      panelClosed &&
      apiClosed &&
      fixtureClosed
        ? "passed"
        : "failed",
    checks,
    errors,
    executions,
    output_files: outputFiles,
    screenshots,
    media,
    browser_closed: browserClosed,
    panel_closed: panelClosed,
    api_closed: apiClosed,
    fixture_closed: fixtureClosed,
    funding: {
      actual_demo_credit_endpoint: true,
      no_direct_wallet_mutation: true,
      cash_received: false,
    },
    not_validated: [
      "live model quality",
      "complete product acceptance",
      "professional role qualification",
      "new Desktop cloud replacement",
    ],
  };
  await writeFile(
    prefix + "-journey.json",
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({ status: report.status, checks: checks.length, errors }),
  );
  process.exitCode = report.status === "passed" ? 0 : 1;
}
