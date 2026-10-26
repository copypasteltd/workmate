import assert from "node:assert/strict";
import { _electron, chromium, type ElectronApplication, type Browser } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";

const delivery=process.cwd(), platform=path.resolve("../copypaste-platform"), attempt=process.argv[2];
assert.match(attempt??"",/^\d{2}$/);
const prefix=path.join(delivery,"evidence/preset-specialists-ui-"+attempt), owned=path.resolve(".data/preset-specialists",randomUUID()), workspace=path.join(owned,"workspace");
const checks:string[]=[], errors:string[]=[], screenshots:any[]=[];
let isolated:any,system:any,electron:ElectronApplication|undefined,browser:Browser|undefined,recording:WorkmateRecording|undefined,media:any;
let providerCalls=0,providerError:unknown,electronClosed=false,browserClosed=false,apiClosed=false,fixtureClosed=false;
let nativeTasks:any[]=[],savedAgents:any[]=[],brandVersions:any[]=[];
const pass=(s:string)=>{checks.push(s);console.log("PASS: "+s);};
const source="Synthetic customer-local input; preserved by the saved specialist.";
const outputs=[path.join(workspace,"saved-specialist.txt")];
const provider=createServer(async(req,res)=>{
  try{
    const chunks=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    assert.equal(req.headers.authorization,"Bearer preset-specialist-ui-fixture");
    const b=JSON.parse(Buffer.concat(chunks).toString());
    if(req.url==="/v1/responses/input_tokens"){res.writeHead(200,{"Content-Type":"application/json"}).end(JSON.stringify({object:"response.input_tokens",input_tokens:10}));return;}
    assert.equal(req.url,"/v1/responses");const index=providerCalls++;assert.ok(index<2);
    const serialized=JSON.stringify(b); assert.ok(serialized.includes("PRESET_BRAND_ORIGINAL_GUIDANCE"),"The exact fixed brand reaches the real local Codex company request");
    assert.ok(serialized.includes("SAVED_SPECIALIST_WORKING_GUIDANCE"),"Saved customer instructions reach the actual inference");
    assert.ok(!serialized.includes("PRESET_BRAND_LATER_GUIDANCE"),"Later brand guidance must not replace the pinned revision");
    let item:any;
    if(index%2===0){
      const tools=(b.tools??[]).flatMap((v:any)=>v.type==="namespace"?v.tools.map((x:any)=>({...x,name:v.name+"."+x.name})):[v]);
      const tool=tools.find((v:any)=>/(?:^|\.)(exec_command|shell|shell_command)$/.test(v.name));assert.ok(tool);
      const command=`$ErrorActionPreference='Stop'; $methodInput=[IO.File]::ReadAllText('${path.join(workspace,"input.txt").replaceAll("'","''")}'); [IO.File]::WriteAllText('${outputs[Math.floor(index/2)].replaceAll("'","''")}', $methodInput); Write-Output 'SAVED_SPECIALIST_ACTUAL_FILE_WRITTEN'`;
      const args=tool.parameters?.properties?.cmd?{cmd:command,workdir:workspace,yield_time_ms:1000,max_output_tokens:1000}
        :tool.parameters?.properties?.command?.type==="array"?{command:["powershell.exe","-NoProfile","-Command",command],workdir:workspace,timeout_ms:10000}:{command,workdir:workspace,timeout_ms:10000};
      item={type:"function_call",id:"fc_method_"+index,call_id:"call_method_"+index,name:tool.name,arguments:JSON.stringify(args)};
    }else{
      assert.ok(JSON.stringify(b.input).includes("SAVED_SPECIALIST_ACTUAL_FILE_WRITTEN"),"Require the actual native tool output before the final synthetic answer");
      item={type:"message",id:"msg_method_"+index,role:"assistant",status:"completed",content:[{type:"output_text",text:"Completed the approved saved specialist step. The local output contains the original customer input. This answer uses the authorized synthetic provider.",annotations:[]}]};
    }
    res.writeHead(200,{"Content-Type":"text/event-stream"});
    const emit=(type:string,value:any)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
    const response={id:"resp_method_"+index,object:"response",status:"in_progress",output:[]};
    emit("response.created",{response});emit("response.output_item.added",{output_index:0,item:item.type==="function_call"?{...item,arguments:""}:item});
    if(item.type==="function_call"){
      emit("response.function_call_arguments.delta",{output_index:0,item_id:item.id,delta:item.arguments});emit("response.function_call_arguments.done",{output_index:0,item_id:item.id,arguments:item.arguments});
    }else{emit("response.output_text.delta",{output_index:0,item_id:item.id,content_index:0,delta:item.content[0].text});emit("response.output_text.done",{output_index:0,item_id:item.id,content_index:0,text:item.content[0].text});}
    emit("response.output_item.done",{output_index:0,item});emit("response.completed",{response:{...response,status:"completed",output:[item],usage:{input_tokens:10,output_tokens:20,total_tokens:30}}});res.end();
  }catch(e){providerError=e;if(!res.headersSent)res.writeHead(502);res.end();}
});
async function until(read:()=>Promise<any>,accept:(v:any)=>boolean,label:string,ms=60000):Promise<any>{
  const end=Date.now()+ms;while(Date.now()<end){const v=await read();if(accept(v))return v;await new Promise(r=>setTimeout(r,250));}throw new Error("Timed out: "+label);
}
const load=(f:string)=>import(pathToFileURL(path.join(platform,f)).href);
await mkdir(workspace,{recursive:true});await writeFile(path.join(workspace,"input.txt"),source,{flag:"wx"});
try{
  await new Promise<void>(r=>provider.listen(0,"127.0.0.1",r));
  const [{isolatedTestEnvironment},{buildApp},{loadConfig},{defaults},{presetBrandDefinition}]=await Promise.all([load("tests/native-test-environment.ts"),load("src/server.ts"),load("src/config.ts"),load("src/plans.ts"),load("tests/preset-brand-fixture.ts")]);
  process.chdir(platform);isolated=await isolatedTestEnvironment();
  system=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEV_MAILBOX:"true",WORKER_ENABLED:"false",DEMO_MODE:"false",
    AI_BASE_URL:`http://127.0.0.1:${(provider.address() as any).port}/v1`,AI_ALLOWED_HOSTS:"127.0.0.1",AI_API_KEY:"preset-specialist-ui-fixture",AI_MODEL:"preset-specialist-ui-fixture",AI_VERIFIED:"true",
    AI_INPUT_HKD_MICROS_PER_MILLION:"1000000",AI_OUTPUT_HKD_MICROS_PER_MILLION:"1000000",AI_INPUT_COUNT_VERIFIED:"true",AI_INPUT_COUNT_HKD_MICROS_PER_CALL:"0",AI_SCOPE_TTL_MS:"300000"}),{worker:false});
  await system.app.listen({host:"127.0.0.1",port:4310});
  electron=await _electron.launch({executablePath:process.env.COPYPASTE_LOCAL_DESKTOP_CANDIDATE!,env:{...process.env,COPYPASTE_USER_DATA:path.join(owned,"user-data")}});
  const page=await electron.firstWindow();page.setDefaultTimeout(25000);page.on("pageerror",e=>errors.push(e.message));
  await page.waitForURL(/^file:/);await page.waitForFunction(()=>!!(window as any).copyPasteBridge);
  await page.evaluate(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});await page.reload();
  await electron.evaluate(({shell,dialog},folder)=>{
    const state=globalThis as any;state.__methodDialogs=[];
    shell.openExternal=async(url:string)=>{state.__authURL=url;};
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});
    dialog.showMessageBox=async(...args:any[])=>{state.__methodDialogs.push(args.at(-1));return {response:1,checkboxChecked:false};};
  },workspace);
  browser=await chromium.launch({executablePath:process.env.CHROME_BIN!,headless:true});const context=await browser.newContext();
  await page.getByRole("button",{name:"Sign in securely in your browser"}).click();
  const url=await until(()=>electron!.evaluate(()=>(globalThis as any).__authURL??""),Boolean,"native PKCE URL");
  const auth=await context.newPage();await auth.addInitScript(()=>localStorage.setItem("cp_locale","en"));await auth.goto(url);
  await auth.locator('input[name="email"]').fill(`native-method-${randomUUID()}@example.invalid`);
  const [challenge]=await Promise.all([auth.waitForResponse(r=>new URL(r.url()).pathname==="/v1/auth/challenges"),auth.locator('form button[type="submit"]').click()]);
  const mail=JSON.parse(await readFile(path.join(isolated.directory,"mailbox",(await challenge.json()).challenge_id+".json"),"utf8"));
  await auth.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);await auth.locator('form button[type="submit"]').click();
  await auth.getByRole("link",{name:/Authorize & return|授權並返回應用/}).click();
  await until(()=>page.evaluate(async()=>(await (window as any).copyPasteBridge.request("/v1/session/context",{})).status),v=>v===200,"native session");
  await page.locator('input[name="name"]').fill("Saved specialist studio");await page.locator('input[name="project_name"]').fill("Local brand-guided work");
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
  await system.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Synthetic isolated saved specialist QA; no payment received',$2)",[tenant,defaults.business]);
  pass("Actual browser email sign-in, PKCE return, native login and customer onboarding");
  const base=`/v1/tenants/${tenant}/projects/${project}`;
  const brand=await request(base+"/brand/definitions","POST",presetBrandDefinition());
  brandVersions=(await request(`/v1/brand-version-options?project_id=${project}`)).items;
  const fixed=brandVersions.find((v:any)=>v.brand_id===brand.id&&v.version===1);assert.ok(fixed);
  // The browser uses the real authenticated web UI and the same scoped API.
  await auth.goto("http://localhost:4317/app/roles");await auth.locator('[data-template-role="assistant"]').click();
  const webModal=auth.getByRole("dialog");
  await webModal.locator('input[name="template_name"]').fill("Cloud brand partner");
  await webModal.locator('textarea[name="template_instructions"]').fill("Preserve the selected approved brand revision.");
  await until(()=>webModal.locator('select[name="template_brand_version"] option').count(),n=>n>=2,"web brand choices");
  await webModal.locator('select[name="template_brand_version"]').selectOption(fixed.id);
  await webModal.getByRole("button",{name:"Check availability",exact:true}).click();
  await webModal.getByRole("button",{name:"Create this specialist",exact:true}).click();
  await auth.getByRole("heading",{name:"Cloud brand partner",exact:true}).waitFor();
  const webAgent=(await request(base+"/agents")).items.find((v:any)=>v.name==="Cloud brand partner");
  assert.deepEqual(webAgent.body.brand,{id:brand.id,version:1});assert.equal(webAgent.body.brand_version_id,fixed.id);savedAgents.push({id:webAgent.id,version:webAgent.version,brand_version_id:fixed.id,client:"web"});
  screenshots.push(await saveWorkmateScreenshot("web","preset-specialists-"+attempt,"brand-en",await auth.screenshot(),"Actual Web preset specialist saved with an exact approved brand revision; no paid task",delivery));
  assert.equal(providerCalls,0);pass("Actual Web role selection, paged brand selection, free preflight and exact-version specialist creation");
  await browser.close();browser=undefined;browserClosed=true;
  await page.evaluate(()=>{location.hash="/app/roles";});await page.locator('[data-template-role="fullstack"]').click();
  const modal=page.getByRole("dialog");
  await modal.locator('input[name="template_name"]').fill("Brand-aware local engineer");
  await modal.locator('textarea[name="template_instructions"]').fill("SAVED_SPECIALIST_WORKING_GUIDANCE: preserve input.txt and write the requested local deliverable using only approved brand facts.");
  await until(()=>modal.locator('select[name="template_brand_version"] option').count(),n=>n>=2,"desktop brand choices");
  await modal.locator('select[name="template_brand_version"]').selectOption(fixed.id);
  await modal.getByRole("button",{name:"Check availability",exact:true}).click();
  await modal.getByRole("button",{name:"Create this specialist",exact:true}).waitFor();
  let captureTail=Promise.resolve();const capture=()=>{const next=captureTail.then(async()=>Buffer.from(await electron!.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64")),"base64"));captureTail=next.then(()=>{},()=>{});return next;};
  screenshots.push(await saveWorkmateScreenshot("desktop","preset-specialists-"+attempt,"configured-en",await capture(),"Actual Desktop engineering preset is ready with saved customer guidance and the exact selected brand revision",delivery));
  await modal.getByRole("button",{name:"Create this specialist",exact:true}).click();
  const card=page.locator(".specialist-card").filter({has:page.getByRole("heading",{name:"Brand-aware local engineer",exact:true})});await card.waitFor();
  const specialist=(await request(base+"/agents")).items.find((v:any)=>v.name==="Brand-aware local engineer");
  assert.equal(specialist.body.brand_version_id,fixed.id);savedAgents.push({id:specialist.id,version:specialist.version,brand_version_id:fixed.id,client:"desktop"});
  assert.equal((await system.db.control.query("SELECT count(*)::int n FROM tasks WHERE tenant_id=$1",[tenant])).rows[0].n,0);
  assert.equal(Number((await system.db.control.query("SELECT reserved_micros FROM wallets WHERE tenant_id=$1",[tenant])).rows[0].reserved_micros),0);
  await request(base+"/brand/"+brand.id,"PUT",{expected_version:1,definition:presetBrandDefinition("PRESET_BRAND_LATER_GUIDANCE")});
  brandVersions=(await request(`/v1/brand-version-options?project_id=${project}`)).items;
  assert.equal(brandVersions.find((v:any)=>v.id===fixed.id).current,false);
  pass("Desktop saves a native engineering specialist for free; a later brand publication leaves its selected revision intact");
  recording=new WorkmateRecording("desktop","preset-specialists",attempt,capture,"Actual unsigned packaged Desktop and local pinned Codex; synthetic company API and bounded native dialog fixture responses",delivery);await recording.start();
  await card.getByRole("button",{name:"Start conversation",exact:true}).click();
  await page.locator(".local-agent-conversation").waitFor();
  await page.locator(".local-agent-sessions").getByText("Brand-aware local engineer · v1",{exact:true}).waitFor();
  await page.getByRole("combobox",{name:"Local permission",exact:true}).selectOption("full-access");
  await page.getByRole("button",{name:"Set permission",exact:true}).click();
  const dialogs=await until(()=>electron!.evaluate(()=>(globalThis as any).__methodDialogs),v=>v.length===1,"actual saved-specialist native permission request");assert.ok(dialogs[0]);
  assert.equal(providerCalls,0);pass("Starting the saved specialist selects a real local folder and separately requests the customer's full local permission");
  await page.getByRole("textbox",{name:"Local task",exact:true}).fill("Read input.txt without changing it, and save the approved output as saved-specialist.txt in this folder.");
  await page.getByRole("spinbutton",{name:"Turn budget HK$",exact:true}).fill("1");
  await page.getByRole("button",{name:"Start work",exact:true}).click();
  await until(async()=>readFile(outputs[0],"utf8").catch(()=>""),v=>v===source,"actual saved specialist local file",120000);
  await until(()=>system.db.control.query("SELECT count(*)::int n FROM tasks WHERE tenant_id=$1 AND status='succeeded'",[tenant]).then((r:any)=>r.rows[0].n),v=>v===1,"native specialist settlement",120000);
  assert.equal(providerCalls,2);assert.equal(providerError,undefined);assert.equal(await readFile(path.join(workspace,"input.txt"),"utf8"),source);
  nativeTasks=(await system.db.control.query("SELECT t.id,t.execution_location,t.charged_micros,t.status,t.input_context,d.client_report FROM tasks t JOIN desktop_executions d ON d.task_id=t.id WHERE t.tenant_id=$1 ORDER BY t.created_at",[tenant])).rows;
  assert.equal(nativeTasks.length,1);const task=nativeTasks[0];assert.equal(task.execution_location,"desktop");assert.equal(task.status,"succeeded");assert.ok(Number(task.charged_micros)>0&&task.client_report);assert.equal(task.input_context.agent_id,specialist.id);assert.equal(task.input_context.agent_version,1);
  assert.equal((await system.db.control.query("SELECT count(*)::int n FROM tasks WHERE tenant_id=$1 AND execution_location='cloud'",[tenant])).rows[0].n,0);
  await page.getByText(/Company billing record/).waitFor();
  screenshots.push(await saveWorkmateScreenshot("desktop","preset-specialists-"+attempt,"delivered-en",await capture(),"Actual local saved specialist output and billing record; company inference contains saved instructions and brand v1 after v2 was published",delivery));
  pass("Actual pinned local Codex uses saved instructions and the original fixed brand, writes the real local file and settles the native task once");
  media=await recording.stop();recording=undefined;assert.ok(media.distinct_frames>1&&media.skipped_capture_errors===0);
  await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(800,600));
  await until(()=>page.evaluate(()=>[innerWidth,innerHeight]),v=>v[0]===800&&v[1]===600,"actual compact native window");
  await page.evaluate(()=>{localStorage.setItem("cp_locale","zh-HK");localStorage.setItem("cp_theme","dark");location.hash="/app/conversations";});await page.reload();await page.locator(".local-agent-conversation").waitFor();
  const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth||document.body.scrollWidth>innerWidth||Array.from(document.querySelectorAll("#root,.local-agent-workspace,.local-agent-grid,.local-agent-conversation")).some(e=>e.scrollWidth>e.clientWidth+2),rails:Array.from(document.querySelectorAll("#root,.sidebar,.local-agent-sessions,.local-agent-conversation")).every(e=>getComputedStyle(e).scrollbarWidth==="none")}));assert.equal(layout.overflow,false);assert.equal(layout.rails,true);
  screenshots.push(await saveWorkmateScreenshot("desktop","preset-specialists-"+attempt,"compact-zh-dark",await capture(),"Actual 800x600 Chinese dark native specialist conversation; frameless, no scroll rails and no horizontal overflow",delivery));
  pass("The legacy conversations entry opens local work; 800x600 Chinese dark Desktop preserves it without visible scroll rails or horizontal overflow");
  const appearance=await electron.evaluate(({BrowserWindow,Menu})=>({menu:Menu.getApplicationMenu()===null,menuBar:BrowserWindow.getAllWindows()[0].isMenuBarVisible(),url:BrowserWindow.getAllWindows()[0].webContents.getURL()}));
  assert.equal(appearance.menu,true);assert.equal(appearance.menuBar,false);assert.ok(appearance.url.startsWith("file:"));
  pass("The packaged desktop uses its local renderer and preserves the menu-free native shell");
}catch(e){errors.push(String(e));console.error(e);}
finally{
  if(recording)try{media=await recording.stop();}catch(e){errors.push(String(e));}
  if(electron){await electron.close().then(()=>{electronClosed=true;}).catch(e=>errors.push(String(e)));}
  if(browser){await browser.close().then(()=>{browserClosed=true;}).catch(e=>errors.push(String(e)));}
  if(system)await system.app.close().then(()=>{apiClosed=true;}).catch((e:any)=>errors.push(String(e)));
  if(isolated)await isolated.cleanup().then(()=>{fixtureClosed=true;}).catch((e:any)=>errors.push(String(e)));
  await new Promise<void>(r=>provider.close(()=>r()));
  const report={at:new Date().toISOString(),status:errors.length?"failed":"passed",checks,errors,screenshots,media,provider_calls:providerCalls,native_tasks:nativeTasks,saved_agents:savedAgents,brand_versions:brandVersions,electron_closed:electronClosed,browser_closed:browserClosed,api_closed:apiClosed,fixture_closed:fixtureClosed,
    not_validated:["human_native_dialog_clicks","live_company_model","real_payment","signed_production_installer","all_role_professional_qualification","entire_product_acceptance"]};
  await writeFile(prefix+"-journey.json",JSON.stringify(report,null,2)+"\n",{flag:"wx"});assert.equal(errors.length,0,errors.join("\n"));
}
