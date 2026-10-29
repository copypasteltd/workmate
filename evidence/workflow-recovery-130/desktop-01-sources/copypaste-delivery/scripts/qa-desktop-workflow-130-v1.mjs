import assert from "node:assert/strict";
import { DesktopWorkflowModelFixture } from "./desktop-workflow-model-fixture.ts";
import { chromium, _electron } from "playwright";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.ts";

const delivery = process.cwd(), platform = path.resolve("../copypaste-platform-publication-125"), attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const prefix = path.resolve("evidence/workflow-recovery-130/desktop-" + attempt), owned = path.resolve(".data/workflow-recovery-130", randomUUID());
await mkdir(owned, { recursive: true });
const workspace = path.join(owned, "customer-workspace"); await mkdir(workspace);
const load = name => import(pathToFileURL(path.join(platform, name)).href);
const checks = [], errors = [], screenshots = [], recordings = [], layouts = [], layoutAttempts = [];
const startupObservations = [];
const pass = name => { checks.push(name); console.log("PASS: " + name); };
let system, isolated, electron, browser, recording, page, stage = "setup", providerCalls = 0;
let browserClosed = false, desktopClosed = false, apiClosed = false, fixtureClosed = false, providerClosed = false;
let failure, observations, model;
async function until(read, ok, name, ms = 40000) {
  const deadline = Date.now() + ms;
  do { const value = await read(); if (ok(value)) return value; await new Promise(resolve => setTimeout(resolve, 150)); } while (Date.now() < deadline);
  throw new Error("Timed out: " + name);
}
const provider = createServer(async (req, res) => {
  try {
    const bytes = []; for await (const part of req) bytes.push(Buffer.from(part));
    assert.equal(req.headers.authorization, "Bearer synthetic-workflow-ui-130");
    const body = JSON.parse(Buffer.concat(bytes).toString()); assert.equal(body.model, "desktop-workflow-ui-synthetic");
    if (req.url === "/v1/responses/input_tokens") { res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ object: "response.input_tokens", input_tokens: 10 })); return; }
    assert.equal(req.url, "/v1/responses"); providerCalls++;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const emit = (type, value) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
    const response = { id: "resp_workflow_ui_" + providerCalls, object: "response", model: body.model, created_at: 1, status: "in_progress", output: [] };
    const item = model.next(body, providerCalls); assert.ok(item);
    await writeFile(path.join(owned, "provider-" + providerCalls + ".json"), JSON.stringify({ request: body, item }), { flag: "wx" });
    emit("response.created", { response }); emit("response.output_item.added", { output_index: 0, item });
    if (item.type === "message") emit("response.output_text.delta", { output_index: 0, item_id: item.id, content_index: 0, delta: item.content[0].text });
    emit("response.output_item.done", { output_index: 0, item });
    emit("response.completed", { response: { ...response, status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } } });
    res.end();
  } catch (error) { errors.push("Provider fixture: " + String(error)); res.destroy(); }
});
async function stopRecording() { if (recording) { const value = recording; recording = undefined; recordings.push(await value.stop()); } }
try {
  await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
  const [{ isolatedTestEnvironment }, { buildApp }, { loadConfig }, { defaults }] = await Promise.all([
    load("tests/native-test-environment.ts"), load("src/server.ts"), load("src/config.ts"), load("src/plans.ts"),
  ]);
  process.chdir(platform); isolated = await isolatedTestEnvironment();
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "false", DEV_MAILBOX: "true", WORKER_ENABLED: "false",
    API_ORIGIN: "http://localhost:4310", WEB_ORIGIN: "http://localhost:4317", ADMIN_ORIGIN: "http://localhost:4318",
    AI_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "synthetic-workflow-ui-130",
    AI_MODEL: "desktop-workflow-ui-synthetic", AI_VERIFIED: "true", AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000",
    AI_INPUT_COUNT_VERIFIED: "true", AI_INPUT_COUNT_HKD_MICROS_PER_CALL: "0", AI_SCOPE_TTL_MS: "300000" }), { worker: false });
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true });
  const context = await browser.newContext();
  electron = await _electron.launch({ executablePath: process.env.COPYPASTE_LOCAL_DESKTOP_CANDIDATE, env: { ...process.env, COPYPASTE_USER_DATA: path.join(owned, "desktop") } });
  page = await electron.firstWindow(); page.setDefaultTimeout(30000); page.on("pageerror", error => errors.push(error.message));
  await page.waitForURL(/^file:/); await page.waitForFunction(() => !!window.copyPasteBridge);
  const windowId = await (await electron.browserWindow(page)).evaluate(win => win.id);
  await electron.evaluate((_, id) => { globalThis.__startupWindowId = id; }, windowId);
  await page.evaluate(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); }); await page.reload();
  await electron.evaluate(({ shell, dialog }, workspace) => {
    shell.openExternal = async url => { globalThis.__startupAuth = url; };
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] });
    globalThis.__startupConsent = 0;
    dialog.showMessageBox = async () => ({ response: globalThis.__startupConsent, checkboxChecked: false });
  }, workspace);
  stage = "actual browser sign-in and native onboarding";
  await page.getByRole("button", { name: "Sign in securely in your browser", exact: true }).click();
  const auth = await context.newPage(); await auth.goto(await until(() => electron.evaluate(() => globalThis.__startupAuth), Boolean, "PKCE authorization"));
  await auth.locator('input[name="email"]').fill(`workflow130-${randomUUID()}@example.invalid`);
  const [challenge] = await Promise.all([auth.waitForResponse(response => new URL(response.url()).pathname === "/v1/auth/challenges"), auth.locator('form button[type="submit"]').click()]);
  assert.equal(challenge.status(), 202);
  const mail = JSON.parse(await readFile(path.join(isolated.directory, "mailbox", (await challenge.json()).challenge_id + ".json"), "utf8"));
  await auth.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]); await auth.locator('form button[type="submit"]').click();
  await auth.getByRole("link", { name: /Authorize & return|授權並返回應用/ }).click();
  const api = async (url, method = "GET", body) => {
    const response = await page.evaluate(async input => window.copyPasteBridge.request(input.url, { method: input.method, ...(input.body === undefined ? {} : { body: input.body }), headers: { "idempotency-key": input.key } }), { url, method, body, key: randomUUID() });
    assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body;
  };
  await until(() => page.evaluate(async () => (await window.copyPasteBridge.request("/v1/session/context", {})).status), value => value === 200, "native login"); await auth.close();
  await page.locator('input[name="name"]').fill("Harbour Studio"); await page.locator('input[name="project_name"]').fill("Local workspace");
  await page.getByRole("button", { name: "Create workspace & continue", exact: true }).click();
  const identity = await until(() => api("/v1/session/context"), value => value.memberships?.length === 1, "workspace context");
  const tenant = identity.memberships[0].id, project = (await api(`/v1/tenants/${tenant}/projects`)).items[0].id;
  await system.db.control.query("UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1", [tenant]);
  await system.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Explicit synthetic startup fixture; no payment received',$2)", [tenant, defaults.business]);
  pass("Packaged Desktop completes browser OTP/PKCE and customer workspace onboarding");
  stage = "customer-local workflow permission";
  const outside = path.join(owned, "explicitly-approved-outside.txt");
  model = new DesktopWorkflowModelFixture(workspace, outside); model.begin("execute");
  await page.evaluate(route => { location.hash = route; }, `/app/local?tenant=${tenant}&project=${project}`);
  await page.getByRole("heading", { name: "Your local workmate", exact: true }).waitFor();
  const list = async () => { const reply = await page.evaluate(scope => window.copyPasteBridge.localAgent("list", scope), { tenant, project }); assert.equal(reply.ok, true, JSON.stringify(reply)); return reply.value.sessions[0]; };
  await page.getByLabel("Local specialist", { exact: true }).selectOption("workflow-consultant");
  await page.getByRole("button", { name: "Choose folder to start", exact: true }).click(); await until(list, Boolean, "customer workflow session");
  await page.getByLabel("Local permission", { exact: true }).selectOption("full-access"); await page.getByRole("button", { name: "Set permission", exact: true }).click();
  await until(() => page.getByRole("button", { name: "Set permission", exact: true }).isEnabled(), Boolean, "refused consent returns to idle");
  assert.equal((await list()).permission, null); assert.equal(providerCalls, 0);
  await electron.evaluate(() => { globalThis.__startupConsent = 1; });
  await page.getByRole("button", { name: "Set permission", exact: true }).click();
  await until(list, value => value?.permission === "full-access", "explicit native full-access permission");
  pass("Explicit native consent is required; refusal starts no model or child task");
  await electron.evaluate((_, workspace) => {
    const cp = process.getBuiltinModule("child_process"), original = cp.spawn;
    const expected = process.getBuiltinModule("path").resolve(process.resourcesPath, "local-codex/codex.exe").toLowerCase();
    globalThis.__startupRows = [];
    cp.spawn = function(file, args, options) {
      const child = original(file, args, options);
      if (String(file).toLowerCase() === expected && args?.[0] === "app-server" && options?.cwd === workspace) {
        const row = { pid: child.pid, closed: false, rpc: [], index: globalThis.__startupRows.length + 1 }; globalThis.__startupRows.push(row);
        const stream = child.stdin, write = stream.write, timers = new Set();
        stream.write = function(...parts) {
          let request; try { request = JSON.parse(Buffer.isBuffer(parts[0]) ? parts[0].toString() : parts[0]); } catch {}
          if (["initialize", "thread/start", "thread/resume"].includes(request?.method)) {
            row.rpc.push({ method: request.method, at: Date.now() });
            if ((row.index === 2 && request.method === "initialize") || (row.index === 4 && request.method === "thread/start")) {
              const done = parts.find((part,index) => index > 0 && typeof part === "function");
              if(done) queueMicrotask(() => done()); child.kill("SIGKILL"); return true;
            }
            const timer = setTimeout(() => { timers.delete(timer); Reflect.apply(write, stream, parts); }, 1500); timers.add(timer); return true;
          }
          return Reflect.apply(write, stream, parts);
        };
        child.once("close", () => { row.closed = true; for(const timer of timers) clearTimeout(timer); });
      }
      return child;
    }; process.getBuiltinModule("module").syncBuiltinESMExports();
  }, workspace);
  let capturing = Promise.resolve();
  const capture = (jpeg=false) => { const work = capturing.then(async () => Buffer.from(await electron.evaluate(async ({ BrowserWindow }, jpeg) => { const image = await BrowserWindow.fromId(globalThis.__startupWindowId).webContents.capturePage(); return (jpeg ? image.toJPEG(75) : image.toPNG()).toString("base64"); }, jpeg), "base64")); capturing=work.then(()=>{},()=>{}); return work; };
  const shot = async name => screenshots.push(await saveWorkmateScreenshot("desktop-publication-125", "workflow-recovery-130-"+attempt, name, await capture(), "Actual unsigned packaged frameless Desktop; real pinned local Codex children, local shell files and company SQL fees. Synthetic model choices, native dialog decisions and injected startup transport faults.", delivery));
  recording = new WorkmateRecording("desktop-publication-125", "parent-child-startup-recovery", "workflow-recovery-130-"+attempt, ()=>capture(true), "Actual wall-clock Desktop workflow: explicit child fee card, two real local children with startup recovery, intervening human approval and original company receipts. Model and dialog choices synthetic.", delivery);
  await recording.start();
  await page.getByLabel("Local task", { exact: true }).fill("Create a local checklist with the developer, wait for my approval, then ask QA to verify it. Keep the original task and fees if a child reconnects. Deliver SOP, workflow JSON and recovery notes.");
  await page.getByRole("button", { name:"Start work", exact:true }).click();
  stage="actual child fee card";
  const pending = await until(list, value=>value?.busy && value.inputs?.some(input=>input.questions[0]?.id==="workflow_decision"), "child fee confirmation",180000);
  assert.ok(pending.inputs[0].questions[0].question.includes("HK$ 0.20"));
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE desktop_workflow_run_id IN (SELECT id FROM workflow_runs WHERE origin_task_id=$1)",[pending.task.task_id])).rows[0].n,0);
  const form=()=>page.getByRole("form",{name:"Answer task questions",exact:true});
  await form().scrollIntoViewIfNeeded(); await shot("child-fee-confirmation-en");
  pass("Customer sees separate child fee limits before any child is reserved or started");
  await form().getByRole("radio").first().check(); await form().getByRole("button",{name:"Answer and continue",exact:true}).click();
  stage="first real recovered child and human review";
  const approval=await until(list,value=>value?.inputs?.some(input=>input.questions[0]?.header==="流程審批 / Workflow approval"),"actual human approval",180000);
  assert.equal(await readFile(path.join(workspace,"native-flow-checklist.txt"),"utf8"),"native-checklist-verified");
  assert.equal(await readFile(outside,"utf8"),"native-child-full-access");
  await form().scrollIntoViewIfNeeded(); await shot("recovered-developer-human-review-en");
  pass("Recovered native developer writes the actual approved local files before human review; QA remains gated");
  await form().getByRole("radio").first().check(); await form().getByRole("button",{name:"Answer and continue",exact:true}).click();
  stage="second recovered child and original receipts";
  const complete=await until(list,value=>!value?.busy && value?.task?.task_id===approval.task.task_id && value.task.status==="succeeded","actual native workflow completion",180000);
  assert.equal(await readFile(path.join(workspace,"native-flow-qa.txt"),"utf8"),"native-checklist-verified-qa");
  const run=(await system.db.control.query("SELECT * FROM workflow_runs WHERE origin_task_id=$1",[complete.task.task_id])).rows[0];
  const tasks=(await system.db.control.query("SELECT t.*,d.startup_attempt FROM tasks t JOIN desktop_executions d ON d.task_id=t.id WHERE t.id=$1 OR t.desktop_workflow_run_id=$2",[complete.task.task_id,run.id])).rows;
  assert.equal(run.state,"succeeded");assert.equal(run.cursor,3);assert.equal(tasks.length,3);
  assert.ok(tasks.every(task=>task.status==="succeeded" && task.execution_location==="desktop" && task.attempt===1));
  assert.ok(tasks.filter(task=>task.desktop_workflow_run_id).every(task=>task.startup_attempt===2 && task.charged_micros==="60"));
  assert.equal(tasks.reduce((sum,task)=>sum+Number(task.charged_micros),0),providerCalls*30);
  for(const task of tasks){assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM reservations WHERE task_id=$1",[task.id])).rows[0].n,1);assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'",[task.id])).rows[0].n,1);}
  const recoveries=(await system.db.control.query("SELECT * FROM desktop_startup_recoveries WHERE task_id=ANY($1::uuid[])",[tasks.map(task=>task.id)])).rows;
  assert.equal(recoveries.length,2);assert.ok(recoveries.every(row=>row.state==="ready" && row.proof.safe && row.proof.model_requests===0 && row.proof.input_count_requests===0 && row.proof.company_tool_admissions===0));
  const rows=await electron.evaluate(()=>globalThis.__startupRows);assert.equal(rows.length,5);assert.ok(rows.every(row=>row.closed));
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM outbox WHERE topic='task.run' AND payload->>'task_id'=ANY($1::text[])",[tasks.map(task=>task.id)])).rows[0].n,0);
  await page.getByLabel("Local workflow progress",{exact:true}).getByText("Workflow completed",{exact:true}).waitFor();
  await page.getByLabel("Local workflow progress",{exact:true}).scrollIntoViewIfNeeded();await shot("two-recovered-children-completed-en");await stopRecording();
  pass("Both real local children recover once, finish actual shell work, preserve three original reservations and exact charges, and close all five owned Codex processes");
  stage="private workflow downloads";
  const downloads=path.join(owned,"downloads");await mkdir(downloads);
  await electron.evaluate(({dialog},folder)=>{dialog.showSaveDialog=async(...args)=>{const filename=String(args.at(-1).defaultPath).split(/[\\/]/).at(-1);if(!["SOP.md","workflow.json","recovery.md"].includes(filename))throw new Error("Unexpected owned download");return {canceled:false,filePath:folder+"/"+filename};};},downloads);
  for(const filename of ["SOP.md","workflow.json","recovery.md"]){await page.getByLabel("Project artifacts",{exact:true}).getByRole("button",{name:filename+" · v1",exact:true}).click();await until(()=>readFile(path.join(downloads,filename),"utf8").catch(()=>""),Boolean,"native download "+filename);}
  assert.deepEqual(JSON.parse(await readFile(path.join(downloads,"workflow.json"),"utf8")),model.definition);assert.match(await readFile(path.join(downloads,"SOP.md"),"utf8"),/human approval/);assert.match(await readFile(path.join(downloads,"recovery.md"),"utf8"),/Never replay/);
  pass("Customer downloads exact private SOP, frozen executable workflow JSON and recovery notes through native save dialogs");
  await page.evaluate(()=>localStorage.setItem("cp_locale","zh"));await page.reload();await page.getByLabel("本機流程進度",{exact:true}).getByText("流程已完成",{exact:true}).waitFor();await page.getByLabel("本機流程進度",{exact:true}).scrollIntoViewIfNeeded();await shot("two-recovered-children-completed-zh");
  await page.evaluate(()=>localStorage.setItem("cp_locale","en"));await page.reload();await page.getByRole("heading",{name:"Your local workmate",exact:true}).waitFor();
  pass("English and Chinese reload preserve actual local workflow history and company receipts");
  stage="native window layouts";
  for(const width of [1000,1240,1440]){
    await electron.evaluate(({BrowserWindow},width)=>{const win=BrowserWindow.fromId(globalThis.__startupWindowId);win.setFullScreen(false);win.unmaximize();if(win.isMinimized())win.restore();win.webContents.setZoomFactor(1);win.setBounds({width,height:980},false);},width);
    await until(()=>page.evaluate(()=>innerWidth),value=>value===width,"actual native width");
    const native=await electron.evaluate(({BrowserWindow,Menu})=>{const win=BrowserWindow.fromId(globalThis.__startupWindowId);return {bounds:win.getBounds(),content:win.getContentBounds(),menu:Menu.getApplicationMenu()===null,menu_visible:win.isMenuBarVisible()};});
    const view=await page.evaluate(()=>({width:innerWidth,horizontal:document.documentElement.scrollWidth>innerWidth,visible_scrollbars:[...document.querySelectorAll("body *")].filter(node=>node.getClientRects().length && node.scrollHeight>node.clientHeight+1 && /auto|scroll/.test(getComputedStyle(node).overflowY) && getComputedStyle(node).scrollbarWidth!=="none" && getComputedStyle(node,"::-webkit-scrollbar").display!=="none").map(node=>String(node.className))}));
    assert.deepEqual(native.bounds,native.content);assert.equal(native.menu,true);assert.equal(native.menu_visible,false);assert.equal(view.horizontal,false);assert.deepEqual(view.visible_scrollbars,[]);layouts.push({...view,native});
  }
  pass("Actual frameless Desktop has no default menu, visible scroll rails or horizontal overflow at three native window widths");
  observations={root_task:complete.task.task_id,workflow_run:run.id,tasks:tasks.map(task=>({id:task.id,role:task.role_key,startup_attempt:task.startup_attempt,charged_micros:task.charged_micros})),native_processes:rows,zero_admission_proofs:recoveries.map(row=>row.proof),provider_calls:providerCalls,tool_observations:model.observations};
} catch (error) {
  failure = String(error); errors.push(stage + ": " + failure); console.error(stage + ": " + failure);
  if (electron && page) try {
    const bytes = Buffer.from(await electron.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.fromId(globalThis.__startupWindowId).webContents.capturePage()).toPNG().toString('base64')), 'base64');
    screenshots.push(await saveWorkmateScreenshot('desktop-publication-125', 'workflow-recovery-130-' + attempt, 'failure-state', bytes, 'Unedited diagnostic capture from failed actual packaged Desktop qualification', delivery));
  } catch (captureError) { errors.push('Failure capture: ' + String(captureError)); }
}
finally {
  await stopRecording().catch(error => errors.push("Recording: " + String(error)));
  if (electron) { const pid = electron.process().pid; await electron.close().then(() => { desktopClosed = true; }, error => errors.push(String(error))); if (desktopClosed) assert.throws(() => process.kill(pid, 0)); }
  if (browser) await browser.close().then(() => { browserClosed = true; }, error => errors.push(String(error)));
  if (system) await system.app.close().then(() => { apiClosed = true; }, error => errors.push(String(error)));
  if (isolated) await isolated.cleanup().then(() => { fixtureClosed = true; }, error => errors.push(String(error)));
  provider.closeAllConnections(); await new Promise(resolve => provider.close(() => { providerClosed = true; resolve(); }));
  const passed = !failure && errors.length === 0 && checks.length === 8 && browserClosed && desktopClosed && apiClosed && fixtureClosed && providerClosed;
  await writeFile(prefix + "-journey.json", JSON.stringify({ at: new Date().toISOString(), status: passed ? "passed" : "failed", stage, checks, errors, observations, startup_observations: startupObservations, screenshots, recordings, layouts, layout_attempts: layoutAttempts, browser_closed: browserClosed, desktop_closed: desktopClosed, api_closed: apiClosed, fixture_closed: fixtureClosed, provider_closed: providerClosed,
    limits: ["Unsigned Windows test package; synthetic model and native dialog decisions", "Two bounded child startup recoveries; no full crash, multi-node, live provider or professional-role qualification"] }, null, 2) + "\n", { flag: "wx" });
  process.exitCode = passed ? 0 : 1;
}
