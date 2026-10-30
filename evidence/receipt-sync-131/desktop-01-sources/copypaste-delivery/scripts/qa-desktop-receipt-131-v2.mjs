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
const prefix = path.resolve("evidence/receipt-sync-131/desktop-" + attempt), owned = path.resolve(".data/receipt-sync-131", randomUUID());
await mkdir(owned, { recursive: true });
const workspace = path.join(owned, "customer-workspace"); await mkdir(workspace);
const load = name => import(pathToFileURL(path.join(platform, name)).href);
const checks = [], errors = [], screenshots = [], recordings = [], layouts = [], layoutAttempts = [];
const startupObservations = [];
const pass = name => { checks.push(name); console.log("PASS: " + name); };
let system, isolated, electron, browser, recording, page, stage = "setup", providerCalls = 0;
let browserClosed = false, desktopClosed = false, apiClosed = false, fixtureClosed = false, providerClosed = false;
let failure, observations, model, receiptOffline = true, lostFinishResponses = 0;
async function until(read, ok, name, ms = 40000) {
  const deadline = Date.now() + ms;
  do { const value = await read(); if (ok(value)) return value; await new Promise(resolve => setTimeout(resolve, 150)); } while (Date.now() < deadline);
  throw new Error("Timed out: " + name);
}
const provider = createServer(async (req, res) => {
  try {
    const bytes = []; for await (const part of req) bytes.push(Buffer.from(part));
    assert.equal(req.headers.authorization, "Bearer synthetic-receipt-ui-131");
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
    AI_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "synthetic-receipt-ui-131",
    AI_MODEL: "desktop-workflow-ui-synthetic", AI_VERIFIED: "true", AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000",
    AI_INPUT_COUNT_VERIFIED: "true", AI_INPUT_COUNT_HKD_MICROS_PER_CALL: "0", AI_SCOPE_TTL_MS: "300000" }), { worker: false });
  system.app.addHook("onSend", async (req, reply, payload) => {
    const match = req.url.match(/\/desktop-executions\/([a-f0-9-]+)\/finish$/);
    if (receiptOffline && match) {
      const task = (await system.db.control.query("SELECT role_key FROM tasks WHERE id=$1", [match[1]])).rows[0];
      if (task?.role_key === "fullstack") {
        lostFinishResponses++; reply.hijack(); reply.raw.destroy();
      }
    }
    return payload;
  });
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
  await auth.locator('input[name="email"]').fill(`receipt131-${randomUUID()}@example.invalid`);
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
    globalThis.__receiptNative = [];
    cp.spawn = function(file, args, options) {
      const child = original(file, args, options);
      if (String(file).toLowerCase() === expected && args?.[0] === "app-server" && options?.cwd === workspace) {
        const row = { pid: child.pid, closed: false }; globalThis.__receiptNative.push(row);
        child.once("close", code => { row.closed = true; row.exit_code = code; });
      }
      return child;
    }; process.getBuiltinModule("module").syncBuiltinESMExports();
  }, workspace);
  let capturing = Promise.resolve();
  const capture = (jpeg=false) => { const work = capturing.then(async () => Buffer.from(await electron.evaluate(async ({ BrowserWindow }, jpeg) => {
    const image = await BrowserWindow.fromId(globalThis.__startupWindowId).webContents.capturePage();
    return (jpeg ? image.toJPEG(75) : image.toPNG()).toString("base64");
  }, jpeg), "base64")); capturing=work.then(()=>{},()=>{}); return work; };
  const shot = async name => screenshots.push(await saveWorkmateScreenshot("desktop-publication-125", "receipt-sync-131-"+attempt, name, await capture(),
    "Actual unsigned packaged frameless Desktop; pinned local Codex and real files/SQL billing. Synthetic model and dialog choices; actual HTTP finish responses dropped after server commit.", delivery));
  const startRecording = async name => { recording = new WorkmateRecording("desktop-publication-125", name, "receipt-sync-131-"+attempt, ()=>capture(true),
    "Actual wall-clock packaged Desktop: saved child result survives lost HTTP responses, local grant withdrawal and a full application restart. Receipt synchronization starts no further native work or model request.", delivery); await recording.start(); };
  await startRecording("receipt-loss-and-permission-withdrawal");
  await page.getByLabel("Local task", { exact: true }).fill("Create a local developer checklist, then wait for my review before QA. Retain the original results and fees if synchronization is interrupted.");
  await page.getByRole("button", { name:"Start work", exact:true }).click();
  stage = "actual separate child fee card";
  const pending = await until(list, row=>row?.inputs?.some(input=>input.questions[0]?.id==="workflow_decision"), "child fee confirmation", 180000);
  assert.ok(pending.inputs[0].questions[0].question.includes("HK$ 0.20"));
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE desktop_workflow_run_id IN (SELECT id FROM workflow_runs WHERE origin_task_id=$1)", [pending.task.task_id])).rows[0].n, 0);
  const form = page.getByRole("form", { name:"Answer task questions", exact:true }); await form.scrollIntoViewIfNeeded(); await shot("child-fee-confirmation-en");
  pass("Separate child fees require customer confirmation before any child task is reserved");
  await form.getByRole("radio").first().check(); await form.getByRole("button", { name:"Answer and continue", exact:true }).click();
  stage = "actual lost child finish HTTP responses";
  const waiting = await until(list, row=>row?.receiptPending && !row.busy && row.phase==="settling", "durable pending child receipt", 180000);
  assert.ok(lostFinishResponses >= 2); assert.equal(waiting.uncertain, true);
  assert.equal(await readFile(path.join(workspace, "native-flow-checklist.txt"), "utf8"), "native-checklist-verified");
  assert.equal(await readFile(outside, "utf8"), "native-child-full-access");
  await assert.rejects(readFile(path.join(workspace, "native-flow-qa.txt")), error=>error.code==="ENOENT");
  const run = (await system.db.control.query("SELECT * FROM workflow_runs WHERE origin_task_id=$1", [waiting.task.task_id])).rows[0];
  const children = (await system.db.control.query("SELECT t.*,d.state AS native_state,d.client_report FROM tasks t JOIN desktop_executions d ON d.task_id=t.id WHERE t.desktop_workflow_run_id=$1", [run.id])).rows;
  assert.equal(children.length, 1); const child = children[0]; assert.equal(child.status, "succeeded"); assert.equal(child.charged_micros, "60");
  const nativeRows = await electron.evaluate(()=>globalThis.__receiptNative); assert.equal(nativeRows.length, 2); assert.ok(nativeRows.every(row=>row.closed));
  await page.getByRole("button", { name:"Sync saved receipts", exact:true }).waitFor();
  await page.getByText("Local work has stopped. Saved results and billing records are awaiting synchronization. Reconnect to sync receipts without granting local access again.", { exact:true }).scrollIntoViewIfNeeded();
  await shot("saved-receipts-pending-en");
  pass("Real local developer finishes once; lost HTTP acknowledgements retain its result, close both Codex processes and prevent QA");
  stage = "withdraw permission while receipts remain pending";
  await page.getByRole("button", { name:"Revoke local permission", exact:true }).click();
  await until(list, row=>row.revoked && row.receiptPending, "withdrawn local grant retains saved receipt");
  await page.evaluate(()=>localStorage.setItem("cp_locale", "zh")); await page.reload();
  await page.getByRole("button", { name:"同步已儲存的回執", exact:true }).waitFor();
  await page.getByText("本機工作已停止，已儲存的結果與費用記錄等待同步。恢復連線後可同步回執，無需重新授予本機權限。", { exact:true }).scrollIntoViewIfNeeded();
  await shot("revoked-receipts-pending-zh"); await stopRecording();
  pass("Permission withdrawal and Chinese renderer reload preserve the pending receipt and its synchronization action");
  stage = "actual packaged application restart";
  const originalPid = electron.process().pid; await electron.close(); assert.throws(()=>process.kill(originalPid, 0)); electron = undefined;
  electron = await _electron.launch({ executablePath:process.env.COPYPASTE_LOCAL_DESKTOP_CANDIDATE, env:{...process.env, COPYPASTE_USER_DATA:path.join(owned, "desktop")} });
  page = await electron.firstWindow(); page.setDefaultTimeout(30000); page.on("pageerror", error=>errors.push(error.message));
  await page.waitForURL(/^file:/); await page.waitForFunction(()=>!!window.copyPasteBridge);
  const restartedWindowId = await (await electron.browserWindow(page)).evaluate(win=>win.id);
  await electron.evaluate(({dialog}, id)=>{
    globalThis.__startupWindowId = id; globalThis.__receiptUnexpectedNative = 0; globalThis.__receiptUnexpectedConsent = 0;
    dialog.showMessageBox = async()=>{ globalThis.__receiptUnexpectedConsent++; throw new Error("Receipt synchronization cannot request new local consent"); };
    const cp=process.getBuiltinModule("child_process"), original=cp.spawn;
    const expected=process.getBuiltinModule("path").resolve(process.resourcesPath,"local-codex/codex.exe").toLowerCase();
    cp.spawn=function(file,...args){ if(String(file).toLowerCase()===expected){globalThis.__receiptUnexpectedNative++;throw new Error("Receipt synchronization cannot start Codex");} return original(file,...args); };
    process.getBuiltinModule("module").syncBuiltinESMExports();
  }, restartedWindowId);
  await page.evaluate(()=>localStorage.setItem("cp_locale", "en")); await page.reload();
  await page.getByRole("button", { name:"Sync saved receipts", exact:true }).waitFor();
  const restored = await list(); assert.equal(restored.id, waiting.id); assert.equal(restored.revoked, true); assert.equal(restored.receiptPending, true);
  assert.equal(restored.task.task_id, waiting.task.task_id);
  pass("Full packaged application restart restores the original account-bound receipt with its local permission still revoked");
  await startRecording("receipt-sync-after-application-restart");
  const callsBeforeSync = providerCalls; receiptOffline = false;
  await page.getByRole("button", { name:"Sync saved receipts", exact:true }).click();
  const complete = await until(list, row=>!row.busy && !row.receiptPending && row.phase==="idle", "original child and parent receipts synchronized");
  assert.equal(complete.uncertain, true); assert.equal(complete.revoked, true); assert.equal(complete.task.status, "reconciling");
  assert.equal(providerCalls, callsBeforeSync);
  const unexpected = await electron.evaluate(()=>({ native:globalThis.__receiptUnexpectedNative, consent:globalThis.__receiptUnexpectedConsent })); assert.deepEqual(unexpected, {native:0,consent:0});
  const tasks = (await system.db.control.query("SELECT t.*,d.state AS native_state FROM tasks t JOIN desktop_executions d ON d.task_id=t.id WHERE t.id=$1 OR t.desktop_workflow_run_id=$2", [complete.task.task_id, run.id])).rows;
  assert.equal(tasks.length, 2);
  assert.equal(tasks.find(task=>task.id===child.id).charged_micros, "60");
  assert.equal(tasks.reduce((sum, task)=>sum+Number(task.accrued_micros), 0), providerCalls*30);
  assert.equal(tasks.reduce((sum, task)=>sum+Number(task.charged_micros), 0), 60);
  const reservations=(await system.db.control.query("SELECT task_id,status,amount_micros FROM reservations WHERE task_id=ANY($1::uuid[])",[tasks.map(task=>task.id)])).rows;
  assert.equal(reservations.length,2);assert.equal(reservations.find(row=>row.task_id===child.id).status,"settled");assert.equal(reservations.find(row=>row.task_id===complete.task.task_id).status,"reconciling");
  for (const task of tasks) {
    assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM reservations WHERE task_id=$1", [task.id])).rows[0].n, 1);
    assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'", [task.id])).rows[0].n, task.id===child.id?1:0);
  }
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM outbox WHERE topic='task.run' AND payload->>'task_id'=ANY($1::text[])", [tasks.map(task=>task.id)])).rows[0].n, 0);
  await page.getByText("The last local outcome needs review and will not be replayed. Check local files and the billing record.", {exact:true}).scrollIntoViewIfNeeded();
  await until(()=>page.getByRole("button", {name:"Sync saved receipts",exact:true}).count(), count=>count===0, "synchronization action removed after acknowledgement");
  await shot("original-receipts-synchronized-en");
  await new Promise(resolve=>setTimeout(resolve, 1800)); await stopRecording();
  pass("Customer syncs the original receipts after restart without renewed permission, native execution, model usage, another reservation or duplicate charges");
  stage = "native window layouts";
  for (const width of [1000,1240,1440]) {
    await electron.evaluate(({BrowserWindow}, width)=>{const win=BrowserWindow.fromId(globalThis.__startupWindowId);win.setFullScreen(false);win.unmaximize();if(win.isMinimized())win.restore();win.webContents.setZoomFactor(1);win.setBounds({width,height:980},false);}, width);
    await until(()=>page.evaluate(()=>innerWidth), value=>value===width, "actual native width");
    const native=await electron.evaluate(({BrowserWindow,Menu})=>{const win=BrowserWindow.fromId(globalThis.__startupWindowId);return {bounds:win.getBounds(),content:win.getContentBounds(),menu:Menu.getApplicationMenu()===null,menu_visible:win.isMenuBarVisible()};});
    const view=await page.evaluate(()=>({width:innerWidth,horizontal:document.documentElement.scrollWidth>innerWidth,visible_scrollbars:[...document.querySelectorAll("body *")].filter(node=>node.getClientRects().length && node.scrollHeight>node.clientHeight+1 && /auto|scroll/.test(getComputedStyle(node).overflowY) && getComputedStyle(node).scrollbarWidth!=="none" && getComputedStyle(node,"::-webkit-scrollbar").display!=="none").map(node=>String(node.className))}));
    assert.deepEqual(native.bounds,native.content);assert.equal(native.menu,true);assert.equal(native.menu_visible,false);assert.equal(view.horizontal,false);assert.deepEqual(view.visible_scrollbars,[]);layouts.push({...view,native});
  }
  pass("Frameless Desktop keeps default menus, visible scroll rails and horizontal overflow absent at three actual native widths");
  observations={reservations,root_task:complete.task.task_id,workflow_run:run.id,child_task:child.id,lost_finish_responses:lostFinishResponses,
    tasks:tasks.map(task=>({id:task.id,role:task.role_key,status:task.status,charged_micros:task.charged_micros})),native_processes:nativeRows,
    provider_calls:providerCalls,no_model_calls_during_sync:providerCalls===callsBeforeSync,unexpected,full_application_restart:true,original_process_closed:true,tool_observations:model.observations};
} catch (error) {
  failure=String(error);errors.push(stage+": "+failure);console.error(stage+": "+failure);
  if(electron && page)try{const bytes=Buffer.from(await electron.evaluate(async({BrowserWindow})=>(await BrowserWindow.fromId(globalThis.__startupWindowId).webContents.capturePage()).toPNG().toString("base64")),"base64");screenshots.push(await saveWorkmateScreenshot("desktop-publication-125","receipt-sync-131-"+attempt,"failure-state",bytes,"Unedited failed actual packaged Desktop qualification",delivery));}catch(captureError){errors.push("Failure capture: "+String(captureError));}
} finally {
  await stopRecording().catch(error=>errors.push("Recording: "+String(error)));
  if(electron){const pid=electron.process().pid;await electron.close().then(()=>{desktopClosed=true;},error=>errors.push(String(error)));if(desktopClosed)assert.throws(()=>process.kill(pid,0));}
  if(browser)await browser.close().then(()=>{browserClosed=true;},error=>errors.push(String(error)));
  if(system)await system.app.close().then(()=>{apiClosed=true;},error=>errors.push(String(error)));
  if(isolated)await isolated.cleanup().then(()=>{fixtureClosed=true;},error=>errors.push(String(error)));
  provider.closeAllConnections();await new Promise(resolve=>provider.close(()=>{providerClosed=true;resolve();}));
  const passed=!failure && errors.length===0 && checks.length===8 && browserClosed && desktopClosed && apiClosed && fixtureClosed && providerClosed;
  await writeFile(prefix+"-journey.json",JSON.stringify({at:new Date().toISOString(),status:passed?"passed":"failed",stage,checks,errors,observations,screenshots,recordings,layouts,
    browser_closed:browserClosed,desktop_closed:desktopClosed,api_closed:apiClosed,fixture_closed:fixtureClosed,provider_closed:providerClosed,
    limits:["Unsigned Windows package; synthetic model and native dialog decisions","Known developer result and lost HTTP acknowledgement; full app restart with completed native processes, not arbitrary crash/process reclamation","Parent remains uncertain; receipt sync does not resume QA or establish professional-role or live-provider acceptance"]},null,2)+"\n",{flag:"wx"});process.exitCode=passed?0:1;
}
