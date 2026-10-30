export type EditableAttempt = { key: string; operation: "create" | "update" | "render"; path: string; method: "POST" | "PUT"; body: any };
export const editablePendingPrefix = "cp_editable_pending:";
export function readEditableAttempt(key: string, root: string): EditableAttempt | null {
  try { const value = JSON.parse(localStorage.getItem(key) ?? "null"); if (!value) return null;
    const id = "[a-f0-9-]{36}", suffix = value.path?.startsWith(root) ? value.path.slice(root.length) : null;
    if (!/^[\w:-]{16,128}$/.test(value.key) || !value.body || typeof value.body !== "object" || Array.isArray(value.body)
      || !(value.operation === "create" && value.method === "POST" && suffix === ""
        || value.operation === "update" && value.method === "PUT" && new RegExp(`^/${id}$`, "i").test(suffix ?? "")
        || value.operation === "render" && value.method === "POST" && new RegExp(`^/${id}/render$`, "i").test(suffix ?? ""))) throw new Error();
    return value;
  } catch { localStorage.removeItem(key); return null; }
}
export function clearEditableProjectRequests() {
  for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k?.startsWith(editablePendingPrefix)) localStorage.removeItem(k); }
}
