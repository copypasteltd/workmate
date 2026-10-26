export let csrfToken = "";
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
  let status: number, data: any;
  if (window.copyPasteBridge) {
    const result = await window.copyPasteBridge.request(path, {
      method: options.method,
      body:
        typeof options.body === "string" ? JSON.parse(options.body) : undefined,
    });
    status = result.status;
    data = result.body;
  } else {
    const headers = new Headers(options.headers);
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
  if (status < 200 || status >= 300)
    throw new ApiError(
      data?.error?.code ?? "REQUEST_FAILED",
      data?.error?.message ?? "Request failed",
      status,
      data?.error?.details,
    );
  if (data?.csrf_token) setCsrf(data.csrf_token);
  return data as T;
}
export const post = (path: string, body: unknown = {}) =>
  api(path, { method: "POST", body: JSON.stringify(body) });
export const patch = (path: string, body: unknown) =>
  api(path, { method: "PATCH", body: JSON.stringify(body) });
export async function download(path: string, filename: string) {
  if (window.copyPasteBridge)
    throw new Error("Use the Desktop file panel to save deliverables");
  const response = await fetch(base + path, { credentials: "include" });
  if (!response.ok) throw new Error("Download unavailable");
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
