export type ActivityEvent = { id: string | number; kind: string; body?: Record<string, unknown>; created_at?: string };
const toolKinds = new Set(["runtime.tool.failed", "runtime.tool.completed", "runtime.tool.recovered"]);
const toolName = (event: ActivityEvent) => toolKinds.has(event.kind) && typeof event.body?.tool === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(event.body.tool) ? event.body.tool : null;
export const toolActivityLabel = (kind: string) => kind === "runtime.tool.failed" ? ["部分步驟需要處理", "A step needs attention"] as const
  : kind === "runtime.tool.recovered" ? ["步驟已修正並完成", "Step corrected and completed"] as const
  : kind === "runtime.tool.completed" ? ["步驟已完成", "Step completed"] as const : null;

/** Keep bounded current tool outcomes even when a long reply has many deltas. */
export function retainTaskActivity(old: ActivityEvent[], batch: ActivityEvent[]): ActivityEvent[] {
  const all = [...new Map([...old, ...batch].map(event => [String(event.id), event])).values()];
  const tools = new Map<string, ActivityEvent>();
  for (const event of all) { const name = toolName(event); if (name) tools.set(name, event); }
  return [...new Map([...all.slice(-400), ...[...tools.values()].slice(-128)].map(event => [String(event.id), event])).values()]
    .sort((a, b) => Number(a.id) - Number(b.id));
}
export function pendingToolFeedback(items: ActivityEvent[]) {
  const tools = new Map<string, ActivityEvent>();
  for (const event of items) { const name = toolName(event); if (name) tools.set(name, event); }
  return [...tools.values()].filter(event => event.kind === "runtime.tool.failed")
    .sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 4).map(event => ({
      tool: String(event.body!.tool),
      category: ["validation", "source", "permission", "execution"].includes(String(event.body?.category)) ? String(event.body!.category) : "execution",
      code: typeof event.body?.code === "string" && /^[A-Z][A-Z0-9_]{2,79}$/.test(event.body.code) ? event.body.code : "TOOL_EXECUTION_FAILED",
      reference: typeof event.body?.call_ref === "string" && /^[a-f0-9]{16}$/.test(event.body.call_ref) ? event.body.call_ref : "",
    }));
}
