/** Tab-local customer drafts. Storage never supplies identity or authority. */
export type WorkScope = { user: string; tenant: string; project: string };
export type WorkValues = {
  role: string; title: string; prompt: string; mode: string; budget: string;
  required_input: string; video_mode: string; video_seconds: string; video_size: string;
};
export type WorkSeed = Partial<Pick<WorkValues, "role" | "prompt">>;
export type Submission = { key: string; identity: string; endpoint: string; body: Record<string, unknown> };
export type WorkDraft = {
  version: 1; id: string; scope: WorkScope; saved: number; values: WorkValues;
  pending?: Submission; accepted?: string; acceptedIdentity?: string; removed?: boolean;
};
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
const prefix = "cp_work_draft_v1:", attempts = "cp_work_attempt_v1:", selections = "cp_work_selection_v1:", memory = new Map<string, string>();
export const blankWork: WorkValues = {
  role: "assistant", title: "", prompt: "", mode: "execute", budget: "20",
  required_input: "", video_mode: "composition", video_seconds: "4", video_size: "1280x720",
};
function storage(): Store | undefined { try { return globalThis.sessionStorage; } catch { return undefined; } }
function read(key: string): string | null {
  try { const value = storage()?.getItem(key); if (value != null) return value; } catch { /* Memory fallback for this page. */ }
  return memory.get(key) ?? null;
}
function write(key: string, value: string) {
  memory.set(key, value);
  try { const store = storage(); if (!store) return false; store.setItem(key, value); return true; } catch { return false; }
}
function remove(key: string) { memory.delete(key); try { storage()?.removeItem(key); } catch { /* Disabled storage. */ } }
function keys() {
  const result = new Set(memory.keys());
  try { const store = storage(); if (store) for (let i = 0; i < store.length; i++) { const key = store.key(i); if (key) result.add(key); } } catch { /* Disabled storage. */ }
  return result;
}
function scopeKey(scope: WorkScope) {
  if (Object.values(scope).some(value => typeof value !== "string" || !value || value.length > 200)) throw new Error("WORK_SCOPE_REQUIRED");
  return prefix + [scope.user, scope.tenant, scope.project].map(encodeURIComponent).join(":");
}
const sameScope = (a: WorkScope, b: WorkScope) => a.user === b.user && a.tenant === b.tenant && a.project === b.project;
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function validValues(value: unknown): value is WorkValues {
  if (!plain(value) || Object.keys(value).length !== Object.keys(blankWork).length) return false;
  if (Object.entries(blankWork).some(([key]) => typeof value[key] !== "string")) return false;
  const v = value as WorkValues;
  return /^[a-z0-9-]{1,80}$/.test(v.role) && v.title.length <= 160 && v.prompt.length <= 30000
    && ["ask", "plan", "execute"].includes(v.mode) && v.budget.length <= 16
    && ["", "file", "google_ads", "ga4", "search_console", "meta"].includes(v.required_input)
    && ["composition", "generated"].includes(v.video_mode) && ["4", "8", "12", "16", "20"].includes(v.video_seconds)
    && ["1280x720", "720x1280", "1024x1024"].includes(v.video_size);
}
export function workEndpoint(scope: WorkScope, role: string) {
  return `/v1/tenants/${scope.tenant}/projects/${scope.project}/${role === "assistant" ? "delegations" : "tasks"}`;
}
function validSubmission(value: unknown, draft: WorkDraft): value is Submission {
  if (!plain(value) || !plain(value.body) || typeof value.key !== "string" || !/^[a-f0-9-]{36}$/.test(value.key)) return false;
  if (value.endpoint !== workEndpoint(draft.scope, draft.values.role) || typeof value.identity !== "string" || !/^cp_work_attempt_v1:[a-f0-9]{64}$/.test(value.identity)) return false;
  const body = value.body;
  return typeof body.title === "string" && body.title.length <= 160 && typeof body.prompt === "string" && body.prompt.length <= 32000
    && ["ask", "plan", "execute"].includes(String(body.mode)) && Number.isSafeInteger(body.budget_micros)
    && Number(body.budget_micros) >= 1000000 && Number(body.budget_micros) <= 10000000000
    && (draft.values.role === "assistant" ? body.client_message_id === value.key : body.role_key === draft.values.role);
}
export function loadWorkDraft(scope: WorkScope): WorkDraft | null {
  const raw = read(scopeKey(scope));
  if (!raw) return null;
  // A corrupt saved submission must not silently become a fresh billable task.
  try {
    if (raw.length > 256000) throw new Error();
    const draft = JSON.parse(raw) as WorkDraft;
    if (draft.version !== 1 || !sameScope(draft.scope, scope) || !/^[a-f0-9-]{36}$/.test(draft.id)
      || !Number.isFinite(draft.saved) || !validValues(draft.values)) throw new Error();
    if (draft.pending && !validSubmission(draft.pending, draft)) throw new Error();
    if (draft.accepted && !/^\/app\/(tasks|conversations)\/[a-f0-9-]{36}$/.test(draft.accepted)) throw new Error();
    if (draft.removed !== undefined && draft.removed !== true) throw new Error();
    if (draft.pending && (draft.accepted || draft.removed)) throw new Error();
    if (draft.acceptedIdentity && (!(draft.accepted || draft.removed) || !/^cp_work_attempt_v1:[a-f0-9]{64}$/.test(draft.acceptedIdentity))) throw new Error();
    if (!draft.pending && !draft.accepted && Date.now() - draft.saved > 86400000) { remove(scopeKey(scope)); return null; }
    return draft;
  } catch { throw new Error("WORK_DRAFT_INVALID"); }
}
export function newWorkDraft(scope: WorkScope, seed: WorkSeed = {}): WorkDraft {
  const previous = loadWorkDraft(scope);
  if (previous?.pending) throw new Error("WORK_SUBMISSION_LOCKED");
  if (previous?.acceptedIdentity) remove(previous.acceptedIdentity);
  const draft: WorkDraft = { version: 1, id: crypto.randomUUID(), scope: { ...scope }, saved: Date.now(), values: { ...blankWork, ...seed } };
  if (!validValues(draft.values)) throw new Error("WORK_DRAFT_INVALID");
  return draft;
}
export function saveWorkDraft(draft: WorkDraft) { return write(scopeKey(draft.scope), JSON.stringify(draft)); }
export function updateWorkDraft(draft: WorkDraft, changes: Partial<WorkValues>) {
  if (draft.pending || draft.accepted || draft.removed) throw new Error("WORK_SUBMISSION_LOCKED");
  const next = { ...draft, saved: Date.now(), values: { ...draft.values, ...changes } };
  if (!validValues(next.values)) throw new Error("WORK_DRAFT_INVALID");
  saveWorkDraft(next); return next;
}
export function openWorkDraft(scope: WorkScope, seed: WorkSeed = {}) {
  const saved = loadWorkDraft(scope);
  if (saved?.pending) return saved;
  if ((saved?.accepted || saved?.removed) && !Object.keys(seed).length) return saved;
  if (!saved || saved.accepted || saved.removed) { const draft = newWorkDraft(scope, seed); saveWorkDraft(draft); return draft; }
  return updateWorkDraft(saved, { ...(seed.role ? { role: seed.role, required_input: "" } : {}),
    ...(!saved.values.prompt && seed.prompt ? { prompt: seed.prompt } : {}) });
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export async function prepareWorkSubmission(draft: WorkDraft, body: Record<string, unknown>): Promise<WorkDraft> {
  if (draft.accepted || draft.removed) return draft;
  if (draft.pending) return draft; // Retry exactly the original customer-confirmed request.
  const endpoint = workEndpoint(draft.scope, draft.values.role);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical([draft.scope, endpoint, body]))));
  const name = attempts + [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join("");
  const current = loadWorkDraft(draft.scope);
  if (!current || current.id !== draft.id || current.accepted || current.removed || JSON.stringify(current.values) !== JSON.stringify(draft.values)) throw new Error("WORK_DRAFT_CHANGED");
  if (current.pending) return current;
  const prior = read(name);
  if (prior && !/^[a-f0-9-]{36}$/.test(prior)) throw new Error("WORK_DRAFT_INVALID");
  const key = prior ?? crypto.randomUUID();
  // This content-free key has no automatic expiry: an unknown paid result is never blindly repeated.
  write(name, key);
  const pending: Submission = { key, identity: name, endpoint, body: { ...body, ...(draft.values.role === "assistant" ? { client_message_id: key } : {}) } };
  const next = { ...draft, saved: Date.now(), pending };
  if (!validSubmission(pending, next)) throw new Error("WORK_SUBMISSION_INVALID");
  saveWorkDraft(next); return next;
}
export function rejectWorkSubmission(draft: WorkDraft) {
  const { pending: _, ...next } = draft;
  if (loadWorkDraft(draft.scope)?.id === draft.id) saveWorkDraft(next);
  return next;
}
export function removedWorkSubmission(draft: WorkDraft) {
  const next: WorkDraft = { version: 1, id: draft.id, scope: draft.scope, saved: Date.now(), values: { ...blankWork }, removed: true,
    ...(draft.pending ? { acceptedIdentity: draft.pending.identity } : {}) };
  if (loadWorkDraft(draft.scope)?.id === draft.id) saveWorkDraft(next);
  return next;
}
export function acceptWorkSubmission(draft: WorkDraft, destination: string) {
  if (!/^\/app\/(tasks|conversations)\/[a-f0-9-]{36}$/.test(destination)) throw new Error("WORK_RESULT_INVALID");
  const next: WorkDraft = { version: 1, id: draft.id, scope: draft.scope, saved: Date.now(), values: { ...blankWork }, accepted: destination,
    ...(draft.pending ? { acceptedIdentity: draft.pending.identity } : {}) };
  // Retain a minimal result before navigation, including a reload after a lost UI acknowledgement.
  const current = loadWorkDraft(draft.scope);
  if (current?.id === draft.id) saveWorkDraft(next);
  return next;
}
export function clearWorkDrafts(user?: string) {
  for (const key of keys()) if (key.startsWith(prefix) || key.startsWith(selections)) {
    if (!user) remove(key);
    else { try { const value = JSON.parse(read(key) ?? "null"); if ((value?.scope?.user ?? value?.user) !== user) remove(key); } catch { remove(key); } }
  }
  // The previous unscoped field cannot safely be attributed to any signed-in customer.
  remove("cp_brief");
}
export function saveWorkSelection(scope: WorkScope) {
  scopeKey(scope);
  write(selections + encodeURIComponent(scope.user), JSON.stringify(scope));
}
/** A display preference only. Callers must intersect it with current membership/project reads. */
export function workSelection(user: string): WorkScope | null {
  try {
    const value = JSON.parse(read(selections + encodeURIComponent(user)) ?? "null");
    if (!value || value.user !== user || typeof value.tenant !== "string" || typeof value.project !== "string") return null;
    scopeKey(value); return value;
  } catch { return null; }
}
