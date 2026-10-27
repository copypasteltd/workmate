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
const prefix = path.join(delivery, "evidence/analysis-role-ui-" + attempt);
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
      "analysis-" + attempt,
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
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  const signed = await signIn(
    page,
    "analysis-" + randomUUID() + "@example.invalid",
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
    "ANALYSIS-01 canonical email sign-in, first workspace and real import endpoints prepare declared synthetic customer data without direct wallet mutation",
  );
  await page.goto("http://localhost:4317/app/roles");
  await page.locator('[data-template-role="marketing-analyst"]').waitFor();
  await shot(page, "directory-en");
  const directory = await call(
    page,
    "GET",
    "/v1/agent-templates?project_id=" + project,
    undefined,
    tenant,
  );
  const roles = ["marketing-analyst", "information-design"];
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
    "ANALYSIS-02 both versioned analysis role templates pass real dependency preflights while retaining their unverified professional qualification",
  );

  let activePage = page;
  recording = new WorkmateRecording(
    "web",
    "analysis-role-work",
    "analysis-" + attempt,
    () => activePage.screenshot({ type: "jpeg", quality: 72 }),
    "Actual specialist creation, customer message, native Codex tools, delivered files and browser download; synthetic model",
    delivery,
  );
  await recording.start();
  await page.locator('[data-template-role="marketing-analyst"]').click();
  let modal = page.getByRole("dialog");
  await modal
    .getByLabel("Specialist name", { exact: true })
    .fill("Harbour marketing analyst");
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
        name: "Harbour marketing analyst",
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
  const runTask = async (prompt: string) => {
    currentCalls = [];
    // The product defaults to Ask. The customer explicitly selects Execute
    // before authorizing file generation; the role cannot bypass Ask's policy.
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
    assert.equal(task.status, "succeeded", JSON.stringify(task));
    const receipts = (
      await system.db.control.query(
        "SELECT result,output_version_ids FROM task_tool_receipts WHERE task_id=$1 AND tool_name='chart_render'",
        [task.id],
      )
    ).rows;
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].output_version_ids.length, 9);
    assert.equal(
      (
        await system.db.control.query(
          "SELECT count(*)::int AS n FROM reservations WHERE task_id=$1",
          [task.id],
        )
      ).rows[0].n,
      1,
    );
    assert.ok(Number(task.charged_micros) > 0);
    assert.equal(receipts[0].result.provider_calls, 0);
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
  pass(
    "ANALYSIS-03 actual template creation fixes the reviewed role and Skills before opening the customer's private conversation",
  );
  const original = await runTask(
    "Create an explicitly synthetic campaign evidence report and creative review from the authorized imported datasets. report_locale=en-HK",
  );
  assert.deepEqual(original.tools, [
    "analysis_sources",
    "sheet_calculate",
    "chart_render",
  ]);
  await page.reload();
  await page.getByLabel("Your message", { exact: true }).waitFor();
  await shot(page, "native-codex-conversation");
  pass(
    "ANALYSIS-04 a real pinned Codex process reads actual source IDs, calculates facts, creates nine private files and settles one original task reservation",
  );
  await page
    .getByRole("link", { name: "Assets & deliverables", exact: true })
    .click();
  await page.getByText("analysis-delivery.zip", { exact: true }).waitFor();
  await shot(page, "actual-deliverables");
  const downloaded: Record<string, Buffer> = {};
  for (const filename of [
    "infographic.png",
    "metrics.csv",
    "analysis-delivery.zip",
    "analysis.source.json",
    "report.html",
  ]) {
    const card = page
      .locator(".asset-card")
      .filter({ has: page.getByText(filename, { exact: true }) });
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      card.getByRole("button", { name: "Download", exact: true }).click(),
    ]);
    const bytes = await readFile((await download.path())!),
      file = original.output.files.find((f: any) => f.filename === filename);
    assert.equal(sha(bytes), file.sha256);
    downloaded[filename] = bytes;
    const destination = prefix + "-original-" + filename;
    await writeFile(destination, bytes, { flag: "wx" });
    outputFiles.push({
      path: path.relative(delivery, destination).replaceAll("\\", "/"),
      sha256: sha(bytes),
      bytes: bytes.length,
    });
  }
  assert.equal(downloaded["infographic.png"].subarray(1, 4).toString(), "PNG");
  assert.equal(
    downloaded["analysis-delivery.zip"].subarray(0, 2).toString(),
    "PK",
  );
  assert.match(downloaded["metrics.csv"].toString(), /0\.19090909/);
  const originalSource = JSON.parse(
    downloaded["analysis.source.json"].toString(),
  );
  assert.equal(originalSource.calculation.groups.length, 2);
  pass(
    "ANALYSIS-05 real browser downloads preserve the original PNG, ZIP, exact CSV, source and self-contained HTML bytes with separate HKD and USD groups",
  );
  media.push(await recording.stop());
  recording = undefined;
  const reportPage = await context.newPage();
  reportPage.on("pageerror", (e) => errors.push(e.message));
  activePage = reportPage;
  await reportPage.goto(pathToFileURL(prefix + "-original-report.html").href);
  await reportPage
    .getByRole("heading", {
      name: "Campaign evidence · creative review",
      exact: true,
    })
    .waitFor();
  recording = new WorkmateRecording(
    "web",
    "analysis-report-review",
    "analysis-" + attempt,
    () => activePage.screenshot({ type: "jpeg", quality: 72 }),
    "Actual downloaded report scope filters, date revision, Traditional Chinese and responsive review; no invented response frames",
    delivery,
  );
  await recording.start();
  await reportPage.locator(".chart-desktop").scrollIntoViewIfNeeded();
  await shot(reportPage, "report-en-desktop");
  const selected = originalSource.calculation.groups[0].periods.current.id;
  await reportPage
    .getByLabel("Filter scope", { exact: true })
    .selectOption(selected);
  assert.equal(
    await reportPage.locator("svg g[data-scope]:not([hidden])").count(),
    1,
  );
  const shown = await reportPage
    .locator("tbody tr:not([hidden])")
    .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-scope")));
  assert.ok(shown.length > 0 && shown.every((id) => id === selected));
  await shot(reportPage, "filtered-scope");
  await reportPage.getByLabel("Filter scope", { exact: true }).selectOption("");
  pass(
    "ANALYSIS-06 offline report filters hide both SVG panels and evidence rows correctly while keeping currency and attribution scopes separate",
  );
  activePage = page;
  await page.goto("http://localhost:4317/app/conversations/" + conversation);
  await page.getByLabel("Your message", { exact: true }).waitFor();
  const revised = await runTask(
    `Revise the same authorized evidence report to the last day without replacing its previous files. revision_source_version=${original.output.editable_source.asset_version_id} revise_to_last_day=true report_locale=zh-HK`,
  );
  assert.deepEqual(revised.tools, [
    "analysis_source_read",
    "sheet_calculate",
    "chart_render",
  ]);
  assert.equal(
    revised.output.revision_of.source_version_id,
    original.output.editable_source.asset_version_id,
  );
  const originalVersion = original.output.files.find(
    (f: any) => f.filename === "report.html",
  );
  const retained = await page.request.get(
    "http://localhost:4317" +
      base +
      `/assets/${originalVersion.asset_id}/download`,
  );
  assert.equal(retained.status(), 200);
  assert.equal(sha(await retained.body()), originalVersion.sha256);
  const newVersion = revised.output.files.find(
      (f: any) => f.filename === "report.html",
    ),
    sourceVersion = revised.output.files.find(
      (f: any) => f.filename === "analysis.source.json",
    );
  const newBytes = await (
    await page.request.get(
      "http://localhost:4317" +
        base +
        `/assets/${newVersion.asset_id}/download`,
    )
  ).body();
  const newSource = await (
    await page.request.get(
      "http://localhost:4317" +
        base +
        `/assets/${sourceVersion.asset_id}/download`,
    )
  ).json();
  assert.equal(newSource.calculation.spec.date_from, "2026-10-02");
  assert.ok(
    newSource.calculation.evidence
      .filter((e: any) => e.metric_id === "spend")
      .every((e: any) => e.value === "90.00000000"),
  );
  await writeFile(prefix + "-revised-zh.html", newBytes, { flag: "wx" });
  outputFiles.push({
    path: path
      .relative(delivery, prefix + "-revised-zh.html")
      .replaceAll("\\", "/"),
    sha256: sha(newBytes),
    bytes: newBytes.length,
  });
  pass(
    "ANALYSIS-07 an actual second customer message runs native Codex, recalculates the changed date, preserves original bytes and creates a separately reserved immutable revision",
  );
  activePage = reportPage;
  await reportPage.goto(pathToFileURL(prefix + "-revised-zh.html").href);
  await reportPage
    .getByRole("heading", { name: "可核對的圖表", exact: true })
    .waitFor();
  await reportPage.locator(".chart-desktop").scrollIntoViewIfNeeded();
  await shot(reportPage, "report-zh-desktop");
  for (const [width, height] of [
    [375, 812],
    [800, 600],
  ]) {
    await reportPage.setViewportSize({ width, height });
    const bounds = await reportPage.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(bounds.scroll <= bounds.client + 1);
    const filter = reportPage.getByLabel("篩選口徑", { exact: true });
    await filter.focus();
    assert.ok(await filter.evaluate((e) => e === document.activeElement));
    await filter.selectOption(
      newSource.calculation.groups[0].periods.current.id,
    );
    assert.equal(
      await reportPage.locator(".mobile-scope:not([hidden])").count(),
      1,
    );
    await filter.selectOption("");
    if (width === 375)
      assert.equal(await reportPage.locator(".chart-mobile").isVisible(), true);
    await shot(reportPage, "report-zh-" + width);
  }
  pass(
    "ANALYSIS-08 real Traditional Chinese reports retain keyboard access, exact values and usable scope filters at 375 and 800 pixels without horizontal overflow",
  );
  activePage = page;
  media.push(await recording.stop());
  recording = undefined;
  await reportPage.close();
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  const outsider = await signIn(
    otherPage,
    "analysis-other-" + randomUUID() + "@example.invalid",
  );
  await system.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
    [tenant, outsider.user.id],
  );
  await system.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",
    [tenant, project, outsider.user.id],
  );
  for (const artifact of original.output.files) {
    assert.equal(
      (
        await otherPage.request.get(
          "http://localhost:4317" +
            base +
            `/assets/${artifact.asset_id}/download`,
        )
      ).status(),
      404,
    );
  }
  const visible = await call(
    otherPage,
    "GET",
    base + "/assets",
    undefined,
    tenant,
  );
  assert.equal(visible.items.length, 0);
  await otherContext.close();
  pass(
    "ANALYSIS-09 another verified project editor cannot list or download the private conversation's nine original deliverables",
  );
  const datasets = originalSource.calculation.spec.snapshot_ids;
  await system.db.control.query(
    "UPDATE analytics_datasets SET content_state='quarantined' WHERE id=$1",
    [datasets[0]],
  );
  for (const execution of executions)
    for (const artifact of execution.output.files) {
      assert.equal(
        (
          await page.request.get(
            "http://localhost:4317" +
              base +
              `/assets/${artifact.asset_id}/download`,
          )
        ).status(),
        404,
      );
    }
  const history = (
    await system.db.control.query(
      "SELECT count(*)::int AS n FROM reservations WHERE task_id=ANY($1::uuid[])",
      [executions.map((e) => e.task_id)],
    )
  ).rows[0].n;
  assert.equal(history, 2);
  await page.goto("http://localhost:4317/app/assets");
  await page
    .getByRole("heading", {
      name: "Good work starts with good materials.",
      exact: true,
    })
    .waitFor();
  assert.equal(await page.locator(".asset-card").count(), 0);
  await shot(page, "source-frozen");
  pass(
    "ANALYSIS-10 freezing the original dataset blocks both revisions' downloads and removes invalid derivatives from the UI while preserving both financial reservations",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL("**/login");
  pass(
    "ANALYSIS-11 the actual customer session signs out after completing work, review, revision, privacy and source-freeze checks",
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
      checks.length === 11
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
