import { chromium, type BrowserContext, type CDPSession } from "playwright";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";

const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), extension = path.resolve("../copypaste-extension");
const attempt = process.argv[2]; assert.match(attempt ?? "", /^\d{2}$/);
const owned = path.resolve(".data/extension-folder", randomUUID()), checks: string[] = [], screenshots: any[] = [], errors: string[] = [], layouts: any[] = [], recordings: any[] = [], reads: any[] = [];
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const pass = (s: string) => { checks.push(s); console.log("PASS: " + s); };
let isolated: any, system: any, context: BrowserContext | undefined, panel: any, recording: WorkmateRecording | undefined, provider: any;
let browserClosed = false, apiClosed = false, fixtureClosed = false, providerClosed = false, stage = "setup";
async function until(read: () => Promise<any>, ok: (v: any) => boolean, what: string) {
  const end = Date.now() + 40000;
  do { const value = await read(); if (ok(value)) return value; await new Promise(r => setTimeout(r, 120)); } while (Date.now() < end);
  throw new Error("Timed out: " + what);
}
async function attachTarget(parent: CDPSession, targetId: string) {
  const { sessionId } = await parent.send("Target.attachToTarget", { targetId, flatten: false });
  let sequence = 0; const pending = new Map<number, any>();
  const receive = (event: any) => { if (event.sessionId !== sessionId) return; const m = JSON.parse(event.message), p = pending.get(m.id); if (!p) return; clearTimeout(p.timer); pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); };
  parent.on("Target.receivedMessageFromTarget", receive);
  return {
    send(method: string, params: any = {}): Promise<any> { const id = ++sequence; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error("Owned panel CDP timeout: " + method)); }, 20000); pending.set(id, { resolve, reject, timer }); void parent.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject); }); },
    async close() { parent.removeListener("Target.receivedMessageFromTarget", receive); for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error("Owned panel closed")); } pending.clear(); await parent.send("Target.detachFromTarget", { sessionId }).catch(() => {}); },
  };
}
async function evaluate(expression: string) { const r = await panel.send("Runtime.evaluate", { expression, returnByValue: true, userGesture: true, awaitPromise: true }); assert.equal(r.exceptionDetails, undefined, JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function api(url: string, method = "GET", body?: any) { const r = await evaluate(`chrome.runtime.sendMessage(${JSON.stringify({ type: "API", path: url, method, body })})`); assert.equal(r.ok, true, JSON.stringify(r)); return r.data; }
async function shot(name: string) { await until(() => evaluate("document.fonts.status==='loaded'"), Boolean, "loaded fonts"); const r = await panel.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); screenshots.push(await saveWorkmateScreenshot("extension", "folder-" + attempt, name, Buffer.from(r.data, "base64"), "Actual Chrome native right Side Panel, browser-selected folder and real private cloud uploads; customer/model fixtures explicitly synthetic.", delivery)); }
async function layout(label: string) { const v = await evaluate(`(()=>{const d=document.querySelector('#folder-review'),f=document.querySelector('#folder-files'),a=document.querySelector('#folder-confirm'),c=document.querySelector('#folder-cancel'),r=d.getBoundingClientRect();return{width:innerWidth,height:innerHeight,horizontal:document.documentElement.scrollWidth>innerWidth||d.scrollWidth>d.clientWidth,dialog_top:r.top,dialog_bottom:r.bottom,confirm_visible:a.getBoundingClientRect().bottom<=innerHeight,cancel_visible:c.getBoundingClientRect().bottom<=innerHeight,files_scrollable:f.scrollHeight>=f.clientHeight}})()`); layouts.push({ label, ...v }); assert.equal(v.horizontal, false); assert.ok(v.dialog_top >= 0 && v.dialog_bottom <= v.height + 1 && v.confirm_visible && v.cancel_visible); }
const deadline = setTimeout(() => { errors.push("Owned folder journey deadline exceeded"); void context?.close(); }, 480000);
try {
  await mkdir(owned, { recursive: true });
  const load = (n: string) => import(pathToFileURL(path.join(platform, n)).href);
  const [{ isolatedTestEnvironment }, { buildApp }, { loadConfig }, { Worker }, { CodexRuntimeAdapter }, { generatedVideoProvider }] = await Promise.all([load("tests/native-test-environment.ts"), load("src/server.ts"), load("src/config.ts"), load("src/worker.ts"), load("src/runtime.ts"), load("tests/generated-video-fixture.ts")]);
  process.chdir(platform); isolated = await isolatedTestEnvironment(); provider = await generatedVideoProvider(owned);
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "false", DEMO_MODE: "false", AI_BASE_URL: provider.origin, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "synthetic-video-provider-fixture", AI_MODEL: "synthetic-folder-reasoning-v1", AI_VERIFIED: "true", AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000", AI_INPUT_COUNT_VERIFIED: "true", AI_INPUT_COUNT_HKD_MICROS_PER_CALL: "0" }), { worker: false });
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  const id = (await readFile(path.join(extension, "extension-id.txt"), "utf8")).trim();
  context = await chromium.launchPersistentContext(path.join(owned, "chrome"), { executablePath: process.env.CHROME_BIN, headless: false, viewport: null, args: ["--disable-gpu", "--window-size=1480,1080", "--enable-unsafe-extension-debugging", "--disable-extensions-except=" + path.join(extension, "dist"), "--load-extension=" + path.join(extension, "dist")] });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker"); assert.ok(worker.url().includes(id));
  const main = context.pages()[0]; await main.goto("http://localhost:4317/");
  const width = await main.evaluate(() => innerWidth), tabs = context.pages().length, cdp = await context.browser()!.newBrowserCDPSession();
  const target = (await cdp.send("Target.getTargets", { filter: [{}] })).targetInfos.find(t => t.type === "tab" && t.url.startsWith("http://localhost:4317")); assert.ok(target);
  await until(() => worker.evaluate(() => chrome.sidePanel.getPanelBehavior()), v => v.openPanelOnActionClick, "toolbar binding");
  await (cdp as any).send("Extensions.triggerAction", { id, targetId: target.targetId });
  const native = (await until(() => worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] })), v => v.length === 1 && v[0].documentUrl === `chrome-extension://${id}/sidepanel.html`, "actual native Side Panel"))[0];
  assert.equal((await worker.evaluate(() => chrome.sidePanel.getLayout())).side, "right"); await until(() => main.evaluate(() => innerWidth), v => v < width - 250, "docked layout"); assert.equal(context.pages().length, tabs);
  const pt = await until(async () => (await cdp.send("Target.getTargets", { filter: [{}] })).targetInfos.find(t => t.type === "page" && t.url === native.documentUrl), Boolean, "panel target"); panel = await attachTarget(cdp, pt.targetId);
  await until(() => evaluate("document.readyState==='complete' && !document.querySelector('#sign-in').disabled"), Boolean, "sign-in control");
  stage = "OTP and PKCE";
  const popupEvent = context.waitForEvent("page"); await evaluate("document.querySelector('#sign-in').click()"); const popup = await popupEvent;
  await popup.locator('input[name="email"]').fill(`folder-ui-${randomUUID()}@example.invalid`);
  const [ch] = await Promise.all([popup.waitForResponse(r => new URL(r.url()).pathname === "/v1/auth/challenges"), popup.locator('form button[type="submit"]').click()]); assert.equal(ch.status(), 202);
  const mail = JSON.parse(await readFile(path.join(isolated.directory, "mailbox", (await ch.json()).challenge_id + ".json"), "utf8"));
  await popup.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]); await popup.locator('form button[type="submit"]').click(); await popup.getByRole("link", { name: /Authorize & return|授權並返回應用/ }).click();
  await until(() => evaluate("!document.querySelector('#workspace').hidden"), Boolean, "authorized panel"); await popup.close().catch(() => {});
  const created = await api("/v1/tenants", "POST", { name: "Harbour design studio", project_name: "Brand launch files" });
  const tenant = created.tenant.id, project = created.project.id, base = `/v1/tenants/${tenant}/projects/${project}`;
  await system.db.control.query("UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1", [tenant]);
  await panel.send("Page.reload"); await until(() => evaluate("!document.querySelector('#workspace').hidden && !document.querySelector('#chat-folder').disabled"), Boolean, "folder input");
  assert.equal(await worker.evaluate(() => chrome.permissions.contains({ permissions: ["nativeMessaging"] })), false);
  pass("Actual toolbar right SIDE_PANEL and email OTP/PKCE onboarding work without Desktop or nativeMessaging");
  const folder = path.join(owned, "Brand launch");
  for (const [name, text] of [["copy/brief.txt", "Approved headline: Hello Hong Kong."], ["ads/brief.txt", "Approved campaign budget: HKD 250."], [".internal.txt", "Excluded unless customer selects."], ["dist/bundle.js", "Generated output starts unchecked."], ["empty.txt", ""]]) { const f = path.join(folder, name); await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, text, { flag: "wx" }); }
  async function choose() { const doc = await panel.send("DOM.getDocument"), input = await panel.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#chat-folder" }); await panel.send("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [folder] }); await until(() => evaluate("document.querySelector('#folder-review').open && document.querySelectorAll('#folder-files input:checked').length===2"), Boolean, "review actual selected directory"); }
  const countUploads = async () => (await system.db.control.query("SELECT count(*)::int n FROM upload_sessions WHERE tenant_id=$1", [tenant])).rows[0].n;
  stage = "preflight"; await choose(); assert.equal(await countUploads(), 0);
  assert.equal(await evaluate("document.querySelector('#folder-root').textContent"), "Brand launch"); await layout("zh review"); await shot("review-zh");
  await evaluate("document.querySelector('#folder-cancel').click()"); assert.equal(await countUploads(), 0);
  await evaluate("document.querySelector('#locale').click()"); await choose(); await layout("en review"); await shot("review-en");
  assert.match(await evaluate("document.querySelector('#folder-files').textContent"), /ads\/brief.txt/);
  pass("Real browser folder selection preserves paths, excludes hidden/build/empty files and sends zero bytes before customer confirmation");
  await worker.evaluate(() => { const original = globalThis.fetch; let completes = 0; globalThis.fetch = async (input, init) => { const r = await original(input, init); const p = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname; if (/\/uploads\/[^/]+\/complete$/.test(p) && init?.method === "POST" && r.ok && ++completes === 2) throw new Error("Explicit fixture: upload completion response lost after commit"); return r; }; });
  recording = new WorkmateRecording("extension", "folder-retry", "folder-" + attempt, async () => Buffer.from((await panel.send("Page.captureScreenshot", { format: "jpeg", quality: 85, captureBeyondViewport: false })).data, "base64"), "Actual directory confirmation, post-commit response loss and exact private-upload retry. Synthetic customer/files; no simulated UI frames.", delivery); await recording.start();
  stage = "partial transfer"; await evaluate("document.querySelector('#folder-confirm').click()"); await until(() => evaluate("document.querySelector('#folder-status').classList.contains('failed')"), Boolean, "lost completion response"); await shot("partial-failure-en");
  assert.equal(await countUploads(), 2); assert.equal(await evaluate("document.querySelector('#chat-send').disabled"), true);
  await evaluate("document.querySelector('#folder-confirm').click()"); await until(() => evaluate("document.querySelector('#folder-confirm').hidden && document.querySelectorAll('.chat-attachment.ready').length===3"), Boolean, "recovered folder and index");
  assert.equal(await countUploads(), 3); assert.equal((await system.db.control.query("SELECT count(*)::int n FROM tasks WHERE tenant_id=$1", [tenant])).rows[0].n, 0);
  await shot("ready-not-sent-en"); recordings.push(await recording.stop()); recording = undefined;
  const assets = (await system.db.control.query("SELECT a.id,a.name,a.private_owner,v.id AS version_id,v.sha256,v.bytes,v.storage_key,v.metadata FROM assets a JOIN asset_versions v ON v.asset_id=a.id WHERE a.tenant_id=$1 ORDER BY a.name", [tenant])).rows;
  assert.equal(assets.length, 3); assert.ok(assets.every((a: any) => a.private_owner && a.metadata.conversation_id));
  const indexAsset = assets.find((a: any) => a.name.startsWith("folder-index-")), indexBytes = await system.storage.get(indexAsset.storage_key), index = JSON.parse(indexBytes.toString());
  assert.deepEqual(index.files.map((v: any) => v.relative_path), ["ads/brief.txt", "copy/brief.txt"]);
  for (const row of index.files) { const a = assets.find((a: any) => a.id === row.asset_id); assert.equal(a.version_id, row.asset_version_id); assert.equal(a.sha256, row.sha256); assert.equal(hash(await system.storage.get(a.storage_key)), row.sha256); }
  pass("Post-commit upload response loss retries the same private file, keeps two distinct basenames and creates exactly two files plus one verified index without a task");
  stage = "actual cloud Codex";
  let pending = "", next = 0;
  const ordered = [indexAsset, ...index.files.map((v: any) => assets.find((a: any) => a.id === v.asset_id))];
  provider.state.textItem = (body: any, serial: number) => {
    if (pending) { const output = body.input.find((v: any) => v.type === "function_call_output" && v.call_id === pending); assert.ok(output, "Actual Codex consumes its previous private-file tool output"); const value = JSON.parse(typeof output.output === "string" ? output.output : output.output[0].text); assert.equal(typeof value.text, "string"); reads.push({ asset_id: ordered[next - 1].id, text_sha256: hash(Buffer.from(value.text)), actual_tool_output: true }); pending = ""; }
    if (next === ordered.length) return { type: "message", id: "msg_folder_" + serial, role: "assistant", status: "completed", content: [{ type: "output_text", text: "Read the approved folder index and both selected files.\n\nHello Hong Kong.\nCampaign budget: HKD 250.\n\nSource paths: copy/brief.txt; ads/brief.txt.", annotations: [] }] };
    const group = body.tools.find((v: any) => v.tools?.some((t: any) => t.name === "asset_text_read")); assert.ok(group || body.tools.some((v: any) => v.name === "asset_text_read"));
    pending = "call_folder_" + serial; return { type: "function_call", id: "fc_folder_" + serial, call_id: pending, ...(group ? { namespace: group.name } : {}), name: "asset_text_read", arguments: JSON.stringify({ asset_id: ordered[next++].id }) };
  };
  await evaluate("document.querySelector('#folder-cancel').click()");
  recording = new WorkmateRecording("extension", "folder-response", "folder-" + attempt, async () => Buffer.from((await panel.send("Page.captureScreenshot", { format: "jpeg", quality: 85, captureBeyondViewport: false })).data, "base64"), "Actual customer Send, native cloud Codex, private index/file reads and persisted response/cost. Model decisions explicitly synthetic company Responses API fixture.", delivery); await recording.start();
  await evaluate("document.querySelector('#chat-input').value='Read the folder index and selected files, then summarise the approved headline and budget.';document.querySelector('#chat-form').requestSubmit()");
  const task = await until(async () => (await system.db.control.query("SELECT * FROM tasks WHERE tenant_id=$1", [tenant])).rows[0], Boolean, "explicit message accepted");
  const versions = (await system.db.control.query("SELECT resource_ids FROM task_dependencies WHERE task_id=$1 AND kind='file'", [task.id])).rows.flatMap((r: any) => r.resource_ids); assert.deepEqual(versions.sort(), assets.map((a: any) => a.version_id).sort());
  await new Worker(system.db, system.catalog, system.storage, new CodexRuntimeAdapter(system.db.config)).run(tenant, task.id);
  const final = (await system.db.control.query("SELECT status,error_code,charged_micros FROM tasks WHERE id=$1", [task.id])).rows[0]; assert.equal(final.status, "succeeded", JSON.stringify(final));
  assert.equal(reads.length, 3); for (const [i, r] of reads.entries()) assert.equal(r.text_sha256, hash(await system.storage.get(ordered[i].storage_key)));
  await until(() => evaluate("document.querySelectorAll('.from-assistant:not([data-live-task])').length"), v => v === 1, "persisted cloud reply"); await shot("cloud-codex-response-en"); recordings.push(await recording.stop()); recording = undefined;
  assert.ok(BigInt(final.charged_micros) > 0n); assert.equal((await system.db.control.query("SELECT count(*)::int n FROM reservations WHERE task_id=$1", [task.id])).rows[0].n, 1);
  pass("Customer Send alone starts actual native cloud Codex; it reads the real index and both private files with exactly bound inputs, one reservation and settled cost");
  stage = "narrow layouts"; await choose();
  for (const [w, h, dark] of [[360, 640, false], [420, 900, true]] as const) { await panel.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await panel.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }, { name: "prefers-reduced-motion", value: "reduce" }] }); await layout(`${w}x${h} ${dark ? 'dark' : 'light'}`); await shot(`review-${w}-${dark ? 'dark' : 'light'}`); }
  await panel.send("Emulation.clearDeviceMetricsOverride"); await panel.send("Emulation.setEmulatedMedia", { features: [] });
  await evaluate("document.querySelector('#folder-cancel').click()");
  pass("Actual 360×640 and 420×900 Side Panel layouts keep the directory list and keyboard controls usable with no horizontal overflow, including dark/reduced-motion");
  stage = "private account boundary";
  const second = await api("/v1/tenants", "POST", { name: "Second authorized workspace", project_name: "Separate private files" });
  await choose(); const initial = await countUploads();
  await evaluate(`document.querySelector('#tenant').value=${JSON.stringify(second.tenant.id)};document.querySelector('#tenant').dispatchEvent(new Event('change'))`);
  await until(() => evaluate("!document.querySelector('#folder-review').open && document.querySelectorAll('.chat-attachment').length===0"), Boolean, "workspace switch clears selected folder"); assert.equal(await countUploads(), initial);
  assert.equal(await worker.evaluate(() => chrome.permissions.contains({ permissions: ["nativeMessaging"] })), false);
  pass("Changing workspace clears the old folder review/attachments and does not upload or request native permissions");
} catch (e) { errors.push(e instanceof Error ? e.stack ?? e.message : String(e)); console.error("Stage " + stage + ": " + errors.at(-1)); }
finally {
  clearTimeout(deadline);
  if (recording) { try { recordings.push(await recording.stop()); } catch (e) { errors.push(String(e)); } }
  if (panel) await panel.close().catch((e: any) => errors.push(String(e)));
  if (context) await context.close().then(() => { browserClosed = true; }).catch(e => errors.push(String(e)));
  if (system) await system.app.close().then(() => { apiClosed = true; }).catch((e: any) => errors.push(String(e)));
  if (provider) { if (provider.errors.length) errors.push(...provider.errors); await provider.close().then(() => { providerClosed = true; }).catch((e: any) => errors.push(String(e))); }
  if (isolated) { process.chdir(platform); await isolated.cleanup().then(() => { fixtureClosed = true; }).catch((e: any) => errors.push(String(e))); }
  process.chdir(delivery);
  const result = { status: !errors.length && browserClosed && apiClosed && fixtureClosed && providerClosed ? "passed" : "failed", stage, checks, errors, screenshots, recordings, layouts, actual_private_reads: reads, browser_closed: browserClosed, api_closed: apiClosed, fixture_closed: fixtureClosed, provider_closed: providerClosed, model: "Actual pinned native cloud Codex and tool reads; synthetic customer/files/model decisions through company-compatible Responses API fixture" };
  await writeFile(`evidence/extension-folder-ui-${attempt}-journey.json`, JSON.stringify(result, null, 2) + "\n", { flag: "wx" }); assert.equal(result.status, "passed", "Inspect retained native folder journey");
}
