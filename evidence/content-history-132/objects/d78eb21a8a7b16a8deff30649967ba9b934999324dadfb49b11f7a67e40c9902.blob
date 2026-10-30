import assert from "node:assert/strict";
import {chromium, type Browser, type Page} from "playwright";
import {readFile, writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import path from "node:path";
import {WorkmateRecording, saveWorkmateScreenshot} from "./record-workmate-media.js";

const delivery=process.cwd(), platform=path.resolve("../copypaste-platform"), attempt=process.argv[2];
assert.match(attempt??"",/^\d{2}$/);
const prefix=path.join(delivery,`evidence/content-history-132/ui-${attempt}`), checks:string[]=[], errors:string[]=[], screenshots:any[]=[], recordings:any[]=[], layouts:any[]=[];
let system:any, isolated:any, browser:Browser|undefined, recording:WorkmateRecording|undefined,
  browserClosed=false, apiClosed=false, fixtureClosed=false, stage="setup", modelCalls=-1;
const load=(file:string)=>import(pathToFileURL(path.join(platform,file)).href);
const pass=(name:string)=>{checks.push(name);console.log("PASS: "+name);};
async function shot(page:Page,name:string,caption:string) {
  screenshots.push(await saveWorkmateScreenshot("admin",`content-history-132-${attempt}`,name,await page.screenshot(),caption,delivery));
}
async function stopRecording() {if(recording){const owned=recording;recording=undefined;recordings.push(await owned.stop());}}
let releaseLate:()=>void=()=>{};
try {
  const [{isolatedTestEnvironment},{buildApp},{loadConfig},fixtures]=await Promise.all([
    load("tests/native-test-environment.ts"),load("src/server.ts"),load("src/config.ts"),load("tests/admin-history-fixture.ts")]);
  process.chdir(platform);
  isolated=await isolatedTestEnvironment();
  system=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEMO_MODE:"true",WORKER_ENABLED:"false",
    API_ORIGIN:"http://localhost:4310",WEB_ORIGIN:"http://localhost:4317",ADMIN_ORIGIN:"http://localhost:4318"}),{worker:false});
  await system.app.listen({host:"127.0.0.1",port:4310});
  const f=await fixtures.historyFixture(system,{versions:205,notes:65,authenticateAdmin:false});
  await system.db.control.query("UPDATE admin_roles SET permissions=permissions || '[\"admin.content.version.create\"]'::jsonb WHERE key=$1",[f.operator.role]);
  await fixtures.historyOk(system,f.owner,"POST",f.base+`/conversations/${f.conversation.id}/messages`,{
    client_message_id:randomUUID(),expected_version:66,intent:"note",body:"Customer note 066 · <img src=x onerror=window.historyUnsafe=1> · "+"香港".repeat(120)});
  const counts=async()=>(await system.db.control.query(`SELECT (SELECT count(*) FROM tasks) AS tasks,
    (SELECT count(*) FROM reservations) AS reservations,(SELECT count(*) FROM ledger) AS ledger,
    (SELECT count(*) FROM current_ai_provider_requests) AS requests`)).rows[0];
  const originalCounts=await counts();
  browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  page.setDefaultTimeout(30000);page.on("pageerror",e=>errors.push(e.message));
  await page.addInitScript(()=>{if(!localStorage.getItem("cp_locale"))localStorage.setItem("cp_locale","en");if(!localStorage.getItem("cp_theme"))localStorage.setItem("cp_theme","light");});
  stage="real email and MFA login";
  await page.goto("http://localhost:4318/login");
  await page.locator('input[name="email"]').fill(f.operator.email);
  const [challenge]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==="/v1/admin/auth/challenge"),page.locator('form button[type="submit"]').click()]);
  const mail=JSON.parse(await readFile(path.join(isolated.directory,"mailbox",(await challenge.json()).challenge_id+".json"),"utf8"));
  const OTP=createRequire(path.join(platform,"package.json"))("otpauth");
  await page.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);
  await page.locator('input[name="totp"]').fill(new OTP.TOTP({secret:f.operator.secret,digits:6,period:30,algorithm:"SHA1"}).generate());
  await page.locator('form button[type="submit"]').click();await page.locator(".admin-shell").waitFor();
  pass("Actual email challenge and replay-protected MFA admit a scoped content administrator");
  const dialog=()=>page.getByRole("dialog"), list=()=>page.locator(".conversation-history-messages > li");
  async function close(){await dialog().getByRole("button",{name:"Close",exact:true}).click();await dialog().waitFor({state:"detached"});}
  async function open(name:string){await page.goto("http://localhost:4318/content");await page.getByRole("row").filter({hasText:name}).getByRole("button",{name:"Read content",exact:true}).click();await page.locator(".conversation-history-messages").waitFor();}
  async function navigate(name:RegExp){await dialog().getByRole("button",{name}).click();await page.locator(".conversation-history-messages").waitFor();}
  stage="actual message pagination and safe text rendering";
  await open(f.conversation.name);assert.equal(await list().count(),50);
  await shot(page,"messages-en","Actual scoped administrator reads customer messages in bounded original order");
  await navigate(/^Next$/);assert.equal(await list().count(),16);assert.ok((await list().last().textContent())!.includes("Customer note 066"));
  assert.equal(await page.evaluate(()=>(window as any).historyUnsafe),undefined);
  assert.equal(await page.locator(".conversation-history img").count(),0);
  await navigate(/^Previous$/);assert.equal(await list().count(),50);
  await navigate(/^Latest$/);assert.equal(await list().count(),50);
  assert.ok((await list().last().textContent())!.includes("Customer note 066"));
  pass("Actual 66-message customer history navigates in both directions and renders HTML as inert text");
  await close();
  stage="complete 205-version memory history";
  await open(f.memory.name);
  recording=new WorkmateRecording("admin","complete-version-navigation",`content-history-132-${attempt}`,()=>page.screenshot({type:"jpeg",quality:72}),"Actual 205 customer memory versions and bounded pagination",delivery);
  await recording.start();
  const versions:number[]=[];
  for(;;){versions.push(...await list().evaluateAll(nodes=>nodes.map(n=>Number(n.getAttribute("data-version")))));
    if(await dialog().getByRole("button",{name:"Next",exact:true}).isDisabled())break;await navigate(/^Next$/);}
  assert.deepEqual(versions,Array.from({length:205},(_,n)=>205-n));
  await shot(page,"oldest-memory-en","Actual administrator reaches memory version 1 beyond the original 200-version response");
  await navigate(/^Previous$/);await stopRecording();await close();
  await open(f.agent.name);assert.ok((await list().first().textContent())!.includes("Customer instructions version 205"));
  await navigate(/^Oldest$/);assert.ok((await list().last().textContent())!.includes("Customer instructions version 1"));
  pass("All 205 memory versions and original specialist version 1 are reachable with original customer provenance");
  await close();
  stage="actual administrator provenance";
  await page.getByRole("row").filter({hasText:f.memory.name}).getByRole("button",{name:"Revise",exact:true}).click();
  await page.getByLabel("Memory content",{exact:true}).fill("Administrator approved guidance version 206");
  await page.getByLabel("Reason for revision",{exact:true}).fill("Explicit synthetic administrator content correction");
  await page.getByRole("button",{name:"Preview changes",exact:true}).click();await page.locator(".revision-review").waitFor();
  await page.locator(".revision-consent input").check();await page.locator(".revision-review .button.primary").click();
  await page.locator(".revision-success").waitFor();await close();
  await open(f.memory.name);assert.ok((await list().first().textContent())!.includes("Administrator revision"));
  assert.ok((await list().first().textContent())!.includes("Administrator approved guidance version 206"));
  await shot(page,"administrator-provenance-en","Actual independently attributed administrator revision appears in version history");
  assert.deepEqual(await counts(),originalCounts);
  pass("A real signed administrator revision remains distinct from customer versions and creates no paid work");
  stage="live customer update invalidates old pagination";
  await fixtures.historyOk(system,f.owner,"PATCH",f.base+"/memories/"+f.memory.id,{expected_version:206,name:f.memory.name,content:"Customer amendment version 207",scope:"project",expires_at:null});
  await dialog().getByRole("button",{name:"Next",exact:true}).click();
  await page.getByRole("alert").filter({hasText:"This content changed"}).waitFor();assert.equal(await list().count(),0);
  await navigate(/^Refresh$/);assert.ok((await list().first().textContent())!.includes("Customer amendment version 207"));
  pass("A real customer update invalidates the old page and a fresh read returns the new customer version");
  await close();
  stage="late response after changing resources";
  let observed:()=>void=()=>{};const held=new Promise<void>(r=>{observed=r;}),release=new Promise<void>(r=>{releaseLate=r;});
  const delayed=new RegExp(`/v1/admin/content/agents/${f.agent.id}/history`);
  await page.route(delayed,async route=>{const response=await route.fetch();observed();await release;try{await route.fulfill({response});}catch(e){assert.match(String(e),/closed|canceled|cancelled|Invalid InterceptionId|already handled|Target/i);}});
  await page.getByRole("row").filter({hasText:f.agent.name}).getByRole("button",{name:"Read content",exact:true}).click();await held;
  await close();await open(f.memory.name);releaseLate();await page.unroute(delayed);
  await page.waitForTimeout(250);assert.ok((await list().first().textContent())!.includes("Customer amendment version 207"));
  assert.equal(await page.locator(".conversation-history").getByText("Customer instructions version 205",{exact:true}).count(),0);
  pass("An actual delayed specialist response cannot populate a different resource after the original reader closes");
  stage="responsive layout and Chinese reader";
  for(const width of [375,768,1440]){await page.setViewportSize({width,height:1000});await page.evaluate(()=>document.fonts.ready);
    const layout=await dialog().evaluate(node=>{const box=node.getBoundingClientRect();return{width:innerWidth,left:box.left,right:box.right,document_width:document.documentElement.scrollWidth,content_width:node.scrollWidth,client_width:node.clientWidth};});
    layouts.push(layout);assert.ok(layout.left>=-1&&layout.right<=width+1&&layout.document_width<=width+1&&layout.content_width<=layout.client_width+1);}
  await page.keyboard.press("Escape");await dialog().waitFor({state:"detached"});
  await page.evaluate(()=>localStorage.setItem("cp_locale","zh-HK"));await page.reload();await open(f.memory.name);
  await shot(page,"memory-history-zh","Actual Chinese version history uses the existing CopyPaste dashboard visual system");
  pass("Actual 375/768/1440 layouts, Escape closure and Traditional Chinese history controls pass");
  await close();await page.evaluate(()=>localStorage.setItem("cp_locale","en"));await page.reload();
  stage="source withdrawal while an assistant body is open";
  await fixtures.historyOk(system,f.owner,"POST",`/v1/tenants/${f.tenant}/demo-credit`,{});
  const source=await fixtures.historyOk(system,f.owner,"POST",f.base+"/conversations",{name:"Harbour source visibility review",agent_id:f.agent.id});
  const accepted=await fixtures.historyOk(system,f.owner,"POST",f.base+`/conversations/${source.id}/messages`,{client_message_id:randomUUID(),expected_version:1,intent:"delegate",body:"Explicit synthetic source visibility task",budget_micros:1000000});
  await system.db.control.query(`INSERT INTO conversation_messages(tenant_id,project_id,conversation_id,client_message_id,role,intent,body,task_id)
    VALUES($1,$2,$3,$4,'assistant','result','Protected synthetic assistant result',$5)`,[f.tenant,f.project,source.id,randomUUID(),accepted.task.id]);
  await open(source.name);assert.ok((await list().last().textContent())!.includes("Protected synthetic assistant result"));
  await system.db.control.query("UPDATE tasks SET content_state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",[accepted.task.id]);
  const beforeRead=await counts();
  await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
  await page.getByRole("alert").filter({hasText:"readable sources changed"}).waitFor();assert.equal(await list().count(),0);
  await navigate(/^Refresh$/);await page.getByText("The original sources are unavailable; this message body is not available.",{exact:true}).waitFor();
  pass("A real task quarantine clears the opened assistant body and its refreshed source is masked");
  await close();await open(f.memory.name);
  stage="live permission denial and private-state reclamation";
  recording=new WorkmateRecording("admin","permission-withdrawal",`content-history-132-${attempt}`,()=>page.screenshot({type:"jpeg",quality:72}),"Actual project denial clears an open private memory history",delivery);
  await recording.start();
  await system.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,'project',$3,'deny')",[f.operator.id,f.operator.role,f.project]);
  await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
  await page.getByRole("alert").waitFor();assert.equal(await list().count(),0);
  assert.equal(await page.getByText("Customer amendment version 207",{exact:true}).count(),0);
  await shot(page,"permission-withdrawn-en","Actual project denial removes private message and version bodies");
  await stopRecording();
  const persisted=await page.evaluate(()=>JSON.stringify([Object.entries(localStorage),Object.entries(sessionStorage)]));
  for(const privateText of ["Customer amendment version 207","Administrator approved guidance version 206","Protected synthetic assistant result"])
    assert.equal(persisted.includes(privateText),false);
  assert.deepEqual(await counts(),beforeRead);modelCalls=Number((await counts()).requests);
  pass("Live scope denial clears private history, no bodies persist in browser storage, and reads create no additional tasks or charges");
  assert.equal(checks.length,9);assert.equal(errors.length,0);assert.equal(modelCalls,0);
} catch(e) {errors.push(stage+": "+String(e));}
finally {
  releaseLate();
  try{await stopRecording();}catch(e){errors.push("recording: "+String(e));}
  if(browser)try{await browser.close();browserClosed=true;}catch(e){errors.push("browser close: "+String(e));}
  if(system)try{await system.app.close();apiClosed=true;}catch(e){errors.push("API close: "+String(e));}
  if(isolated)try{await isolated.cleanup();fixtureClosed=true;}catch(e){errors.push("fixture close: "+String(e));}
  process.chdir(delivery);
  const status=errors.length===0&&checks.length===9&&browserClosed&&apiClosed&&fixtureClosed?"passed":"failed";
  await writeFile(prefix+"-journey.json",JSON.stringify({at:new Date().toISOString(),status,stage,checks,errors,screenshots,recordings,layouts,
    model_calls:modelCalls,browser_closed:browserClosed,api_closed:apiClosed,fixture_closed:fixtureClosed,
    scope:"Actual native PostgreSQL and browser; customer 205-version and 66-message fixtures use real APIs. Retained assistant output is explicitly synthetic and no model executes. Not Desktop/Extension/full product qualification."},null,2)+"\n",{flag:"wx"});
  console.log(JSON.stringify({status,checks:checks.length,errors}));assert.equal(status,"passed");
}
