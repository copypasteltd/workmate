/** Only bounded, non-content diagnostic codes may leave the native receipt. */
export function isDesktopClientErrorCode(value: unknown): value is string {
  return typeof value === "string" && value === value.trim() &&
    /^[A-Z][A-Z0-9_]{2,79}$/.test(value);
}

export function desktopClientError(report: unknown): string | null {
  if (!report || typeof report !== "object" || Array.isArray(report)) return null;
  const row = report as Record<string, unknown>;
  return ["failed", "unknown", "interrupted"].includes(String(row.status)) &&
    isDesktopClientErrorCode(row.error_code) ? row.error_code : null;
}

/** Identifiers are fixed call-site choices, never request or model input. */
export function desktopClientErrorSql(taskId: "tasks.id" | "sourced.id") {
  if (!["tasks.id", "sourced.id"].includes(taskId)) throw new Error("Invalid task projection");
  return `(SELECT CASE WHEN jsonb_typeof(native_error.client_report->'error_code')='string'
    AND native_error.client_report->>'status' IN ('failed','unknown','interrupted')
    AND native_error.client_report->>'error_code' ~ '^[A-Z][A-Z0-9_]{2,79}$'
    AND native_error.client_report->>'error_code' !~ '[[:space:]]'
    THEN native_error.client_report->>'error_code' END
    FROM public.desktop_executions native_error WHERE native_error.task_id=${taskId})`;
}
