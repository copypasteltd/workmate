import { clientFetch, clientJson, connectionFailure } from "./client-failure";
import { clearDeliveryRevisionDrafts } from "./delivery-revision-state";
export let csrfToken = "";
let sessionRevision = 0;
export function endClientSession(broadcast = true) {
  ++sessionRevision;
  csrfToken = "";
  if (broadcast) clearDeliveryRevisionDrafts();
  window.dispatchEvent(new Event("copypaste:session-ended"));
  if (broadcast)
    localStorage.setItem(
      "cp_auth_event",
      JSON.stringify({ kind: "signed_out", id: crypto.randomUUID() }),
    );
}
export function changeClientSession() {
  ++sessionRevision;
  csrfToken = "";
}
export const setCsrf = (v: string) => {
  csrfToken = v;
};
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}
declare global {
  interface Window {
    copyPasteBridge?: {
      desktopRemoval: (action: "status" | "prepare" | "retry" | "uninstall-settings", payload?: { clearCache: boolean }) => Promise<any>;
      onDesktopRemovalChanged: (fn: () => void) => () => void;
      desktopUpdates: (action: "status" | "check" | "download" | "cancel" | "discard" | "install") => Promise<any>;
      onDesktopUpdatesChanged: (fn: () => void) => () => void;
      openCloudWorkspace: (section?: "geo" | "devices") => Promise<void>;
      localAgent: (action: string, payload: unknown) => Promise<{ ok: boolean; value?: any; code?: string }>;
      onLocalAgentChanged: (fn: () => void) => () => void;
      request: (
        path: string,
        options: {
          method?: string;
          body?: unknown;
          idempotencyKey?: string;
          tenantId?: string;
        },
      ) => Promise<{ status: number; body: any }>;
      enableChrome: () => Promise<{ registered: boolean }>;
      signIn: () => Promise<void>;
      signOut: () => Promise<{ remote_revoked: boolean }>;
      chooseDirectory: () => Promise<unknown>;
      localGrants: () => Promise<any[]>;
      revokeGrant: (id: string) => Promise<void>;
      localFile: (command: unknown) => Promise<any>;
      syncDevice: (tenant: string) => Promise<any>;
      upload: (
        path: string,
        body: unknown,
      ) => Promise<{ status: number; body: any }>;
      download: (
        path: string,
        name: string,
        tenantId?: string,
      ) => Promise<unknown>;
      openExternal: (url: string) => Promise<void>;
      authorizeConnector: (state: string) => Promise<void>;
      publicationMedia?: (path: string, tenantId: string) => Promise<{ id: string; url: string }>;
      closePublicationMedia?: (id: string) => Promise<void>;
      onAuthChanged: (fn: () => void) => () => void;
      version: string;
    };
  }
}
const base = import.meta.env.VITE_API_BASE ?? "";
export function nativeAuthorizationUrl(query: URLSearchParams) {
  const values = new URLSearchParams();
  for (const key of ["client_id", "redirect_uri", "code_challenge", "state"])
    values.set(key, query.get(key) ?? "");
  values.set(
    "code_challenge_method",
    query.get("code_challenge_method") ?? "S256",
  );
  return base + "/v1/auth/authorize?" + values;
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const revision = sessionRevision;
  const protectedRequest =
    /^\/v1\/(?:client-content|agent-groups)(?:[/?]|$)/.test(path) ||
    (/^\/v1\/(?:connector-providers|connections|syncs|connector-snapshots|snapshots|seo)(?:[/?]|$)/.test(
      path,
    ) &&
      !path.startsWith("/v1/connections/launch/")) ||
    /^\/v1\/(me(?:[/?]|$)|plans(?:[/?]|$)|effective-entitlements(?:[/?]|$)|entitlement-notifications(?:[/?]|$)|financial-notifications(?:[/?]|$)|support-grants(?:[/?]|$)|session\/context(?:[/?]|$)|members\/|tenants(?:[/?]|$)|invites\/|agent-templates(?:[/?]|$)|solution-(?:versions|installations|trials|targets|access)(?:[/?]|$)|auth\/(?:session|logout|native\/authorize)$)/.test(
      path,
    );
  const headers = new Headers(options.headers);
  const pathTenant = /^\/v1\/tenants\/([a-f0-9-]{36})(?:\/|$)/i.exec(path)?.[1];
  if (pathTenant && !headers.has("X-Tenant-ID"))
    headers.set("X-Tenant-ID", pathTenant);
  const current = () => {
    if (protectedRequest && revision !== sessionRevision)
      throw new ApiError("SESSION_CHANGED", "Sign-in state changed", 409);
    if (options.signal?.aborted) throw options.signal.reason;
  };
  let status: number, data: any;
  try {
    if (window.copyPasteBridge) {
      let invoke: () => Promise<{ status: number; body: any }>;
      if (options.body instanceof FormData) {
        const file = options.body.get("file");
        if (!(file instanceof File)) throw new Error("Choose a file");
        const a = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let i = 0; i < a.length; i++) binary += String.fromCharCode(a[i]);
        const body = { name: file.name, mime: file.type, base64: btoa(binary), expected_version: options.body.get("expected_version") };
        invoke = () => window.copyPasteBridge!.upload(path, body);
      } else {
        const body = typeof options.body === "string" ? JSON.parse(options.body) : undefined;
        invoke = () => window.copyPasteBridge!.request(path, {
          method: options.method,
          idempotencyKey: headers.get("Idempotency-Key") ?? undefined,
          tenantId: headers.get("X-Tenant-ID") ?? undefined,
          body,
        });
      }
      let result;
      try { result = await invoke(); }
      catch { throw connectionFailure(options.method); }
      status = result.status;
      data = result.body;
    } else {
      if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
      if (!["GET", "HEAD", "OPTIONS"].includes(options.method ?? "GET")) {
        if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
        headers.set("Idempotency-Key", headers.get("Idempotency-Key") ?? crypto.randomUUID());
      }
      const r = await clientFetch(base + path, { ...options, headers, credentials: "include" });
      status = r.status;
      // Authentication is determined by the HTTP status, including a proxy's HTML/empty response.
      data = status === 401 && protectedRequest
        ? { error: { code: "AUTH_REQUIRED", message: "Your session ended. Sign in again." } }
        : await clientJson(r, options.method, options.signal ?? undefined);
    }
  } catch (error) { current(); throw error; }
  current();
  if (status === 401 && protectedRequest) endClientSession(false);
  if (status < 200 || status >= 300)
    throw new ApiError(data?.error?.code ?? "REQUEST_FAILED", data?.error?.message ?? "Request failed", status, data?.error?.details);
  if (path === "/v1/auth/verify" || path === "/v1/auth/sessions") {
    changeClientSession();
    localStorage.setItem(
      "cp_auth_event",
      JSON.stringify({ kind: "signed_in", id: crypto.randomUUID() }),
    );
  }
  if (data?.csrf_token) setCsrf(data.csrf_token);
  if (
    path === "/v1/auth/logout" ||
    (path === "/v1/auth/session" && options.method === "DELETE")
  )
    endClientSession();
  return data as T;
}
export const post = (path: string, body: unknown = {}, requestKey?: string) =>
  api(path, {
    method: "POST",
    body: JSON.stringify(body),
    ...(requestKey ? { headers: { "Idempotency-Key": requestKey } } : {}),
  });
