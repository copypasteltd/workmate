import { settings } from "./config.js";
import {
  NativeSession,
  NativeSessionError,
  type NativeTokens,
} from "./native-session.js";
import { exchangeNativeCode } from "./native-code.js";
import { PrivateChatUploads } from "./chat-upload.js";
const privateUploads = new PrivateChatUploads({
  request: (scope, path, method, body, key) => request(path, method, body, key, scope.tenant),
  read: async key => (await chrome.storage.session.get(key))[key],
  write: async (key, value) => { await chrome.storage.session.set({ [key]: value }); },
});
let loginFlow: Promise<{ ok: boolean }> | null = null;
const safePath = (path: unknown) => {
  if (
    typeof path !== "string" ||
    !path.startsWith("/v1/") ||
    path.length > 2500
  )
    throw new Error("Invalid API path");
  const u = new URL(path, settings.apiOrigin);
  if (u.origin !== settings.apiOrigin || !u.pathname.startsWith("/v1/"))
    throw new Error("Invalid API origin");
  return u.href;
};
const bytes = (b: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const random = () => bytes(crypto.getRandomValues(new Uint8Array(32)).buffer);
async function nativeAuth(
  action: "refresh" | "revoke",
  refreshToken: string,
  requestId?: string,
) {
  const response = await fetch(
    settings.apiOrigin +
      (action === "refresh" ? "/v1/auth/token" : "/v1/auth/native/revoke"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(requestId ? { "Idempotency-Key": requestId } : {}),
      },
      body: JSON.stringify({
        client_id: "extension",
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
  read: async () =>
    ((await chrome.storage.session.get("tokens")) as { tokens?: NativeTokens })
      .tokens ?? null,
  write: async (tokens) => {
    if (tokens) await chrome.storage.session.set({ tokens });
    else await chrome.storage.session.remove("tokens");
  },
  renew: (refreshToken, requestId) =>
    nativeAuth("refresh", refreshToken, requestId),
  revoke: async (refreshToken) => {
    await nativeAuth("revoke", refreshToken);
  },
  changed: () => {}, // storage.onChanged notifies every open trusted panel.
});
const getTokens = () => nativeSession.get();
class HTTPFailure extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}
const login = () =>
  (loginFlow ??= performLogin().finally(() => {
    loginFlow = null;
  }));
async function performLogin() {
  const ticket = nativeSession.beginLogin();
  const verifier = random(),
    state = random(),
    challenge = bytes(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    );
  const redirect = chrome.identity.getRedirectURL("callback");
  const u = new URL("/authorize", settings.webOrigin);
  u.search = new URLSearchParams({
    client_id: "extension",
    redirect_uri: redirect,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  }).toString();
  const returned = await chrome.identity.launchWebAuthFlow({
    url: u.href,
    interactive: true,
  });
  if (!returned) throw new Error("Sign-in cancelled");
  const callback = new URL(returned);
  if (
    callback.origin + callback.pathname !== redirect ||
    callback.searchParams.get("state") !== state
  )
    throw new Error("Authorization state mismatch");
  const code = callback.searchParams.get("code");
  if (!code) throw new Error("No authorization code");
  const response = await exchangeNativeCode(
    settings.apiOrigin + "/v1/auth/token",
    {
      client_id: "extension",
      grant_type: "authorization_code",
      redirect_uri: redirect,
      code,
      code_verifier: verifier,
    },
  );
  await nativeSession.acceptLogin(response, ticket);
  return { ok: true };
}
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  idempotencyKey?: string,
  tenantId?: string,
) {
  if (tenantId !== undefined && !/^[a-f0-9-]{36}$/i.test(tenantId))
    throw new Error("Invalid workspace identity");
  if (
    idempotencyKey !== undefined &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      idempotencyKey,
    )
  )
    throw new Error("Invalid request identity");
  const t = await getTokens();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${t.access_token}`,
    "Idempotency-Key": idempotencyKey ?? crypto.randomUUID(),
  };
  if (tenantId) headers["X-Tenant-ID"] = tenantId;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(safePath(path), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
  });
  const data = await response.json();
  if (response.status === 401) {
    if (!(await nativeSession.invalidate(t.access_token)))
      throw new NativeSessionError("AUTH_CHANGED");
    throw new NativeSessionError("AUTH_REQUIRED");
  }
  if (!response.ok) throw new HTTPFailure(data.error?.message ?? "Request failed", response.status, data.error?.code);
  return data;
}
async function upload(
  path: string,
  file: { name: string; type: string; base64: string },
) {
  if (file.base64.length > 7_000_000)
    throw new Error("Choose a file smaller than 5 MB");
  const t = await getTokens(),
    raw = atob(file.base64),
    bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: file.type }), file.name);
  const r = await fetch(safePath(path), {
    method: "POST",
    headers: { Authorization: `Bearer ${t.access_token}` },
    body: form,
    redirect: "error",
  });
  const data = await r.json();
  if (r.status === 401) {
    if (!(await nativeSession.invalidate(t.access_token)))
      throw new NativeSessionError("AUTH_CHANGED");
    throw new NativeSessionError("AUTH_REQUIRED");
  }
  if (!r.ok) throw new HTTPFailure(data.error?.message ?? "Upload failed", r.status, data.error?.code);
  return data;
}
async function capturePage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url ?? ""))
    throw new Error("Open a regular web page to capture");
  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const copy = document.body.cloneNode(true) as HTMLElement;
      copy
        .querySelectorAll(
          'script,style,noscript,form,input,textarea,select,[contenteditable],iframe,[hidden],[aria-hidden="true"]',
        )
        .forEach((n) => n.remove());
      return {
        title: document.title,
        url: location.href,
        text: (copy.textContent ?? "").replace(/\s+/g, " ").slice(0, 50000),
      };
    },
  });
  return result[0]?.result;
}
async function host(message: unknown) {
  if (
    !(await chrome.permissions.contains({ permissions: ["nativeMessaging"] }))
  )
    throw new Error("Allow Native Messaging from the folder button first");
  return chrome.runtime.sendNativeMessage(
    settings.nativeHost,
    message as object,
  );
}
// Reapply on every service-worker start as well as install/browser startup.
// The action opens Chrome's global native panel; it never opens a popup or tab.
async function configureBrowserSurface() {
  await Promise.all([
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }),
    chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  ]);
}
const restoreBrowserSurface = () => {
  void configureBrowserSurface().catch(() => {
    console.error("CopyPaste browser surface initialization failed");
  });
};
restoreBrowserSurface();
chrome.runtime.onInstalled.addListener(restoreBrowserSurface);
chrome.runtime.onStartup.addListener(restoreBrowserSurface);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    !sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`)
  )
    return false;
  (async () => {
    if (!message || typeof message.type !== "string")
      throw new Error("Invalid message");
    if (message.type === "LOGIN") return login();
    if (message.type === "LOGOUT") return nativeSession.signOut();
    if (message.type === "API") {
      if (!["GET", "POST", "PATCH", "DELETE"].includes(message.method ?? "GET"))
        throw new Error("Invalid method");
      return request(
        message.path,
        message.method,
        message.body,
        message.idempotencyKey,
        message.tenantId,
      );
    }
    if (message.type === "UPLOAD") return upload(message.path, message.file);
    if (message.type === "CHAT_UPLOAD") return privateUploads.upload(message.scope, message.conversationId, message.file);
    if (message.type === "CAPTURE") return capturePage();
    if (message.type === "HOST") {
      if (
        ![
          "grant.choose",
          "grant.list",
          "grant.revoke",
          "file.list",
          "file.read",
          "file.write",
        ].includes(message.payload?.operation)
      )
        throw new Error("Native operation not allowed");
      return host({
        ...message.payload,
        request_id: message.payload.request_id ?? crypto.randomUUID(),
      });
    }
    if (message.type === "OPEN_WEB") {
      const destination =
        message.section === "computers"
          ? "/app/computers"
          : message.section === "specialists"
          ? "/app/specialists"
          : message.section === "connections"
            ? "/app/connections"
            : message.section === "seo"
              ? "/app/analytics?view=seo"
              : message.section === "creative-feedback"
                ? "/app/analytics?view=creative-feedback"
              : message.section === "geo"
                ? "/app/analytics?view=geo"
              : ["creative", "video"].includes(message.section)
                ? "/app/creative"
                : "/app";
      await chrome.tabs.create({ url: settings.webOrigin + destination });
      return { ok: true };
    }
    if (message.type === "STATUS")
      return {
        authenticated: !!(await chrome.storage.session.get("tokens")).tokens,
        extension_id: chrome.runtime.id,
      };
    throw new Error("Unknown extension operation");
  })()
    .then((data) => respond({ ok: true, data }))
    .catch((e: Error) =>
      respond({
        ok: false,
        error: e.message,
        ...(e instanceof NativeSessionError ? { code: e.code } : {}),
        ...(e instanceof HTTPFailure ? { status: e.status, code: e.code } : {}),
      }),
    );
  return true;
});
