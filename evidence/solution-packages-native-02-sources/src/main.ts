import { deployment } from "./deployment.js";
import { saveDownload } from "./download.js";
import { attachWindowControls, windowAppearance } from "./window-controls.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { exclusive } from "./lock.js";
import { LocalVault } from "./vault.js";
import { NativeSession, NativeSessionError, type NativeTokens } from "./native-session.js";
import { exchangeNativeCode } from "./native-code.js";
import { LocalAgentController, type LocalAgentJournal } from "./local-agent.js";
import { LocalScheduleController, type ScheduleJournal } from "./local-schedule.js";
import { LocalProgramController, type ProgramJournal } from "./local-programs.js";
import { localRuntimeLock } from "./local-runtime.js";
import { NativeBrowserPool } from "./native-browser.js";
import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  safeStorage,
  session,
  Menu,
} from "electron";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  randomBytes,
  randomUUID,
  createHash,
  generateKeyPairSync,
  verify,
  createPublicKey,
} from "node:crypto";
import {
  LocalFiles,
  atomicFile,
  type Journal,
  type FileCommand,
} from "./files.js";
import {
  configuration,
  apiURL,
  rendererApiOperation,
  connectorLaunchURL,
} from "./config.js";

const config = configuration();
let window: BrowserWindow | null = null;
let authFlow: Promise<void> | null = null;
const nativeArgument = process.argv.find((a) =>
  /^chrome-extension:\/\/[a-p]{32}\/?$/.test(a),
);
const nativeOrigin = nativeArgument
  ? nativeArgument.replace(/\/?$/, "/")
  : undefined;
const userDir =
  process.env.COPYPASTE_USER_DATA ??
  path.join(app.getPath("appData"), "CopyPaste");
app.setPath("userData", userDir);

