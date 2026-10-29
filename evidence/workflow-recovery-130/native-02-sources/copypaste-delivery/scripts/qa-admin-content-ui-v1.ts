import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";

const delivery = process.cwd(), platform = path.resolve("../copypaste-platform-admin-content-123"), attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const prefix = path.join(delivery, "evidence/admin-content-ui-" + attempt), checks: string[] = [], errors: string[] = [], screenshots: any[] = [], recordings: any[] = [];
let browser: Browser | undefined, system: any, isolated: any, recording: WorkmateRecording | undefined;
let stage = "setup", browserClosed = false, apiClosed = false, fixtureClosed = false;
const load = (file: string) => import(pathToFileURL(path.join(platform, file)).href);
const pass = (name: string) => { checks.push(name); console.log("PASS: " + name); };
async function shot(page: Page, name: string, description: string) {
  screenshots.push(await saveWorkmateScreenshot("admin-content-123", "admin-content-" + attempt, name, await page.screenshot(), description, delivery));
}
async function finish() { if (recording) { const current = recording; recording = undefined; recordings.push(await current.stop()); } }
async function fit(page: Page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "No page horizontal overflow");
  assert.equal(await page.locator('.modal').evaluate(el => el.scrollWidth <= el.clientWidth), true, "No dialog horizontal overflow");
}
try {
  const [{ isolatedTestEnvironment }, { buildApp }, { loadConfig }, { seal }, { defaults }] = await Promise.all([
    load("tests/native-test-environment.ts"), load("src/server.ts"), load("src/config.ts"), load("src/lib.ts"), load("src/plans.ts"),
  ]);
  process.chdir(platform); isolated = await isolatedTestEnvironment();
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", WORKER_ENABLED: "false",
    API_ORIGIN: "http://localhost:4310", WEB_ORIGIN: "http://localhost:4317", ADMIN_ORIGIN: "http://localhost:4318" }), { worker: false });
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  const OTP = createRequire(path.join(platform, "package.json"))("otpauth"), secret = new OTP.Secret({ size: 20 }), email = `admin-content-ui-${randomUUID()}@example.invalid`;
  async function inject(client: any, method: string, url: string, body?: any) {
    const response = await system.app.inject({ method, url, headers: { origin: "http://localhost:4317", ...(client ? { cookie: client.cookie, "x-csrf-token": client.csrf } : {}),
      ...(client?.tenant ? { "x-tenant-id": client.tenant } : {}), "idempotency-key": randomUUID() }, ...(body === undefined ? {} : { payload: body }) });
    assert.ok(response.statusCode >= 200 && response.statusCode < 300, `${method} ${url}: ${response.statusCode} ${response.body}`); return { data: response.json(), raw: response };
  }
  const customerEmail = `content-customer-${randomUUID()}@example.invalid`, challenge = (await inject(null, "POST", "/v1/auth/challenge", { email: customerEmail })).data;
  const customerMail = JSON.parse(await readFile(path.join(isolated.directory, "mailbox", challenge.challenge_id + ".json"), "utf8"));
  const verified = await inject(null, "POST", "/v1/auth/verify", { challenge_id: challenge.challenge_id, code: customerMail.text.match(/\b\d{6}\b/)[0] });
  const cookie = verified.raw.cookies.find((c: any) => c.name === "cp_session"), customer: any = { id: verified.data.user.id, cookie: cookie.name + "=" + cookie.value, csrf: verified.data.csrf_token };
  const workspace = (await inject(customer, "POST", "/v1/tenants", { name: "Harbour content studio · Explicit demo", project_name: "Hong Kong launch" })).data;
  const tenant = workspace.tenant.id, project = workspace.project.id, userBase = `/v1/tenants/${tenant}/projects/${project}`;
  customer.tenant = tenant;
  await inject(customer, "POST", `/v1/tenants/${tenant}/demo-credit`, {});
  await system.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Explicit synthetic UI fixture; no payment received',$2)", [tenant, defaults.business]);
  const agents = [];
  for (const name of ["Harbour coordinator", "Harbour creative specialist"]) agents.push((await inject(customer, "POST", userBase + "/agents", { name, role_key: "assistant", instructions: "Use approved campaign evidence and actual company tools." })).data);
  const team = (await inject(customer, "POST", "/v1/agent-groups", { project_id: project, name: "Harbour campaign team", coordinator_agent_id: agents[0].id,
    members: [{ agent_id: agents[1].id, role_description: "Prepare a bilingual campaign deliverable" }] })).data;
  const config = { schema_version: 1, name: "Harbour shared brief", instructions: "Use the approved Hong Kong product prices.", delivery_requirements: "Traditional Chinese and English; editable sources.", default_agent: null, brand: null, asset_version_ids: [], connection_ids: [], max_task_budget_micros: null };
  const draft = (await inject(customer, "PUT", userBase + "/project-configuration/draft", { expected_revision: 0, definition: config })).data;
  const preview = (await inject(customer, "POST", userBase + "/project-configuration/preview", { expected_revision: draft.revision })).data;
  await inject(customer, "POST", userBase + "/project-configuration/publish", { expected_revision: draft.revision, draft_sha256: preview.draft_sha256 });
  const oldTask = (await inject(customer, "POST", userBase + "/tasks", { title: "Pinned original project brief", prompt: "Review the approved brief", role_key: "assistant", budget_micros: 100000 })).data;
  const template = (await inject(customer, "GET", "/v1/agent-templates")).data.items.find((v: any) => v.role_key === "assistant");
  const method = (await inject(customer, "POST", "/v1/solution-versions", { project_id: project, name: "Harbour campaign method", instructions: "Read approved product facts and prepare an evidence-based campaign draft.", agent_template_ids: [template.id], skill_version_ids: [], required_assets: [], required_connectors: [] })).data;
  const admin = (await system.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Harbour content administrator',$2) RETURNING id", [email, seal(system.db.config.MASTER_KEY, secret.base32)])).rows[0];
  const role = "content_ui_" + randomUUID();
  await system.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Scoped UI content revision',$2)", [role, JSON.stringify(["admin.content.read", "admin.content.body.read", "admin.content.version.create"])]);
  await system.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'project',$3)", [admin.id, role, project]);
  const originalCounts = (await system.db.control.query("SELECT (SELECT count(*) FROM tasks)::text AS tasks,(SELECT count(*) FROM reservations)::text AS reservations,(SELECT count(*) FROM ai_gateway_requests)::text AS gateway")).rows[0];
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } }), page = await context.newPage();
  page.setDefaultTimeout(30000); page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => { if (!localStorage.getItem("cp_locale")) localStorage.setItem("cp_locale", "en"); if (!localStorage.getItem("cp_theme")) localStorage.setItem("cp_theme", "light"); });
  stage = "real administrator email and MFA";
  await page.goto("http://localhost:4318/login");
  await page.locator('input[name="email"]').fill(email);
  const [ch] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === "/v1/admin/auth/challenge"), page.locator('form button[type="submit"]').click()]);
  assert.equal(ch.ok(), true);
  const mail = JSON.parse(await readFile(path.join(isolated.directory, "mailbox", (await ch.json()).challenge_id + ".json"), "utf8"));
  await page.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);
  await page.locator('input[name="totp"]').fill(new OTP.TOTP({ secret, digits: 6, period: 30, algorithm: "SHA1" }).generate());
  await page.locator('form button[type="submit"]').click(); await page.locator(".admin-shell").waitFor();
  await page.goto("http://localhost:4318/content");
  await page.getByRole("row").filter({ hasText: "Harbour campaign team" }).waitFor();
  pass("Real email challenge and replay-protected MFA open a project-scoped content workspace");
  async function openContent(name: string) {
    await page.goto("http://localhost:4318/content");
    await page.getByRole("row").filter({ hasText: name }).getByRole("button", { name: /^Revise$|^修訂$/ }).click();
    await page.locator(".revision-form").waitFor();
  }
  async function previewChanges() {
    await page.locator(".content-revision").getByRole("button", { name: /Preview changes|預覽修訂差異/ }).click();
    await page.locator(".revision-diff").first().waitFor();
    await page.waitForFunction(() => document.activeElement?.classList.contains("revision-review"));
    assert.equal(await page.locator(".revision-review .button.primary").isDisabled(), true);
  }
  async function confirm() {
    await page.locator(".revision-consent input").check();
    await page.locator(".revision-review .button.primary").click();
    await page.locator(".revision-success").waitFor();
    await page.waitForFunction(() => document.activeElement?.classList.contains("revision-success"));
  }
  stage = "actual team revision";
  await openContent("Harbour campaign team");
  const coordinator = page.getByLabel("Coordinator", { exact: true });
  await page.getByLabel("Search available references", { exact: true }).fill("creative specialist");
  const [searched] = await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/options") && new URL(r.url()).searchParams.get("q") === "creative specialist"),
    page.getByRole("button", { name: "Search references", exact: true }).click(),
  ]);
  assert.equal(searched.ok(), true);
  assert.equal(await coordinator.inputValue(), agents[0].id);
  assert.equal(await page.getByLabel(/Specialist 1/, { exact: true }).inputValue(), agents[1].id);
  await page.getByLabel("Search available references", { exact: true }).fill("");
  await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/options") && new URL(r.url()).searchParams.get("q") === ""),
    page.getByRole("button", { name: "Search references", exact: true }).click(),
  ]);
  recording = new WorkmateRecording("admin-content-123", "team-revision", "admin-content-" + attempt, () => page.screenshot({ type: "jpeg", quality: 78 }), "Actual scoped team editing, preview and explicit confirmation; no model calls", delivery);
  await recording.start();
  await page.getByLabel("Name", { exact: true }).fill("Harbour team · approved revision");
  await page.getByLabel("Responsibilities 1", { exact: true }).fill("Prepare approved campaign copy and verify the editable source files.");
  await page.getByLabel("Reason for revision", { exact: true }).fill("Customer approved updated delivery responsibilities.");
  await previewChanges(); await fit(page);
  await shot(page, "team-preview-en", "Actual English team revision, before/after responsibilities and unchecked confirmation");
  await confirm(); await shot(page, "team-saved-en", "Actual committed team revision receipt"); await finish();
  const revisedTeam = (await inject(customer, "GET", "/v1/agent-groups/" + team.id)).data;
  assert.equal(revisedTeam.version, 2); assert.equal(revisedTeam.name, "Harbour team · approved revision");
  const provenance = (await system.db.control.query("SELECT created_by,created_by_admin FROM agent_group_versions WHERE group_id=$1 AND version=2", [team.id])).rows[0];
  assert.equal(provenance.created_by, null); assert.equal(provenance.created_by_admin, admin.id);
  pass("A real form, exact preview and explicit confirmation append a customer-visible team version with distinct administrator provenance");
  await page.locator(".revision-success").getByRole("button", { name: "Done", exact: true }).click();
  await page.evaluate(() => localStorage.setItem("cp_locale", "zh-HK")); await page.reload();
  stage = "shared brief publication and old task pinning";
  await openContent("Harbour shared brief");
  recording = new WorkmateRecording("admin-content-123", "brief-method-revisions", "admin-content-" + attempt, () => page.screenshot({ type: "jpeg", quality: 78 }), "Actual bilingual brief publication and method draft creation through authenticated Admin UI", delivery);
  await recording.start();
  await page.getByLabel(/工作說明|Instructions/, { exact: true }).fill("只使用已確認的香港價格與繁英文品牌語氣。Use approved Hong Kong prices and bilingual brand tone.");
  await page.getByLabel(/每項任務預算上限|Per-task budget limit/).fill("12.345678");
  await page.getByLabel(/修訂原因|Reason for revision/, { exact: true }).fill("客戶已確認新的品牌說明和每項任務預算上限。");
  await previewChanges(); await page.setViewportSize({ width: 375, height: 900 }); await fit(page);
  assert.ok((await page.locator(".revision-review").innerText()).includes("HK$12.345678"));
  await shot(page, "brief-preview-zh-375", "Actual Traditional Chinese brief revision at 375px; exact HKD budget comparison and no horizontal overflow");
  await page.setViewportSize({ width: 1440, height: 1080 }); await confirm();
  const currentBrief = (await inject(customer, "GET", userBase + "/project-configuration")).data.published;
  assert.equal(currentBrief.version, 2); assert.equal(currentBrief.body.max_task_budget_micros, 12345678);
  assert.equal((await system.db.control.query("SELECT input_context FROM tasks WHERE id=$1", [oldTask.id])).rows[0].input_context.project_configuration.version, 1);
  pass("Shared brief revision publishes exact references, replaces the draft, preserves the old task version and renders exact HKD at a narrow width");
  await page.keyboard.press("Escape");
  stage = "actual method draft revision";
  await page.goto("http://localhost:4318/solutions");
  await page.locator(".admin-solution-list article").filter({ hasText: "Harbour campaign method" }).getByRole("button", { name: /建立修訂草稿|Create revision draft/ }).click();
  await page.locator(".revision-form").waitFor();
  await page.getByLabel(/工作說明|Instructions/, { exact: true }).fill("核對產品事實後，提供可編輯的繁英推廣稿，列明缺少的資料。");
  await page.getByLabel(/所需資料，每行一項|Required materials, one per line/, { exact: true }).fill("Approved price sheet\nBrand voice notes");
  await page.getByLabel(/修訂原因|Reason for revision/, { exact: true }).fill("客戶要求加入明確資料清單，仍需原有試運行和發佈。");
  await previewChanges(); await fit(page); await shot(page, "method-preview-zh", "Actual method instructions and multiline input requirements; creates a draft rather than publishing");
  await confirm(); await finish();
  const family = (await system.db.control.query("SELECT * FROM solution_versions WHERE family_id=(SELECT family_id FROM solution_versions WHERE id=$1) ORDER BY version", [method.id])).rows;
  assert.equal(family.length, 2); assert.equal(family[1].state, "draft"); assert.equal(family[1].created_by_admin, admin.id); assert.equal(family[1].published_at, null);
  assert.deepEqual(family[1].definition.required_assets, ["Approved price sheet", "Brand voice notes"]);
  pass("The method editor saves real multiline requirements as a new draft without bypassing customer trial or publication");
  await page.keyboard.press("Escape");
  stage = "lost response and metadata-only recovery after reload";
  await openContent("Harbour team · approved revision");
  await page.getByLabel(/名稱|Name/, { exact: true }).fill("Harbour team corrected after disconnect");
  await page.getByLabel(/修訂原因|Reason for revision/, { exact: true }).fill("PRIVATE RECOVERY REASON: approved customer correction");
  await previewChanges();
  let deliveredApplies = 0;
  const pattern = "**/v1/admin/content-revisions/agent_groups/*/apply";
  await page.route(pattern, async route => { deliveredApplies++; const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort("failed"); });
  await page.locator(".revision-consent input").check(); await page.locator(".revision-review .button.primary").click();
  await page.locator(".revision-pending").waitFor();
  const storage = await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith("cp_admin_content_revision:")).map(k => sessionStorage.getItem(k)));
  assert.equal(storage.length, 1); assert.equal(storage[0]!.includes("PRIVATE RECOVERY REASON"), false); assert.equal(storage[0]!.includes("Harbour team corrected"), false);
  await shot(page, "unknown-response-recovery", "Real revision committed while its HTTP response is deliberately dropped; browser keeps signed metadata only");
  await page.unroute(pattern); await page.reload();
  await page.locator(".revision-recovery").getByRole("button").click();
  await page.locator(".revision-pending").getByRole("button", { name: /核對原提交結果|Check original outcome/ }).click();
  await page.locator(".revision-success").waitFor();
  assert.equal(deliveredApplies, 1); assert.equal((await system.db.control.query("SELECT version FROM agent_groups WHERE id=$1", [team.id])).rows[0].version, 3);
  assert.deepEqual(await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith("cp_admin_content_revision:"))), []);
  pass("A genuinely lost committed response recovers after reload through the original receipt, with no body storage and no second mutation");
  await page.keyboard.press("Escape");
  stage = "live authority withdrawal clears private editor state";
  await openContent("Harbour team corrected after disconnect");
  await page.getByLabel(/工作職責|Responsibilities/).fill("PRIVATE ROLE DETAIL: unsaved customer content");
  await page.getByLabel(/修訂原因|Reason for revision/, { exact: true }).fill("PRIVATE REASON: must disappear after withdrawal");
  await system.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,'project',$3,'deny')", [admin.id, role, project]);
  await page.locator(".revision-form").waitFor({ state: "detached", timeout: 25000 });
  const visible = await page.locator(".content-revision").innerText();
  assert.equal(visible.includes("PRIVATE ROLE DETAIL"), false); assert.equal(visible.includes("PRIVATE REASON"), false);
  await shot(page, "authority-withdrawn", "Actual project-scoped permission withdrawal clears the already-open private revision form without a page reload");
  pass("A real scoped deny clears the open editor, preview, reason and private history during live permission revalidation");
  const finalCounts = (await system.db.control.query("SELECT (SELECT count(*) FROM tasks)::text AS tasks,(SELECT count(*) FROM reservations)::text AS reservations,(SELECT count(*) FROM ai_gateway_requests)::text AS gateway")).rows[0];
  assert.deepEqual(finalCounts, originalCounts); assert.equal(finalCounts.gateway, "0");
  pass("All administrator revisions preserve task and reservation counts and make zero AI gateway requests");
} catch (e) { errors.push(stage + ": " + String(e)); console.error(stage, e); }
finally {
  if (recording) try { await finish(); } catch (e) { errors.push("recording cleanup: " + String(e)); }
  if (browser) try { await browser.close(); browserClosed = true; } catch (e) { errors.push("browser cleanup: " + String(e)); }
  if (system) try { await system.app.close(); apiClosed = true; } catch (e) { errors.push("API cleanup: " + String(e)); }
  if (isolated) try { await isolated.cleanup(); fixtureClosed = true; } catch (e) { errors.push("fixture cleanup: " + String(e)); }
  const status = errors.length === 0 && checks.length === 7 && screenshots.length === 6 && recordings.length === 2 && browserClosed && apiClosed && fixtureClosed ? "passed" : "failed";
  await writeFile(prefix + "-journey.json", JSON.stringify({ at: new Date().toISOString(), status, stage, checks, errors, screenshots, recordings,
    browser_closed: browserClosed, api_closed: apiClosed, fixture_closed: fixtureClosed, model_calls: 0,
    simulation_scope: "Model/media data are authorized synthetic fixtures. UI, email/MFA, PostgreSQL revisions and dropped HTTP response use the actual implementation." }, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status, checks: checks.length, errors, browser_closed: browserClosed }));
  if (status !== "passed") process.exitCode = 1;
}
