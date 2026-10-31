import assert from "node:assert/strict";
import {chromium,type Browser,type Page} from "playwright";
import {readFile,writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import path from "node:path";
import {WorkmateRecording,saveWorkmateScreenshot} from "./record-workmate-media.js";

const delivery=process.cwd(),platform=path.resolve("../copypaste-platform"),attempt=process.argv[2];
assert.match(attempt??"",/^\d{2}$/);
const prefix="evidence/runtime-pause-154/ui-"+attempt,checks:string[]=[],errors:string[]=[],screenshots:any[]=[],recordings:any[]=[],layouts:any[]=[];
const load=(file:string)=>import(pathToFileURL(path.join(platform,file)).href);
let system:any,isolated:any,browser:Browser|undefined,recording:WorkmateRecording|undefined;
let stage="setup",browserClosed=false,apiClosed=false,fixtureClosed=false,release:(()=>void)|undefined,pending:Promise<any>|undefined;
const pass=(name:string)=>{checks.push(name);console.log("PASS: "+name);};
async function shot(page:Page,repo:string,name:string){screenshots.push(await saveWorkmateScreenshot(repo,"runtime-pause-154-"+attempt,name,await page.screenshot(),"Actual running cloud pause and same-task/thread/budget continuation. Synthetic model adapter; real browser, HTTP and native SQL.",delivery));}
async function stopRecording(){if(recording){const r=recording;recording=undefined;recordings.push(await r.stop());}}
async function until(fn:()=>Promise<boolean>){const deadline=Date.now()+30000;while(!await fn()){assert.ok(Date.now()<deadline,"Bounded task state wait");await new Promise(r=>setTimeout(r,150));}}
try {
 const [{isolatedTestEnvironment},{buildApp},{loadConfig},{taskPauseFixture,PauseFixtureRuntime,pauseRow,retainedChecklist},{historyOk,historyAdmin}]=await Promise.all([
  load("tests/native-test-environment.ts"),load("src/server.ts"),load("src/config.ts"),load("tests/task-pause-fixture-154-v2.ts"),load("tests/admin-history-fixture.ts")]);
 process.chdir(platform);isolated=await isolatedTestEnvironment();
 system=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEMO_MODE:"true",DEV_MAILBOX:"true",WORKER_ENABLED:"false",API_ORIGIN:"http://localhost:4310",WEB_ORIGIN:"http://localhost:4317",ADMIN_ORIGIN:"http://localhost:4318"}),{worker:false});
 await system.app.listen({host:"127.0.0.1",port:4310});const f=await taskPauseFixture(system);
 browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await context.newPage();page.setDefaultTimeout(30000);page.on("pageerror",e=>errors.push(e.message));
 await context.addInitScript(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});
 stage="customer OTP";await page.goto("http://localhost:4317/login");await page.locator('input[name="email"]').fill(f.owner.email);
 const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==="/v1/auth/challenges"),page.locator('form button[type="submit"]').click()]);assert.equal(response.status(),202);
 const mail=JSON.parse(await readFile(path.join(isolated.directory,"mailbox",(await response.json()).challenge_id+".json"),"utf8"));
 await page.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);await page.locator('form button[type="submit"]').click();await page.waitForURL("**/app");
 await page.evaluate(({tenant,project})=>{localStorage.setItem("cp_tenant",tenant);localStorage.setItem("cp_project",project);},{tenant:f.tenant,project:f.project});pass("Customer email OTP opens the authorized workspace");
 let readyResolve!:()=>void;let ready=new Promise<void>(r=>readyResolve=r),gate=new Promise<void>(r=>release=r);
 const runtime=new PauseFixtureRuntime(system,async(ctx:any,n:number)=>{await ctx.tools.find((t:any)=>t.name==="deliver_text").run(retainedChecklist,"retain-"+n);if(n===1){readyResolve();await gate;}else assert.equal(ctx.thread,runtime.thread);});
 pending=runtime.run(f);await ready;
 stage="running cloud pause";await page.goto("http://localhost:4317/app/tasks/"+f.task.id);await page.getByRole("button",{name:"Pause task",exact:true}).waitFor();
 recording=new WorkmateRecording("web","running-pause-resume","runtime-pause-154-"+attempt,()=>page.screenshot({type:"jpeg",quality:72}),"Actual customer control interaction with a synthetic completed-turn model fixture",delivery);await recording.start();
 await shot(page,"web","running");await page.getByRole("button",{name:"Pause task",exact:true}).click();await page.getByRole("button",{name:"Pausing safely",exact:true}).waitFor();
 assert.equal(await page.getByRole("button",{name:"Pausing safely",exact:true}).isDisabled(),true);assert.equal((await pauseRow(system,f)).status,"running");await shot(page,"web","pause-requested");
 release!();release=undefined;await pending;pending=undefined;await page.getByRole("button",{name:"Resume task",exact:true}).waitFor();
 const paused=await pauseRow(system,f);assert.equal(paused.status,"paused");assert.ok(Number(paused.accrued_micros)>0);await shot(page,"web","paused");pass("Running pause waits for a measured completed turn and retains its output, usage and original hold");
 stage="same-thread resume";await page.getByRole("button",{name:"Resume task",exact:true}).click();await until(async()=>(await pauseRow(system,f)).status==="queued");await runtime.run(f);await until(async()=>(await page.locator("body").innerText()).includes("Campaign release checklist reviewed."));
 const done=await pauseRow(system,f);assert.equal(done.status,"succeeded");assert.equal(done.attempt,2);assert.equal(done.budget_micros,paused.budget_micros);assert.equal(runtime.calls.length,2);
 assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM task_tool_receipts WHERE task_id=$1",[f.task.id])).rows[0].n,1);await shot(page,"web","resumed-result");await stopRecording();
 pass("Resume keeps the same task, native thread and budget; a completed tool result is reused once");
 stage="localized compact layout";await page.evaluate(()=>localStorage.setItem("cp_locale","zh-HK"));await page.reload();await page.getByRole("heading",{name:f.task.title}).waitFor();await page.setViewportSize({width:390,height:900});
 const layout=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));layouts.push(layout);assert.ok(layout.document<=layout.width&&layout.body<=layout.width);await shot(page,"web","compact-zh");pass("The task result remains available in a compact Chinese layout without horizontal overflow");
 stage="scoped administrator controls";const task=await historyOk(system,f.owner,"POST",f.base+"/tasks",{title:"Scoped operator pause review",prompt:"Explicit synthetic review with an administrator requested pause.",role_key:"fullstack",agent_id:f.agent.id,budget_micros:1000000}),second={...f,task};
 const operator=await historyAdmin(system,f.project,["admin.execution.read","admin.execution.cancel","admin.execution.pause","admin.execution.resume"],false);
 ready=new Promise<void>(r=>readyResolve=r);gate=new Promise<void>(r=>release=r);const adminRuntime=new PauseFixtureRuntime(system,async()=>{readyResolve();await gate;});pending=adminRuntime.run(second);await ready;
 const adminContext=await browser.newContext({viewport:{width:1440,height:1000}}),admin=await adminContext.newPage();admin.setDefaultTimeout(30000);admin.on("pageerror",e=>errors.push(e.message));
 await admin.addInitScript(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});await admin.goto("http://localhost:4318/login");await admin.locator('input[name="email"]').fill(operator.email);
 const [challenge]=await Promise.all([admin.waitForResponse(r=>new URL(r.url()).pathname==="/v1/admin/auth/challenge"),admin.locator('form button[type="submit"]').click()]);
 const adminMail=JSON.parse(await readFile(path.join(isolated.directory,"mailbox",(await challenge.json()).challenge_id+".json"),"utf8")),OTP=createRequire(path.join(platform,"package.json"))("otpauth");
 await admin.locator('input[name="code"]').fill(adminMail.text.match(/\b\d{6}\b/)[0]);await admin.locator('input[name="totp"]').fill(new OTP.TOTP({secret:operator.secret,digits:6,period:30,algorithm:"SHA1"}).generate());await admin.locator('form button[type="submit"]').click();await admin.locator(".admin-shell").waitFor();
 await admin.goto("http://localhost:4318/execution");await admin.getByRole("row").filter({hasText:task.title}).getByRole("button",{name:"Manage task",exact:true}).click();const dialog=admin.getByRole("dialog");
 recording=new WorkmateRecording("admin","scoped-running-pause","runtime-pause-154-"+attempt,()=>admin.screenshot({type:"jpeg",quality:72}),"Actual scoped MFA administrator requests a safe running pause; fixture model completes only after the intent is acknowledged",delivery);await recording.start();
 await dialog.locator('select[name="action"]').selectOption("pause");await dialog.locator('textarea[name="reason"]').fill("Customer requested safe pause of the original campaign review");await shot(admin,"admin","request-safe-pause");
 await dialog.locator('button[type="submit"]').click();await dialog.waitFor({state:"detached"});assert.equal((await pauseRow(system,second)).pause_requested,true);release!();release=undefined;await pending;pending=undefined;
 await admin.reload();await admin.getByRole("row").filter({hasText:task.title}).getByText("Paused",{exact:true}).waitFor();await shot(admin,"admin","scoped-paused-task");await stopRecording();
 await historyOk(system,f.owner,"POST",f.base+"/tasks/"+task.id+"/cancel");assert.equal((await pauseRow(system,second)).status,"cancelled");pass("A project-scoped MFA administrator requests the same safe pause and customer cancellation settles the retained usage");
 assert.equal(checks.length,5);
} catch(e){errors.push(stage+": "+String(e));}
finally {
 if(release)release();if(pending)try{await pending;}catch(e){errors.push("pending worker: "+String(e));}
 try{await stopRecording();}catch(e){errors.push("recording: "+String(e));}
 if(browser)try{await browser.close();browserClosed=true;}catch(e){errors.push("browser close: "+String(e));}
 if(system)try{await system.app.close();apiClosed=true;}catch(e){errors.push("API close: "+String(e));}
 if(isolated)try{await isolated.cleanup();fixtureClosed=true;}catch(e){errors.push("fixture close: "+String(e));}
 process.chdir(delivery);const status=errors.length===0&&checks.length===5&&browserClosed&&apiClosed&&fixtureClosed?"passed":"failed";
 await writeFile(prefix+"-journey.json",JSON.stringify({at:new Date().toISOString(),status,stage,checks,errors,screenshots,recordings,layouts,browser_closed:browserClosed,api_closed:apiClosed,fixture_closed:fixtureClosed,scope:"Actual Web and scoped Admin browser, OTP/TOTP, native SQL and real Worker/tool controls. Synthetic Codex adapter, no actual model or external service request. Desktop cloud renderer and Extension build only. Broad regression omitted; frozen clients untouched."},null,2)+"\n",{flag:"wx"});
 console.log(JSON.stringify({status,checks:checks.length,errors}));assert.equal(status,"passed");
}