const vault = new LocalVault(userDir);
const storePath = (key: string) => path.join(userDir, key + ".enc");
async function load<T>(key: string, fallback: T): Promise<T> {
  try {
    const bytes = await readFile(storePath(key));
    return JSON.parse(
      bytes.subarray(0, 8).toString() === "CPVAULT1"
        ? await vault.decrypt(bytes)
        : safeStorage.decryptString(bytes),
    );
  } catch (e: any) {
    if (e.code === "ENOENT") return fallback;
    throw new Error(
      "Unable to decrypt local state. Sign out and reset this installation.",
    );
  }
}
async function save(key: string, value: unknown) {
  await atomicFile(storePath(key), await vault.encrypt(JSON.stringify(value)));
}
const files = new LocalFiles(
  () => load<Journal>("folders", { grants: [], completed: {} }),
  (j) => save("folders", j),
  (fn) => exclusive(userDir, fn),
);
let localAccessReset: Promise<void> = Promise.resolve();
async function nativeAuth(
  action: "refresh" | "revoke",
  refreshToken: string,
  requestId?: string,
) {
  const response = await fetch(
    config.api +
      (action === "refresh" ? "/v1/auth/token" : "/v1/auth/native/revoke"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(requestId ? { "Idempotency-Key": requestId } : {}),
      },
      body: JSON.stringify({
        client_id: "desktop",
        refresh_token: refreshToken,
        ...(action === "refresh" ? { grant_type: "refresh_token" } : {}),
      }),
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok)
    throw new NativeSessionError(
      response.status === 401 ? "AUTH_REQUIRED" : "AUTH_UNAVAILABLE",
    );
  return response.json();
}
const nativeSession = new NativeSession({
  read: () => load("auth", null),
  write: (value) => save("auth", value),
  renew: (refreshToken, requestId) =>
    nativeAuth("refresh", refreshToken, requestId),
  revoke: async (refreshToken) => {
    await nativeAuth("revoke", refreshToken);
  },
  changed: () => {
    // Revoke all local grants before another account can use cached folder state.
    localAccessReset = Promise.all([files.revokeAll(), localSchedules.withdraw(), localPrograms.withdraw(), localAgent.invalidate()]).then(async () => {
      await save("devices", {});
      await save("command-keys", {});
    });
    void localAccessReset.catch(() => {});
    window?.webContents.send("auth:changed");
  },
});
const tokens = () => nativeSession.get();
const nativeBrowsers = new NativeBrowserPool(async () => {
  if(!window || window.isDestroyed())return "en";
  return window.webContents.executeJavaScript("localStorage.getItem('cp_locale') === 'zh' ? 'zh' : 'en'");
});
const localAgent = new LocalAgentController({
  read: () => load<LocalAgentJournal | null>("local-agent", null),
  write: value => save("local-agent", value),
  localEpoch: async () => (await load<NativeTokens | null>("auth", null))?.session_epoch ?? null,
  identity: async () => {
    const before = await tokens(), result = await request("/v1/session/context"), after = await tokens();
    if (result.status !== 200 || !after.session_epoch || before.session_epoch !== after.session_epoch || !result.body.user?.id) throw new Error("LOCAL_ACCOUNT_CHANGED");
    return { actorId: result.body.user.id, epoch: after.session_epoch };
  },
  request,
  chooseWorkspace: async () => {
    const chosen = await dialog.showOpenDialog(window!, { title: "CopyPaste · 本機工作目錄 / Local workspace", properties: ["openDirectory", "createDirectory"] });
    return chosen.canceled ? null : chosen.filePaths[0] ?? null;
  },
  consent: async (mode, workspace) => {
    const labels = { "read-only": "唯讀 / Read only", "workspace-write": "目錄內讀寫 / Workspace write", "full-access": "完整本機權限 / Full local access" };
    const result = await dialog.showMessageBox(window!, {
      type: mode === "full-access" ? "warning" : "question", title: "CopyPaste · 本機操作授權 / Local permission",
      message: labels[mode],
      detail: mode === "full-access"
        ? `允許本機 Codex 讀寫此電腦上的檔案、執行命令、操作本機瀏覽器及使用網路，超出工作目錄的操作也會生效。此權限不會提升 Windows 管理員權限。可隨時停止或撤銷；登出即失效。\nAllow local Codex to read/write files, run commands, operate a local browser and use the network, including outside this workspace, under your current OS account. Stop or revoke at any time; signing out revokes access.\n\n${workspace}`
        : `授權範圍：${workspace}\nPermission applies to this local session. You can change it while idle, stop execution, or revoke it at any time. Signing out revokes local access.`,
      buttons: ["取消 / Cancel", "授權 / Allow"], defaultId: 0, cancelId: 0, noLink: true,
    });
    return result.response === 1;
  },
  approval: async (kind, value) => {
    const result = await dialog.showMessageBox(window!, { type: "question", title: "CopyPaste · 操作審批 / Approve action",
      message: kind === "command" ? "執行本機命令？ / Run local command?" : "變更本機檔案？ / Change local files?",
      detail: JSON.stringify(value, null, 2).slice(0, 6000), buttons: ["拒絕 / Decline", "允許 / Allow"], defaultId: 0, cancelId: 0 });
    return result.response === 1 ? "accept" : "decline";
  },
  changed: () => { if (window && !window.isDestroyed()) window.webContents.send("local-agent:changed"); },
  stateRoot: userDir, companyOrigin: config.api,
  executable: app.isPackaged ? path.join(process.resourcesPath, "local-codex", "codex.exe") : process.env.COPYPASTE_LOCAL_CODEX_BIN ?? path.join(import.meta.dirname, "../.data/runtime/windows-x64/codex.exe"),
  runtime: localRuntimeLock,
  browser: (owner, authorize) => nativeBrowsers.create(owner, authorize),
  program: (owner, authorize) => localPrograms.session({ sessionId: owner.approvalSessionId, taskId: owner.taskId }, authorize),
});
const localPrograms = new LocalProgramController({
  read: () => load<ProgramJournal | null>("local-programs", null), write: journal => save("local-programs", journal),
  owner: id => localAgent.programOwner(id), context: id => localAgent.programOwner(id, true),
  host: app.isPackaged ? path.join(process.resourcesPath, "local-program-host/local-program-host.exe") : path.join(import.meta.dirname, "../.data/native-program-host/local-program-host.exe"),
  choose: async () => {
    const result = await dialog.showOpenDialog(window!, { title: "選擇本機程式 / Choose local program", properties: ["openFile"], filters: [{ name: "Windows 程式 / Programs", extensions: ["exe", "com"] }] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  },
  confirm: async program => {
    const result = await dialog.showMessageBox(window!, { type: "question", title: "CopyPaste · 批准本機程式 / Approve local program",
      message: program.name,
      detail: `允許目前會話的 Agent 使用參數陣列執行此程式。程式具有目前 Windows 帳戶的權限，並不只限於工作目錄。此批准綁定目前本機授權版本；可隨時撤銷。\nAllow this session's Agent to run this exact program with structured arguments, under your current Windows account. It can access beyond the workspace. Approval applies to the current local permission version and can be revoked.\n\n${program.path}\nSHA-256 ${program.sha256}\n\n工作目錄 / Workspace: ${program.workspace}`,
      buttons: ["取消 / Cancel", "批准程式 / Approve program"], defaultId: 0, cancelId: 0, noLink: true });
    return result.response === 1;
  },
  review: async receipt => {
    const result = await dialog.showMessageBox(window!, { type: "question", title: "CopyPaste · 核對原程式工作 / Review original program run",
      message: "已核對原工作和成果？ / Have you reviewed the original task and files?",
      detail: `${receipt.programName}\n原工作 / Original task: ${receipt.taskId}\n${JSON.stringify(receipt.argv)}\n\n此操作只記錄你的核對聲明，允許之後的新執行。原項仍保持結果未知，不會重新執行、補造結束狀態或更改費用。\nThis records your review and allows future new invocations. The original outcome remains unknown; it is not rerun, marked completed or financially adjusted.`,
      buttons: ["取消 / Cancel", "我已核對 / I have reviewed"], defaultId: 0, cancelId: 0, noLink: true });
    return result.response === 1;
  },
  changed: () => { if (window && !window.isDestroyed()) window.webContents.send("local-agent:changed"); },
});
const localSchedules = new LocalScheduleController({
  read: () => load<ScheduleJournal | null>("local-schedules", null), write: journal => save("local-schedules", journal),
  owner: id => localAgent.schedulingOwner(id), context: id => localAgent.schedulingContext(id),
  chooseInput: async workspace => {
    const result = await dialog.showOpenDialog(window!, { title: "選擇要監察的輸入目錄 / Choose input folder to watch",
      defaultPath: workspace, properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  },
  confirm: async rule => {
    const allocated = rule.jobs.filter(job => job.allocated).length, money = (value: number) => (value / 1_000_000).toFixed(2);
    const result = await dialog.showMessageBox(window!, { type: "question", title: "CopyPaste · 啟用目錄工作 / Activate folder work",
      message: "允許此規則自動開始本機工作？ / Allow this rule to start local work automatically?",
      detail: `${rule.name}\n${rule.input.path}\n${rule.role}\n\n${rule.instruction}\n\n`
        + `每檔上限 / Per file: HK$${money(rule.budgetMicros)}\n總授權上限 / Total authorized limit: HK$${money(rule.totalBudgetMicros)}\n`
        + `最多 / Maximum: ${rule.maxRuns}，已分配 / Allocated: ${allocated}\n\n`
        + "此電腦開啟應用程式期間，穩定的新增或變更檔案將自動處理並計費。原檔留本機；模型及媒體經公司服務。角色與專案指引沿用此會話已固定的版本；新會話於首次工作時固定，恢復沿用原任務。暫停在檔案邊界生效；撤銷會停止本規則的執行。重開應用程式後需再次確認。\n\n"
        + "While this app is running, stable new or changed files start paid local work automatically. Originals stay local; models and media use company services. Role and project guidance retain this session's pinned versions, fixed on its first task; recovery keeps its original task. Pause finishes the current file. Revoke stops this rule's active work. Reopening the app requires confirmation again.",
      buttons: ["取消 / Cancel", "啟用規則 / Activate rule"], defaultId: 0, cancelId: 0 });
    return result.response === 1;
  },
  dispatch: (id, jobId, prompt, budget, beforeNative) => localAgent.dispatch(id, jobId, prompt, budget, beforeNative), stop: id => localAgent.stop(id),
  changed: () => { if (window && !window.isDestroyed()) window.webContents.send("local-agent:changed"); },
});
async function request(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    idempotencyKey?: string;
    tenantId?: string;
    signal?: AbortSignal;
  } = {},
) {
  const method = options.method ?? "GET";
  if (
    options.tenantId !== undefined &&
    (typeof options.tenantId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        options.tenantId,
      ))
  )
    throw new Error("Invalid tenant identity");
  if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method))
    throw new Error("Invalid method");
  if (
    options.idempotencyKey &&
    !/^[\w:-]{16,128}$/.test(options.idempotencyKey)
  )
    throw new Error("Invalid idempotency key");
  let t;
  const publicRead =
    method === "GET" &&
    ["/v1/public/config", "/v1/public/content"].includes(url.split("?")[0]);
  if (!publicRead) {
    try {
      t = await tokens();
    } catch (e: any) {
      if (e.message === "AUTH_CHANGED")
        return {
          status: 409,
          body: {
            error: {
              code: "SESSION_CHANGED",
              message: "Sign-in state changed. Reload this view.",
            },
          },
        };
      if (e.message === "AUTH_REQUIRED")
        return {
          status: 401,
          body: { error: { code: "AUTH_REQUIRED", message: "Please sign in" } },
        };
      throw e;
    }
  }
  const r = await fetch(apiURL(config.api, url), {
    method,
    headers: {
      ...(t ? { Authorization: `Bearer ${t.access_token}` } : {}),
      "Content-Type": "application/json",
      "Idempotency-Key": options.idempotencyKey ?? randomUUID(),
      ...(options.tenantId ? { "X-Tenant-ID": options.tenantId } : {}),
    },
    body:
      options.body === undefined
        ? method === "GET"
          ? undefined
          : "{}"
        : JSON.stringify(options.body),
    redirect: "error",
    signal: AbortSignal.any([AbortSignal.timeout(/^\/v1\/tenants\/[\w-]+\/projects\/[\w-]+\/desktop-executions\/[\w-]+\/tools$/.test(url)
      ? options.body && typeof options.body === "object" && "tool" in options.body && ["generated_video_create", "audio_produce"].includes(String(options.body.tool)) ? 855000 : 180000
      : 40000), ...(options.signal ? [options.signal] : [])]),
  });
  const body = await r.json();
  if (
    r.status === 401 &&
    t &&
    !(await nativeSession.invalidate(t.access_token))
  )
    return {
      status: 409,
      body: {
        error: {
          code: "SESSION_CHANGED",
          message: "Sign-in state changed. Reload this view.",
        },
      },
    };
  return { status: r.status, body };
}
async function signIn() {
  if (authFlow) return authFlow;
  authFlow = (async () => {
    const ticket = nativeSession.beginLogin();
    const verifier = randomBytes(32).toString("base64url"),
      state = randomBytes(32).toString("base64url");
    let finish!: (value: string) => void, fail!: (e: Error) => void;
    const result = new Promise<string>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      if (u.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      if (
        req.method !== "GET" ||
        u.searchParams.get("state") !== state ||
        !u.searchParams.get("code")
      ) {
        res.writeHead(400).end("Invalid authorization");
        return;
      }
      res
        .writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'",
        })
        .end(
          "<title>CopyPaste</title><p>登入完成，可以關閉此頁。 Signed in. You can close this tab.</p>",
        );
      finish(u.searchParams.get("code")!);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const port = (server.address() as any).port,
      redirect = `http://127.0.0.1:${port}/callback`;
    const timer = setTimeout(
      () => fail(new Error("Sign-in timed out")),
      180000,
    );
    try {
      const u = new URL("/authorize", config.web);
      u.search = new URLSearchParams({
        client_id: "desktop",
        redirect_uri: redirect,
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
        state,
      }).toString();
      await shell.openExternal(u.href);
      const code = await result;
      const response = await exchangeNativeCode(config.api + "/v1/auth/token", {
        client_id: "desktop",
        grant_type: "authorization_code",
        redirect_uri: redirect,
        code,
        code_verifier: verifier,
      });
      await nativeSession.acceptLogin(response, ticket);
      window?.show();
      window?.focus();
    } finally {
      clearTimeout(timer);
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  })().finally(() => (authFlow = null));
  return authFlow;
}
async function choose() {
  const picked = await dialog.showOpenDialog({
    title: "選擇授權資料夾 · Choose a folder",
    properties: ["openDirectory"],
  });
  if (picked.canceled) return null;
  const answer = await dialog.showMessageBox({
    type: "question",
    title: "CopyPaste · Folder permission",
    message: "授權此資料夾一小時 / Allow this folder for one hour",
    detail:
      "Read only allows listing and reading selected-folder files. Create output also permits NEW files. Existing files cannot be overwritten. Revoke access at any time.",
    buttons: ["唯讀 / Read only", "建立新檔 / Create output", "取消 / Cancel"],
    defaultId: 0,
    cancelId: 2,
  });
  if (answer.response === 2) return null;
  return files.grant(picked.filePaths[0], answer.response === 1);
}
let deviceTimer: ReturnType<typeof setInterval> | null = null;
let polling = false;
async function deviceSync(tenant: string) {
  await localAccessReset;
  const me = await request("/v1/session/context");
  if (
    me.status !== 200 ||
    !me.body.memberships.some((m: any) => m.id === tenant)
  )
    throw new Error("Workspace access required");
  let identity = await load<any>("identity", null);
  if (!identity) {
    const pair = generateKeyPairSync("ed25519");
    identity = {
      private_key: pair.privateKey.export({ format: "pem", type: "pkcs8" }),
      public_key: pair.publicKey.export({ format: "pem", type: "spki" }),
    };
    await save("identity", identity);
  }
  const grants = await files.grants();
  let devices = await load<any>("devices", {});
  const old = devices[tenant];
  if (old)
    await request(`/v1/tenants/${tenant}/devices/${old}`, { method: "DELETE" });
  const d = await request(`/v1/tenants/${tenant}/devices`, {
    method: "POST",
    body: {
      name: app.getName() + " · " + process.platform,
      client: "desktop",
      public_key: identity.public_key,
      grants,
    },
  });
  if (d.status !== 200)
    throw new Error(d.body.error?.message ?? "Device pairing failed");
  devices[tenant] = d.body.id;
  await save("devices", devices);
  const pub = await request("/v1/public/config");
  if (pub.status !== 200 || !pub.body.device_command_public_key)
    throw new Error("Command signing key unavailable");
  const keys = await load<any>("command-keys", {});
  keys[tenant] = pub.body.device_command_public_key;
  await save("command-keys", keys);
  return d.body;
}
async function pollDevices() {
  if (polling) return;
  polling = true;
  try {
    const devices = await load<any>("devices", {}),
      keys = await load<any>("command-keys", {});
    for (const [tenant, id] of Object.entries(devices)) {
      const response = await request(
        `/v1/tenants/${tenant}/devices/${id}/commands`,
      );
      if (response.status !== 200) continue;
      for (const c of response.body.items) {
        let state = "succeeded",
          result: any;
        try {
          if (
            !c.signature ||
            !keys[tenant] ||
            keys[tenant] !== response.body.public_key
          )
            throw new Error("Unsigned command rejected");
          const canonical = (v: any): string =>
            v === null || typeof v !== "object"
              ? JSON.stringify(v)
              : Array.isArray(v)
                ? "[" + v.map(canonical).join(",") + "]"
                : "{" +
                  Object.keys(v)
                    .sort()
                    .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
                    .join(",") +
                  "}";
          const envelope = {
            id: c.id,
            device_id: c.device_id,
            tenant_id: c.tenant_id,
            operation: c.operation,
            payload: c.payload,
            nonce: c.nonce,
            expires_at: c.expires_at,
          };
          if (
            !verify(
              null,
              Buffer.from(canonical(envelope)),
              createPublicKey(keys[tenant]),
              Buffer.from(c.signature, "base64"),
            )
          )
            throw new Error("Command signature invalid");
          result = await files.execute({
            ...c.payload,
            request_id: c.nonce,
            expires_at: c.expires_at,
          });
        } catch (e: any) {
          state = "failed";
          result = { error: e.message };
        }
        await request(
          `/v1/tenants/${tenant}/devices/${id}/commands/${c.id}/result`,
          { method: "POST", body: { nonce: c.nonce, state, result } },
        );
      }
    }
  } catch {
    /* Offline devices retain no pending local writes. */
  } finally {
    polling = false;
  }
}

