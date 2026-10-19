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
        options: { method?: string; body?: unknown; idempotencyKey?: string },
      ) => Promise<{ status: number; body: any }>;
      enableChrome: () => Promise<{ registered: boolean }>;
      signIn: () => Promise<void>;
      signOut: () => Promise<void>;
      chooseDirectory: () => Promise<unknown>;
      localGrants: () => Promise<any[]>;
      revokeGrant: (id: string) => Promise<void>;
      localFile: (command: unknown) => Promise<any>;
      syncDevice: (tenant: string) => Promise<any>;
      upload: (
        path: string,
        body: unknown,
      ) => Promise<{ status: number; body: any }>;
      download: (path: string, name: string) => Promise<unknown>;
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
        idempotencyKey:
          new Headers(options.headers).get("Idempotency-Key") ?? undefined,
        body:
          typeof options.body === "string"
            ? JSON.parse(options.body)
            : undefined,
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
  if (window.copyPasteBridge) {
    await window.copyPasteBridge.download(path, filename);
    return;
  }
  const response = await fetch(base + path, { credentials: "include" });
  if (!response.ok) throw new Error("Download unavailable");
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
