import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";

const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), attempt = process.argv[2]; assert.match(attempt ?? "", /^\d{2}$/);
const owned = path.resolve(".data/generated-video-ui", randomUUID()), checks: string[] = [], errors: string[] = [], screenshots: any[] = [], media: any[] = [], samples: any[] = [];
const pass = (label: string) => { checks.push(label); console.log("PASS: " + label); }, hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
let isolated: any, system: any, provider: any, browser: Browser | undefined, recording: WorkmateRecording | undefined, worker: any, work: Promise<any> | undefined;
let browserClosed = false, apiClosed = false, fixtureClosed = false, providerClosed = false;
const load = (file: string) => import(pathToFileURL(path.join(platform, file)).href);
async function until(read: () => Promise<any>, ok: (value: any) => boolean, label: string, ms = 40000) {
  const end = Date.now() + ms; do { const value = await read(); if (ok(value)) return value; await new Promise(resolve => setTimeout(resolve, 150)); } while (Date.now() < end); throw new Error("Timed out: " + label);
}
async function api(page: Page, url: string, method = "GET", body?: any) {
  return page.evaluate(async ({ url, method, body }) => {
    const session = await (await fetch(url.startsWith("/v1/admin") ? "/v1/admin/me" : "/v1/session/context", { credentials: "include" })).json();
    const result = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf_token ?? "", "Idempotency-Key": crypto.randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: result.status, data: await result.json() };
  }, { url, method, body });
}
async function signIn(page: Page, email: string, admin = false, totp?: any) {
  const prefix = admin ? "/v1/admin/auth" : "/v1/auth";
  await page.goto(admin ? "http://localhost:4318" : "http://localhost:4317/login"); await page.locator('input[name="email"]').fill(email);
  const [response] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === prefix + (admin ? "/challenge" : "/challenges")), page.locator('form button[type="submit"]').click()]);
  assert.equal(response.status(), admin ? 200 : 202); const challenge = await response.json();
  const mail = JSON.parse(await readFile(path.join(isolated.directory, "mailbox", challenge.challenge_id + ".json"), "utf8"));
  await page.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]); if (admin) await page.locator('input[name="totp"]').fill(totp.generate());
  const [verified] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === prefix + (admin ? "/verify" : "/sessions") && r.request().method() === "POST"), page.locator('form button[type="submit"]').click()]);
  assert.equal(verified.status(), admin ? 200 : 201, await verified.text()); return verified.json();
}
const shot = async (page: Page, repo: string, name: string) => { await page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))); }); screenshots.push(await saveWorkmateScreenshot(repo, "generated-" + attempt, name, await page.screenshot(), "Actual company page/API/database and actual decoded/downloaded MP4. Reasoning, video content, customer and service observations are explicit isolated fixtures.", delivery)); };
const deadline = setTimeout(() => { errors.push("Owned generated-video UI deadline exceeded"); void worker?.stop().catch(() => {}); void browser?.close(); }, 300000);
try {
  await mkdir(owned, { recursive: true });
  const { isolatedTestEnvironment } = await load("tests/native-test-environment.ts"), { generatedVideoProvider } = await load("tests/generated-video-fixture.ts"), { buildApp } = await load("src/server.ts"), { loadConfig } = await load("src/config.ts"), { Worker } = await load("src/worker.ts"), { CodexRuntimeAdapter } = await load("src/runtime.ts"), { defaults } = await load("src/plans.ts"), { seal } = await load("src/lib.ts");
  process.chdir(platform); isolated = await isolatedTestEnvironment(); provider = await generatedVideoProvider(owned);
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "false", DEMO_MODE: "false",
    AI_BASE_URL: provider.origin, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "synthetic-video-provider-fixture", AI_MODEL: "synthetic-video-reasoning-v1", AI_VERIFIED: "true",
    AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000", AI_INPUT_COUNT_VERIFIED: "true", AI_INPUT_COUNT_HKD_MICROS_PER_CALL: "0",
    AI_VIDEO_MODEL: "synthetic-video-async-v1", AI_VIDEO_VERIFIED: "true", AI_VIDEO_HKD_MICROS_PER_SECOND: "100000", AI_VIDEO_POLL_INTERVAL_MS: "250",
  }), { worker: false }); await system.app.listen({ host: "127.0.0.1", port: 4310 });
  const require = createRequire(path.join(platform, "package.json")), { Ajv2020 } = require("ajv/dist/2020.js"), ajv = new Ajv2020({ allErrors: true }); require("ajv-formats")(ajv);
  const contract = JSON.parse(await readFile(path.resolve(delivery, "../../docs/contracts/generated-video-openapi.json"), "utf8")), defs = contract.components.schemas;
  const validators = Object.fromEntries(Object.keys(defs).map(name => [name, ajv.compile({ $defs: defs, $ref: "#/$defs/" + name })]));
  const sample = (name: string, value: any) => { assert.ok(validators[name](value), JSON.stringify(validators[name].errors)); samples.push({ schema: name, value }); return value; };
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true });
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 }, acceptDownloads: true }); await context.addInitScript(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); });
  const page = await context.newPage(); page.setDefaultTimeout(20000); page.on("pageerror", error => errors.push(error.message));
  await signIn(page, "generated-ui-" + randomUUID() + "@example.invalid");
  await page.locator('input[name="name"]').fill("Harbour Studio"); await page.locator('input[name="project_name"]').fill("Synthetic video launch");
  await page.getByRole("button", { name: "Create workspace & continue", exact: true }).click();
  const identity = await until(async () => (await api(page, "/v1/session/context")).data, value => value.memberships?.length === 1, "actual Web onboarding");
  const tenant = identity.memberships[0].id, project = (await api(page, `/v1/tenants/${tenant}/projects`)).data.items[0].id, base = `/v1/tenants/${tenant}/projects/${project}`;
  await system.db.control.query("UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1", [tenant]);
  await system.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Owned synthetic generation UI fixture',$2)", [tenant, defaults.business]);
  await page.goto("http://localhost:4317/app/tasks");
  const create = async (title: string) => {
    await page.locator("button.new-task-side").click(); const dialog = page.getByRole("dialog");
    await dialog.locator('select[name="role"]').selectOption("video-motion"); await dialog.locator('input[name="title"]').fill(title);
    await dialog.locator('textarea[name="prompt"]').fill("Generate an explicitly synthetic four-second landscape clip for interface verification.");
    await dialog.locator('[name="video_mode"]').selectOption("generated"); await dialog.locator('[name="video_seconds"]').selectOption("4"); await dialog.locator('[name="video_size"]').selectOption("1280x720");
    const [response] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === base + "/tasks" && r.request().method() === "POST"), dialog.getByRole("button", { name: "Start task", exact: true }).click()]);
    assert.equal(response.status(), 200, await response.text()); const task = await response.json();
    const stored = (await system.db.control.query("SELECT prompt FROM tasks WHERE id=$1", [task.id])).rows[0]; assert.ok(stored.prompt.includes('"seconds":4') && stored.prompt.includes('"size":"1280x720"')); return task;
  };
  class UiRuntime extends CodexRuntimeAdapter {
    constructor(config: any) { super(config); }
    async start(ctx: any) {
      const value = await ctx.tools.find((tool: any) => tool.name === "generated_video_create").run({ prompt: "Explicit synthetic company four-second clip", seconds: 4, size: "1280x720" }, "web_generated_ui_" + randomUUID());
      assert.ok(["completed", "cancelled"].includes(value.state));
      return { status: "completed", text: value.state === "completed" ? "The synthetic clip is ready for review." : "The synthetic clip was cancelled. Review its confirmed usage.", thread: "generated-ui-" + randomUUID(), turn: randomUUID(), inputTokens: 0, outputTokens: 0, usageKnown: true, accepted: true };
    }
  }
  worker = new Worker(system.db, system.catalog, system.storage, new UiRuntime(system.db.config));
  recording = new WorkmateRecording("web", "generated-video", "generated-" + attempt, () => page.screenshot({ type: "jpeg", quality: 85 }), "Actual Web generation form, service-reported progress, MP4 playback/save and cancellation; reasoning/video content are explicit fixtures", delivery); await recording.start();
  provider.state.initial = "queued"; provider.state.initialUsage = null;
  const first = await create("Synthetic launch clip"); work = worker.run(tenant, first.id); work!.catch(() => {});
  const firstJob = await until(async () => (await system.db.control.query("SELECT * FROM ai_video_jobs WHERE task_id=$1", [first.id])).rows[0], value => value?.provider_id, "durable queued cloud video");
  provider.update(firstJob.operation_id, { status: "in_progress", progress: 35 });
  const card = page.locator(`[data-generated-video-job="${firstJob.id}"]`); await card.waitFor();
  await until(() => card.locator("progress").getAttribute("value"), value => value === "35", "actual Web reported progress");
  assert.equal(await card.getByRole("button", { name: "Download video", exact: true }).count(), 0); await card.scrollIntoViewIfNeeded(); await shot(page, "web", "progress-en");
  sample("GeneratedVideoList", (await api(page, base + "/generated-video-jobs?task_id=" + first.id)).data);
  pass("Actual Web OTP/onboarding and generation form freeze duration/format in the task and show only service-reported progress with the original unknown-cost hold");
  provider.complete(firstJob.operation_id); await work; work = undefined;
  await until(() => page.locator(".delivery-quality").count(), value => value === 1, "completed task delivery review");
  assert.equal(await page.locator(".generated-videos").count(), 1, "The video panel remains singular when terminal review mounts");
  await page.getByRole("button", { name: "Refresh generated videos", exact: true }).click(); await card.getByRole("button", { name: "Play video", exact: true }).click();
  const video = card.locator("video"); await video.waitFor(); await until(() => video.evaluate((element: HTMLVideoElement) => element.readyState), value => value >= 2, "actual Web MP4 decode");
  await video.evaluate((element: HTMLVideoElement) => element.play()); await until(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), value => value > 0, "actual Web MP4 playback"); await video.evaluate((element: HTMLVideoElement) => element.pause()); await shot(page, "web", "playback-en");
  const [download] = await Promise.all([page.waitForEvent("download"), card.getByRole("button", { name: "Download video", exact: true }).click()]); await download.saveAs(path.join(owned, "web-video.mp4")); assert.equal(hash(await readFile(path.join(owned, "web-video.mp4"))), provider.sha256);
  const current = sample("GeneratedVideoMetadata", (await api(page, base + "/generated-video-jobs/" + firstJob.id)).data); sample("GeneratedVideoPreview", (await api(page, base + "/generated-video-jobs/" + firstJob.id + "/preview")).data);
  await page.setViewportSize({ width: 390, height: 850 }); await card.getByRole("button", { name: "Download video", exact: true }).focus(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await shot(page, "web", "mobile-en");
  await system.db.control.query("UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1", [current.assets[0].id]);
  await page.getByRole("button", { name: "Refresh generated videos", exact: true }).click(); await until(() => card.locator("video").count(), value => value === 0, "withdrawn output clears actual cached preview");
  assert.equal(await card.getByRole("button", { name: "Download video", exact: true }).count(), 0);
  pass("Web plays and downloads the exact validated MP4, reflows at 390px and removes the cached player/download when its immutable output is withdrawn");
  await page.setViewportSize({ width: 1360, height: 1000 }); const second = await create("Synthetic cancellation clip"); work = worker.run(tenant, second.id); work!.catch(() => {});
  const secondJob = await until(async () => (await system.db.control.query("SELECT * FROM ai_video_jobs WHERE task_id=$1", [second.id])).rows[0], value => value?.provider_id, "second original cloud operation");
  const cancelledCard = page.locator(`[data-generated-video-job="${secondJob.id}"]`); await cancelledCard.waitFor();
  const [cancelled] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === base + "/generated-video-jobs/" + secondJob.id + "/cancel" && r.request().method() === "POST"), cancelledCard.getByRole("button", { name: "Stop this generation", exact: true }).click()]);
  assert.equal(cancelled.status(), 200, await cancelled.text()); sample("GeneratedVideoMetadata", await cancelled.json());
  await until(async () => (await system.db.control.query("SELECT state FROM ai_video_jobs WHERE id=$1", [secondJob.id])).rows[0].state,
    value => value === "cancelled", "confirmed supplier cancellation with usage still pending");
  const held = sample("GeneratedVideoMetadata", (await api(page, base + "/generated-video-jobs/" + secondJob.id)).data);
  assert.equal(held.actual_micros, null); assert.equal(held.usage_state, "awaiting_confirmation"); assert.equal(held.assets.length, 0);
  await page.getByRole("button", { name: "Refresh generated videos", exact: true }).click();
  await until(() => cancelledCard.innerText(), value => value.includes("The original task hold remains"), "actual cancelled job keeps its unknown-cost hold");
  // A later observation supplies the fixture service's final measured usage.
  // Cancellation alone never turns a missing usage field into a free operation.
  provider.update(secondJob.operation_id, { status: "cancelled", usage: { billable_seconds: 1 } });
  await work; work = undefined;
  await page.getByRole("button", { name: "Refresh generated videos", exact: true }).click(); await until(() => cancelledCard.locator(".badge").innerText(), value => value === "Cancelled", "visible actual cancellation");
  const cancelledJob = sample("GeneratedVideoMetadata", (await api(page, base + "/generated-video-jobs/" + secondJob.id)).data); assert.equal(cancelledJob.actual_micros, "100000"); assert.equal(cancelledJob.assets.length, 0);
  assert.equal(provider.calls.filter((call: any) => call.path === "/v1/videos" && call.method === "POST").length, 2); await shot(page, "web", "cancelled-en");
  pass("Actual Web cancellation retains the same operation and unknown-cost hold until later confirmed nonzero service usage, provides no fabricated video and never submits a replacement");
  media.push(await recording.stop()); recording = undefined;
  const OTPAuth = require("otpauth");
  const adminPage = async (permissions: string[]) => {
    const secret = new OTPAuth.Secret({ size: 20 }), address = "generated-admin-" + randomUUID() + "@example.invalid";
    const principal = (await system.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Generated video reviewer',$2) RETURNING id", [address, seal(system.db.config.MASTER_KEY, secret.base32)])).rows[0];
    const role = "generated_ui_" + principal.id.replaceAll("-", ""); await system.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Generated video scoped role',$2)", [role, JSON.stringify(permissions)]);
    await system.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'tenant',$3)", [principal.id, role, tenant]);
    const adminContext = await browser!.newContext({ viewport: { width: 1360, height: 1000 } }); await adminContext.addInitScript(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); });
    const panel = await adminContext.newPage(); panel.setDefaultTimeout(15000); panel.on("pageerror", error => errors.push(error.message));
    await signIn(panel, address, true, new OTPAuth.TOTP({ secret, digits: 6, period: 30, algorithm: "SHA1" }));
    await panel.getByRole("link", { name: "Provider controls", exact: true }).click(); await panel.getByRole("button", { name: "Generated video jobs", exact: true }).click();
    await panel.locator(`[data-generated-video-job="${secondJob.id}"]`).waitFor(); return { panel, principal, role };
  };
  const reader = await adminPage(["admin.ai.requests.read"]), readerCard = reader.panel.locator(`[data-generated-video-job="${secondJob.id}"]`);
  const metadata = sample("GeneratedVideoAdminList", (await api(reader.panel, "/v1/admin/ai/video-jobs")).data); assert.ok(metadata.items.every((job: any) => job.cost === null));
  assert.equal(await readerCard.getByRole("button", { name: "Recheck original job", exact: true }).count(), 0); assert.equal(await readerCard.locator(".provider-video-cost").count(), 0); await shot(reader.panel, "admin", "metadata-only-en");
  pass("Actual Admin MFA and tenant scope expose video metadata separately from costs and provide no prompt, reference, media or unauthorized recheck control");
  const finance = await adminPage(["admin.ai.requests.read", "admin.ai.cost.read", "admin.ai.cost.reconcile"]), panel = finance.panel;
  recording = new WorkmateRecording("admin", "generated-video-control", "generated-" + attempt, () => panel.screenshot({ type: "jpeg", quality: 85 }), "Actual scoped Admin video cost/recheck and explicit project deny; MFA/API are real, service/video content is an explicit fixture", delivery); await recording.start();
  const financeCard = panel.locator(`[data-generated-video-job="${secondJob.id}"]`), generations = provider.calls.filter((call: any) => call.path === "/v1/videos" && call.method === "POST").length;
  await financeCard.getByRole("button", { name: "Recheck original job", exact: true }).click(); const modal = panel.getByRole("dialog"); await modal.getByLabel("Reason for recheck", { exact: true }).fill("Observe the retained original operation only.");
  const [rechecked] = await Promise.all([panel.waitForResponse(r => new URL(r.url()).pathname === "/v1/admin/ai/video-jobs/" + secondJob.id + "/recheck"), modal.getByRole("button", { name: "Request recheck", exact: true }).click()]);
  assert.equal(rechecked.status(), 200, await rechecked.text()); sample("GeneratedVideoRecheckReceipt", await rechecked.json());
  assert.equal(provider.calls.filter((call: any) => call.path === "/v1/videos" && call.method === "POST").length, generations); await shot(panel, "admin", "cost-rechecked-en");
  await panel.getByTitle("切換至繁體中文", { exact: true }).click(); await panel.getByTitle("Theme: light / dark / system", { exact: true }).click(); await panel.setViewportSize({ width: 780, height: 950 }); await shot(panel, "admin", "cost-zh-dark");
  await system.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,'project',$3,'deny')", [finance.principal.id, finance.role, project]);
  await panel.getByRole("button", { name: "重新整理", exact: true }).click(); await until(() => panel.locator("[data-generated-video-job]").count(), value => value === 0, "explicit current project deny removes video cards"); await shot(panel, "admin", "project-denied-zh-dark");
  pass("Actual separately authorized Admin sees measured costs, audits a CAS recheck of the same operation without generation and loses its job/cost cards after explicit project deny");
  media.push(await recording.stop()); recording = undefined; assert.deepEqual(provider.errors, []);
} catch (error) {
  errors.push(error instanceof Error ? error.stack ?? error.message : String(error)); console.error(errors.at(-1));
  for (const [index, page] of (browser?.contexts().flatMap(context => context.pages()) ?? []).entries()) {
    if (!page.isClosed()) {
      await page.screenshot({ path: path.join(owned, "failure-" + index + ".png") }).catch(() => {});
      await writeFile(path.join(owned, "failure-" + index + ".json"), JSON.stringify({ url: page.url(), text: await page.locator("body").innerText().catch(() => "unavailable") }, null, 2), { flag: "wx" }).catch(() => {});
    }
  }
}
finally {
  clearTimeout(deadline); if (recording) try { media.push(await recording.stop()); } catch (error) { errors.push(String(error)); }
  if (worker) await worker.stop().catch((error: any) => errors.push("Worker close: " + String(error))); if (work) await work.catch(() => {});
  if (browser) await browser.close().then(() => { browserClosed = true; }).catch(error => errors.push(String(error)));
  if (system) await system.app.close().then(() => { apiClosed = true; }).catch((error: any) => errors.push(String(error)));
  if (provider) await provider.close().then(() => { providerClosed = true; }).catch((error: any) => errors.push(String(error)));
  if (isolated) { process.chdir(platform); await isolated.cleanup().then(() => { fixtureClosed = true; }).catch((error: any) => errors.push(String(error))); } process.chdir(delivery);
  const result = { at: new Date().toISOString(), status: !errors.length && browserClosed && apiClosed && fixtureClosed && providerClosed ? "passed" : "failed", checks, errors, screenshots, media, samples, browser_closed: browserClosed, api_closed: apiClosed, fixture_closed: fixtureClosed, provider_closed: providerClosed,
    route_inventory: system ? { contract: "actual_fastify_route_inventory", not_full_design_openapi: true, data_mode: "configured_services",
      routes: [...system.routes].sort((a: any, b: any) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)) } : null,
    not_validated: ["actual_cloud_Codex_kernel_in_this_UI_fixture", "live_company_video_provider", "professional_business_acceptance", "entire_product_acceptance"] };
  await writeFile(`evidence/generated-video-ui-${attempt}-journey.json`, JSON.stringify(result, null, 2) + "\n", { flag: "wx" }); assert.equal(result.status, "passed", JSON.stringify(errors));
}
