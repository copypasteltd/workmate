import { z } from "zod";
import { Problem, canonical, hash, uuid } from "./lib.js";

const micros = z.number().int().min(1).max(1_000_000_000);
export const dedicatedPlanInput = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
  name: z.string().trim().min(1).max(100),
  region: z.string().trim().min(1).max(80),
  cpu_cores: z.number().int().min(1).max(128),
  memory_mib: z.number().int().min(512).max(1_048_576),
  disk_mib: z.number().int().min(1024).max(4_194_304),
  per_minute_micros: micros,
  max_minutes: z.number().int().min(5).max(1440),
  terminal: z.boolean(),
  visual: z.boolean(),
  reason: z.string().trim().min(8).max(500),
}).strict();

// A dedicated computer is optional infrastructure. No plan grants access to
// every project file, a customer's local computer, or another AI endpoint.
export const dedicatedScope = z.object({
  terminal: z.boolean(),
  visual: z.boolean(),
  agent_control: z.boolean().default(false),
  selected_asset_versions: z.array(uuid).max(20),
  purpose: z.string().trim().min(8).max(500),
}).strict().superRefine((scope, ctx) => {
  if (new Set(scope.selected_asset_versions).size !== scope.selected_asset_versions.length)
    ctx.addIssue({ code: "custom", message: "Select each exact file version once", path: ["selected_asset_versions"] });
});
export const dedicatedQuoteInput = z.object({
  plan_key: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
  minutes: z.number().int().min(5).max(1440),
  billing_account_id: uuid,
  scope: dedicatedScope,
}).strict();
export const dedicatedConfirmation = z.object({
  quote_id: uuid,
  specification_hash: z.string().regex(/^[a-f0-9]{64}$/),
  maximum_cost_micros: z.string().regex(/^[1-9][0-9]*$/),
  confirm_cost_and_scope: z.literal(true),
}).strict();
export const dedicatedAgentTaskInput = z.object({
  prompt: z.string().trim().min(5).max(30000),
  budget_micros: z.number().int().min(1).max(1_000_000_000_000),
  generation: z.number().int().positive(),
  specification_hash: z.string().regex(/^[a-f0-9]{64}$/),
  confirm_agent_task: z.literal(true),
}).strict();
export const dedicatedControlInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("terminal"), command: z.string().min(1).max(4096) }).strict(),
  z.object({ kind: z.literal("pointer"), x: z.number().int().min(0).max(1279), y: z.number().int().min(0).max(719), button: z.enum(["none", "left", "right"]) }).strict(),
  z.object({ kind: z.literal("key"), key: z.enum(["Enter", "Escape", "Tab", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]), text: z.string().max(1000).optional() }).strict(),
]);
export const dedicatedNodeRegistration = z.object({
  name: z.string().trim().min(1).max(100),
  plan_key: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
  machine_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(8).max(500),
}).strict();
export const dedicatedNodePoll = z.object({
  machine_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  instance_id: uuid,
  agent_version: z.literal("1.0.0"),
  // Nodes may only report a computer that was preprovisioned by its operator.
  // This protocol contains no purchase, Docker, WSL or VM creation operation.
  physical_host: z.literal(true),
  current_session_id: uuid.nullable(),
  current_generation: z.number().int().nonnegative(),
}).strict();
export const dedicatedNodeAcknowledgement = z.object({
  instance_id: uuid,
  command_id: uuid,
  session_id: uuid,
  generation: z.number().int().positive(),
  outcome: z.enum(["ready", "completed", "stopped", "failed"]),
  cleanup_verified: z.boolean(),
  running_milliseconds: z.number().int().nonnegative().max(86_400_000),
  result: z.string().max(16_384).optional(),
}).strict();
export const dedicatedFrameInput = z.object({
  instance_id: uuid,
  session_id: uuid,
  generation: z.number().int().positive(),
  sequence: z.number().int().positive(),
  png_base64: z.string().min(12).max(700_000),
}).strict();
export type DedicatedPlan = z.infer<typeof dedicatedPlanInput>;
export type DedicatedScope = z.infer<typeof dedicatedScope>;

export function dedicatedMaximumCost(rate: number, minutes: number): string {
  if (!Number.isSafeInteger(rate) || rate <= 0 || !Number.isSafeInteger(minutes) || minutes < 1 || minutes > 1440)
    throw new Problem(400, "CLOUD_RUNTIME_PRICE_INVALID", "Review the exact resource rate and duration");
  return (BigInt(rate) * BigInt(minutes)).toString();
}
export function dedicatedUsageCost(rate: number, runningMilliseconds: number, maximum: string): string {
  if (!Number.isSafeInteger(rate) || rate <= 0 || !Number.isSafeInteger(runningMilliseconds) || runningMilliseconds < 0 || !/^[1-9][0-9]*$/.test(maximum))
    throw new Problem(409, "CLOUD_RUNTIME_USAGE_UNCERTAIN", "Resource usage needs an operator review");
  const amount = (BigInt(rate) * BigInt(runningMilliseconds) + 59_999n) / 60_000n;
  if (amount > BigInt(maximum))
    throw new Problem(409, "CLOUD_RUNTIME_USAGE_UNCERTAIN", "Usage exceeds the customer's confirmed ceiling");
  return amount.toString();
}
export const dedicatedSpecificationHash = (specification: unknown) => hash(canonical(specification));
