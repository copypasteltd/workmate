export let csrfToken = "";
let sessionRevision = 0;
export function endClientSession(broadcast = true) {
  ++sessionRevision;
  csrfToken = "";
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
      desktopUpdates: (action: "status" | "check" | "download" | "cancel" | "discard" | "install") => Promise<any>;
      onDesktopUpdatesChanged: (fn: () => void) => () => void;
      openCloudWorkspace: (section?: "geo") => Promise<void>;
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
    /^\/v1\/client-content(?:[?]|$)/.test(path) ||
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
  let status: number, data: any;
  if (window.copyPasteBridge) {
    let result;
    if (options.body instanceof FormData) {
      const file = options.body.get("file");
      if (!(file instanceof File)) throw new Error("Choose a file");
      const a = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < a.length; i++) binary += String.fromCharCode(a[i]);
      result = await window.copyPasteBridge.upload(path, {
        name: file.name,
        mime: file.type,
        base64: btoa(binary),
        expected_version: options.body.get("expected_version"),
      });
    } else
      result = await window.copyPasteBridge.request(path, {
        method: options.method,
        idempotencyKey: headers.get("Idempotency-Key") ?? undefined,
        tenantId: headers.get("X-Tenant-ID") ?? undefined,
        body:
          typeof options.body === "string"
            ? JSON.parse(options.body)
            : undefined,
      });
    status = result.status;
    data = result.body;
  } else {
    if (options.body && !(options.body instanceof FormData))
      headers.set("Content-Type", "application/json");
    if (!["GET", "HEAD", "OPTIONS"].includes(options.method ?? "GET")) {
      if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
      headers.set(
        "Idempotency-Key",
        headers.get("Idempotency-Key") ?? crypto.randomUUID(),
      );
    }
    const r = await fetch(base + path, {
      ...options,
      headers,
      credentials: "include",
    });
    status = r.status;
    try {
      data = await r.json();
    } catch {
      throw new ApiError(
        "RESPONSE_INVALID",
        "服務回應異常，請重新整理 / Unexpected server response",
        status,
      );
    }
  }
  if (protectedRequest && revision !== sessionRevision)
    throw new ApiError(
      "SESSION_CHANGED",
      "登入狀態已變更，請重新載入 / Sign-in state changed. Reload this view.",
      409,
    );
  if (status === 401 && protectedRequest) endClientSession(false);
  if (status < 200 || status >= 300)
    throw new ApiError(
      data?.error?.code ?? "REQUEST_FAILED",
      data?.error?.message ?? "Request failed",
      status,
      data?.error?.details,
    );
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
  if (window.copyPasteBridge) {
    await window.copyPasteBridge.download(path, filename, tenantId);
    if (revision !== sessionRevision) throw new Error("Sign-in state changed");
    return;
  }
  const response = await fetch(base + path, {
    credentials: "include",
    ...(tenantId ? { headers: { "X-Tenant-ID": tenantId } } : {}),
  });
  if (revision !== sessionRevision) throw new Error("Sign-in state changed");
  if (response.status === 401) endClientSession();
  if (!response.ok) throw new Error("Download unavailable");
  const blob = await response.blob();
  if (revision !== sessionRevision) throw new Error("Sign-in state changed");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
