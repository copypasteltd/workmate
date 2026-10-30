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

export function connectorLaunchURL(origin: string, state: unknown) {
  if (typeof state !== "string" || !/^[\w-]{43}$/.test(state))
    throw new Error("Invalid provider authorization state");
  const company = new URL(origin);
  if (
    company.origin !== origin ||
    company.username ||
    company.password ||
    (company.protocol !== "https:" &&
      !(
        company.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(company.hostname)
      ))
  )
    throw new Error("Company origin is fixed");
  const launch = new URL("/connect-provider", company);
  launch.searchParams.set("state", state);
  return launch.href;
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
    // Escaped separators are forbidden in the route. Query values can contain
    // legitimate encoded site URLs, such as a Search Console URL property.
    if (url.hash || /\\|%2f|%5c/i.test(value.split("?", 1)[0])) return false;
    pathname = url.pathname;
    if (pathname.includes("%")) return false;
  } catch {
    return false;
  }
  // Scoped native credentials and execution admission belong to the main
  // process. The generic renderer bridge must never expose these routes.
  if (/\/cloud-computers(?:\/|$)|^\/v1\/cloud-runtime-nodes(?:\/|$)/.test(pathname))
    return false;
  if (/\/desktop-executions(?:\/|$)|^\/v1\/desktop-inference(?:\/|$)/.test(pathname))
    return false;
  if (/\/geo\/experiments\/[a-f0-9-]{36}\/(?:desktop-runs|desktop-configuration)$/i.test(pathname)) return false;
  // Team definitions are ordinary content. Native execution, admission and
  // dispatch remain exclusively in the trusted local-agent IPC coordinator.
  if (pathname === "/v1/agent-groups") return method === "GET" || method === "POST";
  if (/^\/v1\/agent-groups\/[a-f0-9-]{36}$/i.test(pathname)) return method === "GET" || method === "PATCH";
  if (/^\/v1\/agent-groups\/[a-f0-9-]{36}\/versions$/i.test(pathname)) return method === "GET";
  if (/^\/v1\/agent-groups\/[a-f0-9-]{36}\/native\/runs(?:\/[a-f0-9-]{36}(?:\/(?:delivery|download))?)?$/i.test(pathname)) return method === "GET";
  if (/^\/v1\/agent-groups(?:\/|$)/.test(pathname)) return false;
  const publication = /^\/v1\/tenants\/[a-f0-9-]{36}\/projects\/[a-f0-9-]{36}\/publications(\/.*)?$/i.exec(pathname);
  if (publication) {
    const tail = publication[1] ?? "";
    if (["/settings", "/connections", "/policy", "/operations"].includes(tail)) return method === "GET" || tail === "/operations" && method === "POST";
    if (/^\/operations\/[a-f0-9-]{36}$/i.test(tail) || /^\/requests\/[\w:-]{16,128}$/.test(tail) ||
      /^\/(?:previews|operations)\/[a-f0-9-]{36}\/media\/[0-9]\/info$/i.test(tail)) return method === "GET";
    if (tail === "/previews" || /^\/operations\/[a-f0-9-]{36}\/(?:decision|cancel|observe|close-unknown)$/i.test(tail) ||
      /^\/connections\/[a-f0-9-]{36}\/disconnect$/i.test(tail)) return method === "POST";
    if (/^\/policy\/[a-f0-9-]{36}$/i.test(tail) || /^\/connections\/[a-f0-9-]{36}\/scope$/i.test(tail)) return method === "PUT";
    return false;
  }
  if (pathname === "/v1/session/context") return method === "GET";
  if (pathname === "/v1/brand-version-options") return method === "GET";
  if (["/v1/solution-access", "/v1/solution-targets", "/v1/solution-installations"].includes(pathname)) return method === "GET";
  if (pathname === "/v1/solution-versions") return method === "GET" || method === "POST";
  if (/^\/v1\/solution-versions\/[a-f0-9-]{36}(?:\/(?:details|trials))?$/i.test(pathname)) return method === "GET";
  if (/^\/v1\/solution-versions\/[a-f0-9-]{36}\/(?:previews|revisions|installations|publications|disable)$/i.test(pathname)) return method === "POST";
  if (/^\/v1\/(?:solution-installations|solution-trials)\/[a-f0-9-]{36}$/i.test(pathname)) return method === "GET";
  if (/^\/v1\/(?:solution-installations\/[a-f0-9-]{36}\/configurations|solution-trials\/[a-f0-9-]{36}\/reviews)$/i.test(pathname)) return method === "POST";
  if (
    [
      "/v1/plans",
      "/v1/effective-entitlements",
      "/v1/entitlement-notifications",
      "/v1/financial-notifications",
    ].includes(pathname)
  )
    return method === "GET";
  if (
    /^\/v1\/(?:entitlement|financial)-notifications\/[a-f0-9-]{36}$/i.test(
      pathname,
    )
  )
    return method === "PATCH";
  if (pathname === "/v1/support-grants")
    return method === "GET" || method === "POST";
  if (/^\/v1\/support-grants\/attempts\/[a-f0-9-]{36}$/i.test(pathname))
    return method === "GET";
  if (/^\/v1\/support-grants\/[a-f0-9-]{36}\/revoke$/i.test(pathname))
    return method === "POST";
  if (pathname === "/v1/tenants") return method === "GET" || method === "POST";
  if (pathname === "/v1/connector-providers") return method === "GET";
  if (pathname === "/v1/seo/audits")
    return method === "GET" || method === "POST";
  if (/^\/v1\/seo\/audits\/[a-f0-9-]{36}\/change-tasks$/i.test(pathname))
    return method === "GET" || method === "POST";
  if (
    /^\/v1\/seo\/audits\/[a-f0-9-]{36}\/change-tasks\/[a-f0-9-]{36}(?:\/download)?$/i.test(
      pathname,
    )
  )
    return method === "GET";
  if (
    /^\/v1\/seo\/audits\/[a-f0-9-]{36}(?:\/(?:findings|pages|download|documents\/[a-f0-9-]{36}))?$/i.test(
      pathname,
    )
  )
    return method === "GET";
  if (/^\/v1\/seo\/audits\/[a-f0-9-]{36}\/recheck$/i.test(pathname))
    return method === "POST";
  if (pathname === "/v1/connections")
    return method === "GET" || method === "POST";
  if (/^\/v1\/connections\/[a-f0-9-]{36}$/i.test(pathname))
    return ["PATCH", "DELETE"].includes(method);
  if (/^\/v1\/connections\/[a-f0-9-]{36}\/(?:detail|history)$/i.test(pathname))
    return method === "GET";
  if (/^\/v1\/connections\/[a-f0-9-]{36}\/(?:syncs|discovery)$/i.test(pathname))
    return method === "POST";
  if (/^\/v1\/syncs\/[a-f0-9-]{36}(?:\/detail)?$/i.test(pathname))
    return method === "GET";
  if (/^\/v1\/syncs\/[a-f0-9-]{36}\/(?:cancel|retry)$/i.test(pathname))
    return method === "POST";
  if (
    /^\/v1\/(?:snapshots|connector-snapshots)\/[a-f0-9-]{36}$/i.test(pathname)
  )
    return method === "GET";
  if (/^\/v1(?:\/tenants\/[a-f0-9-]{36}\/projects\/[a-f0-9-]{36})?\/connector-snapshots\/[a-f0-9-]{36}\/web-analysis$/i.test(pathname))
    return method === "GET";
  if (pathname === "/v1/dataset-imports" || pathname === "/v1/reports")
    return method === "POST";
  if (/^\/v1\/evidence\/[a-f0-9-]{36}$/i.test(pathname))
    return method === "GET";
  if (/^\/v1\/members\/[a-f0-9-]{36}$/i.test(pathname))
    return method === "PATCH" || method === "DELETE";
  if (pathname === "/v1/client-content") return method === "GET";
  return /^\/v1\/(me(?:\/|$)|tenants\/|catalog\/|agent-templates(?:\/|$)|public\/|invites\/|auth\/logout$)/.test(
    pathname,
  );
}
