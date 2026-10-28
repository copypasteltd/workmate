import { z } from "zod";
import { canonical, hash, Problem, uuid } from "./lib.js";

export const budgetProtocol = "google-ads-budget/1.0.0";
export const googleIdentifier = z.string().regex(/^[1-9][0-9]{0,19}$/);
export const budgetMicros = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,17})$/)
  .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n);
export const policyBody = z
  .object({
    enabled: z.boolean(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    budget_ids: z
      .array(googleIdentifier)
      .min(1)
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length),
    maximum_average_daily_micros: budgetMicros,
    maximum_change_micros: budgetMicros,
    confirmation: z.enum(["each_operation", "within_policy"]),
    expires_at: z.string().datetime({ offset: true }),
  })
  .strict();
export const budgetPolicyInput = z
  .object({
    expected_version: z.number().int().min(0),
    policy: policyBody,
  })
  .strict();
export const budgetPrepareInput = z
  .object({
    account_id: googleIdentifier,
    budget_id: googleIdentifier,
    new_average_daily_micros: budgetMicros.refine(
      (value) => BigInt(value) > 0n,
    ),
  })
  .strict();
export const budgetProposalInput = budgetPrepareInput
  .extend({
    preview_id: uuid,
    expected_source_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const budgetToolPreview = budgetPrepareInput
  .extend({ connection_id: uuid })
  .strict();
export const budgetToolPrepare = budgetProposalInput
  .extend({ connection_id: uuid })
  .strict();
export const budgetToolRead = z.object({ operation_id: uuid }).strict();
export const budgetDecisionInput = z
  .object({
    expected_version: z.number().int().positive(),
    payload_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    decision: z.enum(["confirm", "reject"]),
  })
  .strict();
export const budgetCloseInput = z
  .object({
    expected_version: z.number().int().positive(),
    observation_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    reason: z.string().trim().min(5).max(1000),
    acknowledge_unknown_attribution: z.literal(true),
  })
  .strict();
export const budgetRevisionInput = z
  .object({ expected_version: z.number().int().positive() })
  .strict();
export const budgetObserveInput = budgetRevisionInput
  .extend({ connection_id: uuid.optional() })
  .strict();
export const googleBudgetSnapshot = z
  .object({
    protocol: z.literal(budgetProtocol),
    account_id: googleIdentifier,
    budget_id: googleIdentifier,
    resource_name: z.string().max(150),
    name: z.string().max(1000),
    currency: z.string().regex(/^[A-Z]{3}$/),
    amount_micros: budgetMicros,
    period: z.literal("DAILY"),
    explicitly_shared: z.literal(false),
    reference_count: z.number().int().min(0).max(1),
    status: z.literal("ENABLED"),
    type: z.literal("STANDARD"),
  })
  .strict()
  .refine(
    (value) =>
      value.resource_name ===
      `customers/${value.account_id}/campaignBudgets/${value.budget_id}`,
  );
export type GoogleBudgetSnapshot = z.infer<typeof googleBudgetSnapshot>;
export type BudgetPolicy = z.infer<typeof policyBody>;

export function checkBudgetPolicy(
  policy: BudgetPolicy,
  snapshot: GoogleBudgetSnapshot,
  desired: string,
  now = Date.now(),
) {
  if (!policy.enabled || Date.parse(policy.expires_at) <= now)
    throw new Problem(
      409,
      "BUDGET_POLICY_DISABLED",
      "The budget policy is disabled or expired",
    );
  if (
    !policy.budget_ids.includes(snapshot.budget_id) ||
    policy.currency !== snapshot.currency
  )
    throw new Problem(
      403,
      "BUDGET_POLICY_SCOPE",
      "This budget or currency is outside the configured policy",
    );
  const next = BigInt(desired),
    current = BigInt(snapshot.amount_micros);
  const delta = next > current ? next - current : current - next;
  if (
    next > BigInt(policy.maximum_average_daily_micros) ||
    delta > BigInt(policy.maximum_change_micros)
  )
    throw new Problem(
      409,
      "BUDGET_POLICY_LIMIT",
      "The proposed average daily budget or change exceeds policy",
    );
}

export function budgetRequest(snapshot: GoogleBudgetSnapshot, desired: string) {
  const amount = budgetMicros.parse(desired);
  return {
    operations: [
      {
        update: { resourceName: snapshot.resource_name, amountMicros: amount },
        updateMask: "amount_micros",
      },
    ],
    partialFailure: false,
    validateOnly: false,
    responseContentType: "MUTABLE_RESOURCE",
  };
}

export const budgetDigest = (value: unknown) => hash(canonical(value));
