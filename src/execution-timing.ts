/** Missing historical measurements must not turn into NaN, infinity or fake zero. */
export function executionMilliseconds(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
export function executionSeconds(value: unknown): string | null {
  const ms = executionMilliseconds(value);
  return ms === null ? null : (ms / 1000).toFixed(1) + "s";
}
