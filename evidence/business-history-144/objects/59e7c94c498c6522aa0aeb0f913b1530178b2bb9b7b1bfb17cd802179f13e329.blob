import assert from "node:assert/strict";
import {chromium, type Browser, type Page} from "playwright";
import {readFile, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import path from "node:path";
import {WorkmateRecording,saveWorkmateScreenshot} from "./record-workmate-media.js";

const delivery=process.cwd(),platform=path.resolve("../copypaste-platform"),attempt=process.argv[2];assert.match(attempt??"",/^\d{2}$/);
const prefix=path.join(delivery,`evidence/business-history-144/ui-${attempt}`),checks:string[]=[],errors:string[]=[],screenshots:any[]=[],recordings:any[]=[],layouts:any[]=[];
const load=(file:string)=>import(pathToFileURL(path.join(platform,file)).href);
let system:any,isolated:any,browser:Browser|undefined,recording:WorkmateRecording|undefined,stage="setup",browserClosed=false,apiClosed=false,fixtureClosed=false,modelCalls=-1;
const pass=(name:string)=>{checks.push(name);console.log("PASS: "+name);};
async function shot(page:Page,name:string,caption:string){screenshots.push(await saveWorkmateScreenshot("admin",`business-history-144-${attempt}`,name,await page.screenshot(),caption,delivery));}
async function stopRecording(){if(recording){const owned=recording;recording=undefined;recordings.push(await owned.stop());}}
try{
  const [{isolatedTestEnvironment},{buildApp},{loadConfig},{businessHistoryFixture},helpers]=await Promise.all([
    load("tests/native-test-environment.ts"),load("src/server.ts"),load("src/config.ts"),load("tests/business-history-fixture-144-v3.ts"),load("tests/admin-history-fixture.ts")]);
  process.chdir(platform);isolated=await isolatedTestEnvironment();
  system=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEMO_MODE:"true",WORKER_ENABLED:"false",API_ORIGIN:"http://localhost:4310",WEB_ORIGIN:"http://localhost:4317",ADMIN_ORIGIN:"http://localhost:4318"}),{worker:false});
  await system.app.listen({host:"127.0.0.1",port:4310});
  const f=await businessHistoryFixture(system,105,false);
  const counts=async()=>(await system.db.control.query("SELECT (SELECT count(*) FROM tasks) tasks,(SELECT count(*) FROM reservations) reservations,(SELECT count(*) FROM ledger) ledger,(SELECT count(*) FROM current_ai_provider_requests) requests")).rows[0];
  const before=await counts();browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(30000);page.on("pageerror",e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});
  stage="actual administrator login";await page.goto("http://localhost:4318/login");await page.locator('input[name="email"]').fill(f.operator.email);
  const [challenge]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==="/v1/admin/auth/challenge"),page.locator('form button[type="submit"]').click()]);
  const mail=JSON.parse(await readFile(path.join(isolated.directory,"mailbox",(await challenge.json()).challenge_id+".json"),"utf8")),OTP=createRequire(path.join(platform,"package.json"))("otpauth");
  await page.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);await page.locator('input[name="totp"]').fill(new OTP.TOTP({secret:f.operator.secret,digits:6,period:30,algorithm:"SHA1"}).generate());
  await page.locator('form button[type="submit"]').click();await page.locator(".admin-shell").waitFor();pass("Actual email OTP and administrator TOTP admit a project-scoped reader");
  const dialog=()=>page.getByRole("dialog"),list=()=>page.locator(".conversation-history-messages > li");
  async function close(){await dialog().getByRole("button",{name:"Close",exact:true}).click();await dialog().waitFor({state:"detached"});}
  async function open(name:string){await page.goto("http://localhost:4318/content");await page.getByRole("row").filter({hasText:name}).getByRole("button",{name:"Read content",exact:true}).click();await page.locator(".conversation-history-messages").waitFor();}
  async function navigate(name:string){await dialog().getByRole("button",{name,exact:true}).click();await page.locator(".conversation-history-messages").waitFor();}
  const versions=()=>list().evaluateAll(nodes=>nodes.map(n=>Number(n.getAttribute("data-version"))));
  stage="ordinary campaign canvas history";await open(f.poster.name);
  recording=new WorkmateRecording("admin","business-version-navigation",`business-history-144-${attempt}`,()=>page.screenshot({type:"jpeg",quality:72}),"Actual canvas and brand history navigation beyond 100 saved customer versions",delivery);await recording.start();
  const all:number[]=[];for(;;){all.push(...await versions());if(await dialog().getByRole("button",{name:"Next",exact:true}).isDisabled())break;await navigate("Next");}
  assert.deepEqual(all,Array.from({length:105},(_,n)=>105-n));await navigate("Previous");await navigate("Oldest");
  await list().last().locator("summary").click();assert.ok((await list().last().textContent())!.includes("Saved campaign version 1"));
  await shot(page,"canvas-oldest-en","Actual administrator opens original saved canvas version 1 after 105 customer saves");await close();
  pass("All 105 actual customer canvas versions, including original text, are reachable with reversible bounded pages");
  stage="brand history and provenance";await open(f.brand.name);assert.deepEqual(await versions(),Array.from({length:50},(_,n)=>105-n));
  await list().first().locator("summary").click();assert.ok((await list().first().textContent())!.includes("Approved voice version 105"));
  assert.ok((await list().first().textContent())!.includes("Customer version"));await shot(page,"brand-latest-en","Actual brand version body, customer provenance and SHA-256 digest");
  await navigate("Oldest");await list().last().locator("summary").click();assert.ok((await list().last().textContent())!.includes("Approved voice version 1"));await stopRecording();await close();
  pass("Brand history exposes the exact retained definition and original customer attribution beyond the former 100-version limit");
  stage="business modules and editable projects";
  for(const row of [f.group,f.config,f.schedule,f.video,...f.editable]){await open(row.name??"Campaign video history");assert.ok(await list().count()>0);await list().first().locator("summary").click();assert.ok((await list().first().locator("pre").textContent())!.length>20);await close();}
  pass("Actual team, brief, automation schedule, video, vector and presentation rows all open their saved version records");
  stage="batch designs with equal version numbers";await open(f.matrix.name);
  const series=async()=>list().evaluateAll(nodes=>nodes.map(n=>n.getAttribute("data-series-id")+":"+n.getAttribute("data-version")));
  const matrixIds=await series();await navigate("Next");matrixIds.push(...await series());assert.equal(matrixIds.length,62);assert.equal(new Set(matrixIds).size,62);
  await navigate("Previous");await shot(page,"batch-series-en","Actual batch design reader distinguishes the same version number in different creative works");await close();
  pass("The actual batch reader preserves 62 distinct work/version identities across forward and backward pages");
  stage="live customer amendment";await open(f.poster.name);
  await helpers.historyOk(system,f.owner,"PUT",f.base+"/creative/"+f.poster.id,{name:f.poster.name,version:105,body:{...f.posterBody(106),layers:[{...f.posterBody(106).layers[0],text:'Customer amendment <img src=x onerror=window.historyUnsafe=1>'}]}});
  await dialog().getByRole("button",{name:"Next",exact:true}).click();await page.getByRole("alert").filter({hasText:"This content changed"}).waitFor();assert.equal(await list().count(),0);
  await navigate("Refresh");await list().first().locator("summary").click();assert.ok((await list().first().textContent())!.includes("<img src=x"));assert.equal(await page.locator(".conversation-history img").count(),0);assert.equal(await page.evaluate(()=>(window as any).historyUnsafe),undefined);await close();
  pass("A customer save invalidates old pagination and refreshed customer text stays inert");
  stage="withdrawn brand source clears an open design";
  const bound=await helpers.historyOk(system,f.owner,"POST",f.base+"/creative",{name:"Brand-dependent customer canvas",body:{...f.posterBody(1),brand:{id:f.brand.id,version:105,channel:"web",locale:"en-HK"}}});
  await open(bound.name);await list().first().locator("summary").click();
  recording=new WorkmateRecording("admin","business-access-withdrawal",`business-history-144-${attempt}`,()=>page.screenshot({type:"jpeg",quality:72}),"Actual brand withdrawal and project denial clear private saved-version bodies",delivery);await recording.start();
  await system.db.control.query("UPDATE brand_profiles SET content_state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",[f.brand.id]);
  await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await page.getByRole("alert").filter({hasText:"readable sources changed"}).waitFor();assert.equal(await list().count(),0);
  await navigate("Refresh");await page.getByText("The original sources are unavailable; this version body is not available.",{exact:true}).waitFor();assert.equal(await list().locator("pre").count(),0);await shot(page,"source-withdrawn-en","Actual brand-source withdrawal clears and redacts a previously opened canvas definition");await close();
  pass("Withdrawing a real brand source clears an already opened body and refreshed history redacts its exact dependent version");
  stage="responsive actual history layout";await open(f.editable[1].name);await list().first().locator("summary").click();
  for(const width of [1440,960,390]){await page.setViewportSize({width,height:1000});const layout=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));assert.ok(layout.width<=width+1,JSON.stringify(layout));layouts.push(layout);await shot(page,`layout-${width}-en`,"Actual saved presentation history at "+width+"px without horizontal page overflow");}
  await page.setViewportSize({width:1440,height:1000});await close();pass("Saved business versions remain readable at 1440, 960 and 390 pixels without horizontal page overflow");
  stage="project permission withdrawal";await open(f.group.name);
  await system.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,'project',$3,'deny')",[f.operator.id,f.operator.role,f.project]);
  await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await page.getByRole("alert").waitFor();assert.equal(await list().count(),0);await shot(page,"permission-withdrawn-en","Actual project denial clears the administrator's open team version history");await stopRecording();
  const persisted=await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]));for(const text of ["Approved voice version 105","Saved campaign version 1","Customer amendment"])assert.equal(persisted.includes(text),false);
  assert.deepEqual(await counts(),before);modelCalls=Number((await counts()).requests);assert.equal(modelCalls,0);
  pass("Live project denial clears private bodies, browser storage retains none, and reading creates no paid work");assert.equal(checks.length,9);
}catch(e){errors.push(stage+": "+String(e));}
finally{
  try{await stopRecording();}catch(e){errors.push("recording: "+String(e));}
  if(browser)try{await browser.close();browserClosed=true;}catch(e){errors.push("browser close: "+String(e));}
  if(system)try{await system.app.close();apiClosed=true;}catch(e){errors.push("API close: "+String(e));}
  if(isolated)try{await isolated.cleanup();fixtureClosed=true;}catch(e){errors.push("fixture close: "+String(e));}
  process.chdir(delivery);const status=errors.length===0&&checks.length===9&&browserClosed&&apiClosed&&fixtureClosed?"passed":"failed";
  await writeFile(prefix+"-journey.json",JSON.stringify({at:new Date().toISOString(),status,stage,checks,errors,screenshots,recordings,layouts,model_calls:modelCalls,browser_closed:browserClosed,api_closed:apiClosed,fixture_closed:fixtureClosed,
    scope:"Actual administrator browser, native PostgreSQL, actual OTP/TOTP and customer canvas/brand saves; batch histories use explicitly seeded SQL fixtures. No models execute. Not complete product or signed-client qualification."},null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({status,checks:checks.length,errors}));assert.equal(status,"passed");
}
