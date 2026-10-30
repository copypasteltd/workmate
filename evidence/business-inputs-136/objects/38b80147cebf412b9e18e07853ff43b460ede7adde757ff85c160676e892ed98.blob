import assert from "node:assert/strict";
import {chromium,_electron,type Browser,type Page,type ElectronApplication} from "playwright";
import {readFile,writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import path from "node:path";
import {WorkmateRecording,saveWorkmateScreenshot} from "./record-workmate-media.js";

const delivery=process.cwd(),platform=path.resolve("../copypaste-platform"),attempt=process.argv[2];
assert.match(attempt??"",/^\d{2}$/);
const prefix=path.join(delivery,`evidence/support-recovery-134/ui-${attempt}`),checks:string[]=[],errors:string[]=[],screenshots:any[]=[],recordings:any[]=[],layouts:any[]=[];
const load=(file:string)=>import(pathToFileURL(path.join(platform,file)).href);
const pass=(name:string)=>{checks.push(name);console.log("PASS: "+name);};
let system:any,isolated:any,browser:Browser|undefined,customerPage:Page|undefined,electron:ElectronApplication|undefined,native:Page|undefined,admin:Page|undefined,
  recording:WorkmateRecording|undefined,stage="setup",browserClosed=false,desktopClosed=false,apiClosed=false,fixtureClosed=false,modelCalls=-1;
const releases:(()=>void)[]=[];
async function awaited(promise:Promise<void>,name:string){let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(name)),30000);})]);}finally{clearTimeout(timer);}}
async function until(read:()=>Promise<any>,ok:(v:any)=>boolean,name:string,ms=30000){const end=Date.now()+ms;for(;;){const value=await read();if(ok(value))return value;assert.ok(Date.now()<end,name);await new Promise(r=>setTimeout(r,100));}}
async function shot(component:string,page:Page,name:string,caption:string){screenshots.push(await saveWorkmateScreenshot(component,`support-recovery-134-${attempt}`,name,await page.screenshot(),caption,delivery));}
async function stopRecording(){if(recording){const owned=recording;recording=undefined;recordings.push(await owned.stop());}}
try {
  const [{isolatedTestEnvironment},{buildApp},{loadConfig},fixtures]=await Promise.all([load("tests/native-test-environment.ts"),load("src/server.ts"),load("src/config.ts"),load("tests/support-access-fixture.ts")]);
  process.chdir(platform);isolated=await isolatedTestEnvironment();
  system=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEMO_MODE:"true",DEV_MAILBOX:"true",WORKER_ENABLED:"false",
    API_ORIGIN:"http://localhost:4310",WEB_ORIGIN:"http://localhost:4317",ADMIN_ORIGIN:"http://localhost:4318"}),{worker:false});
  let loseNativeGrant = false;
  const nativeLost:any[]=[];
  system.app.addHook("onSend",async(req:any,reply:any,payload:any)=>{
    if(loseNativeGrant&&req.method==="POST"&&req.url==="/v1/support-grants"&&reply.statusCode===201){
      loseNativeGrant=false;nativeLost.push({key:req.headers["idempotency-key"],body:req.body});
      reply.hijack();reply.raw.destroy();return reply;
    }
    return payload;
  });
  await system.app.listen({host:"127.0.0.1",port:4310});
  const f=await fixtures.supportFixture(system,false);
  await fixtures.historyOk(system,f.owner,"PATCH","/v1/me",{name:"Harbour marketing owner"});
  const first=await fixtures.supportTask(system,f,"Campaign A · original source"),second=await fixtures.supportTask(system,f,"Campaign B · original source"),
    privateTask=await fixtures.supportTask(system,f,"Private customer conversation",true);
  browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addInitScript(()=>{if(!localStorage.getItem("cp_locale"))localStorage.setItem("cp_locale","en");if(!localStorage.getItem("cp_theme"))localStorage.setItem("cp_theme","light");});
  admin=await context.newPage();admin.setDefaultTimeout(30000);admin.on("pageerror",e=>errors.push(e.message));
  stage="actual administrator authentication";
  await admin.goto("http://localhost:4318/login");await admin.locator('input[name="email"]').fill(f.operator.email);
  const [challenge]=await Promise.all([admin.waitForResponse(r=>new URL(r.url()).pathname==="/v1/admin/auth/challenge"),admin.locator('form button[type="submit"]').click()]);
  const mail=JSON.parse(await readFile(path.join(isolated.directory,"mailbox",(await challenge.json()).challenge_id+".json"),"utf8"));
  const OTP=createRequire(path.join(platform,"package.json"))("otpauth");
  await admin.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);
  await admin.locator('input[name="totp"]').fill(new OTP.TOTP({secret:f.operator.secret,digits:6,period:30,algorithm:"SHA1"}).generate());
  const [verified]=await Promise.all([admin.waitForResponse(r=>new URL(r.url()).pathname==="/v1/admin/auth/verify"),admin.locator('form button[type="submit"]').click()]);
  const adminCsrf=(await verified.json()).csrf_token;assert.ok(adminCsrf);await admin.locator(".admin-shell").waitFor();
  pass("Administrator completes actual email challenge and TOTP using an independent scoped identity");

  stage="packaged native customer sign-in";
  electron=await _electron.launch({executablePath:process.env.COPYPASTE_LOCAL_DESKTOP_CANDIDATE!,env:{...process.env,COPYPASTE_USER_DATA:path.join(process.env.COPYPASTE_SUPPORT_OWNED!,"desktop")}});
  native=await electron.firstWindow();native.setDefaultTimeout(30000);native.on("pageerror",e=>errors.push(e.message));
  await native.waitForURL(/^file:/);await native.waitForFunction(()=>!!(window as any).copyPasteBridge);
  await native.evaluate(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});await native.reload();
  await electron.evaluate(({shell})=>{shell.openExternal=async url=>{(globalThis as any).__supportAuth=url;};});
  await native.getByRole("button",{name:"Sign in securely in your browser",exact:true}).click();
  const customerContext=await browser.newContext();
  await customerContext.addInitScript(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});
  const customer=await customerContext.newPage();customerPage=customer;customer.setDefaultTimeout(30000);customer.on("pageerror",e=>errors.push(e.message));
  await system.db.control.query("UPDATE auth_challenges SET created_at=clock_timestamp()-interval '2 minutes' WHERE email=$1",[f.owner.email]);
  await customer.goto(await until(()=>electron!.evaluate(()=>(globalThis as any).__supportAuth),Boolean,"Native PKCE authorization link"));
  await customer.locator('input[name="email"]').fill(f.owner.email);
  const [userChallenge]=await Promise.all([customer.waitForResponse(r=>new URL(r.url()).pathname==="/v1/auth/challenges"),customer.locator('form button[type="submit"]').click()]);
  assert.equal(userChallenge.status(),202);
  const userMail=JSON.parse(await readFile(path.join(isolated.directory,"mailbox",(await userChallenge.json()).challenge_id+".json"),"utf8"));
  await customer.locator('input[name="code"]').fill(userMail.text.match(/\b\d{6}\b/)[0]);await customer.locator('form button[type="submit"]').click();
  await customer.getByRole("link",{name:/Authorize & return|授權並返回應用/}).click();
  const nativeCall=(url:string)=>native!.evaluate(async url=>(window as any).copyPasteBridge.request(url,{}),url);
  await until(()=>nativeCall("/v1/session/context"),v=>v.status===200,"Actual native OAuth callback");
  await native.locator(".app-shell").waitFor();
  await native.getByRole("link",{name:"Account settings",exact:true}).click();
  const grants=()=>native!.getByTestId("support-access");await grants().waitFor();
  pass("Unsigned packaged native Desktop completes real browser OTP and PKCE and opens its own customer support form");

  stage="native explicit customer grant";
  await grants().scrollIntoViewIfNeeded();
  recording=new WorkmateRecording("desktop","customer-grant",`support-recovery-134-${attempt}`,()=>native!.screenshot({type:"jpeg",quality:72}),"Actual packaged Desktop customer selects scope and creates a support grant",delivery);await recording.start();
  await grants().getByRole("checkbox",{name:"Approved campaign",exact:true}).check();
  await grants().getByLabel("Reason for assistance",{exact:true}).fill("Investigate our approved Hong Kong campaign");
  loseNativeGrant=true;
  await grants().getByRole("button",{name:"Create a time-limited grant",exact:true}).click();
  await grants().getByTestId("support-unconfirmed").waitFor();
  await grants().getByRole("button",{name:"Create a time-limited grant",exact:true}).waitFor();
  await until(()=>grants().getByRole("button",{name:"Create a time-limited grant",exact:true}).isEnabled(),Boolean,"Native failed response finishes");
  assert.equal(nativeLost.length,1);
  const nativePending=await native.evaluate(()=>JSON.stringify(Object.entries(sessionStorage)));
  assert.ok(nativePending.includes(nativeLost[0].key));assert.equal(nativePending.includes("Investigate our approved Hong Kong campaign"),false);
  await shot("desktop",native,"native-unconfirmed-en","Actual native grant commits but its HTTP response is lost; the original deadline is retained");
  await native.reload();await grants().waitFor();
  await until(()=>grants().getByTestId("support-unconfirmed").count(),v=>v===0,"Native reload recovers the actual committed receipt");
  assert.equal((await system.db.control.query("SELECT count(*) AS n FROM support_grants WHERE tenant_id=$1",[f.tenant])).rows[0].n,"1");
  pass("Native HTTP response loss and renderer reload recover the original customer grant without another authorization or deadline extension");
  await grants().locator(".support-grant-row").waitFor();
  const grant=(await grants().locator(".support-grant-row").first().getAttribute("data-grant-id"))!;assert.match(grant,/^[a-f0-9-]{36}$/);
  const stored=(await system.db.control.query("SELECT granted_by,tenant_id,project_ids,expires_at,created_at FROM support_grants WHERE id=$1",[grant])).rows[0];
  assert.equal(stored.granted_by,f.owner.id);assert.equal(stored.tenant_id,f.tenant);assert.deepEqual(stored.project_ids,[f.project]);
  assert.ok(stored.expires_at-stored.created_at<=15*60000);
  await shot("desktop",native,"native-grant-en","Actual frameless Desktop customer grants time-limited support for one project");await stopRecording();
  pass("Desktop creates a real customer-owned, explicitly scoped 15-minute grant without granting administrator permissions");

  stage="Web metadata-only customer grant";
  await customer.goto(`http://localhost:4317/app/settings?tenant=${f.tenant}&project=${f.project}`);
  const webGrants=customer.getByTestId("support-access");await webGrants.waitFor();
  await webGrants.getByLabel("Reason for assistance",{exact:true}).fill("Metadata only customer support check");
  await webGrants.getByRole("button",{name:"Create a time-limited grant",exact:true}).click();
  const webRow=webGrants.locator(".support-grant-row").filter({hasText:"Metadata only customer support check"});await webRow.waitFor();
  const webId=await webRow.getAttribute("data-grant-id"),webStored=(await system.db.control.query("SELECT project_ids FROM support_grants WHERE id=$1",[webId])).rows[0];
  assert.deepEqual(webStored.project_ids,[]);await webRow.getByRole("button",{name:"Revoke grant",exact:true}).click();
  await until(()=>webRow.textContent(),v=>v.includes("Revoked"),"Web grant is actually revoked");
  await shot("web",customer,"metadata-grant-en","Actual Web customer can create and revoke an explicit metadata-only grant");
  const webZoom=async()=>{
    await customer.evaluate(()=>{document.documentElement.style.zoom="2";});
    const layout=await webGrants.evaluate(node=>({component:"web",zoom:getComputedStyle(document.documentElement).zoom,width:innerWidth,document:document.documentElement.scrollWidth,content:node.scrollWidth,client:node.clientWidth}));
    layouts.push(layout);console.log("Web enlarged layout "+JSON.stringify(layout));assert.equal(Number(layout.zoom),2);assert.ok(layout.document<=layout.width+1&&layout.content<=layout.client+1,"Web support 200 percent layout");
    await customer.evaluate(()=>{document.documentElement.style.zoom="";});
  };
  const webLost:any[]=[];
  const otherWorkspace=await fixtures.historyOk(system,f.owner,"POST","/v1/tenants",{name:"Separate customer support workspace",project_name:"Separate project"});
  await customer.reload();await webGrants.waitFor();
  await webGrants.getByLabel("Reason for assistance",{exact:true}).fill("Recover this one explicit support authorization");
  await customer.route("**/v1/support-grants",async route=>{
    if(route.request().method()!=="POST")return route.continue();
    webLost.push({key:route.request().headers()["idempotency-key"],body:route.request().postDataJSON()});
    const response=await route.fetch();assert.equal(response.status(),201);await route.abort("failed");
  },{times:1});
  recording=new WorkmateRecording("web","grant-result-recovery",`support-recovery-134-${attempt}`,()=>customer.screenshot({type:"jpeg",quality:72}),"Actual committed customer grant loses its reply, survives reload and is isolated while switching workspaces",delivery);await recording.start();
  await webGrants.getByRole("button",{name:"Create a time-limited grant",exact:true}).click();
  await webGrants.getByTestId("support-unconfirmed").waitFor();
  await until(()=>webGrants.getByRole("button",{name:"Create a time-limited grant",exact:true}).isEnabled(),Boolean,"Web failed response settles");
  await shot("web",customer,"web-unconfirmed-en","An actual lost HTTP reply retains a safe recovery action and its original deadline");
  let releaseReceipt=()=>{},enteredReceipt=()=>{};const receiptGate=new Promise<void>(r=>releaseReceipt=r),receiptEntry=new Promise<void>(r=>enteredReceipt=r);releases.push(releaseReceipt);
  await customer.route(`**/support-grants/attempts/${webLost[0].key}`,async route=>{const response=await route.fetch();enteredReceipt();await receiptGate;await route.fulfill({response}).catch(()=>{});},{times:1});
  await customer.reload();await awaited(receiptEntry,"Actual committed receipt reached server");
  await customer.getByRole("combobox",{name:"Switch workspace",exact:true}).selectOption(otherWorkspace.tenant.id);
  await until(()=>webGrants.locator(".support-grant-row").count(),v=>v===0,"Separate workspace has no prior grants");
  releaseReceipt();await customer.waitForTimeout(250);
  assert.equal(await webGrants.getByText("Recovered the earlier request. Check the grant's current state below.",{exact:true}).count(),0);
  assert.equal(await webGrants.locator(".support-grant-row").count(),0);
  pass("A delayed customer receipt cannot repopulate grants or success notices after an actual in-app workspace switch");
  await customer.getByRole("combobox",{name:"Switch workspace",exact:true}).selectOption(f.tenant);
  const recoveredRow=webGrants.locator(".support-grant-row").filter({hasText:"Recover this one explicit support authorization"});await recoveredRow.waitFor();
  await until(()=>webGrants.getByTestId("support-unconfirmed").count(),v=>v===0,"Web reload and return recover the original receipt");
  const recoveredId=await recoveredRow.getAttribute("data-grant-id"),recoveredStored=(await system.db.control.query("SELECT expires_at FROM support_grants WHERE id=$1",[recoveredId])).rows[0];
  assert.equal(recoveredStored.expires_at.toISOString(),webLost[0].body.expires_at);
  assert.equal((await system.db.control.query("SELECT count(*) AS n FROM support_grants WHERE tenant_id=$1 AND reason=$2",[f.tenant,webLost[0].body.reason])).rows[0].n,"1");
  const clientStored=await customer.evaluate(()=>JSON.stringify([Object.entries(sessionStorage),Object.entries(localStorage)]));
  assert.equal(clientStored.includes(webLost[0].body.reason),false);await stopRecording();
  pass("Web response loss and reload retrieve the original committed authorization and exact deadline without persisting the consent reason");

  stage="uncommitted customer grant retries retain the original intent";
  const attempts:any[]=[];await customer.route("**/v1/support-grants",async route=>{
    if(route.request().method()!=="POST")return route.continue();
    attempts.push({key:route.request().headers()["idempotency-key"],body:route.request().postDataJSON()});
    if(attempts.length===1)return route.abort("failed");
    const response=await route.fetch();await route.fulfill({response});
  });
  recording=new WorkmateRecording("web","fixed-intent-retry",`support-recovery-134-${attempt}`,()=>customer.screenshot({type:"jpeg",quality:72}),"Keyboard submission retries the exact uncommitted customer consent; changing the intent is rejected until its result is resolved",delivery);await recording.start();
  const reason=webGrants.getByLabel("Reason for assistance",{exact:true});await reason.fill("The same keyboard-authorized support request");await reason.focus();await customer.keyboard.press("Tab");
  assert.equal(await webGrants.locator('select[name="minutes"]').evaluate(n=>n===document.activeElement),true);await customer.keyboard.press("ArrowDown");await customer.keyboard.press("Tab");await customer.keyboard.press("Enter");
  await webGrants.getByTestId("support-unconfirmed").waitFor();await until(()=>webGrants.getByRole("button",{name:"Create a time-limited grant",exact:true}).isEnabled(),Boolean,"Uncommitted request settles");
  await reason.fill("A different consent must not replace a pending intent");await webGrants.getByRole("button",{name:"Create a time-limited grant",exact:true}).click();
  await customer.waitForTimeout(300);
  const diagnostic={at:new Date().toISOString(),scope:"Synthetic fixture only; no cookies or credentials",attempts,
    section_text:await webGrants.textContent(),current_fields:await webGrants.locator("form").evaluate(form=>Object.fromEntries(new FormData(form as HTMLFormElement))),
    recovery_records:await customer.evaluate(()=>Object.fromEntries(Object.entries(sessionStorage).filter(([key])=>key.startsWith("cp_support_attempt_"))))};
  await writeFile(prefix+"-customer-diagnostic.json",JSON.stringify(diagnostic,null,2)+"\n",{flag:"wx"});
  await webGrants.getByRole("alert").filter({hasText:"The earlier request is unconfirmed. Check its result or retry the same reason, projects and duration."}).waitFor();assert.equal(attempts.length,1);
  await reason.fill("The same keyboard-authorized support request");await webGrants.getByRole("button",{name:"Create a time-limited grant",exact:true}).focus();await customer.keyboard.press("Enter");
  await webGrants.locator(".support-grant-row").filter({hasText:"The same keyboard-authorized support request"}).waitFor();assert.equal(attempts.length,2);assert.deepEqual(attempts[0],attempts[1]);await customer.unroute("**/v1/support-grants");await stopRecording();
  pass("A keyboard-submitted uncommitted request retries the identical key, reason, scope and deadline; a changed intent cannot create another grant");
  await webZoom();
  await customer.close();
  pass("Web creates and revokes an actual metadata-only grant; an empty project selection never means all projects");
  const before=await fixtures.supportCounts(system);
  const credentialCounts=async()=>(await system.db.control.query("SELECT (SELECT count(*) FROM sessions WHERE audience IN ('user','native')) AS sessions,(SELECT count(*) FROM refresh_tokens) AS refresh_tokens,(SELECT count(*) FROM native_auth_codes) AS native_codes")).rows[0];
  const credentialsBefore=await credentialCounts();

  stage="actual administrator support session form";
  await admin.goto("http://localhost:4318/support");await admin.getByLabel("Search customers",{exact:true}).fill("Harbour marketing owner");
  await admin.getByRole("button",{name:"Search",exact:true}).click();
  await admin.locator(".support-user-choice").filter({hasText:f.owner.id}).click();
  await admin.getByLabel("Target workspace",{exact:true}).selectOption(f.tenant);
  await admin.getByRole("checkbox",{name:f.project,exact:true}).check();
  await admin.locator('input[name="grant"]').fill(grant);await admin.locator('textarea[name="reason"]').fill("Investigate the customer approved campaign");
  const start=async()=>{const [response]=await Promise.all([admin!.waitForResponse(r=>new URL(r.url()).pathname==="/v1/admin/support/sessions"&&r.request().method()==="POST"),admin!.getByRole("button",{name:"Start read-only session",exact:true}).click()]);
    assert.equal(response.status(),202,await response.text());const id=(await response.json()).result_ids[0];await admin!.getByTestId("support-view").waitFor();return id as string;};
  const sessionA=await start();
  assert.ok((await admin.getByTestId("support-view").textContent())!.includes(f.operator.id));
  assert.ok((await admin.getByTestId("support-view").textContent())!.includes(f.owner.id));
  const taskRow=(id:string)=>admin!.locator(`.support-record[data-task-id="${id}"]`);
  const readTask=async(id:string)=>{await taskRow(id).getByRole("button",{name:/Read authorized content|讀取已授權正文/}).click();await until(()=>admin!.locator(".support-body").getAttribute("data-task-id").catch(()=>null),v=>v===id,"Current selected support body");};
  const privateRow=taskRow(privateTask.id);assert.ok((await privateRow.textContent())!.includes("title hidden"));assert.equal(await privateRow.getByRole("button").count(),0);
  await readTask(first.id);await shot("admin",admin,"scoped-support-en","Actual administrator identity, customer scope, deadline and independently authorized shared content");
  pass("Actual Admin form creates a scoped read-only session with a permanent identity banner and private-task body exclusion");

  stage="late task body response";
  let release=()=>{},entered=()=>{};const gate=new Promise<void>(r=>release=r),entry=new Promise<void>(r=>entered=r);releases.push(release);
  await admin.route(`**/view/tasks/${first.id}`,async route=>{const response=await route.fetch();entered();await gate;await route.fulfill({response}).catch(()=>{});},{times:1});
  recording=new WorkmateRecording("admin","task-selection",`support-recovery-134-${attempt}`,()=>admin!.screenshot({type:"jpeg",quality:72}),"Actual authorized HTTP replies are delayed while the administrator changes the selected task",delivery);await recording.start();
  await taskRow(first.id).getByRole("button",{name:"Read authorized content",exact:true}).click();await awaited(entry,"Delayed body did not reach actual HTTP handler");
  await readTask(second.id);release();await admin.waitForTimeout(350);
  assert.equal(await admin.locator(".support-body").getAttribute("data-task-id"),second.id);assert.ok(!(await admin.locator(".support-body").textContent())!.includes(first.name));await stopRecording();
  pass("A delayed real response for task A cannot overwrite task B after the administrator changes selection");

  stage="stalled prior session cannot block a new view";
  const sessionB=await start();
  const openSession=async(id:string)=>{await admin!.locator(".support-record").filter({has:admin!.getByText(id,{exact:true})}).getByRole("button",{name:/Open read-only view|只讀查看/}).click();};
  let releaseView=()=>{},enteredView=()=>{};const viewGate=new Promise<void>(r=>releaseView=r),viewEntry=new Promise<void>(r=>enteredView=r);releases.push(releaseView);
  await admin.route(`**/support/sessions/${sessionA}/view`,async route=>{const response=await route.fetch();enteredView();await viewGate;await route.fulfill({response}).catch(()=>{});},{times:1});
  await openSession(sessionA);await awaited(viewEntry,"Delayed view did not reach actual HTTP handler");await openSession(sessionB);
  await admin.getByTestId("support-view").waitFor({timeout:4000});releaseView();await admin.waitForTimeout(350);await readTask(first.id);
  pass("Switching sessions opens the newly selected real view while the previous view response is still held");

  stage="live body revision and original source withdrawal";
  const changed="Changed customer result · <img src=x onerror=window.supportUnsafe=1>";
  await system.db.control.query("UPDATE tasks SET output=$2 WHERE id=$1",[first.id,changed]);
  await admin.locator(".support-body").waitFor({state:"detached",timeout:7000});await readTask(first.id);
  assert.ok((await admin.locator(".support-body").textContent())!.includes(changed));assert.equal(await admin.locator(".support-body img").count(),0);
  assert.equal(await admin.evaluate(()=>(window as any).supportUnsafe),undefined);
  pass("Metadata revision polling clears an obsolete body before rereading, and actual HTML-like output remains inert text");
  await readTask(second.id);await system.db.control.query("UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",[second.asset_id]);
  await admin.locator(".support-body").waitFor({state:"detached",timeout:7000});await taskRow(second.id).getByText("Task source unavailable",{exact:true}).waitFor();
  assert.equal(await taskRow(second.id).getByRole("button").count(),0);
  await shot("admin",admin,"source-withdrawn-en","The real original file quarantine clears the opened body and removes its read action");
  pass("An actual original-file quarantine removes both the opened result and its diagnostic body action");

  stage="actual responsive and bilingual surfaces";
  for(const width of [375,768,1024,1440]){await admin.setViewportSize({width,height:1000});await admin.evaluate(()=>document.fonts.ready);
    const layout=await admin.getByTestId("admin-support").evaluate(node=>({component:"admin",width:innerWidth,document:document.documentElement.scrollWidth,content:node.scrollWidth,client:node.clientWidth}));
    assert.ok(layout.document<=width+1&&layout.content<=layout.client+1);layouts.push(layout);}
  await admin.evaluate(()=>{localStorage.setItem("cp_locale","zh-HK");localStorage.setItem("cp_theme","dark");});await admin.reload();await openSession(sessionB);await admin.getByTestId("support-view").waitFor();
  await shot("admin",admin,"support-zh-dark","Actual Traditional Chinese support view uses the current CopyPaste dark theme");
  await admin.evaluate(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});await admin.reload();await openSession(sessionB);await admin.getByTestId("support-view").waitFor();
  const win=await electron.browserWindow(native);
  for(const width of [1000,1240,1440]){await win.evaluate((win,width)=>win.setBounds({width,height:980}),width);await native.evaluate(()=>document.fonts.ready);
    const nativeFrame=await win.evaluate(win=>({bounds:win.getBounds(),content:win.getContentBounds(),menu_visible:win.isMenuBarVisible()}));
    const view=await native.evaluate(()=>({component:"desktop",width:innerWidth,horizontal:document.documentElement.scrollWidth>innerWidth,
      visible_scrollbars:[...document.querySelectorAll("body *")].filter(n=>n.getClientRects().length&&n.scrollHeight>n.clientHeight+1&&/auto|scroll/.test(getComputedStyle(n).overflowY)&&getComputedStyle(n).scrollbarWidth!=="none"&&getComputedStyle(n,"::-webkit-scrollbar").display!=="none").map(n=>String(n.className))}));
    assert.deepEqual(nativeFrame.bounds,nativeFrame.content);assert.equal(nativeFrame.menu_visible,false);assert.equal(view.horizontal,false);assert.deepEqual(view.visible_scrollbars,[]);layouts.push({...view,native:nativeFrame});}
  assert.equal(await electron.evaluate(({Menu})=>Menu.getApplicationMenu()===null),true);
  await grants().getByLabel("Reason for assistance",{exact:true}).focus();await native.keyboard.press("Tab");
  assert.equal(await grants().locator('select[name="minutes"]').evaluate(n=>n===document.activeElement),true);
  pass("Actual 375/768/1024/1440 Admin layouts, Chinese dark view, native widths and keyboard form controls pass without Desktop rails or menus");

  stage="support keyboard and 200 percent enlarged text";
  await admin.setViewportSize({width:1440,height:1000});await admin.evaluate(()=>{document.documentElement.style.zoom="2";});
  const enlarged=await admin.getByTestId("admin-support").evaluate(node=>({component:"admin",zoom:getComputedStyle(document.documentElement).zoom,width:innerWidth,document:document.documentElement.scrollWidth,content:node.scrollWidth,client:node.clientWidth}));
  layouts.push(enlarged);console.log("Admin enlarged layout "+JSON.stringify(enlarged));assert.equal(Number(enlarged.zoom),2);assert.ok(enlarged.document<=enlarged.width+1&&enlarged.content<=enlarged.client+1,"Admin support 200 percent layout");
  const closeView=admin.getByRole("button",{name:"Close support view",exact:true});await closeView.focus();await admin.keyboard.press("Enter");await admin.getByTestId("support-view").waitFor({state:"detached"});
  const reopen=admin.locator(".support-record").filter({has:admin.getByText(sessionB,{exact:true})}).getByRole("button",{name:"Open read-only view",exact:true});await reopen.focus();await admin.keyboard.press("Enter");await admin.getByTestId("support-view").waitFor();
  assert.ok((await admin.getByTestId("support-view").textContent())!.includes(f.operator.id));
  await shot("admin",admin,"support-en-200","Actual 200 percent CSS text enlargement preserves the real identity banner and keyboard support controls");
  await admin.evaluate(()=>{document.documentElement.style.zoom="";});
  await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));
  await grants().getByLabel("Reason for assistance",{exact:true}).focus();await native.keyboard.press("Tab");
  assert.equal(await grants().locator('select[name="minutes"]').evaluate(n=>n===document.activeElement),true);
  const nativeZoom=await native.evaluate(()=>({component:"desktop",width:innerWidth,horizontal:document.documentElement.scrollWidth>innerWidth,
    visible_scrollbars:[...document.querySelectorAll("body *")].filter(n=>n.getClientRects().length&&n.scrollHeight>n.clientHeight+1&&/auto|scroll/.test(getComputedStyle(n).overflowY)&&getComputedStyle(n).scrollbarWidth!=="none"&&getComputedStyle(n,"::-webkit-scrollbar").display!=="none").map(n=>String(n.className))}));
  assert.equal(await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()),2);assert.equal(nativeZoom.horizontal,false);assert.deepEqual(nativeZoom.visible_scrollbars,[]);layouts.push({...nativeZoom,zoom:2});
  await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
  pass("Support pages retain working keyboard controls and no horizontal overflow at 200 percent text enlargement; native Desktop uses actual webContents zoom without visible rails");

  stage="actual short support deadline";
  const shortResponse=await context.request.post("http://localhost:4310/v1/admin/support/sessions",{headers:{Origin:"http://localhost:4318","X-CSRF-Token":adminCsrf,"Idempotency-Key":randomUUID()},
    data:{user_id:f.owner.id,tenant_id:f.tenant,project_ids:[f.project],support_grant_id:grant,mode:"read_only",expires_at:new Date(Date.now()+8000).toISOString(),reason:"Observe the actual server deadline"}});
  assert.equal(shortResponse.status(),202,await shortResponse.text());const short=(await shortResponse.json()).result_ids[0];
  await admin.getByRole("button",{name:"Refresh support sessions",exact:true}).click();await openSession(short);await admin.getByTestId("support-view").waitFor();await readTask(first.id);
  await admin.getByTestId("support-view").waitFor({state:"detached",timeout:12000});assert.equal(await admin.locator(".support-body").count(),0);
  pass("Actual server-clock expiry clears an opened authorized body without a worker or simulated clock");

  stage="native customer revocation clears administrator content";
  await openSession(sessionB);await admin.getByTestId("support-view").waitFor();await readTask(first.id);
  await grants().scrollIntoViewIfNeeded();const nativeRow=grants().locator(`[data-grant-id="${grant}"]`);
  recording=new WorkmateRecording("desktop","customer-revocation",`support-recovery-134-${attempt}`,()=>native!.screenshot({type:"jpeg",quality:72}),"The actual packaged Desktop customer revokes the grant while the administrator has its body open",delivery);await recording.start();
  await nativeRow.getByRole("button",{name:"Revoke grant",exact:true}).click();
  await until(()=>nativeRow.textContent(),v=>v.includes("Revoked"),"Native customer revocation");
  await admin.getByTestId("support-view").waitFor({state:"detached",timeout:7000});assert.equal(await admin.locator(".support-body").count(),0);
  await shot("desktop",native,"native-revoked-en","Actual Desktop customer revocation is acknowledged and the independent support view stops reading");await stopRecording();
  pass("Native customer revocation is durable and clears the separately authenticated administrator view");
  const persisted=await admin.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]));
  for(const text of ["Protected prompt","Protected result",changed])assert.equal(persisted.includes(text),false);
  assert.deepEqual(await credentialCounts(),credentialsBefore);
  assert.deepEqual(await fixtures.supportCounts(system),before);modelCalls=Number(before.requests);assert.equal(modelCalls,0);
  pass("Support reads and customer authorization create no extra tasks, holds, charges, provider calls or customer credentials; bodies stay out of browser storage");
  assert.equal(checks.length,18);assert.equal(errors.length,0);
} catch(e){errors.push(stage+": "+String(e));console.error(stage+": "+String(e));
  if(customerPage&&!customerPage.isClosed())try{await shot("web",customerPage,"failed-customer-state","Unedited actual customer support journey failure");}catch{}
  if(native)try{await shot("desktop",native,"failed-native-state","Unedited actual native support journey failure");}catch{}
  if(admin)try{await shot("admin",admin,"failed-state","Unedited actual failed support journey state");}catch{}
} finally {
  for(const release of releases)release();
  try{await stopRecording();}catch(e){errors.push("Recording: "+String(e));}
  if(electron)try{const child=electron.process(),exit=child.exitCode===null?new Promise<void>(r=>child.once("exit",()=>r())):Promise.resolve();
    if(native&&!native.isClosed())await native.locator('[data-window-action="close"]').click().catch(e=>{if(!String(e).includes("closed"))throw e;});
    else await electron.close();await exit;desktopClosed=true;
  }catch(e){errors.push("Desktop close: "+String(e));}
  if(browser)try{await browser.close();browserClosed=true;}catch(e){errors.push("Browser close: "+String(e));}
  if(system)try{await system.app.close();apiClosed=true;}catch(e){errors.push("API close: "+String(e));}
  if(isolated)try{await isolated.cleanup();fixtureClosed=true;}catch(e){errors.push("Fixture close: "+String(e));}
  process.chdir(delivery);
  const passed=errors.length===0&&checks.length===18&&browserClosed&&desktopClosed&&apiClosed&&fixtureClosed;
  await writeFile(prefix+"-journey.json",JSON.stringify({at:new Date().toISOString(),status:passed?"passed":"failed",stage,checks,errors,screenshots,recordings,layouts,model_calls:modelCalls,
    browser_closed:browserClosed,desktop_closed:desktopClosed,api_closed:apiClosed,fixture_closed:fixtureClosed,
    limits:["Actual native PostgreSQL, customer OTP/PKCE, administrator email/TOTP and unsigned Windows package. Business data, retained result bodies and recorded file reads are explicit synthetic fixtures; models do not execute.",
      "Actual HTTP responses are lost or delayed to exercise recovery and scope changes. Web/Admin enlarged text uses CSS zoom; Desktop uses native webContents zoom. This is not full platform accessibility, a screen-reader or production/signing acceptance. Original TC-095 is assessed separately against these and current backend evidence."]},null,2)+"\n",{flag:"wx"});
  console.log(JSON.stringify({status:passed?"passed":"failed",checks:checks.length,errors}));process.exitCode=passed?0:1;
}
