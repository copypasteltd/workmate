import assert from "node:assert/strict";
import { _electron, chromium, type ElectronApplication, type Browser } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";
const delivery=process.cwd(),platform=path.resolve("../copypaste-platform"),attempt=process.argv[2];assert.match(attempt??"",/^\d{2}$/);
const prefix=path.join(delivery,"evidence/desktop-geo-ui-"+attempt),owned=path.resolve(".data/desktop-geo-ui",randomUUID()),workspace=path.join(owned,"fixture");
const checks:string[]=[],errors:string[]=[],screenshots:any[]=[];
let isolated:any,system:any,electron:ElectronApplication|undefined,browser:Browser|undefined,recording:WorkmateRecording|undefined,media:any;
let providerCalls=0,providerError:unknown,electronClosed=false,browserClosed=false,apiClosed=false,fixtureClosed=false,providerClosed=false;
let nativeTasks:any[]=[],runIds:string[]=[],exports:any[]=[],gatewayRejections:any[]=[];
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const response=await originalFetch(input,init),url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url);
 if(url.hostname==="127.0.0.1"&&/^\/run\/[^/]+\/v1\/responses$/.test(url.pathname)&&response.status>=400){
  const body=await response.clone().json().catch(()=>({}));gatewayRejections.push({status:response.status,code:body.error?.code??"UNKNOWN_GATEWAY_REJECTION"});
 }
 return response;
};
const pass=(s:string)=>{checks.push(s);console.log("PASS: "+s);};
const provider=createServer(async(req,res)=>{
 try{
  const chunks=[];for await(const c of req)chunks.push(Buffer.from(c));const b=JSON.parse(Buffer.concat(chunks).toString());
  assert.equal(req.headers.authorization,"Bearer native-geo-ui-fixture");assert.equal(b.model,"native-geo-ui-fixture");assert.deepEqual(b.tools,[],"The company provider sees no native or control tools");
  if(req.url==="/v1/responses/input_tokens"){res.writeHead(200,{"Content-Type":"application/json"}).end(JSON.stringify({object:"response.input_tokens",input_tokens:10}));return;}
  assert.equal(req.url,"/v1/responses");const index=providerCalls++;assert.ok(index<4);
  const input=JSON.stringify(b.input);assert.ok(!input.includes("Harbour Studio"),"Tracked brand aliases must not prime the fixed question");
  if(index%2===1)assert.ok(!input.includes("UNIQUE_FIRST_GEO_ANSWER_110"),"A new native question cannot inherit the previous answer");
  const text=index%2===0?"Harbour Studio is one possible design partner. UNIQUE_FIRST_GEO_ANSWER_110. Synthetic observation, not a live ranking.":"Compare experience, costs and delivery evidence. Harbour Studio is a synthetic example. Independent question answer.";
  const item={type:"message",id:"msg_geo_ui_"+index,role:"assistant",status:"completed",content:[{type:"output_text",text,annotations:[]}]};
  res.writeHead(200,{"Content-Type":"text/event-stream"});const emit=(type:string,v:any)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...v})}\n\n`);
  const response={id:"resp_geo_ui_"+index,object:"response",status:"in_progress",output:[]};
  emit("response.created",{response});emit("response.output_item.added",{output_index:0,item:{...item,status:"in_progress",content:[]}});
  emit("response.output_text.delta",{output_index:0,item_id:item.id,content_index:0,delta:text});emit("response.output_text.done",{output_index:0,item_id:item.id,content_index:0,text});
  emit("response.output_item.done",{output_index:0,item});emit("response.completed",{response:{...response,status:"completed",output:[item],usage:{input_tokens:10,output_tokens:20,total_tokens:30}}});res.end();
 }catch(e){providerError=e;if(!res.headersSent)res.writeHead(502);res.end();}
});
async function until(read:()=>Promise<any>,accept:(v:any)=>boolean,label:string,ms=60000):Promise<any>{
  const end=Date.now()+ms;while(Date.now()<end){const v=await read();if(accept(v))return v;await new Promise(r=>setTimeout(r,250));}throw new Error("Timed out: "+label);
}
const load=(f:string)=>import(pathToFileURL(path.join(platform,f)).href);
await mkdir(workspace,{recursive:true});
try{
  await new Promise<void>(r=>provider.listen(0,"127.0.0.1",r));
  const [{isolatedTestEnvironment},{buildApp},{loadConfig},{defaults}]=await Promise.all([load("tests/native-test-environment.ts"),load("src/server.ts"),load("src/config.ts"),load("src/plans.ts")]);
  process.chdir(platform);isolated=await isolatedTestEnvironment();
  system=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEV_MAILBOX:"true",WORKER_ENABLED:"false",DEMO_MODE:"false",
    AI_BASE_URL:`http://127.0.0.1:${(provider.address() as any).port}/v1`,AI_ALLOWED_HOSTS:"127.0.0.1",AI_API_KEY:"native-geo-ui-fixture",AI_MODEL:"native-geo-ui-fixture",AI_VERIFIED:"true",
    AI_INPUT_HKD_MICROS_PER_MILLION:"1000000",AI_OUTPUT_HKD_MICROS_PER_MILLION:"1000000",AI_INPUT_COUNT_VERIFIED:"true",AI_INPUT_COUNT_HKD_MICROS_PER_CALL:"0",AI_SCOPE_TTL_MS:"300000"}),{worker:false});
  await system.app.listen({host:"127.0.0.1",port:4310});
  electron=await _electron.launch({executablePath:process.env.COPYPASTE_LOCAL_DESKTOP_CANDIDATE!,env:{...process.env,COPYPASTE_USER_DATA:path.join(owned,"user-data")}});
  const page=await electron.firstWindow();page.setDefaultTimeout(25000);page.on("pageerror",e=>errors.push(e.message));
  await page.waitForURL(/^file:/);await page.waitForFunction(()=>!!(window as any).copyPasteBridge);
  await page.evaluate(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});await page.reload();
  await electron.evaluate(({shell,dialog},folder)=>{
    const state=globalThis as any;state.__methodDialogs=[];state.__externalURLs=[];state.__folderRequests=0;
    shell.openExternal=async(url:string)=>{state.__authURL=url;state.__externalURLs.push(url);};
    dialog.showOpenDialog=async()=>{state.__folderRequests++;throw new Error("GEO must not request a customer folder");};
    dialog.showMessageBox=async(...args:any[])=>{state.__methodDialogs.push(args.at(-1));return {response:1,checkboxChecked:false};};
  },workspace);
  browser=await chromium.launch({executablePath:process.env.CHROME_BIN!,headless:true});const context=await browser.newContext();
  await page.getByRole("button",{name:"Sign in securely in your browser"}).click();
  const url=await until(()=>electron!.evaluate(()=>(globalThis as any).__authURL??""),Boolean,"native PKCE URL");
  const auth=await context.newPage();await auth.addInitScript(()=>localStorage.setItem("cp_locale","en"));await auth.goto(url);
  await auth.locator('input[name="email"]').fill(`native-geo-${randomUUID()}@example.invalid`);
  const [challenge]=await Promise.all([auth.waitForResponse(r=>new URL(r.url()).pathname==="/v1/auth/challenges"),auth.locator('form button[type="submit"]').click()]);
  const mail=JSON.parse(await readFile(path.join(isolated.directory,"mailbox",(await challenge.json()).challenge_id+".json"),"utf8"));
  await auth.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);await auth.locator('form button[type="submit"]').click();
  await auth.getByRole("link",{name:/Authorize & return|授權並返回應用/}).click();
  await until(()=>page.evaluate(async()=>(await (window as any).copyPasteBridge.request("/v1/session/context",{})).status),v=>v===200,"native session");
  await browser.close();browser=undefined;browserClosed=true;
  await page.locator('input[name="name"]').fill("Native GEO studio");await page.locator('input[name="project_name"]').fill("Native GEO observation");
  await page.getByRole("button",{name:"Create workspace & continue",exact:true}).click();
  const current=await until(()=>page.evaluate(async()=>(await (window as any).copyPasteBridge.request("/v1/session/context",{})).body),v=>v.memberships?.length===1,"actual onboarding");
  const tenant=current.memberships[0].id;
  const request=async(url:string,method="GET",body?:any)=>page.evaluate(async args=>{
    const r=await (window as any).copyPasteBridge.request(args.url,{method:args.method,tenantId:args.tenant,idempotencyKey:crypto.randomUUID(),...(args.body===undefined?{}:{body:args.body})});
    if(r.status<200||r.status>=300)throw new Error(JSON.stringify(r));return r.body;
  },{url,method,body,tenant});
  const project=(await request(`/v1/tenants/${tenant}/projects`)).items[0].id;
  // Synthetic test entitlement and credit are not customer payment evidence.
  await system.db.control.query("UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1",[tenant]);
  await system.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Synthetic isolated native GEO QA; no payment received',$2)",[tenant,defaults.business]);
  pass("Actual browser email sign-in, PKCE return, native login and customer onboarding");
  const base=`/v1/tenants/${tenant}/projects/${project}`;
  const agent=await request(base+"/agents","POST",{name:"Independent brand observer",role_key:"assistant",instructions:"Answer the one fixed question independently. No retrieval or tools.",tool_ids:[],brand_id:null});
  await page.evaluate(()=>{location.hash="/app/analytics";});
  const externalCount=await electron.evaluate(()=>(globalThis as any).__externalURLs.length);
  await page.getByRole("button",{name:"Local GEO observations",exact:true}).click();
  await page.getByRole("heading",{name:"Local GEO observations",exact:true}).waitFor();
  await page.getByRole("button",{name:"New question set",exact:true}).click();
  const exp=page.getByRole("dialog");
  await exp.getByLabel("Question set name",{exact:true}).fill("Hong Kong enterprise questions");
  await exp.getByLabel("Pinned Agent",{exact:true}).selectOption(agent.id);
  await exp.getByLabel("Requested region",{exact:true}).fill("Hong Kong");await exp.getByLabel("Answer language",{exact:true}).fill("English");
  await exp.locator('textarea[name="questions"]').fill("Which Hong Kong design teams could support an enterprise launch?\nHow should an enterprise select its software partner?");
  await exp.locator('textarea[name="brands"]').fill("Harbour Studio | Harbour Studio");
  await exp.getByRole("button",{name:"Save immutable configuration",exact:true}).click();await exp.waitFor({state:"hidden"});
  pass("Desktop opens a native GEO page and saves a private immutable question set through the actual form");
  let captureTail=Promise.resolve();const capture=()=>{const next=captureTail.then(async()=>Buffer.from(await electron!.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64")),"base64"));captureTail=next.then(()=>{},()=>{});return next;};
  const snapshot=async()=>{
    await page.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
    return page.screenshot({caret:"hide"});
  };
  recording=new WorkmateRecording("desktop","native-geo",attempt,capture,"Actual unsigned packaged Desktop, actual local Codex, synthetic company Responses and bounded native-dialog fixture responses",delivery);await recording.start();
  async function prepare(name:string,budget="0.1"){
    await page.getByRole("button",{name:"Prepare local observation",exact:true}).click();const form=page.getByRole("dialog");
    await form.locator('input[name="name"]').fill(name);await form.getByLabel("Per-question budget (HKD)",{exact:true}).fill(budget);await form.getByRole("checkbox").check();
    await form.getByRole("button",{name:"Confirm and prepare local observation",exact:true}).click();await form.waitFor({state:"hidden"});
    await page.locator(".native-geo-question").first().waitFor();
    const rows=await system.db.control.query("SELECT id FROM geo_runs WHERE tenant_id=$1 AND name=$2",[tenant,name]);assert.equal(rows.rows.length,1);runIds.push(rows.rows[0].id);return rows.rows[0].id;
  }
  const first=await prepare("Local observation A");assert.equal(providerCalls,0);
  const dialogs=await electron.evaluate(()=>(globalThis as any).__methodDialogs);assert.equal(dialogs.length,1);assert.ok(dialogs[0].detail.includes("0.200000 HKD"));
  const prepared=await page.evaluate(async args=>(await (window as any).copyPasteBridge.localAgent("geo.list",args)).value.sessions,{tenant,project});
  assert.equal(prepared.length,2);assert.ok(prepared.every((r:any)=>r.permission==="read-only"&&r.phase==="starting"));
  await page.locator(".native-geo").scrollIntoViewIfNeeded();
  screenshots.push(await saveWorkmateScreenshot("desktop","native-geo-"+attempt,"prepared-en",await snapshot(),"Actual native GEO batch: two isolated read-only questions, native confirmation and exact reservation before model dispatch",delivery));
  pass("The native review confirms the exact total and prepares two fresh local read-only sessions without a model call");
  async function run(id:string){
    await page.getByRole("button",{name:"Run remaining questions",exact:true}).click();
    await until(()=>system.db.control.query("SELECT s.asset_version_id,t.status,t.charged_micros FROM geo_samples s JOIN tasks t ON t.id=s.task_id WHERE s.run_id=$1",[id]).then((r:any)=>r.rows),rows=>{
      if(rows.some((r:any)=>["failed","reconciling","cancelled"].includes(r.status)))throw new Error("Native observation did not succeed: "+JSON.stringify({tasks:rows,gateway_rejections:gatewayRejections}));
      return rows.filter((r:any)=>r.asset_version_id).length===2;
    },"two actual local answers and immutable captures",120000);
    const answer=await request(base+"/geo/runs/"+id+"/export");assert.equal(answer.progress.captured,2);assert.equal(answer.effective_config.execution_location,"desktop");
    assert.ok(answer.samples.every((s:any)=>s.confirmed_cost_micros==="30"&&s.answer_sha256===createHash("sha256").update(s.answer).digest("hex")));exports.push(answer);
    await page.getByText("2 / 2 answers captured",{exact:false}).waitFor();return answer;
  }
  await run(first);assert.equal(providerCalls,2);assert.equal(providerError,undefined);
  await page.getByRole("button",{name:"View original answer",exact:true}).first().click();
  await page.getByRole("dialog").getByText(/UNIQUE_FIRST_GEO_ANSWER_110/).waitFor();
  await page.getByRole("dialog").getByText("Local Codex answer reported by this client; costs follow company receipts",{exact:true}).waitFor();
  screenshots.push(await saveWorkmateScreenshot("desktop","native-geo-"+attempt,"original-answer-en",await snapshot(),"Original native-client-reported answer with exact SHA-256 and company financial receipt",delivery));
  await page.getByRole("dialog").getByRole("button",{name:/Close|關閉/}).click();
  await page.getByRole("button",{name:"Use as comparison A",exact:true}).click();
  pass("Two actual local Codex processes use the company gateway without tools, settle from receipts and retain original answers");
  const second=await prepare("Local observation B");await run(second);
  await page.getByRole("button",{name:"Use as comparison B",exact:true}).click();
  await page.getByRole("heading",{name:"Repeat observation with the same configuration",exact:true}).scrollIntoViewIfNeeded();
  assert.notEqual(first,second);assert.equal(exports[0].config_hash,exports[1].config_hash);
  screenshots.push(await saveWorkmateScreenshot("desktop","native-geo-"+attempt,"comparison-en",await snapshot(),"Actual independent native repeat observations preserve distinct runs and compare the same frozen configuration",delivery));
  pass("Repeat observation creates a separate native run, fresh threads and a same-configuration comparison without overwriting history");
  const third=await prepare("Stop before native inference");await page.getByRole("button",{name:"Stop this run",exact:true}).click();
  await until(()=>system.db.control.query("SELECT count(*)::int n FROM tasks t JOIN geo_samples s ON s.task_id=t.id WHERE s.run_id=$1 AND t.status='cancelled'",[third]).then((r:any)=>r.rows[0].n),v=>v===2,"native cancellation before dispatch");
  assert.equal(providerCalls,4);pass("Stopping both prepared questions releases their original holds without another model call");
  const low=await prepare("Insufficient reservation stays uncharged","0.01");
  await page.getByRole("button",{name:"Run remaining questions",exact:true}).click();
  await until(()=>system.db.control.query("SELECT t.status,t.charged_micros FROM tasks t JOIN geo_samples s ON s.task_id=t.id WHERE s.run_id=$1",[low]).then((r:any)=>r.rows),rows=>rows.some((r:any)=>r.status==="failed"&&r.charged_micros==="0"),"budget admission fails before model generation");
  await page.getByText("No answer was captured. Review the task receipt, budget and model settings, then create a new observation.",{exact:true}).scrollIntoViewIfNeeded();
  assert.equal(providerCalls,4);assert.ok(gatewayRejections.some(r=>r.code==="AI_REQUEST_BUDGET_EXHAUSTED"));
  screenshots.push(await saveWorkmateScreenshot("desktop","native-geo-"+attempt,"budget-recovery-en",await snapshot(),"Insufficient native question budget is rejected before model generation, retains a zero-charge receipt and shows the customer's next step",delivery));
  await page.getByRole("button",{name:"Stop this run",exact:true}).click();
  await until(()=>system.db.control.query("SELECT count(*)::int n FROM tasks t JOIN geo_samples s ON s.task_id=t.id WHERE s.run_id=$1 AND t.status='cancelled' AND t.charged_micros=0",[low]).then((r:any)=>r.rows[0].n),v=>v===1,"release the unstarted question after the insufficient-budget result");
  pass("Insufficient budget is rejected before generation, stays uncharged and offers a new observation without replaying the failed question");
  nativeTasks=(await system.db.control.query("SELECT t.id,t.execution_location,t.status,t.charged_micros,d.client_report FROM tasks t JOIN desktop_executions d ON d.task_id=t.id WHERE t.tenant_id=$1 ORDER BY t.created_at,t.id",[tenant])).rows;
  assert.equal(nativeTasks.length,8);assert.ok(nativeTasks.every(t=>t.execution_location==="desktop"));
  assert.equal(new Set(nativeTasks.filter(t=>t.status==="succeeded").map(t=>t.client_report.thread_id)).size,4);
  assert.equal((await system.db.control.query("SELECT count(*)::int n FROM tasks WHERE tenant_id=$1 AND execution_location='cloud'",[tenant])).rows[0].n,0);
  assert.equal(await electron.evaluate(()=>(globalThis as any).__externalURLs.length),externalCount);assert.equal(await electron.evaluate(()=>(globalThis as any).__folderRequests),0);
  await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(800,600));
  await until(()=>page.evaluate(()=>[innerWidth,innerHeight]),v=>v[0]===800&&v[1]===600,"native compact window");
  await page.evaluate(()=>{localStorage.setItem("cp_locale","zh-HK");localStorage.setItem("cp_theme","dark");});await page.reload();await page.locator(".geo-workspace").waitFor();
  await page.locator(".native-geo-question").nth(1).waitFor();
  await page.getByRole("button",{name:"下載原始觀測",exact:true}).waitFor();
  const main=page.locator("#root"),box=await main.boundingBox();assert.ok(box);
  await main.evaluate(e=>{e.scrollTop=0;});
  await page.mouse.move(box.x+box.width/2,box.y+Math.min(100,box.height/2));await page.mouse.wheel(0,650);
  await until(()=>main.evaluate(e=>e.scrollTop),v=>v>0,"actual wheel scrolling with hidden rails",10000);
  await main.evaluate(e=>{e.scrollTop=0;});await main.focus();await page.keyboard.press("End");
  await until(()=>main.evaluate(e=>e.scrollTop),v=>v>0,"actual keyboard scrolling with hidden rails",10000);
  await page.keyboard.press("Home");await until(()=>main.evaluate(e=>e.scrollTop),v=>v<2,"keyboard returns to the first native content",10000);
  await page.locator(".native-geo").scrollIntoViewIfNeeded();
  const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth||document.body.scrollWidth>innerWidth||Array.from(document.querySelectorAll("#root,.geo-workspace,.geo-section,.native-geo")).some(e=>e.scrollWidth>e.clientWidth+2),rails:Array.from(document.querySelectorAll("#root,.sidebar,.geo-workspace")).every(e=>getComputedStyle(e).scrollbarWidth==="none")}));
  assert.equal(layout.overflow,false);assert.equal(layout.rails,true);
  screenshots.push(await saveWorkmateScreenshot("desktop","native-geo-"+attempt,"compact-zh-dark",await snapshot(),"Actual 800x600 Chinese dark native GEO page with no visible scrollbar rails or horizontal overflow",delivery));
  pass("The 800x600 Chinese dark layout retains keyboard and wheel scrolling with hidden rails and no horizontal overflow");
  const appearance=await electron.evaluate(({BrowserWindow,Menu})=>({menu:Menu.getApplicationMenu()===null,menuBar:BrowserWindow.getAllWindows()[0].isMenuBarVisible(),url:BrowserWindow.getAllWindows()[0].webContents.getURL()}));
  assert.equal(appearance.menu,true);assert.equal(appearance.menuBar,false);assert.ok(appearance.url.startsWith("file:"));
  assert.equal(providerError,undefined);media=await recording.stop();recording=undefined;assert.ok(media.distinct_frames>1&&media.skipped_capture_errors===0);
  pass("The actual packaged renderer remains frameless and menu-free; GEO opens no external browser or local file picker");
}catch(e){errors.push(String(e));console.error(e);
 if(system)nativeTasks=(await system.db.control.query("SELECT t.id,t.execution_location,t.status,t.charged_micros,d.client_report FROM tasks t JOIN desktop_executions d ON d.task_id=t.id ORDER BY t.created_at,t.id").catch(()=>({rows:[]}))).rows;
}
finally{
 if(recording)try{media=await recording.stop();}catch(e){errors.push(String(e));}
 if(electron)await electron.close().then(()=>{electronClosed=true;}).catch(e=>errors.push(String(e)));
 if(browser)await browser.close().then(()=>{browserClosed=true;}).catch(e=>errors.push(String(e)));
 if(system)await system.app.close().then(()=>{apiClosed=true;}).catch((e:any)=>errors.push(String(e)));
 if(isolated)await isolated.cleanup().then(()=>{fixtureClosed=true;}).catch((e:any)=>errors.push(String(e)));
 provider.closeAllConnections();await new Promise<void>(r=>provider.close(()=>{providerClosed=true;r();}));
 globalThis.fetch=originalFetch;
 const report={gateway_rejections:gatewayRejections,provider_error:providerError?String(providerError):null,at:new Date().toISOString(),status:errors.length?"failed":"passed",checks,errors,screenshots,media,provider_calls:providerCalls,native_tasks:nativeTasks,run_ids:runIds,exports,electron_closed:electronClosed,browser_closed:browserClosed,api_closed:apiClosed,fixture_closed:fixtureClosed,provider_closed:providerClosed,
 not_validated:["human_native_dialog_clicks","live_company_model","real_payment","signed_production_installer","entire_product_acceptance"]};
 await writeFile(prefix+"-journey.json",JSON.stringify(report,null,2)+"\n",{flag:"wx"});assert.equal(errors.length,0,errors.join("\n"));
}
