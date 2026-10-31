// An unresolved creation never expires into a second request key.
export type WorkspaceBody = { name: string; project_name: string };
export type WorkspaceResult = { tenant: { id: string; name: string }; project: { id: string; name: string } | null };
export type WorkspaceAttempt = { version: 1; owner: string; key: string; fingerprint: string; body?: WorkspaceBody; state: "pending" | "completed" | "removed" | "unavailable"; result?: WorkspaceResult };
const prefix = "cp_workspace_creation_v1:";
const keyFor = (owner: string) => prefix + owner;
export function loadWorkspaceAttempt(owner: string): WorkspaceAttempt | null {
  const raw = sessionStorage.getItem(keyFor(owner));
  if (!raw) return null;
  let a: WorkspaceAttempt;
  try { a = JSON.parse(raw); } catch { throw new Error("Workspace recovery data needs review. Please contact support."); }
  if (a.version !== 1 || a.owner !== owner || !/^[a-f0-9-]{36}$/i.test(a.key) || !/^[a-f0-9]{64}$/.test(a.fingerprint)
    || !["pending", "completed", "removed", "unavailable"].includes(a.state)
    || a.body && (typeof a.body.name !== "string" || typeof a.body.project_name !== "string")
    || a.state === "completed" && (!a.result?.tenant?.id || a.result.project !== null && !a.result.project?.id))
    throw new Error("Workspace recovery data needs review. Please contact support.");
  return a;
}
export function saveWorkspaceAttempt(a: WorkspaceAttempt) {
  sessionStorage.setItem(keyFor(a.owner), JSON.stringify(a));
}
export function completeWorkspaceAttempt(owner: string, key: string) {
  if (loadWorkspaceAttempt(owner)?.key === key) sessionStorage.removeItem(keyFor(owner));
}
export async function workspaceFingerprint(body: WorkspaceBody) {
  const bytes = new TextEncoder().encode(JSON.stringify([body.name, body.project_name]));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("");
}
export async function beginWorkspaceAttempt(owner: string, body: WorkspaceBody, current: () => void = () => {}): Promise<WorkspaceAttempt> {
  const fingerprint = await workspaceFingerprint(body);
  current();
  const existing = loadWorkspaceAttempt(owner);
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw new Error("Check the original workspace and project names before continuing.");
    return existing;
  }
  const a: WorkspaceAttempt = { version: 1, owner, key: crypto.randomUUID(), fingerprint, body, state: "pending" };
  saveWorkspaceAttempt(a); // Persist before a request can commit.
  return a;
}
// Explicit sign-out removes private names; the opaque key still allows the owner to reconcile a lost response.
export function redactWorkspaceAttempts(keepOwner?: string) {
  try {
  const keys = Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i)).filter((k): k is string => !!k);
  for (const key of keys) {
    if (!key.startsWith(prefix) || key === keyFor(keepOwner ?? "")) continue;
    try { const a = JSON.parse(sessionStorage.getItem(key) ?? "{}"); delete a.body; delete a.result; if (a.state === "completed") a.state = "pending"; sessionStorage.setItem(key, JSON.stringify(a)); } catch { /* Corrupt receipts stay blocked, never silently reset. */ }
  }
  } catch { /* Storage may be unavailable; session termination must still complete. */ }
}
