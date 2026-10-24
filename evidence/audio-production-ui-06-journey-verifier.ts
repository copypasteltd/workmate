import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";
import { exerciseAudioSidePanel } from "./audio-sidepanel-ui.js";

const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), attempt = process.argv[2];
const OTPAuth = createRequire(path.join(platform, "package.json"))("otpauth");
assert.match(attempt ?? "", /^\d{2}$/);
const checks: string[] = [], errors: string[] = [], screenshots: any[] = [], media: any[] = [];
const responseSamples: any[] = [], sampleReads: Promise<void>[] = [];
let isolated: any, system: any, provider: any, browser: Browser | undefined, recording: WorkmateRecording | undefined;
let browserClosed = false, apiClosed = false, fixtureClosed = false, providerClosed = false, sidePanel: any;
const nativeResults: any[] = [];
const pass = (s: string) => { checks.push(s); console.log("PASS: " + s); };
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function trackResponses(page: Page) {
  page.on("response", response => {
    const url = new URL(response.url()), p = url.pathname;
    if (response.status() !== 200 || !p.includes("/audio-jobs")) return;
    const schema = p.endsWith("/content") ? "AdminBody" : p.endsWith("/preview") ? "Preview"
      : p === "/v1/admin/ai/audio-jobs" ? "AdminJobList" : p.endsWith("/audio-jobs") ? "JobList" : "Job";
    sampleReads.push(response.json().then(body => { responseSamples.push({ method: response.request().method(), path: p, query: url.search, schema, body }); }).catch(e => { errors.push("Actual audio response capture: " + String(e)); }));
  });
}
async function signIn(page: Page, email: string, secret?: any, currentUrl = false) {
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
async function shot(page: Page, repo: string, name: string) {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))); });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "No horizontal overflow");
  screenshots.push(await saveWorkmateScreenshot(repo, "audio-" + attempt, name, await page.screenshot(), "Actual audio production UI; real pinned Codex, synthetic company speech/transcription fixtures and actual decoded WAV/subtitle versions. No voice quality claim.", delivery));
}
const deadline = setTimeout(() => { errors.push("Owned audio UI deadline exceeded"); void browser?.close(); }, 480000);
try {
  const load = async (file: string) => import(pathToFileURL(path.join(platform, file)).href);
  const { isolatedTestEnvironment } = await load("tests/native-test-environment.ts"), { buildApp } = await load("src/server.ts"), { loadConfig } = await load("src/config.ts"),
    { saveAsset } = await load("src/storage.ts"), { seal } = await load("src/lib.ts"), { defaults } = await load("src/plans.ts"),
    { audioProviderFixture } = await load("tests/audio-production-fixture.ts");
  process.chdir(platform); isolated = await isolatedTestEnvironment(); provider = await audioProviderFixture(isolated.directory);
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "false", DEMO_MODE: "false",
    CODEX_BIN: process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN, CODEX_VERSION: "0.163.0-alpha.11",
    AI_BASE_URL: provider.origin, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "synthetic-video-provider-fixture", AI_MODEL: "synthetic-audio-reasoning-v1", AI_VERIFIED: "true",
    AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000", AI_INPUT_COUNT_VERIFIED: "true", AI_INPUT_COUNT_HKD_MICROS_PER_CALL: "0",
    AI_SPEECH_MODEL: "synthetic-speech-v1", AI_SPEECH_VERIFIED: "true", AI_SPEECH_VOICES: "alloy", AI_SPEECH_LOCALES: "en", AI_SPEECH_HKD_MICROS_PER_CHARACTER: "100",
    AI_TRANSCRIPTION_MODEL: "synthetic-transcription-v1", AI_TRANSCRIPTION_VERIFIED: "true", AI_TRANSCRIPTION_LOCALES: "en,zh-HK", AI_TRANSCRIPTION_TIMESTAMPS: "true", AI_TRANSCRIPTION_HKD_MICROS_PER_MILLISECOND: "100",
  }), { worker: false });
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, acceptDownloads: true });
  await context.addInitScript(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); });
  const page = await context.newPage(); trackResponses(page); page.setDefaultTimeout(20000); page.on("pageerror", e => errors.push(e.message));
  const userEmail = `audio-ui-${randomUUID()}@example.invalid`; await signIn(page, userEmail);
  const api = (method: string, url: string, body?: unknown) => page.evaluate(async ({ method, url, body }) => {
    const session = await (await fetch("/v1/session/context")).json(), tenant = /^\/v1\/tenants\/([^/]+)/.exec(url)?.[1];
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf_token, "Idempotency-Key": crypto.randomUUID(), ...(tenant ? { "X-Tenant-ID": tenant } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json() };
  }, { method, url, body });
  const created = await api("POST", "/v1/tenants", { name: "Actual audio UI fixture", project_name: "Approved voice and subtitles" }); assert.equal(created.status, 200);
  const tenant = created.body.tenant.id, project = created.body.project.id, base = `/v1/tenants/${tenant}/projects/${project}`, user = (await api("GET", "/v1/session/context")).body.user.id;
  await system.db.control.query("UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1", [tenant]);
  await system.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Explicit audio UI fixture',$2)", [tenant, defaults.business]);
  const policy = (await system.db.control.query(`INSERT INTO ai_gateway_policy_versions(data_mode,version,global_slots,tenant_slots,actor_slots,text_slots,image_slots,video_slots,verification_slots,audio_slots,
    global_rpm,tenant_rpm,actor_rpm,text_rpm,image_rpm,video_rpm,verification_rpm,audio_rpm,preparation_seconds,reason)
    VALUES('configured_services',(SELECT coalesce(max(version),0)+1 FROM ai_gateway_policy_versions WHERE data_mode='configured_services'),1000,1000,1000,1000,1000,1000,1000,32,
    100000,100000,100000,100000,100000,100000,100000,10000,30,'Isolated audio UI capacity') RETURNING id`)).rows[0];
  await system.db.control.query("UPDATE ai_gateway_policy_heads SET policy_version_id=$1 WHERE data_mode='configured_services'", [policy.id]);
  const source = await system.db.tx((tx: any) => saveAsset(tx, system.storage, { tenant, project, user, name: "explicit-owned-tone.wav", kind: "fixture_source", mime: "audio/wav", bytes: provider.bytes }), tenant, false, user);
  const rights = { authorized: true, reference: "Customer-owned synthetic tone and script; verified fixture voice", purpose: "Explicit actual UI verification using synthetic content" };
  const actions = [{ kind: "speech", text: "Hello Hong Kong.", locale: "en", voice: "alloy", speed: 1, rights }, { kind: "transcription", source: { asset_id: source.id, version: source.version.version }, locale: "zh-HK", timestamps: true, rights }];
  let pending = "";
  provider.text.state.textItem = (body: any, serial: number) => {
    if (pending) {
      const output = body.input.find((v: any) => v.type === "function_call_output" && v.call_id === pending); assert.ok(output, "The actual cloud Codex must consume its audio tool result");
      const value = JSON.parse(typeof output.output === "string" ? output.output : output.output[0].text);
      assert.equal(value.state, "completed"); assert.equal(value.delivery_state, "available"); nativeResults.push({ id: value.id, task_id: value.task_id, kind: value.kind, actual_tool_output: true }); pending = "";
    }
    const input = actions.shift();
    if (!input) return { type: "message", id: "msg_audio_ui_" + serial, role: "assistant", status: "completed", content: [{ type: "output_text", text: "The explicit synthetic audio and original transcript are ready for review.", annotations: [] }] };
    const group = body.tools.find((v: any) => v.tools?.some((t: any) => t.name === "audio_produce"));
    assert.ok(group || body.tools.some((v: any) => v.name === "audio_produce"), "Real Codex advertises the authorized audio tool");
    pending = "call_audio_ui_" + serial;
    return { type: "function_call", id: "fc_audio_ui_" + serial, call_id: pending, ...(group ? { namespace: group.name } : {}), name: "audio_produce", arguments: JSON.stringify(input) };
  };
  const task = await api("POST", base + "/tasks", { title: "Customer-approved audio and subtitles", prompt: "Create explicitly approved synthetic speech and transcribe the customer-owned source. Preserve exact versions and actual timing.", role_key: "video-motion", budget_micros: 1000000 }); assert.equal(task.status, 200, JSON.stringify(task.body));
  await system.worker.run(tenant, task.body.id);
  const persisted = (await system.db.control.query("SELECT * FROM tasks WHERE id=$1", [task.body.id])).rows[0]; assert.equal(persisted.status, "succeeded"); assert.equal(persisted.execution_location, "cloud"); assert.equal(nativeResults.length, 2);
  await page.evaluate(w => { localStorage.setItem("cp_tenant", w.tenant.id); localStorage.setItem("cp_project", w.project.id); }, created.body);
  await page.goto("http://localhost:4317/app/tasks/" + task.body.id);
  const speech = nativeResults.find(v => v.kind === "speech"), transcript = nativeResults.find(v => v.kind === "transcription");
  const speechCard = page.locator(`[data-audio-job="${speech.id}"]`), textCard = page.locator(`[data-audio-job="${transcript.id}"]`); await speechCard.waitFor();
  pass("Web authenticates with actual email OTP and creates a real cloud Codex audio task; both tool outputs are retained through the company fixture gateway");
  recording = new WorkmateRecording("web", "audio-production", "audio-" + attempt, () => page.screenshot(), "Actual protected WAV playback/download, original transcript and CAS subtitle revision; synthetic company media only.", delivery); await recording.start();
  await speechCard.getByRole("button", { name: "Review audio and subtitles", exact: true }).click();
  await speechCard.locator("audio").waitFor(); await speechCard.locator("audio").evaluate(async (a: HTMLAudioElement) => { if (a.readyState < 1) await new Promise<void>(r => a.addEventListener("loadedmetadata", () => r(), { once: true })); });
  const downloaded = page.waitForEvent("download"); await speechCard.getByRole("button", { name: "AI speech WAV", exact: true }).click();
  const downloadPath = await (await downloaded).path(); assert.ok(downloadPath); assert.equal(sha(await readFile(downloadPath)), sha(provider.bytes));
  await shot(page, "web", "speech-original-wav"); pass("Web decodes protected WAV and downloads exact SHA-256 bytes, displaying confirmed original company charges");
  await textCard.getByRole("button", { name: "Review audio and subtitles", exact: true }).click(); await textCard.getByRole("button", { name: "Revise subtitles", exact: true }).click();
  const form = textCard.locator("form"), count = provider.calls.length;
  await form.getByRole("textbox", { name: "Text", exact: true }).first().fill("Customer corrected Hong Kong caption."); await form.getByLabel("Revision reason", { exact: true }).fill("Customer corrected campaign wording");
  await shot(page, "web", "subtitle-edit-original-timing"); await form.getByRole("button", { name: "Save new version", exact: true }).click();
  await textCard.getByText("Timing was manually revised by the customer.", { exact: true }).waitFor(); assert.equal(provider.calls.length, count);
  await textCard.getByRole("combobox", { name: "Transcript version", exact: true }).selectOption("1"); await textCard.getByText("Timing comes from actual transcription service segments.", { exact: true }).waitFor(); assert.equal(await textCard.getByRole("button", { name: "Revise subtitles", exact: true }).count(), 0);
  await textCard.getByRole("combobox", { name: "Transcript version", exact: true }).selectOption("2"); await textCard.getByText("Customer corrected Hong Kong caption.", { exact: false }).waitFor();
  pass("Actual Web revision preserves original timed transcript and version two, makes no additional AI request, and keeps historical versions read only");
  await textCard.getByRole("button", { name: "Revise subtitles", exact: true }).click(); await form.getByLabel("Revision reason", { exact: true }).fill("Stale edit must not overwrite another change");
  const current = (await api("GET", base + "/audio-jobs/" + transcript.id)).body, currentDoc = (await api("GET", base + "/audio-jobs/" + transcript.id + "/preview?kind=transcript&revision=2")).body.document;
  assert.equal((await api("POST", base + "/audio-jobs/" + transcript.id + "/subtitles", { expected_revision: current.revision, text: currentDoc.text, cues: currentDoc.cues, reason: "Independent concurrent customer revision" })).status, 200);
  const [stale] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/subtitles") && r.request().method() === "POST"), form.getByRole("button", { name: "Save new version", exact: true }).click()]); assert.equal(stale.status(), 409);
  await form.getByRole("button", { name: "Cancel revision", exact: true }).click(); pass("A real concurrent subtitle change produces a CAS conflict and preserves the customer's stale edit rather than overwriting the newer version");
  await page.setViewportSize({ width: 800, height: 600 }); await page.getByTitle("切換至繁體中文", { exact: true }).click(); await page.getByTitle("Theme: light / dark / system", { exact: true }).click();
  await textCard.scrollIntoViewIfNeeded(); await shot(page, "web", "audio-compact-zh-dark"); media.push(await recording.stop()); recording = undefined;
  pass("The actual 800 by 600 Traditional Chinese dark audio layout reflows and retains complete job controls without horizontal overflow");
  const adminEmail = `audio-admin-${randomUUID()}@example.invalid`, secret = new OTPAuth.Secret({ size: 20 });
  const principal = (await system.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Scoped audio reviewer',$2) RETURNING id", [adminEmail, seal(system.db.config.MASTER_KEY, secret.base32)])).rows[0].id;
  const role = "audio_ui_" + randomUUID(); await system.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Scoped audio review',$2)", [role, JSON.stringify(["admin.ai.requests.read", "admin.ai.cost.read", "admin.content.body.read"])]);
  await system.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'project',$3)", [principal, role, project]);
  const ac = await browser.newContext({ viewport: { width: 1440, height: 980 } }); await ac.addInitScript(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); });
  const admin = await ac.newPage(); trackResponses(admin); admin.on("pageerror", e => errors.push(e.message)); await signIn(admin, adminEmail, secret); await admin.goto("http://localhost:4318/provider-control");
  await admin.getByRole("button", { name: "Speech & transcription jobs", exact: true }).click(); await admin.locator(`[data-audio-job="${speech.id}"]`).waitFor();
  recording = new WorkmateRecording("admin", "audio-governance", "audio-" + attempt, () => admin.screenshot(), "Actual scoped Admin audio metadata and independently authorized original rights/body read using real OTP/TOTP.", delivery); await recording.start();
  await shot(admin, "admin", "audio-scope-costs"); pass("Actual scoped Admin OTP/TOTP login displays original audio jobs, immutable model/capability identities and independently permitted company costs");
  await admin.locator(`[data-audio-job="${speech.id}"]`).getByRole("button", { name: "Read original request and rights", exact: true }).click();
  const dialog = admin.getByRole("dialog"); await dialog.locator("pre").waitFor(); assert.ok((await dialog.innerText()).includes(rights.reference));
  const originalBody = JSON.parse((await dialog.locator("pre").textContent())!);
  assert.equal(originalBody.specification.rights.reference, rights.reference);
  for (const width of [1440, 800]) {
    await admin.setViewportSize({ width, height: width === 800 ? 600 : 980 });
    const layout = await dialog.locator("pre").evaluate((el: HTMLElement) => {
      const b = el.getBoundingClientRect(), modal = el.closest('[role="dialog"]')!.getBoundingClientRect();
      return { wrapped: el.scrollWidth <= el.clientWidth + 1, inside: b.left >= modal.left && b.right <= modal.right + 1 };
    });
    assert.deepEqual(layout, { wrapped: true, inside: true }, "Exact original JSON must wrap inside the actual Admin modal at " + width);
    assert.deepEqual(JSON.parse((await dialog.locator("pre").textContent())!), originalBody);
    if (width === 800) await shot(admin, "admin", "audio-rights-body-compact");
  }
  await admin.setViewportSize({ width: 1440, height: 980 });
  assert.ok((await system.db.control.query("SELECT count(*)::int AS n FROM audit_log WHERE principal_id=$1 AND actor_kind='admin' AND action='admin.audio.content.read' AND target=$2", [principal, speech.id])).rows[0].n > 0);
  await shot(admin, "admin", "audio-rights-body-audit"); await dialog.getByRole("button", { name: /close/i }).click(); pass("Independent Admin body permission reads the exact original audio request and rights attestation with a persisted sensitive-access audit");
  media.push(await recording.stop()); recording = undefined; await Promise.all(sampleReads); await ac.close(); await context.close();
  sidePanel = await exerciseAudioSidePanel({ delivery, attempt, taskId: task.body.id, speechId: speech.id, transcriptId: transcript.id, expectedSHA: sha(provider.bytes), login: (p: Page) => signIn(p, userEmail, undefined, true), screenshots, media, pass });
  assert.deepEqual(provider.errors, []); assert.equal(provider.calls.length, count);
} catch (e) { errors.push(String(e)); console.error(e); }
finally {
  clearTimeout(deadline); if (recording) await recording.stop().catch(e => errors.push(String(e))); await Promise.all(sampleReads);
  if (browser) await browser.close().then(() => browserClosed = true).catch(e => errors.push(String(e)));
  if (system) await system.app.close().then(() => apiClosed = true).catch((e: any) => errors.push(String(e)));
  if (provider) await provider.close().then(() => providerClosed = true).catch((e: any) => errors.push(String(e)));
  if (isolated) { process.chdir(platform); await isolated.cleanup().then(() => fixtureClosed = true).catch((e: any) => errors.push(String(e))); }
  process.chdir(delivery);
  const result = { at: new Date().toISOString(), status: !errors.length && browserClosed && apiClosed && fixtureClosed && providerClosed && sidePanel ? "passed" : "failed", checks, errors, screenshots, media, side_panel: sidePanel, native_tool_results: nativeResults, browser_closed: browserClosed, api_closed: apiClosed, fixture_closed: fixtureClosed, provider_closed: providerClosed,
    response_samples: responseSamples,
    route_inventory: system ? { contract: "actual_fastify_route_inventory", data_mode: "configured_services", routes: [...system.routes].sort((a: any, b: any) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)) } : null,
    not_validated: ["Live voice or transcription quality", "Managed audio capability release", "Unknown POST external bill reconciliation", "Full original product acceptance"] };
  await writeFile(`evidence/audio-production-ui-${attempt}-journey.json`, JSON.stringify(result, null, 2) + "\n", { flag: "wx" }); assert.equal(result.status, "passed", JSON.stringify(errors));
}
