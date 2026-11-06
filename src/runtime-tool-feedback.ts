import { z } from "zod";
import type { Tx } from "./db.js";
import { Problem } from "./lib.js";

/** Only this boundary proves that input validation preceded the business body. */
export class ToolInputFailure extends Error {
  constructor(readonly issues: readonly z.core.$ZodIssue[]) { super("TOOL_INPUT_INVALID"); }
}
export function parseToolArguments<T extends z.ZodType>(schema: T, args: unknown): z.output<T> {
  const parsed = schema.safeParse(args);
  if (!parsed.success) throw new ToolInputFailure(parsed.error.issues);
  return parsed.data;
}

export type ToolFeedback = {
  code: string;
  category: "validation" | "source" | "permission" | "execution";
  operation_outcome: "not_performed" | "unverified";
  can_correct_arguments: boolean;
  guidance: string;
  fields?: Array<{ path: string; rule: string }>;
};
const issueRules = new Set(["invalid_type", "too_small", "too_big", "invalid_value", "invalid_format", "unrecognized_keys", "custom", "not_multiple_of", "invalid_union", "invalid_key", "invalid_element"]);
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
function branches(node: unknown, root: unknown, depth = 0): Record<string, any>[] {
  if (!object(node) || depth > 8) return [];
  const result = [node];
  if (typeof node.$ref === "string" && node.$ref.startsWith("#/")) {
    let ref: unknown = root;
    for (const part of node.$ref.slice(2).split("/")) {
      const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
      ref = object(ref) && Object.hasOwn(ref, key) ? ref[key] : undefined;
    }
    result.push(...branches(ref, root, depth + 1));
  }
  for (const key of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(node[key]))
    for (const child of node[key].slice(0, 32)) result.push(...branches(child, root, depth + 1));
  return result;
}
/** Arbitrary record keys, rejected keys, values and validator prose never leave. */
function fieldPath(path: readonly PropertyKey[], schema: unknown): string {
  let nodes: unknown[] = [schema], result = "arguments";
  for (const part of path.slice(0, 10)) {
    const candidates = nodes.flatMap(node => branches(node, schema));
    if (typeof part === "number") {
      nodes = candidates.flatMap(node => object(node.items) ? [node.items] : []);
      if (!nodes.length) break;
      result += "[]";
    } else if (typeof part === "string" && /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(part)) {
      nodes = candidates.flatMap(node => object(node.properties) && Object.hasOwn(node.properties, part) ? [node.properties[part]] : []);
      if (!nodes.length) break;
      result += "." + part;
    } else break;
  }
  return result.slice(0, 200);
}

