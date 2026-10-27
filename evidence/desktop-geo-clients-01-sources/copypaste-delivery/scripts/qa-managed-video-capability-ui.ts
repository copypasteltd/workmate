import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";

const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const owned = path.resolve(".data/managed-video-capability-ui", randomUUID()), origin = "http://localhost:4318", root = "/v1/admin/capability-releases";
const checks: string[] = [], errors: string[] = [], screenshots: any[] = [], media: any[] = [], samples: any[] = [];
const load = (file: string) => import(pathToFileURL(path.join(platform, file)).href);
let isolated: any, system: any, provider: any, worker: any, browser: Browser | undefined, recording: WorkmateRecording | undefined;
let advancing: Promise<any> | undefined, browserClosed = false, apiClosed = false, fixtureClosed = false, providerClosed = false;
const controller = new AbortController(), validators: Record<string, any> = {};
const pass = (label: string) => { checks.push(label); console.log("PASS: " + label); };
const sample = (schema: string, value: any, route: string) => {
  assert.ok(validators[schema](value), JSON.stringify(validators[schema].errors)); samples.push({ schema, route, value }); return value;
};
async function until(read: () => Promise<any>, ok: (value: any) => boolean, label: string, ms = 45000) {
  const end = Date.now() + ms;
  do { const value = await read(); if (ok(value)) return value; await new Promise(resolve => setTimeout(resolve, 180)); } while (Date.now() < end);
  throw new Error("Timed out: " + label);
}
async function observed(page: Page, method: string, route: string, click: () => Promise<any>, schema: string, status = 200) {
  const [response] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === route && r.request().method() === method), click()]);
  assert.equal(response.status(), status, await response.text()); return sample(schema, await response.json(), method + " " + route);
}
async function api(page: Page, url: string, method = "GET", body?: any) {
  return page.evaluate(async ({ url, method, body }) => {
    const me = await (await fetch("/v1/admin/me", { credentials: "include" })).json();
    const response = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json", "X-CSRF-Token": me.csrf_token, "Idempotency-Key": crypto.randomUUID() },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  }, { url, method, body });
}
async function fit(page: Page) {
  const overflow = await page.evaluate(() => {
    const d = document.documentElement, dialog = document.querySelector('[role="dialog"]');
    return { page: d.scrollWidth - d.clientWidth, dialog: dialog ? dialog.scrollWidth - dialog.clientWidth : 0 };
  });
  assert.ok(overflow.page <= 1 && overflow.dialog <= 1, JSON.stringify(overflow));
}
async function shot(page: Page, name: string) {
  await page.evaluate(async () => { await document.fonts.ready; }); await fit(page);
  screenshots.push(await saveWorkmateScreenshot("admin", "managed-video-" + attempt, name, await page.screenshot(),
    "Actual Admin login, immutable releases, asynchronous verification, native MP4 decoding, scoped API and PostgreSQL. Video service/media are explicit isolated synthetic fixtures; not a live supplier acceptance.", delivery));
}
async function record(page: Page, name: string) {
  assert.equal(recording, undefined);
  recording = new WorkmateRecording("admin", name, "managed-video-" + attempt, () => page.screenshot({ type: "jpeg", quality: 85 }),
    "Actual Admin interaction and service observations in wall-clock time; synthetic internal video provider, actual MP4 bytes and native decoding; no invented progress or accelerated frames.", delivery);
  await recording.start();
}
async function stopRecording() { assert.ok(recording); media.push(await recording.stop()); recording = undefined; }
async function login(label: string, readOnly = false) {
  const require = createRequire(path.join(platform, "package.json")), OTPAuth = require("otpauth"), { seal } = await load("src/lib.ts");
  const email = "managed-video-ui-" + randomUUID() + "@example.invalid", secret = new OTPAuth.Secret({ size: 20 });
  const principal = (await system.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,$2,$3) RETURNING id", [email, label, seal(system.db.config.MASTER_KEY, secret.base32)])).rows[0].id;
  let role = "super_admin";
  if (readOnly) { role = "video-read-" + randomUUID(); await system.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)", [role, JSON.stringify(["admin.catalog.read"])]); }
  await system.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,$2,'global')", [principal, role]);
  const context = await browser!.newContext({ viewport: { width: 1440, height: 1050 } }); context.setDefaultTimeout(20000);
  await context.addInitScript(site => {
    if (location.origin !== site) return;
    if (!localStorage.getItem("cp_locale")) localStorage.setItem("cp_locale", "en");
    if (!localStorage.getItem("cp_theme")) localStorage.setItem("cp_theme", "light");
  }, origin);
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin); await page.getByLabel("Administrator email").fill(email);
  const [challenge] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === "/v1/admin/auth/challenge"), page.getByRole("button", { name: "Send admin sign-in code", exact: true }).click()]);
  assert.equal(challenge.status(), 200);
  const mail = JSON.parse(await readFile(path.join(isolated.directory, "mailbox", (await challenge.json()).challenge_id + ".json"), "utf8")); assert.equal(mail.to, email);
  await page.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);
  await page.locator('input[name="totp"]').fill(new OTPAuth.TOTP({ secret, digits: 6, period: 30, algorithm: "SHA1" }).generate());
  const [verified] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === "/v1/admin/auth/verify"), page.getByRole("button", { name: "Verify & open dashboard", exact: true }).click()]);
  assert.equal(verified.status(), 200); await page.waitForURL(readOnly ? "**/catalog" : "**/overview"); return page;
}
async function catalog(page: Page) {
  await page.goto("about:blank");
  await observed(page, "GET", root, () => page.goto(origin + "/catalog?view=capabilities"), "CapabilityReleaseList");
}
async function detail(page: Page, release: string) {
  await page.locator(`[data-release-id="${release}"]`).getByRole("button", { name: "Configuration & validation", exact: true }).click();
  const d = page.getByRole("dialog", { name: "Configuration & validation", exact: true }); await d.waitFor(); return d;
}
async function start(page: Page, release: string) {
  const d = page.getByRole("dialog", { name: "Configuration & validation", exact: true });
  await d.getByLabel("Validation reason", { exact: true }).fill("Explicit synthetic managed video browser verification");
  return observed(page, "POST", `${root}/${release}/validations`, () => d.getByRole("button", { name: "Run validation", exact: true }).click(), "CapabilityValidation", 202);
}
async function tick(id: string) {
  await system.db.control.query("UPDATE capability_video_suites SET next_poll_at=clock_timestamp() WHERE validation_id=$1", [id]);
  advancing = worker.advance(controller.signal, id);
  try { return await advancing; } finally { advancing = undefined; }
}
async function receipt(page: Page, id: string) {
  const r = await api(page, `${root}/validations/${id}`); assert.equal(r.status, 200); return sample("CapabilityValidation", r.data, "GET video receipt");
}
const deadline = setTimeout(() => { errors.push("Owned managed-video Admin UI deadline exceeded"); controller.abort(); void browser?.close(); }, 900000); deadline.unref();
try {
  await mkdir(owned, { recursive: true }); assert.ok(process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN);
  const { isolatedTestEnvironment } = await load("tests/native-test-environment.ts"), { capabilityVideoProvider } = await load("tests/capability-video-fixture.ts"),
    { buildApp } = await load("src/server.ts"), { loadConfig } = await load("src/config.ts"), { CapabilityVideoVerification } = await load("src/capability-video-verification.ts");
  process.chdir(platform); isolated = await isolatedTestEnvironment(); provider = await capabilityVideoProvider(owned);
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "false", DEMO_MODE: "false",
    CODEX_BIN: process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN, AI_BASE_URL: provider.origin, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "synthetic-video-capability-fixture",
    AI_MODEL: "synthetic-reasoning-v1", AI_VERIFIED: "true", AI_INPUT_HKD_MICROS_PER_MILLION: "100", AI_OUTPUT_HKD_MICROS_PER_MILLION: "100",
    AI_VIDEO_VERIFIED: "false", AI_VIDEO_POLL_INTERVAL_MS: "250", AI_VERIFICATION_PER_RUN_BUDGET_MICROS: "100000000", AI_PLATFORM_VERIFICATION_DAILY_BUDGET_MICROS: "1000000000000",
  }), { worker: false }); worker = new CapabilityVideoVerification(system.db, system.catalog); await system.app.listen({ host: "127.0.0.1", port: 4310 });
  const require = createRequire(path.join(platform, "package.json")), { Ajv2020 } = require("ajv/dist/2020.js"), ajv = new Ajv2020({ allErrors: true }); require("ajv-formats")(ajv);
  const definitions = JSON.parse(JSON.stringify(JSON.parse(await readFile(path.resolve(delivery, "../../docs/contracts/capability-releases.openapi.json"), "utf8")).components.schemas).replaceAll("#/components/schemas/", "#/$defs/"));
  for (const name of Object.keys(definitions)) validators[name] = ajv.compile({ $defs: definitions, $ref: "#/$defs/" + name });
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true });
  const page = await login("Video configuration administrator"), reviewer = await login("Independent video reviewer");
  pass("Actual administrator email challenge, TOTP session and distinct independent reviewer");
  await catalog(page); await record(page, "video-configuration-and-resume");
  await page.getByRole("button", { name: "Create configuration", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Create model configuration", exact: true });
  await form.getByLabel("Capability type", { exact: true }).selectOption("internal-video-v1");
  await form.getByLabel("Internal model alias", { exact: true }).fill("synthetic-marketing-video-ui-v1");
  await form.getByLabel("Rate per billable second (HKD)", { exact: true }).fill("0.10");
  await form.getByLabel("Operation reason", { exact: true }).fill("Synthetic company video capability for browser verification");
  await shot(page, "video-draft-en");
  const drafted = await observed(page, "POST", root + "/drafts", () => form.getByRole("button", { name: "Save configuration", exact: true }).click(), "AdminOperation", 202);
  const release = drafted.result_ids[0]; await page.getByRole("dialog", { name: "Configuration & validation", exact: true }).waitFor();
  const frozen = await api(page, root + "/" + release); sample("CapabilityRelease", frozen.data, "GET frozen video definition"); assert.equal(frozen.data.document.rates[0], 100000);
  provider.state.queued = true; const started = await start(page, release); assert.equal(started.state, "running"); assert.equal(started.video_suite.total_cases, 16);
  assert.equal(started.video_suite.quoted_micros, "18400000"); pass("Video draft serializes a positive per-second rate and a durable 16-case asynchronous receipt");
  await tick(started.id); await until(async () => (await receipt(page, started.id)).video_suite.cases.length, n => n === 1, "first queued case");
  await until(() => page.locator(".cap-video-suite").innerText(), text => text.includes("(pending reconciliation)"), "The actual queued observation reaches the view");
  await page.locator(".cap-video-suite").getByText("Verified cases 0 / 16", { exact: true }).waitFor(); await shot(page, "video-queued-en");
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  const first = (await receipt(page, started.id)).video_suite.cases[0]; provider.state.queued = false; await provider.complete(first.operation_id, 4); await tick(started.id);
  await detail(page, release); await page.locator(".cap-video-suite").getByText("Verified cases 1 / 16", { exact: true }).waitFor();
  await shot(page, "video-resumed-en"); await stopRecording();
  assert.equal(provider.calls.filter((c: any) => c.path === "/v1/videos").length, 1);
  pass("Closing and reopening the actual view resumes the original case without duplicate video creation or invented progress");
  for (let i = 1; i < 16; i++) { assert.equal(await tick(started.id), started.id); console.log("Observed managed video case " + (i + 1) + "/16"); }
  const passed = await receipt(page, started.id); assert.equal(passed.state, "passed"); assert.equal(passed.video_suite.verified_cases, 16);
  assert.equal(passed.video_suite.known_cost_micros, "18100000"); assert.equal(passed.video_suite.cases.filter((c: any) => c.media?.fully_decoded).length, 15);
  await page.getByRole("heading", { name: "Validation passed", exact: true }).waitFor();
  await page.getByText("View cases and actual media validation", { exact: true }).click(); await shot(page, "video-decoded-cases-en");
  await page.locator(".cap-video-suite").getByRole("progressbar", { name: "Verified cases", exact: true }).evaluate((p: HTMLProgressElement) => p.value).then(value => assert.equal(value, 16));
  pass("Fifteen actual MP4 specifications and a separately observed cancellation produce 16 verified cases with confirmed platform expense");
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click(); await catalog(page);
  await record(page, "video-independent-publication");
  await page.locator(`[data-release-id="${release}"]`).getByRole("button", { name: "Preview publication", exact: true }).click();
  const publication = page.getByRole("dialog", { name: "Publish model configuration", exact: true });
  await publication.getByLabel("Operation reason", { exact: true }).fill("Independent browser review of synthetic video model and price");
  const preview = await observed(page, "POST", `${root}/${release}/publications-previews`, () => publication.getByRole("button", { name: "Compare configurations", exact: true }).click(), "CapabilityPublicationPreview");
  assert.equal(preview.before.proposed.document.profile_key, "internal-video-v1"); await shot(page, "video-publication-comparison-en");
  await publication.getByRole("checkbox").check();
  const operation = await observed(page, "POST", `${root}/${release}/publications`, () => publication.getByRole("button", { name: "Request independent approval", exact: true }).click(), "AdminOperation", 202);
  assert.equal(operation.state, "pending_approval"); await publication.getByRole("link", { name: "View approval", exact: true }).click();
  await page.getByRole("button", { name: "Review operation", exact: true }).click();
  const self = page.getByRole("dialog", { name: "Independent review", exact: true });
  await self.getByText("Another administrator must review this operation.", { exact: true }).waitFor(); assert.equal(await self.getByRole("button", { name: "Confirm review decision", exact: true }).count(), 0);
  await self.getByRole("button", { name: "Close", exact: true }).click(); await stopRecording();
  await reviewer.goto(origin + "/audit?view=approvals&search=" + operation.id); await reviewer.getByRole("button", { name: "Review operation", exact: true }).click();
  const review = reviewer.getByRole("dialog", { name: "Independent review", exact: true });
  await review.getByLabel("Proposed model configuration", { exact: true }).waitFor(); await shot(reviewer, "video-independent-review-en");
  await review.getByLabel("Decision", { exact: true }).selectOption("approve"); await review.getByLabel("Review reason", { exact: true }).fill("Independently checked synthetic video model, per-second price and actual verification");
  const [decision] = await Promise.all([reviewer.waitForResponse(r => /\/v1\/admin\/approvals\/[^/]+\/decisions$/.test(new URL(r.url()).pathname) && r.request().method() === "POST"), review.getByRole("button", { name: "Confirm review decision", exact: true }).click()]);
  assert.equal(decision.status(), 202); assert.equal(sample("AdminOperation", await decision.json(), "POST independent approval").state, "succeeded");
  assert.equal((await system.db.control.query("SELECT release_id FROM current_internal_capabilities WHERE profile_key='internal-video-v1' AND data_mode='configured_services'")).rows[0].release_id, release);
  assert.equal(system.db.config.AI_VIDEO_VERIFIED, false); pass("Video publication compares the actual model and rate, denies self-review and requires a distinct administrator approval");
  await catalog(page); await detail(page, release); provider.state.usageUnknown = true;
  const uncertain = await start(page, release); await tick(uncertain.id); const original = (await receipt(page, uncertain.id)).video_suite.cases[0];
  await record(page, "video-cancellation-and-cost-recovery");
  const suite = page.locator(".cap-video-suite"); await suite.getByLabel("Video verification action", { exact: true }).selectOption("video-cancellations");
  await suite.getByLabel("Operation reason", { exact: true }).fill("Stop synthetic video verification and reconcile original usage");
  await observed(page, "POST", `${root}/validations/${uncertain.id}/video-cancellations`, () => suite.getByRole("button", { name: "Apply action", exact: true }).click(), "CapabilityValidation", 202);
  await tick(uncertain.id); const unresolved = await receipt(page, uncertain.id); assert.equal(unresolved.state, "reconciling"); assert.equal(unresolved.video_suite.usage_known, false);
  await page.getByRole("heading", { name: "Pending reconciliation", exact: true }).waitFor(); assert.equal(await page.getByRole("button", { name: "Run validation", exact: true }).isDisabled(), true);
  await shot(page, "video-unknown-final-cost-en");
  await provider.complete(original.operation_id, 4); provider.state.usageUnknown = false;
  await suite.getByLabel("Operation reason", { exact: true }).fill("Explicitly recheck the original synthetic video resource"); await suite.getByLabel("Video verification action", { exact: true }).selectOption("video-rechecks");
  await observed(page, "POST", `${root}/validations/${uncertain.id}/video-rechecks`, () => suite.getByRole("button", { name: "Apply action", exact: true }).click(), "CapabilityValidation", 202);
  await tick(uncertain.id); const recovered = await receipt(page, uncertain.id); assert.equal(recovered.state, "reconciling"); assert.equal(recovered.video_suite.usage_known, true); assert.equal(recovered.video_suite.known_cost_micros, "400000");
  await until(() => page.getByRole("button", { name: "Run validation", exact: true }).isEnabled(), Boolean, "Confirmed fees allow an explicitly new validation");
  await suite.getByText("The original eligibility decision stays unchanged. Running validation again creates a new receipt and new billable service calls.", { exact: true }).waitFor();
  await suite.getByText("The stop request was processed; usage for all dispatched jobs is confirmed.", { exact: true }).waitFor();
  await shot(page, "video-confirmed-cost-immutable-eligibility-en"); await stopRecording();
  const creates = provider.calls.filter((c: any) => c.path === "/v1/videos").length;
  const retry = await start(page, release); assert.notEqual(retry.id, uncertain.id); assert.equal(provider.calls.filter((c: any) => c.path === "/v1/videos").length, creates);
  const stopped = await api(page, `${root}/validations/${retry.id}/video-cancellations`, "POST", { expected_version: frozen.data.version, reason: "Reclaim the explicitly new undispatched UI fixture" }); assert.equal(stopped.status, 202); await tick(retry.id);
  assert.equal((await receipt(page, retry.id)).state, "cancelled"); pass("Cancellation retains unknown fees and blocks revalidation; original-resource reconciliation preserves eligibility and enables only an explicit new receipt");
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.getByTitle("切換至繁體中文", { exact: true }).click(); await page.getByTitle("Theme: light / dark / system", { exact: true }).click();
  await page.locator(`[data-release-id="${release}"]`).getByRole("button", { name: "配置與驗證", exact: true }).click();
  await page.getByRole("dialog", { name: "配置與驗證", exact: true }).waitFor(); await shot(page, "video-zh-dark");
  await page.setViewportSize({ width: 520, height: 920 }); await shot(page, "video-zh-dark-narrow");
  await page.keyboard.press("Tab"); assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), true);
  const readOnly = await login("Video configuration read-only observer", true); await catalog(readOnly);
  assert.equal(await readOnly.getByRole("button", { name: "Create configuration", exact: true }).count(), 0);
  await detail(readOnly, release); assert.equal(await readOnly.getByRole("button", { name: "Run validation", exact: true }).count(), 0);
  assert.equal(await readOnly.getByLabel("Video verification action", { exact: true }).count(), 0); await shot(readOnly, "video-read-only-en");
  pass("Actual Chinese dark and narrow layouts fit without horizontal overflow, preserve keyboard focus and hide mutations for read-only administrators");
  assert.deepEqual(provider.errors, []);
} catch (error) {
  errors.push(error instanceof Error ? error.stack ?? error.message : String(error)); console.error(errors.at(-1));
  for (const [index, page] of (browser?.contexts().flatMap(context => context.pages()) ?? []).entries()) if (!page.isClosed()) {
    await page.screenshot({ path: path.join(owned, "failure-" + index + ".png") }).catch(() => {});
    await writeFile(path.join(owned, "failure-" + index + ".json"), JSON.stringify({ url: page.url(), text: await page.locator("body").innerText().catch(() => "unavailable") }, null, 2), { flag: "wx" }).catch(() => {});
  }
} finally {
  clearTimeout(deadline); controller.abort(); if (advancing) await advancing.catch(() => {});
  if (recording) try { media.push(await recording.stop()); } catch (error) { errors.push(String(error)); }
  if (browser) await browser.close().then(() => { browserClosed = true; }).catch(error => errors.push(String(error)));
  if (system) await system.app.close().then(() => { apiClosed = true; }).catch((error: any) => errors.push(String(error)));
  if (provider) await provider.close().then(() => { providerClosed = true; }).catch((error: any) => errors.push(String(error)));
  if (isolated) { process.chdir(platform); await isolated.cleanup().then(() => { fixtureClosed = true; }).catch((error: any) => errors.push(String(error))); } process.chdir(delivery);
  const result = { at: new Date().toISOString(), status: !errors.length && browserClosed && apiClosed && fixtureClosed && providerClosed ? "passed" : "failed", checks, errors, screenshots, media, samples,
    browser_closed: browserClosed, api_closed: apiClosed, fixture_closed: fixtureClosed, provider_closed: providerClosed,
    route_inventory: system ? { contract: "actual_fastify_route_inventory", not_full_design_openapi: true, data_mode: "configured_services", routes: [...system.routes].sort((a: any, b: any) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)) } : null,
    not_validated: ["live_company_video_provider", "professional_marketing_output", "full_product_acceptance", "all_original_requirements"] };
  await writeFile(`evidence/managed-video-capability-ui-${attempt}-journey.json`, JSON.stringify(result, null, 2) + "\n", { flag: "wx" }); assert.equal(result.status, "passed", JSON.stringify(errors));
}
