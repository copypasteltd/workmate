import assert from "node:assert/strict";
import { chromium, _electron, type Page, type Browser, type ElectronApplication, type Route } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";

const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const prefix = `evidence/scope-erasure-150/ui-${attempt}`, owned = process.env.COPYPASTE_BUSINESS_INPUTS_OWNED!;
const checks: string[] = [], screenshots: any[] = [], recordings: any[] = [], layouts: any[] = [], errors: string[] = [], diagnostics: any[] = [];
const load = (file: string) => import(pathToFileURL(path.join(platform, file)).href);
let isolated: any, system: any, browser: Browser | undefined, electron: ElectronApplication | undefined, recording: WorkmateRecording | undefined;
let browserClosed = false, desktopClosed = false, apiClosed = false, fixtureClosed = false, stage = "setup";
let releaseHeld: (() => void) | undefined;
async function until(fn: () => Promise<any>, valid: (v: any) => boolean, label: string) {
  const end = Date.now() + 45000;
  for (;;) { const v = await fn(); if (valid(v)) return v; assert.ok(Date.now() < end, label); await new Promise(r => setTimeout(r, 100)); }
}
async function stopRecording() { if (recording) { const r = recording; recording = undefined; recordings.push(await r.stop()); } }
async function shot(client: string, p: Page, name: string) {
  screenshots.push(await saveWorkmateScreenshot(client, `scope-erasure-150-${attempt}`, name, await p.screenshot({ timeout: 15000 }),
    "Actual Web or packaged native Desktop; real OTP/PKCE, permanent scope confirmation and cleanup, synthetic company data, no model call", delivery));
}
function observe(p: Page) {
  p.setDefaultTimeout(25000);
  p.on("pageerror", e => errors.push(e.message));
  p.on("response", async r => { if (r.status() >= 400 && r.url().includes("/v1/")) diagnostics.push({ path: new URL(r.url()).pathname, status: r.status(), body: (await r.text().catch(() => "unreadable")).slice(0, 2000) }); });
}
const timer = setTimeout(() => { errors.push("Focused project journey deadline"); releaseHeld?.(); void electron?.close(); void browser?.close(); }, 480000);
try {
  const [{ isolatedTestEnvironment }, { buildApp }, { loadConfig }] = await Promise.all([
    load("tests/native-test-environment.ts"), load("src/server.ts"), load("src/config.ts"),
  ]);
  process.chdir(platform);
  isolated = await isolatedTestEnvironment();
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", WORKER_ENABLED: "false", DEMO_MODE: "true", DEV_MAILBOX: "true",
    API_ORIGIN: "http://localhost:4310", WEB_ORIGIN: "http://localhost:4317", ADMIN_ORIGIN: "http://localhost:4318" }), { worker: false });
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); });
  const web = await context.newPage(); observe(web);
  stage = "Actual Web OTP and new-workspace onboarding";
  const email = `erasure-journey-${randomUUID()}@example.invalid`;
  await web.goto("http://localhost:4317/login");
  await web.locator('input[name="email"]').fill(email);
  const [challengeResponse] = await Promise.all([
    web.waitForResponse(r => new URL(r.url()).pathname === "/v1/auth/challenges"),
    web.locator('form button[type="submit"]').click(),
  ]);
  assert.equal(challengeResponse.status(), 202);
  const challenge = await challengeResponse.json(), mail = JSON.parse(await readFile(path.join(isolated.directory, "mailbox", challenge.challenge_id + ".json"), "utf8"));
  await web.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);
  await web.locator('form button[type="submit"]').click();
  await web.waitForURL("**/welcome");
  await web.locator('input[name="name"]').fill("CopyPaste project studio");
  await web.locator('input[name="project_name"]').fill("Harbour launch");
  const [workspaceResponse] = await Promise.all([
    web.waitForResponse(r => new URL(r.url()).pathname === "/v1/tenants" && r.request().method() === "POST"),
    web.getByRole("button", { name: "Create workspace & continue", exact: true }).click(),
  ]);
  assert.equal(workspaceResponse.status(), 200);
  const workspace = await workspaceResponse.json(), tenant = workspace.tenant.id, project = workspace.project.id;
  await web.locator(".app-shell").waitFor();
  await until(() => web.getByRole("combobox", { name: "Current project", exact: true }).inputValue(), v => v === project, "Onboarded active project");
  checks.push("Actual Web email OTP, new company onboarding and initial active project selection");

  const { ErasureService } = await load("src/erasure.ts");
  async function drain(targetTenant: string) {
    for (let i=0;i<15;i++) {
      await system.db.control.query("UPDATE deletion_jobs SET next_attempt_at=clock_timestamp() WHERE tenant_id=$1 AND state='queued'", [targetTenant]);
      await new ErasureService(system.db,system.storage).advance(150);
      if (!(await system.db.control.query("SELECT 1 FROM deletion_jobs WHERE tenant_id=$1 AND state NOT IN('completed','completed_with_exceptions')",[targetTenant])).rowCount) return;
    }
    throw new Error("Aggregate cleanup did not reach completion");
  }
  async function confirmation(p:Page, client:string, name:string, root:boolean) {
    const modal=p.getByRole("dialog"),submit=modal.getByRole("button",{name:"Confirm permanent deletion",exact:true});
    await modal.getByLabel("Type the exact name to confirm",{exact:true}).fill("wrong name");
    for(const cb of await modal.getByRole("checkbox").all()) await cb.check();
    assert.equal(await submit.isDisabled(),true);
    await modal.getByLabel("Type the exact name to confirm",{exact:true}).fill(name);
    await shot(client,p,"permanent-delete-confirmation-en.png");
    if(client === "desktop") {
      // Native requests travel through Electron's bridge, outside page network events.
      await submit.click();
      await until(async()=>!!(await system.db.control.query("SELECT 1 FROM tenants WHERE id=$1 AND erasure_requested_at IS NOT NULL",[tenant])).rowCount,Boolean,"Actual native irreversible request committed");
    } else {
      const [response]=await Promise.all([p.waitForResponse(r=>r.url().endsWith("/erasure")&&r.request().method()==="POST"),submit.click()]);
      assert.equal(response.status(),202,await response.text());
    }
    await modal.waitFor({state:"hidden"});
    checks.push(client+": exact-name confirmation, acknowledgements, current-authority permanent "+(root?"workspace":"project")+" request");
  }
  stage="Web project permanent deletion and independent cleanup history";
  await web.goto("http://localhost:4317/app/projects");
  const card=web.locator(`[data-project-id="${project}"]`);await card.waitFor();
  recording=new WorkmateRecording("web","scope-cleanup",`scope-erasure-150-${attempt}`,()=>web.screenshot({type:"jpeg",quality:72,timeout:15000}),"Actual project permanent deletion confirmation and cleanup history; synthetic data",delivery);await recording.start();
  await card.getByRole("button",{name:"Permanently delete",exact:true}).click();
  await confirmation(web,"web","Harbour launch",false);
  await web.waitForURL("**/cleanup");await drain(tenant);
  await web.getByText("Cleaned · retention policy applies",{exact:true}).waitFor();
  await web.getByText("Review retention",{exact:true}).click();
  await shot("web",web,"scope-cleanup-completed-en.png");await stopRecording();
  for(const width of[1440,390]){await web.setViewportSize({width,height:1000});const v=await web.evaluate(()=>({width:innerWidth,no_horizontal_overflow:document.documentElement.scrollWidth<=innerWidth}));assert.ok(v.no_horizontal_overflow);layouts.push({client:"web",...v});}
  await web.setViewportSize({width:1440,height:1000});
  stage = "Actual packaged Desktop native PKCE";
  electron = await _electron.launch({ executablePath: process.env.COPYPASTE_LOCAL_DESKTOP_CANDIDATE!, env: { ...process.env, COPYPASTE_USER_DATA: path.join(owned, "desktop") } });
  const desktop = await electron.firstWindow(); observe(desktop); await desktop.waitForURL(/^file:/);
  await desktop.evaluate(({ tenant, project }) => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); localStorage.setItem("cp_tenant", tenant); localStorage.setItem("cp_project", project); }, { tenant, project });
  await desktop.reload();
  await electron.evaluate(({ shell }: any) => { shell.openExternal = async (url: string) => { (globalThis as any).__scope150Auth = url; }; });
  await desktop.getByRole("button", { name: "Sign in securely in your browser", exact: true }).click();
  const auth = await context.newPage();
  try {
    await auth.goto(await until(() => electron!.evaluate(() => (globalThis as any).__scope150Auth), Boolean, "Native PKCE authorization URL"));
    await auth.getByRole("link", { name: /Authorize & return|授權並返回應用/ }).click();
    await desktop.locator(".app-shell").waitFor();
  } finally { await auth.close(); }
  checks.push("Actual packaged Windows Desktop authorization using the existing signed-in Web session and native PKCE");
  stage="Desktop last-workspace permanent deletion and history outside workspace shell";
  await desktop.evaluate(()=>{location.hash="/app/projects";});
  await desktop.getByRole("button",{name:"Permanently delete workspace",exact:true}).waitFor();
  recording=new WorkmateRecording("desktop","scope-cleanup",`scope-erasure-150-${attempt}`,()=>desktop.screenshot({type:"jpeg",quality:72,timeout:15000}),"Actual unsigned frameless Desktop permanent last-workspace deletion and account-level cleanup history; synthetic data",delivery);await recording.start();
  await desktop.getByRole("button",{name:"Permanently delete workspace",exact:true}).click();
  await confirmation(desktop,"desktop","CopyPaste project studio",true);
  await until(()=>desktop.evaluate(()=>location.hash),v=>v==="#/cleanup","Last-workspace history route");
  await drain(tenant);await desktop.locator(".scope-cleanup-card").first().waitFor();
  await shot("desktop",desktop,"last-workspace-cleanup-en.png");await stopRecording();
  const nativeMe=await system.db.control.query("SELECT t.status,p.archived FROM tenants t JOIN projects p ON p.tenant_id=t.id WHERE t.id=$1",[tenant]);assert.ok(nativeMe.rows.every((r:any)=>r.status==='suspended'&&r.archived));
  for(const width of[1360,1000]){await electron!.evaluate(({BrowserWindow}:any,w:number)=>BrowserWindow.getAllWindows()[0].setSize(w,960),width);const v=await desktop.evaluate(()=>({width:innerWidth,no_horizontal_overflow:document.documentElement.scrollWidth<=innerWidth,rails_hidden:[...document.querySelectorAll('.sidebar,.main-content')].every(n=>getComputedStyle(n).scrollbarWidth==='none')}));assert.ok(v.no_horizontal_overflow&&v.rails_hidden);layouts.push({client:"desktop",...v});}
  assert.equal(await electron!.evaluate(({BrowserWindow}:any)=>BrowserWindow.getAllWindows()[0].isMenuBarVisible()),false);
  stage="Administrator MFA and current-scope permanent cleanup";
  const {historyLogin,historyOk,historyAdmin}=await load("tests/admin-history-fixture.ts");
  const actor=await historyLogin(system),other=await historyOk(system,actor,"POST","/v1/tenants",{name:"Admin cleanup studio",project_name:"Admin campaign"});
  const operator=await historyAdmin(system,other.project.id,["admin.content.read","admin.content.delete"]);
  const cookie=operator.client.cookie.split('=');await context.addCookies([{name:cookie[0],value:cookie.slice(1).join('='),url:"http://localhost:4318",httpOnly:true,sameSite:"Lax"}]);
  const admin=await context.newPage();observe(admin);await admin.goto("http://localhost:4318/content");
  recording=new WorkmateRecording("admin","scope-cleanup",`scope-erasure-150-${attempt}`,()=>admin.screenshot({type:"jpeg",quality:72,timeout:15000}),"Actual administrator MFA session, authorized project permanent cleanup and retained progress; synthetic data",delivery);await recording.start();
  await admin.getByLabel("Target ID",{exact:true}).fill(other.project.id);await admin.getByRole("button",{name:"Preview permanent cleanup",exact:true}).click();
  await confirmation(admin,"admin","Admin campaign",false);await drain(other.tenant.id);
  await admin.locator(`[data-cleanup-id]`).first().waitFor();await shot("admin",admin,"admin-scope-cleanup-en.png");await stopRecording();
  checks.push("Actual last-workspace independent history, retained account identity, Desktop hidden native menu and responsive no-horizontal-overflow layouts");
} catch (e) { errors.push(stage + ": " + String(e)); }
finally {
  clearTimeout(timer); releaseHeld?.();
  try { await stopRecording(); } catch (e) { errors.push(String(e)); }
  if (electron) try { await electron.close(); desktopClosed = true; } catch (e) { errors.push(String(e)); }
  if (browser) try { await browser.close(); browserClosed = true; } catch (e) { errors.push(String(e)); }
  if (system) try { await system.app.close(); apiClosed = true; } catch (e) { errors.push(String(e)); }
  if (isolated) try { await isolated.cleanup(); fixtureClosed = true; } catch (e) { errors.push(String(e)); }
  process.chdir(delivery);
  const result = { at: new Date().toISOString(), status: !errors.length && checks.length === 6 && browserClosed && desktopClosed && apiClosed && fixtureClosed ? "passed" : "failed",
    checks, errors, diagnostics, screenshots, recordings, layouts, browser_closed: browserClosed, desktop_closed: desktopClosed, api_closed: apiClosed, fixture_closed: fixtureClosed,
    scope: "Focused real Web OTP/onboarding, packaged frameless Desktop PKCE and project/workspace permanent confirmation, current-scope administrator cleanup and account-level history. No model call, no whole-product acceptance; broad historical regression omitted." };
  await writeFile(path.join(delivery, prefix + "-journey.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: result.status, checks: checks.length, errors })); process.exitCode = result.status === "passed" ? 0 : 1;
}
