/** Host elapsed time is preferred; Linux/legacy receipts retain real run timestamps. */
export function receiptElapsedMs(receipt: { host?: { elapsed_ms?: unknown }; started_at?: unknown; finished_at?: unknown }): number | null {
  const host = receipt.host?.elapsed_ms;
  if (typeof host === "number" && Number.isSafeInteger(host) && host >= 0) return host;
  if (typeof receipt.started_at !== "string" || typeof receipt.finished_at !== "string") return null;
  const start = Date.parse(receipt.started_at), finish = Date.parse(receipt.finished_at), elapsed = finish - start;
  return Number.isSafeInteger(start) && Number.isSafeInteger(finish)
    && new Date(start).toISOString() === receipt.started_at && new Date(finish).toISOString() === receipt.finished_at
    && Number.isSafeInteger(elapsed) && elapsed >= 0 ? elapsed : null;
}
