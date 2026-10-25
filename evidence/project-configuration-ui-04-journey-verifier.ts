import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { exerciseProjectConfiguration, projectUIRequest } from "./project-configuration-ui.js";
import { exerciseProjectSidePanel } from "./project-configuration-sidepanel-ui.js";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";
import { createRequire } from "node:module";
const delivery = process.cwd(),
  platform = path.resolve("../copypaste-platform"),
  attempt = process.argv[2];
const OTPAuth = createRequire(path.join(platform, "package.json"))("otpauth");
assert.match(attempt ?? "", /^\d{2}$/);
const checks: string[] = [],
  errors: string[] = [],
  screenshots: any[] = [],
  media: any[] = [];
let isolated: any,
  system: any,
  browser: Browser | undefined,
  browserClosed = false,
  apiClosed = false,
  fixtureClosed = false;
let guidance: any, sidePanel: any, funding: any, adminRecording: WorkmateRecording | undefined;
const pass = (s: string) => {
  checks.push(s);
  console.log("PASS: " + s);
};
async function signIn(
  page: Page,
  address: string,
  admin = false,
  secret?: any,
) {
  const prefix = admin ? "/v1/admin/auth" : "/v1/auth",
    origin = admin ? "http://localhost:4318" : "http://localhost:4317";
  await page.goto(origin + (admin ? "" : "/login"));
  await page.locator('input[name="email"]').fill(address);
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname ===
        prefix + (admin ? "/challenge" : "/challenges"),
    ),
    page.locator('form button[type="submit"]').click(),
  ]);
  assert.equal(response.status(), admin ? 200 : 202);
  const ch = await response.json(),
    mail = JSON.parse(
      await readFile(
        path.join(isolated.directory, "mailbox", ch.challenge_id + ".json"),
        "utf8",
      ),
    );
  await page
    .locator('input[name="code"]')
    .fill(mail.text.match(/\b\d{6}\b/)[0]);
  if (admin) await page.locator('input[name="totp"]').fill(secret.generate());
  const [verified] = await Promise.all([
    page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname ===
          prefix + (admin ? "/verify" : "/sessions") &&
        r.request().method() === "POST",
    ),
    page.locator('form button[type="submit"]').click(),
  ]);
  assert.equal(verified.status(), admin ? 200 : 201, await verified.text());
  return verified.json();
}

