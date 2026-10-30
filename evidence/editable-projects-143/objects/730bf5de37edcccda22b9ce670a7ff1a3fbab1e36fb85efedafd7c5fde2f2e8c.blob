import { z } from "zod";
import { uuid, canonical, hash, Problem } from "./lib.js";

const version = z.number().int().positive();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const point = z.number().finite().min(0).max(1);
export const revisionTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("whole") }).strict(),
  z.object({ kind: z.literal("output") }).strict(),
  z.object({ kind: z.literal("artifact"), asset_version_id: uuid }).strict(),
  z.object({ kind: z.literal("text"), asset_version_id: uuid.optional(), start: z.number().int().min(0),
    end: z.number().int().positive(), quote: z.string().min(1).max(8000).refine(v => Array.from(v).length <= 4000) }).strict()
    .refine(v => v.end > v.start && v.end - v.start <= 4000),
  z.object({ kind: z.literal("image"), asset_version_id: uuid, x: point, y: point,
    width: point.gt(0), height: point.gt(0) }).strict()
    .refine(v => v.x + v.width <= 1.00000001 && v.y + v.height <= 1.00000001),
  z.object({ kind: z.literal("video"), asset_version_id: uuid, start_ms: z.number().int().min(0),
    end_ms: z.number().int().positive().max(86_400_000) }).strict().refine(v => v.end_ms > v.start_ms),
]);
export const revisionSelection = z.object({
  source_task_id: uuid, expected_version: version, expected_delivery_hash: digest, target: revisionTarget,
}).strict();
export const revisionRequest = revisionSelection.extend({
  instructions: z.string().trim().min(5).max(6000), budget_micros: z.number().int().min(10_000).max(10_000_000_000),
  expected_conversation_version: version.optional(),
}).strict();
export type RevisionSelection = z.infer<typeof revisionSelection>;
export type RevisionBinding = RevisionSelection & { source_role_key: string; source_role_hash: string };

export function sameRevisionDelivery(actual: unknown, expected: string) {
  if (hash(canonical(actual)) !== expected)
    throw new Problem(409, "REVISION_SOURCE_CHANGED", "The selected delivery changed; reload it before requesting changes");
}
export function revisionInstructions(input: RevisionSelection, instructions: string, local = false) {
  return `Revise the customer's exact selected delivery. Before editing, use ${local ? 'project_assets and read its delivery_revision field' : 'delivery_revision_read'} to read the fixed original result and selected artifact references. Read actual source files with the role's exact-version tools. Preserve original files and create a new delivery; never overwrite a newer version. Image rectangles and video intervals are customer feedback anchors, not a pre-approved image mask or editing operation. This request grants no additional tools, files, external writes or spending.\n\nFixed delivery reference:\n${canonical(input)}\n\nCustomer's requested changes:\n${instructions}`;
}

/** Character offsets are Unicode code points, never UTF-16 code units. */
export function verifyTextAnchor(text: string, target: Extract<z.infer<typeof revisionTarget>, { kind: "text" }>) {
  const characters = Array.from(text);
  if (target.end > characters.length || characters.slice(target.start, target.end).join("") !== target.quote)
    throw new Problem(409, "REVISION_ANCHOR_CHANGED", "The selected text does not match this exact delivery");
}
