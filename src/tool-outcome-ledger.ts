import type { Tx } from "./db.js";
import { canonical, hash, Problem } from "./lib.js";
import { safeToolFeedback, type ToolFeedback } from "./runtime-tool-feedback.js";

export const repairArgument = "_workmate_repair_of";
const reference = /^[a-f0-9]{16}$/;
export const deliveryToolNames = new Set(["image2_generate", "image2_edit", "effect_render", "vector_render", "slides_build", "slides_render", "chart_render", "deliver_text", "audio_produce", "generated_video_create", "code_package", "design_render"]);
export type PendingToolOutcome = {
  tool: string; failure_ref: string; call_ref: string; arguments_sha256: string;
  code: string; category: ToolFeedback["category"];
  operation_outcome: ToolFeedback["operation_outcome"]; can_correct_arguments: boolean;
};
export class ToolRecoveryFailure extends Error {
  constructor(readonly reason: "invalid_reference" | "uncertain_operation") { super("TOOL_RECOVERY_NOT_ALLOWED"); }
}
export function recoveryFeedback(error: ToolRecoveryFailure): ToolFeedback {
  return { code: "TOOL_RECOVERY_NOT_ALLOWED", category: error.reason === "invalid_reference" ? "validation" : "execution", operation_outcome: "not_performed", can_correct_arguments: error.reason === "invalid_reference",
    guidance: error.reason === "uncertain_operation"
      ? "This original operation has an unverified outcome. Inspect its persisted receipt; do not submit it again or use correction metadata to repeat it. No operation was performed by this rejected call. Existing usage remains recorded."
      : "Correction requires the exact failure_ref returned for an unresolved, explicitly not-performed call of this same tool and task. Do not guess references, combine independent outputs or change authorization or budget. This rejected call performed no business operation." };
}

/** Only server registrations gain the optional control field. Business schemas
 * and idempotency inputs never receive it; nested customer objects are intact. */
export function recoveryToolSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new Error("Unsupported recovery tool schema");
  const result = structuredClone(schema) as Record<string, any>;
  if (result.type === "object") {
    if (Object.hasOwn(result.properties ?? {}, repairArgument)) throw new Error("Reserved recovery argument collision");
    result.properties = { ...result.properties, [repairArgument]: { type: "string", pattern: "^[a-f0-9]{16}$",
      description: "Optional. Exact failure_ref of this same task/tool's explicitly not-performed validation failure being corrected. Omit for an independent output. Never use for unknown operations, approvals or extra budget." } };
  } else {
    const key = ["oneOf", "anyOf", "allOf"].find(k => Array.isArray(result[k]));
    if (!key) throw new Error("Recovery requires an object tool argument");
    result[key] = result[key].map(recoveryToolSchema);
  }
  return result;
}

/** Each pending obligation belongs to one failed call. A distinct successful
 * output cannot discharge it. Corrective failures retain that same obligation. */
export class RuntimeToolLedger {
  private pending = new Map<string, PendingToolOutcome>();
  private waiting = false;
  constructor(initial: readonly PendingToolOutcome[] = []) {
    for (const item of initial) this.pending.set(item.failure_ref, { ...item });
  }
  prepare(tool: string, supplied: unknown) {
    let args = supplied, repair: string | undefined;
    if (supplied && typeof supplied === "object" && !Array.isArray(supplied) && Object.hasOwn(supplied, repairArgument)) {
      const { [repairArgument]: value, ...rest } = supplied as Record<string, unknown>;
      if (typeof value !== "string" || !reference.test(value)) throw new ToolRecoveryFailure("invalid_reference");
      const previous = this.pending.get(value);
      if (!previous || previous.tool !== tool || previous.operation_outcome !== "not_performed" || !previous.can_correct_arguments)
        throw new ToolRecoveryFailure(previous?.operation_outcome === "unverified" ? "uncertain_operation" : "invalid_reference");
      args = rest; repair = value;
    }
    const digest = hash(canonical(args ?? null));
    if ([...this.pending.values()].some(p => p.tool === tool && p.operation_outcome === "unverified"))
      throw new ToolRecoveryFailure("uncertain_operation");
    return { args, repair, arguments_sha256: digest };
  }
  fail(tool: string, call: string, digest: string, feedback: ToolFeedback, repair?: string): string {
    const root = repair ?? call;
    // Duplicate call identities are idempotent, matching the durable SQL ledger.
    // In particular, never downgrade an unknown side effect into a replayable call.
    if (!repair && this.pending.has(root)) return root;
    this.pending.set(root, { tool, failure_ref: root, call_ref: call, arguments_sha256: digest,
      code: feedback.code, category: feedback.category, operation_outcome: feedback.operation_outcome,
      can_correct_arguments: feedback.can_correct_arguments });
    return root;
  }
  complete(tool: string, repair?: string): PendingToolOutcome | undefined {
    if (tool === "request_input") this.waiting = true;
    if (!repair) return;
    const old = this.pending.get(repair);
    if (!old || old.tool !== tool || !old.can_correct_arguments || old.operation_outcome !== "not_performed")
      throw new ToolRecoveryFailure("invalid_reference");
    this.pending.delete(repair); return old;
  }
  pendingFor(tool: string) { return [...this.pending.values()].filter(p => p.tool === tool); }
  correctableReferences(tool: string) { return this.pendingFor(tool).filter(p => p.operation_outcome === "not_performed" && p.can_correct_arguments).map(p => p.failure_ref).slice(0,16); }
  get outstanding() { return [...this.pending.values()].filter(p => deliveryToolNames.has(p.tool)); }
  get unresolvedDelivery() { return !this.waiting && this.outstanding.length > 0; }
  get terminalCode() { return this.outstanding.some(p => ["image2_generate","image2_edit"].includes(p.tool)) ? "IMAGE_TOOL_FAILED" : "TOOL_DELIVERY_INCOMPLETE"; }
}

