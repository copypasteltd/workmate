import assert from "node:assert/strict";
import { chromium, _electron, type Browser, type BrowserContext, type ElectronApplication, type Page, type CDPSession } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { unzipSync } from "fflate";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";

const attempt = process.argv[2]; assert.match(attempt ?? "", /^\d{2}$/);
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), extension = path.resolve("../copypaste-extension"), prefix = `evidence/creative-brand-142/ui-${attempt}`;
const owned = process.env.COPYPASTE_BUSINESS_INPUTS_OWNED!, checks: string[] = [], screenshots: any[] = [], recordings: any[] = [], layouts: any[] = [], archives: any[] = [], errors: string[] = [], diagnostics: any[] = [];
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex"), load = (file: string) => import(pathToFileURL(path.join(platform, file)).href);
let isolated: any, system: any, browser: Browser | undefined, extensionContext: BrowserContext | undefined, electron: ElectronApplication | undefined,
  recording: WorkmateRecording | undefined, panel: any, browserClosed = false, extensionClosed = false, desktopClosed = false, apiClosed = false, fixtureClosed = false, failure: string | null = null, stage = "setup";
const pass = (name: string) => { checks.push(name); console.log("PASS: " + name); };
async function until(read: () => Promise<any>, valid: (v: any) => boolean, name: string, ms = 45000) { const end = Date.now() + ms;
  for (;;) { const value = await read(); if (valid(value)) return value; assert.ok(Date.now() < end, name); await new Promise(r => setTimeout(r, 120)); } }
