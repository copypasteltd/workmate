/** A company-only transport. Credentials must never follow an HTTP redirect. */
export function createCompanyTransport(origin: string, send: typeof fetch): typeof fetch {
  const company = new URL(origin);
  if (company.origin !== origin || company.username || company.password || !["http:", "https:"].includes(company.protocol))
    throw new Error("COMPANY_ORIGIN_INVALID");
  return async (input, init = {}) => {
    const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input));
    if (url.origin !== origin || url.username || url.password || url.hash)
      throw new Error("COMPANY_REQUEST_DENIED");
    const headers = new Headers(init.headers ?? request?.headers);
    if (headers.has("Cookie")) throw new Error("COMPANY_COOKIE_DENIED");
    return send(input, { ...init, headers, credentials: "omit", redirect: "error" });
  };
}
