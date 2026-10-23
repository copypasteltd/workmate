import { BrowserWindow, WebContentsView, session, ipcMain, type WebContents, type DownloadItem, type Session } from "electron";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, realpath, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { browserURL, BrowserToolError, type BrowserOwner, type BrowserToolResult } from "./browser-contract.js";
import { GuardedBrowserSession, type BrowserDriver } from "./browser-session.js";

interface Download {
  id: string; name: string; state: string; bytes: number; path?: string; sha256?: string; item?: DownloadItem;
}
interface Page {
  id: string; window: BrowserWindow; view: WebContentsView; document: string; context?: number;
  closed: boolean; dialog?: { type: string; message: string; defaultPrompt?: string }; downloads: Download[];
  answerDialog?: (accept: boolean, text: string) => void;
  dialogCommands: Set<Promise<unknown>>;
}
const root = path.dirname(fileURLToPath(import.meta.url));
const output = (value: unknown): BrowserToolResult => ({ success: true, contentItems: [{ type: "inputText", text: JSON.stringify(value) }] });
const javascript = String.raw;

/** This expression runs only in a separate, unprivileged Chromium world. */
const snapshotScript = javascript`(() => {
  const state = globalThis.__copypasteElements ??= {nodes:new Map(), ids:new WeakMap(), next:0};
  const visible = element => {
    const r=element.getBoundingClientRect(), css=getComputedStyle(element);
    return !!r.width && !!r.height && css.visibility!=='hidden' && css.display!=='none';
  };
  const text = element => (element.innerText || element.textContent || '').trim().replace(/\s+/g,' ').slice(0,300);
  const elements = [...document.querySelectorAll('a[href],button,input,textarea,select,[role],[contenteditable="true"],summary')]
    .filter(visible).slice(0,500).map(element => {
      let id=state.ids.get(element);
      if(!id) { id=String(++state.next); state.ids.set(element,id); state.nodes.set(id,element); }
      const tag=element.tagName.toLowerCase();
      return {ref:__DOCUMENT__+':'+id,tag,role:element.getAttribute('role'),type:element.getAttribute('type'),
        name:(element.getAttribute('aria-label') || element.labels?.[0]?.innerText || element.getAttribute('placeholder') || text(element)).slice(0,300),
        value:element.type==='password'?undefined:typeof element.value==='string'?element.value.slice(0,1000):undefined,
        disabled:!!element.disabled,checked:typeof element.checked==='boolean'?element.checked:undefined,
        options:tag==='select'?[...element.options].slice(0,100).map(o=>({value:o.value,label:o.label,selected:o.selected})):undefined};
    });
  return {title:document.title,url:location.href,ready:document.readyState,text:(document.body?.innerText || '').slice(0,24000),elements};
})()`;

export class NativeBrowserPool {
  private pages = new Set<Page>();
  private sessions = new Set<NativeBrowserDriver>();
  private ipcInstalled = false;
  create(owner: BrowserOwner, authorize: () => Promise<void>) {
    if (!this.ipcInstalled) {
      this.ipcInstalled = true;
      ipcMain.handle("native-browser:action", async (event, action: unknown, value: unknown) => {
        if(event.senderFrame!==event.sender.mainFrame)throw new Error("BROWSER_CHROME_UNAVAILABLE");
        const driver = [...this.sessions].find(item => item.ownsChrome(event.sender));
        if (!driver) throw new Error("BROWSER_CHROME_UNAVAILABLE");
        return driver.chromeAction(event.sender, action, value);
      });
      // The page preload exposes only standard window.prompt, never generic
      // IPC or app credentials. A separate trusted renderer remains responsive
      // while the requesting page waits for its actual answer.
      ipcMain.on("native-browser:prompt", (event, value: unknown) => {
        const driver=[...this.sessions].find(item=>item.ownsPage(event.sender));
        if(!driver||!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(key=>!["message","defaultPrompt"].includes(key))
          ||typeof (value as any).message!=="string"||(value as any).message.length>2000||typeof (value as any).defaultPrompt!=="string"||(value as any).defaultPrompt.length>4096) {event.returnValue=null;return;}
        void driver.prompt(event.sender,value as {message:string;defaultPrompt:string},answer=>{event.returnValue=answer;}).catch(()=>{event.returnValue=null;});
      });
    }
    const driver = new NativeBrowserDriver(owner, authorize, this.pages, () => this.sessions.delete(driver));
    this.sessions.add(driver);
    return new GuardedBrowserSession(driver, authorize);
  }
  async close() { await Promise.allSettled([...this.sessions].map(driver => driver.close())); }
}

