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
