import assert from "node:assert/strict";
import { chromium, _electron, type Browser, type BrowserContext, type Page, type ElectronApplication, type CDPSession } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { unzipSync } from "fflate";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";
const attempt = process.argv[2]; assert.match(attempt ?? "", /^\d{2}$/);
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), prefix = `evidence/delivery-revision-138/ui-${attempt}`;
const owned = process.env.COPYPASTE_BUSINESS_INPUTS_OWNED!, workspace = path.join(owned,"workspace"), load = (name: string) => import(pathToFileURL(path.join(platform, name)).href);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const checks: string[] = [], screenshots: any[] = [], recordings: any[] = [], layouts: any[] = [], errors: string[] = [], archives: any[] = [], diagnostics: any[] = [];
let isolated: any, system: any, browser: Browser | undefined, extensionContext: BrowserContext | undefined, electron: ElectronApplication | undefined, recording: WorkmateRecording | undefined;
let stage = "setup", failure: string | null = null, browserClosed = false, extensionClosed = false, desktopClosed = false, apiClosed = false, fixtureClosed = false, providerClosed = false;
let nativeStage = "original", nativeStep = 0, providerCalls = 0, providerError: string | null = null;
const pass = (name: string) => { checks.push(name); console.log("PASS: " + name); };
const provider = createServer(async (req, res) => {
  try {
    const parts: Buffer[] = []; for await (const b of req) parts.push(Buffer.from(b));
    assert.equal(req.headers.authorization, "Bearer revision-ui-fixture"); const body = JSON.parse(Buffer.concat(parts).toString());
    assert.equal(body.model, "revision-ui-fixture");
    if (req.url === "/v1/responses/input_tokens") { res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ object: "response.input_tokens", input_tokens: 10 })); return; }
    assert.equal(req.url, "/v1/responses"); providerCalls++;
    const tools = (body.tools ?? []).flatMap((tool: any) => tool.type === "namespace" ? tool.tools.map((child: any) => ({ ...child, namespace: tool.name })) : [tool]);
    let item: any; const step = nativeStep++;
    const call = (name: string, args: any) => { const tool = tools.find((t: any) => t.name === name); assert.ok(tool, "Actual native company tool: " + name); return { type: "function_call", id: "fc_revision_" + providerCalls, call_id: "call_revision_" + providerCalls, namespace: tool.namespace, name: tool.name, arguments: JSON.stringify(args) }; };
    if (nativeStage === "revision" && step === 0) item = call("project_assets", {});
    else if ((nativeStage === "original" && step === 0) || (nativeStage === "revision" && step === 1)) {
      const tool = tools.find((t: any) => /(?:^|\.)(exec_command|shell|shell_command)$/.test(t.name)); assert.ok(tool, "Actual local Codex terminal tool");
      const original = path.join(workspace, "original-local.txt").replaceAll("'", "''"), revised = path.join(workspace, "revised-local.txt").replaceAll("'", "''");
      const command = nativeStage === "original" ? `[IO.File]::WriteAllText('${original}', 'Original local customer file')` : `[IO.File]::WriteAllText('${revised}', [IO.File]::ReadAllText('${original}') + ' - revised locally')`;
      const args = tool.parameters?.properties?.cmd ? { cmd: command, workdir: workspace, yield_time_ms: 1000, max_output_tokens: 1000 }
        : tool.parameters?.properties?.command?.type === "array" ? { command: ["powershell.exe", "-NoProfile", "-Command", command], workdir: workspace, timeout_ms: 10000 } : { command, workdir: workspace, timeout_ms: 10000 };
      item = { type: "function_call", id: "fc_revision_" + providerCalls, call_id: "call_revision_" + providerCalls, name: tool.name, ...(tool.namespace ? { namespace: tool.namespace } : {}), arguments: JSON.stringify(args) };
    } else if ((nativeStage === "original" && step === 1) || (nativeStage === "revision" && step === 2)) item = call("deliver_text", { filename: nativeStage === "original" ? "native-original.md" : "native-revised.md", mime_type: "text/markdown", content: nativeStage === "original" ? "Original local customer delivery" : "Revised local customer delivery, original retained" });
    else item = { type: "message", id: "msg_revision_" + providerCalls, role: "assistant", status: "completed", content: [{ type: "output_text", text: nativeStage === "original" ? "Original local delivery is ready. The original file remains in your selected folder." : "The requested revision is ready. A new local file and a new delivery were created; the original is retained.", annotations: [] }] };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const emit = (type: string, value: any) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
    const response = { id: "resp_revision_ui_" + providerCalls, object: "response", created_at: 1, model: body.model, status: "in_progress", output: [] };
    emit("response.created", { response }); emit("response.output_item.added", { output_index: 0, item: item.type === "function_call" ? { ...item, arguments: "" } : item });
    if (item.type === "function_call") { emit("response.function_call_arguments.delta", { output_index: 0, item_id: item.id, delta: item.arguments }); emit("response.function_call_arguments.done", { output_index: 0, item_id: item.id, arguments: item.arguments }); }
    else { emit("response.output_text.delta", { output_index: 0, item_id: item.id, content_index: 0, delta: item.content[0].text }); emit("response.output_text.done", { output_index: 0, item_id: item.id, content_index: 0, text: item.content[0].text }); }
    emit("response.output_item.done", { output_index: 0, item }); emit("response.completed", { response: { ...response, status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } } }); res.end();
  } catch (error) { providerError = String(error); if (!res.headersSent) res.writeHead(502); res.end(); }
});
async function until(read: () => Promise<any>, valid: (v: any) => boolean, label: string, ms = 40000) { const end = Date.now() + ms; for (;;) { const value = await read(); if (valid(value)) return value; assert.ok(Date.now() < end, label); await new Promise(r => setTimeout(r, 100)); } }
async function stopRecording() { if (recording) { const r = recording; recording = undefined; recordings.push(await r.stop()); } }
async function shot(client: string, page: Page, name: string) { screenshots.push(await saveWorkmateScreenshot(client, `delivery-revision-138-${attempt}`, name, await page.screenshot(), "Actual source-bound revision journey; business/model responses explicitly synthetic", delivery)); }
async function attachTarget(parent: CDPSession, targetId: string) {
  const { sessionId } = await parent.send("Target.attachToTarget", { targetId, flatten: false }); let sequence = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const receive = (event: any) => { if (event.sessionId !== sessionId) return; const message = JSON.parse(event.message), entry = pending.get(message.id); if (!entry) return;
    clearTimeout(entry.timer); pending.delete(message.id); if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result); };
  parent.on("Target.receivedMessageFromTarget", receive);
  return {
    send(method: string, params: Record<string, unknown> = {}): Promise<any> { const id = ++sequence; return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("Side-panel CDP timed out: " + method)); }, 15000); pending.set(id, { resolve, reject, timer });
      void parent.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) }).catch(e => { clearTimeout(timer); pending.delete(id); reject(e); }); }); },
    async close() { parent.removeListener("Target.receivedMessageFromTarget", receive); for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error("Side-panel session closed")); } pending.clear(); await parent.send("Target.detachFromTarget", { sessionId }).catch(() => {}); },
  };
}

