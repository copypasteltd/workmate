import { deployment } from "./deployment.js";
import { saveDownload } from "./download.js";
import { attachWindowControls, windowAppearance } from "./window-controls.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { exclusive } from "./lock.js";
import { LocalVault } from "./vault.js";
import { NativeSession, NativeSessionError } from "./native-session.js";
import { exchangeNativeCode } from "./native-code.js";
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
import { configuration, apiURL } from "./config.js";

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
    localAccessReset = files.revokeAll().then(async () => {
      await save("devices", {});
      await save("command-keys", {});
    });
    void localAccessReset.catch(() => {});
    window?.webContents.send("auth:changed");
  },
});
const tokens = () => nativeSession.get();
async function request(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    idempotencyKey?: string;
    tenantId?: string;
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
    signal: AbortSignal.timeout(40000),
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
    const campaignImport = p === "/v1/dataset-imports" && o?.method === "POST";
    if (
      !campaignImport &&
      !/^\/v1\/(me(?:[/?]|$)|tenants\/|catalog\/|agent-templates(?:[/?]|$)|public\/|invites\/|auth\/logout$)/.test(
        p,
      )
    )
      throw new Error("API operation is not exposed");
    return request(p, o);
  });
  ipcMain.handle("auth:signin", () => signIn());
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
  ipcMain.handle("asset:download", async (_e, p, name) => {
    // Validate the server path before any native selection, then stream to the
    // selected destination without retaining a large media file in JS memory.
    const url = apiURL(config.api, p);
    const dest = await dialog.showSaveDialog({
      defaultPath: path.basename(String(name)),
    });
    if (dest.canceled || !dest.filePath) return { saved: false };
    const t = await tokens();
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${t.access_token}` },
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
app.on("before-quit", () => {
  if (deviceTimer) clearInterval(deviceTimer);
});
