import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";

const delivery = process.cwd(), platform = path.resolve("../copypaste-platform-publication-125"), attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const prefix = path.join(delivery, "evidence/publications-ui-" + attempt), checks: string[] = [], errors: string[] = [],
  screenshots: any[] = [], recordings: any[] = [], layouts: any[] = [];
let browser: Browser | undefined, system: any, isolated: any, recording: WorkmateRecording | undefined;
let stage = "setup", browserClosed = false, apiClosed = false, fixtureClosed = false, modelCalls = -1;
const load = (name: string) => import(pathToFileURL(path.join(platform, name)).href);
const pass = (name: string) => { checks.push(name); console.log("PASS: " + name); };
async function shot(page: Page, component: "web" | "admin", name: string, description: string) {
  screenshots.push(await saveWorkmateScreenshot(component + "-publication-125", "publications-" + attempt, name,
    await page.screenshot(), description, delivery));
}
async function stopRecording() {
  if (!recording) return;
  const owned = recording; recording = undefined; recordings.push(await owned.stop());
}
async function fit(page: Page, component: string) {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  const value = await page.evaluate(() => {
    const modal = document.querySelector<HTMLElement>(".modal"), box = modal?.getBoundingClientRect();
    const visibleFields = [...document.querySelectorAll<HTMLElement>("input:not([type=checkbox]),select,textarea,button")]
      .filter(node => node.getClientRects().length > 0 && (!modal || modal.contains(node)));
    return { width: innerWidth, page_fits: document.documentElement.scrollWidth <= innerWidth,
      dialog_fits: !modal || !!box && box.left >= -1 && box.right <= innerWidth + 1 && modal.scrollWidth <= modal.clientWidth,
      fields_fit: visibleFields.every(node => { const r = node.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1; }) };
  });
  assert.ok(value.page_fits && value.dialog_fits && value.fields_fit, JSON.stringify(value));
  layouts.push({ component, ...value });
}
async function mailCode(challenge: string) {
  const mail = JSON.parse(await readFile(path.join(isolated.directory, "mailbox", challenge + ".json"), "utf8"));
  return mail.text.match(/\b\d{6}\b/)[0];
}
try {
  const [{ isolatedTestEnvironment }, { buildApp }, { loadConfig }, { saveAsset }, { advancePublications }, { seal }, { defaults }] = await Promise.all([
    load("tests/native-test-environment.ts"), load("src/server.ts"), load("src/config.ts"), load("src/storage.ts"),
    load("src/publication-worker.ts"), load("src/lib.ts"), load("src/plans.ts"),
  ]);
  process.chdir(platform);
  isolated = await isolatedTestEnvironment();
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", WORKER_ENABLED: "false",
    API_ORIGIN: "http://localhost:4310", WEB_ORIGIN: "http://localhost:4317", ADMIN_ORIGIN: "http://localhost:4318" }), { worker: false });
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  const requirePlatform = createRequire(path.join(platform, "package.json")), OTP = requirePlatform("otpauth"),
    { createCanvas } = requirePlatform("@napi-rs/canvas");
  async function inject(client: any, method: string, url: string, body?: any) {
    const result = await system.app.inject({ method, url, headers: { origin: "http://localhost:4317",
      ...(client ? { cookie: client.cookie, "x-csrf-token": client.csrf } : {}),
      ...(client?.tenant ? { "x-tenant-id": client.tenant } : {}), "idempotency-key": randomUUID() },
      ...(body === undefined ? {} : { payload: body }) });
    assert.ok(result.statusCode >= 200 && result.statusCode < 300, `${method} ${url}: ${result.statusCode} ${result.body}`);
    return result.json();
  }
  const initial = (await system.db.control.query("SELECT (SELECT count(*) FROM tasks)::text AS tasks,(SELECT count(*) FROM reservations)::text AS reservations,(SELECT count(*) FROM ai_gateway_requests)::text AS gateway")).rows[0];
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, reducedMotion: "reduce" });
  await context.addInitScript(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); });
  const page = await context.newPage(); page.setDefaultTimeout(30000); page.on("pageerror", error => errors.push(error.message));
  stage = "actual customer OTP login";
  const customerEmail = `publishing-customer-${randomUUID()}@example.invalid`;
  await page.goto("http://localhost:4317/login");
  await page.locator('input[name="email"]').fill(customerEmail);
  const [challenge] = await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === "/v1/auth/challenges"),
    page.getByRole("button", { name: "Send sign-in code", exact: true }).click()]);
  assert.equal(challenge.ok(), true);
  await page.locator('input[name="code"]').fill(await mailCode((await challenge.json()).challenge_id));
  const [session] = await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === "/v1/auth/sessions"),
    page.getByRole("button", { name: "Verify & continue", exact: true }).click()]);
  assert.equal(session.ok(), true);
  const identity = await session.json(), cookies = await context.cookies("http://localhost:4317"),
    sessionCookie = cookies.find(cookie => cookie.name === "cp_session");
  assert.ok(sessionCookie);
  const customer: any = { id: identity.user.id, csrf: identity.csrf_token, cookie: sessionCookie.name + "=" + sessionCookie.value };
  const workspace = await inject(customer, "POST", "/v1/tenants", { name: "Harbour studio · Explicit demo", project_name: "Hong Kong campaign" });
  const tenant = workspace.tenant.id, project = workspace.project.id, base = `/v1/tenants/${tenant}/projects/${project}`,
    publications = base + "/publications", landing = `http://localhost:4317/app/publications?tenant=${tenant}&project=${project}`;
  customer.tenant = tenant;
  await inject(customer, "POST", `/v1/tenants/${tenant}/demo-credit`, {});
  await system.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Explicit synthetic publishing UI fixture; no payment received',$2)", [tenant, defaults.business]);
  await page.goto(landing);
  await page.getByRole("heading", { name: "Good work. Ready to go live." }).waitFor();
  pass("Actual customer email/OTP login reaches the exact publishing workspace and project");

  stage = "actual browser OAuth and explicit account/project scope";
  await page.getByRole("button", { name: "Connect Meta account", exact: true }).click();
  await page.getByRole("button", { name: "授權模擬帳戶", exact: true }).click();
  await page.waitForURL(url => url.pathname === "/app/publications" && url.searchParams.get("publication") === "connected");
  const connection = (await inject(customer, "GET", publications + "/connections")).items[0];
  assert.ok(connection.targets.every((target: any) => !target.enabled));
  const facebook = connection.targets.find((target: any) => target.kind === "facebook_page");
  const card = page.locator(".publication-account").filter({ hasText: "Facebook Page" }).first();
  await card.locator(".publication-account-select").click();
  await card.getByRole("button", { name: "Account & project scope", exact: true }).click();
  const scopeDialog = page.getByRole("dialog");
  for (const checkbox of await scopeDialog.getByRole("checkbox").all()) await checkbox.check();
  await scopeDialog.getByRole("button", { name: "Save selected scope", exact: true }).click();
  await scopeDialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Set publishing policy", exact: true }).click();
  const policyDialog = page.getByRole("dialog");
  await policyDialog.getByLabel("Enable publishing for this account", { exact: true }).check();
  await policyDialog.getByLabel("Maximum in 24 hours", { exact: true }).fill("100");
  await policyDialog.getByRole("button", { name: "Save publishing policy", exact: true }).click();
  await policyDialog.waitFor({ state: "hidden" });
  assert.equal(system.publicationFixture.calls.length, 0);
  await shot(page, "web", "accounts-and-policy", "Actual customer-scoped synthetic OAuth, explicit account/project scope and publishing policy; no provider writes.");
  pass("Actual synthetic OAuth returns to the exact project; targets start disabled and require explicit scope and policy");

  stage = "actual image preview and exact customer confirmation";
  const canvas = createCanvas(800, 800), drawing = canvas.getContext("2d");
  drawing.fillStyle = "#1f5eff"; drawing.fillRect(0, 0, 800, 800);
  drawing.fillStyle = "#ffffff"; drawing.font = "24px sans-serif"; drawing.fillText("COPYPASTE / WORKMATE", 58, 84);
  drawing.font = "bold 78px sans-serif"; drawing.fillText("Good work.", 58, 350); drawing.fillText("Ready to go.", 58, 450);
  drawing.font = "24px sans-serif"; drawing.fillText("Hong Kong · Explicit publishing demo", 58, 718);
  const asset = await system.db.tx((tx: any) => saveAsset(tx, system.storage, { tenant, project, user: customer.id,
    name: "harbour-launch.png", mime: "image/png", bytes: canvas.toBuffer("image/png") }), tenant, false, customer.id);
  const assetVersion = (await system.db.control.query("SELECT * FROM asset_versions WHERE asset_id=$1", [asset.id])).rows[0];
  await page.reload();
  await page.getByLabel("Publication format", { exact: true }).selectOption("facebook_photo");
  recording = new WorkmateRecording("web-publication-125", "customer-preview-and-confirm", "publications-" + attempt,
    () => page.screenshot({ type: "jpeg", quality: 75 }), "Actual Web customer edits text, chooses an immutable file version, reviews real outgoing JPEG, confirms and sees an actual synthetic provider receipt.", delivery);
  await recording.start();
  const caption = "A fresh start in Hong Kong.\nApproved campaign · CopyPaste.";
  await page.getByLabel("Publication text", { exact: true }).fill(caption);
  await page.locator(".publication-asset-picker").getByRole("button").click();
  const [previewResponse] = await Promise.all([page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === publications + "/previews"),
    page.getByRole("button", { name: "Preview outgoing content", exact: true }).click()]);
  assert.equal(previewResponse.ok(), true); const preview = await previewResponse.json();
  assert.equal(preview.sources[0].mime, "image/jpeg"); assert.equal(preview.sources[0].version, assetVersion.version);
  const image = page.locator('img[src*="/publications/previews/"]').first();
  await image.waitFor(); await image.evaluate(async (node: HTMLImageElement) => { if (!node.complete) await node.decode(); assertImage(node); function assertImage(value: HTMLImageElement) { if (!value.naturalWidth) throw new Error("Outgoing JPEG did not render"); } });
  const imageResponse = await context.request.get(await image.getAttribute("src")!.then(value => new URL(value!, page.url()).href));
  assert.equal(imageResponse.ok(), true);
  assert.equal(createHash("sha256").update(await imageResponse.body()).digest("hex"), preview.sources[0].sha256);
  assert.equal(system.publicationFixture.calls.length, 0);
  for (const width of [375, 768, 1024, 1440]) { await page.setViewportSize({ width, height: 1080 }); await fit(page, "web-preview"); }
  await shot(page, "web", "outgoing-jpeg-preview", "Actual outgoing JPEG rendered and matched against the immutable SHA-256; no publishing side effect before customer consent.");
  pass("Actual PNG is prepared as a rendered JPEG with exact file version and matching downloaded SHA-256");
  pass("Web publishing preview fits 375/768/1024/1440 widths without horizontal overflow or clipped controls");
  const [preparedResponse] = await Promise.all([page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === publications + "/operations"),
    page.getByRole("button", { name: "Next: review confirmation", exact: true }).click()]);
  assert.equal(preparedResponse.ok(), true); const operation = await preparedResponse.json();
  const inspector = page.locator(".publication-inspector");
  const approval = inspector.getByLabel("I approve publishing this exact content to this account.", { exact: true });
  await approval.waitFor(); assert.equal(await approval.isChecked(), false);
  assert.equal(await inspector.getByRole("button", { name: "Confirm and publish", exact: true }).isDisabled(), true);
  await advancePublications(system.db, system.storage, { limit: 2, pollIntervalMs: 0 });
  assert.equal(system.publicationFixture.calls.length, 0);
  await page.setViewportSize({ width: 375, height: 1080 }); await fit(page, "web-confirmation");
  await shot(page, "web", "customer-confirmation-375", "Actual mobile-width customer confirmation starts unchecked and cannot dispatch before explicit approval.");
  await page.setViewportSize({ width: 1440, height: 1080 }); await approval.check();
  const [confirmed] = await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === publications + `/operations/${operation.id}/decision`),
    inspector.getByRole("button", { name: "Confirm and publish", exact: true }).click()]);
  assert.equal(confirmed.ok(), true);
  async function drain(id: string) {
    for (let step = 0; step < 40; step++) {
      const current = await inject(customer, "GET", publications + "/operations/" + id);
      if (["succeeded", "failed", "unknown", "closed_unknown", "cancelled", "expired"].includes(current.state)) return current;
      await advancePublications(system.db, system.storage, { limit: 1, pollIntervalMs: 0 });
    }
    throw new Error("Publishing exceeded bounded owned-provider steps");
  }
  const published = await drain(operation.id); assert.equal(published.state, "succeeded");
  const publicCalls = () => system.publicationFixture.calls.filter((call: any) => ["feed", "videos", "media_publish"].includes(call.edge));
  assert.equal(publicCalls().length, 1);
  await inspector.getByText("Published", { exact: true }).first().waitFor();
  await shot(page, "web", "publication-receipt", "Actual immutable customer confirmation, private media transfer and one synthetic public write with returned receipt.");
  await stopRecording();
  pass("Unchecked exact customer confirmation prevents dispatch; explicit consent produces one public write and a visible receipt");

  stage = "unknown result reconciliation without resending";
  async function propose(text: string) {
    const view = await inject(customer, "POST", publications + "/previews", { target_id: facebook.id, format: "facebook_post", caption: text, sources: [] });
    return inject(customer, "POST", publications + "/operations", { preview_id: view.preview_id, payload_sha256: view.payload_sha256 });
  }
  const unknown = await propose("Unknown response · " + randomUUID());
  system.publicationFixture.setFaults("feed", ["apply_then_disconnect"]);
  await inject(customer, "POST", publications + `/operations/${unknown.id}/decision`, { expected_version: unknown.version,
    payload_sha256: unknown.payload_sha256, decision: "confirm", acknowledge_publication: true });
  assert.equal((await drain(unknown.id)).state, "unknown");
  await page.goto(landing + "&operation=" + unknown.id);
  await page.getByRole("button", { name: "Check provider without resending", exact: true }).click();
  await page.getByLabel("Resolution reason", { exact: true }).fill("Reviewed the original unknown response; do not resend this campaign.");
  await page.getByLabel("I understand that closure does not prove failure. A later publication could duplicate it.", { exact: true }).check();
  await page.getByRole("button", { name: "Record resolution and close review", exact: true }).click();
  await page.getByLabel("Resolution reason", { exact: true }).waitFor({ state: "hidden" });
  assert.equal((await inject(customer, "GET", publications + "/operations/" + unknown.id)).state, "closed_unknown");
  assert.equal(publicCalls().length, 2);
  pass("A lost provider response remains unknown; actual Web observation and manual closure never resend or claim failure");

  stage = "actual scoped Admin login and private body separation";
  const secret = new OTP.Secret({ size: 20 }), adminEmail = `publishing-admin-${randomUUID()}@example.invalid`;
  const principal = (await system.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Scoped publishing operator',$2) RETURNING id",
    [adminEmail, seal(system.db.config.MASTER_KEY, secret.base32)])).rows[0];
  const role = "publication_ui_" + randomUUID();
  await system.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Scoped publishing QA',$2)",
    [role, JSON.stringify(["admin.publication.read", "admin.publication.policy.write", "admin.publication.resolve", "admin.content.body.read"])]);
  await system.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'project',$3)", [principal.id, role, project]);
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1080 }, reducedMotion: "reduce" });
  await adminContext.addInitScript(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); });
  const adminPage = await adminContext.newPage(); adminPage.setDefaultTimeout(30000); adminPage.on("pageerror", error => errors.push(error.message));
  await adminPage.goto("http://localhost:4318/login"); await adminPage.locator('input[name="email"]').fill(adminEmail);
  const [adminChallenge] = await Promise.all([adminPage.waitForResponse(response => new URL(response.url()).pathname === "/v1/admin/auth/challenge"),
    adminPage.locator('form button[type="submit"]').click()]);
  assert.equal(adminChallenge.ok(), true);
  await adminPage.locator('input[name="code"]').fill(await mailCode((await adminChallenge.json()).challenge_id));
  await adminPage.locator('input[name="totp"]').fill(new OTP.TOTP({ secret, digits: 6, period: 30, algorithm: "SHA1" }).generate());
  await adminPage.locator('form button[type="submit"]').click(); await adminPage.locator(".admin-shell").waitFor();
  await adminPage.goto("http://localhost:4318/publications");
  const row = () => adminPage.locator(".publication-admin-operation").filter({ hasText: operation.id });
  await row().waitFor(); assert.equal((await adminPage.locator("body").innerText()).includes(caption), false);
  await shot(adminPage, "admin", "publishing-metadata", "Actual project-scoped Admin directory contains metadata without automatically fetching private captions or media.");
  await row().locator("button").first().click();
  const adminDialog = adminPage.getByRole("dialog");
  await adminDialog.getByRole("button", { name: "View private content", exact: true }).waitFor();
  assert.equal((await adminDialog.innerText()).includes(caption), false);
  assert.equal(await adminDialog.getByRole("button", { name: "Confirm and publish", exact: true }).count(), 0);
  pass("Actual independent Admin email/TOTP login lists scoped metadata and cannot confirm customer publications");
  recording = new WorkmateRecording("admin-publication-125", "private-review-and-request-recovery", "publications-" + attempt,
    () => adminPage.screenshot({ type: "jpeg", quality: 75 }), "Actual scoped Admin explicitly opens private content, reviews real media, edits policy and recovers a committed cancellation after an intentionally lost response.", delivery);
  await recording.start();
  await adminDialog.getByRole("button", { name: "View private content", exact: true }).click();
  await adminDialog.getByText(caption, { exact: true }).waitFor();
  const adminImage = adminDialog.locator('img[src*="/publications/operations/"]').first();
  await adminImage.waitFor(); await adminImage.evaluate(async (node: HTMLImageElement) => { await node.decode(); if (!node.naturalWidth) throw new Error("Admin media did not render"); });
  for (const width of [375, 768, 1024, 1440]) { await adminPage.setViewportSize({ width, height: 1080 }); await fit(adminPage, "admin-private-review"); }
  await shot(adminPage, "admin", "private-media-review", "Actual Admin private body and protected JPEG require separate access; four viewport widths preserve visible fields and controls.");
  await adminPage.keyboard.press("Escape"); await adminDialog.waitFor({ state: "hidden" });
  pass("Actual Admin private-content opt-in renders the authorized JPEG and fits four widths with keyboard modal dismissal");

  stage = "actual Admin policy change";
  await row().getByRole("button", { name: "Policy for this project", exact: true }).click();
  await adminDialog.getByLabel("Brand account", { exact: true }).selectOption(facebook.id);
  await adminDialog.getByLabel("Maximum in 24 hours", { exact: true }).fill("99");
  await adminPage.setViewportSize({ width: 375, height: 1080 }); await fit(adminPage, "admin-policy");
  await shot(adminPage, "admin", "publishing-policy-375", "Actual scoped Admin edits an account policy at 375px without replacing customer authorization or publication consent.");
  await adminPage.setViewportSize({ width: 1440, height: 1080 });
  await adminDialog.getByRole("button", { name: "Save publishing policy", exact: true }).click();
  await adminDialog.waitFor({ state: "hidden" });
  assert.equal((await inject(customer, "GET", publications + "/policy?target_id=" + facebook.id)).policy.policy.maximum_daily_publications, 99);
  pass("Actual scoped Admin policy form writes the current account policy while retaining per-operation customer confirmation");

  stage = "lost Admin cancellation response and original-request recovery";
  const unsent = await propose("Unsent customer campaign · " + randomUUID()), beforeWrites = publicCalls().length;
  await adminPage.reload();
  const unsentRow = adminPage.locator(".publication-admin-operation").filter({ hasText: unsent.id });
  await unsentRow.locator("button").first().click();
  let cancelledRequests = 0;
  const cancelPattern = "**/v1/admin/tenants/**/publications/operations/*/cancel";
  await adminPage.route(cancelPattern, async route => {
    if (route.request().method() !== "POST") return route.continue();
    cancelledRequests++;
    const response = await route.fetch(); assert.equal(response.ok(), true); await response.dispose();
    await route.abort("failed");
  });
  await adminDialog.getByRole("button", { name: "Cancel unsent operation", exact: true }).click();
  await adminPage.getByText("The original action committed. Read the current state.", { exact: true }).waitFor();
  await adminPage.getByRole("button", { name: "Read current state", exact: true }).click();
  await adminPage.unroute(cancelPattern);
  const cancelled = await inject(customer, "GET", publications + "/operations/" + unsent.id);
  assert.equal(cancelled.state, "cancelled"); assert.equal(cancelled.version, unsent.version + 1);
  assert.equal(cancelledRequests, 1); assert.equal(publicCalls().length, beforeWrites);
  await stopRecording();
  pass("A committed Admin cancellation with a lost response recovers its original receipt, without duplicate mutation or provider write");

  stage = "actual media source withdrawal and Admin project deny";
  await page.goto(landing + "&operation=" + operation.id);
  await page.locator('.publication-inspector img[src*="/publications/operations/"]').waitFor();
  await system.db.control.query("UPDATE assets SET retention_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [asset.id]);
  await page.locator('.publication-inspector img[src*="/publications/operations/"]').waitFor({ state: "hidden" });
  await adminPage.reload();
  await adminPage.locator(".publication-admin-operation").filter({ hasText: unknown.id }).locator("button").first().click();
  await adminDialog.getByRole("button", { name: "View private content", exact: true }).click();
  const unknownBody = (await inject(customer, "GET", publications + "/operations/" + unknown.id)).content.draft.caption;
  await adminDialog.getByText(unknownBody, { exact: true }).waitFor();
  await system.db.control.query("UPDATE admin_bindings SET effect='deny' WHERE principal_id=$1 AND role_key=$2", [principal.id, role]);
  await adminPage.getByText(unknownBody, { exact: true }).waitFor({ state: "hidden" });
  await shot(adminPage, "admin", "permission-withdrawn", "Actual project deny withdraws private publishing body and available actions; source expiry also removes the customer media preview.");
  pass("Source expiry withdraws actual Web media; current Admin project deny withdraws private body and actions");

  const final = (await system.db.control.query("SELECT (SELECT count(*) FROM tasks)::text AS tasks,(SELECT count(*) FROM reservations)::text AS reservations,(SELECT count(*) FROM ai_gateway_requests)::text AS gateway")).rows[0];
  assert.deepEqual(final, initial); modelCalls = Number(final.gateway) - Number(initial.gateway);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  pass("Publishing review creates no AI task, reservation or model request; actual browser pages report no script errors");
} catch (failure) {
  errors.push(stage + ": " + String(failure));
  console.error(stage + ": " + String(failure)); process.exitCode = 1;
} finally {
  try { await stopRecording(); } catch (failure) { errors.push("recording cleanup: " + String(failure)); }
  if (browser) try { await browser.close(); browserClosed = true; } catch (failure) { errors.push("browser cleanup: " + String(failure)); }
  if (system) try { await system.app.close(); apiClosed = true; } catch (failure) { errors.push("API cleanup: " + String(failure)); }
  if (isolated) try { await isolated.cleanup(); fixtureClosed = true; } catch (failure) { errors.push("fixture cleanup: " + String(failure)); }
  const status = errors.length === 0 && browserClosed && apiClosed && fixtureClosed ? "passed" : "failed";
  await writeFile(prefix + "-journey.json", JSON.stringify({ at: new Date().toISOString(), status, stage, checks, errors, screenshots, recordings, layouts,
    model_calls: modelCalls, browser_closed: browserClosed, api_closed: apiClosed, fixture_closed: fixtureClosed,
    limits: ["Owned synthetic Meta provider; no live social account", "No actual Desktop or Chrome native Side Panel publishing acceptance", "Not full product acceptance"] }, null, 2) + "\n", { flag: "wx" });
  if (status !== "passed") process.exitCode = 1;
}
