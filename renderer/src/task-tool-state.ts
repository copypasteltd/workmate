export type ActivityEvent = { id: string | number; kind: string; body?: Record<string, unknown>; created_at?: string };
export type ToolOutcomeSummary = { total: number; as_of_event_id: string; items: Array<{tool: string; failure_ref: string; call_ref: string; code: string; category: string}> };
const toolKinds = new Set(["runtime.tool.failed", "runtime.tool.completed", "runtime.tool.recovered"]);
const validRef = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{16}$/.test(value);
const toolName = (event: ActivityEvent) => toolKinds.has(event.kind) && typeof event.body?.tool === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(event.body.tool) ? event.body.tool : null;
const obligationKey = (event: ActivityEvent) => {
  const name = toolName(event); if (!name) return null;
  if (event.body?.outcome_version !== 2) return "legacy:" + name;
  const ref = event.kind === "runtime.tool.failed" ? event.body.failure_ref : event.body.repair_of;
  return validRef(ref) ? name + ":" + ref : null;
};
export const toolActivityLabel = (kind: string) => kind === "runtime.tool.failed" ? ["部分步驟需要處理", "A step needs attention"] as const
  : kind === "runtime.tool.repair_rejected" ? ["修正需要核對", "Correction needs review"] as const
  : kind === "runtime.tool.recovered" ? ["步驟已修正並完成", "Step corrected and completed"] as const
  : kind === "runtime.tool.completed" ? ["步驟已完成", "Step completed"] as const : null;
/** Independent obligations survive streaming. Authorized summaries cover log pruning. */
export function retainTaskActivity(old: ActivityEvent[], batch: ActivityEvent[]): ActivityEvent[] {
  const all = [...new Map([...old, ...batch].map(event => [String(event.id), event])).values()].sort((a,b)=>Number(a.id)-Number(b.id));
  const tools = new Map<string, ActivityEvent>();
  for(const event of all){const key=obligationKey(event);if(key)tools.set(key,event);}
  return [...new Map([...all.slice(-400), ...[...tools.values()].slice(-128)].map(event => [String(event.id), event])).values()].sort((a,b)=>Number(a.id)-Number(b.id));
}
const safeFailure = (body: Record<string, unknown>) => ({
  tool: String(body.tool),
  category: ["validation","source","permission","execution"].includes(String(body.category)) ? String(body.category) : "execution",
  code: typeof body.code === "string" && /^[A-Z][A-Z0-9_]{2,79}$/.test(body.code) ? body.code : "TOOL_EXECUTION_FAILED",
  reference: validRef(body.failure_ref) ? body.failure_ref : validRef(body.call_ref) ? body.call_ref : "",
});
export function toolFeedbackState(items: ActivityEvent[], summary?: ToolOutcomeSummary) {
  const tools = new Map<string, ReturnType<typeof safeFailure>>();
  const useSummary = !!summary && /^\d+$/.test(String(summary.as_of_event_id)) && Number.isSafeInteger(summary.total) && summary.total>=0 && Array.isArray(summary.items);
  if(useSummary)for(const row of summary!.items.slice(0,64))if(/^[a-z][a-z0-9_]{0,63}$/.test(row.tool)&&validRef(row.failure_ref))tools.set(row.tool+":"+row.failure_ref,safeFailure(row));
  let delta=0;
  const seenResolutions=new Set<string>();
  for(const event of [...items].sort((a,b)=>Number(a.id)-Number(b.id))){
    if(useSummary && /^\d+$/.test(String(event.id)) && BigInt(event.id)<=BigInt(summary!.as_of_event_id))continue;
    const key=obligationKey(event);if(!key)continue;
    if(event.kind==="runtime.tool.failed"){
      if(!tools.has(key) && !(useSummary && validRef(event.body?.repair_of)))delta++;
      tools.set(key,safeFailure(event.body!));seenResolutions.delete(key);
    }else if(!seenResolutions.has(key)){
      if(tools.delete(key))delta--;
      else if(useSummary&&event.body?.outcome_version===2&&validRef(event.body.repair_of))delta--;
      seenResolutions.add(key);
    }
  }
  return {failures:[...tools.values()].reverse().slice(0,4),total:useSummary?Math.max(tools.size,summary!.total+delta):tools.size};
}
export function pendingToolFeedback(items: ActivityEvent[]) { return toolFeedbackState(items).failures; }
