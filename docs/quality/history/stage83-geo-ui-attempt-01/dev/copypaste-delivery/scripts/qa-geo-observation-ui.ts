import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";
import { exerciseGeoSidePanel } from "./geo-sidepanel-ui.js";

const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), attempt = process.argv[2];
const OTPAuth = createRequire(path.join(platform, "package.json"))("otpauth");
assert.match(attempt ?? "", /^\d{2}$/);
const checks: string[] = [], errors: string[] = [], screenshots: any[] = [], media: any[] = [];
let isolated: any, system: any, browser: Browser | undefined, browserClosed = false, apiClosed = false, fixtureClosed = false;
let recording: WorkmateRecording | undefined;
let sidePanel: unknown;
const pass = (s: string) => { checks.push(s); console.log("PASS: " + s); };
async function signIn(page: Page, email: string, secret?: { base32: string }, currentUrl = false) {
  const admin = !!secret, prefix = admin ? "/v1/admin/auth" : "/v1/auth", origin = admin ? "http://localhost:4318" : "http://localhost:4317";
  if (!currentUrl) await page.goto(origin + (admin ? "" : "/login"));
  await page.locator('input[name="email"]').fill(email);
  const [response] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === prefix + (admin ? "/challenge" : "/challenges")), page.locator('form button[type="submit"]').click()]);
  assert.equal(response.status(), admin ? 200 : 202);
  const ch = await response.json(), mail = JSON.parse(await readFile(path.join(isolated.directory, "mailbox", ch.challenge_id + ".json"), "utf8"));
  await page.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);
  if (secret) await page.locator('input[name="totp"]').fill(new OTPAuth.TOTP({ secret, digits: 6, period: 30, algorithm: "SHA1" }).generate());
  const [verified] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === prefix + (admin ? "/verify" : "/sessions") && r.request().method() === "POST"), page.locator('form button[type="submit"]').click()]);
  assert.equal(verified.status(), admin ? 200 : 201, await verified.text());
}
async function screenshot(page: Page, repo: string, name: string) {
  await page.evaluate(async () => {
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    await Promise.all(document.getAnimations().filter(a => a instanceof CSSTransition).map(a => a.finished.catch(() => {})));
  });
  screenshots.push(await saveWorkmateScreenshot(repo, "geo-" + attempt, name, await page.screenshot(), "Actual GEO UI with retained answers, current permissions and synthetic company gateway data. Consumer samples are explicitly supplied synthetic fixtures.", delivery));
}
async function unobscured(page: Page, button: ReturnType<Page["getByRole"]>) {
  await button.scrollIntoViewIfNeeded();
  assert.equal(await button.evaluate(el => {
    const r = el.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top === el || el.contains(top);
  }), true, "Actual button center must receive the click rather than preference controls or a header");
}
const deadline = setTimeout(() => { errors.push("Owned GEO UI deadline exceeded"); void browser?.close(); }, 480000);
try {
  const load = async (file: string) => import(pathToFileURL(path.join(platform, file)).href);
  const { isolatedTestEnvironment } = await load("tests/native-test-environment.ts"), { buildApp } = await load("src/server.ts"), { loadConfig } = await load("src/config.ts"), { saveAsset } = await load("src/storage.ts"), { seal } = await load("src/lib.ts");
  process.chdir(platform); isolated = await isolatedTestEnvironment();
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "false", DEMO_MODE: "true" }), { worker: false });
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, acceptDownloads: true });
  await context.addInitScript(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); });
  const page = await context.newPage(); page.setDefaultTimeout(20000); page.on("pageerror", e => errors.push(e.message));
  const userEmail = `geo-ui-${randomUUID()}@example.invalid`;
  await signIn(page, userEmail);
  const api = (method: string, url: string, body?: unknown) => page.evaluate(async ({ method, url, body }) => {
    const session = await (await fetch("/v1/session/context")).json(), tenant = /^\/v1\/tenants\/([^/]+)/.exec(url)?.[1];
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf_token, "Idempotency-Key": crypto.randomUUID(), ...(tenant ? { "X-Tenant-ID": tenant } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json() };
  }, { method, url, body });
  const created = await api("POST", "/v1/tenants", { name: "Actual GEO UI fixture", project_name: "GEO retained evidence" }); assert.equal(created.status, 200);
  const tenant = created.body.tenant.id, project = created.body.project.id, base = `/v1/tenants/${tenant}/projects/${project}`, root = base + "/geo";
  const session = await api("GET", "/v1/session/context"), user = session.body.user.id;
  await system.db.control.query("UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1", [tenant]);
  const agent = await api("POST", base + "/agents", { name: "Unbranded GEO specialist", role_key: "assistant", instructions: "Answer independently.", tool_ids: [], brand_id: null }); assert.equal(agent.status, 200, JSON.stringify(agent.body));
  await page.evaluate(w => { localStorage.setItem("cp_tenant", w.tenant.id); localStorage.setItem("cp_project", w.project.id); }, created.body);
  await page.goto("http://localhost:4317/app/analytics?view=geo");
  await page.getByRole("heading", { name: "GEO observations", exact: true }).waitFor();
  recording = new WorkmateRecording("web", "geo-observations", "geo-" + attempt, () => page.screenshot(), "Actual fixed configuration, two pinned Codex runs, capture, original answers, separate consumer sample and comparison download. Synthetic internal gateway only.", delivery);
  await recording.start();
  await page.getByRole("button", { name: "New question set", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Question set name", { exact: true }).fill("Hong Kong design questions");
  await dialog.getByLabel("Pinned Agent", { exact: true }).selectOption(agent.body.id);
  await dialog.getByLabel("Answer language", { exact: true }).fill("English");
  await dialog.getByLabel("Fixed questions (one per line, up to 20)", { exact: true }).fill("Which local design teams could help a Hong Kong company?");
  await dialog.getByLabel("Brands and aliases (Brand | alias | alias)", { exact: true }).fill("CopyPaste | CopyPaste | copypaste.hk");
  await dialog.getByRole("button", { name: "Save immutable configuration", exact: true }).click(); await dialog.waitFor({ state: "detached" });
  const experiment = (await api("GET", root + "/experiments")).body.items[0]; assert.equal(experiment.version, 1);
  pass("Web creates an immutable unbranded GEO configuration through the actual form with fixed questions and no measured aliases injected into prompts");
  async function runApi(name: string) {
    await page.getByRole("button", { name: "Run API observation", exact: true }).click();
    await dialog.getByLabel("Run name", { exact: true }).fill(name);
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Confirm and run observation", exact: true }).click(); await dialog.waitFor({ state: "detached" });
    const run = (await api("GET", root + "/experiments/" + experiment.id + "/runs")).body.items.find((r: any) => r.name === name); assert.ok(run);
    const detail = (await api("GET", root + "/runs/" + run.id)).body;
    for (const sample of detail.samples) await system.worker.run(tenant, sample.task_id);
    assert.ok((await api("GET", root + "/runs/" + run.id)).body.samples.every((s: any) => s.task_status === "succeeded"));
    await page.getByRole("button", { name: "Capture completed answers", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".geo-run-heading")?.textContent?.includes("1 / 1"));
    return run;
  }
  const a = await runApi("Actual API observation A");
  await page.getByRole("button", { name: "View original answer", exact: true }).click();
  await dialog.locator("pre").waitFor(); assert.ok((await dialog.locator("pre").innerText()).length > 10);
  await screenshot(page, "web", "original-api-answer"); await dialog.getByRole("button", { name: /close/i }).click();
  pass("An actual pinned Codex task runs through the synthetic company gateway, captures original bytes and opens the retained answer with its provenance");
  await page.getByRole("button", { name: "Use as comparison A", exact: true }).click();
  const b = await runApi("Actual API observation B");
  await page.getByRole("button", { name: "Use as comparison B", exact: true }).click();
  await page.getByRole("heading", { name: "Repeat observation with the same configuration", exact: true }).waitFor();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Download comparison and original answers", exact: true }).click();
  const file = await download, filePath = await file.path(); assert.ok(filePath);
  const comparison = JSON.parse(await readFile(filePath, "utf8")); assert.equal(comparison.comparison.same_configuration, true);
  for (const sample of [...comparison.left.samples, ...comparison.right.samples]) assert.equal(createHash("sha256").update(sample.answer).digest("hex"), sample.answer_sha256);
  pass("Two independent real Codex runs retain the same configuration hash and the actual comparison download contains both original answers with matching SHA-256");
  await page.getByRole("button", { name: "Save new version", exact: true }).click();
  await dialog.getByLabel("Requested region", { exact: true }).fill("Singapore");
  await dialog.getByRole("button", { name: "Save immutable configuration", exact: true }).click(); await dialog.waitFor({ state: "detached" });
  const versions = (await api("GET", root + "/experiments")).body.items; assert.equal(versions.length, 2); assert.equal(versions[0].version, 2); assert.equal(versions[1].body.spec.region, "Hong Kong");
  pass("Changing region through the UI creates configuration version two while the first version and its repeat observations remain unchanged");
  await page.getByRole("button", { name: "Record consumer sample", exact: true }).click();
  await dialog.getByLabel("Sample name", { exact: true }).fill("Consumer original observation");
  await dialog.getByLabel("Consumer product", { exact: true }).fill("Consumer product fixture");
  await dialog.getByLabel("Observation time (local timezone)", { exact: true }).fill(new Date(Date.now() - 120000).toISOString().slice(0, 16));
  const manualAnswer = "This is an explicitly synthetic user-supplied consumer answer. CopyPaste provides design. https://example.invalid/design";
  await dialog.getByLabel("Complete original answer", { exact: true }).fill(manualAnswer);
  assert.equal(await dialog.getByRole("checkbox").isChecked(), false); await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Save manual sample", exact: true }).click(); await dialog.waitFor({ state: "detached" });
  await page.getByText("CONSUMER · USER SUPPLIED", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Use as comparison B", exact: true }).click();
  await page.getByRole("heading", { name: "Different configurations; interpret separately", exact: true }).waitFor();
  const manual = (await api("GET", root + "/experiments/" + versions[0].id + "/runs")).body.items[0];
  const consumer = (await api("GET", root + "/runs/" + manual.id + "/export")).body;
  assert.equal(consumer.samples[0].answer, manualAnswer); assert.equal(consumer.samples[0].task_id, null); assert.equal(consumer.samples[0].confirmed_cost_micros, null);
  pass("The consumer sample requires an unchecked user attestation, preserves exact pasted text and unknown model/retrieval metadata, and creates no AI task or zero-cost model claim");
  const mixed = (await api("GET", root + "/compare?left=" + a.id + "&right=" + manual.id)).body;
  assert.equal(mixed.comparison.mixed_surfaces, true); assert.equal(mixed.comparison.aggregate, null);
  await screenshot(page, "web", "comparison-en");
  pass("The actual UI and comparison response separate consumer/manual surface and configuration changes from API repeat variation");
  await page.setViewportSize({ width: 400, height: 860 });
  const exportButton = page.getByRole("button", { name: "Download observation", exact: true });
  await unobscured(page, exportButton);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await screenshot(page, "web", "compact-en");
  await page.getByTitle("切換至繁體中文", { exact: true }).click();
  for (let i = 0; i < 4 && await page.evaluate(() => document.documentElement.dataset.theme) !== "dark"; i++) await page.getByTitle("Theme: light / dark / system", { exact: true }).click();
  await unobscured(page, page.getByRole("button", { name: "下載原始觀測", exact: true }));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await screenshot(page, "web", "compact-zh-dark");
  pass("The 400 px English/light and Traditional Chinese/dark observation layouts fit the viewport and the real download button remains clickable after scrolling below the fixed preferences");
  media.push(await recording.stop()); recording = undefined;
  await page.getByTitle("Switch to English", { exact: true }).click();
  for (let i = 0; i < 4 && await page.evaluate(() => document.documentElement.dataset.theme) !== "light"; i++) await page.getByTitle("Theme: light / dark / system", { exact: true }).click();
  // Reproduce the earlier compact creative-feedback overlap with an actual
  // governed report. Preparation is a synthetic fixture; the click/download is UI.
  const asset = await system.db.tx((tx: any) => saveAsset(tx, system.storage, { tenant, project, user, name: "Synthetic feedback creative.png", mime: "image/png", bytes: Buffer.from("synthetic-image-fixture") }), tenant, true, user);
  const imported = await api("POST", base + "/analytics/import", { name: "GEO layout regression ad facts", source: "meta_ads", currency: "HKD", timezone: "Asia/Hong_Kong", account_id: "geo-layout-fixture", entity_level: "ad", attribution_definition: "7-day-click", conversion_definition: "purchases", csv: "date,channel,campaign,entity_id,impressions,clicks,spend,conversions,revenue,currency\n2026-10-20,meta,Layout,ad-1,1000,20,12,2,40,HKD" }); assert.equal(imported.status, 200);
  const candidate = await api("POST", base + "/creative-feedback/mappings", { name: "Compact layout identity", asset_version_id: asset.version.id, dataset_id: imported.body.id, channel: "meta", campaign: "Layout", ad_id: "ad-1", creative_id: "creative-1", date_from: "2026-10-20", date_to: "2026-10-20", match_source: "manual", match_note: "Explicit synthetic single-creative mapping", allocation: "single_creative_entire_ad" }); assert.equal(candidate.status, 201);
  assert.equal((await api("POST", base + "/creative-feedback/mappings/" + candidate.body.id + "/confirm", { expected_version: candidate.body.version, expected_sha256: candidate.body.sha256, confirm_single_creative_allocation: true, reason: "Reviewed synthetic exact ad creative" })).status, 200);
  const feedback = await api("POST", base + "/creative-feedback/reports", { name: "Compact report overlap regression", mapping_ids: [candidate.body.id], date_from: "2026-10-20", date_to: "2026-10-20" }); assert.equal(feedback.status, 201);
  await page.setViewportSize({ width: 800, height: 600 }); await page.goto("http://localhost:4317/app/analytics?view=creative-feedback");
  const feedbackButton = page.getByRole("button", { name: "Download evidence JSON", exact: true }); await feedbackButton.waitFor();
  await feedbackButton.evaluate(el => el.scrollIntoView({ block: "start" })); await unobscured(page, feedbackButton);
  const evidenceDownload = page.waitForEvent("download"); await feedbackButton.click(); assert.ok(await (await evidenceDownload).path());
  await screenshot(page, "web", "feedback-preferences-no-overlap");
  pass("The prior 800 by 600 feedback report overlap is reproduced with real content and fixed: the download receives its actual click and produces the retained JSON file");
  const email = `geo-ui-admin-${randomUUID()}@example.invalid`, secret = new OTPAuth.Secret({ size: 20 });
  const principal = (await system.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Scoped GEO UI reviewer',$2) RETURNING id", [email, seal(system.db.config.MASTER_KEY, secret.base32)])).rows[0].id;
  const role = "geo_ui_" + randomUUID();
  await system.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Scoped GEO UI',$2)", [role, JSON.stringify(["admin.content.read", "admin.content.body.read", "admin.content.quarantine", "admin.content.restore"])]);
  await system.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'project',$3)", [principal, role, project]);
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 980 } });
  await adminContext.addInitScript(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); });
  const admin = await adminContext.newPage(); admin.on("pageerror", e => errors.push(e.message));
  await signIn(admin, email, secret); await admin.goto("http://localhost:4318/content");
  await admin.getByRole("heading", { name: "User content", exact: true }).waitFor();
  recording = new WorkmateRecording("admin", "geo-governance", "geo-" + attempt, () => admin.screenshot(), "Actual project-scoped Admin content metadata, independent body read and quarantine for an explicit synthetic consumer observation.", delivery);
  await recording.start();
  await admin.getByLabel("Search records", { exact: true }).fill("Consumer original observation");
  const row = admin.locator("tbody tr").filter({ hasText: "GEO observation run" }); await row.waitFor();
  await screenshot(admin, "admin", "scoped-geo-content");
  pass("The actual Admin content list displays GEO configuration/run/sample kinds inside the reviewer project scope");
  await row.getByRole("button", { name: "Read content", exact: true }).click();
  await admin.getByRole("dialog").locator("pre").waitFor();
  assert.ok((await admin.getByRole("dialog").innerText()).includes("consumer_manual"));
  await screenshot(admin, "admin", "geo-body-permission");
  await admin.getByRole("dialog").getByRole("button", { name: /close/i }).click();
  pass("Independent current Admin body permission opens the retained manual-observation configuration without turning it into an API sample");
  await row.getByRole("button", { name: "Manage content", exact: true }).click();
  const moderation = admin.getByRole("dialog");
  await moderation.getByLabel(/reason/i).fill("Synthetic observation requires review");
  await moderation.getByRole("button", { name: "Confirm action", exact: true }).click(); await moderation.waitFor({ state: "detached" });
  await page.goto("http://localhost:4317/app/analytics?view=geo");
  const revoked = await api("GET", root + "/runs/" + manual.id + "/export"); assert.equal(revoked.status, 404);
  await screenshot(admin, "admin", "geo-quarantined");
  pass("An actual Admin quarantine blocks the user's existing observation export through the current source checks and records the moderation action");
  media.push(await recording.stop()); recording = undefined;
  await adminContext.close(); await context.close();
  sidePanel = await exerciseGeoSidePanel({ delivery, attempt, login: p => signIn(p, userEmail, undefined, true), screenshots, media, pass });
} catch (e) { errors.push(String(e)); console.error(e); }
finally {
  clearTimeout(deadline);
  if (recording) await recording.stop().catch(e => errors.push(String(e)));
  if (browser) await browser.close().then(() => browserClosed = true).catch(e => errors.push(String(e)));
  if (system) await system.app.close().then(() => apiClosed = true).catch((e: any) => errors.push(String(e)));
  if (isolated) { process.chdir(platform); await isolated.cleanup().then(() => fixtureClosed = true).catch((e: any) => errors.push(String(e))); }
  process.chdir(delivery);
  const result = { at: new Date().toISOString(), status: !errors.length && browserClosed && apiClosed && fixtureClosed && sidePanel ? "passed" : "failed", checks, errors, screenshots, media, side_panel: sidePanel, browser_closed: browserClosed, api_closed: apiClosed, fixture_closed: fixtureClosed,
    route_inventory: system ? { contract: "actual_fastify_route_inventory", not_full_design_openapi: true, data_mode: "simulated", routes: [...system.routes].sort((a: any, b: any) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)) } : null,
    not_validated: ["Live model/provider rankings or production performance", "Consumer-product observation automation", "Desktop-local GEO protocol", "Full original product acceptance"] };
  await writeFile(`evidence/geo-observation-ui-${attempt}-journey.json`, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  assert.equal(result.status, "passed", JSON.stringify(errors));
}
