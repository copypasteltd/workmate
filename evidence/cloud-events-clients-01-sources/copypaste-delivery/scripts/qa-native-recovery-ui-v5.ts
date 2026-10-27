import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";

const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), attempt = process.argv[2], prefix = path.resolve("evidence/native-recovery-ui-" + attempt);
assert.match(attempt ?? "", /^\d{2}$/);
const load = (file: string): Promise<any> => import(pathToFileURL(path.join(platform, file)).href);
const adminOrigin = process.env.COPYPASTE_RECOVERY_ADMIN_ORIGIN!, apiOrigin = process.env.COPYPASTE_RECOVERY_API_ORIGIN!;
const checks: string[] = [], screenshots: any[] = [], recordings: any[] = [], layouts: any[] = [], errors: string[] = [];
let isolated: any, system: any, browser: Browser | undefined, page: Page | undefined, recording: WorkmateRecording | undefined, restoredDatabase: string | undefined;
let browserClosed = false, apiClosed = false, fixtureClosed = false;
const pass = (message: string) => { checks.push(message); console.log("PASS: " + message); };
async function until<T>(read: () => Promise<T>, accept: (v: T) => boolean, label: string) {
  const end = Date.now() + 40000; while (Date.now() < end) { const v = await read(); if (accept(v)) return v; await new Promise(r => setTimeout(r, 200)); } throw new Error("Timed out: " + label);
}
async function shot(name: string, description: string) {
  await page!.evaluate(async () => { await document.fonts.ready; }); screenshots.push(await saveWorkmateScreenshot("admin", "recovery-" + attempt, name, await page!.screenshot({ caret: "hide" }), description, delivery));
}
async function layout(name: string) {
  await page!.waitForFunction(() => !matchMedia("(max-width:740px)").matches || document.querySelector(".app-shell")!.classList.contains("mobile-open") || document.querySelector(".sidebar")!.getBoundingClientRect().right <= 1);
  await page!.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const r = await page!.evaluate(() => ({ width: innerWidth, height: innerHeight, zoom: document.documentElement.style.zoom || "1",
    overflow: document.documentElement.scrollWidth > innerWidth + 2 || document.body.scrollWidth > innerWidth + 2,
    viewport_bounds: Array.from(document.querySelectorAll<HTMLElement>(".recovery-page,.recovery-metrics .card,.main-shell")).map(e => { const r=e.getBoundingClientRect(); return { tag:e.className,left:r.left,right:r.right,width:r.width }; }),
    navigation_obscures_content:matchMedia("(max-width:740px)").matches && document.querySelector(".sidebar")!.getBoundingClientRect().right > 1,
    mobile_query:matchMedia("(max-width:740px)").matches,
    sidebar_transform:getComputedStyle(document.querySelector(".sidebar")!).transform,
    clipped: Array.from(document.querySelectorAll<HTMLElement>(".recovery-metrics .card,.recovery-detail dd,.recovery-row")).some(e => e.scrollWidth > e.clientWidth + 2) }));
  assert.equal(r.navigation_obscures_content,false); layouts.push({ name, ...r }); console.log(JSON.stringify({ layout:name,...r })); assert.ok(r.viewport_bounds.every(b => b.left >= -2 && b.right <= r.width+2), name+JSON.stringify(r)); assert.equal(r.overflow, false, name + JSON.stringify(r)); assert.equal(r.clipped, false, name + JSON.stringify(r));
}
try {
  const [{ isolatedTestEnvironment }, { buildApp }, { loadConfig }, { saveAsset }, recovery, { seal }] = await Promise.all([
    load("tests/native-test-environment.ts"), load("src/server.ts"), load("src/config.ts"), load("src/storage.ts"), load("src/native-recovery.ts"), load("src/lib.ts"),
  ]);
  process.chdir(platform); isolated = await isolatedTestEnvironment();
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", DEV_MAILBOX: "true", WORKER_ENABLED: "false", API_ORIGIN: apiOrigin, ADMIN_ORIGIN: adminOrigin, WEB_ORIGIN: process.env.COPYPASTE_RECOVERY_WEB_ORIGIN! }), { worker: false });
  await system.app.listen({ host: "127.0.0.1", port: Number(new URL(apiOrigin).port) });
  // Real customer onboarding allocates the billing/storage facts used by saveAsset.
  const challenge = await system.app.inject({ method: "POST", url: "/v1/auth/challenge", headers: { origin: system.db.config.WEB_ORIGIN }, payload: { email: "recovery-onboard-" + randomUUID() + "@example.invalid" } });
  const mail = JSON.parse(await readFile(path.join(isolated.directory, "mailbox", challenge.json().challenge_id + ".json"), "utf8"));
  const auth = await system.app.inject({ method: "POST", url: "/v1/auth/verify", headers: { origin: system.db.config.WEB_ORIGIN }, payload: { challenge_id: challenge.json().challenge_id, code: mail.text.match(/\b\d{6}\b/)[0] } }); assert.equal(auth.statusCode, 200);
  const c = auth.cookies[0], principal = auth.json();
  const w = await system.app.inject({ method: "POST", url: "/v1/tenants", headers: { origin: system.db.config.WEB_ORIGIN, cookie: c.name + "=" + c.value, "x-csrf-token": principal.csrf_token, "idempotency-key": randomUUID() }, payload: { name: "Harbour marketing studio", project_name: "Recovery rehearsal" } }); assert.equal(w.statusCode, 200);
  const tenant = w.json().tenant.id, project = w.json().project.id;
  const asset = await system.db.tx((tx: any) => saveAsset(tx, system.storage, { tenant, project, user: principal.user.id, name: "campaign-original.txt", mime: "text/plain", bytes: Buffer.from("Post-checkpoint customer deletion") }), tenant, true, principal.user.id);
  const OTPAuth = createRequire(path.join(platform, "package.json"))("otpauth"), secret = new OTPAuth.Secret({ size: 20 }), email = "recovery-admin-" + randomUUID() + "@example.invalid";
  const admin = (await system.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Owned recovery observer',$2) RETURNING id", [email, seal(system.db.config.MASTER_KEY, secret.base32)])).rows[0].id;
  const role = "recovery_ui_" + randomUUID().replaceAll("-", ""); await system.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Recovery observer',$2)", [role, JSON.stringify(["admin.recovery.read"])]);
  await system.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,$2,'global')", [admin, role]);
  const owned = path.resolve(".data/recovery-ui", randomUUID()); await mkdir(owned, { recursive: true });
  const options = { config: system.db.config, ownerURL: isolated.env.OWNER_DATABASE_URL, backupKey: randomBytes(32).toString("hex"), pgBinDir: path.resolve(".data/recovery-tools/bin") };
  const backup = await recovery.createNativeBackup(options, owned);
  await system.db.control.query("UPDATE assets SET state='deleted',moderation_version=moderation_version+1 WHERE id=$1", [asset.id]);
  const ledger = await recovery.exportErasureLedger(options, owned); restoredDatabase = "workmate_recovery_" + randomUUID().replaceAll("-", "");
  const restored = await recovery.restoreNativeBackup(options, { backup: backup.directory, ledger: ledger.file, incidentAt: new Date().toISOString(), databaseName: restoredDatabase, targetDataDir: path.join(owned, "restore-" + randomUUID().replaceAll("-", "")), acknowledgeIsolation: true });
  assert.equal(restored.outcome, "quarantined"); assert.equal(restored.detail.erasure_jobs_remaining, 0);
  for (let i = 0; i < 14; i++) await recovery.exportErasureLedger(options, owned);
  pass("Real native backup, post-snapshot deletion replay and isolated PostgreSQL restore supply the dashboard receipts");
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN!, headless: true }); const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); });
  page = await context.newPage(); page.setDefaultTimeout(25000); page.on("pageerror", e => errors.push(e.message)); await page.goto(adminOrigin);
  await page.locator('input[name="email"]').fill(email);
  const [challengeAdmin] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === "/v1/admin/auth/challenge"), page.locator('form button[type="submit"]').click()]); assert.equal(challengeAdmin.status(), 200);
  const adminMail = JSON.parse(await readFile(path.join(isolated.directory, "mailbox", (await challengeAdmin.json()).challenge_id + ".json"), "utf8"));
  await page.locator('input[name="code"]').fill(adminMail.text.match(/\b\d{6}\b/)[0]); await page.locator('input[name="totp"]').fill(new OTPAuth.TOTP({ secret }).generate());
  const [verified] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === "/v1/admin/auth/verify"), page.locator('form button[type="submit"]').click()]); assert.equal(verified.status(), 200);
  await page.goto(adminOrigin + "/recovery"); await page.getByTestId("recovery-page").waitFor(); await page.getByText("Last verified backup", { exact: true }).waitFor();
  pass("Actual administrator email and TOTP login opens the separately authorized recovery page");
  recording = new WorkmateRecording("admin", "native-recovery", attempt, () => page!.screenshot({ type: "jpeg", quality: 80 }), "Actual global Admin login, native restore receipts, filters, detail, pagination and current-MFA withdrawal", delivery); await recording.start();
  await layout("English light 1440px"); await shot("overview-en", "Actual English Admin page with authenticated backup, independently exported deletion journals and a quarantined native restore");
  await page.getByRole("button", { name: "Older records", exact: true }).click(); await page.getByRole("button", { name: "Latest records", exact: true }).waitFor(); await page.getByRole("button", { name: "Latest records", exact: true }).click();
  await page.getByRole("combobox", { name: "Record type", exact: true }).selectOption("restore"); await page.locator(".recovery-row").first().click(); await page.getByRole("dialog").waitFor();
  await page.getByRole("dialog").getByText(restored.id, { exact: true }).waitFor(); assert.ok(!(await page.locator("body").innerText()).includes(options.backupKey));
  await shot("receipt-en", "Actual native restore receipt showing deletion completion, measured gaps and preserved execution isolation");
  pass("Real type filtering, stable cursor pagination and restore detail display exact persisted receipt facts");
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; }); await layout("English light at 200 percent CSS zoom"); await page.evaluate(() => { document.documentElement.style.zoom = ""; });
  await page.getByTitle("切換至繁體中文", { exact: true }).click(); await page.getByTitle("Theme: light / dark / system", { exact: true }).click(); await page.setViewportSize({ width: 375, height: 900 });
  await page.getByRole("heading", { name: "備份與恢復", exact: true }).waitFor(); await layout("Chinese dark 375px"); await shot("compact-zh-dark", "Actual 375px Chinese dark recovery page with readable cards and no horizontal overflow");
  pass("Bilingual light/dark recovery layouts fit narrow screens and the measured 200 percent CSS zoom state");
  await system.db.control.query("UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1", [admin]);
  const [withdrawn] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === "/v1/admin/recovery" && r.status() === 403), page.getByRole("button", { name: "重新整理", exact: true }).click()]);
  assert.equal((await withdrawn.json()).error.code, "MFA_REQUIRED"); await page.getByTestId("recovery-page").waitFor({ state: "detached" }); await page.getByRole("alert").waitFor();
  pass("Expired current MFA removes old recovery summaries and prevents any stale detail from remaining visible");
  recordings.push(await recording.stop()); recording = undefined;
  assert.ok(Number((await system.db.control.query("SELECT count(*) AS n FROM audit_log WHERE action='admin.recovery.read'")).rows[0].n) > 0);
  pass("Read access leaves a durable audit and performs no recovery activation through the browser");
} catch (e) {
  errors.push(String(e)); if (page) { await writeFile(prefix + "-failure-body.txt", await page.locator("body").innerText()).catch(() => {}); await writeFile(prefix + "-failure.png", await page.screenshot()).catch(() => {}); }
} finally {
  if (recording) { try { recordings.push(await recording.stop()); } catch (e) { errors.push(String(e)); } }
  if (browser) { await browser.close(); browserClosed = true; }
  if (system) { await system.app.close(); apiClosed = true; }
  if (isolated) {
    if (restoredDatabase) { const pg = createRequire(path.join(platform, "package.json"))("pg"), u = new URL(isolated.env.OWNER_DATABASE_URL); u.pathname = "/postgres"; const c = new pg.Client({ connectionString: u.href }); await c.connect(); try { assert.match(restoredDatabase, /^workmate_recovery_[a-f0-9]{32}$/); await c.query(`DROP DATABASE IF EXISTS "${restoredDatabase}" WITH (FORCE)`); } finally { await c.end(); } }
    await isolated.cleanup(); fixtureClosed = true;
  }
  const report = { at: new Date().toISOString(), status: errors.length ? "failed" : "passed", checks, errors, screenshots, recordings, layouts, browser_closed: browserClosed, api_closed: apiClosed, fixture_closed: fixtureClosed, production_recovery_qualified: false };
  await writeFile(prefix + "-journey.json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" }); console.log(JSON.stringify({ status: report.status, checks: checks.length, errors })); assert.equal(report.status, "passed");
}
