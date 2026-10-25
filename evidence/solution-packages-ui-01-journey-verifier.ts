import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";
import {
  WorkmateRecording,
  saveWorkmateScreenshot,
} from "./record-workmate-media.js";

const delivery = process.cwd(),
  platform = path.resolve("../copypaste-platform"),
  attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const prefix = path.join(delivery, "evidence/solution-packages-ui-" + attempt);
const OTPAuth = createRequire(path.join(platform, "package.json"))("otpauth");
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
async function shot(page: Page, name: string, kind: "web" | "admin" = "web") {
  screenshots.push(
    await saveWorkmateScreenshot(
      kind,
      "solution-packages-" + attempt,
      name,
      await coordinateCapture(() =>
        page.screenshot({ fullPage: false, animations: "disabled" }),
      ),
      "Actual built method library, fresh bindings and customer acceptance; native Codex with explicitly synthetic model",
      delivery,
    ),
  );
}
const timeout = setTimeout(() => {
  errors.push("Owned method UI deadline exceeded");
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
  });
  await context.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, "methods-" + randomUUID() + "@example.invalid");
  await page.waitForURL("**/welcome");
  await page.locator('input[name="name"]').fill("Harbour marketing studio");
  await page.locator('input[name="project_name"]').fill("Original campaign");
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
  pass(
    "SOLUTION-01 actual email sign-in, workspace onboarding and demo credit prepare the customer without a direct wallet mutation",
  );
  await go(page, "http://localhost:4317/app/assets");
  await page
    .getByRole("button", { name: "Upload material", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "approved-campaign.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "CAMPAIGN_SOURCE_96: Hong Kong local retail; approved offer HKD 280; reporting currency HKD. Synthetic customer brief.",
    ),
  });
  await dialog
    .getByRole("button", { name: "Upload or resume", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("heading", { name: "approved-campaign.txt", exact: true })
    .waitFor();
  await page
    .getByRole("link", { name: "Business methods", exact: true })
    .click();
  await page.waitForURL("**/app/solutions");
  await shot(page, "library-en");
  await page
    .getByRole("button", { name: "Create method", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .locator('[name="solution_name"]')
    .fill("Campaign evidence brief");
  await dialog
    .locator('[name="solution_instructions"]')
    .fill(
      "Read the approved campaign brief. Produce a concise evidence-grounded summary of the audience, offer and currency. Identify missing facts explicitly.",
    );
  await dialog
    .locator('[name="solution_requirements"]')
    .fill("Approved campaign brief");
  const [made] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/v1/solution-versions" &&
        r.request().method() === "POST",
    ),
    dialog
      .getByRole("button", { name: "Save method draft", exact: true })
      .click(),
  ]);
  assert.equal(made.status(), 201);
  const method = await made.json();
  await dialog.waitFor({ state: "hidden" });
  await page.locator(".solution-sheet-heading h2").waitFor();
  await shot(page, "draft-en");
  assert.equal(method.definition.agent_template_ids.length, 0);
  assert.deepEqual(method.definition.required_assets, [
    "Approved campaign brief",
  ]);
  pass(
    "SOLUTION-02 a real uploaded text file and UI-created immutable draft keep reusable instructions separate from private trial inputs",
  );
  await page
    .getByRole("button", { name: "Preview dependencies free", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Complete these requirements", exact: true })
    .waitFor();
  assert.equal(
    (
      await system.db.control.query(
        "SELECT count(*)::int n FROM reservations WHERE tenant_id=$1",
        [tenant],
      )
    ).rows[0].n,
    0,
  );
  await page
    .getByRole("combobox", {
      name: "Input: Approved campaign brief",
      exact: true,
    })
    .selectOption({ label: "approved-campaign.txt · v1" });
  await page
    .locator('[name="solution_brief"]')
    .fill(
      "Confirm the approved local offer and currency, preserving the source facts.",
    );
  await page.locator('[name="solution_budget"]').fill("2");
  await page
    .getByRole("button", { name: "Preview dependencies free", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Dependencies ready", exact: true })
    .waitFor();
  await shot(page, "preview-en");
  pass(
    "SOLUTION-03 free previews reveal missing inputs, then resolve the exact file hash, pinned roles and available task slots without a fee hold",
  );
  const pageCapture = await context.newCDPSession(page),
    capture = () =>
      coordinateCapture(async () =>
        Buffer.from(
          (
            await pageCapture.send("Page.captureScreenshot", {
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
    "method-review-and-publish",
    "solution-packages-" + attempt,
    capture,
    "Actual input review, lost trial acknowledgement, exact retry, native Codex delivery, customer acceptance and publication",
  );
  await recording.start();
  let lost: any,
    key = "",
    payload = "",
    sent = 0;
  await page.route(
    `**/v1/solution-versions/${method.id}/trials`,
    async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      sent++;
      if (sent === 1) {
        key = route.request().headers()["idempotency-key"];
        payload = route.request().postData()!;
        const response = await route.fetch();
        assert.equal(response.status(), 201);
        lost = await response.json();
        await route.abort("failed");
      } else {
        assert.equal(route.request().headers()["idempotency-key"], key);
        assert.equal(route.request().postData(), payload);
        await route.continue();
      }
    },
  );
  await page
    .getByRole("checkbox", {
      name: "I reviewed these inputs, all roles and the total budget, and approve this paid trial.",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Approve and start trial", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Retry original request", exact: true })
    .waitFor();
  await shot(page, "pending-retry");
  await coordinateCapture(() => page.reload());
  await page
    .getByRole("button", { name: "Retry original request", exact: true })
    .click();
  await page.locator(".solution-pending").waitFor({ state: "hidden" });
  await page.unroute(`**/v1/solution-versions/${method.id}/trials`);
  assert.equal(sent, 2);
  assert.ok(lost?.id);
  assert.equal(
    (
      await system.db.control.query(
        "SELECT count(*)::int n FROM solution_trials WHERE project_id=$1",
        [project],
      )
    ).rows[0].n,
    1,
  );
  pass(
    "SOLUTION-04 a lost paid-trial acknowledgement survives reload and retries the same key and body, leaving one trial, task and reservation",
  );
  const { CodexRuntimeAdapter } = await load("src/runtime.ts"),
    { Worker } = await load("src/worker.ts");
  let calls: string[] = [];
  class CapturedCodex extends CodexRuntimeAdapter {
    constructor(config: any) {
      super(config);
    }
    async start(ctx: any) {
      return super.start({
        ...ctx,
        tools: ctx.tools.map((v: any) => ({
          ...v,
          run: async (a: any, id: string) => {
            calls.push(v.name);
            return v.run(a, id);
          },
        })),
      });
    }
  }
  const execute = async (run: any, target: string) => {
    calls = [];
    await new Worker(
      system.db,
      system.catalog,
      system.storage,
      new CapturedCodex(system.db.config),
    ).run(tenant, run.tasks[0].task_id);
    const result = await call(
      page,
      "GET",
      `/v1/solution-trials/${run.id}`,
      undefined,
      tenant,
    );
    assert.equal(
      result.tasks[0].status,
      "succeeded",
      JSON.stringify({ tasks: result.tasks, calls }),
    );
    assert.deepEqual(result.unread_required_sources, []);
    assert.ok(calls.includes("solution_source_read"));
    const count = (
      await system.db.control.query(
        "SELECT count(*)::int n FROM reservations WHERE task_id=$1",
        [run.tasks[0].task_id],
      )
    ).rows[0].n;
    assert.equal(count, 1);
    assert.ok(result.tasks[0].charged_micros > 0);
    executions.push({
      task_id: run.tasks[0].task_id,
      project_id: target,
      native_codex: true,
      synthetic_model: true,
      reservation_count: count,
      charged_micros: result.tasks[0].charged_micros,
      tools: [...calls],
    });
    return result;
  };
  await execute(lost, project);
  await page
    .getByRole("checkbox", {
      name: "I checked each role's actual delivery and accept this trial.",
      exact: true,
    })
    .waitFor();
  await page
    .getByRole("checkbox", {
      name: "I checked each role's actual delivery and accept this trial.",
      exact: true,
    })
    .check();
  await shot(page, "delivered-en");
  await page
    .getByRole("button", { name: "Accept every trial delivery", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Publish accepted method", exact: true })
    .click();
  await page
    .locator(".solution-sheet-heading .badge")
    .filter({ hasText: "Published" })
    .waitFor();
  await shot(page, "published-en");
  media.push(await recording.stop());
  recording = undefined;
  pass(
    "SOLUTION-05 an actual pinned native Codex process reads approved source bytes, settles measured usage, and publishes only after the customer's exact-delivery acceptance",
  );
  const target = await call(
    page,
    "POST",
    `/v1/tenants/${tenant}/projects`,
    { name: "New customer campaign" },
    tenant,
  );
  await coordinateCapture(() => page.reload());
  await page
    .getByRole("combobox", { name: "Current project", exact: true })
    .selectOption(target.id);
  await page
    .getByRole("button", { name: "Install in this project", exact: true })
    .waitFor();
  recording = new WorkmateRecording(
    "web",
    "copy-rebind-and-trial",
    "solution-packages-" + attempt,
    capture,
    "Actual cross-project method installation, missing-input preview, target file upload, version-safe rebinding and separately metered trial",
  );
  await recording.start();
  const [installedResponse] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname ===
          `/v1/solution-versions/${method.id}/installations` &&
        r.request().method() === "POST",
    ),
    page
      .getByRole("button", { name: "Install in this project", exact: true })
      .click(),
  ]);
  assert.equal(installedResponse.status(), 201);
  const installed = await installedResponse.json();
  assert.equal(installed.state, "needs_configuration");
  await page
    .getByRole("button", { name: "Preview dependencies free", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Complete these requirements", exact: true })
    .waitFor();
  await shot(page, "installed-missing");
  assert.equal(
    (
      await call(
        page,
        "GET",
        `/v1/tenants/${tenant}/projects/${target.id}/assets`,
      )
    ).items.length,
    0,
  );
  await go(page, "http://localhost:4317/app/assets");
  await page
    .getByRole("button", { name: "Upload material", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "new-customer-brief.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "NEW_CUSTOMER_96: Hong Kong office team; approved budget HKD 420; no source customer content copied.",
    ),
  });
  await dialog
    .getByRole("button", { name: "Upload or resume", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("heading", { name: "new-customer-brief.txt", exact: true })
    .waitFor();
  await go(
    page,
    `http://localhost:4317/app/solutions?method=${method.id}&installation=${installed.id}`,
  );
  await page
    .getByRole("combobox", {
      name: "Input: Approved campaign brief",
      exact: true,
    })
    .selectOption({ label: "new-customer-brief.txt · v1" });
  await page
    .getByRole("button", { name: "Save project bindings", exact: true })
    .click();
  await page.locator(".solution-pending").waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Preview dependencies free", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Dependencies ready", exact: true })
    .waitFor();
  await page
    .locator('[name="solution_brief"]')
    .fill("Use only this new customer's approved source facts.");
  await page.locator('[name="solution_budget"]').fill("2");
  await page
    .getByRole("checkbox", {
      name: "I reviewed these inputs, all roles and the total budget, and approve this paid trial.",
      exact: true,
    })
    .check();
  const [secondTrial] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname ===
          `/v1/solution-versions/${method.id}/trials` &&
        r.request().method() === "POST",
    ),
    page
      .getByRole("button", { name: "Approve and start trial", exact: true })
      .click(),
  ]);
  assert.equal(secondTrial.status(), 201);
  const second = await secondTrial.json();
  assert.notEqual(second.id, lost.id);
  await execute(second, target.id);
  await page
    .getByRole("checkbox", {
      name: "I checked each role's actual delivery and accept this trial.",
      exact: true,
    })
    .waitFor();
  await shot(page, "rebound-delivery");
  media.push(await recording.stop());
  recording = undefined;
  pass(
    "SOLUTION-06 cross-project installation copies only a method reference, exposes missing input requirements, and runs a separately charged target trial after actual fresh-file upload and rebinding",
  );
  for (const width of [375, 800]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator(".solution-sheet-heading").scrollIntoViewIfNeeded();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await shot(page, "responsive-" + width);
  }
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.getByTitle("切換至繁體中文", { exact: true }).click();
  await page
    .getByTitle("Theme: light / dark / system", { exact: true })
    .click();
  await page.locator(".solution-sheet-heading").scrollIntoViewIfNeeded();
  await shot(page, "method-zh-dark");
  pass(
    "SOLUTION-07 both responsive widths avoid horizontal overflow and Chinese dark mode retains the same actual method, source and delivery state",
  );
  const adminContext = await browser.newContext({
    viewport: { width: 1440, height: 980 },
  });
  await adminContext.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const adminPage = await adminContext.newPage();
  adminPage.setDefaultTimeout(20000);
  adminPage.on("pageerror", (e) => errors.push(e.message));
  const { seal } = await load("src/lib.ts"),
    email = "method-operator-" + randomUUID() + "@example.invalid",
    secret = new OTPAuth.Secret({ size: 20 });
  const principal = (
    await system.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Method operator',$2) RETURNING id",
      [email, seal(system.db.config.MASTER_KEY, secret.base32)],
    )
  ).rows[0].id;
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,'super_admin','global')",
    [principal],
  );
  await go(adminPage, "http://localhost:4318");
  await adminPage.getByLabel("Administrator email").fill(email);
  const [challengeResponse] = await Promise.all([
    adminPage.waitForResponse(
      (r) => new URL(r.url()).pathname === "/v1/admin/auth/challenge",
    ),
    adminPage
      .getByRole("button", { name: "Send admin sign-in code", exact: true })
      .click(),
  ]);
  assert.equal(challengeResponse.status(), 200);
  const challenge = await challengeResponse.json(),
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
  await adminPage
    .locator('input[name="code"]')
    .fill(mail.text.match(/\b\d{6}\b/)[0]);
  await adminPage.locator('input[name="totp"]').fill(
    new OTPAuth.TOTP({
      secret,
      digits: 6,
      period: 30,
      algorithm: "SHA1",
    }).generate(),
  );
  await adminPage
    .getByRole("button", { name: "Verify & open dashboard", exact: true })
    .click();
  await adminPage
    .getByRole("link", { name: "Business methods", exact: true })
    .click();
  await adminPage.locator(".admin-solution-list article").waitFor();
  await shot(adminPage, "admin-metadata", "admin");
  await adminPage
    .getByRole("button", { name: "Read method body", exact: true })
    .click();
  await adminPage.getByRole("dialog").waitFor();
  await shot(adminPage, "admin-body-audited", "admin");
  await adminPage.getByRole("button", { name: "Close", exact: true }).click();
  await adminPage
    .getByRole("button", { name: "Disable version", exact: true })
    .click();
  await adminPage
    .locator('[name="solution_disable_reason"]')
    .fill("Withdraw this synthetic qualification method after review.");
  await adminPage
    .getByRole("button", { name: "Confirm disablement", exact: true })
    .click();
  await adminPage.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(
    (
      await system.db.control.query(
        "SELECT state FROM solution_versions WHERE id=$1",
        [method.id],
      )
    ).rows[0].state,
    "disabled",
  );
  await adminContext.close();
  const blocked = await page.request.get(
    `http://localhost:4317/v1/solution-trials/${second.id}`,
    { headers: { "X-Tenant-ID": tenant } },
  );
  assert.equal(blocked.status(), 409);
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await page.waitForURL("**/login");
  assert.equal(
    await page.evaluate(() =>
      Object.keys(sessionStorage).some((v) =>
        v.startsWith("cp_work_selection_v1:solutions:"),
      ),
    ),
    false,
  );
  pass(
    "SOLUTION-08 real Admin email and TOTP authorize separately audited body access and disablement; withdrawal fences target trial output and user sign-out clears saved method attempts",
  );
} catch (error) {
  errors.push(String(error));
  // Formatting the complete tsx-mapped assertion stack can recurse through
  // the source-map parser. Preserve the error without blocking owned cleanup.
  console.error(String(error));
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
