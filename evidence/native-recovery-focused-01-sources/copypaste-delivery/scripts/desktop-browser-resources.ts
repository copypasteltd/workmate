import assert from "node:assert/strict";

export class DesktopBrowserResourceModel {
  private mode: "quota" | "fresh_hold" | "no_context" | "fresh_done" | null = null;
  private pending?: { call: string; action: string };
  private actions: string[] = []; private tabs: string[] = []; private ref = "";
  observations: { mode: string; action: string; value: any; actual_output: true }[] = [];
  constructor(private origin: () => string) {}
  begin(mode: NonNullable<typeof this.mode>) {
    this.mode = mode; this.pending = undefined; this.tabs = []; this.ref = "";
    this.actions = mode === "quota" ? ["open", "mark", "snapshot", "open_second", "open_third", "overflow", "popup_overflow", "check_denied", "close_third", "popup_reuse", "check_allowed", "tabs", "hold"]
      : mode === "no_context" ? ["open"] : ["open", "read_storage", ...(mode === "fresh_hold" ? ["hold"] : ["close"])];
  }
  end() { this.mode = null; this.pending = undefined; this.actions = []; }
  next(body: any, serial: number): any | null {
    if (!this.mode) return null;
    if (this.pending) {
      const result = body.input.find((item: any) => item.type === "function_call_output" && item.call_id === this.pending!.call);
      assert.ok(result, "Browser resource observations must return through the actual native Codex process");
      const text = typeof result.output === "string" ? result.output : result.output.map((item: any) => item.text ?? "").join("\n"), action = this.pending.action;
      let value: any = text;
      if (action === "overflow") assert.match(text, /BROWSER_TAB_LIMIT/);
      else if (this.mode === "no_context") assert.match(text, /BROWSER_CONTEXT_LIMIT/);
      else {
        value = JSON.parse(text);
        if (action.startsWith("open")) this.tabs.push(value.tab_id);
        if (action === "snapshot") { this.ref = value.elements.find((item: any) => item.name === "Open owned resource popup")?.ref; assert.ok(this.ref); }
        if (action === "check_denied") assert.equal(value.result, "false");
        if (action === "check_allowed") assert.equal(value.result, "true");
        if (action === "read_storage") { assert.equal(value.result.local, null); assert.ok(!value.result.cookie.includes("workmate_owner=")); }
        if (action === "tabs") { assert.equal(value.tabs.length, 3); assert.ok(!value.tabs.some((tab: any) => tab.tab_id === this.tabs[2])); }
        if (action.startsWith("close")) assert.equal(value.closed, true);
      }
      this.observations.push({ mode: this.mode, action, value, actual_output: true }); this.pending = undefined;
    }
    const action = this.actions.shift();
    if (!action) { this.end(); return { type: "message", id: "msg_browser_resource_" + serial, role: "assistant", status: "completed",
      content: [{ type: "output_text", text: "The owned browser resource check finished. No excess context or page was opened.", annotations: [] }] }; }
    const tool = action.startsWith("open") || action === "overflow" ? "open" : action.startsWith("popup_") ? "interact" : ["mark", "read_storage", "check_denied", "check_allowed"].includes(action) ? "evaluate" : action.startsWith("close") ? "close" : action === "hold" ? "request_user_input" : action;
    const definitions = (body.tools ?? []).flatMap((namespace: any) => namespace.type === "namespace" ? namespace.tools.map((child: any) => ({ ...child, qualified: namespace.name + "." + child.name })) : [{ ...namespace, qualified: namespace.name }]);
    const selected = definitions.find((item: any) => tool === "request_user_input" ? /(^|\.)request_user_input$/.test(item.qualified) : item.qualified === "copypaste_browser." + tool); assert.ok(selected);
    const args = tool === "open" ? { url: this.origin() } : action === "hold" ? { questions: [{ id: "resource_hold", header: "Owned browser", question: "Keep this task's browser open while you review its resource limits?", options: [{ label: "Keep open", description: "Keep this owned task waiting." }, { label: "Stop", description: "Stop from the application." }] }] }
      : action === "mark" ? { tab_id: this.tabs[0], expression: "(()=>{document.cookie='workmate_owner=first-task;path=/';localStorage.setItem('workmate_owner','first-task');const button=document.createElement('button');button.textContent='Open owned resource popup';button.onclick=()=>{document.body.dataset.ownedPopup=String(!!window.open(location.origin+'/popup'));};document.body.prepend(button);return true;})()" }
      : action === "read_storage" ? { tab_id: this.tabs[0], expression: "({cookie:document.cookie,local:localStorage.getItem('workmate_owner')})" }
      : action.startsWith("check_") ? { tab_id: this.tabs[0], expression: "document.body.dataset.ownedPopup" }
      : action.startsWith("popup_") ? { tab_id: this.tabs[0], action: "click", ref: this.ref }
      : action === "close_third" ? { tab_id: this.tabs[2] } : tool === "tabs" ? {} : { tab_id: this.tabs[0] };
    const call = "call_browser_resources_" + serial; this.pending = { call, action };
    return { type: "function_call", id: "fc_browser_resources_" + serial, call_id: call, ...(tool === "request_user_input" ? { name: selected.qualified } : { namespace: "copypaste_browser", name: tool }), arguments: JSON.stringify(args) };
  }
}

