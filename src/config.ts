import { deployment } from "./deployment.js";
export function configuration() {
  const api = new URL(process.env.COPYPASTE_API_ORIGIN ?? deployment.api),
    web = new URL(process.env.COPYPASTE_WEB_ORIGIN ?? deployment.web);
  for (const u of [api, web])
    if (
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/" ||
      (u.protocol !== "https:" &&
        !(
          ["localhost", "127.0.0.1"].includes(u.hostname) &&
          u.protocol === "http:"
        ))
    )
      throw new Error(
        "Use an HTTPS company origin, or localhost for development",
      );
  return { api: api.origin, web: web.origin };
}
export function apiURL(origin: string, value: string) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/v1/") ||
    value.length > 3000
  )
    throw new Error("Invalid API path");
  const u = new URL(value, origin);
  if (
    u.origin !== origin ||
    !u.pathname.startsWith("/v1/") ||
    u.username ||
    u.password
  )
    throw new Error("API origin is fixed");
  return u.href;
}

/** Only product operations may cross the renderer's authenticated API bridge. */
export function rendererApiOperation(value: unknown, method: unknown = "GET") {
  if (
    typeof value !== "string" ||
    typeof method !== "string" ||
    !["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method)
  )
    return false;
  let pathname: string;
  try {
    const url = new URL(apiURL("https://copypaste-bridge.invalid", value));
    if (url.hash || /\\|%2f|%5c/i.test(value)) return false;
    pathname = url.pathname;
  } catch {
    return false;
  }
  if (pathname === "/v1/session/context") return method === "GET";
  if (pathname === "/v1/tenants") return method === "GET" || method === "POST";
  if (pathname === "/v1/dataset-imports" || pathname === "/v1/reports")
    return method === "POST";
  if (/^\/v1\/evidence\/[a-f0-9-]{36}$/i.test(pathname))
    return method === "GET";
  if (/^\/v1\/members\/[a-f0-9-]{36}$/i.test(pathname))
    return method === "PATCH" || method === "DELETE";
  return /^\/v1\/(me(?:\/|$)|tenants\/|catalog\/|agent-templates(?:\/|$)|public\/|invites\/|auth\/logout$)/.test(
    pathname,
  );
}