const deadline = setTimeout(() => {
  errors.push("Owned project guidance UI deadline exceeded");
  void browser?.close();
}, 360000);
try {
  const load = async (file: string) =>
    import(pathToFileURL(path.join(platform, file)).href);
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
      AI_BASE_URL: "http://127.0.0.1:9/v1", AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "explicit-no-model-fixture",
      AI_MODEL: "controlled-fixture", AI_VERIFIED: "true", AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000",
    }),
    { worker: false },
  );
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN,
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1360, height: 1000 },
  });
  await context.addInitScript(() => {
    localStorage.setItem("cp_locale", "en");
    localStorage.setItem("cp_theme", "light");
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  const userEmail = `guidance-ui-${randomUUID()}@example.invalid`;
  await signIn(page, userEmail);
  const created = await page.evaluate(async () => {
    const session = await (await fetch("/v1/session/context")).json();
    const response = await fetch("/v1/tenants", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrf_token,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        name: "Actual shared guidance UI fixture",
        project_name: "Hong Kong campaign workspace",
      }),
    });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  await page.evaluate((w) => {
    localStorage.setItem("cp_tenant", w.tenant.id);
    localStorage.setItem("cp_project", w.project.id);
  }, created.body);
  const tenant = created.body.tenant.id, project = created.body.project.id;
  // New accounts start without spendable funds. Exercise the actual audited
  // Admin preview/gift/replay path instead of editing the wallet in SQL.
  const { seal } = await load("src/lib.ts");
  const fundingSecret = new OTPAuth.Secret({ size: 20 }), fundingEmail = `guidance-funding-${randomUUID()}@example.invalid`;
  const fundingPrincipal = (await system.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Owned fixture funding operator',$2) RETURNING id", [fundingEmail, seal(system.db.config.MASTER_KEY, fundingSecret.base32)])).rows[0].id;
  await system.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,'super_admin','global',NULL)", [fundingPrincipal]);
  const fc = await browser.newContext(), feePage = await fc.newPage();
  const feeSession = await signIn(feePage, fundingEmail, true, new OTPAuth.TOTP({ secret: fundingSecret }));
  const account = (await system.db.control.query("SELECT * FROM wallets WHERE tenant_id=$1", [tenant])).rows[0];
  assert.equal(Number(account.balance_micros), 0); assert.equal(Number(account.reserved_micros), 0);
  const gift = { action: "gift", expected_version: account.version, reason: "Owned synthetic marketing pilot fixture; no cash received", amount: { currency: "HKD", amount_micros: "10000000" }, expires_at: new Date(Date.now() + 86400000).toISOString() };
  const feeRequest = async (suffix: string, key: string, preview?: string) => feePage.evaluate(async ({ url, key, preview, csrf, body }) => {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf, "Idempotency-Key": key, ...(preview ? { "X-Admin-Preview-Id": preview } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }, { url: `/v1/admin/billing/accounts/${account.id}/${suffix}`, key, preview, csrf: feeSession.csrf_token, body: gift });
  const feePreview = await feeRequest("previews", randomUUID()); assert.equal(feePreview.status, 200, JSON.stringify(feePreview.body)); assert.equal(feePreview.body.creates_business_effect, false);
  assert.equal(Number((await system.db.control.query("SELECT balance_micros FROM wallets WHERE id=$1", [account.id])).rows[0].balance_micros), 0);
  const feeKey = randomUUID(), granted = await feeRequest("gift", feeKey, feePreview.body.preview_id);
  assert.equal(granted.status, 202, JSON.stringify(granted.body)); assert.equal(granted.body.state, "succeeded");
  const replayed = await feeRequest("gift", feeKey); assert.equal(replayed.status, 202); assert.equal(replayed.body.id, granted.body.id);
  const actualFunding = (await system.db.control.query("SELECT j.* FROM billing_journal j WHERE operation_id=$1", [granted.body.id])).rows;
  assert.equal(actualFunding.length, 1); assert.equal(actualFunding[0].actor_id, fundingPrincipal); assert.equal(actualFunding[0].kind, "gift"); assert.equal(actualFunding[0].bucket, "promotional");
  assert.equal(Number((await system.db.control.query("SELECT balance_micros FROM wallets WHERE id=$1", [account.id])).rows[0].balance_micros), 10000000);
  funding = { account_id: account.id, operation_id: granted.body.id, amount_micros: "10000000", currency: "HKD", source: "actual Admin OTP/TOTP and preview/gift HTTP; owned synthetic tenant", no_direct_wallet_mutation: true, idempotent_replay: true };
  await fc.close();
  pass("Actual Admin OTP/TOTP previews and gifts HKD10 to the new synthetic tenant through audited billing HTTP; preview changes no balance and replay never double-credits");
  guidance = await exerciseProjectConfiguration({ page, repo: "web", delivery, attempt, system, pass, screenshots,
    resize: async (width, height) => page.setViewportSize({ width, height }) });
  media.push(guidance.media);
  sidePanel = await exerciseProjectSidePanel({ delivery, attempt, conversationId: guidance.conversation_id,
    login: async p => { await signIn(p, userEmail); }, screenshots, media, pass,
    verifyAcceptedTask: async id => {
      const task = (await system.db.control.query("SELECT * FROM tasks WHERE id=$1", [id])).rows[0];
      assert.equal(task.project_id, project); assert.equal(task.execution_location, "cloud"); assert.equal(task.status, "queued");
      assert.equal(task.input_context.project_configuration.version, 3);
      const file = (await system.db.control.query("SELECT a.*,v.id AS version_id FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version WHERE a.project_id=$1 AND a.name='panel-approved.txt'", [project])).rows[0];
      assert.ok(file); assert.equal(file.private_owner, task.created_by); assert.ok(JSON.stringify(task.input_context).includes(file.version_id));
      assert.equal(Number(task.accrued_micros), 0);
    },
  });
  const secret = new OTPAuth.Secret({ size: 20 });
  const adminEmail = `guidance-admin-${randomUUID()}@example.invalid`;
  const principal = (await system.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Scoped shared guidance reviewer',$2) RETURNING id", [adminEmail, seal(system.db.config.MASTER_KEY, secret.base32)])).rows[0].id;
  const grant = async (permissions: string[]) => {
    const role = "guidance_ui_" + randomUUID();
    await system.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Shared project review',$2)", [role, JSON.stringify(permissions)]);
    await system.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'project',$3)", [principal, role, project]);
  };
  await grant(["admin.content.read"]);
  const ac = await browser.newContext({ viewport: { width: 1440, height: 980 } });
  await ac.addInitScript(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); });
  const admin = await ac.newPage(); admin.on("pageerror", e => errors.push(e.message));
  await signIn(admin, adminEmail, true, new OTPAuth.TOTP({ secret })); await admin.goto("http://localhost:4318/content");
  await admin.getByRole("textbox", { name: "Search records", exact: true }).fill("Harbour · shared campaign direction");
  const row = admin.getByRole("row").filter({ hasText: "Harbour · shared campaign direction" }); await row.waitFor();
  assert.equal(await row.getByTitle("Read content", { exact: true }).count(), 0);
  assert.equal(await admin.evaluate(async id => (await fetch("/v1/admin/content/" + id + "/body")).status, guidance.configuration_id), 403);
  adminRecording = new WorkmateRecording("admin", "project-guidance-governance", "guidance-" + attempt, () => admin.screenshot(),
    "Actual scoped Admin OTP/TOTP, independent content-body permission, immutable shared versions and quarantine/restore/permanent deletion. Synthetic project content.", delivery);
  await adminRecording.start();
  const shot = async (name: string) => screenshots.push(await saveWorkmateScreenshot("admin", "guidance-" + attempt, name, await admin.screenshot(),
    "Actual scoped Admin shared-project content governance and audited original-body read. Real policy/database operations; explicit owned synthetic tenant.", delivery));
  await shot("admin-metadata-only");
  pass("Scoped Admin OTP/TOTP lists shared guidance metadata while its separate body permission remains absent in both actual UI and HTTP");
  await grant(["admin.content.body.read", "admin.content.quarantine", "admin.content.restore", "admin.content.delete"]);
  await admin.reload(); await admin.getByRole("textbox", { name: "Search records", exact: true }).fill("Harbour · shared campaign direction");
  await row.getByTitle("Read content", { exact: true }).click(); let modal = admin.getByRole("dialog"); await modal.locator("pre.content-body").waitFor();
  const original = JSON.parse((await modal.locator("pre.content-body").textContent())!); assert.equal(original.current_version, 3); assert.equal(original.versions.length, 3);
  assert.ok((await system.db.control.query("SELECT 1 FROM audit_log WHERE principal_id=$1 AND action='admin.content.body.read' AND target=$2", [principal, guidance.configuration_id])).rowCount);
  await shot("admin-exact-version-body"); await modal.getByRole("button", { name: "Close", exact: true }).click();
  pass("Granting independent scoped body access exposes exactly three retained shared-guidance versions and persists a sensitive-read audit");
  for (const action of ["quarantine", "restore", "delete"]) {
    await row.getByTitle("Manage content", { exact: true }).click(); modal = admin.getByRole("dialog");
    await modal.getByLabel("Action", { exact: true }).selectOption(action);
    await modal.getByLabel("Reason", { exact: true }).fill("Customer project governance reviewed in owned fixture");
    if (action === "delete") await shot("admin-permanent-deletion-warning");
    await modal.getByRole("button", { name: "Confirm action", exact: true }).click(); await modal.waitFor({ state: "detached" });
    const current = await projectUIRequest(page, "GET", `/v1/tenants/${tenant}/projects/${project}/project-configuration`);
    assert.equal(current.status, action === "restore" ? 200 : 409);
    if (action === "restore") assert.equal(current.body.published.version, 3);
  }
  const erased = (await system.db.control.query("SELECT body,erased_at FROM project_configuration_versions WHERE configuration_id=$1", [guidance.configuration_id])).rows;
  assert.equal(erased.length, 3); assert.ok(erased.every((v: any) => JSON.stringify(v.body) === "{}" && v.erased_at));
  await shot("admin-deleted-guidance");
  pass("Actual Admin quarantine blocks customer guidance, restore preserves v3 and delete permanently erases all three version bodies without reviving old content");
  media.push(await adminRecording.stop()); adminRecording = undefined; await ac.close();

} catch (e) {
  errors.push(String(e));
  console.error(e);
} finally {
  clearTimeout(deadline);
  if (adminRecording) await adminRecording.stop().catch(e => errors.push(String(e)));
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
      !errors.length && browserClosed && apiClosed && fixtureClosed
        ? "passed"
        : "failed",
    checks,
    errors,
    screenshots,
    media,
    guidance,
    funding,
    side_panel: sidePanel,
    browser_closed: browserClosed,
    api_closed: apiClosed,
    fixture_closed: fixtureClosed,
    not_validated: [
      "Model execution and live provider quality",
      "Full role, large-directory and complete native runtime acceptance",
      "Full product acceptance",
    ],
  };
  await writeFile(
    `evidence/project-configuration-ui-${attempt}-journey.json`,
    JSON.stringify(result, null, 2) + "\n",
    { flag: "wx" },
  );
  assert.equal(result.status, "passed", JSON.stringify(errors));
}
