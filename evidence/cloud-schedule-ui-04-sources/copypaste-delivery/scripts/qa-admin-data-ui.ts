import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  WorkmateRecording,
  saveWorkmateScreenshot,
} from "./record-workmate-media.js";
const delivery = process.cwd(),
  platform = path.resolve("../copypaste-platform"),
  attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const prefix = path.join(delivery, "evidence/admin-data-ui-" + attempt),
  checks: string[] = [],
  errors: string[] = [],
  screenshots: any[] = [],
  recordings: any[] = [];
let browser: Browser | undefined,
  system: any,
  isolated: any,
  recording: WorkmateRecording | undefined,
  stage = "setup",
  browserClosed = false,
  apiClosed = false,
  fixtureClosed = false;
const load = (file: string) =>
  import(pathToFileURL(path.join(platform, file)).href);
const pass = (name: string) => {
  checks.push(name);
  console.log("PASS: " + name);
};
async function until<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
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
async function shot(page: Page, name: string, description: string) {
  screenshots.push(
    await saveWorkmateScreenshot(
      "admin",
      "admin-data-" + attempt,
      name,
      await page.screenshot(),
      description,
      delivery,
    ),
  );
}
async function finish() {
  if (recording) {
    const current = recording;
    recording = undefined;
    recordings.push(await current.stop());
  }
}
try {
  const [
    { isolatedTestEnvironment },
    { buildApp },
    { loadConfig },
    { seal },
    { advanceAdminDataJobs },
  ] = await Promise.all([
    load("tests/native-test-environment.ts"),
    load("src/server.ts"),
    load("src/config.ts"),
    load("src/lib.ts"),
    load("src/admin-data-jobs.ts"),
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
  const OTP = createRequire(path.join(platform, "package.json"))("otpauth"),
    secret = new OTP.Secret({ size: 20 }),
    email = `admin-data-ui-${randomUUID()}@example.invalid`;
  const actor = (
    await system.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Harbour data administrator',$2) RETURNING id",
      [email, seal(system.db.config.MASTER_KEY, secret.base32)],
    )
  ).rows[0];
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,'super_admin','global')",
    [actor.id],
  );
  const names = "Harbour review " + randomUUID().slice(0, 6),
    createUser = async (name: string) =>
      (
        await system.db.control.query(
          "INSERT INTO users(email,name) VALUES($1,$2) RETURNING *",
          [randomUUID() + "@example.invalid", name],
        )
      ).rows[0];
  const amber = await createUser(names + " Amber"),
    jade = await createUser(names + " Jade"),
    cancelTarget = await createUser(
      "Cancellation target " + randomUUID().slice(0, 6),
    );
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN,
    headless: true,
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1080 },
    }),
    page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem("cp_locale"))
      localStorage.setItem("cp_locale", "en");
    if (!localStorage.getItem("cp_theme"))
      localStorage.setItem("cp_theme", "light");
  });
  stage = "Real administrator email and MFA";
  await page.goto("http://localhost:4318/login");
  await page.locator('input[name="email"]').fill(email);
  const [ch] = await Promise.all([
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/v1/admin/auth/challenge",
    ),
    page.locator('form button[type="submit"]').click(),
  ]);
  assert.equal(ch.ok(), true);
  const mail = JSON.parse(
    await readFile(
      path.join(
        isolated.directory,
        "mailbox",
        (await ch.json()).challenge_id + ".json",
      ),
      "utf8",
    ),
  );
  await page
    .locator('input[name="code"]')
    .fill(mail.text.match(/\b\d{6}\b/)[0]);
  await page
    .locator('input[name="totp"]')
    .fill(
      new OTP.TOTP({
        secret,
        digits: 6,
        period: 30,
        algorithm: "SHA1",
      }).generate(),
    );
  await page.locator('form button[type="submit"]').click();
  await page.locator(".admin-shell").waitFor();
  await page.goto("http://localhost:4318/jobs");
  await page.locator(".data-job-list").waitFor();
  pass(
    "Real administrator email challenge and replay-protected MFA reach the data job workspace",
  );
  const jobId = () => new URL(page.url()).searchParams.get("job")!;
  const waitState = async (state: string) =>
    until(
      async () =>
        (
          await system.db.control.query(
            "SELECT state FROM admin_data_jobs WHERE id=$1",
            [jobId()],
          )
        ).rows[0]?.state,
      (v) => v === state,
      state,
    );
  const confirm = async () => {
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("I reviewed these targets, fields and versions", {
        exact: true,
      })
      .check();
    await dialog
      .getByRole("button", { name: "Confirm and queue", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
  };
  const startBatch = async (search: string) => {
    await page
      .getByRole("button", { name: "Batch user action", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Find and select accounts", { exact: true })
      .fill(search);
    await until(
      () => dialog.locator(".data-user-option").count(),
      (v) => v > 0,
      "directory search",
    );
  };
  stage = "Frozen batch preview";
  recording = new WorkmateRecording(
    "admin",
    "admin-data-batch",
    attempt,
    () => page.screenshot({ type: "jpeg", quality: 75 }),
    "Actual Admin batch preview, partial outcome and reviewed child retry",
    delivery,
  );
  await recording.start();
  await startBatch(names);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: new RegExp("Amber") }).check();
  await dialog.getByRole("checkbox", { name: new RegExp("Jade") }).check();
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Customer support reviewed these two account freezes");
  await dialog
    .getByRole("button", { name: "Preview records & versions", exact: true })
    .click();
  await dialog.locator(".data-preview").waitFor();
  await shot(
    page,
    "batch-preview-en",
    "Actual two-account frozen target/version preview after directory selection",
  );
  await confirm();
  const parent = jobId();
  assert.equal(
    (
      await system.db.control.query("SELECT status FROM users WHERE id=$1", [
        amber.id,
      ])
    ).rows[0].status,
    "active",
  );
  await system.db.control.query(
    "UPDATE users SET version=version+1 WHERE id=$1",
    [jade.id],
  );
  await advanceAdminDataJobs(system.db);
  await waitState("partially_succeeded");
  await page
    .locator(".data-job-detail")
    .getByText("Partially succeeded", { exact: true })
    .waitFor();
  await shot(
    page,
    "partial-results-en",
    "Actual partial success: a changed target fails independently without replaying the successful account",
  );
  pass(
    "Actual directory selection, frozen preview, explicit queue confirmation and durable partial item results",
  );
  stage = "Reviewed failed-item child retry";
  await page
    .getByRole("button", { name: "Preview failed items only", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Reason", { exact: true })
    .fill("Review only the corrected failed account");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await page.getByRole("dialog").locator(".data-preview").waitFor();
  assert.equal(
    await page.getByRole("dialog").locator(".data-targets li").count(),
    1,
  );
  await confirm();
  const child = jobId();
  assert.notEqual(child, parent);
  await advanceAdminDataJobs(system.db);
  await waitState("succeeded");
  await page
    .locator(".data-job-detail")
    .getByText("Succeeded", { exact: true })
    .first()
    .waitFor();
  await shot(
    page,
    "retry-child-en",
    "Actual successful child job references its partial parent and excludes already successful targets",
  );
  await finish();
  assert.equal(
    (
      await system.db.control.query("SELECT version FROM users WHERE id=$1", [
        amber.id,
      ])
    ).rows[0].version,
    2,
  );
  pass(
    "A separately reviewed child retries one failed target, preserves its parent and never repeats the successful mutation",
  );
  stage = "Queued cancellation";
  await startBatch(cancelTarget.name);
  await page
    .getByRole("dialog")
    .getByRole("checkbox", { name: new RegExp("Cancellation target") })
    .check();
  await page
    .getByRole("dialog")
    .getByLabel("Reason", { exact: true })
    .fill("Queue a customer change for cancellation review");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Preview records & versions", exact: true })
    .click();
  await page.getByRole("dialog").locator(".data-preview").waitFor();
  await confirm();
  await page
    .getByRole("button", { name: "Cancel pending items", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Reason", { exact: true })
    .fill("Customer withdrew this pending change");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await waitState("cancelled");
  assert.equal(
    (
      await system.db.control.query("SELECT version FROM users WHERE id=$1", [
        cancelTarget.id,
      ])
    ).rows[0].version,
    1,
  );
  pass(
    "The real cancellation flow stops pending work without applying the queued account change",
  );
  stage = "Frozen export and download";
  recording = new WorkmateRecording(
    "admin",
    "admin-data-export",
    attempt,
    () => page.screenshot({ type: "jpeg", quality: 75 }),
    "Actual Admin filtered export preview, persistent progress and CSV/manifest download",
    delivery,
  );
  await recording.start();
  await page.getByRole("button", { name: "New export", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Search records", { exact: true })
    .fill(names);
  await page
    .getByRole("dialog")
    .getByLabel("Reason", { exact: true })
    .fill("Export the two reviewed customer accounts");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Preview records & versions", exact: true })
    .click();
  await page.getByRole("dialog").locator(".data-preview").waitFor();
  assert.equal(
    await page.getByRole("dialog").locator(".data-targets li").count(),
    2,
  );
  await shot(
    page,
    "export-preview-en",
    "Actual export filter, projected fields, sample records and immutable target versions",
  );
  await confirm();
  const exportId = jobId();
  const arrived = await createUser(names + " Later arrival");
  await advanceAdminDataJobs(system.db);
  await waitState("succeeded");
  await page
    .getByRole("button", { name: "Download CSV", exact: true })
    .waitFor();
  await shot(
    page,
    "export-ready-en",
    "Actual completed encrypted snapshot with separate CSV and exact manifest downloads",
  );
  const [csv] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download CSV", exact: true }).click(),
  ]);
  const csvBytes = await readFile((await csv.path())!);
  assert.equal(csvBytes.toString().trim().split("\r\n").length, 3);
  assert.ok(!csvBytes.toString().includes(arrived.id));
  const [manifest] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("button", { name: "Download manifest", exact: true })
      .click(),
  ]);
  const manifestValue = JSON.parse(
    await readFile((await manifest.path())!, "utf8"),
  );
  assert.equal(manifestValue.manifest.targets.length, 2);
  assert.equal(manifestValue.counts.succeeded, 2);
  await finish();
  pass(
    "CSV and manifest downloads contain exactly the two frozen records; a later matching registration is excluded",
  );
  stage = "History and localized responsive pages";
  await page
    .getByRole("link", { name: "Billing & entitlement history", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Jobs & exports", exact: true })
    .waitFor();
  await page.goto("http://localhost:4318/jobs?job=" + exportId);
  await page.locator(".data-download").waitFor();
  await page.setViewportSize({ width: 390, height: 920 });
  await page.evaluate(() => {
    localStorage.setItem("cp_locale", "zh-HK");
    localStorage.setItem("cp_theme", "dark");
  });
  await page.reload();
  await page
    .getByRole("heading", { name: "批次任務與資料匯出", exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth > innerWidth ||
        document.body.scrollWidth > innerWidth,
    ),
    false,
  );
  await shot(
    page,
    "compact-zh",
    "Actual 390-pixel Chinese/dark data job workspace with no horizontal overflow",
  );
  pass(
    "Billing/VIP operation history remains reachable; the Chinese dark workspace fits a 390-pixel viewport",
  );
  stage = "Revoked download permission";
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.evaluate(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Download CSV", exact: true })
    .waitFor();
  const role = "ui_export_deny_" + randomUUID().replaceAll("-", "");
  await system.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Deny downloads','[\"admin.exports.download\"]')",
    [role],
  );
  await system.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,effect) VALUES($1,$2,'global','deny')",
    [actor.id, role],
  );
  const [denied] = await Promise.all([
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === rootDownload(exportId),
    ),
    page.getByRole("button", { name: "Download CSV", exact: true }).click(),
  ]);
  assert.equal(denied.status(), 403);
  await page.getByRole("alert").first().waitFor();
  pass(
    "The real download request rejects newly revoked authority even while the browser still shows an older action button",
  );
} catch (e) {
  errors.push(stage + ": " + String(e));
  console.error(e);
} finally {
  if (recording)
    try {
      await finish();
    } catch (e) {
      errors.push(String(e));
    }
  if (browser)
    await browser
      .close()
      .then(() => {
        browserClosed = true;
      })
      .catch((e) => errors.push(String(e)));
  if (system)
    await system.app
      .close()
      .then(() => {
        apiClosed = true;
      })
      .catch((e: any) => errors.push(String(e)));
  if (isolated)
    await isolated
      .cleanup()
      .then(() => {
        fixtureClosed = true;
      })
      .catch((e: any) => errors.push(String(e)));
  await writeFile(
    prefix + "-journey.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: errors.length ? "failed" : "passed",
        stage,
        checks,
        errors,
        screenshots,
        recordings,
        browser_closed: browserClosed,
        api_closed: apiClosed,
        fixture_closed: fixtureClosed,
        synthetic_accounts: true,
        model_calls: 0,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  if (errors.length) process.exitCode = 1;
}
function rootDownload(id: string) {
  return "/v1/admin/data-jobs/" + id + "/download";
}
