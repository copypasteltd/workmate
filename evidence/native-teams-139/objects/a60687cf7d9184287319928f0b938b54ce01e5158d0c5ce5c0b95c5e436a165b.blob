/** Stable transport failures contain no server body, URL, credential or runtime text. */
export const clientFailureCopy = {
  CLIENT_CONNECTION_UNAVAILABLE: {
    en: "Couldn't connect. Check your connection and try again.",
    "zh-HK": "暫時無法連線，請檢查網絡後再試。",
  },
  CLIENT_RESULT_UNCONFIRMED: {
    en: "Your request may have been received. Check its result before retrying.",
    "zh-HK": "申請可能已收到。請先查收結果，再決定是否重試。",
  },
  CLIENT_RESPONSE_INVALID: {
    en: "The service returned an unreadable response. Try loading this view again.",
    "zh-HK": "服務回應暫時無法讀取，請重新載入此頁。",
  },
  AUTH_REQUIRED: {
    en: "Your session ended. Sign in again.",
    "zh-HK": "登入已失效，請重新登入。",
  },
  AUTH_UNAVAILABLE: {
    en: "Sign-in could not be refreshed. Check your connection and try again.",
    "zh-HK": "暫時無法更新登入狀態，請檢查網絡後再試。",
  },
  SESSION_CHANGED: {
    en: "Your sign-in changed. Reload this view.",
    "zh-HK": "登入狀態已變更，請重新載入此頁。",
  },
} as const;
export type ClientFailureCode = keyof typeof clientFailureCopy;
export function clientFailureMessage(error: unknown, locale: string): string | null {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (typeof code !== "string" || !Object.hasOwn(clientFailureCopy, code)) return null;
  return clientFailureCopy[code as ClientFailureCode][locale === "en" ? "en" : "zh-HK"];
}
export class ClientFailure extends Error {
  readonly status = 0;
  constructor(readonly code: ClientFailureCode) {
    super(clientFailureCopy[code]["zh-HK"] + " / " + clientFailureCopy[code].en);
    this.name = "ClientFailure";
  }
}
export const readOnlyRequest = (method = "GET") => ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
export function connectionFailure(method?: string) {
  return new ClientFailure(readOnlyRequest(method) ? "CLIENT_CONNECTION_UNAVAILABLE" : "CLIENT_RESULT_UNCONFIRMED");
}
export function invalidResponse(method?: string) {
  return new ClientFailure(readOnlyRequest(method) ? "CLIENT_RESPONSE_INVALID" : "CLIENT_RESULT_UNCONFIRMED");
}
/** One attempt only. A failed write does not prove that the server did not commit it. */
export async function clientFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  try { return await fetch(input, init); }
  catch (error) {
    if (init.signal?.aborted) throw init.signal.reason ?? error;
    throw connectionFailure(init.method);
  }
}
export async function clientJson(response: Response, method?: string, signal?: AbortSignal): Promise<any> {
  try { return await response.json(); }
  catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    throw invalidResponse(method);
  }
}