/** Independent of the activity log's thirty-day pruning. Tenant/task access
 * remains enforced by RLS and every caller's current task authorization. */
export async function readPendingToolOutcomes(tx: Tx, tenant: string, task: string): Promise<PendingToolOutcome[]> {
  return (await tx.query(`SELECT tool,failure_ref,call_ref,arguments_sha256,code,category,operation_outcome,can_correct_arguments
    FROM task_tool_outcomes WHERE tenant_id=$1 AND task_id=$2 AND resolved_by IS NULL ORDER BY created_at,failure_ref`, [tenant, task])).rows;
}

/** A resolved promise containing a failed/blocked job is not a delivery. These
 * two contracts come from trusted company handlers, never provider prose. */
export function assertDeliveredToolResult(tool: string, value: unknown): void {
  if (!["audio_produce","generated_video_create"].includes(tool)) return;
  const v = value as any;
  const usage = tool === "audio_produce" ? "confirmed_company_tariff" : "confirmed";
  if (!v || v.state !== "completed" || v.delivery_state !== "available" || v.usage_state !== usage
    || !Array.isArray(v.assets) || !v.assets.length || v.budget_violation === true)
    throw new ToolDeliveryUnconfirmed();
  if (tool === "audio_produce" && (v.kind === "speech"
    ? !v.assets.some((a: any) => a.kind === "audio")
    : v.kind !== "transcription" || !["transcript", "srt", "vtt"].every(kind => v.assets.some((a: any) => a.kind === kind))))
    throw new ToolDeliveryUnconfirmed();
}
export class ToolDeliveryUnconfirmed extends Problem {
  constructor() { super(409, "TOOL_DELIVERY_UNCONFIRMED", "The original media job has not confirmed an available delivery. Review its original receipt without repeating the operation."); }
}
export function outcomeFeedback(error: unknown, tool: { name: string; inputSchema: unknown }): ToolFeedback {
  return error instanceof ToolRecoveryFailure ? recoveryFeedback(error)
    : error instanceof ToolDeliveryUnconfirmed
      ? { code: "TOOL_DELIVERY_UNCONFIRMED", category: "execution", operation_outcome: "unverified", can_correct_arguments: false,
          guidance: "The original media job did not confirm a completed, available delivery and known usage. Inspect that same job's status and receipts; do not create another job, retry unknown side effects or erase recorded costs." }
      : safeToolFeedback(error, tool);
}

export async function publicToolOutcomeSummary(tx: Tx, tenant: string, task: string) {
  const row = (await tx.query(`WITH pending AS MATERIALIZED (
    SELECT tool,failure_ref,call_ref,code,category,created_at FROM task_tool_outcomes
    WHERE tenant_id=$1 AND task_id=$2 AND resolved_by IS NULL
  ) SELECT (SELECT count(*)::int FROM pending) AS total,
    coalesce((SELECT jsonb_agg(to_jsonb(p)-'created_at') FROM (SELECT * FROM pending ORDER BY created_at DESC,failure_ref LIMIT 64) p),'[]'::jsonb) AS items,
    coalesce((SELECT max(id)::text FROM task_events WHERE tenant_id=$1 AND task_id=$2),'0') AS as_of_event_id`,[tenant,task])).rows[0];
  return row;
}