try {
  await mkdir(workspace,{recursive:true});
  await new Promise<void>(resolve=>provider.listen(0,"127.0.0.1",resolve));
  const [{ isolatedTestEnvironment }, { buildApp }, { loadConfig }, { Worker }, { CodexRuntimeAdapter }, fixtures, { saveAsset }, { desktopImageFixture }] = await Promise.all([
    load("tests/native-test-environment.ts"),load("src/server.ts"),load("src/config.ts"),load("src/worker.ts"),load("src/runtime.ts"),load("tests/support-access-fixture.ts"),load("src/storage.ts"),load("tests/desktop-image-fixture.ts")]);
  process.chdir(platform); isolated=await isolatedTestEnvironment();
  system=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",WORKER_ENABLED:"false",DEMO_MODE:"false",DEV_MAILBOX:"true",
    API_ORIGIN:"http://localhost:4310",WEB_ORIGIN:"http://localhost:4317",ADMIN_ORIGIN:"http://localhost:4318",
    AI_BASE_URL:`http://127.0.0.1:${(provider.address() as any).port}/v1`,AI_ALLOWED_HOSTS:"127.0.0.1",AI_API_KEY:"revision-ui-fixture",AI_MODEL:"revision-ui-fixture",AI_VERIFIED:"true",
    AI_INPUT_HKD_MICROS_PER_MILLION:"1000000",AI_OUTPUT_HKD_MICROS_PER_MILLION:"1000000",AI_INPUT_COUNT_VERIFIED:"true",AI_INPUT_COUNT_HKD_MICROS_PER_CALL:"0",AI_SCOPE_TTL_MS:"300000"}),{worker:false});
  system.app.addHook("onError",async(req:any,_reply:any,error:Error)=>{diagnostics.push({method:req.method,url:req.url,error:error.stack});});
  await system.app.listen({host:"127.0.0.1",port:4310});const owner=await fixtures.historyLogin(system),w=await fixtures.historyOk(system,owner,"POST","/v1/tenants",{name:"Revision UI fixture (synthetic)",project_name:"Source-bound delivery revisions"});
  owner.tenant=w.tenant.id;const f={owner,tenant:w.tenant.id,project:w.project.id,base:`/v1/tenants/${w.tenant.id}/projects/${w.project.id}`};
  const {defaults}=await load("src/plans.ts");await system.db.control.query("UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1",[f.tenant]);
  await system.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Explicit synthetic revision UI fixture only',$2)",[f.tenant,defaults.business]);
  const videoFile=path.join(owned,"original-video.mp4");
  await promisify(execFile)(process.env.FFMPEG_BIN??"ffmpeg",["-nostdin","-v","error","-f","lavfi","-i","color=c=0x1f5eff:s=320x180:r=12","-t","2","-c:v","libx264","-pix_fmt","yuv420p","-movflags","+faststart",videoFile],{windowsHide:true,timeout:30000});
  const probe=JSON.parse((await promisify(execFile)(process.env.FFPROBE_BIN??"ffprobe",["-v","error","-show_format","-of","json",videoFile],{windowsHide:true,timeout:10000})).stdout);
  const videoBytes=await readFile(videoFile),imageBytes=desktopImageFixture();
  class CampaignRuntime extends CodexRuntimeAdapter{
    constructor(private revision=false){super(system.db.config);}
    async start(ctx:any){
      if(this.revision){const source=await ctx.tools.find((t:any)=>t.name==="delivery_revision_read").run({offset:0,limit:16000},"revision-source");assert.ok(source.source_task_id);await ctx.tools.find((t:any)=>t.name==="deliver_text").run({filename:"revised-campaign.md",mime_type:"text/markdown",content:"Revised synthetic campaign headline. Original delivery retained."},"revised-delivery");}
      else{
        await ctx.tools.find((t:any)=>t.name==="deliver_text").run({filename:"campaign-brief.md",mime_type:"text/markdown",content:"# Original campaign\n\nHarbour launch: original customer headline. Keep this file unchanged."},"original-brief");
        for(const [name,mime,bytes,metadata] of [["campaign.png","image/png",imageBytes,{}],["campaign.mp4","video/mp4",videoBytes,{probe:{duration_seconds:Number(probe.format.duration)}}]] as const)
          await system.db.tx((tx:any)=>saveAsset(tx,system.storage,{tenant:f.tenant,project:f.project,user:f.owner.id,name,mime,bytes,metadata:{...metadata,task_id:ctx.taskId}}),f.tenant,false,f.owner.id);
      }
      return {text:this.revision?"Your revised campaign is ready. The original files are retained.":"Your original campaign brief, image and video are ready. Choose the output and location you want to revise.",status:"completed",inputTokens:100,outputTokens:50,usageKnown:true,accepted:true,thread:"synthetic-revision-ui-"+ctx.taskId,turn:"1"};
    }
  }
  async function make(name:string){const work=await fixtures.historyOk(system,f.owner,"POST",f.base+"/delegations",{title:name,prompt:"Prepare a clearly simulated campaign with a text brief, image and video",mode:"execute",budget_micros:1000000,client_message_id:randomUUID()});await new Worker(system.db,system.catalog,system.storage,new CampaignRuntime()).run(f.tenant,work.task.id);return work;}
  const originals:any[]=[];
  async function retain(work:any){originals.push({id:work.task.id,...(await system.db.control.query("SELECT output,charged_micros::text,version FROM tasks WHERE id=$1",[work.task.id])).rows[0]});}
  async function completeRevision(id:string,source:string,kind:string){
    const row=(await system.db.control.query("SELECT * FROM tasks WHERE id=$1",[id])).rows[0];assert.equal(row.parent_id,source);assert.equal(row.input_context.delivery_revision.target.kind,kind);assert.equal(row.execution_location,"cloud");
    await new Worker(system.db,system.catalog,system.storage,new CampaignRuntime(true)).run(f.tenant,id);assert.equal((await system.db.control.query("SELECT status FROM tasks WHERE id=$1",[id])).rows[0].status,"succeeded");
    assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM reservations WHERE task_id=$1",[id])).rows[0].n,1);
  }
  async function validateArchive(client:string,file:string,task:string){const bytes=await readFile(file),entries=unzipSync(bytes),manifest=JSON.parse(Buffer.from(entries["manifest.json"]).toString());assert.equal(manifest.task_id,task);assert.ok(manifest.files.length>=2);for(const item of manifest.files)assert.equal(sha(entries[item.path]),item.sha256);archives.push({client,task,path:file,sha256:sha(bytes),files:manifest.files.length});}
  async function login(page:Page,url="http://localhost:4317/login"){
    await system.db.control.query("UPDATE auth_challenges SET created_at=clock_timestamp()-interval '2 minutes' WHERE email=$1",[f.owner.email]);
    await page.goto(url);await page.locator('input[name="email"]').fill(f.owner.email);
    const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==="/v1/auth/challenges"),page.locator('form button[type="submit"]').click()]);assert.equal(response.status(),202);
    const mail=JSON.parse(await readFile(path.join(isolated.directory,"mailbox",(await response.json()).challenge_id+".json"),"utf8"));await page.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);await page.locator('form button[type="submit"]').click();
  }
  browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});await context.addInitScript(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});
  const web=await context.newPage();web.on("pageerror",e=>errors.push(e.message));
  stage="Web original conversation, quoted revision and lost response";const webWork=await make("Web source-bound campaign revision");await retain(webWork);await login(web);await web.locator(".app-shell").waitFor();
  await web.goto("http://localhost:4317/app/conversations/"+webWork.conversation.id);await web.getByRole("button",{name:"Request changes to this delivery",exact:true}).click();
  const form=web.locator(".delivery-revision-form");await form.getByLabel("Which output should change?",{exact:true}).selectOption("output");await form.getByLabel("Change scope",{exact:true}).selectOption("text");
  const text=form.getByLabel("Original text selection",{exact:true});await until(()=>text.inputValue(),v=>v.length>0,"Original selectable answer loaded");await text.focus();await text.press("Control+A");await text.dispatchEvent("mouseup");diagnostics.push({stage:"text selection",value:await text.evaluate((t:HTMLTextAreaElement)=>({start:t.selectionStart,end:t.selectionEnd,value:t.value,disabled:t.disabled,fieldset:t.closest("fieldset")?.disabled})),form:await form.innerText()});await form.locator(".revision-quote").waitFor();
  await form.getByLabel("What should change?",{exact:true}).fill("Use a shorter headline for Hong Kong retail customers; retain the original campaign.");await form.getByLabel("Revision budget limit (HKD)",{exact:true}).fill("0.25");await form.getByRole("checkbox").check();
  await shot("web",web,"selected-text-en");recording=new WorkmateRecording("web","delivery-revision",`delivery-revision-138-${attempt}`,()=>web.screenshot({type:"jpeg",quality:72}),"Actual source-bound text/image/video revisions with synthetic business content; one response deliberately lost after acceptance",delivery);await recording.start();
  let lost:any=null;const pattern="**/tasks/"+webWork.task.id+"/revisions";
  await web.route(pattern,async route=>{if(lost){await route.continue();return;}const response=await route.fetch();assert.equal(response.status(),201);lost=await response.json();await route.abort("failed");});
  await form.getByRole("button",{name:"Start revision",exact:true}).click();await form.getByRole("button",{name:"Retry original revision",exact:true}).waitFor();await until(async()=>lost,Boolean,"Accepted original revision before lost response");
  assert.equal(await form.getByLabel("What should change?",{exact:true}).isDisabled(),true);await shot("web",web,"lost-response-retained");
  const replay=web.waitForResponse(r=>r.url().endsWith("/tasks/"+webWork.task.id+"/revisions"));await form.getByRole("button",{name:"Retry original revision",exact:true}).click();const replayResponse=await replay;assert.equal(replayResponse.status(),201);assert.equal((await replayResponse.json()).task_id,lost.task_id);await web.unroute(pattern);
  await completeRevision(lost.task_id,webWork.task.id,"text");await form.getByRole("link",{name:"View revision",exact:true}).click();await web.getByText("Your revised campaign is ready. The original files are retained.",{exact:true}).waitFor();
  pass("Web: real login, exact text selection, confirmed budget, lost-response retry and original-conversation revised delivery create only one task and hold");
  for(const kind of ["image","video"]){
    await web.goto("http://localhost:4317/app/tasks/"+webWork.task.id);await web.locator(".delivery-quality").getByRole("button",{name:"Request changes to this delivery",exact:true}).click();
    const c=await fixtures.historyOk(system,f.owner,"GET",f.base+"/tasks/"+webWork.task.id+"/revision-context"),a=c.artifacts.find((a:any)=>a.mime_type===(kind==="image"?"image/png":"video/mp4"));
    await form.getByLabel("Which output should change?",{exact:true}).selectOption(a.asset_version_id);await form.getByLabel("Change scope",{exact:true}).selectOption(kind);
    if(kind==="image"){await form.locator(".revision-image img").waitFor();await form.getByLabel("Left ratio",{exact:true}).fill("0.1");await form.getByLabel("Top ratio",{exact:true}).fill("0.2");await form.getByLabel("Width ratio",{exact:true}).fill("0.5");await form.getByLabel("Height ratio",{exact:true}).fill("0.4");}
    else{await form.locator("video").waitFor();await form.getByLabel("Start (seconds)",{exact:true}).fill("0.25");await form.getByLabel("End (seconds)",{exact:true}).fill("1.5");assert.ok(await form.locator("video").evaluate((video:HTMLVideoElement)=>new Promise<boolean>(resolve=>{if(video.readyState>=1)resolve(true);else{video.onloadedmetadata=()=>resolve(true);video.onerror=()=>resolve(false);}})));}
    await form.getByLabel("What should change?",{exact:true}).fill("Revise only the selected "+kind+" location and retain the original delivery.");await form.getByLabel("Revision budget limit (HKD)",{exact:true}).fill("0.25");await form.getByRole("checkbox").check();await shot("web",web,kind+"-anchor-en");
    const response=web.waitForResponse(r=>r.url().endsWith("/tasks/"+webWork.task.id+"/revisions"));await form.getByRole("button",{name:"Start revision",exact:true}).click();const raw=await response;assert.equal(raw.status(),201);const created=await raw.json();await completeRevision(created.task_id,webWork.task.id,kind);await web.getByRole("button",{name:"Close",exact:true}).click();
  }
  pass("Web: selected original image coordinates and a decoded MP4 time interval survive admission and produce separate revised files");
  await web.goto("http://localhost:4317/app/tasks/"+lost.task_id);const [download]=await Promise.all([web.waitForEvent("download"),web.getByRole("button",{name:"Download delivery package",exact:true}).click()]);const webFile=path.join(owned,"web-revised.zip");await download.saveAs(webFile);await validateArchive("web",webFile,lost.task_id);
  await web.getByTitle("切換至繁體中文",{exact:true}).click();await web.getByRole("button",{name:"以這份成果繼續修改",exact:true}).click();await form.getByLabel("要修改哪份成果？",{exact:true}).waitFor();await shot("web",web,"revised-delivery-zh");
  for(const width of [375,768,1440]){await web.setViewportSize({width,height:1000});const view=await web.evaluate(()=>({client:"web",width:innerWidth,horizontal:document.documentElement.scrollWidth>innerWidth+1}));assert.equal(view.horizontal,false);layouts.push(view);}
  await web.getByRole("button",{name:"Close",exact:true}).click();await stopRecording();pass("Web: revised ZIP contains exact new file bytes and the bilingual revision form fits three widths");

  stage="Packaged Desktop actual local Codex revision";
  electron=await _electron.launch({executablePath:process.env.COPYPASTE_LOCAL_DESKTOP_CANDIDATE!,env:{...process.env,COPYPASTE_USER_DATA:path.join(owned,"desktop")}});
  const native=await electron.firstWindow();native.setDefaultTimeout(30000);native.on("pageerror",e=>errors.push(e.message));await native.waitForURL(/^file:/);await native.evaluate(()=>{localStorage.setItem("cp_locale","en");localStorage.setItem("cp_theme","light");});await native.reload();
  const nativeFile=path.join(owned,"desktop-revised.zip");
  await electron.evaluate(({shell,dialog},paths)=>{shell.openExternal=async(url:string)=>{(globalThis as any).__revisionAuth=url;};dialog.showOpenDialog=async()=>({canceled:false,filePaths:[paths.workspace]});dialog.showSaveDialog=async()=>({canceled:false,filePath:paths.download});dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});},{workspace,download:nativeFile});
  await native.getByRole("button",{name:"Sign in securely in your browser",exact:true}).click();
  const nativeContext=await browser.newContext();await nativeContext.addInitScript(()=>{localStorage.setItem("cp_locale","en");});const customer=await nativeContext.newPage();await login(customer,await until(()=>electron!.evaluate(()=>(globalThis as any).__revisionAuth),Boolean,"Native PKCE link"));await customer.getByRole("link",{name:/Authorize & return|授權並返回應用/}).click();await native.locator(".app-shell").waitFor();
  await native.evaluate(()=>{window.location.hash="/app";});await native.getByRole("heading",{name:"Your local workmate",exact:true}).waitFor();
  const list=async()=>{const value=await native.evaluate(async scope=>(window as any).copyPasteBridge.localAgent("list",scope),{tenant:f.tenant,project:f.project});assert.equal(value.ok,true);return value.value.sessions.at(-1);};
  await native.getByLabel("Local specialist",{exact:true}).selectOption("fullstack");await native.getByRole("button",{name:"Choose folder to start",exact:true}).click();await until(list,s=>!!s,"Actual native local session");
  await native.getByLabel("Local permission",{exact:true}).selectOption("full-access");await native.getByRole("button",{name:"Set permission",exact:true}).click();await until(list,s=>s.permission==="full-access","Native explicit full-access fixture consent");
  await native.getByLabel("Local task",{exact:true}).fill("Create an original local customer file, then submit its original campaign delivery using the company deliver_text tool.");await native.getByRole("button",{name:"Start work",exact:true}).click();
  const originalState=await until(list,s=>!s.busy&&s.task?.status==="succeeded","Original task executes actual packaged local Codex",90000),originalId=originalState.task.task_id;
  assert.equal(await readFile(path.join(workspace,"original-local.txt"),"utf8"),"Original local customer file");
  const nativeCheckpointPath=path.join(owned,"desktop","local-codex",originalState.id,"checkpoint.json"),originalCheckpoint=JSON.parse(await readFile(nativeCheckpointPath,"utf8"));
  originals.push({id:originalId,...(await system.db.control.query("SELECT output,charged_micros::text,version FROM tasks WHERE id=$1",[originalId])).rows[0]});
  await native.getByText("Review this delivery",{exact:true}).click();await native.getByRole("button",{name:"Request changes to this delivery",exact:true}).click();
  const nativeForm=native.locator(".delivery-revision-form");await nativeForm.getByLabel("Which output should change?",{exact:true}).selectOption("output");await nativeForm.getByLabel("What should change?",{exact:true}).fill("Read the bound original delivery, create revised-local.txt from original-local.txt, and submit a new cloud artifact. Preserve the original file.");await nativeForm.getByLabel("Revision budget limit (HKD)",{exact:true}).fill("0.25");await nativeForm.getByRole("checkbox").check();
  await shot("desktop",native,"local-revision-en");await native.getByRole("button",{name:"Close",exact:true}).click();await native.getByTitle("切換至繁體中文",{exact:true}).click();await native.getByRole("button",{name:"以這份成果繼續修改",exact:true}).click();await nativeForm.getByLabel("要修改哪份成果？",{exact:true}).waitFor();await shot("desktop",native,"local-revision-zh");await native.getByRole("button",{name:"Close",exact:true}).click();await native.getByTitle("Switch to English",{exact:true}).click();await native.getByRole("button",{name:"Request changes to this delivery",exact:true}).click();
  await nativeForm.getByLabel("Which output should change?",{exact:true}).selectOption("output");await nativeForm.getByLabel("What should change?",{exact:true}).fill("Read the bound original delivery, create revised-local.txt from original-local.txt, and submit a new cloud artifact. Preserve the original file.");await nativeForm.getByLabel("Revision budget limit (HKD)",{exact:true}).fill("0.25");await nativeForm.getByRole("checkbox").check();
  recording=new WorkmateRecording("desktop","delivery-revision",`delivery-revision-138-${attempt}`,()=>native.screenshot({type:"jpeg",quality:72}),"Actual packaged frameless Desktop, actual local Codex source reader and native file execution; OpenAI model responses and native file/permission dialog decisions explicitly controlled",delivery);await recording.start();
  nativeStage="revision";nativeStep=0;await nativeForm.getByRole("button",{name:"Revise with local Codex",exact:true}).click();
  const revisedState=await until(async()=>{const s=await list();if(!s.busy&&s.task?.task_id!==originalId&&["failed","cancelled","reconciling"].includes(s.task?.status))throw new Error("Actual local revision failed: "+JSON.stringify({error:s.error,phase:s.phase,status:s.task.status,uncertain:s.uncertain}));return s;},s=>!s.busy&&s.task?.status==="succeeded"&&s.task.task_id!==originalId,"Source-bound actual local Codex revision",90000),nativeId=revisedState.task.task_id;
  assert.equal(await readFile(path.join(workspace,"original-local.txt"),"utf8"),"Original local customer file");assert.equal(await readFile(path.join(workspace,"revised-local.txt"),"utf8"),"Original local customer file - revised locally");
  const revisedCheckpoint=JSON.parse(await readFile(nativeCheckpointPath,"utf8"));assert.equal(revisedCheckpoint.threadId,originalCheckpoint.threadId);assert.equal(revisedCheckpoint.binding,originalCheckpoint.binding);
  const nativeTask=(await system.db.control.query("SELECT * FROM tasks WHERE id=$1",[nativeId])).rows[0];assert.equal(nativeTask.parent_id,originalId);assert.equal(nativeTask.execution_location,"desktop");assert.equal(nativeTask.input_context.delivery_revision.source_task_id,originalId);
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM outbox WHERE payload->>'task_id'=$1",[nativeId])).rows[0].n,0);assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM task_events WHERE task_id=$1 AND kind='delivery.revision.read'",[nativeId])).rows[0].n,1);
  pass("Desktop: real OTP/PKCE, confirmed local permissions and actual packaged Codex read the fixed original, execute local file changes and deliver a new artifact in the exact same Codex thread without cloud queue execution");
  await native.getByText("Review this delivery",{exact:true}).click();await native.getByRole("button",{name:"Download delivery package",exact:true}).click();await until(async()=>{try{return await readFile(nativeFile);}catch{return null;}},Boolean,"Native revised ZIP save");await validateArchive("desktop",nativeFile,nativeId);await shot("desktop",native,"local-revised-delivery");await stopRecording();
  const nativeWindow=await electron.browserWindow(native);
  for(const width of [1000,1240,1440]){await nativeWindow.evaluate((win,width)=>win.setBounds({width,height:980}),width);const frame=await nativeWindow.evaluate(win=>({bounds:win.getBounds(),content:win.getContentBounds(),menu_visible:win.isMenuBarVisible()}));const view=await native.evaluate(()=>({client:"desktop",width:innerWidth,horizontal:document.documentElement.scrollWidth>innerWidth,visible_scrollbars:[...document.querySelectorAll("body *")].filter(n=>n.getClientRects().length&&n.scrollHeight>n.clientHeight+1&&/auto|scroll/.test(getComputedStyle(n).overflowY)&&getComputedStyle(n).scrollbarWidth!=="none"&&getComputedStyle(n,"::-webkit-scrollbar").display!=="none").map(n=>String(n.className))}));assert.deepEqual(frame.bounds,frame.content);assert.equal(frame.menu_visible,false);assert.equal(view.horizontal,false);assert.deepEqual(view.visible_scrollbars,[]);layouts.push({...view,frame});}
  assert.equal(await electron.evaluate(({Menu})=>Menu.getApplicationMenu()===null),true);await native.getByRole("button",{name:"Revoke local permission",exact:true}).click();await until(list,s=>s.revoked&&s.permission===null,"Revoke local full permission after actual revision");pass("Desktop: revised ZIP matches new files; three native widths retain no frame, menu, horizontal overflow or visible scrolling rails; full access is revocable");
  await electron.close();electron=undefined;desktopClosed=true;
  stage="Actual Chrome right SIDE_PANEL source-bound revision";const extensionWork=await make("Right side-panel campaign revision");await retain(extensionWork);
  const extension=path.resolve(delivery,"../copypaste-extension"),extensionId=(await readFile(path.join(extension,"extension-id.txt"),"utf8")).trim(),downloads=path.join(owned,"browser-downloads");await mkdir(downloads,{recursive:true});
  extensionContext=await chromium.launchPersistentContext(path.join(owned,"extension"),{executablePath:process.env.CHROME_BIN,headless:false,viewport:null,args:["--disable-gpu","--window-size=1480,980","--enable-unsafe-extension-debugging","--disable-extensions-except="+path.join(extension,"dist"),"--load-extension="+path.join(extension,"dist")]});
  const worker=extensionContext.serviceWorkers()[0]??await extensionContext.waitForEvent("serviceworker");await worker.evaluate(()=>chrome.storage.local.set({locale:"en"}));
  const main=extensionContext.pages()[0];await main.goto("http://localhost:4317/");const width=await main.evaluate(()=>innerWidth),tabs=await worker.evaluate(async()=> (await chrome.tabs.query({})).map(t=>t.id).sort());
  const cdp=await extensionContext.browser()!.newBrowserCDPSession();await cdp.send("Browser.setDownloadBehavior",{behavior:"allow",downloadPath:downloads,eventsEnabled:true});
  const target=(await cdp.send("Target.getTargets",{filter:[{}]})).targetInfos.find(t=>t.type==="tab"&&t.url.startsWith("http://localhost:4317"));assert.ok(target);await until(()=>worker.evaluate(()=>chrome.sidePanel.getPanelBehavior()),v=>v.openPanelOnActionClick===true,"Native toolbar side-panel registration");await(cdp as any).send("Extensions.triggerAction",{id:extensionId,targetId:target.targetId});
  const side=await until(()=>worker.evaluate(()=>chrome.runtime.getContexts({contextTypes:["SIDE_PANEL"]})),v=>v.length===1&&v[0].documentUrl===`chrome-extension://${extensionId}/sidepanel.html`,"Actual native SIDE_PANEL document"),panelTarget=await until(async()=>(await cdp.send("Target.getTargets",{filter:[{}]})).targetInfos.find(t=>t.type==="page"&&t.url===side[0].documentUrl),Boolean,"Native panel target"),panel=await attachTarget(cdp,panelTarget.targetId);
  diagnostics.push({native_side_panel:side[0],target:panelTarget,ordinary_tab_ids:tabs});
  const evaluate=async(expression:string)=>{const value=await panel.send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});assert.equal(value.exceptionDetails,undefined);return value.result.value;};
  const click=(selector:string)=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click();true`),capture=async()=>Buffer.from((await panel.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false})).data,"base64");
  try{
    await until(()=>main.evaluate(()=>innerWidth),v=>v<width-250,"Right dock consumes browser content width");assert.equal((await worker.evaluate(()=>chrome.sidePanel.getLayout())).side,"right");assert.deepEqual(await worker.evaluate(async()=> (await chrome.tabs.query({})).map(t=>t.id).sort()),tabs);pass("Extension: toolbar opens the native right SIDE_PANEL with no ordinary panel tab");
    await until(()=>evaluate("document.documentElement.lang"),v=>v==="en","Panel English locale");const popupEvent=extensionContext.waitForEvent("page");await click("#sign-in");const popup=await popupEvent;await popup.waitForURL(url=>url.hostname==="localhost"&&url.port==="4317");await popup.waitForLoadState();await login(popup,popup.url());await popup.getByRole("link",{name:/Authorize & return|授權並返回應用/}).click();
    await until(()=>evaluate("!document.querySelector('#workspace').hidden && !!document.querySelector('#project').value"),Boolean,"Panel actual OAuth callback");await until(()=>evaluate(`!!document.querySelector('#chat-history option[value="${extensionWork.conversation.id}"]')`),Boolean,"Original cloud conversation in native panel");await evaluate(`document.querySelector('#chat-history').value=${JSON.stringify(extensionWork.conversation.id)};document.querySelector('#chat-history').dispatchEvent(new Event('change'));true`);
    await until(()=>evaluate("[...document.querySelectorAll('#chat-messages button')].some(b=>b.textContent==='Request changes to this delivery')"),Boolean,"Original-chat revision entry");
    await evaluate("[...document.querySelectorAll('#chat-messages button')].find(b=>b.textContent==='Request changes to this delivery').click();true");
    await until(()=>evaluate("!!document.querySelector('.revision-dialog select option[value=output]')"),Boolean,"Native side-panel revision modal");
    await evaluate("const s=document.querySelector('.revision-dialog select');s.value='output';s.dispatchEvent(new Event('change'));true");await evaluate("const revisionMode=document.querySelectorAll('.revision-dialog select')[1];revisionMode.value='text';revisionMode.dispatchEvent(new Event('change'));true");
    await until(()=>evaluate("!!document.querySelector('.revision-dialog textarea[readonly]')"),Boolean,"Original source text in side panel");
    await evaluate("const t=document.querySelector('.revision-dialog textarea[readonly]');t.focus();t.setSelectionRange(0,13);t.dispatchEvent(new Event('select'));document.querySelector('.revision-dialog textarea:not([readonly])').value='Use a concise Hong Kong retail headline and keep the original source.';document.querySelector('.revision-dialog input[type=number]').value='0.25';document.querySelector('.revision-dialog input[type=checkbox]').checked=true;true");
    screenshots.push(await saveWorkmateScreenshot("extension",`delivery-revision-138-${attempt}`,"selected-text-en",await capture(),"Actual native right SIDE_PANEL original-conversation source-bound revision",delivery));
    recording=new WorkmateRecording("extension","delivery-revision",`delivery-revision-138-${attempt}`,capture,"Actual native Chrome right SIDE_PANEL quoted revision, cloud execution, preserved original and revised download; synthetic business/model content",delivery);await recording.start();
    await evaluate("document.querySelector('.revision-dialog form').requestSubmit();true");await until(()=>evaluate("document.querySelector('.revision-dialog')?.textContent.includes('Revision recorded')"),Boolean,"Recorded original side-panel revision");
    const extensionTask=await until(async()=>(await system.db.control.query("SELECT id FROM tasks WHERE parent_id=$1 AND input_context?'delivery_revision' ORDER BY created_at DESC LIMIT 1",[extensionWork.task.id])).rows[0],Boolean,"One side-panel revision task");await completeRevision(extensionTask.id,extensionWork.task.id,"text");
    await evaluate("[...document.querySelectorAll('.revision-dialog button')].find(b=>b.textContent==='View revision').click();true");await click("#chat-refresh");await until(()=>evaluate("document.querySelector('#chat-messages').textContent.includes('Your revised campaign is ready. The original files are retained.')"),Boolean,"Original panel conversation receives revised output");
    pass("Extension: real login and original-chat quoted revision keep the same cloud conversation, role and confirmed budget");
    await click("#locale");await until(()=>evaluate("document.documentElement.lang"),v=>v==="zh-Hant-HK","Side-panel Chinese language");screenshots.push(await saveWorkmateScreenshot("extension",`delivery-revision-138-${attempt}`,"revised-conversation-zh",await capture(),"Actual bilingual right-panel revised cloud conversation",delivery));
    await evaluate(`document.querySelector('[data-message]');[...document.querySelectorAll('#chat-messages article')].filter(a=>a.textContent.includes('Your revised campaign is ready.')).at(-1).querySelectorAll('button')[1].click();true`);
    const saved=await until(()=>worker.evaluate(task=>chrome.downloads.search({filenameRegex:"workmate-"+task+"-v"}),extensionTask.id),v=>v.some((d:any)=>d.state==="complete"),"Native Chrome download of revised delivery",60000),item=saved.find((d:any)=>d.state==="complete");await validateArchive("extension",item.filename,extensionTask.id);screenshots.push(await saveWorkmateScreenshot("extension",`delivery-revision-138-${attempt}`,"revised-delivery-downloaded",await capture(),"Actual revised package downloaded by native Chrome manager",delivery));
    await stopRecording();const layout=await evaluate("({client:'extension',width:innerWidth,horizontal:document.documentElement.scrollWidth>innerWidth+1})");assert.equal(layout.horizontal,false);layouts.push(layout);pass("Extension: revised cloud ZIP independently extracts with exact hashes, and the native right panel has no horizontal overflow");
  }catch(error){diagnostics.push({client:"extension",visible:await evaluate("({body:document.body.textContent,error:document.querySelector('#error').textContent})").catch(String)});throw error;}
  finally{await panel.close();await cdp.detach();}
  await extensionContext.close();extensionContext=undefined;extensionClosed=true;
  for(const original of originals){const current=(await system.db.control.query("SELECT output,charged_micros::text,version FROM tasks WHERE id=$1",[original.id])).rows[0];assert.deepEqual(current,{output:original.output,charged_micros:original.charged_micros,version:original.version});}
  assert.ok(providerCalls>=7);assert.equal(providerError,null);pass("All three clients retain original delivery bytes, task versions and charges; actual local Codex reads and writes only its granted workspace");
}catch(error){failure=String(error);console.error(stage+": "+failure);if(browser)for(const c of browser.contexts())for(const page of c.pages())try{diagnostics.push({client:"web",url:page.url(),body:(await page.locator("body").innerText({timeout:3000})).slice(0,18000)});}catch{};if(electron)try{const page=electron.windows()[0];if(page)diagnostics.push({client:"desktop",url:page.url(),text:(await page.locator("body").innerText({timeout:3000})).slice(0,12000)});}catch(e){diagnostics.push({error:String(e)});}}
finally{
  await stopRecording().catch(e=>{failure??=String(e);});
  if(electron)try{await electron.close();desktopClosed=true;}catch(e){failure??=String(e);}
  if(extensionContext)try{await extensionContext.close();extensionClosed=true;}catch(e){failure??=String(e);}
  if(browser)try{await browser.close();browserClosed=true;}catch(e){failure??=String(e);}
  if(system)try{await system.app.close();apiClosed=true;}catch(e){failure??=String(e);}
  provider.closeAllConnections();if(provider.listening)await new Promise<void>(resolve=>provider.close(()=>resolve()));providerClosed=true;
  if(isolated)try{await isolated.cleanup();fixtureClosed=true;}catch(e){failure??=String(e);}process.chdir(delivery);
}
const passed=!failure&&errors.length===0&&checks.length===9&&screenshots.length===11&&archives.length===3&&recordings.length===3&&layouts.length===7&&recordings.every(r=>r.distinct_frames>1&&r.skipped_capture_errors===0)&&browserClosed&&extensionClosed&&desktopClosed&&apiClosed&&fixtureClosed&&providerClosed;
const result={at:new Date().toISOString(),status:passed?"passed":"failed",stage,failure,checks,screenshots,recordings,archives,layouts,errors,diagnostics,provider_calls:providerCalls,provider_error:providerError,browser_closed:browserClosed,extension_closed:extensionClosed,desktop_closed:desktopClosed,api_closed:apiClosed,fixture_closed:fixtureClosed,provider_closed:providerClosed,
  model_mode:"Explicit synthetic business data and controlled OpenAI-compatible model responses; actual login, RLS, source version checks, worker execution, actual packaged local Codex, native file changes and permission revocation, actual native right SIDE_PANEL and actual ZIP downloads. Image/video region anchors identify feedback; this journey does not qualify professional media edit quality."};
await writeFile(prefix+"-journey.json",JSON.stringify(result,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({status:result.status,checks:checks.length,failure}));process.exitCode=passed?0:1;
