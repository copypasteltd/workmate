/** Only public content and explicit sign-in exchanges may return 401 without
 * ending the active browser session. Business routes are protected by default. */
export function sessionProtectedRequest(path: string, method = "GET"): boolean {
  const pathname = path.split(/[?#]/, 1)[0];
  const verb = method.toUpperCase();
  if (!pathname.startsWith("/v1/")) return false;
  if (["GET", "HEAD"].includes(verb) &&
      ["/v1/public/config", "/v1/public/content", "/v1/catalog/roles",
        "/v1/catalog/default-assistant"].includes(pathname)) return false;
  if (verb === "GET" && /^\/v1\/connections\/launch\/[\w-]{43}$/.test(pathname)) return false;
  if (verb === "POST" && [
    "/v1/auth/challenges", "/v1/auth/challenge", "/v1/auth/sessions",
    "/v1/auth/verify", "/v1/auth/sso/start", "/v1/auth/sso/link/challenge",
    "/v1/auth/sso/link",
  ].includes(pathname)) return false;
  return !(verb === "GET" && pathname === "/v1/auth/sso/pending");
}
