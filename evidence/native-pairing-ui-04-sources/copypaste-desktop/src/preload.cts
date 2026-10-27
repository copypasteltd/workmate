import { contextBridge, ipcRenderer } from "electron";

// Kept outside the Web renderer snapshot so every explicit renderer sync retains
// the native-only shell. No window IPC or Node primitives are exposed to Web UI.
document.addEventListener("DOMContentLoaded", () => {
  const style = document.createElement("style");
  style.id = "copypaste-window-style";
  style.textContent = `
    html, body { height:100%; overflow:hidden; }
    #root { position:fixed; inset:40px 0 0; overflow-y:auto; overflow-x:clip; transform:translateZ(0); scroll-padding-top:64px; }
    #root :is(.sidebar,.preference-controls) { translate:0 var(--cp-root-scroll,0px); }
    #root:focus-visible { outline:2px solid var(--blue,#1f5eff); outline-offset:-2px; }
    /* Keep native wheel, touchpad and keyboard scrolling without visible rails. */
    html, body, #root, #root * { scrollbar-width:none !important; }
    *::-webkit-scrollbar { display:none !important; width:0 !important; height:0 !important; }
    #root:has(.modal-backdrop) { overflow:hidden; }
    #root .modal-backdrop { top:var(--cp-root-scroll,0px); bottom:calc(0px - var(--cp-root-scroll,0px)); }
    #root .app-shell, #root .main-shell { min-height:calc(100vh - 40px); }
    #copypaste-titlebar { position:fixed; inset:0 0 auto; height:40px; z-index:10000;
      display:flex; align-items:center; justify-content:space-between; background:var(--bg,#f6f6f4);
      color:var(--ink,#15171a); border-bottom:1px solid var(--line,#e3e4e5); user-select:none; -webkit-app-region:drag; }
    #copypaste-titlebar .window-brand { display:flex; align-items:center; gap:8px; padding-left:16px;
      font:700 12px Manrope,"Microsoft JhengHei",sans-serif; letter-spacing:-.25px; }
    #copypaste-titlebar .window-brand img { width:20px; height:20px; }
    #copypaste-titlebar .window-actions { display:flex; align-self:stretch; -webkit-app-region:no-drag; }
    #copypaste-titlebar button { display:grid; place-items:center; width:48px; padding:0;
      border:0; border-radius:0; color:inherit; background:transparent; cursor:default; -webkit-app-region:no-drag; }
    #copypaste-titlebar button:hover { background:var(--line,#e3e4e5); }
    #copypaste-titlebar button[data-window-action="close"]:hover { background:#c42b1c; color:white; }
    #copypaste-titlebar button:focus-visible { outline:2px solid var(--blue,#1f5eff); outline-offset:-3px; }
    #copypaste-titlebar svg { width:12px; height:12px; fill:none; stroke:currentColor; stroke-width:1.25; }
    .cp-window-resize { position:fixed; z-index:10001; -webkit-app-region:no-drag; touch-action:none; }
    .cp-window-resize[data-edge="n"] { top:0; left:10px; right:10px; height:4px; cursor:n-resize; }
    .cp-window-resize[data-edge="s"] { bottom:0; left:10px; right:10px; height:4px; cursor:s-resize; }
    .cp-window-resize[data-edge="w"] { top:10px; bottom:10px; left:0; width:4px; cursor:w-resize; }
    .cp-window-resize[data-edge="e"] { top:10px; bottom:10px; right:0; width:4px; cursor:e-resize; }
    .cp-window-resize[data-edge="nw"] { top:0; left:0; width:10px; height:10px; cursor:nw-resize; }
    .cp-window-resize[data-edge="ne"] { top:0; right:0; width:10px; height:10px; cursor:ne-resize; }
    .cp-window-resize[data-edge="sw"] { bottom:0; left:0; width:10px; height:10px; cursor:sw-resize; }
    .cp-window-resize[data-edge="se"] { bottom:0; right:0; width:10px; height:10px; cursor:se-resize; }
    .cp-window-resize[hidden] { display:none; }
    .cp-window-resize:focus-visible { outline:2px solid var(--blue,#1f5eff); outline-offset:-2px; }
  `;
  document.head.append(style);
  // A transformed root contains fixed overlays. Offset its existing scroll so
  // navigation/preferences remain in view and dialogs stay below the title bar.
  const root = document.getElementById("root");
  // The native page scrolls inside this container, rather than the document.
  // Include it in keyboard navigation so Home/End target the visible page even
  // after a dialog or control has owned focus. Nested inputs/logs keep theirs.
  if (root) { root.tabIndex = 0; root.setAttribute("role", "region"); }
  const syncOverlayOffset = () => {
    root?.style.setProperty("--cp-root-scroll", `${root.scrollTop}px`);
  };
  // Chromium's document shortcuts can target the outer document instead of a
  // fixed scrolling root. Handle only the explicitly focused page container;
  // text fields, nested logs and Shift selection retain their own behavior.
  root?.addEventListener("keydown", (event) => {
    if (event.target !== root || event.defaultPrevented || event.altKey || event.shiftKey) return;
    if (event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    root.scrollTop = event.key === "Home" ? 0 : root.scrollHeight;
    syncOverlayOffset();
  });
  root?.addEventListener("scroll", syncOverlayOffset, { passive: true });
  syncOverlayOffset();
  const bar = document.createElement("header");
  bar.id = "copypaste-titlebar";
  const brand = document.createElement("span");
  brand.className = "window-brand";
  const logo = document.createElement("img");
  logo.src = new URL("./icon-32.png", location.href).href;
  logo.alt = "";
  brand.append(logo, "CopyPaste");
  const updates = document.createElement("button");
  updates.textContent = "↻";
  updates.setAttribute("aria-label", "應用程式更新 / Application updates");
  updates.style.cssText = "-webkit-app-region:no-drag;width:28px;height:28px;border-radius:8px;font-size:18px;margin-left:5px;";
  updates.addEventListener("click", () => { location.hash = "#/updates"; });
  brand.append(updates);
  const device = document.createElement("button");
  device.textContent = "⊘";
  device.setAttribute("aria-label", "此電腦與卸載 / This computer and uninstall");
  device.style.cssText = "-webkit-app-region:no-drag;width:28px;height:28px;border-radius:8px;font-size:18px;margin-left:5px;";
  device.addEventListener("click", () => { location.hash = "#/computer"; });
  brand.append(device);
  const actions = document.createElement("div");
  actions.className = "window-actions";
  const buttons = new Map<string, HTMLButtonElement>();
  const icon = (button: HTMLButtonElement, d: string) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 12 12");
    svg.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(svg.namespaceURI, "path");
    p.setAttribute("d", d);
    svg.append(p);
    button.replaceChildren(svg);
  };
  for (const [action, d] of [
    ["minimize", "M1 6h10"],
    ["toggle-maximize", "M1.5 1.5h9v9h-9z"],
    ["close", "M1.5 1.5l9 9m0-9-9 9"],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.windowAction = action;
    button.addEventListener("click", () => {
      void ipcRenderer.invoke("window:command", action).catch(() => {});
    });
    icon(button, d);
    buttons.set(action, button);
    actions.append(button);
  }
  bar.append(brand, actions);
  document.body.append(bar);
  const handles: HTMLElement[] = [];
  let pointer: { id: number; element: HTMLElement } | undefined;
  const finish = () => {
    if (!pointer) return;
    const { id, element } = pointer;
    pointer = undefined;
    if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
    ipcRenderer.send("window:resize", { kind: "end" });
  };
  for (const edge of ["n", "ne", "e", "se", "s", "sw", "w", "nw"]) {
    const handle = document.createElement("div");
    handle.className = "cp-window-resize";
    handle.dataset.edge = edge;
    if (edge === "se") {
      handle.tabIndex = 0;
      handle.setAttribute("role", "button");
    } else handle.setAttribute("aria-hidden", "true");
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      finish();
      handle.setPointerCapture(e.pointerId);
      pointer = { id: e.pointerId, element: handle };
      ipcRenderer.send("window:resize", {
        kind: "begin",
        edge,
        x: Math.round(e.screenX),
        y: Math.round(e.screenY),
      });
      e.preventDefault();
    });
    handle.addEventListener("pointermove", (e) => {
      if (pointer?.id === e.pointerId)
        ipcRenderer.send("window:resize", {
          kind: "move",
          x: Math.round(e.screenX),
          y: Math.round(e.screenY),
        });
    });
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("lostpointercapture", finish);
    handle.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 50 : 10;
      const deltas: Record<string, number[]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const delta = deltas[e.key];
      if (!delta) return;
      e.preventDefault();
      ipcRenderer.send("window:resize", {
        kind: "nudge",
        edge,
        dx: delta[0],
        dy: delta[1],
      });
    });
    handles.push(handle);
    document.body.append(handle);
  }
  window.addEventListener("blur", finish);
  let maximized = false;
  const labels = () => {
    const en = document.documentElement.lang.startsWith("en");
    root?.setAttribute("aria-label", en ? "CopyPaste workspace" : "CopyPaste 工作區");
    bar.setAttribute("aria-label", en ? "Application window" : "應用視窗");
    for (const [key, label] of [
      ["minimize", en ? "Minimize window" : "最小化視窗"],
      [
        "toggle-maximize",
        maximized
          ? en
            ? "Restore window"
            : "還原視窗"
          : en
            ? "Maximize window"
            : "最大化視窗",
      ],
      ["close", en ? "Close window" : "關閉視窗"],
    ]) {
      const b = buttons.get(key)!;
      b.setAttribute("aria-label", label);
      b.title = label;
    }
    handles
      .find((h) => h.dataset.edge === "se")
      ?.setAttribute(
        "aria-label",
        en
          ? "Resize window (arrow keys; Shift for larger steps)"
          : "調整視窗大小（方向鍵；Shift 加大幅度）",
      );
  };
  const update = (
    _: unknown,
    value: { maximized: boolean; fullscreen: boolean },
  ) => {
    maximized = value.maximized || value.fullscreen;
    bar.dataset.maximized = String(maximized);
    for (const handle of handles) handle.hidden = maximized;
    icon(
      buttons.get("toggle-maximize")!,
      maximized ? "M3.5 1.5h7v7m-9-5h7v7h-7z" : "M1.5 1.5h9v9h-9z",
    );
    labels();
  };
  ipcRenderer.on("window:state", update);
  void ipcRenderer
    .invoke("window:command", "state")
    .then((s) => update(null, s));
  new MutationObserver(labels).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"],
  });
  labels();
});
contextBridge.exposeInMainWorld(
  "copyPasteBridge",
  Object.freeze({
    version: "0.1.0",
    desktopRemoval: (action: "status" | "prepare" | "retry" | "uninstall-settings", payload?: { clearCache: boolean }) => ipcRenderer.invoke("desktop-removal", action, payload),
    onDesktopRemovalChanged: (fn: () => void) => {
      const listener = () => fn();
      ipcRenderer.on("desktop-removal:changed", listener);
      return () => ipcRenderer.removeListener("desktop-removal:changed", listener);
    },
    desktopUpdates: (action: "status" | "check" | "download" | "cancel" | "discard" | "install") => ipcRenderer.invoke("desktop-updates", action),
    onDesktopUpdatesChanged: (fn: () => void) => {
      const listener = () => fn();
      ipcRenderer.on("desktop-updates:changed", listener);
      return () => ipcRenderer.removeListener("desktop-updates:changed", listener);
    },
    openCloudWorkspace: (section?: "geo" | "devices") => ipcRenderer.invoke("workspace:cloud", section),
    localAgent: (action: string, payload: unknown) => ipcRenderer.invoke("local-agent", action, payload),
    onLocalAgentChanged: (fn: () => void) => {
      ipcRenderer.on("local-agent:changed", fn);
      return () => ipcRenderer.removeListener("local-agent:changed", fn);
    },
    enableChrome: () => ipcRenderer.invoke("chrome:register"),
    request: (p: string, o: unknown) => ipcRenderer.invoke("api", p, o),
    signIn: () => ipcRenderer.invoke("auth:signin"),
    signOut: () => ipcRenderer.invoke("auth:signout"),
    chooseDirectory: () => ipcRenderer.invoke("files:choose"),
    localGrants: () => ipcRenderer.invoke("files:grants"),
    revokeGrant: (id: string) => ipcRenderer.invoke("files:revoke", id),
    localFile: (c: unknown) => ipcRenderer.invoke("files:execute", c),
    syncDevice: (t: string) => ipcRenderer.invoke("device:sync", t),
    upload: (p: string, b: unknown) => ipcRenderer.invoke("asset:upload", p, b),
    download: (p: string, n: string, tenantId?: string) =>
      ipcRenderer.invoke("asset:download", p, n, tenantId),
    openExternal: (u: string) => ipcRenderer.invoke("external", u),
    authorizeConnector: (s: string) =>
      ipcRenderer.invoke("connector:authorize", s),
    onAuthChanged: (fn: () => void) => {
      ipcRenderer.on("auth:changed", fn);
      return () => ipcRenderer.removeListener("auth:changed", fn);
    },
  }),
);
