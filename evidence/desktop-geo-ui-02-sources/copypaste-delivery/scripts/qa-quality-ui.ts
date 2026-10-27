import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";
const delivery=process.cwd(),platform=path.resolve("../copypaste-platform"),attempt=process.argv[2];assert.match(attempt??"",/^\d{2}$/);
const checks:string[]=[],errors:string[]=[],screenshots:any[]=[],media:any[]=[];
let isolated:any,system:any,browser:Browser|undefined,recording:WorkmateRecording|undefined;
let browserClosed=false,apiClosed=false,fixtureClosed=false;
const pass=(s:string)=>{checks.push(s);console.log("PASS: "+s);};
async function until(read:()=>Promise<any>,ok:(v:any)=>boolean,label:string){const end=Date.now()+30000;do{const v=await read();if(ok(v))return v;await new Promise(r=>setTimeout(r,120));}while(Date.now()<end);throw new Error("Timed out: "+label);}
async function api(page:Page,url:string,method="GET",body?:any){return page.evaluate(async ({url,method,body})=>{
 const session=await (await fetch(url.startsWith("/v1/admin")?"/v1/admin/me":"/v1/session/context",{credentials:"include"})).json();
 const r=await fetch(url,{method,credentials:"include",headers:{"Content-Type":"application/json","X-CSRF-Token":session.csrf_token??"","Idempotency-Key":crypto.randomUUID()},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,data:await r.json()};
},{url,method,body});}
async function signIn(page:Page,address:string,admin=false,secret?:any){
 const prefix=admin?"/v1/admin/auth":"/v1/auth",origin=admin?"http://localhost:4318":"http://localhost:4317";
 await page.goto(origin+(admin?"":"/login"));await page.locator('input[name="email"]').fill(address);
 const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===prefix+(admin?"/challenge":"/challenges")),page.locator('form button[type="submit"]').click()]);
 assert.equal(response.status(),admin?200:202);const ch=await response.json(),mail=JSON.parse(await readFile(path.join(isolated.directory,"mailbox",ch.challenge_id+".json"),"utf8"));
 await page.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);
 if(admin)await page.locator('input[name="totp"]').fill(secret.generate());
 const [verified]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===prefix+(admin?"/verify":"/sessions")&&r.request().method()==="POST"),page.locator('form button[type="submit"]').click()]);
 assert.equal(verified.status(),admin?200:201,await verified.text());
}
const shot=async(page:Page,repo:string,name:string)=>{await page.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});screenshots.push(await saveWorkmateScreenshot(repo,"quality-"+attempt,name,await page.screenshot(),"Actual browser page after its CSS transitions and real company API/records; model output and customer feedback are explicit fixtures.",delivery));};
const deadline=setTimeout(()=>{errors.push("Owned quality UI deadline exceeded");void browser?.close();},240000);
try{
 const load=async(file:string)=>import(pathToFileURL(path.join(platform,file)).href);
 const {isolatedTestEnvironment}=await load("tests/native-test-environment.ts"),{buildApp}=await load("src/server.ts"),{loadConfig}=await load("src/config.ts"),{Worker}=await load("src/worker.ts"),{CodexRuntimeAdapter}=await load("src/runtime.ts"),{seal}=await load("src/lib.ts");
 process.chdir(platform);isolated=await isolatedTestEnvironment();system=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEV_MAILBOX:"true",WORKER_ENABLED:"false",DEMO_MODE:"true"}),{worker:false});system.app.addHook("onError",async(_req:any,_reply:any,error:any)=>console.error("Owned quality UI API error:",error.name,error.code??"",error.message));await system.app.listen({host:"127.0.0.1",port:4310});
 browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true});
 const context=await browser.newContext({viewport:{width:1360,height:1000}});await context.addInitScript(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on("pageerror",e=>errors.push(e.message));
 await signIn(page,`quality-ui-${randomUUID()}@example.invalid`);
 const w=await api(page,"/v1/tenants","POST",{name:"Quality UI fixture",project_name:"Simulated campaign brief"});assert.equal(w.status,200,JSON.stringify(w.data));
 const tenant=w.data.tenant.id,project=w.data.project.id,base=`/v1/tenants/${tenant}/projects/${project}`;
 const funded=await api(page,`/v1/tenants/${tenant}/demo-credit`,"POST",{});assert.equal(funded.status,200,JSON.stringify(funded.data));
 const created=await api(page,base+"/tasks","POST",{title:"Campaign brief · explicit simulated task",prompt:"Create a clearly simulated campaign brief for interface testing.",role_key:"assistant",budget_micros:1000000});assert.equal(created.status,200,JSON.stringify(created.data));
 class UiRuntime extends CodexRuntimeAdapter{constructor(){super(system.db.config);}async start(ctx:any){await ctx.tools.find((t:any)=>t.name==="deliver_text").run({filename:"campaign-brief.txt",content:"Explicit simulated campaign brief. Not real customer marketing evidence.",mime_type:"text/plain"},"quality-ui-delivery");return{status:"completed",text:"An explicitly simulated campaign brief is ready for your review.",thread:"quality-fixture",turn:"1",inputTokens:20,outputTokens:30,usageKnown:true,accepted:true};}}
 await new Worker(system.db,system.catalog,system.storage,new UiRuntime()).run(tenant,created.data.id);
 await page.evaluate(({tenant,project})=>{localStorage.setItem("cp_tenant",tenant);localStorage.setItem("cp_project",project);},{tenant,project});
 await page.goto("http://localhost:4317/app/tasks/"+created.data.id);
 const card=page.locator(".delivery-quality");await card.getByRole("button",{name:"Save review",exact:true}).waitFor();await card.scrollIntoViewIfNeeded();
 recording=new WorkmateRecording("web","delivery-review","quality-"+attempt,()=>page.screenshot({type:"jpeg",quality:85}),"Actual Web review; synthetic model/customer input, real record writes",delivery);await recording.start();
 await card.getByLabel("Review of the complete delivery",{exact:true}).selectOption("changes_requested");await card.getByLabel("Your feedback (optional)",{exact:true}).fill("Use the company blue. Explicit interface test feedback.");await card.getByRole("button",{name:"Save review",exact:true}).click();await card.locator("header .badge").filter({hasText:"Changes requested"}).waitFor();
 await card.getByLabel("Review of the complete delivery",{exact:true}).selectOption("accepted");await card.getByLabel("Your feedback (optional)",{exact:true}).fill("Accepted for this simulated UI scenario only.");await card.getByRole("button",{name:"Save review",exact:true}).click();await card.locator("header .badge").filter({hasText:"Accepted"}).waitFor();
 await card.getByText("Record human effort",{exact:true}).click();await card.getByLabel("Manual baseline (minutes)",{exact:true}).fill("90");await card.getByLabel("Actual human effort (minutes)",{exact:true}).fill("14");await card.getByLabel("Manual revisions",{exact:true}).fill("1");await card.getByRole("button",{name:"Save human effort",exact:true}).click();
 await until(async()=> (await system.db.control.query("SELECT human_minutes FROM task_quality_measurements WHERE task_id=$1",[created.data.id])).rows[0]?.human_minutes,v=>v===14,"Web customer effort committed");
 await card.scrollIntoViewIfNeeded();await shot(page,"web","review-en");pass("Web records changes, acceptance and customer human effort against the fixed current delivery");
 media.push(await recording.stop());recording=undefined;
 await page.goto("http://localhost:4317/app/usage");await page.getByRole("heading",{name:"Deliveries, and work put to use",exact:true}).waitFor();const summary=page.locator(".quality-summary");await summary.getByText("Customer revision requests",{exact:true}).waitFor();await summary.scrollIntoViewIfNeeded();await shot(page,"web","summary-en");
 const value=await api(page,base+"/quality");assert.equal(value.data.accepted,1);assert.equal(value.data.revision_requests,1);assert.equal(value.data.human_minutes,"14");assert.equal(value.data.roi,null);pass("Project metrics distinguish technical success, current acceptance, revision requests and explicitly reported human effort");
 await page.setViewportSize({width:390,height:850});await summary.getByRole("button",{name:"Update metrics",exact:true}).focus();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await shot(page,"web","summary-mobile-en");
 const require=createRequire(path.join(platform,"package.json")),OTPAuth=require("otpauth"),secret=new OTPAuth.Secret({size:20}),address=`quality-ui-admin-${randomUUID()}@example.invalid`;
 const admin=(await system.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Quality UI reader',$2) RETURNING id",[address,seal(system.db.config.MASTER_KEY,secret.base32)])).rows[0];
 const role="quality_ui_"+admin.id.replaceAll("-","");await system.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Quality reader',$2)",[role,JSON.stringify(["admin.usage.read"])]);await system.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'tenant',$3)",[admin.id,role,tenant]);
 const adminContext=await browser.newContext({viewport:{width:1360,height:1000}});await adminContext.addInitScript(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});const panel=await adminContext.newPage();panel.setDefaultTimeout(15000);panel.on("pageerror",e=>errors.push(e.message));
 const totp=new OTPAuth.TOTP({secret,digits:6,period:30,algorithm:"SHA1"});await signIn(panel,address,true,totp);await panel.getByRole("link",{name:"Delivery quality",exact:true}).click();await panel.getByRole("heading",{name:"Deliveries, and work put to use",exact:true}).waitFor();
 recording=new WorkmateRecording("admin","delivery-quality","quality-"+attempt,()=>panel.screenshot({type:"jpeg",quality:85}),"Actual scoped Admin quality dashboard; real MFA/API, synthetic model and customer feedback",delivery);await recording.start();await shot(panel,"admin","summary-en");
 const metadata=await api(panel,"/v1/admin/quality");assert.equal(metadata.status,200,JSON.stringify(metadata.data));assert.equal(metadata.data.accepted,1);assert.equal(JSON.stringify(metadata.data).includes("Use the company blue"),false);pass("Admin dashboard uses MFA and scoped usage metadata, with no customer feedback body or acceptance mutation");
 await panel.getByTitle("切換至繁體中文",{exact:true}).click();await panel.getByTitle("Theme: light / dark / system",{exact:true}).click();
 await panel.getByRole("heading",{name:"交付，與真正用上的成果",exact:true}).waitFor();assert.equal(await panel.evaluate(()=>document.documentElement.dataset.theme),"dark");await shot(panel,"admin","summary-zh-dark");
 await system.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,'project',$3,'deny')",[admin.id,role,project]);await panel.locator('.quality-summary button[type="submit"]').click();await until(async()=>api(panel,"/v1/admin/quality"),v=>v.data.tasks===0,"explicit project deny in aggregates");await shot(panel,"admin","project-denied-zh-dark");pass("Explicit project deny removes its tasks, costs and quality metrics from Admin aggregates");
 media.push(await recording.stop());recording=undefined;
}catch(e){errors.push(String(e));console.error(e);}finally{
 clearTimeout(deadline);if(recording)try{media.push(await recording.stop());}catch(e){errors.push(String(e));}
 if(browser)await browser.close().then(()=>browserClosed=true).catch(e=>errors.push(String(e)));
 if(system)await system.app.close().then(()=>apiClosed=true).catch((e:any)=>errors.push(String(e)));
 if(isolated){process.chdir(platform);await isolated.cleanup().then(()=>fixtureClosed=true).catch((e:any)=>errors.push(String(e)));}process.chdir(delivery);
 const result={at:new Date().toISOString(),status:!errors.length&&browserClosed&&apiClosed&&fixtureClosed?"passed":"failed",checks,errors,screenshots,media,browser_closed:browserClosed,api_closed:apiClosed,fixture_closed:fixtureClosed,not_validated:["Live business blind review and ROI","Full product acceptance"]};await writeFile(`evidence/quality-ui-${attempt}-journey.json`,JSON.stringify(result,null,2)+"\n",{flag:"wx"});assert.equal(result.status,"passed",JSON.stringify(errors));
}
