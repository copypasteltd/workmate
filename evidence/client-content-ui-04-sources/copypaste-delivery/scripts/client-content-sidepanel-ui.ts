import { chromium, type CDPSession, type Cookie } from "playwright";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string): Promise<T> {
  const end = Date.now()+30000; while(Date.now()<end) { const v=await read(); if(accept(v))return v; await new Promise(r=>setTimeout(r,100)); } throw Error("Side Panel timeout: "+label);
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
export async function openContentSidePanel(delivery: string, cookies: Cookie[]) {
  const extension = path.resolve(delivery, "../copypaste-extension"), id = (await readFile(path.join(extension, "extension-id.txt"), "utf8")).trim();
  const context = await chromium.launchPersistentContext(path.join(delivery, ".data/client-content-sidepanel", randomUUID()), { executablePath: process.env.CHROME_BIN, headless: false, viewport: null, args: ["--disable-gpu", "--window-size=1480,980", "--enable-unsafe-extension-debugging", "--disable-extensions-except="+path.join(extension,"dist"), "--load-extension="+path.join(extension,"dist")] });
  let panel: Awaited<ReturnType<typeof attach>> | undefined;
  try {
    await context.addCookies(cookies);
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker"); assert.ok(worker.url().includes(id));
    await worker.evaluate(() => chrome.storage.local.set({ locale: "en" }));
    await until(() => worker.evaluate(() => chrome.sidePanel.getPanelBehavior()), v => v.openPanelOnActionClick === true, "toolbar behavior");
    const main = context.pages()[0]; await main.goto("http://localhost:4317/");
    const width = await main.evaluate(() => innerWidth), count = context.pages().length, cdp = await context.browser()!.newBrowserCDPSession();
    const target = (await cdp.send("Target.getTargets", { filter: [{}] })).targetInfos.find(t => t.type === "tab" && t.url.startsWith("http://localhost:4317")); assert.ok(target);
    await (cdp as any).send("Extensions.triggerAction", { id, targetId: target.targetId });
    const native = (await until(() => worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] })), v => v.length === 1 && v[0].documentUrl === `chrome-extension://${id}/sidepanel.html`, "actual native context"))[0];
    assert.equal(native.documentUrl, `chrome-extension://${id}/sidepanel.html`); assert.equal(context.pages().length, count);
    const narrowed = await until(() => main.evaluate(() => innerWidth), v => v < width - 250, "docked layout");
    const layout = await worker.evaluate(() => chrome.sidePanel.getLayout()); assert.equal(layout.side, "right");
    const info = await until(async () => (await cdp.send("Target.getTargets", { filter: [{}] })).targetInfos.find(t => t.type === "page" && t.url === native.documentUrl), Boolean, "native document target"); assert.ok(info);
    panel = await attach(cdp, info.targetId);
    const evaluate = async (expression: string) => { const r = await panel!.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true }); assert.equal(r.exceptionDetails, undefined, JSON.stringify(r.exceptionDetails)); return r.result.value; };
    const capture = async () => Buffer.from((await panel!.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })).data, "base64");
    await until(() => evaluate("document.readyState==='complete' && document.fonts.status==='loaded'"), Boolean, "ready document");
    const authEvent = context.waitForEvent("page"); await evaluate("document.querySelector('#sign-in').click()"); const auth = await authEvent;
    await auth.getByRole("link", { name: /Authorize & return|授權並返回應用/ }).click();
    await until(() => evaluate("document.querySelector('#workspace').hidden===false && document.querySelector('#project').options.length>0"), Boolean, "real browser cookie and PKCE authorization");
    await auth.close().catch(() => {});
    return { evaluate, capture, native: { context_type: native.contextType, side: layout.side, width_before: width, width_after: narrowed, tab_count: count }, close: async () => { await panel?.close(); await context.close(); } };
  } catch (e) { await panel?.close(); await context.close(); throw e; }
}