async function shot(component: string, page: Page, name: string) { screenshots.push(await saveWorkmateScreenshot(component, `creative-brand-142-${attempt}`, name, await page.screenshot(), "Actual project package upload, verified restore and continued editing; synthetic business data, no AI generation", delivery)); }
async function stopRecording() { if (recording) { const active = recording; recording = undefined; recordings.push(await active.stop()); } }
async function attachTarget(parent: CDPSession, targetId: string) {
  const { sessionId } = await parent.send("Target.attachToTarget", { targetId, flatten: false }); let sequence = 0; const pending = new Map<number, any>();
  const receive = (event: any) => { if (event.sessionId !== sessionId) return; const m = JSON.parse(event.message), p = pending.get(m.id); if (!p) return;
    clearTimeout(p.timer); pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); };
  parent.on("Target.receivedMessageFromTarget", receive);
  return { send(method: string, params: any = {}): Promise<any> { const id = ++sequence; return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("Side Panel command timed out: " + method)); }, 20000); pending.set(id, { resolve, reject, timer });
    void parent.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
  }); }, async close() { parent.removeListener("Target.receivedMessageFromTarget", receive); for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error("Owned target closed")); } pending.clear(); await parent.send("Target.detachFromTarget", { sessionId }).catch(() => {}); } };
}
async function evaluate(expression: string) { const r = await panel.send("Runtime.evaluate", { expression, returnByValue: true, userGesture: true, awaitPromise: true }); assert.equal(r.exceptionDetails, undefined, JSON.stringify(r.exceptionDetails)); return r.result.value; }
try {
  await mkdir(owned, { recursive: true });
  const [{ isolatedTestEnvironment }, { buildApp }, { loadConfig }, fixtures, { saveAsset }, { createCanvas }, { advanceVideoProjects }] = await Promise.all([
    load("tests/native-test-environment.ts"), load("src/server.ts"), load("src/config.ts"), load("tests/admin-history-fixture.ts"), load("src/storage.ts"), load("node_modules/@napi-rs/canvas/index.js"), load("src/video-projects.ts")]);
  process.chdir(platform); isolated = await isolatedTestEnvironment();
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", WORKER_ENABLED: "false", DEMO_MODE: "true", DEV_MAILBOX: "true",
    API_ORIGIN: "http://localhost:4310", WEB_ORIGIN: "http://localhost:4317", ADMIN_ORIGIN: "http://localhost:4318" }), { worker: false });
  system.app.addHook("onError", async (req: any, _reply: any, error: Error) => diagnostics.push({ url: req.url, error: error.stack }));
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  const owner = await fixtures.historyLogin(system), workspace = await fixtures.historyOk(system, owner, "POST", "/v1/tenants", { name: "CopyPaste campaign studio", project_name: "Original creative source" });
  owner.tenant = workspace.tenant.id; const tenant = workspace.tenant.id, project = workspace.project.id;
  const target = await fixtures.historyOk(system, owner, "POST", `/v1/tenants/${tenant}/projects`, { name: "Restored campaign workspace" });
  const base = `/v1/tenants/${tenant}/projects/${project}`, destination = `/v1/tenants/${tenant}/projects/${target.id}`;
  const canvas = createCanvas(64, 64), ctx = canvas.getContext("2d"); ctx.fillStyle = "#b8c5cf"; ctx.fillRect(0, 0, 64, 64); ctx.fillStyle = "#15171a"; ctx.fillRect(15, 15, 34, 34);
  const media = await system.db.tx((tx: any) => saveAsset(tx, system.storage, { tenant, project, user: owner.id, name: "Campaign source.png", mime: "image/png", bytes: canvas.toBuffer("image/png") }), tenant, false, owner.id);
  const save = async (p: string, name: string, color: string) => {
    const c = createCanvas(64,64), g = c.getContext("2d"); g.fillStyle=color; g.fillRect(0,0,64,64);
    return system.db.tx((tx: any) => saveAsset(tx,system.storage,{tenant,project:p,user:owner.id,name,mime:"image/png",bytes:c.toBuffer("image/png")}),tenant,false,owner.id);
  };
  const originalLogo = await save(project,"Original Logo.png","#15171a"), targetLogo = await save(target.id,"Destination Logo.png","#2352df");
  const brandDefinition = (destination: boolean) => ({schema_version:2,name:destination?"CopyPaste Destination":"CopyPaste Original",colors:destination?["#e7eefc","#15171a","#2352df"]:["#f6f6f4","#15171a"],tone:"Clear and useful",
    font_bindings:[{key:destination?"display":"body",label:"Noto Sans TC",source:{builtin:"noto-sans-tc"},rights:{source:"Noto project",license:"SIL Open Font License 1.1",channels:["web"],valid_until:null}}],
    facts:[{key:destination?"offer":"price",kind:"price",text:destination?"New season":"Launch offer",amount_minor:destination?19800:12800,currency:"HKD"}],
    logos:[{key:destination?"identity":"mark",asset_id:destination?targetLogo.id:originalLogo.id,version:1,usage:"Campaign Logo",min_width:64,clear_space:16}],locales:["en-HK"],channels:["web"]});
  const sourceBrand=await fixtures.historyOk(system,owner,"POST",base+"/brand/definitions",brandDefinition(false)),
    targetBrand=await fixtures.historyOk(system,owner,"POST",destination+"/brand/definitions",brandDefinition(true));
  const brandChoiceId=(await system.db.control.query("SELECT id FROM brand_profile_versions WHERE brand_id=$1 AND version=1",[targetBrand.id])).rows[0].id;
  const source = await fixtures.historyOk(system,owner,"POST",base+"/creative",{name:"Original brand campaign",body:{width:640,height:800,background:"#f6f6f4",brand:{id:sourceBrand.id,version:1,channel:"web",locale:"en-HK"},layers:[
    {type:"image",asset_id:originalLogo.id,version:1,x:32,y:32,width:96,height:96},
    {type:"image",asset_id:media.id,version:1,x:32,y:150,width:576,height:350},
    {type:"text",text:"Launch price",font_key:"body",fact_key:"price",x:32,y:570,font_size:26,color:"#15171a"},
    {type:"text",text:"MAKE SPACE FOR MORE.",font_key:"body",x:32,y:640,font_size:22,color:"#15171a"}]}});
  const raw=await system.app.inject({method:"GET",url:`${base}/creative-project-packages/${source.id}?expected_version=1`,headers:{cookie:owner.cookie,"x-tenant-id":tenant}});
  assert.equal(raw.statusCode,200,raw.body.slice(0,200));
  const inputFiles={canvas:path.join(owned,"brand-canvas.zip")}; await writeFile(inputFiles.canvas,raw.rawPayload,{flag:"wx"});
  assert.equal(JSON.parse(Buffer.from(unzipSync(raw.rawPayload)["manifest.json"]).toString()).brand_requirements.source_name,"CopyPaste Original");
  archives.push({kind:"brand_canvas",purpose:"actual source export used across different projects",path:path.relative(delivery,inputFiles.canvas).replaceAll("\\","/"),sha256:sha(raw.rawPayload),files:Object.keys(unzipSync(raw.rawPayload)).length});
  async function login(page: Page, url: string) {
    await system.db.control.query("UPDATE auth_challenges SET created_at=clock_timestamp()-interval '2 minutes' WHERE email=$1", [owner.email]);
    await page.goto(url); await page.locator('input[name="email"]').fill(owner.email);
    const [response] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === "/v1/auth/challenges"), page.locator('form button[type="submit"]').click()]); assert.equal(response.status(), 202);
    const challenge = await response.json(), mail = JSON.parse(await readFile(path.join(isolated.directory, "mailbox", challenge.challenge_id + ".json"), "utf8"));
    await page.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]); await page.locator('form button[type="submit"]').click();
  }
  async function restoreUI(page: Page,file: string,name: string,component: string){
    const region=page.getByRole("region",{name:"Project packages & restore",exact:true}); await region.waitFor();
    await region.getByRole("checkbox").first().check(); await region.locator('input[type="file"]').setInputFiles(file);
    await region.getByRole("button",{name:"Upload or resume",exact:true}).click(); await region.locator("[data-package-preview]").waitFor({timeout:60000});
    await region.getByLabel("New project name",{exact:true}).fill(name);
    const brands=region.getByLabel("Fixed destination brand version",{exact:true});
    await brands.locator(`option[value="${brandChoiceId}"]`).waitFor({state:"attached"}); await brands.selectOption(brandChoiceId);
    await region.getByLabel("fonts:body",{exact:true}).selectOption("display");
    await region.getByLabel("facts:price",{exact:true}).selectOption("offer");
    await region.getByLabel("logos:mark",{exact:true}).selectOption("identity");
    await region.getByText("Apply destination brand colors (optional)",{exact:true}).click();
    await region.getByLabel("color:#f6f6f4",{exact:true}).selectOption("#e7eefc");
    await region.getByRole("button",{name:"Review brand changes",exact:true}).click(); await region.locator("[data-brand-review]").waitFor();
    assert.match(await region.locator("[data-brand-review]").innerText(),/198\.00/);
    await region.getByRole("checkbox",{name:/I confirm media rights for this project/}).check();
    assert.equal(await region.getByRole("button",{name:"Restore a new project",exact:true}).isDisabled(),true);
    await region.getByRole("checkbox",{name:/I reviewed fonts, facts, Logos/}).check();
    await region.locator("[data-brand-review]").scrollIntoViewIfNeeded(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Reviewed brand form must fit the client width"); await shot(component,page,"brand-mapping-reviewed-en");
    await region.getByRole("button",{name:"Restore a new project",exact:true}).click(); await region.locator("[data-package-restored]").waitFor();
    const result=(await system.db.control.query("SELECT * FROM creative_projects WHERE project_id=$1 AND name=$2",[target.id,name])).rows[0];
    assert.equal(result.body.brand.id,targetBrand.id); assert.equal(result.body.layers[0].asset_id,targetLogo.id); assert.match(result.body.layers[2].text,/198\.00/); assert.equal(result.body.background,"#e7eefc");
    return result;
  }
  stage = "Web restore and source editing";
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true }); const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, acceptDownloads: true });
  await context.addInitScript(({ tenant, project }) => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); localStorage.setItem("cp_tenant", tenant); localStorage.setItem("cp_project", project); }, { tenant, project: target.id });
  const web = await context.newPage(); web.on("pageerror", e => errors.push(e.message)); await login(web, "http://localhost:4317/login"); await web.waitForURL("**/app**"); await web.goto("http://localhost:4317/app/creative");
  recording = new WorkmateRecording("web", "project-restore", `creative-brand-142-${attempt}`, () => web.screenshot({ type: "jpeg", quality: 72 }), "Actual browser upload, package verification, restore, layer edit and real PNG render; synthetic business data", delivery); await recording.start();
  const webRestored = await restoreUI(web, inputFiles.canvas, "Web restored campaign", "web"); assert.ok(webRestored); assert.notEqual(webRestored.id, source.id);
  const card = web.locator("article.project-card").filter({ has: web.getByRole("heading", { name: "Web restored campaign", exact: true }) });
  await card.getByRole("button", { name: "Edit layered source", exact: true }).click(); const modal = web.getByRole("dialog");
  const text = modal.locator('textarea[name="source"]'), definition = JSON.parse(await text.inputValue()); definition.layers[3].text = "Restored. Edited. Ready."; await text.fill(JSON.stringify(definition));
  await modal.getByRole("button", { name: "Save new version", exact: true }).click(); await modal.waitFor({ state: "hidden" });
  await card.getByRole("button", { name: "PNG", exact: true }).click(); await card.locator(".design-export-result").waitFor(); await card.scrollIntoViewIfNeeded();
  const downloaded = web.waitForEvent("download"); await card.getByRole("button", { name: "Download export", exact: true }).click(); const png = await downloaded, pngFile = path.join(owned, "web-restored.png"); await png.saveAs(pngFile);
  assert.equal((await readFile(pngFile)).subarray(0, 8).toString("hex"), "89504e470d0a1a0a"); await shot("web", web, "restored-edited-rendered-en");
  const webPackages=web.getByRole("region",{name:"Project packages & restore",exact:true}); await webPackages.getByRole("button",{name:"Refresh project versions",exact:true}).click();
  await until(()=>webPackages.locator(`option[value="${webRestored.id}"]`).textContent(),v=>!!v?.includes("v2"),"Web exact version refresh");
  await webPackages.getByRole("combobox").selectOption(webRestored.id); const webExportEvent=web.waitForEvent("download"); await webPackages.getByRole("button",{name:"Download complete project ZIP",exact:true}).click();
  const webExport=await webExportEvent, webZip=path.join(owned,"web-branded-v2.zip"); await webExport.saveAs(webZip); const webBytes=await readFile(webZip);
  assert.equal(JSON.parse(Buffer.from(unzipSync(webBytes)["manifest.json"]).toString()).brand_requirements.source_name,"CopyPaste Destination");
  archives.push({kind:"brand_canvas",purpose:"actual Web v2 export after restored layer editing and PNG render",path:path.relative(delivery,webZip).replaceAll("\\","/"),sha256:sha(webBytes),files:Object.keys(unzipSync(webBytes)).length}); await stopRecording();
  pass("Web OTP login uploads a brand ZIP, explicitly reviews new brand mappings and price, restores into a different project, edits layers and downloads actual PNG plus a complete v2 ZIP");
  stage = "Frameless packaged Desktop brand restore and source editing";
  electron = await _electron.launch({ executablePath: process.env.COPYPASTE_LOCAL_DESKTOP_CANDIDATE!, env: { ...process.env, COPYPASTE_USER_DATA: path.join(owned, "desktop") } });
  const desktop = await electron.firstWindow(); desktop.on("pageerror", e => errors.push(e.message)); desktop.setDefaultTimeout(30000); await desktop.waitForURL(/^file:/);
  await desktop.evaluate(({ tenant, project }) => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); localStorage.setItem("cp_tenant", tenant); localStorage.setItem("cp_project", project); }, { tenant, project: target.id }); await desktop.reload();
  const savedZip = path.join(owned, "desktop-restored-project.zip");
  await electron.evaluate(({ shell, dialog }, file) => { shell.openExternal = async (url: string) => { (globalThis as any).__cp140Auth = url; }; dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, savedZip);
  recording = new WorkmateRecording("desktop", "project-restore", `creative-brand-142-${attempt}`, () => desktop.screenshot({ type: "jpeg", quality: 72 }), "Actual frameless Windows package login, brand mapping review, source editing, PNG rendering and native ZIP save; synthetic campaign content", delivery); await recording.start();
  await desktop.getByRole("button", { name: "Sign in securely in your browser", exact: true }).click();
  const authContext = await browser.newContext(); await authContext.addInitScript(() => localStorage.setItem("cp_locale", "en"));
  const auth = await authContext.newPage(); await login(auth, await until(() => electron!.evaluate(() => (globalThis as any).__cp140Auth), Boolean, "native PKCE link")); await auth.getByRole("link", { name: /Authorize & return|授權並返回應用/ }).click();
  await desktop.locator(".app-shell").waitFor(); await authContext.close(); await desktop.evaluate(() => { location.hash = "/app/creative"; });
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960,900));
  const nativeRestored=await restoreUI(desktop,inputFiles.canvas,"Desktop restored brand campaign","desktop"); assert.equal(nativeRestored.kind,"poster");
  const nativeCard=desktop.locator("article.project-card").filter({has:desktop.getByRole("heading",{name:"Desktop restored brand campaign",exact:true})});
  await nativeCard.getByRole("button",{name:"Edit layered source",exact:true}).click(); const editor=desktop.getByRole("dialog"), sourceInput=editor.locator('textarea[name="source"]');
  const nativeDefinition=JSON.parse(await sourceInput.inputValue()); nativeDefinition.layers[3].text="A new chapter. Made here."; await sourceInput.fill(JSON.stringify(nativeDefinition));
  await editor.getByRole("button",{name:"Save new version",exact:true}).click(); await editor.waitFor({state:"hidden"});
  await nativeCard.getByRole("button",{name:"PNG",exact:true}).click(); await nativeCard.locator(".design-export-result").waitFor(); await nativeCard.scrollIntoViewIfNeeded();
  await shot("desktop",desktop,"restored-brand-rendered-en");
  const packageRegion=desktop.getByRole("region",{name:"Project packages & restore",exact:true}); await packageRegion.getByRole("button",{name:"Refresh project versions",exact:true}).click();
  await until(()=>packageRegion.locator(`option[value="${nativeRestored.id}"]`).textContent(),v=>!!v?.includes("v2"),"current destination brand canvas version");
  await packageRegion.getByRole("combobox").selectOption(nativeRestored.id); await packageRegion.getByRole("button",{name:"Download complete project ZIP",exact:true}).click();
  const savedBytes=await until(async()=>{try{return await readFile(savedZip);}catch{return null;}},v=>!!v?.length,"native fixed-version brand ZIP save");
  const nativeManifest=JSON.parse(Buffer.from(unzipSync(savedBytes)["manifest.json"]).toString()); assert.equal(nativeManifest.brand_requirements.source_name,"CopyPaste Destination");
  archives.push({kind:"brand_canvas",purpose:"actual packaged Desktop export after brand restoration and editing",path:path.relative(delivery,savedZip).replaceAll("\\","/"),sha256:sha(savedBytes),files:Object.keys(unzipSync(savedBytes)).length});
  for (const width of [1360, 960]) { await electron.evaluate(({ BrowserWindow }, width) => { BrowserWindow.getAllWindows()[0].setSize(width, 900); }, width);
    const layout = await desktop.evaluate(() => ({ width: innerWidth, no_horizontal_overflow: document.documentElement.scrollWidth <= innerWidth, rails_hidden: [...document.querySelectorAll(".sidebar,.main-content")].every(n => getComputedStyle(n).scrollbarWidth === "none") })); layouts.push({ client: "desktop", ...layout }); assert.ok(layout.no_horizontal_overflow); assert.ok(layout.rails_hidden); }
  assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarVisible()), false);
  pass("Actual frameless Windows package uses OTP/PKCE, reviews and restores destination brand mappings, edits source, renders PNG and saves a complete v2 ZIP through the native dialog");
  await stopRecording();
  await electron.close(); electron = undefined; desktopClosed = true;
  stage = "Actual Chrome native right SIDE_PANEL restore";
  const id = (await readFile(path.join(extension, "extension-id.txt"), "utf8")).trim();
  extensionContext = await chromium.launchPersistentContext(path.join(owned, "chrome"), { executablePath: process.env.CHROME_BIN, headless: false, viewport: null,
    args: ["--disable-gpu", "--window-size=1480,1080", "--enable-unsafe-extension-debugging", "--disable-extensions-except=" + path.join(extension, "dist"), "--load-extension=" + path.join(extension, "dist")] });
  const worker = extensionContext.serviceWorkers()[0] ?? await extensionContext.waitForEvent("serviceworker"); await worker.evaluate(() => chrome.storage.local.set({ locale: "en" }));
  const main = extensionContext.pages()[0]; await main.goto("http://localhost:4317/"); const width = await main.evaluate(() => innerWidth), tabs = extensionContext.pages().length, cdp = await extensionContext.browser()!.newBrowserCDPSession();
  const tab = (await cdp.send("Target.getTargets", { filter: [{}] })).targetInfos.find(t => t.type === "tab" && t.url.startsWith("http://localhost:4317")); assert.ok(tab);
  await until(() => worker.evaluate(() => chrome.sidePanel.getPanelBehavior()), v => v.openPanelOnActionClick, "toolbar binding"); await (cdp as any).send("Extensions.triggerAction", { id, targetId: tab.targetId });
  const native = await until(() => worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] })), v => v.length === 1, "actual native side panel");
  assert.equal((await worker.evaluate(() => chrome.sidePanel.getLayout())).side, "right"); await until(() => main.evaluate(() => innerWidth), v => v < width - 250, "right panel reduces page width"); assert.equal(extensionContext.pages().length, tabs);
  const nativeTarget = await until(async () => (await cdp.send("Target.getTargets", { filter: [{}] })).targetInfos.find(t => t.type === "page" && t.url === native[0].documentUrl), Boolean, "side panel target"); panel = await attachTarget(cdp, nativeTarget.targetId);
  await until(() => evaluate("document.querySelector('#sign-in') && !document.querySelector('#sign-in').disabled"), Boolean, "native sign-in control");
  await system.db.control.query("UPDATE auth_challenges SET created_at=clock_timestamp()-interval '2 minutes' WHERE email=$1", [owner.email]);
  recording = new WorkmateRecording("extension", "project-restore", `creative-brand-142-${attempt}`, async () => Buffer.from((await panel.send("Page.captureScreenshot", { format: "jpeg", quality: 72, captureBeyondViewport: false })).data, "base64"), "Actual Chrome native right SIDE_PANEL login, multipart brand ZIP upload, reviewed destination facts/fonts/Logo/colors and new-copy restore; synthetic campaign content", delivery); await recording.start();
  const popupEvent = extensionContext.waitForEvent("page"); await evaluate("document.querySelector('#sign-in').click()"); const popup = await popupEvent;
  await login(popup, popup.url()); await popup.getByRole("link", { name: /Authorize & return|授權並返回應用/ }).click();
  await until(() => evaluate("!document.querySelector('#workspace').hidden"), Boolean, "side panel authenticated");
  await evaluate(`document.querySelector('#project').value=${JSON.stringify(target.id)};document.querySelector('#project').dispatchEvent(new Event('change',{bubbles:true}));`);
  await until(() => evaluate("!document.querySelector('#creative-package-workspace').hidden"), Boolean, "project packages loaded");
  await until(() => evaluate("!document.querySelector('#creative-package-workspace select').disabled"), Boolean, "side panel project list is ready");
  await evaluate("document.querySelector('#workspace-tools').open=true;document.querySelector('#creative-package-workspace').open=true;document.querySelector('#creative-package-workspace .creative-package-consent input').click();");
  const panelDocument = await panel.send("DOM.getDocument"), input = await panel.send("DOM.querySelector", { nodeId: panelDocument.root.nodeId, selector: '#creative-package-workspace input[type="file"]' }); await panel.send("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [inputFiles.canvas] });
  await evaluate("document.querySelector('#creative-package-workspace .creative-package-panel>button:last-of-type').click()");
  await until(() => evaluate("!!document.querySelector('#creative-package-workspace [data-package-preview]')"), Boolean, "actual brand archive multipart upload and inspection", 90000);
  await evaluate(`document.querySelector('#creative-package-workspace [aria-label="New project name"]').value='Extension restored brand campaign';`);
  await until(()=>evaluate(`!!document.querySelector('.creative-brand-rebind option[value="${brandChoiceId}"]')`),Boolean,"destination brand options in native Side Panel");
  await evaluate(`{const s=document.querySelector('.creative-brand-rebind select');s.value=${JSON.stringify(brandChoiceId)};s.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await until(()=>evaluate(`!!document.querySelector('[aria-label="fonts:body"]')`),Boolean,"native mapping fields");
  await evaluate(`for(const [name,value] of [['fonts:body','display'],['facts:price','offer'],['logos:mark','identity'],['color:#f6f6f4','#e7eefc']]){const s=document.querySelector('[aria-label="'+name+'"]');s.value=value;s.dispatchEvent(new Event('change',{bubbles:true}));} [...document.querySelectorAll('.creative-brand-rebind button')].find(b=>b.textContent==='Review brand changes').click();`);
  await until(()=>evaluate(`document.querySelector('.creative-brand-fields article')?.textContent`),v=>typeof v==="string"&&v.includes("198.00"),"native reviewed target price");
  await until(()=>evaluate(`!document.querySelector('.creative-brand-fields').disabled`),Boolean,"brand review complete");
  await evaluate(`document.querySelector('#creative-package-workspace [data-package-preview]>.creative-package-consent input').click();`);
  assert.equal(await evaluate(`[...document.querySelectorAll('#creative-package-workspace button')].find(b=>b.textContent==='Restore a new project').disabled`),true);
  await evaluate(`document.querySelector('.creative-brand-fields .creative-package-consent input').click();document.querySelector('.creative-brand-fields article').scrollIntoView({block:'start'});`);
  assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"),true,"Native reviewed brand form must fit its Side Panel");
  screenshots.push(await saveWorkmateScreenshot("extension",`creative-brand-142-${attempt}`,"native-sidepanel-brand-review-en",Buffer.from((await panel.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false})).data,"base64"),"Actual native right SIDE_PANEL reviews destination fonts, price, Logo and colors before restoring a new copy",delivery));
  await evaluate(`[...document.querySelectorAll('#creative-package-workspace button')].find(b=>b.textContent==='Restore a new project').click()`);
  await until(()=>evaluate("document.querySelector('#creative-package-workspace [data-package-restored]')?.textContent"),v=>typeof v==="string"&&v.includes("Extension restored brand campaign"),"native brand restore");
  const extensionRestored = (await system.db.control.query("SELECT * FROM creative_projects WHERE project_id=$1 AND name='Extension restored brand campaign'", [target.id])).rows[0]; assert.ok(extensionRestored); assert.equal(extensionRestored.body.brand.id,targetBrand.id); assert.equal(extensionRestored.body.layers[0].asset_id,targetLogo.id); assert.match(extensionRestored.body.layers[2].text,/198\.00/);
  const layout = await evaluate("({width:innerWidth,no_horizontal_overflow:document.documentElement.scrollWidth<=innerWidth})"); assert.ok(layout.no_horizontal_overflow); layouts.push({ client: "extension_side_panel", ...layout });
  assert.equal((await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] }))).length, 1);
  pass("Toolbar opens the actual native right SIDE_PANEL, uses PKCE and multipart upload, explicitly reviews destination brand facts/fonts/Logo/colors and restores a new copy without a replacement app tab");
  await stopRecording();
  await panel.close(); panel = undefined; await cdp.detach(); await extensionContext.close(); extensionContext = undefined; extensionClosed = true;
  const originals = (await system.db.control.query("SELECT id,version FROM creative_projects WHERE id=ANY($1::uuid[]) ORDER BY id", [[source.id]])).rows; assert.equal(originals.length, 1); assert.ok(originals.every((r: any) => r.version === 1));
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM current_ai_provider_requests WHERE tenant_id=$1", [tenant])).rows[0].n, 0);
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM creative_projects WHERE project_id=$1", [target.id])).rows[0].n, 3);
  pass("All three clients create one new target copy each; original versions stay intact and no model request or AI fee is created");
} catch (e) { failure = String(e); diagnostics.push({ stage, stack: (e as Error).stack }); }
finally {
  try { await stopRecording(); } catch (e) { failure ??= String(e); }
  if (panel) await panel.close().catch(() => {});
  if (electron) try { await electron.close(); desktopClosed = true; } catch (e) { failure ??= String(e); }
  if (extensionContext) try { await extensionContext.close(); extensionClosed = true; } catch (e) { failure ??= String(e); }
  if (browser) try { await browser.close(); browserClosed = true; } catch (e) { failure ??= String(e); }
  if (system) try { await system.app.close(); apiClosed = true; } catch (e) { failure ??= String(e); }
  if (isolated) try { await isolated.cleanup(); fixtureClosed = true; } catch (e) { failure ??= String(e); }
  process.chdir(delivery);
}
const passed = !failure && !errors.length && checks.length === 4 && screenshots.length === 5 && recordings.length === 3 && archives.length === 3 && layouts.length === 3
  && recordings.every(r => r.distinct_frames > 1 && r.skipped_capture_errors === 0) && browserClosed && extensionClosed && desktopClosed && apiClosed && fixtureClosed;
const report = { at: new Date().toISOString(), status: passed ? "passed" : "failed", stage, failure, checks, screenshots, recordings, layouts, archives, errors, diagnostics,
  browser_closed: browserClosed, extension_closed: extensionClosed, desktop_closed: desktopClosed, api_closed: apiClosed, fixture_closed: fixtureClosed,
  model_mode: "No model requests. Synthetic campaign assets; real OTP/PKCE, native PostgreSQL, brand ZIP bytes and destination mapping reviews, Web upload/edit/render, actual unsigned frameless Windows package, actual Chrome native SIDE_PANEL. Native save dialog destination is explicitly controlled." };
await writeFile(prefix + "-journey.json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" }); console.log(JSON.stringify({ status: report.status, checks: checks.length, stage, failure })); process.exitCode = passed ? 0 : 1;
