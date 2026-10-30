import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { chromium, type Browser, type Page } from "playwright";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";

const delivery=process.cwd(),platform=path.resolve("../copypaste-platform-recovery-120"),attempt=process.argv[2];assert.match(attempt??"",/^\d{2}$/);
const fromPlatform=createRequire(path.join(platform,"package.json")),OTPAuth=fromPlatform("otpauth"),{PNG}=fromPlatform("pngjs");
const ports=JSON.parse(process.env.COPYPASTE_CLOUD_UI_PORTS!),apiBase=`http://localhost:${ports.api}`,webBase=`http://localhost:${ports.web}`,adminBase=`http://localhost:${ports.admin}`;
const prefix=path.resolve(".data/dedicated-cloud-121/ui-"+attempt),checks:string[]=[],errors:string[]=[],screenshots:any[]=[],recordings:any[]=[],layouts:any[]=[];
const load=(file:string)=>import(pathToFileURL(path.join(platform,file)).href),hash=(value:any)=>createHash("sha256").update(value).digest("hex");
let browser:Browser|undefined,system:any,isolated:any,recording:WorkmateRecording|undefined,browserClosed=false,apiClosed=false,fixtureClosed=false;
let pollLoop:Promise<void>|undefined,finishNode=false,node:any,current:any=null,sequence=0,postCommitSession:string|undefined,confirmationKey:string|undefined;
const instance=randomUUID(),fingerprint=hash("Synthetic dedicated-cloud browser protocol "+attempt),nodeReceipts:any[]=[];
async function until<T>(read:()=>Promise<T>,accept:(value:T)=>boolean,label:string,timeout=40000){const end=Date.now()+timeout;while(Date.now()<end){const value=await read();if(accept(value))return value;await new Promise(r=>setTimeout(r,150));}throw new Error("Timed out: "+label);}
const pass=(message:string)=>{checks.push(message);console.log("PASS: "+message);};
async function capture(component:string,page:Page,name:string){screenshots.push(await saveWorkmateScreenshot(component,"dedicated-cloud-"+attempt,name,await page.screenshot(),"Actual authenticated UI with synthetic accounts, node protocol and frames; no remote execution claim",delivery));}
async function layout(component:string,page:Page,name:string){
  const value:any=await page.evaluate(String.raw`(() => {
    const luminance=(rgb)=>rgb.map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[0.2126,0.7152,0.0722][i],0);
    const color=(v)=>{const m=v.match(/^rgba?\(([^)]+)\)$/);if(!m)throw new Error("Unsupported resolved color "+v);return m[1].split(/[, /]+/).map(Number);};
    const buttons=[...document.querySelectorAll('.page-heading .button:not(:disabled)')].map(button=>{
      const foreground=getComputedStyle(button).color;let background="",element=button;
      while(element){background=getComputedStyle(element).backgroundColor;const channels=color(background);if(channels.length===3||channels[3]===1)break;element=element.parentElement;}
      const a=luminance(color(foreground).slice(0,3)),b=luminance(color(background).slice(0,3));
      return {label:button.textContent,color:foreground,background,contrast:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)};
    });
    return {width:innerWidth,scroll:document.documentElement.scrollWidth,height:innerHeight,language:document.documentElement.lang,theme:document.documentElement.dataset.theme,buttons,
      dialogs:[...document.querySelectorAll('[role="dialog"]')].map(e=>({width:e.getBoundingClientRect().width,scroll:e.scrollWidth,client:e.clientWidth}))};
  })()`);
  assert.ok(value.scroll<=value.width+1,JSON.stringify(value));for(const d of value.dialogs)assert.ok(d.scroll<=d.client+1);
  for(const button of value.buttons)assert.ok(button.contrast>=4.5,JSON.stringify(button));
  layouts.push({component,name,...value});
}
async function rawNode(kind:string,body:any){const r=await fetch(apiBase+`/v1/cloud-runtime-nodes/${node.id}/`+kind,{method:"POST",headers:{authorization:"Bearer "+node.enrollment_token,"Content-Type":"application/json"},body:JSON.stringify(body)});const result=await r.json();assert.equal(r.status,200,JSON.stringify(result));return result;}
async function acknowledge(command:any,outcome:string,cleanup=false,result?:string){const body={instance_id:instance,session_id:command.session_id,generation:command.generation,command_id:command.id,outcome,cleanup_verified:cleanup,running_milliseconds:0,...(result?{result}:{})};const response=await rawNode("acknowledgements",body);nodeReceipts.push({command_id:command.id,kind:command.kind,synthetic_outcome:outcome,state:response.state});}
async function login(page:Page,isAdmin:boolean,email:string,secret?:any){
  await page.goto((isAdmin?adminBase:webBase)+"/login");await page.locator('input[name="email"]').fill(email);
  const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===(isAdmin?"/v1/admin/auth/challenge":"/v1/auth/challenges")),page.locator('form button[type="submit"]').click()]);assert.equal(response.status(),isAdmin?200:202);
  const challenge=await response.json(),mail=JSON.parse(await readFile(path.join(system.db.config.DATA_DIR,"mailbox",challenge.challenge_id+".json"),"utf8"));
  await page.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);if(secret)await page.locator('input[name="totp"]').fill(new OTPAuth.TOTP({secret,digits:6,period:30,algorithm:"SHA1"}).generate());
  const [verified]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===(isAdmin?"/v1/admin/auth/verify":"/v1/auth/sessions")),page.locator('form button[type="submit"]').click()]);assert.equal(verified.status(),isAdmin?200:201,"Sign-in response status");return verified.json();
}
try{
  const [{isolatedTestEnvironment},{buildApp},{loadConfig},{seal},{fund},{saveAsset}]=await Promise.all([load("tests/native-test-environment.ts"),load("src/server.ts"),load("src/config.ts"),load("src/lib.ts"),load("src/billing.ts"),load("src/storage.ts")]);
  process.chdir(platform);isolated=await isolatedTestEnvironment();
  system=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEMO_MODE:"true",DEV_MAILBOX:"true",WORKER_ENABLED:"false",WEB_ORIGIN:webBase,ADMIN_ORIGIN:adminBase}),{worker:false});system.app.addHook("onError",async(_request:any,_reply:any,error:any)=>{console.error("Synthetic-account backend diagnostic:",error.name,error.message,error.stack);});await system.app.listen({host:"127.0.0.1",port:ports.api});process.chdir(delivery);
  const adminEmail="cloud-ui-admin-"+randomUUID()+"@example.invalid",secret=new OTPAuth.Secret({size:20});
  const administrator=(await system.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Synthetic resource operator',$2) RETURNING id",[adminEmail,seal(system.db.config.MASTER_KEY,secret.base32)])).rows[0];
  const role="cloud_ui_"+randomUUID().replaceAll("-","");await system.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Synthetic resource operator',$2)",[role,JSON.stringify(["admin.cloud_runtime.infrastructure.write","admin.cloud_runtime.sessions.read","admin.cloud_runtime.sessions.stop","admin.cloud_runtime.sessions.reconcile"])]);await system.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,$2,'global')",[administrator.id,role]);
  browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true});
  const customerContext=await browser.newContext({viewport:{width:1440,height:1050}}),adminContext=await browser.newContext({viewport:{width:1440,height:1050}});
  for(const context of [customerContext,adminContext])await context.addInitScript(()=>{if(!localStorage.getItem("cp_locale"))localStorage.setItem("cp_locale","en");if(!localStorage.getItem("cp_theme"))localStorage.setItem("cp_theme","light");});
  const customerPage=await customerContext.newPage(),adminPage=await adminContext.newPage();for(const p of [customerPage,adminPage]){p.setDefaultTimeout(30000);p.on("pageerror",e=>errors.push(e.message));}
  const account=await login(customerPage,false,"cloud-ui-owner-"+randomUUID()+"@example.invalid"),customer=account.user.id;
  const cookie=(await customerContext.cookies(apiBase+"/v1")).map(c=>c.name+"="+c.value).join(";");
  async function userPost(url:string,body:any){const response=await fetch(apiBase+url,{method:"POST",headers:{cookie,origin:webBase,"x-csrf-token":account.csrf_token,"Content-Type":"application/json","Idempotency-Key":randomUUID()},body:JSON.stringify(body)});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;}
  const workspace=await userPost("/v1/tenants",{name:"Campaign computer qualification",project_name:"Spring campaign"}),tenant=workspace.tenant.id,project=workspace.project.id,base=`/v1/tenants/${tenant}/projects/${project}/cloud-computers`;
  const wallet=(await system.db.control.query("SELECT id FROM wallets WHERE tenant_id=$1",[tenant])).rows[0].id;
  await system.db.tx((tx:any)=>fund(tx,{billing_account_id:wallet,action:"gift",amount_micros:100000,reason:"Synthetic browser computer qualification credit",expires_at:new Date(Date.now()+86400000).toISOString()},randomUUID()),tenant,true,customer);
  await system.db.tx((tx:any)=>saveAsset(tx,system.storage,{tenant,project,user:customer,privateOwner:customer,name:"campaign-brief.txt",mime:"text/plain",bytes:Buffer.from("Synthetic private campaign brief")}),tenant,true,customer);
  await customerPage.evaluate(({tenant,project})=>{localStorage.setItem("cp_tenant",tenant);localStorage.setItem("cp_project",project);},{tenant,project});
  await login(adminPage,true,adminEmail,secret);await adminPage.goto(adminBase+"/cloud-computers");await adminPage.getByRole("heading",{name:"Dedicated cloud computers",exact:true}).waitFor();
  pass("Separate customer OTP and administrator OTP/TOTP sign-ins use actual authenticated sessions");

  await adminPage.getByRole("tab",{name:"Plans",exact:true}).click();
  recording=new WorkmateRecording("admin-cloud-121","dedicated-cloud-plan",attempt,()=>adminPage.screenshot({type:"jpeg",quality:80}),"Actual Admin versioned plan publication; explicit synthetic resource plan",delivery);await recording.start();
  await adminPage.getByRole("button",{name:"New plan",exact:true}).click();let dialog=adminPage.getByRole("dialog");
  await dialog.locator('input[name="key"]').fill("hk-ui-computer");await dialog.locator('input[name="name"]').fill("Campaign workspace");await dialog.locator('input[name="per_minute_micros"]').fill("1000");await dialog.locator('input[name="max_minutes"]').fill("30");await dialog.locator('input[name="enabled"]').check();await dialog.locator('textarea[name="reason"]').fill("Synthetic operator-prepared computer plan for UI qualification");
  await layout("admin",adminPage,"plan-editor-en");await capture("admin-cloud-121",adminPage,"plan-editor-en");await dialog.getByRole("button",{name:"Confirm operation",exact:true}).click();await dialog.waitFor({state:"detached"});await adminPage.getByText("Campaign workspace",{exact:true}).waitFor();
  recordings.push(await recording.stop());recording=undefined;
  await adminPage.getByRole("tab",{name:"Computers",exact:true}).click();await adminPage.getByRole("button",{name:"Enroll computer",exact:true}).click();dialog=adminPage.getByRole("dialog");
  await dialog.locator('input[name="name"]').fill("Synthetic node protocol fixture");await dialog.locator('select[name="plan_key"]').selectOption("hk-ui-computer");await dialog.locator('input[name="machine_fingerprint"]').fill(fingerprint);await dialog.locator('textarea[name="reason"]').fill("Synthetic node protocol only; no remote computer started");
  const [enrolled]=await Promise.all([adminPage.waitForResponse(r=>new URL(r.url()).pathname==="/v1/admin/cloud-computers/nodes"&&r.request().method()==="POST"),dialog.getByRole("button",{name:"Confirm operation",exact:true}).click()]);assert.equal(enrolled.status(),200);node=await enrolled.json();
  await adminPage.getByLabel("Enrollment credential",{exact:true}).waitFor();await adminPage.getByRole("button",{name:"Done and close",exact:true}).click();assert.equal(await adminPage.locator(".cloud-enrollment-secret").count(),0);
  const image=new PNG({width:1280,height:720});image.data.fill(242);for(let i=0;i<image.data.length;i+=4){image.data[i]=217;image.data[i+1]=229;image.data[i+2]=248;image.data[i+3]=255;}const pixels=PNG.sync.write(image).toString("base64");
  pollLoop=(async()=>{while(!finishNode){const reply=await rawNode("poll",{machine_fingerprint:fingerprint,instance_id:instance,agent_version:"1.0.0",physical_host:true,current_session_id:current?.id??null,current_generation:current?.generation??0});assert.equal(reply.stop_all,false);
    for(const command of reply.commands){if(command.kind==="start"){current={id:command.session_id,generation:command.generation};await acknowledge(command,"ready");}else if(command.kind==="input")await acknowledge(command,"completed",false,"Synthetic protocol receipt: command accepted; no remote shell executed.");else{await acknowledge(command,"stopped",true);current=null;}}
    if(current)await rawNode("frames",{instance_id:instance,session_id:current.id,generation:current.generation,sequence:++sequence,png_base64:pixels});await new Promise(r=>setTimeout(r,900));}})();
  await until(()=>system.db.control.query("SELECT state FROM cloud_runtime_nodes WHERE id=$1",[node.id]),(r:any)=>r.rows[0].state==="available","authenticated synthetic node heartbeat");
  await capture("admin-cloud-121",adminPage,"computers-en");pass("Actual Admin publishes a versioned plan and enrolls a one-time credential without retaining it on the page");

  await customerPage.goto(webBase+"/app/computers");await customerPage.getByRole("heading",{name:"Your cloud computers",exact:true}).waitFor();
  recording=new WorkmateRecording("web-cloud-121","dedicated-cloud-consent",attempt,()=>customerPage.screenshot({type:"jpeg",quality:80}),"Actual Web file scope, cost consent, post-commit response loss and stable-key retry; synthetic node protocol",delivery);await recording.start();
  await customerPage.getByRole("button",{name:"New cloud computer",exact:true}).click();dialog=customerPage.getByRole("dialog");await dialog.getByLabel("Duration (minutes)",{exact:true}).fill("5");await dialog.getByLabel("Paying account",{exact:true}).selectOption({label:"Workspace account"});await dialog.getByLabel("What will you work on?",{exact:true}).fill("Review the approved private campaign brief");await dialog.getByLabel("Allow terminal commands",{exact:true}).check();await dialog.getByLabel("Allow Codex to operate this computer within the selected controls",{exact:true}).check();
  await dialog.getByRole("button",{name:"Choose files",exact:true}).click();dialog=customerPage.getByRole("dialog");await dialog.locator(".cloud-source-list label").filter({hasText:"campaign-brief.txt"}).waitFor();assert.equal(await customerPage.getByRole("dialog").count(),1);await dialog.locator('label').filter({hasText:"campaign-brief.txt"}).getByRole("checkbox").check();await dialog.getByRole("button",{name:"Use selected files",exact:true}).click();
  dialog=customerPage.getByRole("dialog");await dialog.getByRole("button",{name:"Review cost and scope",exact:true}).click();await dialog.getByRole("heading",{name:"Review cost and working scope",exact:true}).waitFor();await layout("web",customerPage,"cost-consent-en");await capture("web-cloud-121",customerPage,"cost-consent-en");
  const confirm=dialog.getByRole("button",{name:"Approve cost and start",exact:true});assert.equal(await confirm.isDisabled(),true);assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM cloud_runtime_sessions")).rows[0].n,0);
  let drop=true;await customerPage.route("**/cloud-computers/sessions",async route=>{if(drop&&route.request().method()==="POST"){drop=false;confirmationKey=route.request().headers()["idempotency-key"];const result=await route.fetch();assert.equal(result.status(),200);postCommitSession=(await result.json()).id;await route.abort("failed");}else await route.continue();});
  await dialog.locator('.cloud-explicit-consent input').check();await confirm.click();await until(()=>Promise.resolve(postCommitSession),Boolean,"committed activation with intentionally lost browser response");await confirm.waitFor({state:"visible"});await until(()=>confirm.isEnabled(),Boolean,"retry available after response loss");await confirm.click();await customerPage.getByTestId("cloud-live-session").waitFor();
  const count=(await system.db.control.query("SELECT count(*)::int AS n FROM cloud_runtime_sessions")).rows[0].n;assert.equal(count,1);assert.ok(confirmationKey);assert.ok(postCommitSession);
  await customerPage.getByAltText("Current cloud computer screen. Click to interact.",{exact:true}).waitFor();await capture("web-cloud-121",customerPage,"session-en");
  await customerPage.getByRole("button",{name:"Create a Codex task",exact:true}).click();dialog=customerPage.getByRole("dialog");
  await dialog.getByRole("heading",{name:"Let Codex work on this computer",exact:true}).waitFor();assert.equal(await customerPage.getByRole("dialog").count(),1);
  await dialog.getByLabel("What should Codex do?",{exact:true}).fill("Review this approved private campaign brief and report actual command receipts.");
  await dialog.getByLabel("AI spending ceiling (HK$)",{exact:true}).fill("0.01");
  const createTask=dialog.getByRole("button",{name:"Approve and create task",exact:true});assert.equal(await createTask.isDisabled(),true);
  await layout("web",customerPage,"codex-task-consent-en");await capture("web-cloud-121",customerPage,"codex-task-consent-en");
  let taskDrop=true,confirmedTask:string|undefined,taskKey:string|undefined,taskFailure:string|undefined;
  await customerPage.route("**/cloud-computers/sessions/*/agent-tasks",async route=>{if(taskDrop&&route.request().method()==="POST"){taskDrop=false;taskKey=route.request().headers()["idempotency-key"];const response=await route.fetch();if(response.status()===200){confirmedTask=(await response.json()).task_id;await route.abort("failed");}else{taskFailure="Task creation HTTP "+response.status()+": "+await response.text();await route.fulfill({response});}}else await route.continue();});
  await dialog.locator(".cloud-explicit-consent input").check();await createTask.click();await until(()=>{if(taskFailure)throw new Error(taskFailure);return Promise.resolve(confirmedTask);},Boolean,"committed Codex task with intentionally lost response");
  await createTask.waitFor({state:"visible"});await until(()=>createTask.isEnabled(),Boolean,"explicit task retry available");await createTask.click();await dialog.getByRole("link",{name:"Open task",exact:true}).waitFor();
  assert.ok(taskKey);const binding=(await system.db.control.query("SELECT t.id,t.billing_account_id,t.budget_micros,b.session_id,b.generation FROM tasks t JOIN cloud_runtime_task_bindings b ON b.task_id=t.id")).rows;
  assert.equal(binding.length,1);assert.equal(binding[0].id,confirmedTask);assert.equal(binding[0].session_id,postCommitSession);assert.equal(binding[0].billing_account_id,wallet);assert.equal(String(binding[0].budget_micros),"10000");
  await capture("web-cloud-121",customerPage,"codex-task-created-en");await dialog.getByRole("button",{name:/Close|關閉/}).click();
  await customerPage.getByTestId("cloud-live-session").waitFor();
  recordings.push(await recording.stop());recording=undefined;
  pass("Private file scope and independent resource consent create one lease; separate Codex instruction and exact AI budget confirmation survive response loss with one private original-payer task");

  await customerPage.getByLabel("Run a command on this cloud computer",{exact:true}).fill("Get-ChildItem");await customerPage.getByRole("button",{name:"Run command",exact:true}).click();await customerPage.getByText("Synthetic protocol receipt: command accepted; no remote shell executed.",{exact:true}).waitFor();
  const imageLocator=customerPage.getByAltText("Current cloud computer screen. Click to interact.",{exact:true});await imageLocator.click({position:{x:40,y:40}});await until(()=>Promise.resolve(nodeReceipts.filter(r=>r.kind==="input").length),n=>n===2,"terminal and pointer receipts");
  await customerPage.evaluate(()=>{const wallClock=Date.now.bind(Date);Date.now=()=>wallClock()-86_400_000;});
  finishNode=true;await pollLoop;pollLoop=undefined;await until(()=>imageLocator.count(),n=>n===0,"stale pixels clear despite a customer wall-clock rollback",15000);await capture("web-cloud-121",customerPage,"stale-screen-en");pass("Bounded terminal and pointer controls use authenticated receipts, and stale pixels disappear despite a one-day customer wall-clock rollback");
  const state=(await system.db.control.query("SELECT version FROM cloud_runtime_sessions WHERE id=$1",[postCommitSession])).rows[0];assert.ok(state.version);
  await adminPage.getByRole("tab",{name:"Sessions",exact:true}).click();await adminPage.getByRole("button",{name:"Refresh",exact:true}).click();await adminPage.getByRole("button",{name:"Request stop",exact:true}).click();dialog=adminPage.getByRole("dialog");await dialog.getByLabel("Reason",{exact:true}).fill("End this synthetic protocol session after customer review");await dialog.getByRole("button",{name:"Confirm operation",exact:true}).click();await dialog.waitFor({state:"detached"});
  assert.equal((await system.db.control.query("SELECT state FROM cloud_runtime_holds WHERE session_id=$1",[postCommitSession])).rows[0].state,"reserved");
  const stopReply=await rawNode("poll",{machine_fingerprint:fingerprint,instance_id:instance,agent_version:"1.0.0",physical_host:true,current_session_id:current.id,current_generation:current.generation});assert.equal(stopReply.commands[0].kind,"stop");await acknowledge(stopReply.commands[0],"stopped",true);current=null;
  const hold=(await system.db.control.query("SELECT state FROM cloud_runtime_holds WHERE session_id=$1",[postCommitSession])).rows[0];assert.equal(hold.state,"released");await adminPage.getByRole("button",{name:"Refresh",exact:true}).click();await adminPage.getByText("Cleanup verified",{exact:true}).waitFor();await capture("admin-cloud-121",adminPage,"settled-en");pass("Reasoned MFA administrator stop retains funds until a matching synthetic cleanup receipt arrives");

  await customerPage.getByRole("dialog").getByRole("button",{name:/Close|關閉/}).click();
  for(const [component,page,url]of [["web-cloud-121",customerPage,webBase+"/app/computers"],["admin-cloud-121",adminPage,adminBase+"/cloud-computers"]] as const){
    for(const width of [390,768,1440]){await page.setViewportSize({width,height:900});await page.goto(url);await page.locator(component==="web-cloud-121"?'[data-testid="cloud-computers"]':'[data-testid="admin-cloud-computers"]').waitFor();await page.locator(component==="web-cloud-121"?".cloud-computer-card":".cloud-admin-row").first().waitFor();await layout(component,page,"light-en-"+width);}
    await page.getByTitle("切換至繁體中文",{exact:true}).click();await page.getByTitle("Theme: light / dark / system",{exact:true}).click();await page.waitForFunction(()=>document.documentElement.lang==="zh-Hant-HK"&&document.documentElement.dataset.theme==="dark");await page.locator(component==="web-cloud-121"?'[data-testid="cloud-computers"]':'[data-testid="admin-cloud-computers"]').waitFor();await page.locator(component==="web-cloud-121"?".cloud-computer-card":".cloud-admin-row").first().waitFor();assert.deepEqual(await page.evaluate(()=>({language:document.documentElement.lang,theme:document.documentElement.dataset.theme})),{language:"zh-Hant-HK",theme:"dark"});await layout(component,page,"dark-zh-1440");await capture(component,page,"overview-dark-zh");
  }
  pass("Both actual clients render loaded records at 390, 768 and 1440 pixels without horizontal overflow; real preference controls and document state verify Chinese dark mode");
  await customerPage.locator(".cloud-computer-card").first().click();await customerPage.getByTestId("cloud-live-session").waitFor();
  await customerPage.getByRole("button",{name:"移除私人內容",exact:true}).click();dialog=customerPage.getByRole("dialog");
  const remove=dialog.getByRole("button",{name:"永久移除私人內容",exact:true});assert.equal(await remove.isDisabled(),true);
  await dialog.getByRole("checkbox").check();await remove.click();await dialog.waitFor({state:"detached"});
  await customerPage.getByRole("heading",{name:"準備好，再開啟。",exact:true}).waitFor();await capture("web-cloud-121",customerPage,"removed-dark-zh");
  const removed=(await system.db.control.query("SELECT content_state,cleanup_verified FROM cloud_runtime_sessions WHERE id=$1",[postCommitSession])).rows[0];
  assert.equal(removed.content_state,"deleted");assert.equal(removed.cleanup_verified,true);
  assert.equal((await system.db.control.query("SELECT state FROM cloud_runtime_holds WHERE session_id=$1",[postCommitSession])).rows[0].state,"released");
  pass("Customer permanently removes private session content through an unchecked confirmation while original financial and cleanup records remain");assert.deepEqual(errors,[]);
}catch(e){errors.push(String(e));console.error(e);}finally{
  finishNode=true;if(pollLoop)try{await pollLoop;}catch(e){errors.push(String(e));}
  if(recording)try{const result=await recording.stop();if(result)recordings.push(result);}catch(e){errors.push(String(e));}
  if(browser){await browser.close();browserClosed=true;}
  if(system){await system.app.close();apiClosed=true;}
  if(isolated){await isolated.cleanup();fixtureClosed=true;}
  await mkdir(path.dirname(prefix),{recursive:true});const report={status:errors.length===0?"passed":"failed",at:new Date().toISOString(),scope:"Real browser and PostgreSQL, synthetic accounts, protocol node, usage and PNG pixels. No remote machine, shell execution, Codex run or real bill asserted.",checks,errors,screenshots,recordings,layouts,node_protocol_receipts:nodeReceipts,confirmation:{session_id:postCommitSession,idempotency_key:confirmationKey},browser_closed:browserClosed,api_closed:apiClosed,fixture_closed:fixtureClosed};await writeFile(prefix+"-journey.json",JSON.stringify(report,null,2)+"\n",{flag:"wx"});assert.equal(report.status,"passed",JSON.stringify(errors));
}
