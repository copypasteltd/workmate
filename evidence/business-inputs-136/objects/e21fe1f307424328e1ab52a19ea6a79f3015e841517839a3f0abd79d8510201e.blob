// Keep only an opaque attempt key, intent digest and fixed deadline. Customer
// reasons, project identifiers, credentials and task bodies never enter storage.
export type SupportGrantAttempt = {
  version: 1;
  key: string;
  fingerprint: string;
  expires_at: string;
};
type Intent = { reason: string; project_ids: string[]; minutes: number };
const memory = new Map<string, SupportGrantAttempt>();
const digest = async (value: unknown) => [...new Uint8Array(await crypto.subtle.digest(
  "SHA-256", new TextEncoder().encode(JSON.stringify(value)),
))].map(b => b.toString(16).padStart(2, "0")).join("");
const slot = async (identity: string) => "cp_support_attempt_" + await digest(identity);
function valid(value: any): value is SupportGrantAttempt {
  return value?.version === 1 && /^[a-f0-9-]{36}$/.test(value.key) &&
    /^[a-f0-9]{64}$/.test(value.fingerprint) && typeof value.expires_at === "string" &&
    Number.isFinite(Date.parse(value.expires_at));
}
export async function pendingSupportGrant(identity: string) {
  const name = await slot(identity);
  try {
    const value = JSON.parse(sessionStorage.getItem(name) ?? "null");
    if (valid(value)) { memory.set(name, value); return value; }
  } catch { /* Disabled storage still permits recovery within this renderer. */ }
  return memory.get(name) ?? null;
}
export async function prepareSupportGrant(identity: string, intent: Intent) {
  const normalized = { reason: intent.reason.trim(), project_ids: [...new Set(intent.project_ids)].sort(), minutes: intent.minutes };
  const fingerprint = await digest(normalized), old = await pendingSupportGrant(identity);
  if (old && old.fingerprint !== fingerprint) throw new Error("SUPPORT_ATTEMPT_DIFFERENT");
  const attempt: SupportGrantAttempt = old ?? { version: 1, key: crypto.randomUUID(), fingerprint,
    expires_at: new Date(Date.now() + normalized.minutes * 60000).toISOString() };
  const name = await slot(identity); memory.set(name, attempt);
  try { sessionStorage.setItem(name, JSON.stringify(attempt)); } catch { /* Memory fallback. */ }
  return { attempt, body: { reason: normalized.reason, project_ids: normalized.project_ids, expires_at: attempt.expires_at } };
}
export async function finishSupportGrant(identity: string, key: string) {
  const name = await slot(identity), old = await pendingSupportGrant(identity);
  // A late completion must never erase a newer attempt for this account.
  if (old?.key !== key) return;
  memory.delete(name);
  try { sessionStorage.removeItem(name); } catch { /* Memory fallback. */ }
}
