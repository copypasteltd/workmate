import { readReviewBlob } from "./review-download";
import { clearAnalysisPending } from "./analysis-request-state";
import {clearMotionDrafts} from "./motion-draft-state";
import { redactWorkspaceAttempts } from "./workspace-creation";
import { saveScopeArchive } from "./scope-export-download";
import { clientFetch, clientJson, connectionFailure } from "./client-failure";
import { clearDeliveryRevisionDrafts } from "./delivery-revision-state";
import { clearDesignDrafts } from "./design-draft-state";
import { clearEditableProjectRequests } from "./editable-project-state";
import {clearWorkspaceSaves} from "./workspace-edit-state";
import { sessionProtectedRequest } from "./session-request";
export let csrfToken = "";
let sessionRevision = 0;
export const clientSessionGeneration = () => sessionRevision;
// Non-secret browser-history partition. Never a credential or server authority.
let navigationEpoch = "";
export function clientNavigationEpoch() {
 if(navigationEpoch)return navigationEpoch;
 try{const saved=sessionStorage.getItem("cp_navigation_epoch");if(saved&&/^[a-f\d-]{36}$/i.test(saved))navigationEpoch=saved;}catch{/* Memory-only fallback. */}
 if(!navigationEpoch)rotateNavigationEpoch();return navigationEpoch;
}
function rotateNavigationEpoch(){navigationEpoch=crypto.randomUUID();try{sessionStorage.setItem("cp_navigation_epoch",navigationEpoch);}catch{/* Memory-only fallback. */}}
export function endClientSession(broadcast = true) {
  rotateNavigationEpoch();
  ++sessionRevision;
  csrfToken = "";
  redactWorkspaceAttempts();
  if (broadcast) { clearDeliveryRevisionDrafts(); clearEditableProjectRequests(); clearDesignDrafts(); clearMotionDrafts(); clearAnalysisPending(); clearWorkspaceSaves(); }
  window.dispatchEvent(new Event("copypaste:session-ended"));
  if (broadcast)
    localStorage.setItem(
      "cp_auth_event",
      JSON.stringify({ kind: "signed_out", id: crypto.randomUUID() }),
    );
}
export function changeClientSession() {
  rotateNavigationEpoch();
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
      openCloudWorkspace: (section?: "geo" | "devices" | {kind:"work";tenant:string;project:string;conversation?:string;task?:string}) => Promise<void>;
      localAgent: (action: string, payload: unknown) => Promise<{ ok: boolean; value?: any; code?: string }>;
      localFilePath:(file:File)=>string;
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
        options?: { body: unknown },
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
  const protectedRequest = sessionProtectedRequest(path, options.method);
  const sessionIndependent = path === "/v1/public/config" && (!options.method || options.method === "GET");
  const headers = new Headers(options.headers);
  const pathTenant = /^\/v1\/tenants\/([a-f0-9-]{36})(?:\/|$)/i.exec(path)?.[1];
  if (pathTenant && !headers.has("X-Tenant-ID"))
    headers.set("X-Tenant-ID", pathTenant);
  const current = () => {
    if (revision !== sessionRevision && !sessionIndependent)
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
export const downloadPost = (path: string, filename: string, body: unknown, tenantId?: string) => download(path, filename, tenantId, body);
export async function download(
  path: string,
  filename: string,
  tenantId?: string,
  postBody?: unknown,
) {
  const revision = sessionRevision;
  const current = () => {
    if (revision !== sessionRevision) throw new ApiError("SESSION_CHANGED", "Sign-in state changed", 409);
  };
  if (window.copyPasteBridge) {
    let result: unknown;
    try { result = await window.copyPasteBridge.download(path, filename, tenantId, postBody === undefined ? undefined : { body: postBody }); }
    catch { current(); throw connectionFailure(); }
    current();
    return { saved: !(result && typeof result === "object" && "saved" in result && result.saved === false) };
  }
  let response: Response;
  try {
    response = await clientFetch(base + path, {
      credentials: "include",
      ...(postBody === undefined ? {} : { method: "POST", body: JSON.stringify(postBody) }),
      headers: { ...(tenantId ? { "X-Tenant-ID": tenantId } : {}), ...(postBody === undefined ? {} : { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }) },
    });
  } catch (error) { current(); throw error; }
  current();
  if (response.status === 401) {
    endClientSession(false);
    throw new ApiError("AUTH_REQUIRED", "Your session ended. Sign in again.", 401);
  }
  if (!response.ok && postBody !== undefined) { const problem = await clientJson(response, "POST"); current(); throw new ApiError(problem?.error?.code ?? "DOWNLOAD_UNAVAILABLE", problem?.error?.message ?? "Download unavailable", response.status); }
  if (!response.ok) throw new ApiError("DOWNLOAD_UNAVAILABLE", "Download unavailable", response.status);
  let blob: Blob;
  try { blob = postBody === undefined ? await response.blob() : await readReviewBlob(response, current); }
  catch { current(); throw connectionFailure(); }
  current();
  if (postBody !== undefined) { const expected = response.headers.get("x-content-sha256"); if (!expected || !/^[a-f0-9]{64}$/.test(expected) || blob.size > 8 * 1024 ** 2) throw new ApiError("DOWNLOAD_INTEGRITY", "Invalid review download", 422); const bytes = await blob.arrayBuffer(), actual = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join(""); current(); if (actual !== expected) throw new ApiError("DOWNLOAD_INTEGRITY", "Review download checksum mismatch", 422); }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return { saved: true };
}

export async function downloadScopeArchive(path: string, filename: string, tenantId?: string, signal?: AbortSignal) {
  const generation = clientSessionGeneration();
  return saveScopeArchive({ path, filename, signal,
    current: () => { if (generation !== clientSessionGeneration()) throw new ApiError("SESSION_CHANGED", "Sign-in state changed", 409); },
    native: window.copyPasteBridge ? () => window.copyPasteBridge!.download(path, filename, tenantId) : undefined,
    fetch: signal => clientFetch(base + path, { credentials: "include", signal, ...(tenantId ? { headers: { "X-Tenant-ID": tenantId } } : {}) }),
    unauthorized: () => endClientSession(false),
  });
}