export async function exerciseDesktopBrowserResources(j: any) {
  const { page, electron, model } = j, before = model.observations.length;
  const windows = () => electron.evaluate(({ BrowserWindow }: any) => BrowserWindow.getAllWindows().filter((win: any) => !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed() && win.webContents.getURL().includes("/assets/browser-shell.html")).map((win: any) => win.id));
  const get = (id: string) => page.evaluate(async (value: any) => { const response = await (window as any).copyPasteBridge.localAgent("list", value.scope); if (!response.ok) throw new Error(response.code); return response.value.sessions.find((s: any) => s.id === value.id); }, { scope: j.scope, id });
  const create = async (mode: "quota" | "fresh_hold" | "no_context" | "fresh_done") => {
    await page.getByRole("button", { name: "Conversation", exact: true }).click(); await page.getByLabel("Local specialist", { exact: true }).selectOption("fullstack"); const old = (await j.list()).id;
    await page.getByRole("button", { name: "Choose folder to start", exact: true }).click(); const next = await j.until(j.list, (s: any) => s.id !== old, "independent browser resource owner");
    await page.getByLabel("Local permission", { exact: true }).selectOption("full-access"); await page.getByRole("button", { name: "Set permission", exact: true }).click();
    await j.until(j.list, (s: any) => s.permission === "full-access", "independent browser full permission");
    model.begin(mode); await page.getByLabel("Local task", { exact: true }).fill("Check the owned browser resources for " + mode + "."); await page.getByRole("button", { name: "Start work", exact: true }).click();
    return next.id;
  };
  const held: string[] = [], receipts: any[] = [];
  try {
    const first = await create("quota"); held.push(first);
    await j.until(() => get(first), (s: any) => s.busy && s.inputs?.some((q: any) => q.questions[0]?.id === "resource_hold"), "native normal/popup quota and explicit hold", 120000);
    const firstWindows = await windows(); assert.equal(firstWindows.length, 3);
    assert.ok(model.observations.some((o: any) => o.action === "overflow")); assert.ok(model.observations.some((o: any) => o.action === "check_allowed" && o.value.result === "true"));
    j.pass("Real Codex opens three owned pages, denies a fourth normal open and popup, then admits a popup only after the closed page is actually destroyed");
    const second = await create("fresh_hold"); held.push(second);
    await j.until(() => get(second), (s: any) => s.busy && s.inputs?.length > 0, "second actual browser context held", 90000);
    const both = await windows(); assert.equal(both.length, 4);
    const contexts = await electron.evaluate(({ BrowserWindow }: any) => {
      const pages = BrowserWindow.getAllWindows().filter((win: any) => !win.isDestroyed() && win.webContents && win.webContents.getURL().includes("/assets/browser-shell.html"));
      return new Set(pages.flatMap((win: any) => win.contentView.children.filter((view: any) => view.webContents && !view.webContents.isDestroyed()).map((view: any) => view.webContents.session))).size;
    }); assert.equal(contexts, 2);
    const third = await create("no_context"); const denied = await j.until(() => get(third), (s: any) => !s.busy && s.task?.status === "succeeded", "third actual context denied", 90000);
    assert.deepEqual((await windows()).sort(), both.sort()); assert.ok(model.observations.some((o: any) => o.mode === "no_context")); receipts.push(denied.task);
    j.pass("Two simultaneous real task owners use exactly two Electron Session contexts; a third native Codex task is denied without opening a window or evicting either owner");
    model.end();
    for (const id of [first, second]) {
      const response = await page.evaluate(async (id: string) => (window as any).copyPasteBridge.localAgent("stop", { id }), id); assert.equal(response.ok, true);
      receipts.push((await j.until(() => get(id), (s: any) => !s.busy, "owned browser resource cancellation", 30000)).task);
      if (id === first) { const left = await windows(); assert.equal(left.length, 1); assert.ok(left.every((value: number) => !firstWindows.includes(value))); }
    }
    await j.until(windows, (ids: number[]) => ids.length === 0, "both owned browser contexts fully released", 10000);
    j.pass("Stopping one browser owner closes only its three pages and preserves the other waiting task; stopping both drains all owned pages before context reuse");
    const fresh = await create("fresh_done"); receipts.push((await j.until(() => get(fresh), (s: any) => !s.busy && s.task?.status === "succeeded", "reused real context clears cookies and local storage", 90000)).task);
    await j.until(windows, (ids: number[]) => ids.length === 0, "reused context task closes actual page", 10000);
    for (const task of receipts) {
      assert.equal((await j.system.db.control.query("SELECT count(*)::int AS n FROM reservations WHERE task_id=$1", [task.task_id])).rows[0].n, 1);
      assert.equal((await j.system.db.control.query("SELECT execution_location FROM tasks WHERE id=$1", [task.task_id])).rows[0].execution_location, "desktop");
    }
    j.pass("A later native task reuses the cleared context with no previous cookie/localStorage and retains its own original Desktop company reservation and receipt");
    return { actual_outputs: model.observations.slice(before), actual_contexts_at_limit: contexts, receipts, all_owned_pages_closed: true };
  } finally {
    model.end();
    for (const id of held) await page.evaluate(async (id: string) => (window as any).copyPasteBridge.localAgent("stop", { id }), id).catch(() => {});
  }
}
