export type RevisionTarget = { kind: "whole" | "output" }
  | { kind: "artifact"; asset_version_id: string }
  | { kind: "text"; asset_version_id?: string; start: number; end: number; quote: string }
  | { kind: "image"; asset_version_id: string; x: number; y: number; width: number; height: number }
  | { kind: "video"; asset_version_id: string; start_ms: number; end_ms: number };
export interface RevisionSelection {
  source_task_id: string; expected_version: number; expected_delivery_hash: string; target: RevisionTarget;
}
export interface RevisionSubmission extends RevisionSelection {
  instructions: string; budget_micros: number; expected_conversation_version?: number;
}
export interface RevisionPending { key: string; body: RevisionSubmission; local: boolean }
export function revisionMicros(value: string) {
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(value)) throw new Error("請輸入最多兩位小數的港幣預算 / Enter an HKD budget with at most two decimals");
  const [whole, cents = ""] = value.split("."), amount = BigInt(whole) * 1_000_000n + BigInt(cents.padEnd(2, "0")) * 10_000n;
  if (amount < 10_000n || amount > 10_000_000_000n) throw new Error("預算須為 HKD 0.01–10,000 / Budget must be HKD 0.01–10,000");
  return Number(amount);
}
export function textRevisionTarget(text: string, start: number, end: number, version?: string): RevisionTarget {
  const quote = text.slice(start, end), first = Array.from(text.slice(0, start)).length, length = Array.from(quote).length;
  if (!length || length > 4000) throw new Error("請選取 1–4,000 個字元 / Select 1–4,000 characters");
  return { kind: "text", ...(version ? { asset_version_id: version } : {}), start: first, end: first + length, quote };
}
export function revisionReference(body: RevisionSelection): RevisionSelection {
  return { source_task_id: body.source_task_id, expected_version: body.expected_version,
    expected_delivery_hash: body.expected_delivery_hash, target: structuredClone(body.target) };
}
export function readRevisionPending(raw: string | null, taskId: string, local: boolean): RevisionPending | null {
  if (!raw || raw.length > 40000) return null;
  try {
    const value = JSON.parse(raw) as RevisionPending, body = value.body;
    if (!/^[a-f\d-]{36}$/i.test(value.key) || value.local !== local || body.source_task_id !== taskId
      || !Number.isSafeInteger(body.expected_version) || body.expected_version < 1 || !/^[a-f0-9]{64}$/.test(body.expected_delivery_hash)
      || !body.target || typeof body.target !== "object" || typeof body.instructions !== "string" || body.instructions.length > 6000
      || !Number.isSafeInteger(body.budget_micros) || body.budget_micros < 10000 || body.budget_micros > 10_000_000_000) return null;
    return value;
  } catch { return null; }
}
export const revisionDraftPrefix = "cp_delivery_revision_v1:";
export function clearDeliveryRevisionDrafts() {
  try { for (let i = localStorage.length - 1; i >= 0; i--) { const key = localStorage.key(i); if (key?.startsWith(revisionDraftPrefix)) localStorage.removeItem(key); } } catch { /* No optional storage authority. */ }
}
