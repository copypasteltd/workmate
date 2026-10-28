import { chromium, type CDPSession, type Page } from "playwright";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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

export async function exerciseGeoSidePanel({ delivery, attempt, login, screenshots, media, pass }: {
  delivery: string; attempt: string; login: (page: Page) => Promise<void>; screenshots: any[]; media: any[]; pass: (s: string) => void;
}) {
  const extension = path.resolve(delivery, "../copypaste-extension"), id = (await readFile(path.join(extension, "extension-id.txt"), "utf8")).trim();
  const manifest = JSON.parse(await readFile(path.join(extension, "dist/manifest.json"), "utf8"));
  assert.equal(manifest.side_panel.default_path, "sidepanel.html"); assert.equal(manifest.action.default_popup, undefined);
  const context = await chromium.launchPersistentContext(path.join(delivery, ".data/geo-sidepanel", randomUUID()), {
    executablePath: process.env.CHROME_BIN, headless: false, viewport: null, timeout: 20000,
    args: ["--disable-gpu", "--window-size=1480,980", "--enable-unsafe-extension-debugging", "--disable-extensions-except=" + path.join(extension, "dist"), "--load-extension=" + path.join(extension, "dist")],
  });
  let panel: Awaited<ReturnType<typeof attach>> | undefined, recording: WorkmateRecording | undefined;
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker"); assert.ok(worker.url().includes(id));
    await until(() => worker.evaluate(() => chrome.sidePanel.getPanelBehavior()), v => v.openPanelOnActionClick === true, "toolbar opens panel");
    const main = context.pages()[0]; await main.goto("http://localhost:4317/");
    const width = await main.evaluate(() => innerWidth), count = context.pages().length, cdp = await context.browser()!.newBrowserCDPSession();
    const target = (await cdp.send("Target.getTargets", { filter: [{}] })).targetInfos.find(t => t.type === "tab" && t.url.startsWith("http://localhost:4317")); assert.ok(target);
    await (cdp as any).send("Extensions.triggerAction", { id, targetId: target.targetId });
    const native = (await until(() => worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] })), v => v.length === 1 && v[0].documentUrl === `chrome-extension://${id}/sidepanel.html`, "actual SIDE_PANEL document navigation"))[0];
    assert.equal(native.documentUrl, `chrome-extension://${id}/sidepanel.html`); assert.equal(context.pages().length, count);
    const narrowed = await until(() => main.evaluate(() => innerWidth), v => v < width - 250, "page beside panel");
    const layout = await worker.evaluate(() => chrome.sidePanel.getLayout()); assert.equal(layout.side, "right");
    const info = await until(async () => (await cdp.send("Target.getTargets", { filter: [{}] })).targetInfos.find(t => t.type === "page" && t.url === native.documentUrl), Boolean, "panel target"); assert.ok(info);
    panel = await attach(cdp, info.targetId);
    const evaluate = async (expression: string) => {
      const r = await panel!.send("Runtime.evaluate", { expression, returnByValue: true, userGesture: true, awaitPromise: true }); assert.equal(r.exceptionDetails, undefined); return r.result.value;
    };
    const capture = async () => Buffer.from((await panel!.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })).data, "base64");
    await until(() => evaluate("document.readyState==='complete' && document.querySelector('#sign-in') && document.fonts.status==='loaded'"), Boolean, "ready panel");
    const authEvent = context.waitForEvent("page"); await evaluate("document.querySelector('#sign-in').click()");
    const auth = await authEvent; await auth.waitForLoadState(); await login(auth);
    await auth.getByRole("link", { name: /Authorize & return|授權並返回應用/ }).click();
    await until(() => evaluate("document.querySelector('#workspace').hidden===false && document.querySelector('#project').options.length>0"), Boolean, "real OTP/PKCE authorization");
    await auth.close();
    await until(() => evaluate("document.querySelector('#geo-observations').textContent.trim()"), v => v === "GEO雲端樣本觀測", "Chinese label");
    recording = new WorkmateRecording("extension", "geo-sidepanel", "geo-" + attempt, capture, "Actual Chrome toolbar opens native right SIDE_PANEL; real email/PKCE sign-in, bilingual GEO entry and fixed cloud-workspace navigation. No local Agent, real model provider or automated consumer-product observation is claimed.", delivery);
    await recording.start();
    await evaluate("document.querySelector('#workspace-tools > summary').click(); document.querySelector('#geo-observations').scrollIntoView({block:'center'})");
    const shot = async (name: string) => {
      assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true);
      screenshots.push(await saveWorkmateScreenshot("extension", "geo-" + attempt, name, await capture(), "Actual native right Chrome SIDE_PANEL with cloud GEO handoff; synthetic account and observation data.", delivery));
    };
    await shot("native-panel-zh");
    await evaluate("document.querySelector('#locale').click()");
    await until(() => evaluate("document.querySelector('#geo-observations').textContent.trim()"), v => v === "GEO cloud observations", "English label");
    await shot("native-panel-en");
    const opened = context.waitForEvent("page"); await evaluate("document.querySelector('#geo-observations').click()");
    const workspace = await opened; await workspace.waitForURL("http://localhost:4317/app/analytics?view=geo");
    // The company Web session is the same user but has its own locale setting.
    await workspace.locator(".geo-section").first().waitFor();
    await workspace.close();
    pass("The real Chrome toolbar opens a right native SIDE_PANEL with no popup; real OTP/PKCE sign-in renders bilingual GEO navigation and opens the fixed company cloud workspace");
    media.push(await recording.stop()); recording = undefined;
    await main.goto("http://localhost:4317/login");
    assert.equal((await worker.evaluate(() => chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] })))[0].contextId, native.contextId);
    pass("The native Side Panel survives active-page navigation and both language layouts fit its actual width; the owned GEO workspace tab is closed");
    return { context_type: native.contextType, side: layout.side, toolbar_action: true, width_before: width, width_after: narrowed,
      browser: context.browser()!.version(), binary_sha256: createHash("sha256").update(await readFile(process.env.CHROME_BIN!)).digest("hex"), owned_context_closed: true };
  } finally {
    if (recording) await recording.stop().catch(() => {});
    if (panel) await panel.close(); await context.close();
  }
}
