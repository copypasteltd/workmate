export const analysisPendingPrefix = "cp_analysis_pending_202:";
export type AnalysisPending = { schema: 1; at: number; key: string; body: any };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const storageKey = (scope: string) => analysisPendingPrefix + encodeURIComponent(scope);
export function validAnalysisPending(value: any, scope: string): value is AnalysisPending {
  try {
    const [actor, tenant, project] = scope.split(":");
    if (![actor, tenant, project].every(x => uuid.test(x)) || scope.split(":").length !== 3) return false;
    const b = value.body, s = b.analysis;
    return value.schema === 1 && Number.isSafeInteger(value.at) && value.at > 0 && value.at <= Date.now() + 60000 && uuid.test(value.key) && b.project_id === project && uuid.test(b.agent_id) && /^[a-f0-9]{64}$/.test(b.expected_calculation_sha256) && b.budget.currency === "HKD" && /^[1-9]\d{0,12}$/.test(b.budget.amount_micros) && BigInt(b.budget.amount_micros) <= 1000000000000n && typeof s.prompt === "string" && s.prompt.length > 0 && s.prompt.length <= 8000 && Array.isArray(s.snapshot_ids) && s.snapshot_ids.length > 0 && s.snapshot_ids.length <= 10 && s.snapshot_ids.every((x: unknown) => typeof x === "string" && uuid.test(x)) && Array.isArray(s.metrics) && s.metrics.length > 0 && s.metrics.length <= 11 && Array.isArray(s.dimensions) && s.dimensions.length <= 7 && typeof s.timezone === "string" && s.timezone.length <= 80 && typeof s.date_from === "string" && typeof s.date_to === "string" && new TextEncoder().encode(JSON.stringify(value)).length <= 100000;
  } catch { return false; }
}
export function readAnalysisPending(scope: string): AnalysisPending | null {
  try { const text = sessionStorage.getItem(storageKey(scope)); if (!text) return null; const value = JSON.parse(text); if (!validAnalysisPending(value, scope)) return null; return value; } catch { return null; }
}
export function keepAnalysisPending(scope: string, value: AnalysisPending): void {
  if (!validAnalysisPending(value, scope)) throw new Error("Cannot safely retain this report request");
  const text = JSON.stringify(value);
  // A paid request must not start if its exact continuation cannot be retained.
  sessionStorage.setItem(storageKey(scope), text);
  if (sessionStorage.getItem(storageKey(scope)) !== text) throw new Error("Report continuation is unavailable");
}
export function forgetAnalysisPending(scope: string) { try { sessionStorage.removeItem(storageKey(scope)); } catch { /* No request is sent by cleanup. */ } }
export function clearAnalysisPending() { try { const keys: string[] = []; for (let i = 0; i < sessionStorage.length; i++) { const key = sessionStorage.key(i); if (key?.startsWith(analysisPendingPrefix)) keys.push(key); } for (const key of keys) sessionStorage.removeItem(key); } catch { /* In-memory state is separately unmounted at sign-out. */ } }
export function uncertainAnalysisResult(error: any): boolean { return !Number.isInteger(error?.status) || error.status === 0 || error.status >= 500 || error.status === 401 || ["SESSION_CHANGED", "AUTH_CHANGED"].includes(error?.code); }