const renderValidation: Record<string, string> = {
  REPORT_NARRATIVE_INVALID: "Use only exact returned evidence IDs in {{id}} placeholders and evidence_ids. Numerical literals, including dates, are not allowed in narrative prose or next_steps. You may omit optional narrative to deliver the original complete evidence package; do not invent or remove requested data.",
  ANALYSIS_CALCULATION_CHANGED: "Read sheet_calculate again with the same customer-approved specification. Use its exact returned specification and calculation_sha256; do not invent hashes or silently change business scope.",
  ANALYSIS_VISUAL_DUPLICATE: "Select each current scope ID and metric once, using the actual calculation result.",
  ANALYSIS_VISUAL_SCOPE: "Use scope IDs returned by the current sheet_calculate pages and metrics included in that exact specification. Read remaining pages; do not substitute snapshot or evidence IDs for scope IDs.",
  ANALYSIS_VISUAL_LIMIT: "Split visual deliveries within the declared limit while retaining every requested scope, or ask the customer before reducing scope.",
  ANALYSIS_DELIVERY_LIMIT: "Split delivery output within the declared byte limit while preserving all requested data, or ask the customer before changing the scope.",
};
export function safeToolFeedback(error: unknown, tool: { name: string; inputSchema: unknown }): ToolFeedback {
  if (error instanceof ToolInputFailure) {
    const fields = [...new Map(error.issues.slice(0, 16).map(issue => {
      const value = { path: fieldPath(issue.path, tool.inputSchema), rule: issueRules.has(issue.code) ? issue.code : "invalid_input" };
      return [value.path + ":" + value.rule, value] as const;
    })).values()];
    return { code: "TOOL_INPUT_INVALID", category: "validation", operation_outcome: "not_performed", can_correct_arguments: true, fields,
      guidance: "Correct the declared input fields before calling this tool again within the same authorized task and budget. This validation did not run the business operation. " +
        (tool.name === "chart_render" ? "Use a nonnumerical title, exact calculation/scope IDs and evidence placeholders in narrative; next_steps must have no numerical literals. Optional narrative can be omitted without removing requested evidence." : "Do not add permissions, change confirmed scope or repeat an operation with an unknown outcome.") };
  }
  if (error instanceof Problem) {
    const guidance = Object.hasOwn(renderValidation, error.code) ? renderValidation[error.code] : undefined;
    if (guidance) return { code: error.code, category: "validation", operation_outcome: "not_performed", can_correct_arguments: true, guidance };
    if (error.status === 401 || error.status === 403) return { code: "TOOL_ACCESS_UNAVAILABLE", category: "permission", operation_outcome: "unverified", can_correct_arguments: false, guidance: "Current identity or permission is unavailable. Stop this operation; an input answer cannot grant access. Preserve any existing result and budget records, and request authorized customer or administrator action." };
    if ([404, 409, 410].includes(error.status)) return { code: "TOOL_SOURCE_UNAVAILABLE", category: "source", operation_outcome: "unverified", can_correct_arguments: false, guidance: "The selected source, execution state or prior result is unavailable or changed. Recheck the current authorized source and original operation receipt. Do not invent a replacement, bypass a guard or repeat an uncertain side effect." };
  }
  return { code: tool.name === "image2_generate" || tool.name === "image2_edit" ? "IMAGE_TOOL_FAILED" : "TOOL_EXECUTION_FAILED", category: "execution", operation_outcome: "unverified", can_correct_arguments: false,
    guidance: "The operation result could not be confirmed. Inspect the original persisted receipt or ask an administrator. Do not automatically repeat creation, publication, messages, payments or other uncertain side effects. Existing model usage and the original task budget remain recorded." };
}

/** A failed read is diagnostic; an unresolved attempted delivery cannot be success. */
const deliveryTools = new Set(["image2_generate", "image2_edit", "effect_render", "vector_render", "slides_build", "slides_render", "chart_render", "deliver_text", "audio_produce", "generated_video_create", "code_package", "design_render"]);
/** Latest durable outcomes survive a new native turn and paid input wait. */
export async function readUnresolvedDeliveryToolNames(tx: Tx, tenant: string, task: string): Promise<string[]> {
  const rows = await tx.query(`SELECT DISTINCT tool FROM task_tool_outcomes
    WHERE tenant_id=$1 AND task_id=$2 AND resolved_by IS NULL AND tool=ANY($3::text[])`, [tenant,task,[...deliveryTools]]);
  return rows.rows.map(row => row.tool);
}
export function deliveryFailureCode(names: readonly string[]): string {
  return names.some(name => name === "image2_generate" || name === "image2_edit") ? "IMAGE_TOOL_FAILED" : "TOOL_DELIVERY_INCOMPLETE";
}
export class RuntimeToolState {
  private failures = new Map<string, ToolFeedback>();
  private waitingForInput = false;
  constructor(unresolved: readonly string[] = []) {
    for (const name of new Set(unresolved)) if (deliveryTools.has(name))
      this.failures.set(name, safeToolFeedback(new Error(), { name, inputSchema: {} }));
  }
  fail(name: string, feedback: ToolFeedback) { this.failures.set(name, feedback); }
  complete(name: string): ToolFeedback | undefined {
    const previous = this.failures.get(name); this.failures.delete(name);
    if (name === "request_input") this.waitingForInput = true;
    return previous;
  }
  get unresolvedDelivery(): boolean { return !this.waitingForInput && [...this.failures.keys()].some(name => deliveryTools.has(name)); }
  get terminalCode(): string {
    return deliveryFailureCode([...this.failures.keys()]);
  }
}
