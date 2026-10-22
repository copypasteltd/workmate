import { chromium, type BrowserContext, type CDPSession } from "playwright";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";

const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), extension = path.resolve("../copypaste-extension");
const attempt = process.argv[2]; assert.match(attempt ?? "", /^\d{2}$/);
const owned = path.resolve(".data/extension-chat", randomUUID()), checks: string[] = [], screenshots: any[] = [], errors: string[] = [];
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const pass = (s: string) => { checks.push(s); console.log("PASS: " + s); };
let isolated: any, system: any, context: BrowserContext | undefined, panel: any, recording: WorkmateRecording | undefined, media: any;
let browserClosed = false, apiClosed = false, fixtureClosed = false, deadline: ReturnType<typeof setTimeout>;
async function until(read: () => Promise<any>, ok: (v: any) => boolean, what: string) {
  const end = Date.now() + 30000;
  do { const value = await read(); if (ok(value)) return value; await new Promise(r => setTimeout(r, 120)); } while (Date.now() < end);
  throw new Error("Timed out: " + what);
}
async function attachTarget(parent: CDPSession, targetId: string) {
  const { sessionId } = await parent.send("Target.attachToTarget", { targetId, flatten: false });
  let sequence = 0;
  const pending = new Map<number, any>();
  const receive = (event: any) => {
    if (event.sessionId !== sessionId) return;
    const m = JSON.parse(event.message), p = pending.get(m.id); if (!p) return;
    clearTimeout(p.timer); pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
  };
  parent.on("Target.receivedMessageFromTarget", receive);
  return {
    send(method: string, params: any = {}): Promise<any> {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("Side Panel CDP timed out: " + method)); }, 20000);
        pending.set(id, { resolve, reject, timer });
        void parent.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
      });
    },
    async close() { parent.removeListener("Target.receivedMessageFromTarget", receive); for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error("Owned target closed")); } pending.clear(); await parent.send("Target.detachFromTarget", { sessionId }).catch(() => {}); },
  };
}
async function evaluate(expression: string) {
  const r = await panel.send("Runtime.evaluate", { expression, returnByValue: true, userGesture: true, awaitPromise: true });
  assert.equal(r.exceptionDetails, undefined, JSON.stringify(r.exceptionDetails)); return r.result.value;
}
async function api(url: string, method = "GET", body?: any) {
  const r = await evaluate(`chrome.runtime.sendMessage(${JSON.stringify({ type: "API", path: url, method, body })})`);
  assert.equal(r.ok, true, JSON.stringify(r)); return r.data;
}
async function shot(name: string) {
  const r = await panel.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const cwd = process.cwd(); process.chdir(delivery);
  try { screenshots.push(await saveWorkmateScreenshot("extension", "chat-" + attempt, name, Buffer.from(r.data, "base64"), "Actual Chrome native right SIDE_PANEL; synthetic model turns, real API/database/files")); }
  finally { process.chdir(cwd); }
}
try {
  await mkdir(owned, { recursive: true });
  const { isolatedTestEnvironment } = await import(pathToFileURL(path.join(platform, "tests/native-test-environment.ts")).href);
  const { buildApp } = await import(pathToFileURL(path.join(platform, "src/server.ts")).href);
  const { loadConfig } = await import(pathToFileURL(path.join(platform, "src/config.ts")).href);
  const { Worker } = await import(pathToFileURL(path.join(platform, "src/worker.ts")).href);
  const { CodexRuntimeAdapter } = await import(pathToFileURL(path.join(platform, "src/runtime.ts")).href);
  process.chdir(platform); isolated = await isolatedTestEnvironment();
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "false", DEMO_MODE: "true" }), { worker: false });
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  deadline = setTimeout(() => { errors.push("Owned chat journey timed out"); void context?.close(); }, 240000);
  const id = (await readFile(path.join(extension, "extension-id.txt"), "utf8")).trim();
  context = await chromium.launchPersistentContext(path.join(owned, "chrome"), {
    executablePath: process.env.CHROME_BIN, headless: false, viewport: null,
    args: ["--disable-gpu", "--window-size=1480,1080", "--enable-unsafe-extension-debugging", "--disable-extensions-except=" + path.join(extension, "dist"), "--load-extension=" + path.join(extension, "dist")],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  assert.ok(worker.url().includes(id));
  const main = context.pages()[0]; await main.goto("http://localhost:4317/");
  const width = await main.evaluate(() => innerWidth), tabs = context.pages().length, cdp = await context.browser()!.newBrowserCDPSession();
  const target = (await cdp.send("Target.getTargets", { filter: [{}] })).targetInfos.find(t => t.type === "tab" && t.url.startsWith("http://localhost:4317")); assert.ok(target);
  await until(() => worker.evaluate(() => chrome.sidePanel.getPanelBehavior()), v => v.openPanelOnActionClick, "toolbar binding");
  await (cdp as any).send("Extensions.triggerAction", { id, targetId: target.targetId });
  const native = await until(() => worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] })), v => v.length === 1, "native Side Panel");
  assert.equal((await worker.evaluate(() => chrome.sidePanel.getLayout())).side, "right");
  await until(() => main.evaluate(() => innerWidth), v => v < width - 250, "page narrows"); assert.equal(context.pages().length, tabs);
  const pt = await until(async () => (await cdp.send("Target.getTargets", { filter: [{}] })).targetInfos.find(t => t.type === "page" && t.url === native[0].documentUrl), Boolean, "panel target");
  panel = await attachTarget(cdp, pt.targetId); pass("Toolbar opens the actual native right Side Panel without a popup/tab");
  const popupEvent = context.waitForEvent("page"); await evaluate("document.querySelector('#sign-in').click()"); const popup = await popupEvent;
  await popup.waitForLoadState(); const email = `extension-chat-${randomUUID()}@example.invalid`;
  await popup.locator('input[name="email"]').fill(email);
  const [ch] = await Promise.all([popup.waitForResponse(r => new URL(r.url()).pathname === "/v1/auth/challenges"), popup.locator('form button[type="submit"]').click()]);
  assert.equal(ch.status(), 202); const challenge = await ch.json();
  const mail = JSON.parse(await readFile(path.join(isolated.directory, "mailbox", challenge.challenge_id + ".json"), "utf8")); assert.equal(mail.to, email);
  await popup.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]); await popup.locator('form button[type="submit"]').click();
  await popup.getByRole("link", { name: /Authorize & return|授權並返回應用/ }).click();
  await until(() => evaluate("document.querySelector('#workspace').hidden"), v => v === false, "real PKCE login");
  const created = await api("/v1/tenants", "POST", { name: "Conversation studio", project_name: "Brand launch" });
  const tenant = created.tenant.id, project = (await api(`/v1/tenants/${tenant}/projects`)).items[0].id, base = `/v1/tenants/${tenant}/projects/${project}`;
  await api(`/v1/tenants/${tenant}/demo-credit`, "POST", {});
  await panel.send("Page.reload");
  await until(() => evaluate("!document.querySelector('#workspace').hidden && !document.querySelector('#chat-send').disabled"), Boolean, "conversation ready");
  assert.equal(await evaluate("document.querySelector('#workspace-tools').open"), false);
  assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true);
  await shot("conversation-zh"); pass("Email OTP/PKCE enters a conversation-first UI; business forms start collapsed");
  await evaluate("document.querySelector('#locale').click()");
  await until(() => evaluate("document.querySelector('#chat-send').textContent"), v => v === "Send ↑", "English chat");
  const file = path.join(owned, "launch-brief.txt"); await writeFile(file, "Approved launch brief: Hong Kong campaign. Keep the headline concise. Budget HKD 20 per message.\n", { flag: "wx" });
  const document = await panel.send("DOM.getDocument"); const input = await panel.send("DOM.querySelector", { nodeId: document.root.nodeId, selector: "#chat-file" });
  await panel.send("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [file] });
  await until(() => evaluate("document.querySelectorAll('.chat-attachment.ready').length"), v => v === 1, "actual file upload");
  assert.match(await evaluate("document.querySelector('.chat-attachment small').textContent"), /Uploaded, not sent/);
  await shot("attachment-ready-en"); pass("Browser-selected file uploads to the real API and remains explicitly unsent until a message is accepted");
  await worker.evaluate(() => {
    const original = globalThis.fetch; let lost = false;
    globalThis.fetch = async (input, init) => {
      const r = await original(input, init);
      if (!lost && new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname === "/v1/tasks" && init?.method === "POST" && r.ok) { lost = true; throw new Error("Owned fixture: acceptance response lost after commit"); }
      return r;
    };
  });
  const prompt = "Read the attached launch brief and write a campaign headline.";
  await evaluate(`document.querySelector('#chat-input').value=${JSON.stringify(prompt)};document.querySelector('#chat-form').requestSubmit()`);
  await until(() => evaluate("document.querySelector('#chat-send').textContent"), v => v === "Retry same message", "lost response pending state");
  const first = (await system.db.control.query("SELECT * FROM tasks WHERE tenant_id=$1 ORDER BY created_at", [tenant])).rows[0]; assert.ok(first);
  const dependencies = (await system.db.control.query("SELECT resource_ids FROM task_dependencies WHERE task_id=$1", [first.id])).rows;
  assert.equal(dependencies.length, 1); assert.equal(dependencies[0].resource_ids.length, 1);
  const version = (await system.db.control.query("SELECT v.id,a.name FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=$1", [dependencies[0].resource_ids[0]])).rows[0]; assert.equal(version.name, "launch-brief.txt");
  await panel.send("Page.reload");
  await until(() => evaluate("document.querySelector('#chat-send').textContent"), v => v === "Retry same message", "pending receipt restored");
  await evaluate("document.querySelector('#chat-send').click()");
  await until(() => evaluate("document.querySelector('#chat-input').value==='' && document.querySelector('#chat-pending').hidden"), Boolean, "same acceptance recovered");
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE tenant_id=$1", [tenant])).rows[0].n, 1);
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM reservations WHERE task_id=$1", [first.id])).rows[0].n, 1);
  pass("Lost accepted response survives a panel reload and retries one immutable message/attachment with one task and one reservation");
  process.chdir(delivery);
  recording = new WorkmateRecording("extension", "conversation", "chat-" + attempt, async () => Buffer.from((await panel.send("Page.captureScreenshot", { format: "jpeg", quality: 85, captureBeyondViewport: false })).data, "base64"), "Actual Chrome native right Side Panel; synthetic model turn, real identity, upload, Worker, billing and conversation storage");
  await recording.start(); process.chdir(platform);
  class UiRuntime extends CodexRuntimeAdapter {
    async start(ctx: any) {
      assert.ok(ctx.prompt.includes("Current user request"));
      const text = "Make room for your next idea.\n\nA concise headline for the approved Hong Kong launch brief.";
      for (const part of ["Make room for ", "your next idea.", "\n\nA concise headline for the approved Hong Kong launch brief."]) { await ctx.onEvent("message.delta", { text: part }); await new Promise(r => setTimeout(r, 900)); }
      await ctx.tools.find((t: any) => t.name === "deliver_text").run({ filename: "campaign-headline.txt", mime_type: "text/plain", content: text }, "chat-demo-delivery-" + randomUUID());
      return { status: "completed", text, thread: "chat-demo-" + randomUUID(), turn: "chat-demo-turn-" + randomUUID(), inputTokens: 100, outputTokens: 50, usageKnown: true, accepted: true };
    }
  }
  await new Worker(system.db, system.catalog, system.storage, new UiRuntime(system.db.config)).run(tenant, first.id);
  await until(() => evaluate("document.querySelectorAll('.from-assistant:not([data-live-task])').length"), v => v === 1, "first completed answer");
  await shot("answer-en");
  const conversation = (await system.db.control.query("SELECT * FROM conversations WHERE id=$1", [first.conversation_id])).rows[0];
  await evaluate("document.querySelector('#chat-input').value='Keep the headline and suggest a shorter call to action.';document.querySelector('#chat-form').requestSubmit()");
  const second = await until(async () => (await system.db.control.query("SELECT * FROM tasks WHERE tenant_id=$1 AND id<>$2", [tenant, first.id])).rows[0], Boolean, "follow-up accepted");
  assert.equal(second.conversation_id, first.conversation_id); assert.equal(second.input_context.history.length >= 2, true);
  await new Worker(system.db, system.catalog, system.storage, new UiRuntime(system.db.config)).run(tenant, second.id);
  await until(() => evaluate("document.querySelectorAll('.from-assistant:not([data-live-task])').length"), v => v === 2, "follow-up answer");
  for (const task of [first, second]) {
    const done = (await system.db.control.query("SELECT status FROM tasks WHERE id=$1", [task.id])).rows[0]; assert.equal(done.status, "succeeded");
    assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'", [task.id])).rows[0].n, 1);
  }
  pass("Two user messages continue one private cloud conversation with real incremental events, saved deliverables and separate measured settlements; model turns explicitly synthetic");
  await panel.send("Page.reload");
  await until(() => evaluate("document.querySelectorAll('.from-assistant:not([data-live-task])').length"), v => v === 2, "saved conversation restored");
  await shot("continued-en"); pass("Panel reload restores the saved conversation and its two replies without Desktop or Native Messaging");
  process.chdir(delivery); media = await recording.stop(); recording = undefined; process.chdir(platform);
  assert.equal(await worker.evaluate(() => chrome.permissions.contains({ permissions: ["nativeMessaging"] })), false);
  await system.db.control.query("UPDATE tasks SET content_state='quarantined',moderation_version=moderation_version+1 WHERE id=$1", [second.id]);
  await evaluate("document.querySelector('#chat-refresh').click()");
  await until(() => evaluate("document.querySelector('#chat-unavailable').hidden"), v => v === false, "revoked source clears cached view");
  assert.equal(await evaluate("document.querySelector('#chat-messages').textContent.trim()"), "");
  pass("Current source read denial clears previously rendered message/output content and disables sending");
  await panel.close(); panel = undefined;
} catch (e) { errors.push(e instanceof Error ? e.stack ?? e.message : String(e)); console.error(errors.at(-1)); }
finally {
  if (deadline!) clearTimeout(deadline);
  if (recording) { try { process.chdir(delivery); media = await recording.stop(); } catch (e) { errors.push(String(e)); } }
  if (panel) await panel.close().catch((e: any) => errors.push(String(e)));
  if (context) await context.close().then(() => { browserClosed = true; }).catch(e => errors.push(String(e)));
  if (system) await system.app.close().then(() => { apiClosed = true; }).catch((e: any) => errors.push(String(e)));
  if (isolated) { process.chdir(platform); await isolated.cleanup().then(() => { fixtureClosed = true; }).catch((e: any) => errors.push(String(e))); }
  process.chdir(delivery);
  const result = { status: !errors.length && browserClosed && apiClosed && fixtureClosed ? "passed" : "failed", checks, errors, screenshots, media, browser_closed: browserClosed, api_closed: apiClosed, fixture_closed: fixtureClosed, model: "Explicit synthetic UI model turns; not a native Codex or live supplier qualification" };
  await writeFile(`evidence/extension-chat-${attempt}-journey.json`, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  assert.equal(result.status, "passed", "Inspect preserved native conversation journey");
}