export const patch = (path: string, body: unknown) =>
  api(path, { method: "PATCH", body: JSON.stringify(body) });
export async function download(
  path: string,
  filename: string,
  tenantId?: string,
) {
  const revision = sessionRevision;
  const current = () => {
    if (revision !== sessionRevision) throw new ApiError("SESSION_CHANGED", "Sign-in state changed", 409);
  };
  if (window.copyPasteBridge) {
    let result: unknown;
    try { result = await window.copyPasteBridge.download(path, filename, tenantId); }
    catch { current(); throw connectionFailure(); }
    current();
    return { saved: !(result && typeof result === "object" && "saved" in result && result.saved === false) };
  }
  let response: Response;
  try {
    response = await clientFetch(base + path, {
      credentials: "include",
      ...(tenantId ? { headers: { "X-Tenant-ID": tenantId } } : {}),
    });
  } catch (error) { current(); throw error; }
  current();
  if (response.status === 401) {
    endClientSession(false);
    throw new ApiError("AUTH_REQUIRED", "Your session ended. Sign in again.", 401);
  }
  if (!response.ok) throw new ApiError("DOWNLOAD_UNAVAILABLE", "Download unavailable", response.status);
  let blob: Blob;
  try { blob = await response.blob(); }
  catch { current(); throw connectionFailure(); }
  current();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return { saved: true };
}
