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
const prefix=path.join(delivery,"evidence/native-methods-ui-"+attempt), owned=path.resolve(".data/native-methods",randomUUID()), workspace=path.join(owned,"workspace");
const checks:string[]=[], errors:string[]=[], screenshots:any[]=[];
let isolated:any,system:any,electron:ElectronApplication|undefined,browser:Browser|undefined,recording:WorkmateRecording|undefined,media:any;
let providerCalls=0,providerError:unknown,electronClosed=false,browserClosed=false,apiClosed=false,fixtureClosed=false;
let nativeTasks:any[]=[],methodId="",trialId="";
const pass=(s:string)=>{checks.push(s);console.log("PASS: "+s);};
const source="Synthetic customer-local input; preserved by both method specialists.";
const outputs=["fullstack","backend-api"].map(role=>path.join(workspace,role+".txt"));
const provider=createServer(async(req,res)=>{
  try{
    const chunks=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    assert.equal(req.headers.authorization,"Bearer native-method-ui-fixture");
    const b=JSON.parse(Buffer.concat(chunks).toString());
    if(req.url==="/v1/responses/input_tokens"){res.writeHead(200,{"Content-Type":"application/json"}).end(JSON.stringify({object:"response.input_tokens",input_tokens:10}));return;}
    assert.equal(req.url,"/v1/responses");const index=providerCalls++;assert.ok(index<4);
    let item:any;
    if(index%2===0){
      const tools=(b.tools??[]).flatMap((v:any)=>v.type==="namespace"?v.tools.map((x:any)=>({...x,name:v.name+"."+x.name})):[v]);
      const tool=tools.find((v:any)=>/(?:^|\.)(exec_command|shell|shell_command)$/.test(v.name));assert.ok(tool);
      const command=`$ErrorActionPreference='Stop'; $methodInput=[IO.File]::ReadAllText('${path.join(workspace,"input.txt").replaceAll("'","''")}'); [IO.File]::WriteAllText('${outputs[Math.floor(index/2)].replaceAll("'","''")}', $methodInput); Write-Output 'NATIVE_METHOD_ACTUAL_FILE_WRITTEN'`;
      const args=tool.parameters?.properties?.cmd?{cmd:command,workdir:workspace,yield_time_ms:1000,max_output_tokens:1000}
        :tool.parameters?.properties?.command?.type==="array"?{command:["powershell.exe","-NoProfile","-Command",command],workdir:workspace,timeout_ms:10000}:{command,workdir:workspace,timeout_ms:10000};
      item={type:"function_call",id:"fc_method_"+index,call_id:"call_method_"+index,name:tool.name,arguments:JSON.stringify(args)};
    }else{
      assert.ok(JSON.stringify(b.input).includes("NATIVE_METHOD_ACTUAL_FILE_WRITTEN"),"Require the actual native tool output before the final synthetic answer");
      item={type:"message",id:"msg_method_"+index,role:"assistant",status:"completed",content:[{type:"output_text",text:"Completed the approved native method step. The local output contains the original customer input. This answer uses the authorized synthetic provider.",annotations:[]}]};
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
  const [{isolatedTestEnvironment},{buildApp},{loadConfig},{defaults}]=await Promise.all([load("tests/native-test-environment.ts"),load("src/server.ts"),load("src/config.ts"),load("src/plans.ts")]);
  process.chdir(platform);isolated=await isolatedTestEnvironment();
  system=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",DEV_MAILBOX:"true",WORKER_ENABLED:"false",DEMO_MODE:"false",
    AI_BASE_URL:`http://127.0.0.1:${(provider.address() as any).port}/v1`,AI_ALLOWED_HOSTS:"127.0.0.1",AI_API_KEY:"native-method-ui-fixture",AI_MODEL:"native-method-ui-fixture",AI_VERIFIED:"true",
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
  await browser.close();browser=undefined;browserClosed=true;
  await page.locator('input[name="name"]').fill("Native methods studio");await page.locator('input[name="project_name"]').fill("Local method qualification");
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
  await system.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Synthetic isolated native method QA; no payment received',$2)",[tenant,defaults.business]);
  pass("Actual browser email sign-in, PKCE return, native login and customer onboarding");
  const templates=(await request("/v1/agent-templates")).items;
  const method=await request("/v1/solution-versions","POST",{project_id:project,name:"Local launch method",instructions:"Read input.txt in the customer-selected local folder. Preserve it and write a separate output for each specialist. Work only inside the customer permissions and budget.",agent_template_ids:["fullstack","backend-api"].map(role=>templates.find((v:any)=>v.role_key===role).id),skill_version_ids:[],required_assets:[],required_connectors:[]});methodId=method.id;
  await page.evaluate(id=>{location.hash="/app/solutions?method="+id;},method.id);
  const local=page.getByRole("region",{name:"Local method trial"});
  // A labelled div is located by its stable product class; no mock renderer.
  const panel=page.locator(".local-solution-trial");await panel.waitFor();
  await panel.getByLabel("Local permissions for new sessions").selectOption("full-access");
  for(let i=0;i<2;i++)await panel.getByRole("button",{name:"Choose folder and permissions",exact:true}).nth(i).click();
  await until(()=>electron!.evaluate(()=>(globalThis as any).__methodDialogs),v=>v.length===2,"actual main-process native consent calls");
  await page.getByRole("button",{name:"Preview dependencies free",exact:true}).click();
  await panel.locator('textarea[name="local_solution_brief"]').fill("Read the selected folder input, preserve it, and save the approved specialist outputs locally.");
  await panel.locator('input[name="local_solution_budget"]').fill("1");
  const consent=panel.getByRole("checkbox");await consent.check();
  let captureTail=Promise.resolve();const capture=()=>{const next=captureTail.then(async()=>Buffer.from(await electron!.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64")),"base64"));captureTail=next.then(()=>{},()=>{});return next;};
  recording=new WorkmateRecording("desktop","native-methods",attempt,capture,"Actual unsigned packaged Desktop, actual local Codex and synthetic company API; native dialogs use bounded fixture responses",delivery);await recording.start();
  await panel.getByRole("button",{name:"Confirm budget and prepare local tasks",exact:true}).click();
  await panel.getByRole("button",{name:"Run locally",exact:true}).first().waitFor();
  screenshots.push(await saveWorkmateScreenshot("desktop","native-methods-"+attempt,"prepared-en",await capture(),"Actual native method batch prepared; no Codex process started and the exact total is held once",delivery));
  const trialRows=(await system.db.control.query("SELECT * FROM solution_trials WHERE tenant_id=$1",[tenant])).rows;assert.equal(trialRows.length,1);trialId=trialRows[0].id;
  assert.equal(providerCalls,0);pass("Two fresh full-access local sessions and one exact atomic method reservation, without cloud dispatch");
  for(let i=0;i<2;i++){
    await panel.getByRole("button",{name:"Run locally",exact:true}).first().click();
    await until(async()=>readFile(outputs[i],"utf8").catch(()=>""),v=>v===source,"actual local specialist output",120000);
    await until(()=>system.db.control.query("SELECT count(*)::int n FROM tasks WHERE tenant_id=$1 AND status='succeeded'",[tenant]).then((r:any)=>r.rows[0].n),v=>v===i+1,"native settlement",120000);
  }
  assert.equal(providerCalls,4);assert.equal(providerError,undefined);assert.equal(await readFile(path.join(workspace,"input.txt"),"utf8"),source);
  nativeTasks=(await system.db.control.query("SELECT t.id,t.execution_location,t.charged_micros,t.status,d.client_report FROM tasks t JOIN desktop_executions d ON d.task_id=t.id WHERE t.tenant_id=$1 ORDER BY t.created_at",[tenant])).rows;
  assert.equal(nativeTasks.length,2);assert.ok(nativeTasks.every(v=>v.execution_location==="desktop" && v.status==="succeeded" && Number(v.charged_micros)>0 && v.client_report));
  assert.equal((await system.db.control.query("SELECT count(*)::int n FROM tasks WHERE tenant_id=$1 AND execution_location='cloud'",[tenant])).rows[0].n,0);
  pass("Both actual pinned local Codex processes read the original file and write distinct outputs; observed usage settles on the native tasks");
  await page.getByRole("checkbox",{name:"I checked each role's actual delivery and accept this trial.",exact:true}).check();
  await page.getByRole("button",{name:"Accept every trial delivery",exact:true}).click();
  await page.getByRole("button",{name:"Publish accepted method",exact:true}).click();
  await until(()=>system.db.control.query("SELECT state FROM solution_versions WHERE id=$1",[method.id]).then((r:any)=>r.rows[0].state),v=>v==="published","native acceptance and publication");
  screenshots.push(await saveWorkmateScreenshot("desktop","native-methods-"+attempt,"published-en",await capture(),"Actual locally qualified method, exact delivery acceptance and customer publication",delivery));
  pass("Customer accepts both exact native delivery hashes and publishes the method from the Desktop interface");
  media=await recording.stop();recording=undefined;assert.ok(media.distinct_frames>1 && media.skipped_capture_errors===0);
  await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(800,600));
  await until(()=>page.evaluate(()=>[innerWidth,innerHeight]),v=>v[0]===800&&v[1]===600,"actual compact native window");
  await page.evaluate(()=>{localStorage.setItem("cp_locale","zh-HK");localStorage.setItem("cp_theme","dark");});await page.reload();
  await page.locator(".local-solution-trial").waitFor();
  const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth||document.body.scrollWidth>innerWidth||Array.from(document.querySelectorAll("#root,.solutions-workspace,.solution-detail,.local-solution-trial")).some(e=>e.scrollWidth>e.clientWidth+2),rails:Array.from(document.querySelectorAll("#root,.sidebar,.local-solution-trial")).every(e=>getComputedStyle(e).scrollbarWidth==="none")}));
  assert.equal(layout.overflow,false);assert.equal(layout.rails,true);
  screenshots.push(await saveWorkmateScreenshot("desktop","native-methods-"+attempt,"compact-zh-dark",await capture(),"Actual 800x600 frameless Desktop, Chinese dark theme, method library and local tasks without scrollbar rails or horizontal overflow",delivery));
  pass("800x600 Chinese dark native methods page preserves frameless layout, hidden rails and no horizontal overflow");
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
  const report={at:new Date().toISOString(),status:errors.length?"failed":"passed",checks,errors,screenshots,media,provider_calls:providerCalls,native_tasks:nativeTasks,method_id:methodId,trial_id:trialId,electron_closed:electronClosed,browser_closed:browserClosed,api_closed:apiClosed,fixture_closed:fixtureClosed,
    not_validated:["human_native_dialog_clicks","live_company_model","real_payment","signed_production_installer","all_role_professional_qualification","entire_product_acceptance"]};
  await writeFile(prefix+"-journey.json",JSON.stringify(report,null,2)+"\n",{flag:"wx"});assert.equal(errors.length,0,errors.join("\n"));
}
