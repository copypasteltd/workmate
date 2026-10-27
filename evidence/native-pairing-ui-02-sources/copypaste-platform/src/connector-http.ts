import type { Config } from "./config.js";
import { hash, Problem } from "./lib.js";

const allowedHosts = new Set([
  "oauth2.googleapis.com",
  "googleads.googleapis.com",
  "analyticsadmin.googleapis.com",
  "analyticsdata.googleapis.com",
  "www.googleapis.com",
  "graph.facebook.com",
]);
export class ConnectorFailure extends Problem {
  constructor(
    public kind: "retry" | "reauth" | "permanent",
    code: string,
    public retryAfterMs = 0,
  ) {
    super(
      kind === "reauth" ? 401 : 502,
      code,
      kind === "reauth"
        ? "Reconnect the provider account"
        : "The provider request could not be completed",
    );
  }
}
const waitTime = (s: string | null) => {
  if (!s) return 0;
  const n = /^\d+$/.test(s) ? Number(s) * 1000 : Date.parse(s) - Date.now();
  return Number.isFinite(n) ? Math.min(3600000, Math.max(0, n)) : 0;
};
/** Fixed official endpoints only. Supplier paging URLs are never passed here. */
export async function connectorJSON(
  config: Config,
  official: URL | string,
  request: RequestInit = {},
  signal?: AbortSignal,
): Promise<{ body: any; sha256: string; bytes: number }> {
  const endpoint = new URL(official);
  if (
    endpoint.protocol !== "https:" ||
    !allowedHosts.has(endpoint.hostname) ||
    endpoint.port ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash
  )
    throw new Problem(
      500,
      "CONNECTOR_ENDPOINT_DENIED",
      "Unregistered connector endpoint",
    );
  const headers = new Headers(request.headers);
  if (config.CONNECTOR_FIXTURE_ORIGIN) {
    if (!config.DEMO_MODE || config.NODE_ENV === "production")
      throw new Problem(
        500,
        "CONNECTOR_FIXTURE_DENIED",
        "Fixture transport is unavailable",
      );
    const fixture = new URL(config.CONNECTOR_FIXTURE_ORIGIN);
    if (
      fixture.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(fixture.hostname) ||
      fixture.origin !== config.CONNECTOR_FIXTURE_ORIGIN ||
      !config.CONNECTOR_FIXTURE_KEY
    )
      throw new Problem(
        500,
        "CONNECTOR_FIXTURE_DENIED",
        "Fixture transport is unavailable",
      );
    fixture.pathname = `/provider/${endpoint.hostname}${endpoint.pathname}`;
    fixture.search = endpoint.search;
    headers.set("x-copypaste-fixture-key", config.CONNECTOR_FIXTURE_KEY);
    endpoint.href = fixture.href;
  }
  let response: Response;
  const timeout = AbortSignal.timeout(30000);
  try {
    response = await fetch(endpoint, {
      ...request,
      headers,
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    if (signal?.aborted)
      throw new Problem(
        409,
        "CONNECTOR_CANCELLED",
        "The synchronization was stopped",
      );
    throw new ConnectorFailure("retry", "CONNECTOR_TRANSPORT");
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = response.body?.getReader();
  try {
    if (reader)
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 8_000_000) {
          await reader.cancel();
          throw new ConnectorFailure("permanent", "CONNECTOR_RESPONSE_LIMIT");
        }
        chunks.push(value);
      }
  } catch (e) {
    if (e instanceof Problem) throw e;
    throw new ConnectorFailure("retry", "CONNECTOR_TRANSPORT");
  } finally {
    reader?.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  let body: any;
  try {
    body = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new ConnectorFailure(
      response.ok ? "permanent" : "retry",
      "CONNECTOR_RESPONSE_INVALID",
    );
  }
  if (!response.ok || body?.error) {
    const code = Number(body?.error?.code);
    if (
      response.status === 401 ||
      body?.error === "invalid_grant" ||
      [102, 190].includes(code)
    )
      throw new ConnectorFailure("reauth", "CONNECTOR_AUTH_EXPIRED");
    if (
      response.status === 429 ||
      response.status >= 500 ||
      [4, 17, 32, 613].includes(code) ||
      body?.error?.is_transient === true
    )
      throw new ConnectorFailure(
        "retry",
        "CONNECTOR_RATE_OR_TRANSIENT",
        waitTime(response.headers.get("retry-after")),
      );
    throw new ConnectorFailure(
      "permanent",
      response.status === 403
        ? "CONNECTOR_PERMISSION_DENIED"
        : "CONNECTOR_PROVIDER_REJECTED",
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new ConnectorFailure("permanent", "CONNECTOR_RESPONSE_INVALID");
  return { body, sha256: hash(bytes), bytes: length };
}

/** Do not persist credential-bearing Graph paging links or opaque page tokens in raw assets. */
export function sanitizeConnectorRaw(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeConnectorRaw);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([k]) =>
          !/^(?:access_token|refresh_token|client_secret|code|next|previous|nextPageToken|cursors)$/i.test(
            k,
          ),
      )
      .map(([k, v]) => [k, sanitizeConnectorRaw(v)]),
  );
}
