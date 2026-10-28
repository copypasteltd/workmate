import assert from "node:assert/strict";
import { _electron, chromium, type ElectronApplication, type Browser, type Page } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";
const delivery=process.cwd(),platform=path.resolve("../copypaste-platform"),attempt=process.argv[2]; assert.match(attempt??"",/^\d{2}$/);
const prefix=path.join(delivery,"evidence/external-budget-ui-"+attempt),owned=path.resolve(".data/external-budget-ui",randomUUID());
const checks:string[]=[],errors:string[]=[],screenshots:any[]=[],recordings:any[]=[],exports:any[]=[],layouts:any[]=[];
let isolated:any,system:any,electron:ElectronApplication|undefined,browser:Browser|undefined,recording:WorkmateRecording|undefined;
let diagnosticPage:Page|undefined;
let electronClosed=false,browserClosed=false,apiClosed=false,fixtureClosed=false,modelCalls=0;
const sha=(b:Buffer|string)=>createHash("sha256").update(b).digest("hex");
const pass=(name:string)=>{checks.push(name);console.log("PASS: "+name);};
async function until(read:()=>Promise<any>,accept:(v:any)=>boolean,label:string,ms=60000):Promise<any>{const end=Date.now()+ms;while(Date.now()<end){const v=await read();if(accept(v))return v;await new Promise(r=>setTimeout(r,250));}throw new Error("Timed out: "+label);}
const load=(f:string)=>import(pathToFileURL(path.join(platform,f)).href);
await mkdir(owned,{recursive:true});
try {
 const [{isolatedTestEnvironment},{buildApp},{loadConfig},{advanceConnectors},{advanceExternalBudgets}]=await Promise.all([load("tests/native-test-environment.ts"),load("src/server.ts"),load("src/config.ts"),load("src/connectors.ts"),load("src/external-budget.ts")]);
 process.chdir(platform);isolated=await isolatedTestEnvironment();
 system=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEV_MAILBOX:"true",WORKER_ENABLED:"false",DEMO_MODE:"true"}),{worker:false});
 system.app.addHook("onRequest",async(req:any)=>{if(req.url.includes("/v1/responses"))modelCalls++;});
 await system.app.listen({host:"127.0.0.1",port:4310});
 electron=await _electron.launch({executablePath:process.env.COPYPASTE_LOCAL_DESKTOP_CANDIDATE!,env:{...process.env,COPYPASTE_USER_DATA:path.join(owned,"user-data")}});
 const desktop=await electron.firstWindow();desktop.setDefaultTimeout(25000);desktop.on("pageerror",e=>errors.push(e.message));
 await desktop.waitForURL(/^file:/);await desktop.waitForFunction(()=>!!(window as any).copyPasteBridge);
 await desktop.evaluate(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});await desktop.reload();
 await electron.evaluate(({shell,dialog},folder)=>{
  const state=globalThis as any;state.__externalURLs=[];state.__downloadPaths=[];
  shell.openExternal=async(url:string)=>{state.__authURL=url;state.__externalURLs.push(url);};
  dialog.showSaveDialog=async(options:any)=>{const filePath=folder+"/"+(state.__downloadPrefix??"native-")+options.defaultPath;state.__downloadPaths.push(filePath);return {canceled:false,filePath};};
 },owned);
 browser=await chromium.launch({executablePath:process.env.CHROME_BIN!,headless:true});const context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000}});
 await context.addInitScript(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});
 await desktop.getByRole("button",{name:"Sign in securely in your browser"}).click();
 const authURL=await until(()=>electron!.evaluate(()=>(globalThis as any).__authURL??""),Boolean,"native authorization URL");
 const web=await context.newPage();diagnosticPage=web;web.setDefaultTimeout(25000);web.on("pageerror",e=>errors.push(e.message));await web.goto(authURL);
 await web.locator('input[name="email"]').fill("budget-"+randomUUID()+"@example.invalid");
 const [challenge]=await Promise.all([web.waitForResponse(r=>new URL(r.url()).pathname==="/v1/auth/challenges"),web.locator('form button[type="submit"]').click()]);
 const mail=JSON.parse(await readFile(path.join(isolated.directory,"mailbox",(await challenge.json()).challenge_id+".json"),"utf8"));
 await web.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);await web.locator('form button[type="submit"]').click();
 await web.getByRole("link",{name:/Authorize & return|授權並返回應用/}).click();
 await until(()=>desktop.evaluate(async()=>(await (window as any).copyPasteBridge.request("/v1/session/context",{})).status),v=>v===200,"native PKCE return");
 await desktop.locator('input[name="name"]').fill("Harbour marketing studio");await desktop.locator('input[name="project_name"]').fill("Controlled ad budgets");
 await desktop.getByRole("button",{name:"Create workspace & continue",exact:true}).click();
 const current=await until(()=>desktop.evaluate(async()=>(await (window as any).copyPasteBridge.request("/v1/session/context",{})).body),v=>v.memberships?.length===1,"actual onboarding");
 const tenant=current.memberships[0].id;
 const request=async(url:string,method="GET",body?:any)=>desktop.evaluate(async a=>{const r=await (window as any).copyPasteBridge.request(a.url,{method:a.method,tenantId:a.tenant,idempotencyKey:crypto.randomUUID(),...(a.body===undefined?{}:{body:a.body})});if(r.status<200||r.status>=300)throw new Error(JSON.stringify(r));return r.body;},{url,method,body,tenant});
 const project=(await request("/v1/tenants/"+tenant+"/projects")).items[0].id,base="/v1/tenants/"+tenant+"/projects/"+project;
 pass("Actual email login, browser consent, native PKCE return and customer onboarding");
 async function drain(connection:string){return until(async()=>{await advanceConnectors(system.db,system.storage);return request("/v1/connections/"+connection+"/detail");},d=>!d.jobs.some((j:any)=>["queued","running"].includes(j.status)),"captured connector jobs");}
 async function shot(client:string,name:string,page:Page,description:string){const target=page.locator(".budget-operation-detail").last();if(await target.count())await target.evaluate(e=>e.scrollIntoView({block:"start"}));await page.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));});screenshots.push(await saveWorkmateScreenshot(client,"budget-"+attempt,name,await page.screenshot({caret:"hide"}),description,delivery));}
 async function layout(page:Page,label:string){
  const result=await page.evaluate(()=>({width:innerWidth,height:innerHeight,amounts:Array.from(document.querySelectorAll<HTMLElement>(".budget-amount-change strong")).map(e=>{const r=document.createRange();r.selectNodeContents(e);return {text:e.textContent,available:e.clientWidth,rects:Array.from(r.getClientRects()).map(x=>({width:x.width,height:x.height,top:x.top,left:x.left,right:x.right}))};}),overflow:document.documentElement.scrollWidth>innerWidth||document.body.scrollWidth>innerWidth||Array.from(document.querySelectorAll(".modal,.budget-control,.budget-section")).some(e=>e.scrollWidth>e.clientWidth+2)}));
  assert.ok(result.amounts.length>=2);assert.equal(result.overflow,false,label);for(const a of result.amounts){assert.ok(a.rects.length>0);assert.ok(a.rects.every(r=>Math.abs(r.top-a.rects[0].top)<1),"A monetary value wraps across visual lines");assert.ok(Math.max(...a.rects.map(r=>r.right))-Math.min(...a.rects.map(r=>r.left))<=a.available+2);}
  layouts.push({label,...result});
 }
 const mutations=()=>system.connectorFixture.calls.filter((c:any)=>c.path.endsWith("/campaignBudgets:mutate")).length;
 await web.goto(new URL("/app/connections",authURL).href);
 const google=web.locator(".connection-card").filter({has:web.getByText("Google Ads",{exact:true})});
 await google.getByRole("button",{name:"Connect account"}).click();await web.getByRole("button",{name:/Allow simulated read/}).click();
 await web.waitForURL(u=>u.port==="4317"&&u.searchParams.has("connected"));const connection=new URL(web.url()).searchParams.get("connected")!;
 await drain(connection);await web.locator(".connector-account").filter({hasText:"101"}).locator("input").check();
 await web.getByRole("button",{name:"Confirm accounts & projects",exact:true}).click();
 await until(()=>request("/v1/connections/"+connection+"/detail"),d=>d.connection.account_ids.length===1,"bound advertiser");
 const budgetRoot=base+"/external-budget";
 pass("Actual synthetic Google Ads consent and explicit advertiser/project binding");
 async function openBudget(page:Page){
  if(page===desktop){const dialog=page.getByRole("dialog");if(await dialog.count())await dialog.getByRole("button",{name:/Close|關閉/,exact:true}).click();await page.evaluate(()=>location.hash="/app/connections");await page.locator(".connector-directory-item").filter({hasText:connection.slice(0,8)}).click();}
  else await page.goto(new URL("/app/connections?connected="+connection,authURL).href);
  await page.getByRole("button",{name:/Manage budgets & operations|管理預算與操作/,exact:true}).click();return page.locator(".budget-control");
 }
 let panel=await openBudget(web);
 recording=new WorkmateRecording("web","controlled-budgets",attempt,()=>web.screenshot({type:"jpeg",quality:80}),"Actual Web scoped budget policy, exact preview, customer confirmation, synthetic account",delivery);await recording.start();
 await panel.getByRole("button",{name:"Configure policy",exact:true}).click();
 await panel.getByRole("checkbox",{name:"Enable budget changes for this account and project",exact:true}).check();
 await panel.getByLabel("Allowed budget IDs (comma separated)",{exact:true}).fill("700, 701, 702");
 const [saved]=await Promise.all([web.waitForResponse(r=>r.request().method()==="PUT"&&new URL(r.url()).pathname.includes("/external-budget/policy/")),panel.getByRole("button",{name:"Save exact policy version",exact:true}).click()]);assert.equal(saved.status(),200);
 await panel.getByRole("button",{name:"Read current value & preview",exact:true}).waitFor();
 assert.equal(mutations(),0);pass("Actual policy form enables a bounded, expiring whitelist with per-operation customer confirmation");
 async function propose(page:Page,panel:any,budget:string,amount:string){
  await panel.getByLabel(/Exact budget ID|指定預算 ID/,{exact:true}).fill(budget);await panel.getByLabel(/New average daily budget|新的平均每日預算/).fill(amount);
  await panel.getByRole("button",{name:/Read current value & preview|讀取現值並預覽/,exact:true}).click();await panel.locator(".budget-preview").waitFor();
  const create=page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname===budgetRoot+"/operations");
  await panel.getByRole("button",{name:/Submit exact change for confirmation|提交確切修改，等待確認/,exact:true}).click();
  const response=await create;assert.equal(response.status(),202);const op=await response.json();assert.equal(op.state,"awaiting_confirmation");
  await panel.locator(".budget-operation-detail").getByRole("button",{name:/Confirm this exact change|確認這筆確切修改/,exact:true}).waitFor();return op;
 }
 await panel.getByLabel("Exact budget ID",{exact:true}).fill("700");await panel.getByLabel("New average daily budget (HKD)",{exact:true}).fill("125");await panel.getByRole("button",{name:"Read current value & preview",exact:true}).click();await panel.locator(".budget-preview").waitFor();
 await panel.getByLabel("New average daily budget (HKD)",{exact:true}).fill("126");assert.equal(await panel.locator(".budget-preview").count(),0);
 pass("Editing the intended amount withdraws the frozen preview and requires a new exact source read");
 const operation=await propose(web,panel,"700","125");assert.equal(mutations(),0);
 await layout(web,"Web desktop exact monetary preview");await shot("web","exact-confirmation-en",web,"Actual exact HKD 100 to 125 proposal awaits customer confirmation; no mutation sent");
 await panel.getByRole("button",{name:"Confirm this exact change",exact:true}).click();
 await until(()=>request(budgetRoot+"/operations/"+operation.id),d=>d.operation.state==="queued","exact confirmed operation");
 await advanceExternalBudgets(system.db);await until(()=>request(budgetRoot+"/operations/"+operation.id),d=>d.operation.state==="succeeded","verified mutable provider receipt");
 await panel.getByText("Immutable receipts",{exact:true}).waitFor();assert.equal(mutations(),1);
 await shot("web","verified-receipt-en",web,"Actual customer confirmation produces one synthetic mutation and an immutable verified receipt");
 pass("Web exact preview, human confirmation and verified receipt produce one physical simulated mutation");
 const unknown=await propose(web,panel,"701","125");system.connectorFixture.setBudgetFaults(["apply_then_disconnect"]);
 await panel.getByRole("button",{name:"Confirm this exact change",exact:true}).click();await until(()=>request(budgetRoot+"/operations/"+unknown.id),d=>d.operation.state==="queued","second confirmed operation");
 await advanceExternalBudgets(system.db);await panel.getByRole("button",{name:"Observe current remote value",exact:true}).waitFor();
 for(let i=0;i<3;i++)await advanceExternalBudgets(system.db);assert.equal(mutations(),2);
 await panel.getByRole("button",{name:"Observe current remote value",exact:true}).click();await panel.getByLabel("Reason for manual closure",{exact:true}).fill("Reviewed synthetic remote value; original mutation attribution remains unknown.");
 await panel.getByRole("checkbox",{name:"I have reviewed this and accept unknown attribution. This operation will not be resent.",exact:true}).check();
 await shot("web","unknown-observation-en",web,"An applied request with a disconnected response remains unknown; matching current value is not treated as attribution");
 await panel.getByRole("button",{name:"Record review & close unknown operation",exact:true}).click();
 await until(()=>request(budgetRoot+"/operations/"+unknown.id),d=>d.operation.state==="closed_unknown","manual unknown closure");assert.equal(mutations(),2);
 recordings.push(await recording.stop());recording=undefined;
 pass("Actual Web observation and explicit manual closure retain unknown attribution without resending");
 panel=await openBudget(desktop);
 recording=new WorkmateRecording("desktop","controlled-budgets",attempt,async()=>Buffer.from(await electron!.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64")),"base64"),"Actual unsigned native Desktop budget preview and receipt through authenticated company bridge; synthetic advertiser",delivery);await recording.start();
 // Native guarded requests do not emit a browser Playwright response event.
 await panel.getByLabel("Exact budget ID",{exact:true}).fill("700");await panel.getByLabel("New average daily budget (HKD)",{exact:true}).fill("140");
 await panel.getByRole("button",{name:"Read current value & preview",exact:true}).click();await panel.locator(".budget-preview").waitFor();
 await panel.getByRole("button",{name:"Submit exact change for confirmation",exact:true}).click();await panel.getByRole("button",{name:"Confirm this exact change",exact:true}).waitFor();
 const nativeOperation=(await request(budgetRoot+"/operations?state=awaiting_confirmation")).items[0];assert.equal(nativeOperation.specification.desired_average_daily_micros,"140000000");
 await panel.getByRole("button",{name:"Confirm this exact change",exact:true}).click();await until(()=>request(budgetRoot+"/operations/"+nativeOperation.id),d=>d.operation.state==="queued","native confirmation");
 await advanceExternalBudgets(system.db);await panel.getByText("Immutable receipts",{exact:true}).waitFor();assert.equal(mutations(),3);
 await shot("desktop","receipt-en",desktop,"Actual packaged native Desktop confirms exact HKD 125 to 140 and renders the immutable provider receipt");
 pass("Packaged native Desktop uses current authenticated authorization for exact preview, confirmation and receipt");
 await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(800,600));
 await desktop.evaluate(()=>{localStorage.setItem("cp_locale","zh-HK");localStorage.setItem("cp_theme","dark");});await desktop.reload();panel=await openBudget(desktop);
 await panel.locator(".budget-history-row").filter({hasText:nativeOperation.id.slice(0,8)}).click();await panel.getByText("不可變回執",{exact:true}).waitFor();
 await layout(desktop,"800x600 Chinese dark native budget detail");const nativeLayout=await desktop.evaluate(()=>Array.from(document.querySelectorAll("#root,.sidebar,.modal")).every(e=>getComputedStyle(e).scrollbarWidth==="none"));assert.equal(nativeLayout,true);
 const appearance=await electron.evaluate(({BrowserWindow,Menu})=>({menu:Menu.getApplicationMenu()===null,menuBar:BrowserWindow.getAllWindows()[0].isMenuBarVisible()}));assert.equal(appearance.menu,true);assert.equal(appearance.menuBar,false);
 await panel.locator(".budget-operation-detail").scrollIntoViewIfNeeded();await shot("desktop","compact-zh-dark",desktop,"Actual 800x600 frameless Chinese dark Desktop: complete monetary values, hidden rails, no horizontal overflow or Electron menus");
 recordings.push(await recording.stop());recording=undefined;
 pass("Compact Chinese dark native layout preserves complete amounts, hidden scrollbars and absent native menus");
 const OTPAuth=createRequire(path.join(platform,"package.json"))("otpauth"),{seal}=await load("src/lib.ts"),secret=new OTPAuth.Secret({size:20}),email="budget-admin-"+randomUUID()+"@example.invalid";
 const adminId=(await system.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Owned scoped budget operator',$2) RETURNING id",[email,seal(system.db.config.MASTER_KEY,secret.base32)])).rows[0].id;
 const role="budget_ui_"+randomUUID().replaceAll("-","");await system.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Budget UI operator',$2)",[role,JSON.stringify(["admin.external_budget.read","admin.external_budget.policy.write","admin.external_budget.resolve"])]);
 await system.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'project',$3)",[adminId,role,project]);
 const adminContext=await browser.newContext({viewport:{width:1440,height:1000}});await adminContext.addInitScript(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});const admin=await adminContext.newPage();diagnosticPage=admin;admin.setDefaultTimeout(25000);admin.on("pageerror",e=>errors.push(e.message));
 await admin.goto("http://localhost:4318");await admin.locator('input[name="email"]').fill(email);
 const [challengeAdmin]=await Promise.all([admin.waitForResponse(r=>new URL(r.url()).pathname==="/v1/admin/auth/challenge"),admin.locator('form button[type="submit"]').click()]);assert.equal(challengeAdmin.status(),200);
 const mailAdmin=JSON.parse(await readFile(path.join(isolated.directory,"mailbox",(await challengeAdmin.json()).challenge_id+".json"),"utf8"));await admin.locator('input[name="code"]').fill(mailAdmin.text.match(/\b\d{6}\b/)[0]);await admin.locator('input[name="totp"]').fill(new OTPAuth.TOTP({secret}).generate());
 const [adminVerified]=await Promise.all([admin.waitForResponse(r=>new URL(r.url()).pathname==="/v1/admin/auth/verify"),admin.locator('form button[type="submit"]').click()]);assert.equal(adminVerified.status(),200);
 await admin.goto("http://localhost:4318/external-budget");await admin.getByRole("heading",{name:"Advertising budget control",exact:true}).waitFor();await admin.locator(".budget-history-row").filter({hasText:nativeOperation.id.slice(0,8)}).click();
 await admin.getByText("Immutable receipts",{exact:true}).waitFor();assert.equal(await admin.getByRole("button",{name:"Confirm this exact change",exact:true}).count(),0);
 recording=new WorkmateRecording("admin","controlled-budgets",attempt,()=>admin.screenshot({type:"jpeg",quality:80}),"Actual scoped Admin email/TOTP session, immutable budget evidence and current MFA enforcement",delivery);await recording.start();
 await layout(admin,"Admin scoped immutable receipt");await shot("admin","scoped-receipt-en",admin,"Actual project-scoped Admin OTP/TOTP session reads immutable receipts without customer confirmation controls");
 pass("Actual project-scoped Admin OTP/TOTP login opens exact receipt evidence without customer impersonation");
 await admin.getByRole("dialog").getByRole("button",{name:"Close",exact:true}).click();await admin.getByRole("button",{name:"Configure project budget policy",exact:true}).click();const dialog=admin.getByRole("dialog");
 await dialog.getByLabel("Workspace ID",{exact:true}).fill(tenant);await dialog.getByLabel("Project ID",{exact:true}).fill(project);await dialog.getByLabel("Google Ads connection ID",{exact:true}).fill(connection);await dialog.getByLabel("Bound advertiser account ID",{exact:true}).fill("101");
 await dialog.getByRole("button",{name:"Review scope & current policy",exact:true}).click();await dialog.getByRole("button",{name:"Configure policy",exact:true}).click();await dialog.getByLabel("Maximum change per operation (HKD)",{exact:true}).fill("40");
 const [policyUpdate]=await Promise.all([admin.waitForResponse(r=>r.request().method()==="PUT"&&new URL(r.url()).pathname.includes("/external-budget/policy/")),dialog.getByRole("button",{name:"Save exact policy version",exact:true}).click()]);assert.equal(policyUpdate.status(),200);
 assert.equal((await request(budgetRoot+"/policy?connection_id="+connection+"&account_id=101")).policy.version,2);
 pass("Admin exact scope form appends a policy version under separate policy-write permission");
 await system.db.control.query("UPDATE sessions SET mfa_at=clock_timestamp()-interval '11 minutes' WHERE admin_id=$1",[adminId]);
 await until(()=>admin.locator(".budget-facts").count(),n=>n===0,"open private admin policy withdraws after recent MFA expires",25000);await admin.getByRole("alert").first().waitFor();
 recordings.push(await recording.stop());recording=undefined;
 pass("Current MFA expiry removes already-open private budget policy and receipt content");
 assert.equal(modelCalls,0);assert.equal(mutations(),3);assert.equal((await system.db.control.query("SELECT count(*)::int n FROM tasks")).rows[0].n,0);
 pass("Manual budget journeys make exactly three simulated writes and no model, task or AI-ledger charge");
} catch(e){errors.push(String(e));console.error(e);
 if(diagnosticPage)try{await writeFile(prefix+"-failure-body.txt",await diagnosticPage.locator("body").innerText(),{flag:"wx"});await writeFile(prefix+"-failure.png",await diagnosticPage.screenshot(),{flag:"wx"});}catch{}
}
finally {
 if(recording)try{recordings.push(await recording.stop());}catch(e){errors.push(String(e));}
 if(electron)await electron.close().then(()=>{electronClosed=true;}).catch(e=>errors.push(String(e)));
 if(browser)await browser.close().then(()=>{browserClosed=true;}).catch(e=>errors.push(String(e)));
 if(system)await system.app.close().then(()=>{apiClosed=true;}).catch((e:any)=>errors.push(String(e)));
 if(isolated)await isolated.cleanup().then(()=>{fixtureClosed=true;}).catch((e:any)=>errors.push(String(e)));
 const report={at:new Date().toISOString(),status:errors.length?"failed":"passed",checks,errors,screenshots,recordings,layouts,model_calls:modelCalls,electron_closed:electronClosed,browser_closed:browserClosed,api_closed:apiClosed,fixture_closed:fixtureClosed,not_validated:["live_company_model","real_provider_accounts","real_payment","signed_production_installer","entire_product_acceptance"]};
 await writeFile(prefix+"-journey.json",JSON.stringify(report,null,2)+"\n",{flag:"wx"});assert.equal(errors.length,0,errors.join("\n"));
}
