import assert from "node:assert/strict";
import {chromium,type Browser,type Page} from "playwright";
import {readFile,writeFile} from "node:fs/promises";
import {randomUUID,createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import path from "node:path";
import {WorkmateRecording,saveWorkmateScreenshot} from "./record-workmate-media.js";
const delivery=process.cwd(),platform=path.resolve("../copypaste-platform"),attempt=process.argv[2];assert.match(attempt??"",/^\d{2}$/);
const prefix=path.join(delivery,`evidence/workflow-handoff-145/ui-${attempt}`),checks:string[]=[],errors:string[]=[],screenshots:any[]=[],recordings:any[]=[],layouts:any[]=[],downloads:any[]=[];
const load=(file:string)=>import(pathToFileURL(path.join(platform,file)).href);
let fixtureModule:any,system:any,browser:Browser|undefined,recording:WorkmateRecording|undefined,stage="setup",browserClosed=false,apiClosed=false,fixtureClosed=false;
const pass=(name:string)=>{checks.push(name);console.log("PASS: "+name);};
const digest=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
async function shot(page:Page,name:string,caption:string){screenshots.push(await saveWorkmateScreenshot("web",`workflow-handoff-145-${attempt}`,name,await page.screenshot(),caption,delivery));}
async function stopRecording(){if(recording){const owned=recording;recording=undefined;recordings.push(await owned.stop());}}
try{
  fixtureModule=await load("tests/workflow-handoff-fixture-145-v1.ts");
  const [{Worker},runtime,{advanceCloudWorkflows}]=await Promise.all([load("src/worker.ts"),load("src/runtime.ts"),load("src/cloud-workflows.ts")]);
  process.chdir(platform);await fixtureModule.startFixture({API_ORIGIN:"http://localhost:4310",WEB_ORIGIN:"http://localhost:4317"});system=fixtureModule.s;
  await system.app.listen({host:"127.0.0.1",port:4310});const f=await fixtureModule.fixture();
  const step=(prompt:string,extra={})=>({kind:"codex",role_key:"assistant",prompt,budget_micros:100000,...extra});
  const text="Actual private workflow handoff; explicitly synthetic model output.\n"+"完整跨模組成果🌟\n".repeat(3200)+"EXACT_CUSTOMER_DOWNLOAD_END_145";
  async function tick(){await advanceCloudWorkflows(system.db,system.catalog,system.storage);}
  async function runs(){return (await fixtureModule.listRuns(f)).runs;}
  async function getRun(id:string){return (await runs()).find((r:any)=>r.id===id);}
  async function prepare(definition:any){const p=await fixtureModule.prepareWorkflow(f,definition);return p.request.run.id;}
  async function execute(id:string,output:string,fail=false){
    const r=await getRun(id);assert.ok(r.active_task);
    class ControlledRuntime extends runtime.CodexRuntimeAdapter{
      override async start(ctx:any){if(fail)throw new runtime.RuntimeFailure("RUNTIME_UNAVAILABLE",false,true);
        if(ctx.tools.some((t:any)=>t.name==="workflow_inputs")){
          const reader=ctx.tools.find((t:any)=>t.name==="workflow_inputs"),manifest=await reader.run({},randomUUID()),file=manifest.items[0].files[0];let received="",offset=0;
          for(let p=0;p<100;p++){const page=await reader.run({asset_version_id:file.asset_version_id,offset,max_characters:16000},randomUUID());received+=page.text;if(page.next_offset===null)break;offset=page.next_offset;}
          assert.equal(received,text);
        }
        return {status:"completed",text:output,inputTokens:20,outputTokens:10,usageKnown:true,accepted:true,thread:"explicit-synthetic-workflow-145",turn:randomUUID()};}
    }
    await new Worker(system.db,system.catalog,system.storage,new ControlledRuntime(system.db.config)).run(f.tenant,r.active_task);
  }
  const first=await prepare({steps:[step("Prepare the campaign brief and complete reusable evidence.",{input_steps:[]}),step("Read the complete saved brief, then prepare the customer delivery.",{input_steps:[0]})]});
  browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await context.newPage();page.setDefaultTimeout(30000);page.on("pageerror",e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});
  const email=(await system.db.control.query("SELECT email FROM users WHERE id=$1",[f.owner.id])).rows[0].email;
  stage="actual customer email login";await page.goto("http://localhost:4317/login?next=%2Fapp%2Fworkflows");await page.locator('input[name="email"]').fill(email);
  const [challenge]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==="/v1/auth/challenges"),page.getByRole("button",{name:"Send sign-in code",exact:true}).click()]);
  const mail=JSON.parse(await readFile(path.join(system.db.config.DATA_DIR,"mailbox",(await challenge.json()).challenge_id+".json"),"utf8"));
  await page.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);await page.getByRole("button",{name:"Verify & continue",exact:true}).click();await page.locator(".private-cloud-workflows").waitFor();pass("Customer signs in through actual email OTP and opens their private workflows");
  const card=(id:string)=>page.locator(`article[data-workflow-run="${id}"]`),dialog=()=>page.getByRole("dialog");
  async function refresh(){await page.locator(".private-cloud-workflows").getByRole("button",{name:"Refresh",exact:true}).click();}
  async function decision(id:string,kind:"approve"|"cancel"="approve"){
    await card(id).getByRole("button",{name:kind==="cancel"?"Stop workflow":/Review & start|Review & continue/,exact:kind==="cancel"}).click();await dialog().waitFor();
    if(kind==="approve")await page.locator("#workflow-budget-confirmation").check();
    const response=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith(`/cloud-workflows/runs/${id}/decision`)&&r.request().method()==="POST");
    await dialog().getByRole("button",{name:kind==="cancel"?"Confirm stop":"Confirm & continue",exact:true}).click();assert.equal((await response).status(),200);await dialog().waitFor({state:"detached"});
  }
  stage="budget and exact inputs review";
  recording=new WorkmateRecording("web","exact-workflow-handoff",`workflow-handoff-145-${attempt}`,()=>page.screenshot({type:"jpeg",quality:72}),"Actual customer approval, exact predecessor download and completed workflow; explicitly synthetic model responses",delivery);await recording.start();
  await card(first).getByRole("button",{name:"Review & start",exact:true}).click();await dialog().waitFor();assert.match(await dialog().innerText(),/Uses outputs: 1/);assert.match(await dialog().innerText(),/Stop after failure/);
  await shot(page,"fixed-inputs-budget-en","Customer reviews exact predecessor selection, failure handling and the separate child budget");
  await page.locator("#workflow-budget-confirmation").check();await dialog().getByRole("button",{name:"Confirm & continue",exact:true}).click();await dialog().waitFor({state:"detached"});await tick();
  await execute(first,text);await tick();await execute(first,"Completed customer review based on the exact prior saved text.");await tick();assert.equal((await getRun(first)).state,"succeeded");await refresh();
  await card(first).locator(".private-workflow-receipts summary").click();await card(first).getByRole("button",{name:"Download workflow-step-1-result.txt",exact:true}).waitFor();
  const [download]=await Promise.all([page.waitForEvent("download"),card(first).getByRole("button",{name:"Download workflow-step-1-result.txt",exact:true}).click()]);
  const bytes=await readFile((await download.path())!);assert.equal(bytes.toString("utf8"),text);downloads.push({name:download.suggestedFilename(),bytes:bytes.length,sha256:digest(bytes),complete_original_text:true});pass("Customer approves fixed inputs and downloads the complete Unicode predecessor text beyond receipt-preview limits");
  await shot(page,"complete-deliverables-en","Completed customer workflow with exact original full-text deliverables and individual task receipts");await stopRecording();
  stage="settled failure and actual customer continuation";const second=await prepare({steps:[step("Attempt the planned first task.",{on_failure:"review"}),step("Prepare independent remaining customer work.",{input_steps:[]})]});await refresh();await decision(second);await tick();await execute(second,"",true);await tick();await refresh();
  recording=new WorkmateRecording("web","failed-step-customer-review",`workflow-handoff-145-${attempt}`,()=>page.screenshot({type:"jpeg",quality:72}),"Actual failed-step review, explicit continuation and retained final failure; no automatic paid retry",delivery);await recording.start();
  await card(second).getByText(/A step failed/).waitFor();await shot(page,"failed-step-waiting-en","Known settled failure waits for an explicit customer decision");
  await card(second).getByRole("button",{name:"Review & continue",exact:true}).click();await dialog().getByText(/You are approving a skip/).waitFor();await shot(page,"skip-failed-step-consent-en","Customer must explicitly approve a skip; charges and failure remain");
  await page.locator("#workflow-budget-confirmation").check();await dialog().getByRole("button",{name:"Confirm & continue",exact:true}).click();await dialog().waitFor({state:"detached"});await tick();await execute(second,"Independent remaining work completed after explicit customer review.");await tick();assert.equal((await getRun(second)).error_code,"WORKFLOW_COMPLETED_WITH_STEP_FAILURES");await refresh();await shot(page,"retained-failure-completion-en","Remaining independent work completes while the workflow retains its failure");await stopRecording();pass("A known failure waits for real customer approval and is never silently retried or relabelled as success");
  stage="stop before child fees";const third=await prepare({steps:[step("Do not start unless the customer confirms.")]});await refresh();await decision(third,"cancel");assert.equal((await getRun(third)).state,"cancelled");assert.equal((await system.db.control.query("SELECT count(*)::int n FROM tasks WHERE cloud_workflow_run_id=$1",[third])).rows[0].n,0);pass("Customer stops an unconfirmed workflow with no child task or child reservation");
  for(const width of [1440,960,390]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(120);const measurements=await page.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:innerWidth}));assert.ok(measurements.page<=width+1);layouts.push({width,...measurements});if(width===390)await shot(page,"workflow-mobile-en","Actual narrow customer workflow layout with no horizontal page overflow");}pass("Customer workflows fit 1440, 960 and 390-pixel widths without horizontal page overflow");
  assert.equal(await page.locator(".sidebar").evaluate(el=>getComputedStyle(el).visibility),"hidden");
  await page.locator(".app-topbar button.mobile-only").click();
  await page.waitForFunction(()=>{const el=document.querySelector(".sidebar")!;return getComputedStyle(el).visibility==="visible"&&el.getBoundingClientRect().left>=-1;});
  await shot(page,"mobile-navigation-en","Actual narrow navigation opens on request, then fully hides after closing");
  await page.getByRole("button",{name:"Close navigation",exact:true}).click();
  assert.equal(await page.locator(".sidebar").evaluate(el=>getComputedStyle(el).visibility),"hidden");
  assert.equal(await page.locator(".sidebar").getAttribute("aria-hidden"),"true");
  pass("Mobile navigation opens on request and closes completely without covering customer content");

  assert.deepEqual(errors,[]);pass("Actual customer page has no uncaught browser errors");
}catch(e){errors.push(`${stage}: ${String(e)}`);}
finally{
  try{await stopRecording();}catch(e){errors.push("recording cleanup: "+String(e));}
  if(browser){try{await browser.close();browserClosed=true;}catch(e){errors.push("browser cleanup: "+String(e));}}
  if(system){try{await fixtureModule.stopFixture();apiClosed=true;fixtureClosed=true;}catch(e){errors.push("owned fixture cleanup: "+String(e));}}
  await writeFile(prefix+"-journey.json",JSON.stringify({status:errors.length?"failed":"passed",stage,checks,errors,screenshots,recordings,layouts,downloads,browser_closed:browserClosed,api_closed:apiClosed,fixture_closed:fixtureClosed,
    scope:"Actual Web customer login, reviewed controls and downloads with explicitly synthetic controlled model responses. Model/task preparation uses actual company services through fixtures. Not native Codex/OS or paid provider acceptance."},null,2)+"\n",{flag:"wx"});
}
assert.deepEqual(errors,[],"Preserve the original failed journey and its exact source");
