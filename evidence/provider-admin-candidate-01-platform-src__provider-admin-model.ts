import { z } from "zod";
import { uuid } from "./lib.js";

const bounded = (max: number) => z.number().int().min(1).max(max);
const safe = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positive = safe.refine((n) => n > 0, "Use a positive amount");
export const providerReason = z.string().trim().min(3).max(1000);
export const providerChannel = z.enum(["generation", "input_count"]);
export const providerDataMode = z.enum(["simulated", "configured_services"]);
export const providerLimits = z
  .object({
    global_slots: bounded(1000),
    tenant_slots: bounded(1000),
    actor_slots: bounded(1000),
    text_slots: bounded(1000),
    image_slots: bounded(1000),
    verification_slots: bounded(1000),
    global_rpm: bounded(100000),
    tenant_rpm: bounded(100000),
    actor_rpm: bounded(100000),
    text_rpm: bounded(100000),
    image_rpm: bounded(100000),
    verification_rpm: bounded(100000),
    preparation_seconds: bounded(300),
  })
  .strict();
export const providerBudgetDefinition = z
  .object({
    count_verified: z.boolean(),
    count_price_micros: safe.nullable(),
    verification_run_micros: positive,
    verification_daily_micros: positive,
    counting_daily_micros: positive,
  })
  .strict();
export const providerPolicyDefinition = z
  .object({
    limits: providerLimits,
    budget: providerBudgetDefinition,
    count_contract: z
      .object({
        reference: z.string().trim().min(3).max(300),
        terms: z.string().trim().min(10).max(16000),
        service: z.literal("responses.input_tokens"),
        fee_micros: safe,
        effective_at: z.string().datetime({ offset: true }),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (
      b.budget.count_verified &&
      (!b.count_contract ||
        b.budget.count_price_micros === null ||
        b.count_contract.fee_micros !== b.budget.count_price_micros)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["count_contract"],
        message:
          "Verified counting requires explicit matching contract terms and price",
      });
  });
export const providerPolicyDraft = z
  .object({
    definition: providerPolicyDefinition,
    reason: providerReason,
  })
  .strict();
export const providerPolicyPublication = z
  .object({
    action: z.literal("ai.policy.publish"),
    draft_id: uuid,
    expected_revision: z.number().int().min(0),
    reason: providerReason,
  })
  .strict();
export const providerEvidenceDocument = z
  .object({
    schema_version: z.literal(1),
    data_mode: providerDataMode,
    operation_id: z.string().regex(/^[a-zA-Z0-9_:-]{16,128}$/),
    request_hash: z.string().regex(/^[a-f0-9]{64}$/),
    provider_reference: z.string().trim().min(3).max(300),
    source_reference: z.string().trim().min(3).max(500),
    source_note: z.string().trim().min(10).max(8000),
    observed_at: z.string().datetime({ offset: true }),
    terminated: z.literal(true),
    outcome: z.enum(["completed", "failed", "cancelled", "not_executed"]),
    currency: z.literal("HKD"),
    billed_micros: z.string().regex(/^(0|[1-9][0-9]{0,33})$/),
    usage: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("text"),
          input_tokens: safe,
          output_tokens: safe,
        })
        .strict(),
      z
        .object({
          kind: z.literal("image"),
          image_units: z.number().int().min(0).max(1),
        })
        .strict(),
      z
        .object({
          kind: z.literal("input_count"),
          counted_input_tokens: safe.nullable(),
        })
        .strict(),
    ]),
  })
  .strict();
export const providerEvidenceCreate = z
  .object({
    document: providerEvidenceDocument,
    reason: providerReason,
  })
  .strict();
export const providerRequestCommand = z
  .object({
    action: z.enum(["ai.cost.reconcile", "ai.capacity.release"]),
    channel: providerChannel,
    request_id: uuid,
    evidence_id: uuid,
    reason: providerReason,
  })
  .strict();
export const providerTaskSettlement = z
  .object({
    action: z.literal("ai.tasks.settle"),
    task_id: uuid,
    expected_task_version: z.number().int().min(1),
    acknowledge_violation_ids: z
      .array(uuid)
      .max(100)
      .refine((v) => new Set(v).size === v.length, "Duplicate violation"),
    reason: providerReason,
  })
  .strict();
export const providerCommand = z.union([
  providerPolicyPublication,
  providerRequestCommand,
  providerTaskSettlement,
]);
export type ProviderCommand = z.infer<typeof providerCommand>;
export const providerSubmit = z
  .object({ command: providerCommand, preview_id: uuid })
  .strict();
const page = {
  cursor: z.string().min(1).max(4096).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
};
export const providerPage = z.object(page).strict();
export const providerRequestQuery = z
  .object({
    ...page,
    data_mode: providerDataMode.optional(),
    subject_kind: z.enum(["task", "validation"]).optional(),
    operation: z
      .enum([
        "responses",
        "images.generate",
        "images.edit",
        "responses.input_tokens",
      ])
      .optional(),
    state: z
      .enum([
        "prepared",
        "dispatched",
        "completed",
        "unknown",
        "cancelled",
        "denied",
      ])
      .optional(),
    cost_state: z.enum(["known", "unknown", "manually_confirmed"]).optional(),
    capacity_state: z.enum(["held", "released"]).optional(),
    tenant_id: uuid.optional(),
    project_id: uuid.optional(),
    actor_id: uuid.optional(),
    task_id: uuid.optional(),
    validation_id: uuid.optional(),
    capability_version_id: uuid.optional(),
    release_id: uuid.optional(),
    period_from: z.string().datetime({ offset: true }).optional(),
    period_to: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .refine(
    (q) =>
      !q.period_from ||
      !q.period_to ||
      Date.parse(q.period_from) < Date.parse(q.period_to),
    { path: ["period_to"], message: "Select an increasing period" },
  );
export const providerActionPermission = (action: ProviderCommand["action"]) =>
  "admin." + action;
export const providerMode = (demo: boolean) =>
  demo ? ("simulated" as const) : ("configured_services" as const);