class NativeBrowserDriver implements BrowserDriver {
  private pages = new Map<string, Page>();
  private closed = false;
  private shutdown = new AbortController();
  private browserSession?: Session;
  private downloadListener?: Parameters<Session["on"]>[1];
  private pending = new Set<Promise<unknown>>();
  private closing?: Promise<void>;
  constructor(private owner: BrowserOwner, private authorize: () => Promise<void>, private allPages: Set<Page>, private dispose: () => void) {}

  ownsChrome(contents: WebContents) { return [...this.pages.values()].some(page => !page.closed && page.window.webContents === contents); }
  ownsPage(contents: WebContents) { return [...this.pages.values()].some(page => !page.closed && page.view.webContents === contents); }
  async prompt(contents: WebContents,value: {message:string;defaultPrompt:string},answer: (text:string|null)=>void) {
    await this.authority();
    const page=[...this.pages.values()].find(page=>!page.closed&&page.view.webContents===contents);
    if(!page||page.dialog)throw new BrowserToolError("BROWSER_DIALOG_UNAVAILABLE");
    let answered=false;
    page.answerDialog=(accept,text)=>{
      if(answered)return;answered=true;page.answerDialog=undefined;page.dialog=undefined;
      answer(accept?text:null);this.update(page);
    };
    page.dialog={type:"prompt",message:value.message,defaultPrompt:value.defaultPrompt};this.update(page);
  }
  private alive(signal?: AbortSignal) {
    if (this.closed || this.shutdown.signal.aborted || signal?.aborted) throw new BrowserToolError("BROWSER_INTERRUPTED", false);
  }
  private async authority(signal?: AbortSignal) { this.alive(signal); await this.authorize(); this.alive(signal); }
  private get(id: unknown) {
    const page = this.pages.get(String(id));
    if (!page || page.closed || page.view.webContents.isDestroyed()) throw new BrowserToolError("BROWSER_TAB_UNAVAILABLE");
    return page;
  }
  private async delay(ms: number, signal: AbortSignal) {
    this.alive(signal);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(done, ms);
      const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new BrowserToolError("BROWSER_INTERRUPTED", false)); };
      function done() { signal.removeEventListener("abort", abort); resolve(); }
      signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
    });
  }
  private describe(page: Page) {
    return { tab_id: page.id, title: page.view.webContents.getTitle().slice(0,200), url: page.view.webContents.getURL(),
      loading: page.view.webContents.isLoading(), dialog: page.dialog, origin: "customer_device_untrusted_web_content" };
  }
  private update(page: Page) {
    if (page.closed || page.window.isDestroyed() || page.window.webContents.isDestroyed()) return;
    const contents = page.view.webContents;
    this.layout(page);
    page.window.contentView.addChildView(page.view);
    page.window.webContents.send("native-browser:state", { ...this.describe(page),
      canBack: contents.navigationHistory.canGoBack(), canForward: contents.navigationHistory.canGoForward() });
  }
  private layout(page: Page) {
    if (page.closed || page.window.isDestroyed()) return;
    const [width,height]=page.window.getContentSize(), top=page.dialog?210:94;
    page.view.setBounds({x:0,y:top,width,height:Math.max(1,height-top)});
  }
  private async getSession() {
    if (this.browserSession) return this.browserSession;
    // Separate from the app's auth session and from installed Chrome. A task's
    // pages share cookies; unrelated local sessions and workflow children do not.
    const partition = createHash("sha256").update([this.owner.actorId,this.owner.epoch,this.owner.tenantId,this.owner.projectId,this.owner.sessionId].join(":")).digest("hex");
    const ses = session.fromPartition("persist:copypaste-browser-" + partition);
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    const listener = (_event: Electron.Event, item: DownloadItem, contents: WebContents) => {
      const page = [...this.pages.values()].find(p => !p.closed && p.view.webContents === contents);
      if (!page || this.closed || page.downloads.length >= 20 || item.getTotalBytes() > 100_000_000) { item.cancel(); return; }
      const record: Download = { id: randomUUID(), name: item.getFilename().replace(/[<>:"/\\|?*\x00-\x1f]/g,"_").slice(0,120) || "download", state: "preparing", bytes: 0, item };
      page.downloads.push(record);
      // Electron needs setSavePath synchronously in will-download. The directory
      // was created before opening the first page; no OS save dialog is bypassed
      // asynchronously or left hanging behind the agent.
      record.path = path.join(this.owner.workspace,"browser-downloads",record.id + "-" + record.name);
      item.setSavePath(record.path); record.state = "progressing";
      item.on("updated", (_event, state) => {
        record.bytes = item.getReceivedBytes(); record.state = state;
        if (this.closed || page.closed || record.bytes > 100_000_000) item.cancel();
      });
      item.once("done", (_event, state) => {
        record.state = state; record.bytes = item.getReceivedBytes(); record.item = undefined;
        const finish = (async () => {
          if (state === "completed" && record.path) {
            const digest = createHash("sha256");
            for await (const chunk of createReadStream(record.path)) digest.update(chunk);
            record.sha256 = digest.digest("hex");
          } else if (record.path) await unlink(record.path).catch(() => {});
        })().catch(() => { record.state = "verification_failed"; }).finally(() => this.pending.delete(finish));
        this.pending.add(finish);
      });
    };
    ses.on("will-download", listener);
    // Retain the exact listener: shared session objects must not lose other listeners.
    this.downloadListener = listener as any;
    this.browserSession = ses;
    return ses;
  }
  private makePage(ses: Session, popupPreferences: Electron.WebPreferences = {}) {
    this.alive();
    if (this.pages.size >= 4 || this.allPages.size >= 8) throw new BrowserToolError("BROWSER_TAB_LIMIT");
    const window = new BrowserWindow({ width: 1180, height: 820, minWidth: 640, minHeight: 480,
      frame: false, thickFrame: false, autoHideMenuBar: true, backgroundColor: "#FAFAF8", show: false,
      webPreferences: { preload: path.join(root,"browser-preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    window.setMenu(null); window.setMenuBarVisibility(false);
    const view = new WebContentsView({ webPreferences: { ...popupPreferences, session: ses,
      preload: path.join(root,"browser-page-preload.cjs"), nodeIntegration: false, nodeIntegrationInSubFrames: false,
      contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
      webviewTag: false, navigateOnDragDrop: false } });
    window.contentView.addChildView(view);
    const page: Page = { id: randomUUID(), window, view, document: randomBytes(8).toString("hex"), closed: false, downloads: [], dialogCommands: new Set() };
    this.pages.set(page.id,page); this.allPages.add(page);
    const resize = () => this.layout(page);
    window.on("resize",resize); resize();
    window.on("closed",() => this.closePage(page));
    window.webContents.on("will-navigate", event => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("did-finish-load",() => { this.update(page); if (!page.closed) window.show(); });
    view.webContents.on("did-start-navigation", (_event,_url,_inPlace,isMainFrame) => {
      if (isMainFrame) { page.document=randomBytes(8).toString("hex"); page.context=undefined; page.dialog=undefined; }
      this.update(page);
    });
    const allowURL = (event: Electron.Event,url: string) => { try { browserURL(url); } catch { if (url !== "about:blank") event.preventDefault(); } };
    view.webContents.on("will-navigate",allowURL);
    view.webContents.on("will-redirect",allowURL);
    view.webContents.on("will-attach-webview",event => event.preventDefault());
    view.webContents.on("did-stop-loading",() => this.update(page));
    view.webContents.on("did-navigate",() => this.update(page));
    view.webContents.on("did-navigate-in-page",() => this.update(page));
    view.webContents.on("page-title-updated",() => this.update(page));
    view.webContents.on("render-process-gone",() => this.closePage(page));
    view.webContents.setWindowOpenHandler(details => {
      try { if(details.url!=="about:blank")browserURL(details.url); this.alive(); if(this.pages.size>=4 || this.allPages.size>=8) return { action: "deny" }; }
      catch { return { action: "deny" }; }
      return { action: "allow", createWindow: options => {
        // Electron passes opener/security preferences; preserve its internal
        // opener linkage while overriding every privileged web preference.
        const popup=this.makePage(ses,options.webPreferences);
        void this.attach(popup).catch(() => this.closePage(popup));
        return popup.view.webContents;
      } };
    });
    void window.loadFile(path.join(root,"../assets/browser-shell.html")).catch(() => this.closePage(page));
    return page;
  }
  private async attach(page: Page) {
    const debuggerAPI=page.view.webContents.debugger;
    debuggerAPI.attach("1.3");
    debuggerAPI.on("message",(_event,method,params) => {
      if(method==="Page.javascriptDialogOpening") { page.dialog={type:params.type,message:String(params.message).slice(0,2000),defaultPrompt:params.defaultPrompt}; this.update(page); }
      if(method==="Page.javascriptDialogClosed") { page.dialog=undefined; this.update(page); }
    });
    await this.cdp(page,"Page.enable");
    await this.cdp(page,"Runtime.enable");
  }
  private async cdp(page: Page, method: string, params: Record<string,unknown> = {}) {
    if(page.closed || page.view.webContents.isDestroyed()) throw new BrowserToolError("BROWSER_TAB_UNAVAILABLE");
    const pending=page.view.webContents.debugger.sendCommand(method,params);
    const mayOpenDialog=["Runtime.evaluate","Input.dispatchMouseEvent","Input.dispatchKeyEvent","Input.insertText"].includes(method);
    // Chromium may suspend a script/input command until its JS dialog closes.
    // Release the tool protocol so a subsequent dialog tool can answer it.
    let timer: ReturnType<typeof setInterval> | undefined;
    const deadline=Date.now()+10000;
    try {
      return await Promise.race([pending,new Promise<any>((resolve,reject)=>{
        timer=setInterval(()=>{
          if(page.closed||this.closed)reject(new BrowserToolError("BROWSER_INTERRUPTED",false));
          else if(mayOpenDialog&&page.dialog){
            page.dialogCommands.add(pending);
            void pending.finally(()=>page.dialogCommands.delete(pending)).catch(()=>{});
            resolve({__copypasteDialogPending:true});
          }
          else if(Date.now()>=deadline)reject(new BrowserToolError("BROWSER_ACTION_OUTCOME_UNKNOWN",false));
        },30);
      })]);
    } finally {if(timer)clearInterval(timer);}
  }
  private async context(page: Page) {
    if(page.context) return page.context;
    const document=page.document;
    const tree=await this.cdp(page,"Page.getFrameTree");
    const world=await this.cdp(page,"Page.createIsolatedWorld",{frameId:tree.frameTree.frame.id,worldName:"copypaste-local-agent",grantUniveralAccess:false});
    if(document!==page.document) throw new BrowserToolError("BROWSER_DOCUMENT_CHANGED");
    return page.context=world.executionContextId;
  }
  private async evaluate(page: Page, expression: string, byValue = true) {
    const contextId=await this.context(page);
    const result=await this.cdp(page,"Runtime.evaluate",{expression,contextId,returnByValue:byValue,awaitPromise:true,timeout:5000});
    if(result.__copypasteDialogPending)return {dialog:page.dialog,waiting_for_dialog:true};
    if(result.exceptionDetails) throw new BrowserToolError("BROWSER_PAGE_SCRIPT_FAILED");
    if(byValue && result.result?.type==="object" && !Object.hasOwn(result.result,"value") && result.result?.subtype!=="null") throw new BrowserToolError("BROWSER_RESULT_NOT_SERIALIZABLE");
    return byValue?result.result?.value:result.result;
  }
  private element(page: Page, ref: unknown) {
    const [document,id]=String(ref).split(":");
    if(document!==page.document) throw new BrowserToolError("BROWSER_ELEMENT_STALE");
    return `(() => { const e=globalThis.__copypasteElements?.nodes.get(${JSON.stringify(id)}); if(!e?.isConnected) throw new Error('stale element'); return e; })()`;
  }
  private async point(page: Page, ref: unknown) {
    const element=this.element(page,ref);
    const point=await this.evaluate(page,`(async () => {const e=${element};e.scrollIntoView({block:'center',inline:'center'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);return {x,y,valid:e.isConnected&&r.width>0&&r.height>0&&x>=0&&y>=0&&x<innerWidth&&y<innerHeight&&(hit===e||e.contains(hit))&&!e.disabled};})()`);
    if(!point?.valid) throw new BrowserToolError("BROWSER_ELEMENT_NOT_INTERACTABLE");
    return {x:point.x,y:point.y};
  }
  private async mouse(page: Page, point: {x:number;y:number}, type: string, button = "left", buttons = 0) {
    return this.cdp(page,"Input.dispatchMouseEvent",{type,...point,button,buttons,...(type==="mousePressed"||type==="mouseReleased"?{clickCount:1}:{})});
  }
  private async interaction(page: Page,args: Record<string,any>,signal: AbortSignal) {
    const action=args.action;
    page.window.show(); page.window.focus(); page.view.webContents.focus();
    if(action==="click" || action==="drag") {
      await this.authority(signal);
      const from=args.ref?await this.point(page,args.ref):{x:args.x,y:args.y};
      const size=page.view.getBounds();
      if(from.x<0||from.y<0||from.x>=size.width||from.y>=size.height) throw new BrowserToolError("BROWSER_INPUT_INVALID");
      const to=action==="drag"?await this.point(page,args.target_ref):from;
      this.alive(signal);
      await this.mouse(page,from,"mouseMoved"); await this.mouse(page,from,"mousePressed","left",1);
      try {
        if(action==="drag") for(let i=1;i<=12;i++) {this.alive(signal);await this.mouse(page,{x:from.x+(to.x-from.x)*i/12,y:from.y+(to.y-from.y)*i/12},"mouseMoved","left",1);}
      } finally { if(!page.closed) await this.mouse(page,to,"mouseReleased","left",0); }
    } else if(["fill","type","select"].includes(action)) {
      await this.point(page,args.ref); await this.authority(signal);
      const element=this.element(page,args.ref), text=JSON.stringify(args.text);
      if(action==="type") {
        await this.evaluate(page,`(() => {const e=${element}; if(!(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement||e.isContentEditable)||e.disabled||e.readOnly) throw new Error('not editable'); e.focus(); return true;})()`);
        await this.cdp(page,"Input.insertText",{text:args.text});
      } else await this.evaluate(page,`(() => { const e=${element};const value=${text};if(e.disabled||e.readOnly)throw new Error('not editable');
        if(${JSON.stringify(action)}==='select') { if(!(e instanceof HTMLSelectElement)||![...e.options].some(o=>o.value===value))throw new Error('invalid option'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,value); }
        else if(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement) {if(e.type==='file')throw new Error('use upload');Object.getOwnPropertyDescriptor(e instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLTextAreaElement.prototype,'value').set.call(e,value);}
        else if(e.isContentEditable)e.textContent=value;else throw new Error('not editable');e.focus();e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
    } else if(action==="press") {
      if(args.ref) { await this.point(page,args.ref); await this.evaluate(page,`(${this.element(page,args.ref)}).focus()`); }
      const parts=String(args.key).split("+"), key=parts.pop()!;
      let modifiers=0;
      for(const modifier of parts) {const bit=({Alt:1,Control:2,Meta:4,Shift:8} as any)[modifier];if(!bit || (modifiers&bit))throw new BrowserToolError("BROWSER_INPUT_INVALID");modifiers|=bit;}
      const keys:Record<string,[string,number,string?]>={Enter:["Enter",13,"\r"],Tab:["Tab",9,"\t"],Escape:["Escape",27],Backspace:["Backspace",8],Delete:["Delete",46],ArrowLeft:["ArrowLeft",37],ArrowUp:["ArrowUp",38],ArrowRight:["ArrowRight",39],ArrowDown:["ArrowDown",40],Home:["Home",36],End:["End",35],PageUp:["PageUp",33],PageDown:["PageDown",34],Space:[" ",32," "]};
      const data=keys[key]??(key.length===1?[key,key.toUpperCase().charCodeAt(0),key]:undefined);
      if(!data)throw new BrowserToolError("BROWSER_INPUT_INVALID");
      await this.authority(signal);
      const params={key:data[0],windowsVirtualKeyCode:data[1],nativeVirtualKeyCode:data[1],modifiers};
      await this.cdp(page,"Input.dispatchKeyEvent",{type:"keyDown",...params,...(!(modifiers&7)&&data[2]?{text:data[2]}:{})});
      await this.cdp(page,"Input.dispatchKeyEvent",{type:"keyUp",...params});
    } else if(action==="scroll") {
      if(Math.abs(args.x)>10000||Math.abs(args.y)>10000)throw new BrowserToolError("BROWSER_INPUT_INVALID");
      await this.authority(signal);
      await this.cdp(page,"Input.dispatchMouseEvent",{type:"mouseWheel",x:100,y:100,deltaX:args.x,deltaY:args.y});
    } else if(action==="upload") {
      const files:string[]=[];let size=0;
      for(const file of args.files) {if(!path.isAbsolute(file))throw new BrowserToolError("BROWSER_INPUT_INVALID");const local=await realpath(file),info=await stat(local);if(!info.isFile()||(size+=info.size)>100_000_000)throw new BrowserToolError("BROWSER_UPLOAD_LIMIT");files.push(local);}
      const element=this.element(page,args.ref);
      if(!await this.evaluate(page,`(() => {const e=${element};return e instanceof HTMLInputElement&&e.type==='file'&&!e.disabled&&(e.multiple||${files.length}===1);})()`))throw new BrowserToolError("BROWSER_INPUT_INVALID");
      const remote=await this.evaluate(page,element,false);
      try {
        const node=await this.cdp(page,"DOM.describeNode",{objectId:remote.objectId});
        await this.authority(signal);
        await this.cdp(page,"DOM.setFileInputFiles",{files,backendNodeId:node.node.backendNodeId});
      } finally {if(remote.objectId)await this.cdp(page,"Runtime.releaseObject",{objectId:remote.objectId}).catch(()=>{});}
    }
    return output({...this.describe(page),action,performed:true});
  }
  async execute(tool: string,args: Record<string,any>,external: AbortSignal): Promise<BrowserToolResult> {
    const signal=AbortSignal.any([external,this.shutdown.signal]);
    await this.authority(signal);
    try {
      if(tool==="tabs")return output({tabs:[...this.pages.values()].filter(p=>!p.closed).map(p=>this.describe(p))});
      if(tool==="open") {
        const url=browserURL(args.url);
        await mkdir(path.join(this.owner.workspace,"browser-downloads"),{recursive:true});
        const ses=await this.getSession();await this.authority(signal);
        const page=this.makePage(ses);
        try {
          // A newly constructed WebContentsView has no renderer target yet.
          // Initialize it before enabling CDP domains; otherwise Page.enable
          // waits for a target that the later navigation has not created.
          await page.view.webContents.loadURL("about:blank");
          await this.attach(page);await this.authority(signal);await this.navigate(page,url,signal);return output(this.describe(page));
        }
        catch(error){this.closePage(page);throw error;}
      }
      const page=this.get(args.tab_id);
      if(tool==="close"){this.closePage(page);return output({tab_id:page.id,closed:true});}
      if(tool==="navigate"){await this.navigate(page,browserURL(args.url),signal);return output(this.describe(page));}
      if(tool==="history") {
        const history=page.view.webContents.navigationHistory;
        await this.authority(signal);
        if(args.action==="reload")page.view.webContents.reload();
        else if(args.action==="back"&&history.canGoBack())history.goBack();
        else if(args.action==="forward"&&history.canGoForward())history.goForward();
        else throw new BrowserToolError("BROWSER_HISTORY_UNAVAILABLE");
        return output(this.describe(page));
      }
      if(tool==="snapshot") return output({...(!page.dialog?await this.evaluate(page,snapshotScript.replace("__DOCUMENT__",JSON.stringify(page.document))):{}),tab_id:page.id,dialog:page.dialog,origin:"customer_device_untrusted_web_content"});
      if(tool==="screenshot") {
        const image=await page.view.webContents.capturePage();
        const size=image.getSize(),scaled=size.width>1600?image.resize({width:1600}):image;
        const png=scaled.toPNG();if(png.length>2_700_000)throw new BrowserToolError("BROWSER_SCREENSHOT_LIMIT");
        return {success:true,contentItems:[{type:"inputText",text:JSON.stringify({...this.describe(page),width:scaled.getSize().width,height:scaled.getSize().height,mime:"image/png"})},{type:"inputImage",imageUrl:"data:image/png;base64,"+png.toString("base64")}]};
      }
      if(tool==="interact")return await this.interaction(page,args,signal);
      if(tool==="evaluate") {await this.authority(signal);return output({tab_id:page.id,result:await this.evaluate(page,args.expression),origin:"customer_device_untrusted_web_content"});}
      if(tool==="dialog") {
        if(!page.dialog)throw new BrowserToolError("BROWSER_DIALOG_UNAVAILABLE");
        await this.authority(signal);
        if(page.answerDialog)page.answerDialog(args.accept,args.prompt_text??page.dialog.defaultPrompt??"");
        else await this.cdp(page,"Page.handleJavaScriptDialog",{accept:args.accept,...(args.prompt_text!==undefined?{promptText:args.prompt_text}:{})});
        const end=Date.now()+3000;
        while(page.dialogCommands.size&&Date.now()<end)await this.delay(20,signal);
        if(page.dialogCommands.size)throw new BrowserToolError("BROWSER_ACTION_OUTCOME_UNKNOWN",false);
        return output({tab_id:page.id,handled:true});
      }
      if(tool==="downloads")return output({tab_id:page.id,downloads:this.downloads(page)});
      if(tool==="wait") {
        const end=Date.now()+(args.timeout_ms??10000);
        while(Date.now()<end) {
          this.alive(signal);this.get(page.id);
          if(args.state==="download") {const records=this.downloads(page);if(records.some(d=>d.state==="completed"&&d.sha256))return output({tab_id:page.id,downloads:records});}
          else if(!page.dialog) {
            const ready=await this.evaluate(page,args.state==="ready"?"document.readyState !== 'loading'":`(document.body?.innerText || '').includes(${JSON.stringify(args.text)})`);
            if(ready)return output({tab_id:page.id,matched:true,state:args.state});
          }
          await this.delay(60,signal);
        }
        throw new BrowserToolError("BROWSER_WAIT_TIMEOUT");
      }
      throw new BrowserToolError("BROWSER_INPUT_INVALID");
    } catch(error) {
      if(signal.aborted||this.closed)throw new BrowserToolError("BROWSER_INTERRUPTED",false);
      if(error instanceof BrowserToolError)throw error;
      throw new BrowserToolError("BROWSER_ACTION_OUTCOME_UNKNOWN",false);
    }
  }
  private downloads(page: Page) {return page.downloads.map(({item:_,...record})=>({...record,...(record.state!=="completed"?{path:undefined}: {})}));}
  private async navigate(page: Page,url: string,signal: AbortSignal) {
    await this.authority(signal);
    const loading=page.view.webContents.loadURL(url).catch(()=>{throw new BrowserToolError("BROWSER_NAVIGATION_FAILED");});
    // A document can open a JS dialog while loading. Do not block the protocol
    // event queue waiting for that dialog to be answered by the next tool call.
    const deadline=Date.now()+10000;let done=false,error:unknown;
    void loading.then(()=>{done=true;},value=>{error=value;done=true;});
    while(!done&&!page.dialog&&Date.now()<deadline)await this.delay(50,signal);
    if(error)throw error;
    this.update(page);
  }
  async chromeAction(sender: WebContents,action: unknown,value: unknown) {
    const page=[...this.pages.values()].find(p=>!p.closed&&p.window.webContents===sender);
    if(!page)throw new BrowserToolError("BROWSER_TAB_UNAVAILABLE");
    if(action==="close"){this.closePage(page);return {closed:true};}
    if(action==="minimize"){page.window.minimize();return {};}
    if(action==="maximize"){page.window.isMaximized()?page.window.unmaximize():page.window.maximize();return {};}
    await this.authority();
    if(action==="state"){this.update(page);return this.describe(page);}
    if(action==="dialog"){
      if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(key=>!["accept","prompt_text"].includes(key))
        ||typeof (value as any).accept!=="boolean"||((value as any).prompt_text!==undefined&&(typeof (value as any).prompt_text!=="string"||(value as any).prompt_text.length>4096)))throw new BrowserToolError("BROWSER_INPUT_INVALID");
      return this.execute("dialog",{tab_id:page.id,...value},this.shutdown.signal);
    }
    if(action==="navigate")return this.execute("navigate",{tab_id:page.id,url:browserURL(value)},this.shutdown.signal);
    if(["back","forward","reload"].includes(String(action)))return this.execute("history",{tab_id:page.id,action},this.shutdown.signal);
    throw new BrowserToolError("BROWSER_INPUT_INVALID");
  }
  private closePage(page: Page) {
    if(page.closed)return;page.closed=true;
    page.answerDialog?.(false,"");
    for(const record of page.downloads)if(record.item)record.item.cancel();
    if(!page.view.webContents.isDestroyed())page.view.webContents.close({waitForBeforeUnload:false});
    if(!page.window.isDestroyed())page.window.destroy();
    this.pages.delete(page.id);this.allPages.delete(page);
  }
  close(): Promise<void> {
    if(this.closing)return this.closing;
    this.closed=true;this.shutdown.abort();
    for(const page of [...this.pages.values()])this.closePage(page);
    if(this.browserSession&&this.downloadListener)this.browserSession.removeListener("will-download",this.downloadListener as any);
    this.dispose();
    return this.closing=(async()=>{await Promise.allSettled([...this.pending]);})();
  }
}
