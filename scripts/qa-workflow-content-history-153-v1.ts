import assert from "node:assert/strict";
import {chromium,type Browser,type Page} from "playwright";
import {readFile,writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import path from "node:path";
import {WorkmateRecording,saveWorkmateScreenshot} from "./record-workmate-media.js";

const delivery=process.cwd(),platform=path.resolve("../copypaste-platform"),attempt=process.argv[2];assert.match(attempt??"",/^\d{2}$/);
const prefix=`evidence/workflow-content-history-153/ui-${attempt}`,checks:string[]=[],errors:string[]=[],screenshots:any[]=[],recordings:any[]=[],layouts:any[]=[];
const load=(file:string)=>import(pathToFileURL(path.join(platform,file)).href);
let system:any,isolated:any,browser:Browser|undefined,recording:WorkmateRecording|undefined;
let stage="setup",browserClosed=false,apiClosed=false,fixtureClosed=false;
const pass=(name:string)=>{checks.push(name);console.log("PASS: "+name);};
async function shot(page:Page,name:string){screenshots.push(await saveWorkmateScreenshot("admin",`workflow-content-history-153-${attempt}`,name,await page.screenshot(),
 "Actual scoped administrator workflow history and source/permission withdrawal. Synthetic business/model fixture; real browser, HTTP and native SQL.",delivery));}
async function stopRecording(){if(recording){const r=recording;recording=undefined;recordings.push(await r.stop());}}
try{
 const [{isolatedTestEnvironment},{buildApp},{loadConfig},{workflowHistoryFixture},{saveAsset}]=await Promise.all([
  load("tests/native-test-environment.ts"),load("src/server.ts"),load("src/config.ts"),load("tests/workflow-history-fixture-153-v1.ts"),load("src/storage.ts")]);
 process.chdir(platform);isolated=await isolatedTestEnvironment();
 system=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEMO_MODE:"true",DEV_MAILBOX:"true",WORKER_ENABLED:"false",
  API_ORIGIN:"http://localhost:4310",WEB_ORIGIN:"http://localhost:4317",ADMIN_ORIGIN:"http://localhost:4318"}),{worker:false});
 await system.app.listen({host:"127.0.0.1",port:4310});const f=await workflowHistoryFixture(system,105,false);
 const run=(await system.db.control.query("INSERT INTO workflow_runs(tenant_id,project_id,workflow_id,created_by,actor_auth_version,definition,state) VALUES($1,$2,$3,$4,(SELECT auth_version FROM users WHERE id=$4),$5,'succeeded') RETURNING *",[f.tenant,f.project,f.shared.id,f.owner.id,f.definition(1)])).rows[0];
 const output=await system.db.tx((tx:any)=>saveAsset(tx,system.storage,{tenant:f.tenant,project:f.project,user:f.owner.id,name:"Original campaign run output.txt",mime:"text/plain",bytes:Buffer.from("Retained campaign output")}),f.tenant,false,f.owner.id);
 await system.db.control.query("UPDATE workflow_runs SET results=$2 WHERE id=$1",[run.id,JSON.stringify([{kind:"analytics.summary",asset_version_id:output.version.id}])]);
 const counts=async()=>(await system.db.control.query("SELECT (SELECT count(*) FROM tasks) tasks,(SELECT count(*) FROM reservations) reservations,(SELECT count(*) FROM ledger) ledger,(SELECT count(*) FROM current_ai_provider_requests) requests")).rows[0];
 const before=await counts();browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(30000);page.on("pageerror",e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});
 stage="administrator login";await page.goto("http://localhost:4318/login");await page.locator('input[name="email"]').fill(f.operator.email);
 const [challenge]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==="/v1/admin/auth/challenge"),page.locator('form button[type="submit"]').click()]);
 const mail=JSON.parse(await readFile(path.join(isolated.directory,"mailbox",(await challenge.json()).challenge_id+".json"),"utf8")),OTP=createRequire(path.join(platform,"package.json"))("otpauth");
 await page.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);await page.locator('input[name="totp"]').fill(new OTP.TOTP({secret:f.operator.secret,digits:6,period:30,algorithm:"SHA1"}).generate());
 await page.locator('form button[type="submit"]').click();await page.locator(".admin-shell").waitFor();pass("Actual email OTP/TOTP signs in the project-scoped body reader");
 const dialog=()=>page.getByRole("dialog"),items=()=>page.locator(".conversation-history-messages > li");
 async function close(){await dialog().getByRole("button",{name:"Close",exact:true}).click();await dialog().waitFor({state:"detached"});}
 async function open(name:string){await page.goto("http://localhost:4318/content");await page.getByRole("row").filter({hasText:name}).getByRole("button",{name:"Read content",exact:true}).click();await page.locator(".conversation-history-messages").waitFor();}
 async function nav(name:string){await dialog().getByRole("button",{name,exact:true}).click();await page.locator(".conversation-history-messages").waitFor();}
 stage="complete saved shared history";await open(f.shared.name);
 recording=new WorkmateRecording("admin","saved-workflow-history",`workflow-content-history-153-${attempt}`,()=>page.screenshot({type:"jpeg",quality:72}),"Actual reversible saved workflow history, precise source snapshots and live withdrawal",delivery);await recording.start();
 await items().first().locator("summary").click();await shot(page,"shared-newest-en");
 const seen:number[]=[];for(;;){seen.push(...await items().evaluateAll(nodes=>nodes.map(n=>Number(n.getAttribute("data-version")))));if(await dialog().getByRole("button",{name:"Next",exact:true}).isDisabled())break;await nav("Next");}
 assert.deepEqual(seen,Array.from({length:105},(_,n)=>105-n));await nav("Previous");await nav("Oldest");await items().last().locator("summary").click();
 assert.ok((await items().last().locator("pre").textContent())!.includes("campaign version 1"));await shot(page,"shared-oldest-en");await close();
 pass("All 105 real saved SQL-fixture versions are reachable without a silent 100-version cutoff");
 stage="private frozen version provenance";await open(f.privateWorkflow.name);assert.equal(await items().count(),3);await items().first().locator("summary").click();
 assert.ok((await items().first().locator("pre").textContent())!.includes("source_refs"));await shot(page,"private-frozen-en");
 await system.db.control.query("UPDATE tasks SET content_state='quarantined',moderation_version=moderation_version+1,retention_expires_at=now()-interval '1 day' WHERE id=$1",[f.originTask.id]);
 await system.db.control.query("UPDATE workflows SET content_state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",[f.privateWorkflow.id]);
 await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await page.getByRole("alert").waitFor();await nav("Refresh");await items().first().locator("summary").click();
 assert.ok((await items().first().locator("pre").textContent())!.includes("definition"));await shot(page,"quarantined-root-en");await close();
 pass("Private cloud frozen definitions survive creator expiry and permit investigation of the quarantined root");
 stage="source withdrawal clears an open definition";await open(f.shared.name);await items().first().locator("summary").click();
 await system.db.control.query("UPDATE analytics_datasets SET content_state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",[f.dataset.id]);
 await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await page.getByRole("alert").waitFor();assert.equal(await items().count(),0);await nav("Refresh");
 await dialog().getByText("The original sources are unavailable; this version body is not available.").first().waitFor();assert.equal(await items().locator("pre").count(),0);await shot(page,"source-withdrawn-en");
 await stopRecording();await close();await system.db.control.query("UPDATE analytics_datasets SET content_state='active',moderation_version=moderation_version+1 WHERE id=$1",[f.dataset.id]);
 pass("Real source quarantine clears an opened body and the refreshed page withholds every dependent definition");
 stage="current execution snapshot";await open("Workflow run");await items().first().locator("summary").click();
 await dialog().getByText("Current readable execution snapshot").waitFor();assert.equal(await dialog().getByRole("button",{name:"Oldest",exact:true}).count(),0);
 assert.ok((await items().first().locator("pre").textContent())!.includes(output.version.id));await shot(page,"run-snapshot-en");
 await system.db.control.query("UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",[output.id]);
 await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await page.getByRole("alert").waitFor();assert.equal(await items().count(),0);await nav("Refresh");
 assert.equal(await items().locator("pre").count(),0);await shot(page,"run-output-withdrawn-en");await close();
 pass("Actual execution snapshot has no invented version history and clears cached results when its fixed output is withdrawn");
 stage="bilingual and responsive history";await page.getByTitle("切換至繁體中文").click();
 await page.getByRole("row").filter({hasText:f.shared.name}).getByRole("button",{name:"Read content",exact:true}).click();await page.locator(".conversation-history-messages").waitFor();await items().first().locator("summary").click();await dialog().getByRole("button",{name:"最早版本",exact:true}).waitFor();await shot(page,"shared-newest-zh");
 await close();await page.getByTitle("Switch to English").click();await open(f.shared.name);await items().first().locator("summary").click();
 for(const width of[1440,960,390]){await page.setViewportSize({width,height:1000});const layout=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));assert.ok(layout.width<=width+1,JSON.stringify(layout));layouts.push(layout);}
 await shot(page,"narrow-history-en");await page.setViewportSize({width:1440,height:1000});await close();
 pass("Traditional Chinese/English controls and three viewport sizes retain readable history without horizontal page overflow");
 stage="live project denial";await open(f.shared.name);await items().first().locator("summary").click();
 recording=new WorkmateRecording("admin","workflow-permission-withdrawal",`workflow-content-history-153-${attempt}`,()=>page.screenshot({type:"jpeg",quality:72}),"Actual open history clears after a scoped explicit administrator denial",delivery);await recording.start();
 await system.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,'project',$3,'deny')",[f.operator.id,f.operator.role,f.project]);
 await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await page.getByRole("alert").waitFor();assert.equal(await items().count(),0);await shot(page,"permission-withdrawn-en");await stopRecording();
 const persisted=await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]));assert.equal(persisted.includes("Review retained campaign version"),false);assert.equal(persisted.includes("source_refs"),false);
 assert.deepEqual(await counts(),before);assert.equal(Number(before.requests),0);pass("Current project denial clears bodies, browser storage retains none and reading creates no paid/model work");
 assert.equal(checks.length,7);
}catch(e){errors.push(stage+": "+String(e));}
finally{
 try{await stopRecording();}catch(e){errors.push("recording: "+String(e));}
 if(browser)try{await browser.close();browserClosed=true;}catch(e){errors.push("browser close: "+String(e));}
 if(system)try{await system.app.close();apiClosed=true;}catch(e){errors.push("API close: "+String(e));}
 if(isolated)try{await isolated.cleanup();fixtureClosed=true;}catch(e){errors.push("fixture close: "+String(e));}
 process.chdir(delivery);const status=errors.length===0&&checks.length===7&&browserClosed&&apiClosed&&fixtureClosed?"passed":"failed";
 await writeFile(prefix+"-journey.json",JSON.stringify({at:new Date().toISOString(),status,stage,checks,errors,screenshots,recordings,layouts,browser_closed:browserClosed,api_closed:apiClosed,fixture_closed:fixtureClosed,
  scope:"Actual Admin browser, OTP/TOTP, native SQL and saved private cloud tool definitions. Long shared history is explicitly seeded through the real snapshot trigger; no customer shared-edit UI or actual Codex model execution is claimed. Frozen clients untouched; broad regression omitted."},null,2)+"\n",{flag:"wx"});
 console.log(JSON.stringify({status,checks:checks.length,errors}));assert.equal(status,"passed");
}
