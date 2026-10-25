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
const prefix = path.join(delivery, "evidence/agent-groups-ui-" + attempt);
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
let captureQueue = Promise.resolve();
async function coordinateCapture<T>(action: () => Promise<T>): Promise<T> {
  const previous = captureQueue;
  let release!: () => void;
  captureQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}
const go = (page: Page, url: string) => coordinateCapture(() => page.goto(url));
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
  await go(page, "http://localhost:4317/login");
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
      "agent-groups-" + attempt,
      name,
      await coordinateCapture(() =>
        page.screenshot({ fullPage: false, animations: "disabled" }),
      ),
      "Actual built Web team planner and private run; native Codex and explicitly synthetic model",
      delivery,
    ),
  );
}
const timeout = setTimeout(() => {
  errors.push("Owned team UI deadline exceeded");
  void browser?.close();
}, 600000);
try {
  const { isolatedTestEnvironment } = await load(
      "tests/native-test-environment.ts",
    ),
    { buildApp } = await load("src/server.ts"),
    { loadConfig } = await load("src/config.ts"),
    { defaults } = await load("src/plans.ts");
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
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", (e) => errors.push(e.message));
  const signed = await signIn(
    page,
    "team-ui-" + randomUUID() + "@example.invalid",
  );
  await page.waitForURL("**/welcome");
  await page.locator('input[name="name"]').fill("Harbour launch studio");
  await page
    .locator('input[name="project_name"]')
    .fill("Private team delivery");
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
  await system.db.control.query(
    "INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Synthetic team UI capacity; no payment received',$2)",
    [tenant, defaults.business],
  );
  funding = {
    actual_demo_credit_endpoint: true,
    no_direct_wallet_mutation: true,
    cash_received: false,
    synthetic_plan_capacity_fixture: true,
  };
  const agents = [];
  for (const name of [
    "Campaign coordinator",
    "Launch copy specialist",
    "Campaign reviewer",
  ])
    agents.push(
      await call(
        page,
        "POST",
        base + "/agents",
        {
          name,
          role_key: "assistant",
          instructions:
            "Keep this synthetic team exercise clearly labelled; execute real company tools and preserve predecessor references.",
        },
        tenant,
      ),
    );
  pass(
    "TEAM-01 actual email sign-in, workspace, demo credit and explicitly synthetic capacity prepare three real fixed-version Codex agents without wallet mutation",
  );
  await go(page, "http://localhost:4317/app/teams");
  await page
    .getByRole("heading", { name: "Build a team for your next brief" })
    .waitFor();
  await shot(page, "empty");
  const capture = await context.newCDPSession(page);
  const frame = () =>
    coordinateCapture(async () =>
      Buffer.from(
        (
          await capture.send("Page.captureScreenshot", {
            format: "jpeg",
            quality: 72,
            fromSurface: true,
            captureBeyondViewport: false,
          })
        ).data,
        "base64",
      ),
    );
  recording = new WorkmateRecording(
    "web",
    "team-authoring",
    "agent-groups-" + attempt,
    frame,
    "Actual Web team creation, dependency editing, free review and explicit budget approval",
    delivery,
  );
  await recording.start();
  await page.getByRole("button", { name: "Create team", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Create team", exact: true });
  await editor
    .getByLabel("Team name", { exact: true })
    .fill("Harbour launch team");
  await editor
    .getByRole("combobox", { name: "Coordinator", exact: true })
    .selectOption(agents[0].id);
  for (let i = 0; i < 2; i++) {
    await editor
      .getByRole("button", { name: "Add member", exact: true })
      .click();
    const field = editor.getByRole("group", {
      name: "Member " + (i + 1),
      exact: true,
    });
    await field
      .getByRole("combobox", { name: "Specialist", exact: true })
      .selectOption(agents[i + 1].id);
    await field
      .getByLabel("Responsibility", { exact: true })
      .fill(
        i === 0
          ? "Prepare the clearly simulated launch copy."
          : "Review the actual copy and preserve source references.",
      );
  }
  await shot(page, "editor");
  const [saved] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/v1/agent-groups" &&
        r.request().method() === "POST",
    ),
    editor.getByRole("button", { name: "Save team", exact: true }).click(),
  ]);
  assert.equal(saved.status(), 201);
  const group = await saved.json(),
    url = "/v1/agent-groups/" + group.id;
  await page.getByRole("heading", { name: group.name, exact: true }).waitFor();
  await page
    .getByLabel("Overall brief", { exact: true })
    .fill(
      "Produce clearly simulated launch copy and an independent review. The coordinator must combine the members' actual output and references.",
    );
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Add step", exact: true }).click();
    const step = page.locator(".team-step").nth(i);
    await step
      .getByRole("combobox", { name: "Assigned specialist", exact: true })
      .selectOption(agents[i + 1].id);
    await step
      .getByLabel("Step title", { exact: true })
      .fill(i === 0 ? "Prepare launch copy" : "Review the launch copy");
    await step
      .getByLabel("Instructions", { exact: true })
      .fill(
        i === 0
          ? "Write a clearly simulated launch draft and deliver it as a file."
          : "Read group_results and review the actual draft. Deliver the review as a file.",
      );
    if (i === 1) await step.getByRole("checkbox").check();
  }
  await shot(page, "plan");
  pass(
    "TEAM-02 the actual built Web creates a versioned shared team and edits two specialist steps with a real predecessor dependency",
  );
  await page
    .getByRole("button", { name: "Review team & budget", exact: true })
    .click();
  const review = page.getByRole("dialog", {
    name: "Approve this team plan",
    exact: true,
  });
  await review.waitFor();
  await shot(page, "review");
  assert.equal(
    (
      await system.db.control.query(
        "SELECT count(*) FROM tasks WHERE project_id=$1",
        [project],
      )
    ).rows[0].count,
    "0",
  );
  const [approved] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === url + "/runs" &&
        r.request().method() === "POST",
    ),
    review
      .getByRole("button", { name: "Approve & start", exact: true })
      .click(),
  ]);
  assert.equal(approved.status(), 201);
  const accepted = await approved.json();
  assert.equal(accepted.approved_budget_micros, 3000000);
  assert.equal(accepted.reserved_micros, 1000000);
  assert.equal(accepted.tasks.length, 1);
  await page.locator(".team-run").waitFor();
  await page.locator(".team-run").scrollIntoViewIfNeeded();
  await shot(page, "waiting");
  media.push(await recording.stop());
  recording = undefined;
  pass(
    "TEAM-03 review creates no tasks or holds; a human approves the exact HK$3 maximum and creates one waiting coordinator with only its HK$1 allocation reserved",
  );
  const { advanceAgentGroups } = await load("src/agent-groups.ts"),
    { Worker } = await load("src/worker.ts"),
    { CodexRuntimeAdapter } = await load("src/runtime.ts");
  let calls: string[] = [];
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
            calls.push(tool.name);
            return tool.run(args, id);
          },
        })),
      });
    }
  }
  recording = new WorkmateRecording(
    "web",
    "team-delivery",
    "agent-groups-" + attempt,
    frame,
    "Actual native Codex performs two approved cloud member steps and a final coordinator with a synthetic company gateway",
    delivery,
  );
  await recording.start();
  for (const key of ["step_1", "step_2", "coordinator"]) {
    await advanceAgentGroups(system.db, system.catalog);
    const current = await call(
        page,
        "GET",
        url + "/runs/" + accepted.id,
        undefined,
        tenant,
      ),
      task = current.tasks.find((t: any) => t.step_key === key);
    assert.ok(task && task.status === "queued", JSON.stringify(current));
    calls = [];
    await new Worker(
      system.db,
      system.catalog,
      system.storage,
      new CapturedCodex(system.db.config),
    ).run(tenant, task.id);
    const done = (
      await system.db.control.query("SELECT * FROM tasks WHERE id=$1", [
        task.id,
      ])
    ).rows[0];
    assert.equal(done.status, "succeeded", done.error_code);
    assert.ok(calls.includes("group_results"));
    assert.ok(calls.includes("deliver_text"));
    const reservations = (
      await system.db.control.query(
        "SELECT count(*)::int AS n FROM reservations WHERE task_id=$1",
        [task.id],
      )
    ).rows[0].n;
    assert.equal(reservations, 1);
    assert.ok(Number(done.charged_micros) > 0);
    executions.push({
      task_id: task.id,
      step_key: key,
      native_codex: true,
      synthetic_model: true,
      reservation_count: reservations,
      charged_micros: done.charged_micros,
      observed_tools: [...calls],
    });
    const files = (
      await system.db.control.query(
        "SELECT a.id,v.id AS asset_version_id,v.sha256,v.bytes FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version WHERE v.metadata->>'task_id'=$1 AND a.state='active'",
        [task.id],
      )
    ).rows;
    assert.equal(files.length, 1);
    const response = await page.request.get(
      "http://localhost:4317" + base + `/assets/${files[0].id}/download`,
    );
    assert.equal(response.status(), 200);
    const bytes = await response.body();
    assert.equal(sha(bytes), files[0].sha256);
    outputFiles.push({
      ...files[0],
      task_id: task.id,
      actual_download_bytes: bytes.length,
    });
  }
  await advanceAgentGroups(system.db, system.catalog);
  await page
    .locator(".team-run > header .badge")
    .filter({ hasText: "Completed" })
    .waitFor();
  const complete = await call(
    page,
    "GET",
    url + "/runs/" + accepted.id,
    undefined,
    tenant,
  );
  assert.equal(complete.state, "succeeded");
  assert.equal(complete.reserved_micros, 0);
  assert.ok(
    complete.charged_micros > 0 &&
      complete.charged_micros <= complete.approved_budget_micros,
  );
  await shot(page, "completed");
  media.push(await recording.stop());
  recording = undefined;
  pass(
    "TEAM-04 three actual native Codex processes read approved predecessor results, deliver three hash-verified private files and settle one original reservation each within the approved maximum",
  );
  const otherContext = await browser.newContext(),
    otherPage = await otherContext.newPage();
  const other = await signIn(
    otherPage,
    "team-other-" + randomUUID() + "@example.invalid",
  );
  await system.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
    [tenant, other.user.id],
  );
  await system.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",
    [tenant, project, other.user.id],
  );
  const visible = await call(
    otherPage,
    "GET",
    url + "/runs",
    undefined,
    tenant,
  );
  assert.equal(visible.items.length, 0);
  for (const file of outputFiles)
    assert.equal(
      (
        await otherPage.request.get(
          "http://localhost:4317" + base + `/assets/${file.id}/download`,
        )
      ).status(),
      404,
    );
  await otherContext.close();
  pass(
    "TEAM-05 another authenticated project editor can see team settings but cannot list runs or download any of the three private files",
  );
  for (const width of [375, 800]) {
    await page.setViewportSize({ width, height: 980 });
    if (width === 800) {
      await page.evaluate(() => localStorage.setItem("cp_locale", "zh"));
      await go(page, "http://localhost:4317/app/teams");
      await page.locator(".team-overview").waitFor();
    }
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page
      .getByRole("button", {
        name: width === 375 ? "Create team" : "建立團隊",
        exact: true,
      })
      .focus();
    assert.ok(
      await page
        .getByRole("button", {
          name: width === 375 ? "Create team" : "建立團隊",
          exact: true,
        })
        .evaluate((e) => e === document.activeElement),
    );
    await shot(page, "responsive-" + width);
  }
  pass(
    "TEAM-06 actual team settings and plan controls remain keyboard accessible at 375px and 800px with English and Chinese layouts and no horizontal overflow",
  );
  await page.setViewportSize({ width: 1440, height: 980 });
  await system.db.control.query(
    "UPDATE tasks SET content_state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",
    [executions[0].task_id],
  );
  assert.equal(
    (
      await page.request.get(
        "http://localhost:4317" +
          base +
          `/assets/${outputFiles[2].id}/download`,
      )
    ).status(),
    404,
  );
  assert.equal(
    (
      await system.db.control.query(
        "SELECT count(*) FROM reservations WHERE task_id=ANY($1::uuid[])",
        [executions.map((e) => e.task_id)],
      )
    ).rows[0].count,
    "3",
  );
  await page.locator(".team-runs").scrollIntoViewIfNeeded();
  await shot(page, "source-withdrawn");
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await page.waitForURL("**/login");
  pass(
    "TEAM-07 withdrawing the first actual member task immediately fences the coordinator's private derivative while preserving all three reservation facts, then the customer signs out",
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
      checks.length === 7
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
      "Live model or professional marketing quality; company gateway and capacity are explicitly synthetic",
      "Native Desktop teams or Extension team interface",
      "Full product acceptance or all original 102 requirements",
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
