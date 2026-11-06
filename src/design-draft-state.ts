export const designDraftPrefix = "cp_design_draft_199:";
const maxBytes = 2_000_000, lifetime = 8 * 60 * 60 * 1000;
export type DesignDraft = { schema: 1; at: number; base_version: number; head_version: number; name: string; input: any };
const key = (scope: string, id: string) => designDraftPrefix + encodeURIComponent(scope + ":" + id);
export function readDesignDraft(scope: string, id: string): DesignDraft | null {
  try {
    const text = sessionStorage.getItem(key(scope, id)); if (!text) return null;
    if (text.length > maxBytes) throw Error();
    const v = JSON.parse(text);
    if (v.schema !== 1 || !Number.isSafeInteger(v.at) || v.at > Date.now() + 60000 || Date.now() - v.at > lifetime
      || !Number.isSafeInteger(v.base_version) || v.base_version < 1 || !Number.isSafeInteger(v.head_version) || v.head_version < v.base_version
      || typeof v.name !== "string" || v.name.length > 160 || !v.input || typeof v.input !== "object" || Array.isArray(v.input)) throw Error();
    return v;
  } catch { forgetDesignDraft(scope, id); return null; }
}
export function keepDesignDraft(scope: string, id: string, value: Omit<DesignDraft, "schema" | "at">): boolean {
  try {
    const text = JSON.stringify({ ...value, schema: 1, at: Date.now() });
    if (text.length > maxBytes) throw Error("Draft too large");
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); if (k?.startsWith(designDraftPrefix)) keys.push(k); }
    for (const k of keys) { try { const v = JSON.parse(sessionStorage.getItem(k) ?? "null"); if (!v || Date.now() - v.at > lifetime) sessionStorage.removeItem(k); } catch { sessionStorage.removeItem(k); } }
    if (!sessionStorage.getItem(key(scope, id)) && keys.filter(k => sessionStorage.getItem(k) !== null).length >= 8) throw Error("Draft capacity reached");
    sessionStorage.setItem(key(scope, id), text); return true;
  } catch { forgetDesignDraft(scope, id); return false; }
}
export function forgetDesignDraft(scope: string, id: string) { try { sessionStorage.removeItem(key(scope, id)); } catch { /* Storage is unavailable; the live draft remains in memory. */ } }
export function clearDesignDrafts() {
  try { for (let i = sessionStorage.length - 1; i >= 0; i--) { const k = sessionStorage.key(i); if (k?.startsWith(designDraftPrefix)) sessionStorage.removeItem(k); } } catch { /* No accessible session storage. */ }
}
