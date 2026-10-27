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
const owned = path.resolve(".data/managed-audio-capability-ui", randomUUID()), origin = "http://localhost:4318", root = "/v1/admin/capability-releases";
const checks: string[] = [], errors: string[] = [], screenshots: any[] = [], media: any[] = [], samples: any[] = [];
const load = (file: string) => import(pathToFileURL(path.join(platform, file)).href);
let isolated: any, system: any, provider: any, browser: Browser | undefined, recording: WorkmateRecording | undefined;
let browserClosed = false, apiClosed = false, fixtureClosed = false, providerClosed = false;
const controller = new AbortController(), validators: Record<string, any> = {};
let releaseProviderReply: (() => void) | undefined;
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
  screenshots.push(await saveWorkmateScreenshot("admin", "managed-audio-" + attempt, name, await page.screenshot(),
    "Actual Admin login, immutable audio releases, native decoding, background processor, scoped API and PostgreSQL. Models/accounts and audio provider are explicitly synthetic; not live voice-quality acceptance.", delivery));
}
async function record(page: Page, name: string) {
  assert.equal(recording, undefined);
  recording = new WorkmateRecording("admin", name, "managed-audio-" + attempt, () => page.screenshot({ type: "jpeg", quality: 85 }),
    "Actual Admin interaction and background service observations in wall-clock time; synthetic company audio provider and original protocol tones; no invented progress or accelerated frames.", delivery);
  await recording.start();
}
async function stopRecording() { assert.ok(recording); media.push(await recording.stop()); recording = undefined; }
async function login(label: string, readOnly = false) {
  const require = createRequire(path.join(platform, "package.json")), OTPAuth = require("otpauth"), { seal } = await load("src/lib.ts");
  const email = "managed-audio-ui-" + randomUUID() + "@example.invalid", secret = new OTPAuth.Secret({ size: 20 });
  const principal = (await system.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,$2,$3) RETURNING id", [email, label, seal(system.db.config.MASTER_KEY, secret.base32)])).rows[0].id;
  let role = "super_admin";
  if (readOnly) { role = "audio-read-" + randomUUID(); await system.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)", [role, JSON.stringify(["admin.catalog.read"])]); }
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
  await d.getByLabel("Validation reason", { exact: true }).fill("Explicit synthetic managed audio browser verification");
  return observed(page, "POST", `${root}/${release}/validations`, () => d.getByRole("button", { name: "Run validation", exact: true }).click(), "CapabilityValidation", 202);
}
async function receipt(page: Page, id: string) {
  const r = await api(page, `${root}/validations/${id}`); assert.equal(r.status, 200); return sample("CapabilityValidation", r.data, "GET audio receipt");
}
const deadline = setTimeout(() => { errors.push("Owned managed-audio Admin UI deadline exceeded"); controller.abort(); void browser?.close(); }, 900000); deadline.unref();
try {
  await mkdir(owned, { recursive: true }); assert.ok(process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN);
  const { isolatedTestEnvironment } = await load("tests/native-test-environment.ts"), { audioProviderFixture } = await load("tests/audio-production-fixture.ts"),
    { buildApp } = await load("src/server.ts"), { loadConfig } = await load("src/config.ts");
  process.chdir(platform); isolated = await isolatedTestEnvironment(); provider = await audioProviderFixture(owned, { allowPlatformVerification: true });
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "true", DEMO_MODE: "false",
    CODEX_BIN: process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN, AI_BASE_URL: provider.origin, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "synthetic-video-provider-fixture",
    AI_MODEL: "synthetic-reasoning-v1", AI_VERIFIED: "true", AI_INPUT_HKD_MICROS_PER_MILLION: "100", AI_OUTPUT_HKD_MICROS_PER_MILLION: "100",
    AI_SPEECH_VERIFIED: "false", AI_TRANSCRIPTION_VERIFIED: "false", AI_VERIFICATION_PER_RUN_BUDGET_MICROS: "1000000", AI_PLATFORM_VERIFICATION_DAILY_BUDGET_MICROS: "1000000000000",
  }));
  const capacity = async (slots = 1000) => {
    const row = (await system.db.control.query(`INSERT INTO ai_gateway_policy_versions(data_mode,version,reason,
      global_slots,tenant_slots,actor_slots,text_slots,image_slots,video_slots,audio_slots,verification_slots,
      global_rpm,tenant_rpm,actor_rpm,text_rpm,image_rpm,video_rpm,audio_rpm,verification_rpm,preparation_seconds)
      SELECT 'configured_services',coalesce(max(version),0)+1,'Explicit synthetic managed audio browser capacity',
      1000,1000,1000,1000,1000,1000,$1,1000,100000,100000,100000,100000,100000,100000,100000,100000,30
      FROM ai_gateway_policy_versions WHERE data_mode='configured_services' RETURNING id`, [slots])).rows[0];
    await system.db.control.query("UPDATE ai_gateway_policy_heads SET policy_version_id=$1 WHERE data_mode='configured_services'", [row.id]);
  };
  await capacity(); await system.app.listen({ host: "127.0.0.1", port: 4310 });
  const require = createRequire(path.join(platform, "package.json")), { Ajv2020 } = require("ajv/dist/2020.js"), ajv = new Ajv2020({ allErrors: true }); require("ajv-formats")(ajv);
  const definitions = JSON.parse(JSON.stringify(JSON.parse(await readFile(path.resolve(delivery, "../../docs/contracts/managed-audio-capabilities.openapi.json"), "utf8")).components.schemas).replaceAll("#/components/schemas/", "#/$defs/"));
  for (const name of Object.keys(definitions)) validators[name] = ajv.compile({ $defs: definitions, $ref: "#/$defs/" + name });
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true });
  const page = await login("Audio configuration administrator"), reviewer = await login("Independent audio reviewer");
  pass("Actual administrator email challenge, TOTP session and distinct independent reviewer");
  async function create(profile: string, model: string, price: string) {
    await catalog(page); await page.getByRole("button", { name: "Create configuration", exact: true }).click();
    const form = page.getByRole("dialog", { name: "Create model configuration", exact: true });
    await form.getByLabel("Capability type", { exact: true }).selectOption(profile);
    await form.getByLabel("Internal model alias", { exact: true }).fill(model);
    await form.getByLabel("Locale codes", { exact: true }).fill("en");
    if (profile === "internal-speech-v1") await form.getByLabel("Company voice IDs", { exact: true }).fill("alloy");
    else await form.locator('input[name="timestamps"]').check();
    await form.locator('input[name="audio_rate"]').fill(price);
    await form.getByLabel("Operation reason", { exact: true }).fill("Explicit synthetic audio configuration for actual browser verification");
    await shot(page, profile === "internal-speech-v1" ? "speech-draft-en" : "transcription-draft-en");
    const drafted = await observed(page, "POST", root + "/drafts", () => form.getByRole("button", { name: "Save configuration", exact: true }).click(), "AdminOperation", 202);
    await page.getByRole("dialog", { name: "Configuration & validation", exact: true }).waitFor();
    const release = drafted.result_ids[0], frozen = await api(page, root + "/" + release); sample("CapabilityRelease", frozen.data, "GET frozen audio definition");
    return { release, frozen: frozen.data };
  }
  await record(page, "audio-configuration-and-background-resume");
  const { release, frozen } = await create("internal-speech-v1", "synthetic-managed-speech-ui-v1", "0.0001");
  assert.equal(frozen.document.rates[0], 100); assert.equal(frozen.audio_verification_plan.total_cases, 3);
  const held = new Promise<void>(resolve => { releaseProviderReply = resolve; });
  provider.state.beforeReply = async () => { provider.state.beforeReply = undefined; await held; };
  const count = provider.calls.length, started = await start(page, release);
  assert.equal(started.audio_suite.total_cases, 3); assert.equal(started.state, "running");
  await until(() => Promise.resolve(provider.calls.length), n => n === count + 1, "original audio POST dispatched by the actual background Worker");
  const original = await receipt(page, started.id); assert.equal(original.audio_suite.cases[0].state, "dispatched");
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click(); releaseProviderReply!();
  await until(() => receipt(page, started.id), r => r.state === "passed", "original background suite completes while its view is closed", 90000);
  await detail(page, release); await page.locator('[aria-label="Audio validation progress"]').getByText("Verified cases 3 / 3", { exact: true }).waitFor();
  await page.locator('[aria-label="Audio validation progress"]').getByText("View audio cases and media validation", { exact: true }).click();
  await page.locator('[aria-label="Audio validation progress"]').scrollIntoViewIfNeeded();
  assert.equal(provider.calls.length, count + 3); await shot(page, "speech-completed-en"); await stopRecording();
  pass("Exact speech rate and fixed voice/locale/speed cases persist; the actual background Worker completes after closing and reopening the view without duplicate POSTs");
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await record(page, "audio-independent-publication");
  await page.locator(`[data-release-id="${release}"]`).getByRole("button", { name: "Preview publication", exact: true }).click();
  const publication = page.getByRole("dialog", { name: "Publish model configuration", exact: true });
  await publication.getByLabel("Operation reason", { exact: true }).fill("Independent browser review of synthetic speech model, locale, voice and rate");
  const preview = await observed(page, "POST", `${root}/${release}/publications-previews`, () => publication.getByRole("button", { name: "Compare configurations", exact: true }).click(), "CapabilityPublicationPreview");
  assert.equal(preview.before.proposed.document.profile_key, "internal-speech-v1"); await shot(page, "speech-publication-comparison-en");
  await publication.getByRole("checkbox").check();
  const operation = await observed(page, "POST", `${root}/${release}/publications`, () => publication.getByRole("button", { name: "Request independent approval", exact: true }).click(), "AdminOperation", 202);
  await publication.getByRole("link", { name: "View approval", exact: true }).click(); await page.getByRole("button", { name: "Review operation", exact: true }).click();
  const self = page.getByRole("dialog", { name: "Independent review", exact: true }); await self.getByText("Another administrator must review this operation.", { exact: true }).waitFor();
  assert.equal(await self.getByRole("button", { name: "Confirm review decision", exact: true }).count(), 0);
  await self.getByRole("button", { name: "Close", exact: true }).click();
  await reviewer.goto(origin + "/audit?view=approvals&search=" + operation.id); await reviewer.getByRole("button", { name: "Review operation", exact: true }).click();
  const review = reviewer.getByRole("dialog", { name: "Independent review", exact: true }); await review.getByLabel("Proposed model configuration", { exact: true }).waitFor();
  await shot(reviewer, "speech-independent-review-en"); await review.getByLabel("Decision", { exact: true }).selectOption("approve");
  await review.getByLabel("Review reason", { exact: true }).fill("Independently checked fixed voice, locale and platform-funded protocol evidence");
  const [decision] = await Promise.all([reviewer.waitForResponse(r => /\/v1\/admin\/approvals\/[^/]+\/decisions$/.test(new URL(r.url()).pathname) && r.request().method() === "POST"), review.getByRole("button", { name: "Confirm review decision", exact: true }).click()]);
  assert.equal(decision.status(), 202); assert.equal(sample("AdminOperation", await decision.json(), "POST independent audio approval").state, "succeeded");
  assert.equal((await system.db.control.query("SELECT release_id FROM current_internal_capabilities WHERE profile_key='internal-speech-v1' AND data_mode='configured_services'")).rows[0].release_id, release);
  assert.equal(system.db.config.AI_SPEECH_VERIFIED, false); await stopRecording();
  pass("Actual model/voice/locale/price comparison, self-review denial and independent approval publish speech while its environment flag remains false");
  const trans = await create("internal-transcription-v1", "synthetic-managed-transcription-ui-v1", "0.000001");
  const transStarted = await start(page, trans.release);
  const transPassed = await until(() => receipt(page, transStarted.id), r => r.state === "passed", "WAV/MP3 JSON and timestamp cases", 90000);
  assert.equal(transPassed.audio_suite.verified_cases, 4); assert.ok(transPassed.audio_suite.cases.every((c: any) => c.media.input.fully_decoded));
  await page.locator('[aria-label="Audio validation progress"]').getByText("Verified cases 4 / 4", { exact: true }).waitFor();
  await page.locator('[aria-label="Audio validation progress"]').getByText("View audio cases and media validation", { exact: true }).click();
  await page.locator('[aria-label="Audio validation progress"]').scrollIntoViewIfNeeded();
  await shot(page, "transcription-formats-and-timestamps-en");
  pass("Actual transcription configuration runs both WAV and MP3, ordinary JSON and ordered segment times with complete input decoding");
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click(); await catalog(page); await detail(page, release);
  await capacity(0); const beforeStop = provider.calls.length, stopped = await start(page, release);
  const stopSuite = page.locator('[aria-label="Audio validation progress"]');
  await stopSuite.getByLabel("Reason to stop audio validation", { exact: true }).fill("Stop the undispatched original audio suite");
  await observed(page, "POST", `${root}/validations/${stopped.id}/audio-cancellations`, () => stopSuite.getByRole("button", { name: "Stop further cases", exact: true }).click(), "CapabilityValidation", 202);
  await until(() => receipt(page, stopped.id), r => r.state === "cancelled", "explicit cancellation before dispatch");
  assert.equal(provider.calls.length, beforeStop); assert.equal((await receipt(page, stopped.id)).result.known_cost_micros, "0"); await capacity();
  pass("Actual stop action cancels an undispatched suite for zero charge while company audio capacity is unavailable");
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click(); await detail(page, release);
  await record(page, "audio-unknown-response-and-no-replay"); provider.state.drop = true;
  const beforeUnknown = provider.calls.length, uncertain = await start(page, release);
  await until(() => receipt(page, uncertain.id), r => r.state === "reconciling", "unknown original audio POST retained");
  await page.getByRole("heading", { name: "Pending reconciliation", exact: true }).waitFor(); assert.equal(await page.getByRole("button", { name: "Run validation", exact: true }).isDisabled(), true);
  await page.locator('[aria-label="Audio validation progress"]').getByText("The original audio response and cost are unknown. Its quote remains held and automatic resubmission is stopped.", { exact: true }).waitFor();
  assert.equal(provider.calls.length, beforeUnknown + 1); await shot(page, "speech-unknown-fee-no-replay-en"); await stopRecording();
  pass("A real dropped company POST retains unknown cost and disables repeat validation in the actual browser without automatic replay");
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.getByTitle("切換至繁體中文", { exact: true }).click(); await page.getByTitle("Theme: light / dark / system", { exact: true }).click();
  await page.locator(`[data-release-id="${release}"]`).getByRole("button", { name: "配置與驗證", exact: true }).click(); await shot(page, "speech-zh-dark");
  await page.setViewportSize({ width: 640, height: 1000 }); await shot(page, "speech-zh-narrow");
  await page.keyboard.press("Tab"); assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), true);
  pass("Chinese dark and narrow layouts fit without horizontal overflow and preserve dialog keyboard focus");
  const readOnly = await login("Audio configuration read-only observer", true); await catalog(readOnly);
  assert.equal(await readOnly.getByRole("button", { name: "Create configuration", exact: true }).count(), 0); await detail(readOnly, release);
  assert.equal(await readOnly.getByRole("button", { name: "Run validation", exact: true }).count(), 0);
  assert.equal(await readOnly.getByRole("button", { name: "Stop further cases", exact: true }).count(), 0); await shot(readOnly, "speech-read-only-en");
  assert.deepEqual(provider.errors, []); pass("A separately authenticated read-only administrator sees frozen audio evidence and no draft/validation/cancellation controls");
} catch (error) {
  errors.push(error instanceof Error ? error.stack ?? error.message : String(error)); console.error(errors.at(-1));
  for (const [index, page] of (browser?.contexts().flatMap(context => context.pages()) ?? []).entries()) if (!page.isClosed()) {
    await page.screenshot({ path: path.join(owned, "failure-" + index + ".png") }).catch(() => {});
    await writeFile(path.join(owned, "failure-" + index + ".json"), JSON.stringify({ url: page.url(), text: await page.locator("body").innerText().catch(() => "unavailable") }, null, 2), { flag: "wx" }).catch(() => {});
  }
} finally {
  clearTimeout(deadline); controller.abort(); releaseProviderReply?.();
  if (recording) try { media.push(await recording.stop()); } catch (error) { errors.push(String(error)); }
  if (browser) await browser.close().then(() => { browserClosed = true; }).catch(error => errors.push(String(error)));
  if (system) await system.app.close().then(() => { apiClosed = true; }).catch((error: any) => errors.push(String(error)));
  if (provider) await provider.close().then(() => { providerClosed = true; }).catch((error: any) => errors.push(String(error)));
  if (isolated) { process.chdir(platform); await isolated.cleanup().then(() => { fixtureClosed = true; }).catch((error: any) => errors.push(String(error))); } process.chdir(delivery);
  const result = { at: new Date().toISOString(), status: !errors.length && browserClosed && apiClosed && fixtureClosed && providerClosed ? "passed" : "failed", checks, errors, screenshots, media, samples,
    browser_closed: browserClosed, api_closed: apiClosed, fixture_closed: fixtureClosed, provider_closed: providerClosed,
    route_inventory: system ? { contract: "actual_fastify_route_inventory", not_full_design_openapi: true, data_mode: "configured_services", routes: [...system.routes].sort((a: any, b: any) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)) } : null,
    not_validated: ["live_company_audio_provider", "live_voice_transcription_and_Cantonese_quality", "full_product_acceptance", "all_original_requirements"] };
  await writeFile(`evidence/managed-audio-capability-ui-${attempt}-journey.json`, JSON.stringify(result, null, 2) + "\n", { flag: "wx" }); assert.equal(result.status, "passed", JSON.stringify(errors));
}
