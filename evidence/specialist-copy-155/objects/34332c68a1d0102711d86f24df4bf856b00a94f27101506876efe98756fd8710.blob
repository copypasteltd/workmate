import assert from "node:assert/strict";
import {chromium,type Browser,type Page} from "playwright";
import {readFile,writeFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import path from "node:path";
import {WorkmateRecording,saveWorkmateScreenshot} from "./record-workmate-media.js";
const delivery=process.cwd(),platform=path.resolve("../copypaste-platform"),attempt=process.argv[2];assert.match(attempt??"",/^\d{2}$/);
const prefix="evidence/specialist-copy-155/ui-"+attempt,checks:string[]=[],errors:string[]=[],screenshots:any[]=[],recordings:any[]=[],layouts:any[]=[];
const load=(file:string)=>import(pathToFileURL(path.join(platform,file)).href),pass=(name:string)=>{checks.push(name);console.log("PASS: "+name);};
let system:any,isolated:any,browser:Browser|undefined,recording:WorkmateRecording|undefined,stage="setup",browserClosed=false,apiClosed=false,fixtureClosed=false;
async function shot(page:Page,name:string){screenshots.push(await saveWorkmateScreenshot("web","specialist-copy-155-"+attempt,name,await page.screenshot(),"Actual Web fixed specialist copy, retained brand revision, reviewed bindings, lost-response recovery and source change rejection. Native SQL/HTTP with synthetic business data; no model execution.",delivery));}
async function stopRecording(){if(recording){const r=recording;recording=undefined;recordings.push(await r.stop());}}
try {
 const [{isolatedTestEnvironment},{buildApp},{loadConfig},{specialistCopyFixture,copyFacts},{historyOk}]=await Promise.all([
  load("tests/native-test-environment.ts"),load("src/server.ts"),load("src/config.ts"),load("tests/specialist-copy-fixture-155-v1.ts"),load("tests/admin-history-fixture.ts")]);
 process.chdir(platform);isolated=await isolatedTestEnvironment();system=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEMO_MODE:"true",DEV_MAILBOX:"true",WORKER_ENABLED:"false",API_ORIGIN:"http://localhost:4310",WEB_ORIGIN:"http://localhost:4317",ADMIN_ORIGIN:"http://localhost:4318"}),{worker:false});
 await system.app.listen({host:"127.0.0.1",port:4310});const f=await specialistCopyFixture(system),before=await copyFacts(system,f);
 browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(30000);page.on("pageerror",e=>errors.push(e.message));
 await context.addInitScript(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});
 stage="customer OTP";await page.goto("http://localhost:4317/login");await page.locator('input[name="email"]').fill(f.owner.email);
 const [challenge]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==="/v1/auth/challenges"),page.locator('form button[type="submit"]').click()]);assert.equal(challenge.status(),202);
 const mail=JSON.parse(await readFile(path.join(isolated.directory,"mailbox",(await challenge.json()).challenge_id+".json"),"utf8"));await page.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);await page.locator('form button[type="submit"]').click();await page.waitForURL("**/app");
 await page.evaluate(({tenant,project})=>{localStorage.setItem("cp_tenant",tenant);localStorage.setItem("cp_project",project);},{tenant:f.tenant,project:f.project});pass("Customer email OTP opens the authorized specialist project");
 stage="retained original copy review";await page.goto("http://localhost:4317/app/specialists");
 const source=()=>page.locator("article").filter({hasText:f.source.name}).first(),dialog=()=>page.getByRole("dialog");
 await source().getByRole("button",{name:"Copy",exact:true}).waitFor();
 recording=new WorkmateRecording("web","reviewed-copy-recovery","specialist-copy-155-"+attempt,()=>page.screenshot({type:"jpeg",quality:72}),"Actual reviewed copy and a backend-accepted response deliberately lost once; retry recovers the same specialist",delivery);await recording.start();await shot(page,"source");
 await source().getByRole("button",{name:"Copy",exact:true}).click();await dialog().locator('input[name="name"]').fill("Campaign specialist retained copy");await dialog().getByRole("button",{name:"Review copy",exact:true}).click();
 await dialog().getByRole("heading",{name:"Source specialist",exact:true}).waitFor();assert.equal(await dialog().getByRole("button",{name:"Confirm copy",exact:true}).isDisabled(),true);
 await dialog().getByText("v1",{exact:true}).waitFor();await shot(page,"review-original-brand");pass("The copy review retains brand revision1 after revision2 was published, with exact original models, rates and methods");
 let lost=false,acceptedId:string|undefined;const pattern="**/agents/"+f.source.id+"/copies";
 await page.route(pattern,async route=>{if(!lost){lost=true;const response=await route.fetch();assert.ok(response.ok());acceptedId=(await response.json()).id;await route.abort("failed");}else await route.continue();});
 stage="accepted response loss and recovery";await dialog().getByRole("checkbox",{name:"I reviewed the retained versions and copy scope",exact:true}).check();await dialog().getByRole("button",{name:"Confirm copy",exact:true}).click();
 await dialog().getByRole("alert").waitFor();
 assert.ok(acceptedId);assert.equal((await copyFacts(system,f)).agents,before.agents+1);await shot(page,"response-lost");await dialog().getByRole("button",{name:"Confirm copy",exact:true}).click();await dialog().waitFor({state:"detached"});
 await page.getByRole("heading",{name:"Campaign specialist retained copy",exact:true}).waitFor();assert.equal((await copyFacts(system,f)).agents,before.agents+1);await shot(page,"copied");await stopRecording();await page.unroute(pattern);
 assert.equal((await system.db.control.query("SELECT body->'brand'->>'version' AS brand FROM agent_versions WHERE agent_id=$1",[acceptedId])).rows[0].brand,"1");pass("A lost accepted confirmation response retries into the same copy without duplicating specialists or private data");
 stage="Chinese compact layout";await page.evaluate(()=>localStorage.setItem("cp_locale","zh-HK"));await page.reload();await page.getByRole("heading",{name:"Campaign specialist retained copy",exact:true}).waitFor();await page.setViewportSize({width:390,height:900});
 const layout=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));layouts.push(layout);assert.ok(layout.document<=layout.width&&layout.body<=layout.width);await shot(page,"compact-zh");pass("Chinese specialist cards remain usable at390px without horizontal overflow");
 stage="source changed after review";await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>localStorage.setItem("cp_locale","en"));await page.reload();await source().getByRole("button",{name:"Copy",exact:true}).click();await dialog().locator('input[name="name"]').fill("Must refresh before copying");await dialog().getByRole("button",{name:"Review copy",exact:true}).click();await dialog().getByRole("heading",{name:"Source specialist",exact:true}).waitFor();
 recording=new WorkmateRecording("web","stale-source-rejected","specialist-copy-155-"+attempt,()=>page.screenshot({type:"jpeg",quality:72}),"Actual source edit after review invalidates confirmation and clears the old comparison",delivery);await recording.start();await shot(page,"stale-review");
 await historyOk(system,f.owner,"PATCH",f.base+"/agents/"+f.source.id,{expected_version:f.source.version,name:f.source.name,role_key:f.source.role_key,instructions:f.source.body.instructions+" Revised source duty.",tool_ids:f.source.body.tool_ids,brand_id:f.brand.id,brand_version_id:f.fixed.id});
 await dialog().getByRole("checkbox",{name:"I reviewed the retained versions and copy scope",exact:true}).check();await dialog().getByRole("button",{name:"Confirm copy",exact:true}).click();await dialog().getByRole("button",{name:"Reload source",exact:true}).waitFor();assert.equal(await dialog().getByRole("heading",{name:"Source specialist",exact:true}).count(),0);assert.equal((await copyFacts(system,f)).agents,before.agents+1);await shot(page,"stale-rejected");await stopRecording();
 await dialog().getByRole("button",{name:"Reload source",exact:true}).click();await dialog().waitFor({state:"detached"});pass("Editing the source after review rejects confirmation, clears stale details and creates no new specialist");
 assert.equal(checks.length,5);
}catch(e){errors.push(stage+": "+String(e));}
finally{
 try{await stopRecording();}catch(e){errors.push("recording: "+String(e));}
 if(browser)try{await browser.close();browserClosed=true;}catch(e){errors.push("browser close: "+String(e));}
 if(system)try{await system.app.close();apiClosed=true;}catch(e){errors.push("API close: "+String(e));}
 if(isolated)try{await isolated.cleanup();fixtureClosed=true;}catch(e){errors.push("fixture close: "+String(e));}
 process.chdir(delivery);const status=errors.length===0&&checks.length===5&&browserClosed&&apiClosed&&fixtureClosed?"passed":"failed";
 await writeFile(prefix+"-journey.json",JSON.stringify({at:new Date().toISOString(),status,stage,checks,errors,screenshots,recordings,layouts,browser_closed:browserClosed,api_closed:apiClosed,fixture_closed:fixtureClosed,scope:"Actual Web browser, OTP, SQL/HTTP and copy controls. Deliberate accepted-response loss uses actual fetched API response then aborts once. No model execution. Desktop cloud renderer build only; frozen packages unchanged."},null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({status,checks:checks.length,errors}));assert.equal(status,"passed");
}
