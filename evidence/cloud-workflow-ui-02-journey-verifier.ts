import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import {
  WorkmateRecording,
  saveWorkmateScreenshot,
} from "./record-workmate-media.js";

const delivery = process.cwd(),
  platform = path.resolve("../copypaste-platform"),
  attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const prefix = path.join(delivery, "evidence/cloud-workflow-ui-" + attempt);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const checks: string[] = [],
  errors: string[] = [],
  screenshots: any[] = [],
  media: any[] = [],
  executions: any[] = [],
  outputFiles: any[] = [];
let isolated: any,
  system: any,
  browser: Browser | undefined,
  recording: WorkmateRecording | undefined;
let browserClosed = false,
  apiClosed = false,
  fixtureClosed = false,
  funding: any;
const pass = (name: string) => {
  checks.push(name);
  console.log("PASS: " + name);
};
const load = (file: string) =>
  import(pathToFileURL(path.join(platform, file)).href);
async function call(
  page: Page,
  method: string,
  url: string,
  body?: unknown,
  tenant?: string,
) {
  const result = await page.evaluate(
    async ({ method, url, body, tenant }) => {
      const session = await (await fetch("/v1/session/context")).json();
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrf_token,
          "Idempotency-Key": crypto.randomUUID(),
          ...(tenant ? { "X-Tenant-ID": tenant } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    },
    { method, url, body, tenant },
  );
  assert.ok(
    result.status >= 200 && result.status < 300,
    `${method} ${url}: ${result.status} ${JSON.stringify(result.body)}`,
  );
  return result.body;
}
async function signIn(page: Page, email: string) {
  await page.goto("http://localhost:4317/login");
  await page.locator('input[name="email"]').fill(email);
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/v1/auth/challenges",
    ),
    page.locator('form button[type="submit"]').click(),
  ]);
  assert.equal(response.status(), 202);
  const challenge = await response.json(),
    mail = JSON.parse(
      await readFile(
        path.join(
          isolated.directory,
          "mailbox",
          challenge.challenge_id + ".json",
        ),
        "utf8",
      ),
    );
  await page
    .locator('input[name="code"]')
    .fill(mail.text.match(/\b\d{6}\b/)[0]);
  const [verified] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/v1/auth/sessions" &&
        r.request().method() === "POST",
    ),
    page.locator('form button[type="submit"]').click(),
  ]);
  assert.equal(verified.status(), 201);
  return verified.json();
}
async function shot(page: Page, name: string) {
  screenshots.push(
    await saveWorkmateScreenshot(
      "web",
      "cloud-workflow-" + attempt,
      name,
      await page.screenshot({ fullPage: false, animations: "disabled" }),
      "Actual built Web or actual downloaded self-contained analysis HTML; native Codex and explicitly synthetic model/account data",
      delivery,
    ),
  );
}
const timeout = setTimeout(() => {
  errors.push("Owned analysis UI deadline exceeded");
  void browser?.close();
}, 600000);
try {
  const { isolatedTestEnvironment } = await load(
      "tests/native-test-environment.ts",
    ),
    { buildApp } = await load("src/server.ts"),
    { loadConfig } = await load("src/config.ts");
  process.chdir(platform);
  isolated = await isolatedTestEnvironment();
  system = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEV_MAILBOX: "true",
      WORKER_ENABLED: "false",
      DEMO_MODE: "true",
    }),
    { worker: false },
  );
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN,
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 980 },
    acceptDownloads: true,
  });
  await context.addInitScript(() => {
    if (!localStorage.getItem("cp_locale"))
      localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  const signed = await signIn(
    page,
    "cloud-workflow-" + randomUUID() + "@example.invalid",
  );
  await page.waitForURL("**/welcome");
  await page.locator('input[name="name"]').fill("Harbour campaign studio");
  await page
    .locator('input[name="project_name"]')
    .fill("Evidence and creative review");
  const [created] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/v1/tenants" &&
        r.request().method() === "POST",
    ),
    page
      .getByRole("button", { name: "Create workspace & continue", exact: true })
      .click(),
  ]);
  assert.equal(created.status(), 200);
  const workspace = await created.json(),
    tenant = workspace.tenant.id,
    project = workspace.project.id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  await page.waitForURL("**/app");
  await call(page, "POST", `/v1/tenants/${tenant}/demo-credit`, {}, tenant);
  funding = {
    actual_demo_credit_endpoint: true,
    no_direct_wallet_mutation: true,
    cash_received: false,
  };
  for (const [name, account, currency, channel] of [
    ["Harbour search", "Google-HK", "HKD", "Google"],
    ["Harbour social", "Meta-US", "USD", "Meta"],
  ]) {
    await call(
      page,
      "POST",
      base + "/analytics/import",
      {
        name,
        currency,
        account_id: account,
        attribution_definition: "7d click",
        conversion_definition: "Purchase",
        csv: `date,channel,campaign,impressions,clicks,spend,conversions,revenue,currency\n2026-10-01,${channel},Launch,100,10,10,1,20,${currency}\n2026-10-02,${channel},Launch,1000,200,90,3,180,${currency}`,
      },
      tenant,
    );
  }
  pass(
    "WORKFLOW-01 canonical email sign-in, first workspace and real import endpoints prepare declared synthetic customer data without direct wallet mutation",
  );
  await page.goto("http://localhost:4317/app/roles");
  await page.locator('[data-template-role="workflow-consultant"]').waitFor();
  await shot(page, "directory-en");
  const directory = await call(
    page,
    "GET",
    "/v1/agent-templates?project_id=" + project,
    undefined,
    tenant,
  );
  const roles = ["workflow-consultant"];
  for (const role of roles) {
    const template = directory.items.find((t: any) => t.role_key === role);
    assert.equal(template.qualification_state, "unverified");
    const preflight = await call(
      page,
      "POST",
      `/v1/agent-templates/${template.id}/preflights`,
      { project_id: project, template_version: template.version },
      tenant,
    );
    assert.equal(preflight.state, "ready", JSON.stringify(preflight));
  }
  pass(
    "WORKFLOW-02 the versioned workflow role template pass real dependency preflights while retaining their unverified professional qualification",
  );

  let activePage = page;
  recording = new WorkmateRecording(
    "web",
    "cloud-workflow-prepare",
    "cloud-workflow-" + attempt,
    () => activePage.screenshot({ type: "jpeg", quality: 72 }),
    "Actual private consultant creation, native Codex tools, fixed workflow request, explicit budget review and private summary download; synthetic model",
    delivery,
  );
  await recording.start();
  await page.locator('[data-template-role="workflow-consultant"]').click();
  let modal = page.getByRole("dialog");
  await modal
    .getByLabel("Specialist name", { exact: true })
    .fill("Harbour workflow consultant");
  await modal
    .getByRole("button", { name: "Check availability", exact: true })
    .click();
  await modal
    .getByRole("button", { name: "Create this specialist", exact: true })
    .waitFor();
  await shot(page, "role-ready-en");
  await modal
    .getByRole("button", { name: "Create this specialist", exact: true })
    .click();
  await page.waitForURL("**/app/specialists");
  await page
    .locator(".specialist-card")
    .filter({
      has: page.getByRole("heading", {
        name: "Harbour workflow consultant",
        exact: true,
      }),
    })
    .getByRole("button", { name: "Start conversation", exact: true })
    .click();
  await page.waitForURL("**/app/conversations/*");
  const conversation = page.url().split("/").at(-1)!;
  const { CodexRuntimeAdapter } = await load("src/runtime.ts"),
    { Worker } = await load("src/worker.ts");
  let currentCalls: string[] = [];
  class CapturedCodex extends CodexRuntimeAdapter {
    constructor(config: any) {
      super(config);
    }
    async start(ctx: any) {
      return super.start({
        ...ctx,
        tools: ctx.tools.map((t: any) => ({
          ...t,
          run: async (a: any, id: string) => {
            currentCalls.push(t.name);
            return t.run(a, id);
          },
        })),
      });
    }
  }

  const { advanceCloudWorkflows } = await load("src/cloud-workflows.ts");
  const runTask = async (prompt: string) => {
    currentCalls = [];
    await page.locator('select[name="mode"]').selectOption("execute");
    await page.getByLabel("Your message", { exact: true }).fill(prompt);
    const [sent] = await Promise.all([
      page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname ===
            base + `/conversations/${conversation}/messages` &&
          r.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Delegate task", exact: true }).click(),
    ]);
    assert.equal(sent.status(), 200);
    const accepted = await sent.json();
    await new Worker(
      system.db,
      system.catalog,
      system.storage,
      new CapturedCodex(system.db.config),
    ).run(tenant, accepted.task.id);
    const task = await call(
      page,
      "GET",
      base + "/tasks/" + accepted.task.id,
      undefined,
      tenant,
    );
    assert.equal(
      task.status,
      "succeeded",
      JSON.stringify({ task, tools: currentCalls }),
    );
    const receipts = (
      await system.db.control.query(
        "SELECT result FROM task_tool_receipts WHERE task_id=$1 AND tool_name='workflow_run'",
        [task.id],
      )
    ).rows;
    assert.equal(receipts.length, 1);
    assert.equal(
      (
        await system.db.control.query(
          "SELECT count(*)::int AS n FROM reservations WHERE task_id=$1",
          [task.id],
        )
      ).rows[0].n,
      1,
    );
    const execution = {
      task_id: task.id,
      native_codex: true,
      synthetic_model: true,
      tools: [...currentCalls],
      charged_micros: task.charged_micros,
      reservation_count: 1,
      output: receipts[0].result,
    };
    executions.push(execution);
    return execution;
  };
  const original = await runTask(
    "Prepare a clearly simulated campaign workflow: calculate the authorized campaign summary, wait for my review, then write a short review note. Save the fixed private version and request my confirmation before any child work.",
  );
  assert.deepEqual(original.tools, [
    "analysis_sources",
    "workflow_validate",
    "workflow_save",
    "workflow_publish",
    "workflow_run",
  ]);
  await page.reload();
  await page.getByLabel("Your message", { exact: true }).waitFor();
  await shot(page, "native-codex-conversation");
  pass(
    "WORKFLOW-03 actual pinned native Codex loads the fixed consultant Skills and prepares one immutable private workflow request; no child task or reservation exists before customer approval",
  );
  let runId = original.output.run.id;
  const listing = async () =>
    call(page, "GET", base + "/cloud-workflows", undefined, tenant);
  const tick = () =>
    advanceCloudWorkflows(system.db, system.catalog, system.storage);
  await page.goto("http://localhost:4317/app/workflows");
  const section = page.getByRole("region", {
    name: "My private cloud workflows",
    exact: true,
  });
  const card = (id: string) => page.locator(`[data-workflow-run="${id}"]`);
  await card(runId).waitFor();
  await card(runId).scrollIntoViewIfNeeded();
  await shot(page, "pending-request");
  await card(runId)
    .getByRole("button", { name: "Review & start", exact: true })
    .click();
  modal = page.getByRole("dialog");
  await modal
    .getByText("Budget limit for all Agent steps", { exact: true })
    .waitFor();
  assert.match(await modal.innerText(), /HK\$0\.10/);
  const confirm = modal.getByRole("button", {
    name: "Confirm & continue",
    exact: true,
  });
  await confirm.click();
  assert.equal((await listing()).runs[0].authorized, false);
  assert.equal(
    (
      await system.db.control.query(
        "SELECT count(*)::int AS n FROM tasks WHERE cloud_workflow_run_id=$1",
        [runId],
      )
    ).rows[0].n,
    0,
  );
  await shot(page, "budget-confirmation");
  await modal.getByRole("checkbox").check();
  await confirm.click();
  await modal.waitFor({ state: "hidden" });
  await tick();
  await tick();
  await section.getByRole("button", { name: "Refresh", exact: true }).click();
  await card(runId)
    .getByRole("button", { name: "Review & continue", exact: true })
    .waitFor();
  await shot(page, "human-review");
  pass(
    "WORKFLOW-04 actual confirmation dialog displays the fixed steps and separate child budget; an unchecked consent cannot start work and the human approval step stops before any Codex child is charged",
  );
  await card(runId).locator("summary").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    card(runId)
      .getByRole("button", { name: "Download summary", exact: true })
      .click(),
  ]);
  const file = prefix + "-summary.json";
  await download.saveAs(file);
  const summaryBytes = await readFile(file),
    summary = JSON.parse(summaryBytes.toString());
  assert.equal(
    summary.snapshot_id,
    original.output.definition.steps[0].dataset_id,
  );
  assert.equal(
    summary.currency,
    (
      await system.db.control.query(
        "SELECT currency FROM analytics_datasets WHERE id=$1",
        [summary.snapshot_id],
      )
    ).rows[0].currency,
  );
  assert.ok(summary.snapshot_id && summary.metrics);
  outputFiles.push({
    file: path.relative(delivery, file),
    bytes: summaryBytes.length,
    sha256: sha(summaryBytes),
  });
  const summaryResult = (await listing()).runs[0].results.find(
    (v: any) => v.kind === "analytics.summary",
  );
  assert.equal(
    (
      await system.db.control.query(
        "SELECT private_owner FROM assets WHERE id=$1",
        [summaryResult.asset_id],
      )
    ).rows[0].private_owner,
    signed.user.id,
  );
  pass(
    "WORKFLOW-05 the actual customer clicks Download summary and receives byte-checked calculated JSON, bound to the fixed authorized dataset and private owner",
  );
  media.push(await recording.stop());
  recording = undefined;
  recording = new WorkmateRecording(
    "web",
    "cloud-workflow-review",
    "cloud-workflow-" + attempt,
    () => activePage.screenshot({ type: "jpeg", quality: 72 }),
    "Actual human continuation, native Codex child, exact settlement, private file delivery, immutable procedure revision and responsive review; synthetic model",
    delivery,
  );
  await recording.start();
  await card(runId)
    .getByRole("button", { name: "Review & continue", exact: true })
    .click();
  modal = page.getByRole("dialog");
  await modal.getByRole("checkbox").check();
  await modal
    .getByRole("button", { name: "Confirm & continue", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  await tick();
  let live = (await listing()).runs[0];
  assert.ok(live.active_task);
  currentCalls = [];
  await new Worker(
    system.db,
    system.catalog,
    system.storage,
    new CapturedCodex(system.db.config),
  ).run(tenant, live.active_task);
  const child = await call(
    page,
    "GET",
    base + "/tasks/" + live.active_task,
    undefined,
    tenant,
  );
  assert.equal(child.status, "succeeded", JSON.stringify(child));
  assert.deepEqual(currentCalls, ["deliver_text"]);
  assert.equal(
    (
      await system.db.control.query(
        "SELECT count(*)::int AS n FROM reservations WHERE task_id=$1",
        [child.id],
      )
    ).rows[0].n,
    1,
  );
  executions.push({
    task_id: child.id,
    native_codex: true,
    synthetic_model: true,
    tools: [...currentCalls],
    charged_micros: child.charged_micros,
    reservation_count: 1,
    output: { actual_child: true },
  });
  await tick();
  live = (await listing()).runs[0];
  assert.equal(live.state, "succeeded");
  await section.getByRole("button", { name: "Refresh", exact: true }).click();
  await card(runId)
    .getByText("Specialist work completed", { exact: true })
    .waitFor();
  await shot(page, "completed-delivery");
  const artifact = (
    await system.db.control.query(
      "SELECT a.id,v.sha256,v.mime_type FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version WHERE v.metadata->>'task_id'=$1",
      [child.id],
    )
  ).rows[0];
  const note = await page.request.get(base + `/assets/${artifact.id}/download`);
  assert.equal(note.status(), 200);
  const noteBytes = await note.body();
  assert.equal(sha(noteBytes), artifact.sha256);
  await writeFile(prefix + "-review-note.md", noteBytes, { flag: "wx" });
  outputFiles.push({
    file: path.relative(delivery, prefix + "-review-note.md"),
    bytes: noteBytes.length,
    sha256: sha(noteBytes),
  });
  pass(
    "WORKFLOW-06 actual second approval queues exactly one private cloud child; pinned native Codex creates its real note and the page shows succeeded step receipts and actual single settlement",
  );
  const originalVersion = (
    await system.db.control.query(
      "SELECT definition,definition_hash FROM workflow_versions WHERE workflow_id=$1 AND version=1",
      [original.output.run.workflow_id],
    )
  ).rows[0];
  await page.goto("http://localhost:4317/app/conversations/" + conversation);
  await page.getByLabel("Your message", { exact: true }).waitFor();
  const revised = await runTask(
    `Revise the approval instructions, preserve the first version and prepare another pending request. workflow_revision_id=${original.output.run.workflow_id}`,
  );
  assert.equal(revised.output.run.version, 2);
  assert.deepEqual(
    (
      await system.db.control.query(
        "SELECT definition,definition_hash FROM workflow_versions WHERE workflow_id=$1 AND version=1",
        [original.output.run.workflow_id],
      )
    ).rows[0],
    originalVersion,
  );
  assert.equal(
    (
      await system.db.control.query(
        "SELECT state,workflow_version FROM workflow_runs WHERE id=$1",
        [runId],
      )
    ).rows[0].workflow_version,
    1,
  );
  await page.goto("http://localhost:4317/app/workflows");
  await card(revised.output.run.id).waitFor();
  await card(revised.output.run.id).scrollIntoViewIfNeeded();
  await shot(page, "revised-procedure");
  const otherContext = await browser.newContext(),
    otherPage = await otherContext.newPage();
  const outsider = await signIn(
    otherPage,
    "workflow-outsider-" + randomUUID() + "@example.invalid",
  );
  await system.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role,status) VALUES($1,$2,'member','active')",
    [tenant, outsider.user.id],
  );
  await system.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",
    [tenant, project, outsider.user.id],
  );
  const otherList = await call(
    otherPage,
    "GET",
    base + "/cloud-workflows",
    undefined,
    tenant,
  );
  assert.deepEqual(otherList.items, []);
  assert.deepEqual(otherList.runs, []);
  assert.equal(
    (
      await otherPage.request.get(
        base + `/assets/${summaryResult.asset_id}/download`,
      )
    ).status(),
    404,
  );
  await otherContext.close();
  pass(
    "WORKFLOW-07 actual Codex revision creates v2 and a separate pending request while v1 bytes/run remain unchanged; a verified project editor cannot list private workflows or download their private summary",
  );
  await page.evaluate(() => localStorage.setItem("cp_locale", "zh"));
  await page.reload();
  for (const width of [375, 800]) {
    await page.setViewportSize({ width, height: 900 });
    await card(revised.output.run.id)
      .getByRole("button", { name: "核對並開始", exact: true })
      .waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await card(revised.output.run.id).scrollIntoViewIfNeeded();
    await shot(page, "review-zh-" + width);
  }
  await page.setViewportSize({ width: 1440, height: 980 });
  await system.db.control.query(
    "UPDATE analytics_datasets SET content_state='quarantined' WHERE id=$1",
    [summary.snapshot_id],
  );
  assert.equal(
    (
      await page.request.get(
        base + `/assets/${summaryResult.asset_id}/download`,
      )
    ).status(),
    404,
  );
  assert.equal((await listing()).runs.length, 0);
  assert.equal(
    (
      await system.db.control.query(
        "SELECT count(*)::int AS n FROM reservations WHERE task_id=ANY($1::uuid[])",
        [executions.map((e) => e.task_id)],
      )
    ).rows[0].n,
    3,
  );
  media.push(await recording.stop());
  recording = undefined;
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await page.waitForURL("**/login");
  pass(
    "WORKFLOW-08 Traditional Chinese review works at 375/800px without horizontal overflow; source quarantine hides all derived workflow history/downloads while preserving actual billing receipts, and the customer signs out",
  );
} catch (error) {
  errors.push(String(error));
  console.error(error);
} finally {
  clearTimeout(timeout);
  if (recording)
    await recording
      .stop()
      .then((v) => media.push(v))
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
  const result = {
    at: new Date().toISOString(),
    status:
      !errors.length &&
      browserClosed &&
      apiClosed &&
      fixtureClosed &&
      checks.length === 8
        ? "passed"
        : "failed",
    checks,
    errors,
    funding,
    executions,
    output_files: outputFiles,
    screenshots,
    media,
    browser_closed: browserClosed,
    api_closed: apiClosed,
    fixture_closed: fixtureClosed,
    not_validated: [
      "Live model or media quality; this gateway is explicitly synthetic",
      "full professional role qualification",
      "complete product acceptance or all original 102 requirements",
    ],
  };
  await writeFile(
    prefix + "-journey.json",
    JSON.stringify(result, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({ status: result.status, checks: checks.length, errors }),
  );
  process.exitCode = result.status === "passed" ? 0 : 1;
}
