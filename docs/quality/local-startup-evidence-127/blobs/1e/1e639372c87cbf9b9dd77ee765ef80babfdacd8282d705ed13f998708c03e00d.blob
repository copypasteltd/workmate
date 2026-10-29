import assert from "node:assert/strict";
import { chromium, _electron } from "playwright";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.ts";

const delivery = process.cwd(), platform = path.resolve("../copypaste-platform-publication-125"), attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const prefix = path.resolve("evidence/local-startup-127/desktop-" + attempt), owned = path.resolve(".data/local-startup-127", randomUUID());
await mkdir(owned, { recursive: true });
const workspace = path.join(owned, "customer-workspace"); await mkdir(workspace);
const load = name => import(pathToFileURL(path.join(platform, name)).href);
const checks = [], errors = [], screenshots = [], recordings = [], layouts = [];
const pass = name => { checks.push(name); console.log("PASS: " + name); };
let system, isolated, electron, browser, recording, page, stage = "setup", providerCalls = 0;
let browserClosed = false, desktopClosed = false, apiClosed = false, fixtureClosed = false, providerClosed = false;
let failure, observations;
async function until(read, ok, name, ms = 40000) {
  const deadline = Date.now() + ms;
  do { const value = await read(); if (ok(value)) return value; await new Promise(resolve => setTimeout(resolve, 150)); } while (Date.now() < deadline);
  throw new Error("Timed out: " + name);
}
const provider = createServer(async (req, res) => {
  try {
    const bytes = []; for await (const part of req) bytes.push(Buffer.from(part));
    assert.equal(req.headers.authorization, "Bearer synthetic-local-startup-127");
    const body = JSON.parse(Buffer.concat(bytes).toString()); assert.equal(body.model, "desktop-startup-synthetic");
    if (req.url === "/v1/responses/input_tokens") { res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ object: "response.input_tokens", input_tokens: 17 })); return; }
    assert.equal(req.url, "/v1/responses"); providerCalls++;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const emit = (type, value) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
    const response = { id: "resp_local_startup_" + providerCalls, object: "response", model: body.model, created_at: 1, status: "in_progress", output: [] };
    const item = { id: "msg_local_startup_" + providerCalls, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Your local workspace is ready. The original task completed once.", annotations: [] }] };
    emit("response.created", { response }); emit("response.output_item.added", { output_index: 0, item });
    emit("response.output_text.delta", { output_index: 0, item_id: item.id, content_index: 0, delta: item.content[0].text });
    emit("response.output_text.done", { output_index: 0, item_id: item.id, content_index: 0, text: item.content[0].text });
    emit("response.output_item.done", { output_index: 0, item });
    emit("response.completed", { response: { ...response, status: "completed", output: [item], usage: { input_tokens: 17, output_tokens: 5, total_tokens: 22, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } });
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
    AI_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "synthetic-local-startup-127",
    AI_MODEL: "desktop-startup-synthetic", AI_VERIFIED: "true", AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000",
    AI_INPUT_COUNT_VERIFIED: "true", AI_INPUT_COUNT_HKD_MICROS_PER_CALL: "0", AI_SCOPE_TTL_MS: "300000" }), { worker: false });
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true });
  const context = await browser.newContext();
  electron = await _electron.launch({ executablePath: process.env.COPYPASTE_LOCAL_DESKTOP_CANDIDATE, env: { ...process.env, COPYPASTE_USER_DATA: path.join(owned, "desktop") } });
  page = await electron.firstWindow(); page.setDefaultTimeout(30000); page.on("pageerror", error => errors.push(error.message));
  await page.waitForURL(/^file:/); await page.waitForFunction(() => !!window.copyPasteBridge);
  await page.evaluate(() => { localStorage.setItem("cp_locale", "en"); localStorage.setItem("cp_theme", "light"); }); await page.reload();
  await electron.evaluate(({ shell, dialog }, workspace) => {
    shell.openExternal = async url => { globalThis.__startupAuth = url; };
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] });
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
  }, workspace);
  stage = "actual browser sign-in and native onboarding";
  await page.getByRole("button", { name: "Sign in securely in your browser", exact: true }).click();
  const auth = await context.newPage(); await auth.goto(await until(() => electron.evaluate(() => globalThis.__startupAuth), Boolean, "PKCE authorization"));
  await auth.locator('input[name="email"]').fill(`startup-${randomUUID()}@example.invalid`);
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
  stage = "actual local customer grant and delayed native pipe";
  await page.evaluate(route => { location.hash = route; }, `/app/local?tenant=${tenant}&project=${project}`);
  await page.getByRole("heading", { name: "Your local workmate", exact: true }).waitFor();
  const list = async () => { const reply = await page.evaluate(scope => window.copyPasteBridge.localAgent("list", scope), { tenant, project }); assert.equal(reply.ok, true, JSON.stringify(reply)); return reply.value.sessions[0]; };
  await page.getByLabel("Local specialist", { exact: true }).selectOption("fullstack");
  await page.getByRole("button", { name: "Choose folder to start", exact: true }).click(); await until(list, Boolean, "customer folder session");
  await page.getByLabel("Local permission", { exact: true }).selectOption("full-access"); await page.getByRole("button", { name: "Set permission", exact: true }).click();
  await until(list, value => value?.permission === "full-access", "explicit native grant");
  await electron.evaluate(({ app }, workspace) => {
    const cp = process.getBuiltinModule("child_process"), original = cp.spawn;
    const expected = process.getBuiltinModule("path").resolve(process.resourcesPath, "local-codex/codex.exe").toLowerCase();
    globalThis.__startupRows = []; globalThis.__startupHold = false;
    cp.spawn = function (file, args, options) {
      const child = original(file, args, options);
      if (String(file).toLowerCase() === expected && args?.[0] === "app-server" && options?.cwd === workspace) {
        const row = { pid: child.pid, closed: false, rpc: [], hold: globalThis.__startupHold }; globalThis.__startupRows.push(row);
        const stream = child.stdin, write = stream.write, timers = new Set();
        stream.write = function (...parts) {
          let request; try { request = JSON.parse(Buffer.isBuffer(parts[0]) ? parts[0].toString() : parts[0]); } catch {}
          if (["initialize", "thread/start", "thread/resume"].includes(request?.method)) {
            row.rpc.push({ method: request.method, at: Date.now() });
            if (row.hold) { const done = parts.find((part, index) => index > 0 && typeof part === "function"); if (done) queueMicrotask(() => done()); return true; }
            const timer = setTimeout(() => { timers.delete(timer); Reflect.apply(write, stream, parts); }, 24000); timers.add(timer); return true;
          }
          return Reflect.apply(write, stream, parts);
        };
        child.once("close", () => { row.closed = true; for (const timer of timers) clearTimeout(timer); });
      }
      return child;
    };
    process.getBuiltinModule("module").syncBuiltinESMExports();
  }, workspace);
  let capturing = Promise.resolve();
  const capture = (jpeg = false) => { const work = capturing.then(async () => Buffer.from(await electron.evaluate(async ({ BrowserWindow }, jpeg) => { const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage(); return (jpeg ? image.toJPEG(75) : image.toPNG()).toString("base64"); }, jpeg), "base64")); capturing = work.then(() => {}, () => {}); return work; };
  const shot = async name => screenshots.push(await saveWorkmateScreenshot("desktop-publication-125", "local-startup-127-" + attempt, name, await capture(), "Actual unsigned packaged frameless Desktop, real customer-local pinned Codex and native PostgreSQL; model response and native dialog decisions explicitly synthetic.", delivery));
  recording = new WorkmateRecording("desktop-publication-125", "startup-and-original-receipt", "local-startup-127-" + attempt, () => capture(true), "Actual packaged Desktop retains company authorization through a delayed native startup and completes the original local task once. Synthetic model and native consent decisions.", delivery);
  await recording.start(); const began = Date.now();
  await page.getByLabel("Local task", { exact: true }).fill("Confirm this approved local workspace is ready."); await page.getByRole("button", { name: "Start work", exact: true }).click();
  await until(() => electron.evaluate(() => globalThis.__startupRows[0]), value => value?.rpc.some(r => r.method === "initialize"), "real native initialize pipe");
  const first = await until(list, value => !!value?.task?.task_id, "original company task"), taskId = first.task.task_id;
  const initialLease = (await system.db.control.query("SELECT lease_until FROM tasks WHERE id=$1", [taskId])).rows[0].lease_until;
  await new Promise(resolve => setTimeout(resolve, 12000));
  const extended = (await system.db.control.query("SELECT lease_until FROM tasks WHERE id=$1", [taskId])).rows[0].lease_until;
  assert.ok(new Date(extended) > new Date(initialLease)); assert.equal(providerCalls, 0); await shot("startup-keeps-company-lease");
  pass("Before any model dispatch, actual native initialization renews the original 45-second SQL lease");
  await until(list, value => !value?.busy && value?.task?.status === "succeeded", "original native completion", 120000);
  const elapsed = Date.now() - began; assert.ok(elapsed >= 48000);
  const task = (await system.db.control.query("SELECT * FROM tasks WHERE id=$1", [taskId])).rows[0];
  const reservations = (await system.db.control.query("SELECT * FROM reservations WHERE task_id=$1", [taskId])).rows;
  const charges = (await system.db.control.query("SELECT * FROM ledger WHERE task_id=$1 AND kind='charge'", [taskId])).rows;
  assert.equal(task.attempt, 1); assert.equal(task.execution_location, "desktop"); assert.equal(task.charged_micros, "22");
  assert.equal(reservations.length, 1); assert.equal(charges.length, 1); assert.equal(providerCalls, 1);
  await page.getByText("Your local workspace is ready. The original task completed once.", { exact: true }).waitFor(); await shot("original-local-receipt"); await stopRecording();
  pass("Delayed real local Codex completes one task with one original reservation, one provider dispatch and one actual company charge");
  for (const width of [1000, 1240, 1440]) {
    await electron.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 980), width);
    await page.waitForFunction(width => innerWidth === width, width);
    const native = await electron.evaluate(({ BrowserWindow, Menu }) => { const win = BrowserWindow.getAllWindows()[0]; return { bounds: win.getBounds(), content: win.getContentBounds(), menu: Menu.getApplicationMenu() === null, menu_visible: win.isMenuBarVisible() }; });
    const view = await page.evaluate(() => ({ width: innerWidth, horizontal: document.documentElement.scrollWidth > innerWidth, visible_scrollbars: [...document.querySelectorAll("body *")].filter(node => node.getClientRects().length && node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY) && getComputedStyle(node).scrollbarWidth !== "none" && getComputedStyle(node, "::-webkit-scrollbar").display !== "none").map(node => String(node.className)) }));
    assert.deepEqual(native.bounds, native.content); assert.equal(native.menu, true); assert.equal(native.menu_visible, false); assert.equal(view.horizontal, false); assert.deepEqual(view.visible_scrollbars, []); layouts.push({ ...view, native });
  }
  pass("Current packaged local workspace remains frameless with no default menu or visible scroll rails at three native window widths");
  stage = "revocation during a real pending startup";
  await electron.evaluate(() => { globalThis.__startupHold = true; });
  recording = new WorkmateRecording("desktop-publication-125", "revoke-pending-startup", "local-startup-127-" + attempt, () => capture(true), "Actual customer revokes full local access while a real native startup RPC is waiting. No second model request is admitted.", delivery);
  await recording.start(); await page.getByLabel("Local task", { exact: true }).fill("This startup will be cancelled before any work begins."); await page.getByRole("button", { name: "Start work", exact: true }).click();
  await until(() => electron.evaluate(() => globalThis.__startupRows[1]), value => value?.rpc.length > 0, "second pending native process");
  await page.getByRole("button", { name: "Revoke local permission", exact: true }).click();
  const revoked = await until(list, value => value?.revoked && !value.busy, "native revocation fully drains startup");
  assert.equal(providerCalls, 1); assert.equal(revoked.task.status, "failed"); assert.equal(revoked.task.charged_micros, "0");
  const rows = await electron.evaluate(() => globalThis.__startupRows); assert.equal(rows.length, 2); assert.ok(rows.every(row => row.closed));
  const cancelledCharges = (await system.db.control.query("SELECT * FROM ledger WHERE task_id=$1 AND kind='charge'", [revoked.task.task_id])).rows;
  assert.ok(cancelledCharges.every(row => BigInt(row.amount_micros ?? 0) === 0n));
  await shot("permission-revoked-before-turn"); await stopRecording();
  pass("Revoking full local permission drains the pending real native process, admits no model call and settles zero company usage");
  observations = { elapsed_ms: elapsed, original_task_id: taskId, native_processes: rows, provider_calls: providerCalls, original_reservations: reservations.length, original_charges: charges.length, charged_micros: task.charged_micros, revoked_task_id: revoked.task.task_id, revoked_charged_micros: revoked.task.charged_micros };
} catch (error) { failure = String(error); errors.push(stage + ": " + failure); console.error(stage + ": " + failure); }
finally {
  await stopRecording().catch(error => errors.push("Recording: " + String(error)));
  if (electron) { const pid = electron.process().pid; await electron.close().then(() => { desktopClosed = true; }, error => errors.push(String(error))); if (desktopClosed) assert.throws(() => process.kill(pid, 0)); }
  if (browser) await browser.close().then(() => { browserClosed = true; }, error => errors.push(String(error)));
  if (system) await system.app.close().then(() => { apiClosed = true; }, error => errors.push(String(error)));
  if (isolated) await isolated.cleanup().then(() => { fixtureClosed = true; }, error => errors.push(String(error)));
  provider.closeAllConnections(); await new Promise(resolve => provider.close(() => { providerClosed = true; resolve(); }));
  const passed = !failure && errors.length === 0 && checks.length === 5 && browserClosed && desktopClosed && apiClosed && fixtureClosed && providerClosed;
  await writeFile(prefix + "-journey.json", JSON.stringify({ at: new Date().toISOString(), status: passed ? "passed" : "failed", stage, checks, errors, observations, screenshots, recordings, layouts, browser_closed: browserClosed, desktop_closed: desktopClosed, api_closed: apiClosed, fixture_closed: fixtureClosed, provider_closed: providerClosed,
    limits: ["Unsigned Windows test package; synthetic model and native dialog decisions", "No automatic Desktop startup replay or full professional-role qualification"] }, null, 2) + "\n", { flag: "wx" });
  process.exitCode = passed ? 0 : 1;
}
