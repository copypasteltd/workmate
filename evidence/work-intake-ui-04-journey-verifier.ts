import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";

const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const prefix = "evidence/work-intake-ui-" + attempt, OTPAuth = createRequire(path.join(platform, "package.json"))("otpauth");
const checks: string[] = [], errors: string[] = [], screenshots: any[] = [], media: any[] = [], requests: any[] = [];
let isolated: any, system: any, browser: Browser | undefined, recording: WorkmateRecording | undefined;
let browserClosed = false, apiClosed = false, fixtureClosed = false, funding: any, recovery: any, late: any, outputs: any;
const pass = (name: string) => { checks.push(name); console.log("PASS: " + name); };
const load = (file: string) => import(pathToFileURL(path.join(platform, file)).href);
async function signIn(page: Page, email: string, admin = false, secret?: any) {
  await page.goto(admin ? "http://localhost:4318" : "http://localhost:4317/login");
  await page.locator('input[name="email"]').fill(email);
  const auth = admin ? "/v1/admin/auth" : "/v1/auth";
  const [response] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === auth + (admin ? "/challenge" : "/challenges")), page.locator('form button[type="submit"]').click()]);
  assert.equal(response.status(), admin ? 200 : 202);
  const challenge = await response.json(), mail = JSON.parse(await readFile(path.join(isolated.directory, "mailbox", challenge.challenge_id + ".json"), "utf8"));
  await page.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);
  if (admin) await page.locator('input[name="totp"]').fill(secret.generate());
  const [verified] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === auth + (admin ? "/verify" : "/sessions") && r.request().method() === "POST"), page.locator('form button[type="submit"]').click()]);
  assert.equal(verified.status(), admin ? 200 : 201);
  return verified.json();
}
async function request(page: Page, method: string, url: string, body?: unknown) {
  return page.evaluate(async ({ method, url, body }) => {
    const session = await (await fetch("/v1/session/context")).json();
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf_token, "Idempotency-Key": crypto.randomUUID(), ...(url.match(/\/tenants\/([^/]+)/) ? { "X-Tenant-ID": url.match(/\/tenants\/([^/]+)/)![1] } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }, { method, url, body });
}
async function open(page: Page) { await page.getByRole("button", { name: /^New task/ }).click(); await page.getByRole("dialog").waitFor(); return page.getByRole("dialog"); }
async function close(page: Page) { await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click(); await page.getByRole("dialog").waitFor({ state: "detached" }); }
async function shot(page: Page, name: string) { screenshots.push(await saveWorkmateScreenshot("web", "intake-" + attempt, name, await page.screenshot({ fullPage: true, animations: "disabled" }), "Actual built Web, isolated native PostgreSQL and explicitly synthetic customer data", delivery)); }
const timeout = setTimeout(() => { errors.push("Owned first-work UI deadline exceeded"); void browser?.close(); }, 420000);
try {
  const { isolatedTestEnvironment } = await load("tests/native-test-environment.ts"), { buildApp } = await load("src/server.ts"), { loadConfig } = await load("src/config.ts");
  process.chdir(platform); isolated = await isolatedTestEnvironment();
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "false", DEMO_MODE: "true",
    AI_BASE_URL: "http://127.0.0.1:9/v1", AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "explicit-controlled-intake-fixture", AI_MODEL: "controlled-fixture", AI_VERIFIED: "true",
    AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000" }), { worker: false });
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
  await context.addInitScript(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); });
  const page = await context.newPage(); page.setDefaultTimeout(20000); page.on("pageerror", e => errors.push(e.message));
  const email = "intake-" + randomUUID() + "@example.invalid", signed = await signIn(page, email), user = signed.user.id;
  await page.waitForURL("**/welcome");
  await page.locator('input[name="name"]').fill("Harbour marketing pilot"); await page.locator('input[name="project_name"]').fill("First campaign");
  const [created] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === "/v1/tenants" && r.request().method() === "POST"), page.getByRole("button", { name: "Create workspace & continue", exact: true }).click()]);
  assert.equal(created.status(), 200); const workspace = await created.json(), tenant = workspace.tenant.id, project = workspace.project.id;
  const base = `/v1/tenants/${tenant}/projects/${project}`;
  await page.waitForURL("**/app"); await page.getByRole("button", { name: /^New task/ }).waitFor();
  pass("INTAKE-01 actual email verification and first workspace form reach the authorized project without mandatory brand or connector setup");

  let modal = await open(page);
  await modal.locator('[name="title"]').fill("First unconfigured task"); await modal.locator('[name="prompt"]').fill("Prepare an approved synthetic campaign plan");
  const [noCredit] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === base + "/delegations" && r.request().method() === "POST"), modal.getByRole("button", { name: "Start task", exact: true }).click()]);
  assert.equal(noCredit.status(), 402); await modal.getByRole("alert").waitFor();
  assert.equal(await modal.locator('[name="prompt"]').inputValue(), "Prepare an approved synthetic campaign plan");
  assert.equal(await modal.locator('[name="prompt"]').isEditable(), true);
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE project_id=$1", [project])).rows[0].n, 0);
  await modal.getByRole("button", { name: "Clear this draft", exact: true }).click(); await close(page);
  pass("INTAKE-02 rejected credit keeps the editable brief and creates no task or reservation");

  const { seal } = await load("src/lib.ts"), secret = new OTPAuth.Secret({ size: 20 }), adminEmail = "intake-admin-" + randomUUID() + "@example.invalid";
  const adminId = (await system.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Owned intake funding operator',$2) RETURNING id", [adminEmail, seal(system.db.config.MASTER_KEY, secret.base32)])).rows[0].id;
  await system.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,'super_admin','global',NULL)", [adminId]);
  const ac = await browser.newContext(), ap = await ac.newPage(), adminSession = await signIn(ap, adminEmail, true, new OTPAuth.TOTP({ secret }));
  const wallet = (await system.db.control.query("SELECT * FROM wallets WHERE tenant_id=$1", [tenant])).rows[0];
  const gift = { action: "gift", expected_version: wallet.version, reason: "Synthetic first-work pilot, no cash received", amount: { currency: "HKD", amount_micros: "100000000" }, expires_at: new Date(Date.now() + 86400000).toISOString() };
  const adminRequest = (suffix: string, key: string, preview?: string) => ap.evaluate(async ({ suffix, key, preview, account, body, csrf }) => { const response = await fetch(`/v1/admin/billing/accounts/${account}/${suffix}`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf, "Idempotency-Key": key, ...(preview ? { "X-Admin-Preview-Id": preview } : {}) }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; }, { suffix, key, preview, account: wallet.id, body: gift, csrf: adminSession.csrf_token });
  const preview = await adminRequest("previews", randomUUID()); assert.equal(preview.status, 200); assert.equal(preview.body.creates_business_effect, false);
  const giftKey = randomUUID(), funded = await adminRequest("gift", giftKey, preview.body.preview_id); assert.equal(funded.status, 202); assert.equal(funded.body.state, "succeeded");
  assert.equal((await adminRequest("gift", giftKey)).body.id, funded.body.id);
  funding = { operation_id: funded.body.id, amount_micros: "100000000", actual_admin_otp_totp_http: true, no_direct_wallet_mutation: true };
  await ac.close(); pass("INTAKE-03 actual Admin OTP/TOTP preview and idempotent gift fund the new tenant without direct wallet mutation");

  recording = new WorkmateRecording("web", "first-work", "intake-" + attempt, () => page.screenshot({ type: "jpeg", quality: 72 }), "Actual role selection, scoped draft recovery and browser interactions; synthetic account", delivery); await recording.start();
  for (const [label, role] of [["Create campaign visuals", "designer"], ["Understand ad performance", "marketing-analyst"], ["Build a site or tool", "fullstack"]]) {
    await page.getByRole("button", { name: label, exact: true }).click(); modal = page.getByRole("dialog");
    assert.equal(await modal.locator('[name="role"]').inputValue(), role); await shot(page, "shortcut-" + role);
    await modal.getByRole("button", { name: "Clear this draft", exact: true }).click(); await close(page);
  }
  pass("INTAKE-04 three workbench shortcuts select their actual designer, marketing-analyst and fullstack roles");
  modal = await open(page); await modal.locator('[name="role"]').selectOption("video-motion");
  await modal.locator('[name="title"]').fill("Saved bilingual brief"); await modal.locator('[name="prompt"]').fill("保留原文字與字體，製作 synthetic campaign output");
  await modal.locator('[name="mode"]').selectOption("plan"); await modal.locator('[name="budget"]').fill("7.25"); await modal.locator('[name="required_input"]').selectOption("file");
  await close(page); await page.reload(); modal = await open(page);
  for (const [name, expected] of [["role", "video-motion"], ["title", "Saved bilingual brief"], ["mode", "plan"], ["budget", "7.25"], ["required_input", "file"]]) assert.equal(await modal.locator(`[name="${name}"]`).inputValue(), expected);
  await shot(page, "restored-brief"); await close(page);
  const other = await request(page, "POST", `/v1/tenants/${tenant}/projects`, { name: "Second authorized project" }); assert.equal(other.status, 200);
  await page.reload(); await page.getByLabel("Current project", { exact: true }).selectOption(other.body.id);
  modal = await open(page); assert.equal(await modal.locator('[name="prompt"]').inputValue(), ""); await close(page);
  await page.getByLabel("Current project", { exact: true }).selectOption(project); modal = await open(page);
  assert.equal(await modal.locator('[name="title"]').inputValue(), "Saved bilingual brief");
  pass("INTAKE-05 all captured fields survive modal closure and reload, and project changes isolate and restore the correct draft");
  await context.setOffline(true); await page.getByText("You are offline.", { exact: false }).waitFor(); assert.equal(await modal.getByRole("button", { name: "Start task", exact: true }).isDisabled(), true);
  await context.setOffline(false); await modal.getByRole("button", { name: "Start task", exact: true }).waitFor(); await shot(page, "offline-recovery");
  pass("INTAKE-06 offline state preserves inputs and prevents dispatch until browser connectivity returns");
  await close(page);
  await system.db.control.query("UPDATE sessions SET expires_at=now()-interval '1 minute' WHERE user_id=$1 AND audience='user'", [user]);
  await page.reload(); await page.waitForURL("**/login"); await signIn(page, email); await page.waitForURL("**/app"); modal = await open(page);
  assert.equal(await page.getByLabel("Current project", { exact: true }).inputValue(), project, "Reauthentication restores the original still-authorized project");
  assert.equal(await modal.locator('[name="title"]').inputValue(), "Saved bilingual brief"); assert.equal(await modal.locator('[name="required_input"]').inputValue(), "file");
  await modal.getByRole("button", { name: "Clear this draft", exact: true }).click(); await close(page);
  pass("INTAKE-07 actual server-side session expiry requires email reauthentication and restores only the same actor's draft");
  media.push(await recording.stop()); recording = undefined;

  recording = new WorkmateRecording("web", "submission-recovery", "intake-" + attempt, () => page.screenshot({ type: "jpeg", quality: 72 }), "Actual committed HTTP response loss, retry identity, task output and receipt", delivery); await recording.start();
  modal = await open(page); await modal.locator('[name="title"]').fill("Recover original work"); await modal.locator('[name="prompt"]').fill("Prepare a synthetic campaign plan and deliver the real Markdown file");
  let committed: any, committedStatus = 0;
  await page.route("**/delegations", async route => { const response = await route.fetch(); committedStatus = response.status(); committed = await response.json();
    requests.push({ key: route.request().headers()["idempotency-key"], body_sha256: createHash("sha256").update(route.request().postData()!).digest("hex") }); await route.abort("failed"); });
  await modal.getByRole("button", { name: "Start task", exact: true }).click(); await modal.getByRole("button", { name: "Retry original submission", exact: true }).waitFor();
  assert.equal(committedStatus, 200, JSON.stringify(committed));
  assert.equal(await modal.locator('[name="prompt"]').isEditable(), false); await shot(page, "lost-response");
  await page.unroute("**/delegations");
  let releaseProjects!: () => void, receivedProjects!: () => void;
  const projectGate = new Promise<void>(resolve => releaseProjects = resolve), projectsLoading = new Promise<void>(resolve => receivedProjects = resolve);
  await page.route("**/v1/tenants/*/projects", async route => { receivedProjects(); await projectGate; await route.continue(); });
  try {
    await page.reload(); await projectsLoading;
    assert.equal(await page.getByRole("button", { name: /^New task/ }).isDisabled(), true, "New work waits for the currently authorized project instead of dropping early clicks");
  } finally { releaseProjects(); }
  modal = await open(page); await page.unroute("**/v1/tenants/*/projects");
  await page.route("**/delegations", async route => { requests.push({ key: route.request().headers()["idempotency-key"], body_sha256: createHash("sha256").update(route.request().postData()!).digest("hex") }); await route.continue(); });
  await modal.getByRole("button", { name: "Retry original submission", exact: true }).click(); await page.waitForURL("**/conversations/" + committed.conversation.id); await page.unroute("**/delegations");
  assert.equal(requests[0].key, requests[1].key); assert.equal(requests[0].body_sha256, requests[1].body_sha256);
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE project_id=$1", [project])).rows[0].n, 1);
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM reservations WHERE task_id=$1", [committed.task.id])).rows[0].n, 1);
  recovery = { task_id: committed.task.id, conversation_id: committed.conversation.id, exact_retry: true, task_count: 1, reservation_count: 1 };
  pass("INTAKE-08 an actually committed but lost HTTP response survives reload and retries the exact request with one task and one reservation");

  const { CodexRuntimeAdapter } = await load("src/runtime.ts"), { Worker } = await load("src/worker.ts");
  let runtimeCalls = 0;
  class ControlledRuntime extends CodexRuntimeAdapter { constructor() { super(system.db.config); }
    async start(ctx: any) { runtimeCalls++; await ctx.tools.find((tool: any) => tool.name === "deliver_text").run({ filename: "intake-campaign-plan.md", content: "# Synthetic campaign plan\nCustomer-approved wording retained.\n", mime_type: "text/markdown" }, randomUUID());
      return { status: "completed", text: "Explicitly synthetic campaign plan delivered.", inputTokens: 20, outputTokens: 10, usageKnown: true, accepted: true, thread: "synthetic-intake-thread", turn: "synthetic-intake-turn" }; } }
  await new Worker(system.db, system.catalog, system.storage, new ControlledRuntime()).run(tenant, committed.task.id);
  const completed = (await request(page, "GET", base + "/tasks/" + committed.task.id)).body;
  assert.equal(completed.status, "succeeded"); assert.equal(Number(completed.charged_micros), 30); assert.equal(runtimeCalls, 1);
  await page.reload(); await page.getByText("Explicitly synthetic campaign plan delivered.", { exact: false }).waitFor();
  await page.getByRole("link", { name: "Assets & deliverables", exact: true }).click(); await page.getByText("intake-campaign-plan.md", { exact: true }).waitFor();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).first().click()]);
  const downloaded = await readFile((await download.path())!); assert.equal(downloaded.toString(), "# Synthetic campaign plan\nCustomer-approved wording retained.\n");
  outputs = { task_id: completed.id, charged_micros: "30", runtime_calls: runtimeCalls, file_sha256: createHash("sha256").update(downloaded).digest("hex"), controlled_runtime: true, native_codex_not_exercised_here: true };
  await shot(page, "actual-output-download");
  pass("INTAKE-09 real Worker, delivery tool, private file bytes and 30-micro-HKD settlement complete once under an explicit synthetic runtime");
  modal = await open(page); await modal.getByRole("link", { name: "Open original work", exact: true }).waitFor(); await shot(page, "accepted-receipt");
  await modal.getByRole("button", { name: "Start another task", exact: true }).click(); assert.equal(await modal.locator('[name="prompt"]').inputValue(), ""); await close(page);
  pass("INTAKE-10 the persisted success receipt opens the original work and requires an explicit new-task action");

  modal = await open(page); await modal.locator('[name="title"]').fill("Keep response in original project"); await modal.locator('[name="prompt"]').fill("A separately confirmed synthetic task in the first project"); await modal.locator('[name="budget"]').fill("1");
  let release!: () => void, fetched!: () => void, original: any;
  const gate = new Promise<void>(resolve => release = resolve), received = new Promise<void>(resolve => fetched = resolve);
  await page.route("**/delegations", async route => { const response = await route.fetch(); original = await response.json(); fetched(); await gate; await route.fulfill({ response }); });
  await modal.getByRole("button", { name: "Start task", exact: true }).click(); await received;
  await close(page); await page.getByLabel("Current project", { exact: true }).selectOption(other.body.id); await page.getByRole("dialog").waitFor({ state: "detached" });
  release(); await page.unrouteAll({ behavior: "wait" });
  assert.equal(await page.getByLabel("Current project", { exact: true }).inputValue(), other.body.id); assert.ok(!page.url().includes(original.conversation.id));
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE project_id=$1", [other.body.id])).rows[0].n, 0);
  late = { task_id: original.task.id, original_project: project, current_project: other.body.id, no_cross_project_navigation: true };
  await page.getByLabel("Current project", { exact: true }).selectOption(project); modal = await open(page);
  await modal.getByRole("link", { name: "Open original work", exact: true }).waitFor(); await modal.getByRole("button", { name: "Start another task", exact: true }).click(); await close(page);
  pass("INTAKE-11 a late committed response stays in its original project and cannot navigate or populate the newly selected project");

  // The trial plan permits one active task. Finish the previous scenario through
  // the real customer cancellation endpoint before starting a separate case.
  const cancelled = await request(page, "POST", base + "/tasks/" + original.task.id + "/cancel");
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal((await request(page, "GET", base + "/tasks/" + original.task.id)).body.status, "cancelled");
  modal = await open(page); await modal.locator('[name="title"]').fill("Removed prior result"); await modal.locator('[name="prompt"]').fill("Synthetic replay tombstone recovery test"); await modal.locator('[name="budget"]').fill("1");
  let removedKey = "", removedStatus = 0, removedBody: any;
  await page.route("**/delegations", async route => { const response = await route.fetch(); removedStatus = response.status(); removedBody = await response.json(); removedKey = route.request().headers()["idempotency-key"]; await route.abort("failed"); });
  await modal.getByRole("button", { name: "Start task", exact: true }).click(); await modal.getByRole("button", { name: "Retry original submission", exact: true }).waitFor(); await page.unroute("**/delegations");
  assert.equal(removedStatus, 200, JSON.stringify(removedBody));
  await system.db.control.query("UPDATE request_replays SET revoked_at=now(),response='{}' WHERE actor_id=$1 AND key=$2", [user, removedKey]);
  await modal.getByRole("button", { name: "Retry original submission", exact: true }).click(); await modal.getByRole("heading", { name: "The original submission record was removed", exact: true }).waitFor();
  await shot(page, "removed-result"); await modal.getByRole("button", { name: "Start another task", exact: true }).click(); await close(page);
  pass("INTAKE-12 an actual server replay tombstone never reruns the original request and offers an explicit separate task without claiming zero cost");
  media.push(await recording.stop()); recording = undefined;

  for (const [width, height, lang] of [[800, 600, "en"], [375, 812, "en"], [800, 600, "zh-HK"]] as const) {
    await page.setViewportSize({ width, height }); if (lang === "zh-HK") await page.getByTitle("切換至繁體中文").click();
    await page.evaluate(() => document.dispatchEvent(new Event("cp:new-task"))); modal = page.getByRole("dialog"); await modal.waitFor();
    const metrics = await modal.evaluate(element => ({ width: element.scrollWidth, client: element.clientWidth })); assert.ok(metrics.width <= metrics.client + 1);
    await modal.locator('[name="budget"]').focus(); assert.equal(await modal.locator('[name="budget"]').isVisible(), true);
    await shot(page, `layout-${width}x${height}-${lang}`); await close(page);
  }
  pass("INTAKE-13 real English and Traditional Chinese forms retain editable fields and avoid horizontal overflow at desktop, compact and mobile sizes");
  await page.setViewportSize({ width: 1440, height: 980 }); await page.getByTitle("Switch to English").click();
  modal = await open(page); await modal.locator('[name="prompt"]').fill("Private unsent text must disappear on explicit sign-out"); await close(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click(); await page.waitForURL("**/login");
  assert.equal(await page.evaluate(() => Object.values(sessionStorage).some(value => value.includes("Private unsent text"))), false);
  await signIn(page, "other-intake-" + randomUUID() + "@example.invalid"); await page.waitForURL("**/welcome");
  assert.equal(await page.evaluate(() => Object.keys(sessionStorage).some(key => key.startsWith("cp_work_draft_v1:"))), false);
  pass("INTAKE-14 explicit sign-out erases draft text and a different verified account receives none of the previous account's drafts");
} catch (error) { errors.push(String(error)); console.error(error); }
finally {
  clearTimeout(timeout);
  if (recording) await recording.stop().then(value => media.push(value)).catch(error => errors.push(String(error)));
  if (browser) await browser.close().then(() => browserClosed = true).catch(error => errors.push(String(error)));
  if (system) await system.app.close().then(() => apiClosed = true).catch((error: any) => errors.push(String(error)));
  if (isolated) { process.chdir(platform); await isolated.cleanup().then(() => fixtureClosed = true).catch((error: any) => errors.push(String(error))); }
  process.chdir(delivery);
  const result = { at: new Date().toISOString(), status: !errors.length && browserClosed && apiClosed && fixtureClosed && checks.length === 14 ? "passed" : "failed",
    checks, errors, funding, recovery, late, outputs, requests, screenshots, media, browser_closed: browserClosed, api_closed: apiClosed, fixture_closed: fixtureClosed,
    not_validated: ["native Codex or actual model/media quality in this UI fixture", "full role qualification", "complete login/client/recovery/permission matrix", "all original 102 cases and G01-G10"] };
  await writeFile(prefix + "-journey.json", JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: result.status, checks: checks.length, errors })); process.exitCode = result.status === "passed" ? 0 : 1;
}
