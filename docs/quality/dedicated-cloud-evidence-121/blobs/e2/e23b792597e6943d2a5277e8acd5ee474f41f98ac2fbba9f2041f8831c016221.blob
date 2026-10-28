/** Auth return paths remain within the application, including nested PKCE URLs. */
export function authReturnPath(
  value: string | null,
  fallback = "/app",
): string {
  if (
    !value?.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001f\u007f]/.test(value)
  )
    return fallback;
  try {
    const origin = "https://copypaste-return.invalid",
      url = new URL(value, origin),
      decoded = decodeURIComponent(url.pathname);
    if (
      url.origin !== origin ||
      decoded.startsWith("//") ||
      decoded.includes("\\") ||
      /[\u0000-\u001f\u007f]/.test(decoded) ||
      /^\/v1(?:\/|$)/.test(decoded)
    )
      return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
