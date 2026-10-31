import { saveScopeArchive } from "./scope-export-download";
import { clientFetch, clientJson, connectionFailure } from "./client-failure";
export let csrfToken = "";
let sessionRevision = 0;
export const clientSessionGeneration = () => sessionRevision;
function endAdminSession() {
  ++sessionRevision;
  csrfToken = "";
  window.dispatchEvent(new Event("copypaste:admin-session-ended"));
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
      request: (
        path: string,
        options: { method?: string; body?: unknown },
      ) => Promise<{ status: number; body: any }>;
      signIn: () => Promise<void>;
      signOut: () => Promise<void>;
      chooseDirectory: () => Promise<unknown>;
      localGrants: () => Promise<any[]>;
      revokeGrant: (id: string) => Promise<void>;
      openExternal: (url: string) => Promise<void>;
      onAuthChanged: (fn: () => void) => () => void;
      version: string;
    };
  }
}
const base = import.meta.env.VITE_API_BASE ?? "";
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const revision = sessionRevision;
  const protectedRequest = path.startsWith("/v1/admin/") && (!path.startsWith("/v1/admin/auth/") || path === "/v1/admin/auth/logout");
  const current = () => {
    if (revision !== sessionRevision) throw new ApiError("SESSION_CHANGED", "Sign-in state changed", 409);
    if (options.signal?.aborted) throw options.signal.reason;
  };
  let status: number, data: any;
  try {
    if (window.copyPasteBridge) {
      const body = typeof options.body === "string" ? JSON.parse(options.body) : undefined;
      let result;
      try { result = await window.copyPasteBridge.request(path, { method: options.method, body }); }
      catch { throw connectionFailure(options.method); }
      status = result.status; data = result.body;
    } else {
      const headers = new Headers(options.headers);
      if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
      if (!["GET", "HEAD", "OPTIONS"].includes(options.method ?? "GET")) {
        if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
        headers.set("Idempotency-Key", headers.get("Idempotency-Key") ?? crypto.randomUUID());
      }
      const r = await clientFetch(base + path, { ...options, headers, credentials: "include" });
      status = r.status;
      data = status === 401 && protectedRequest
        ? { error: { code: "AUTH_REQUIRED", message: "Your session ended. Sign in again." } }
        : await clientJson(r, options.method, options.signal ?? undefined);
    }
  } catch (error) { current(); throw error; }
  current();
  if (status === 401 && protectedRequest) endAdminSession();
  if (status < 200 || status >= 300)
    throw new ApiError(data?.error?.code ?? "REQUEST_FAILED", data?.error?.message ?? "Request failed", status, data?.error?.details);
  if (path === "/v1/admin/auth/verify") { ++sessionRevision; csrfToken = ""; }
  if (data?.csrf_token) setCsrf(data.csrf_token);
  if (path === "/v1/admin/auth/logout") endAdminSession();
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
export async function download(path: string, filename: string) {
  if (window.copyPasteBridge)
    throw new Error("Use the Desktop file panel to save deliverables");
  const revision = sessionRevision;
  const current = () => { if (revision !== sessionRevision) throw new ApiError("SESSION_CHANGED", "Sign-in state changed", 409); };
  let response: Response;
  try { response = await clientFetch(base + path, { credentials: "include" }); }
  catch (error) { current(); throw error; }
  current();
  if (response.status === 401) { endAdminSession(); throw new ApiError("AUTH_REQUIRED", "Your session ended. Sign in again.", 401); }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(
      data?.error?.code ?? "DOWNLOAD_UNAVAILABLE",
      data?.error?.message ?? "Download unavailable",
      response.status,
    );
  }
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
}

export async function downloadScopeArchive(path: string, filename: string, tenantId?: string, signal?: AbortSignal) {
  const generation = clientSessionGeneration();
  return saveScopeArchive({ path, filename, signal,
    current: () => { if (generation !== clientSessionGeneration()) throw new ApiError("SESSION_CHANGED", "Sign-in state changed", 409); },
    native: window.copyPasteBridge ? () => Promise.reject(new Error("Use the administrator web app to export data")) : undefined,
    fetch: signal => clientFetch(base + path, { credentials: "include", signal, ...(tenantId ? { headers: { "X-Tenant-ID": tenantId } } : {}) }),
    unauthorized: () => endAdminSession(),
  });
}