async function createWindow() {
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({
    ...windowAppearance,
    width: 1440,
    height: 980,
    minWidth: 800,
    minHeight: 600,
    title: "CopyPaste",
    backgroundColor: "#F6F6F4",
    icon: path.join(import.meta.dirname, "../assets/icon-256.png"),
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });
  window.removeMenu();
  window.setMenuBarVisibility(false);
  attachWindowControls(window);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(config.web + "/") || url === "https://copypaste.hk/")
      void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (e, url) => {
    const expected = new URL("../renderer-dist/index.html", import.meta.url);
    if (url.split("#")[0] !== expected.href) e.preventDefault();
  });
  session.defaultSession.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  ipcMain.handle("api", (_e, p, o) => {
    if (!rendererApiOperation(p, o?.method ?? "GET"))
      throw new Error("API operation is not exposed");
    return request(p, o);
  });
  ipcMain.handle("local-agent", async (event, action, payload) => {
    const expected = new URL("../renderer-dist/index.html", import.meta.url).href;
    if (event.sender !== window?.webContents || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url.split("#")[0] !== expected)
      throw new Error("LOCAL_IPC_DENIED");
    try {
      await localAccessReset;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("LOCAL_REQUEST_INVALID");
      const keys: Record<string, string[]> = { list: ["tenant", "project"], create: ["tenant", "project", "role"], permission: ["id", "mode"], send: ["id", "prompt", "budget"], answer: ["id", "requestId", "answers"], retry: ["id"], stop: ["id"], revoke: ["id"],
        "schedule.list": ["id"], "schedule.create": ["id", "settings"], "schedule.activate": ["id", "ruleId"], "schedule.pause": ["id", "ruleId"], "schedule.revoke": ["id", "ruleId"], "schedule.open-output": ["id", "ruleId", "jobId"],
        "program.list": ["id"], "program.approve": ["id"], "program.revoke": ["id", "programId"], "program.review": ["id", "receiptId"] };
      const allowed = keys[action];
      if (!allowed || Object.keys(payload).length !== allowed.length || allowed.some(k => !(k in payload))) throw new Error("LOCAL_REQUEST_INVALID");
      let value;
      switch (action) {
        case "list": value = await localAgent.list(payload); break;
        case "create": value = await localAgent.create(payload, payload.role); break;
        case "permission": await localSchedules.withdraw(payload.id); await localPrograms.withdraw(payload.id); value = await localAgent.permission(payload.id, payload.mode); break;
        case "send": value = await localAgent.send(payload.id, payload.prompt, payload.budget); break;
        case "answer": value = await localAgent.answer(payload.id, payload.requestId, payload.answers); break;
        case "retry": value = await localAgent.retry(payload.id); break;
        case "stop": await localSchedules.withdraw(payload.id); value = await localAgent.stop(payload.id); break;
        case "revoke": await localSchedules.withdraw(payload.id); await localPrograms.withdraw(payload.id); value = await localAgent.revoke(payload.id); break;
        case "program.list": value = await localPrograms.list(payload.id); break;
        case "program.approve": value = await localPrograms.approve(payload.id); break;
        case "program.revoke": await localPrograms.revoke(payload.id, payload.programId); value = true; break;
        case "program.review": await localPrograms.review(payload.id, payload.receiptId); value = true; break;
        case "schedule.list": value = await localSchedules.list(payload.id); break;
        case "schedule.create": value = await localSchedules.create(payload.id, payload.settings); break;
        case "schedule.activate": value = await localSchedules.activate(payload.id, payload.ruleId); break;
        case "schedule.pause": value = await localSchedules.pause(payload.id, payload.ruleId); break;
        case "schedule.revoke": value = await localSchedules.revoke(payload.id, payload.ruleId); break;
        case "schedule.open-output": {
          const result = await shell.openPath(await localSchedules.outputFolder(payload.id, payload.ruleId, payload.jobId));
          if (result) throw new Error("LOCAL_SCHEDULE_OPEN_FAILED"); value = true; break;
        }
      }
      return { ok: true, value };
    } catch (error: any) {
      const code = typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{1,90}$/.test(error.code) ? error.code : "LOCAL_OPERATION_FAILED";
      return { ok: false, code };
    }
  });
  ipcMain.handle("auth:signin", () => signIn());
  ipcMain.handle("workspace:cloud", (_e, section?: string) => shell.openExternal(config.web + (section === "geo" ? "/app/analytics?view=geo" : "/app")));
  ipcMain.handle("auth:signout", async () => {
    const result = await nativeSession.signOut();
    await localAccessReset;
    return result;
  });
  ipcMain.handle("files:choose", async () => {
    await tokens();
    await localAccessReset;
    return choose();
  });
  ipcMain.handle("files:grants", () => files.grants());
  ipcMain.handle("files:revoke", (_e, id) => files.revoke(id));
  ipcMain.handle("files:execute", async (_e, c) => {
    await tokens();
    await localAccessReset;
    return files.execute(c);
  });
  ipcMain.handle("device:sync", (_e, t) => deviceSync(t));
  ipcMain.handle("chrome:register", async () => {
    if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_FILE)
      throw new Error(
        "Use the Setup-installed CopyPaste application to connect Chrome.",
      );
    const consent = await dialog.showMessageBox({
      type: "question",
      buttons: ["Connect Chrome", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      title: "CopyPaste · Chrome",
      message:
        "Allow the official CopyPaste Chrome extension to request your explicitly selected folders?",
      detail:
        "Each folder still requires a separate local grant. This registers the native helper for your Windows account.",
    });
    if (consent.response !== 0) return { registered: false };
    const origins = [`chrome-extension://${deployment.extensionId}/`];
    await mkdir(userDir, { recursive: true });
    await save("extensions", origins);
    const manifest = path.join(userDir, "hk.copypaste.agent.json");
    await writeFile(
      manifest,
      JSON.stringify(
        {
          name: "hk.copypaste.agent",
          description: "CopyPaste explicitly authorized local files",
          path: path.join(process.resourcesPath, "native-host.cmd"),
          type: "stdio",
          allowed_origins: origins,
        },
        null,
        2,
      ),
    );
    await promisify(execFile)(
      "reg.exe",
      [
        "ADD",
        "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\hk.copypaste.agent",
        "/ve",
        "/t",
        "REG_SZ",
        "/d",
        manifest,
        "/f",
      ],
      { windowsHide: true },
    );
    return { registered: true };
  });
  ipcMain.handle("external", (_e, url) => {
    const u = new URL(url);
    if (![config.web, "https://copypaste.hk"].includes(u.origin))
      throw new Error("External origin is not allowed");
    return shell.openExternal(u.href);
  });
  ipcMain.handle("connector:authorize", (e, state) => {
    if (
      !window ||
      e.sender !== window.webContents ||
      e.senderFrame !== window.webContents.mainFrame
    )
      throw new Error(
        "Provider authorization is restricted to the application frame",
      );
    return shell.openExternal(connectorLaunchURL(config.web, state));
  });
  ipcMain.handle("asset:download", async (e, p, name, tenantId?: string) => {
    if (
      !window ||
      e.sender !== window.webContents ||
      e.senderFrame !== window.webContents.mainFrame ||
      !rendererApiOperation(p, "GET")
    )
      throw new Error(
        "Downloads are restricted to authorized product operations in the application frame",
      );
    if (
      tenantId !== undefined &&
      (typeof tenantId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          tenantId,
        ))
    )
      throw new Error("Invalid tenant identity");
    // Validate the server path before any native selection, then stream to the
    // selected destination without retaining a large media file in JS memory.
    const url = apiURL(config.api, p);
    const dest = await dialog.showSaveDialog({
      defaultPath: path.basename(String(name)),
    });
    if (dest.canceled || !dest.filePath) return { saved: false };
    const t = await tokens();
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${t.access_token}`,
        ...(tenantId ? { "X-Tenant-ID": tenantId } : {}),
      },
      redirect: "error",
    });
    if (r.status === 401) await nativeSession.invalidate(t.access_token);
    return saveDownload(r, dest.filePath);
  });
  ipcMain.handle("asset:upload", async (_e, p, body) => {
    if (typeof body?.base64 !== "string" || body.base64.length > 34_000_000)
      throw new Error("Invalid file");
    const t = await tokens(),
      form = new FormData();
    if (body.expected_version)
      form.append("expected_version", String(body.expected_version));
    form.append(
      "file",
      new Blob([Buffer.from(body.base64, "base64")], { type: body.mime }),
      path.basename(body.name),
    );
    const r = await fetch(apiURL(config.api, p), {
      method: "POST",
      headers: { Authorization: `Bearer ${t.access_token}` },
      body: form,
      redirect: "error",
    });
    const data = await r.json();
    if (r.status === 401 && !(await nativeSession.invalidate(t.access_token)))
      return {
        status: 409,
        body: {
          error: {
            code: "SESSION_CHANGED",
            message: "Sign-in state changed. Reload this view.",
          },
        },
      };
    return { status: r.status, body: data };
  });
  await window.loadFile(
    path.join(import.meta.dirname, "../renderer-dist/index.html"),
  );
  deviceTimer = setInterval(() => void pollDevices(), 4000);
}
void app
  .whenReady()
  .then(async () => {
    if (nativeOrigin) {
      try {
        throw new Error(
          "Use the registered native-host launcher for Chrome messages",
        );
      } catch (e: any) {
        process.stderr.write("Native host unavailable: " + e.message + "\n");
        app.exit(1);
      }
    } else {
      if (!app.requestSingleInstanceLock()) {
        app.quit();
      } else {
        app.on("second-instance", () => {
          window?.show();
          window?.focus();
        });
        await createWindow();
      }
    }
  })
  .catch(() => app.exit(1));
app.on("window-all-closed", () => {
  if (deviceTimer) clearInterval(deviceTimer);
  if (!nativeOrigin) app.quit();
});
let shuttingDown = false;
app.on("before-quit", event => {
  if (deviceTimer) clearInterval(deviceTimer);
  if (shuttingDown) return;
  event.preventDefault(); shuttingDown = true;
  void Promise.all([localSchedules.close(), localPrograms.close(), localAgent.close(), nativeBrowsers.close()]).then(() => localSchedules.drain()).then(() => app.exit(0), () => app.exit(1));
});
