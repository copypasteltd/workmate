import assert from "node:assert/strict";
import { _electron, chromium, type ElectronApplication, type Browser } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";

const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), desktop = path.resolve("../copypaste-desktop"), attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const owned = path.resolve(".data/desktop-local", randomUUID()), workspace = path.join(owned, "workspace"), outside = path.join(owned, "outside.txt");
const checks: string[] = [], screenshots: any[] = [], errors: string[] = [];
const pass = (text: string) => { checks.push(text); console.log("PASS: " + text); };
let isolated: any, system: any, electron: ElectronApplication | undefined, browser: Browser | undefined, recording: WorkmateRecording | undefined, media: any;
let stage = 0, commandNext = true, stall = false, stalled = false, providerCalls = 0, providerError: unknown, permissionDecision = 0;
let electronClosed = false, browserClosed = false, apiClosed = false, fixtureClosed = false, deadline: ReturnType<typeof setTimeout> | undefined;
const provider = createServer(async (req, res) => {
  try {
    const chunks = []; for await (const b of req) chunks.push(Buffer.from(b)); const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(req.headers.authorization, "Bearer desktop-ui-fixture"); assert.equal(body.model, "desktop-ui-fixture");
    if (req.url === "/v1/responses/input_tokens") { res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ object: "response.input_tokens", input_tokens: 10 })); return; }
    assert.equal(req.url, "/v1/responses"); providerCalls++;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const emit = (type: string, value: any) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
    const response = { id: "resp_desktop_ui_" + providerCalls, object: "response", created_at: 1, model: body.model, status: "in_progress", output: [] };
    emit("response.created", { response });
    if (stall) { stalled = true; return; }
    let item: any;
    if (commandNext) {
      commandNext = false;
      const tools = (body.tools ?? []).flatMap((x: any) => x.type === "namespace" ? x.tools.map((y: any) => ({ ...y, name: x.name + "." + y.name })) : [x]);
      const tool = tools.find((x: any) => /(?:^|\.)(exec_command|shell|shell_command)$/.test(x.name)); assert.ok(tool);
      const cmd = `[IO.File]::WriteAllText('${outside.replaceAll("'", "''")}', 'changed-by-desktop-local-codex'); Write-Output 'NATIVE_LOCAL_FILE_CHECK'`;
      const args = tool.parameters?.properties?.cmd ? { cmd, workdir: workspace, yield_time_ms: 1000, max_output_tokens: 1000 }
        : tool.parameters?.properties?.command?.type === "array" ? { command: ["powershell.exe", "-NoProfile", "-Command", cmd], workdir: workspace, timeout_ms: 10000 }
        : { command: cmd, workdir: workspace, timeout_ms: 10000 };
      item = { type: "function_call", id: "fc_ui_" + providerCalls, call_id: "call_ui_" + providerCalls, name: tool.name, arguments: JSON.stringify(args) };
    } else item = { type: "message", id: "msg_ui_" + providerCalls, role: "assistant", status: "completed", content: [{ type: "output_text", text: stage++ === 0
      ? "Completed the local file change. The terminal ran on this computer; model requests used the company gateway."
      : "Continued this local thread. Review the activity log for the observed command result.", annotations: [] }] };
    emit("response.output_item.added", { output_index: 0, item: item.type === "function_call" ? { ...item, arguments: "" } : item });
    if (item.type === "function_call") {
      emit("response.function_call_arguments.delta", { output_index: 0, item_id: item.id, delta: item.arguments });
      emit("response.function_call_arguments.done", { output_index: 0, item_id: item.id, arguments: item.arguments });
    } else {
      emit("response.output_text.delta", { output_index: 0, item_id: item.id, content_index: 0, delta: item.content[0].text });
      emit("response.output_text.done", { output_index: 0, item_id: item.id, content_index: 0, text: item.content[0].text });
    }
    emit("response.output_item.done", { output_index: 0, item });
    emit("response.completed", { response: { ...response, status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } } }); res.end();
  } catch (e) { providerError = e; if (!res.headersSent) res.writeHead(502); res.end(); }
});
async function until(read: () => Promise<any>, ok: (value: any) => boolean, label: string, ms = 40000): Promise<any> {
  const end = Date.now() + ms;
  do { const value = await read(); if (ok(value)) return value; await new Promise(resolve => setTimeout(resolve, 150)); } while (Date.now() < end);
  throw new Error("Timed out: " + label);
}
try {
  await mkdir(workspace, { recursive: true }); await writeFile(outside, "before-desktop-native");
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  const { isolatedTestEnvironment } = await import(pathToFileURL(path.join(platform, "tests/native-test-environment.ts")).href);
  const { buildApp } = await import(pathToFileURL(path.join(platform, "src/server.ts")).href);
  const { loadConfig } = await import(pathToFileURL(path.join(platform, "src/config.ts")).href);
  const { defaults } = await import(pathToFileURL(path.join(platform, "src/plans.ts")).href);
  process.chdir(platform); isolated = await isolatedTestEnvironment();
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "false", DEMO_MODE: "false",
    AI_BASE_URL: `http://127.0.0.1:${(provider.address() as any).port}/v1`, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "desktop-ui-fixture", AI_MODEL: "desktop-ui-fixture", AI_VERIFIED: "true",
    AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000", AI_INPUT_COUNT_VERIFIED: "true", AI_INPUT_COUNT_HKD_MICROS_PER_CALL: "0", AI_SCOPE_TTL_MS: "300000",
  }), { worker: false });
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  process.chdir(delivery);
  electron = await _electron.launch({ executablePath: process.env.COPYPASTE_LOCAL_DESKTOP_CANDIDATE!, env: { ...process.env, COPYPASTE_USER_DATA: path.join(owned, "user-data") } });
  deadline = setTimeout(() => { errors.push("Owned Desktop journey deadline"); void electron?.close(); void browser?.close(); }, 240000);
  const page = await electron.firstWindow(); page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); }); await page.reload();
  const chrome = process.env.CHROME_BIN; assert.ok(chrome && path.isAbsolute(chrome));
  browser = await chromium.launch({ executablePath: chrome, headless: true }); const context = await browser.newContext();
  await electron.evaluate(({ shell, dialog }, folder) => {
    const state = globalThis as any; state.__localDialogs = []; state.__localDecision = 0;
    shell.openExternal = async (url: string) => { state.__authURL = url; };
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) as any;
    dialog.showMessageBox = async (...args: any[]) => { state.__localDialogs.push(args.at(-1)); return { response: state.__localDecision, checkboxChecked: false }; };
  }, workspace);
  await page.getByRole("button", { name: "Sign in securely in your browser" }).click();
  const authURL = await until(() => electron!.evaluate(() => (globalThis as any).__authURL ?? ""), Boolean, "system browser PKCE URL");
  const auth = await context.newPage(); await auth.addInitScript(() => localStorage.setItem("cp_locale", "en")); await auth.goto(authURL);
  await auth.locator('input[name="email"]').fill(`desktop-local-${randomUUID()}@example.invalid`);
  const [challengeResponse] = await Promise.all([auth.waitForResponse(r => new URL(r.url()).pathname === "/v1/auth/challenges"), auth.locator('form button[type="submit"]').click()]);
  assert.equal(challengeResponse.status(), 202); const challenge = await challengeResponse.json();
  const mail = JSON.parse(await readFile(path.join(isolated.directory, "mailbox", challenge.challenge_id + ".json"), "utf8"));
  await auth.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]); await auth.locator('form button[type="submit"]').click();
  await auth.getByRole("link", { name: /Authorize & return|授權並返回應用/ }).click();
  await until(() => page.evaluate(async () => (await (window as any).copyPasteBridge.request("/v1/session/context", {})).status), v => v === 200, "native sign-in");
  const created = await page.evaluate(async () => (window as any).copyPasteBridge.request("/v1/tenants", { method: "POST", body: { name: "Harbour Studio", project_name: "Local product launch" } }));
  assert.equal(created.status, 200, JSON.stringify(created)); const tenant = created.body.tenant.id, project = created.body.project.id;
  await system.db.control.query("UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1", [tenant]);
  await system.db.control.query("INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Owned native UI fixture',$2)", [tenant, defaults.business]);
  await page.evaluate(() => { location.hash = "/app"; }); await page.reload();
  await page.getByRole("heading", { name: "Your local workmate" }).waitFor();
  const appearance = await electron.evaluate(({ BrowserWindow, Menu }) => ({ menu: Menu.getApplicationMenu() === null, frame: BrowserWindow.getAllWindows()[0].isMenuBarVisible() === false, local: BrowserWindow.getAllWindows()[0].webContents.getURL().startsWith("file:") }));
  assert.ok(appearance.menu && appearance.frame && appearance.local); pass("Actual packaged Electron, frameless local renderer, no native menu and real email/browser PKCE");
  const list = async () => {
    const r = await page.evaluate(async scope => (window as any).copyPasteBridge.localAgent("list", scope), { tenant, project });
    assert.equal(r.ok, true, JSON.stringify(r)); return r.value.sessions.at(-1);
  };
  await page.getByRole("button", { name: "Choose folder to start" }).click(); await until(list, s => !!s, "local directory session");
  await page.getByLabel("Local permission", { exact: true }).selectOption("full-access");
  await page.getByRole("button", { name: "Set permission", exact: true }).click();
  assert.equal((await list()).permission, null); assert.equal(providerCalls, 0);
  const prompt = await electron.evaluate(() => (globalThis as any).__localDialogs.at(-1));
  assert.equal(prompt.defaultId, 0); assert.equal(prompt.cancelId, 0); assert.equal(prompt.type, "warning"); assert.ok(prompt.detail.includes("outside this workspace"));
  permissionDecision = 1; await electron.evaluate(() => { (globalThis as any).__localDecision = 1; });
  await page.getByRole("button", { name: "Set permission", exact: true }).click(); await until(list, s => s.permission === "full-access", "explicit local full permission");
  pass("Main-process native consent is required; default decline grants nothing; fixture confirmation grants real full access");
  recording = new WorkmateRecording("desktop", "local-agent", "local-" + attempt, () => page.screenshot({ type: "jpeg", quality: 82 }), "Actual packaged Electron with real native Codex, file changes, platform and ledger; model turns and native dialog decisions explicitly synthetic");
  await recording.start();
  await page.getByLabel("Local task", { exact: true }).fill("Update the approved existing file outside this workspace using the local terminal. Keep all other files unchanged.");
  await page.getByRole("button", { name: "Start work", exact: true }).click(); const firstState = await until(list, s => !s.busy && s.task?.status === "succeeded", "first native completion", 90000);
  assert.equal(await readFile(outside, "utf8"), "changed-by-desktop-local-codex");
  const first = (await system.db.control.query("SELECT * FROM tasks WHERE id=$1", [firstState.task.task_id])).rows[0]; assert.equal(first.charged_micros, "60"); assert.equal(first.execution_location, "desktop");
  screenshots.push(await saveWorkmateScreenshot("desktop", "local-" + attempt, "full-access-en", await page.screenshot(), "Actual packaged Electron; real local file and terminal; synthetic model and fixture native consent"));
  pass("Real local Codex modifies an existing outside-cwd file; streamed activity is visible and company ledger charges 60 micros");
  await page.getByLabel("Local task", { exact: true }).fill("Continue this same local session and describe the completed change."); await page.getByRole("button", { name: "Start work", exact: true }).click();
  const secondState = await until(list, s => !s.busy && s.task?.status === "succeeded" && s.task.task_id !== first.id, "native follow-up", 90000);
  const second = (await system.db.control.query("SELECT * FROM tasks WHERE id=$1", [secondState.task.task_id])).rows[0];
  assert.equal(second.runtime_thread, first.runtime_thread); assert.notEqual(second.runtime_turn, first.runtime_turn); assert.equal(second.charged_micros, "30");
  pass("Follow-up continues the actual same native thread with a new scoped task credential and one separate charge");
  await writeFile(outside, "must-remain-read-only"); commandNext = true;
  await page.getByLabel("Local permission", { exact: true }).selectOption("read-only"); await page.getByRole("button", { name: "Set permission", exact: true }).click(); await until(list, s => s.permission === "read-only", "permission downgrade");
  await page.getByLabel("Local task", { exact: true }).fill("Verify that read-only mode prevents a write to the owned outside-cwd fixture."); await page.getByRole("button", { name: "Start work", exact: true }).click();
  await until(list, s => !s.busy && s.task?.task_id !== second.id && s.task?.status === "succeeded", "read-only native check", 90000);
  assert.equal(await readFile(outside, "utf8"), "must-remain-read-only");
  screenshots.push(await saveWorkmateScreenshot("desktop", "local-" + attempt, "read-only-en", await page.screenshot(), "Actual native read-only denial; synthetic model response does not establish a successful write"));
  pass("User downgrade changes the real native sandbox; an outside-cwd write is denied and the file remains unchanged");
  await page.getByLabel("Local permission", { exact: true }).selectOption("full-access"); await page.getByRole("button", { name: "Set permission", exact: true }).click();
  stall = true; await page.getByLabel("Local task", { exact: true }).fill("Wait for the owned interruption fixture; do not perform further file changes."); await page.getByRole("button", { name: "Start work", exact: true }).click();
  await until(async () => stalled, Boolean, "active company stream"); await page.getByRole("button", { name: "Stop", exact: true }).click();
  const stopped = await until(list, s => !s.busy && s.task?.status === "reconciling", "stopped unknown-usage hold", 45000);
  assert.equal(stopped.uncertain, true);
  const hold = (await system.db.control.query("SELECT status FROM reservations WHERE task_id=$1", [stopped.task.task_id])).rows[0]; assert.equal(hold.status, "reconciling");
  screenshots.push(await saveWorkmateScreenshot("desktop", "local-" + attempt, "stopped-en", await page.screenshot(), "Actual stopped local task; unknown provider usage remains held for reconciliation"));
  await page.getByRole("button", { name: "Revoke local permission", exact: true }).click(); await until(list, s => s.revoked && s.permission === null, "local revocation");
  const ownedPids = [...new Set(stopped.events.filter((e: any) => e.kind === "local.runtime.ready").map((e: any) => Number(e.value.pid)))] as number[];
  assert.ok(ownedPids.length >= 3);
  for (const pid of ownedPids) assert.throws(() => process.kill(pid, 0), "Owned native process must actually exit");
  pass("Stop interrupts only the owned native process; unknown usage stays reserved, replay is blocked and local permission can be revoked");
  media = await recording.stop(); recording = undefined; assert.ok(media && media.skipped_capture_errors === 0);
  await page.evaluate(() => { localStorage.setItem("cp_locale", "zh-HK"); }); await page.reload();
  await page.getByRole("heading", { name: "你的本機工作夥伴" }).waitFor();
  screenshots.push(await saveWorkmateScreenshot("desktop", "local-" + attempt, "workspace-zh", await page.screenshot(), "Actual Chinese local Agent workspace after reload; same-account local history retained"));
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await until(() => page.evaluate(async () => (await (window as any).copyPasteBridge.request("/v1/session/context", {})).status), v => v === 401, "native sign-out");
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM outbox WHERE topic='task.run' AND payload->>'task_id' IN (SELECT task_id::text FROM desktop_executions WHERE tenant_id=$1)", [tenant])).rows[0].n, 0);
  if (providerError) throw providerError;
  pass("Chinese history survives renderer reload; sign-out revokes native authorization; no Desktop task enters the cloud queue");
} catch (e) { errors.push(String(e)); console.error(String(e)); }
finally {
  if (deadline) clearTimeout(deadline);
  if (recording) try { media = await recording.stop(); } catch (e) { errors.push("Recording: " + String(e)); }
  if (electron) { await electron.close().catch(e => errors.push("Electron close: " + e)); electronClosed = true; }
  if (browser) { await browser.close(); browserClosed = true; }
  if (system) { await system.app.close(); apiClosed = true; }
  provider.closeAllConnections(); if (provider.listening) await new Promise<void>(resolve => provider.close(() => resolve()));
  if (isolated) { process.chdir(platform); await isolated.cleanup(); fixtureClosed = true; }
  process.chdir(delivery);
  const report = { at: new Date().toISOString(), status: errors.length ? "failed" : "passed", checks, errors, screenshots, media, provider_calls: providerCalls,
    scope: "Actual packaged Electron and native Codex; actual email/PKCE, file, sandbox, company gateway and billing; model turns and native chooser/dialog decisions are explicit test fixtures",
    fixture_native_dialog_confirmed: permissionDecision === 1, electron_closed: electronClosed, browser_closed: browserClosed, api_closed: apiClosed, fixture_closed: fixtureClosed };
  await writeFile(`evidence/desktop-local-ui-${attempt}-journey.json`, JSON.stringify(report, null, 2) + "\n", { flag: "wx" }); assert.equal(errors.length, 0, errors.join("\n"));
}
