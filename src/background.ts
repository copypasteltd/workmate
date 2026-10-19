import { settings } from "./config.js";
interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}
let refreshing: Promise<Tokens> | null = null;
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
async function store(t: any) {
  const tokens: Tokens = {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: Date.now() + t.expires_in * 1000,
  };
  await chrome.storage.session.set({ tokens });
  return tokens;
}
async function getTokens() {
  const { tokens } = (await chrome.storage.session.get("tokens")) as {
    tokens?: Tokens;
  };
  if (!tokens) throw new Error("AUTH_REQUIRED");
  if (tokens.expires_at > Date.now() + 30000) return tokens;
  if (!refreshing)
    refreshing = (async () => {
      const r = await fetch(settings.apiOrigin + "/v1/auth/native/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: "extension",
          refresh_token: tokens.refresh_token,
        }),
        redirect: "error",
      });
      if (!r.ok) {
        await chrome.storage.session.remove("tokens");
        throw new Error("AUTH_REQUIRED");
      }
      return store(await r.json());
    })().finally(() => {
      refreshing = null;
    });
  return refreshing;
}
async function login() {
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
  const response = await fetch(settings.apiOrigin + "/v1/auth/native/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: "extension",
      redirect_uri: redirect,
      code,
      code_verifier: verifier,
    }),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(
      "Unable to authorize this extension. Check its registered ID.",
    );
  await store(await response.json());
  return { ok: true };
}
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  idempotencyKey?: string,
) {
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
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(safePath(path), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? "Request failed");
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
  if (!r.ok) throw new Error(data.error?.message ?? "Upload failed");
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
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void chrome.storage.session.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
});
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
    if (message.type === "LOGOUT") {
      const { tokens } = await chrome.storage.session.get("tokens");
      if (tokens)
        await fetch(settings.apiOrigin + "/v1/auth/logout", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${(tokens as Tokens).access_token}`,
          },
        }).catch(() => {});
      await chrome.storage.session.remove("tokens");
      return { ok: true };
    }
    if (message.type === "API") {
      if (!["GET", "POST", "PATCH", "DELETE"].includes(message.method ?? "GET"))
        throw new Error("Invalid method");
      return request(
        message.path,
        message.method,
        message.body,
        message.idempotencyKey,
      );
    }
    if (message.type === "UPLOAD") return upload(message.path, message.file);
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
      await chrome.tabs.create({ url: settings.webOrigin + "/app" });
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
    .catch((e: Error) => respond({ ok: false, error: e.message }));
  return true;
});
