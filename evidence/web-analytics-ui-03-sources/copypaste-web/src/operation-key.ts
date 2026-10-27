const fallback = new Map<string, string>();
/** Persist only a digest, never invite tokens or email addresses. The same
 * logical attempt can recover a committed operation after a lost response.
 */
async function keyName(account: string, action: string, payload: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([account, action, payload])),
  );
  return (
    "cp_attempt_" +
    [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}
export async function completeOperation(
  account: string,
  action: string,
  payload: unknown,
) {
  const name = await keyName(account, action, payload);
  fallback.delete(name);
  try {
    sessionStorage.removeItem(name);
  } catch {
    /* Storage can be disabled. */
  }
}
export async function operationKey(
  account: string,
  action: string,
  payload: unknown,
) {
  const name = await keyName(account, action, payload);
  try {
    const saved = JSON.parse(sessionStorage.getItem(name) ?? "null");
    if (saved && typeof saved.key === "string" && saved.until > Date.now())
      return saved.key as string;
    const key = crypto.randomUUID();
    sessionStorage.setItem(
      name,
      JSON.stringify({ key, until: Date.now() + 24 * 60 * 60 * 1000 }),
    );
    return key;
  } catch {
    if (!fallback.has(name)) fallback.set(name, crypto.randomUUID());
    return fallback.get(name)!;
  }
}
