import { chromium, type CDPSession, type Page } from "playwright";
import { randomUUID, createHash } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";

async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string): Promise<T> {
  const end = Date.now() + 25000;
  do { const value = await read(); if (accept(value)) return value; await new Promise(r => setTimeout(r, 100)); } while (Date.now() < end);
  throw new Error("Native Side Panel timed out: " + label);
}
async function attach(parent: CDPSession, targetId: string) {
  const { sessionId } = await parent.send("Target.attachToTarget", { targetId, flatten: false });
  let sequence = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const receive = (event: any) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message), entry = pending.get(message.id); if (!entry) return;
    clearTimeout(entry.timer); pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
  };
  parent.on("Target.receivedMessageFromTarget", receive);
  return {
    send(method: string, params: Record<string, unknown> = {}): Promise<any> {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("Native CDP timed out: " + method)); }, 15000);
        pending.set(id, { resolve, reject, timer });
        void parent.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) }).catch(e => { clearTimeout(timer); pending.delete(id); reject(e); });
      });
    },
    async close() {
      parent.removeListener("Target.receivedMessageFromTarget", receive);
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error("Owned panel closed")); }
      pending.clear(); await parent.send("Target.detachFromTarget", { sessionId }).catch(() => {});
    },
  };
}

export async function exerciseProjectSidePanel({ delivery, attempt, conversationId, login, screenshots, media, pass, verifyAcceptedTask }: {
  delivery: string; attempt: string; conversationId: string; login: (page: Page) => Promise<void>;
  screenshots: any[]; media: any[]; pass: (s: string) => void; verifyAcceptedTask: (id: string) => Promise<void>;
}) {
  const extension = path.resolve(delivery, "../copypaste-extension"), id = (await readFile(path.join(extension, "extension-id.txt"), "utf8")).trim();
  const manifest = JSON.parse(await readFile(path.join(extension, "dist/manifest.json"), "utf8"));
  assert.equal(manifest.side_panel.default_path, "sidepanel.html"); assert.equal(manifest.action.default_popup, undefined);
  const context = await chromium.launchPersistentContext(path.join(delivery, ".data/guidance-sidepanel", randomUUID()), {
    executablePath: process.env.CHROME_BIN, headless: false, viewport: null, timeout: 20000,
    args: ["--disable-gpu", "--window-size=1480,980", "--enable-unsafe-extension-debugging", "--disable-extensions-except=" + path.join(extension, "dist"), "--load-extension=" + path.join(extension, "dist")],
  });
  let panel: Awaited<ReturnType<typeof attach>> | undefined, recording: WorkmateRecording | undefined;
  const viewportChecks: any[] = [];
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker"); assert.ok(worker.url().includes(id));
    await until(() => worker.evaluate(() => chrome.sidePanel.getPanelBehavior()), v => v.openPanelOnActionClick === true, "toolbar behavior");
    const main = context.pages()[0]; await main.goto("http://localhost:4317/");
    const before = await main.evaluate(() => innerWidth), pages = context.pages().length, cdp = await context.browser()!.newBrowserCDPSession();
    const tab = (await cdp.send("Target.getTargets", { filter: [{}] })).targetInfos.find(t => t.type === "tab" && t.url.startsWith("http://localhost:4317")); assert.ok(tab);
    await (cdp as any).send("Extensions.triggerAction", { id, targetId: tab.targetId });
    const native = (await until(() => worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] })), v => v.length === 1, "native context"))[0];
    assert.equal(native.documentUrl, `chrome-extension://${id}/sidepanel.html`); assert.equal(context.pages().length, pages);
    const after = await until(() => main.evaluate(() => innerWidth), v => v < before - 250, "page reflow beside panel");
    const layout = await worker.evaluate(() => chrome.sidePanel.getLayout()); assert.equal(layout.side, "right");
    const target = await until(async () => (await cdp.send("Target.getTargets", { filter: [{}] })).targetInfos.find(t => t.type === "page" && t.url === native.documentUrl), Boolean, "panel target"); assert.ok(target);
    panel = await attach(cdp, target.targetId);
    const evaluate = async (expression: string) => {
      const result = await panel!.send("Runtime.evaluate", { expression, returnByValue: true, userGesture: true, awaitPromise: true });
      assert.equal(result.exceptionDetails, undefined); return result.result.value;
    };
    const capture = async () => Buffer.from((await panel!.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })).data, "base64");
    const verifyViewport = async (state: string) => {
      const metrics = await until(() => evaluate(`(() => {
        const controls = ['chat-input','chat-send','chat-capture'].map(id => {
          const el = document.getElementById(id), r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x+r.width/2, r.y+r.height/2);
          return {id, top:r.top, bottom:r.bottom, left:r.left, right:r.right,
            reachable:r.width>0 && r.height>0 && r.top>=0 && r.left>=0 && r.bottom<=innerHeight+1 && r.right<=innerWidth+1 && !!hit && el.contains(hit)};
        });
        return {width:innerWidth,height:innerHeight,no_horizontal_overflow:document.documentElement.scrollWidth<=innerWidth+1,
          no_page_overflow:document.documentElement.scrollHeight<=innerHeight+1,controls,
          valid:controls.every(c=>c.reachable) && document.documentElement.scrollWidth<=innerWidth+1 && document.documentElement.scrollHeight<=innerHeight+1};
      })()`), v => !!v?.valid, "visible input, Send and Current page: " + state);
      viewportChecks.push({state,...metrics});
    };
    const click = async (selector: string) => {
      const point = await evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await panel!.send("Input.dispatchMouseEvent", {type:"mousePressed",button:"left",clickCount:1,...point});
      await panel!.send("Input.dispatchMouseEvent", {type:"mouseReleased",button:"left",clickCount:1,...point});
    };
    await until(() => evaluate("document.readyState==='complete' && document.querySelector('#sign-in') && document.fonts.status==='loaded'"), Boolean, "ready document");
    const authEvent = context.waitForEvent("page"); await evaluate("document.querySelector('#sign-in').click()");
    const auth = await authEvent; await auth.waitForLoadState(); await login(auth);
    await auth.getByRole("link", { name: /Authorize & return|授權並返回應用/ }).click();
    await until(() => evaluate("document.querySelector('#workspace').hidden===false && document.querySelector('#project').options.length>0"), Boolean, "real OTP/PKCE");
    await auth.close(); await evaluate("document.querySelector('#locale').click()");
    await evaluate("document.querySelector('#chat-new').click()");
    await until(() => evaluate("!document.querySelector('#chat-project-brief').hidden && document.querySelector('#chat-project-summary').textContent==='Shared project guidance · v3'"), Boolean, "current shared publication");
    recording = new WorkmateRecording("extension", "project-guidance-sidepanel", "guidance-" + attempt, capture,
      "Actual Chrome right SIDE_PANEL and OTP/PKCE; current versus accepted shared versions, controlled file selection/upload and cloud acceptance. Worker disabled, no model execution or Desktop dependency.", delivery);
    await recording.start();
    const shot = async (name: string) => {
      await verifyViewport(name);
      screenshots.push(await saveWorkmateScreenshot("extension", "guidance-" + attempt, name, await capture(), "Actual native right SIDE_PANEL with shared project guidance. Fixture file selection and real protected upload/acceptance; no model run or local Desktop dependency.", delivery));
    };
    await evaluate("document.querySelector('#chat-project-brief').open=true"); await shot("native-current-v3-en");
    pass("The actual Chrome toolbar opens a native right SIDE_PANEL; real OTP/PKCE loads shared project v3 as read-only guidance without Desktop");
    await evaluate(`(() => {const select=document.querySelector('#chat-history');select.value=${JSON.stringify(conversationId)};select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
    await until(() => evaluate(`document.querySelector('#chat-project-summary').textContent===${JSON.stringify("This task's guidance · v1")}`), Boolean, "accepted old task version one");
    await shot("native-old-task-v1-en"); await evaluate("document.querySelector('#chat-new').click()");
    await until(() => evaluate("document.querySelector('#chat-project-summary').textContent==='Shared project guidance · v3'"), Boolean, "new chat current version");
    await evaluate(`(() => {const files=new DataTransfer();files.items.add(new File(['Explicit synthetic attachment: approved HK$120 offer.'],'panel-approved.txt',{type:'text/plain'}));const input=document.querySelector('#chat-file');input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
    await until(() => evaluate("document.querySelector('#chat-attachments .chat-attachment.ready')?.textContent.includes('panel-approved.txt')"), Boolean, "actual authorized cloud upload");
    await evaluate("(() => {const input=document.querySelector('#chat-input');input.value='Prepare a synthetic campaign using my approved attachment.';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#chat-budget').value='1';return true;})()");
    await verifyViewport("ready attachment before pointer Send"); await click("#chat-send");
    const acceptedTask = await until<string>(() => evaluate("document.querySelector('#chat-messages [data-live-task]')?.dataset.liveTask"), Boolean, "accepted cloud task");
    await verifyAcceptedTask(acceptedTask);
    await shot("native-accepted-v3-attachment-en"); await evaluate("document.querySelector('#chat-stop').click()");
    await until(() => evaluate("document.querySelector('#chat-stop').hidden"), Boolean, "queued cloud task cancelled without a model call");
    pass("The native panel preserves old task v1, uses v3 for a new chat and binds the explicitly selected attachment to the actor's private conversation; exact owner download succeeds while the same-project editor cannot list, read versions, download or open its conversation; Stop cancels the one queued cloud task");
    await evaluate("document.querySelector('#locale').click()"); await until(() => evaluate("document.querySelector('#chat-project-summary').textContent.includes('v3') && document.querySelector('#chat-new').textContent.includes('新會話')"), Boolean, "Traditional Chinese version summary");
    await shot("native-guidance-zh"); await main.goto("http://localhost:4317/login");
    assert.equal((await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] })))[0].contextId, native.contextId);
    pass("The actual narrow native panel wraps shared guidance in both languages and survives active-page navigation; owned panel/context cleanup is enforced");
    await evaluate("document.querySelector('.chat-settings').open=true");
    await shot("native-settings-zh");
    const hostTarget = (await cdp.send("Target.getTargets", {filter:[{}]})).targetInfos.find(t => t.type === "page" && t.url === main.url()); assert.ok(hostTarget);
    const hostWindow = await cdp.send("Browser.getWindowForTarget", {targetId:hostTarget.targetId});
    const tall = await evaluate("innerHeight");
    await cdp.send("Browser.setWindowBounds", {windowId:hostWindow.windowId,bounds:{width:1180,height:740}});
    await until(() => evaluate("innerHeight"), v => v < tall && v >= 500, "actual compact Chrome window");
    await shot("native-compact-settings-zh");
    pass("Actual native Side Panel input, Send and Current page remain visible and hit-testable with expanded guidance/settings in both languages and an actual compact Chrome window; pointer Send accepts the private attachment");
    await evaluate(`(() => {
      const tools=document.querySelector('#workspace-tools');tools.open=true;
      const controls=[...tools.querySelectorAll('button,input,select,textarea,summary')].filter(e=>e.tabIndex>=0 && !e.matches(':disabled') && e.checkVisibility());
      const last=controls.at(-1);if(!last)throw new Error('No reachable advanced control');
      last.focus();last.scrollIntoView({block:'center'});return true;
    })()`);
    const lastControl = await evaluate(`(() => {
      const el=document.activeElement,r=el.getBoundingClientRect();
      return {name:el.id||el.tagName,focused:document.querySelector('#workspace-tools').contains(el),in_view:r.top>=0&&r.bottom<=innerHeight,scroll_top:document.querySelector('#workspace-tools').scrollTop};
    })()`);
    assert.ok(lastControl.focused && lastControl.in_view && lastControl.scroll_top > 0, JSON.stringify(lastControl));
    await click("#workspace-tools > summary");
    assert.equal(await evaluate("document.querySelector('#workspace-tools').open"), false);
    await shot("native-compact-return-chat-zh");
    pass("Advanced workspace tools retain a keyboard-reachable final control and sticky close summary; closing returns to the visible native chat composer without losing the conversation");
    media.push(await recording.stop()); recording = undefined;
    return { context_type: native.contextType, side: layout.side, toolbar_action: true, width_before: before, width_after: after,
      accepted_task_id: acceptedTask, current_publication: 3, retained_publication: 1, browser: context.browser()!.version(),
      viewport_checks: viewportChecks, pointer_send: true, advanced_last_control: lastControl,
      binary_sha256: createHash("sha256").update(await readFile(process.env.CHROME_BIN!)).digest("hex"), owned_context_closed: true };
  } finally { if (recording) await recording.stop().catch(() => {}); if (panel) await panel.close(); await context.close(); }
}
