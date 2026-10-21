import type { Database, Tx } from "./db.js";
import { hash } from "./lib.js";
import { gatewayFingerprint } from "./capability-bindings.js";

/** Counting is explicitly priced; an omitted price never means free service. */
export async function seedProviderBudgetPolicy(db: Database) {
  const c = db.config;
  const mode = c.DEMO_MODE ? "simulated" : "configured_services";
  const facts = {
    gateway: gatewayFingerprint(c),
    verified:
      c.AI_INPUT_COUNT_VERIFIED &&
      c.AI_INPUT_COUNT_HKD_MICROS_PER_CALL !== undefined,
    price: c.AI_INPUT_COUNT_HKD_MICROS_PER_CALL ?? null,
    run: c.AI_VERIFICATION_PER_RUN_BUDGET_MICROS,
    verification: c.AI_PLATFORM_VERIFICATION_DAILY_BUDGET_MICROS,
    count: c.AI_PLATFORM_COUNT_DAILY_BUDGET_MICROS,
  };
  await db.tx(
    async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "ai-gateway:" + mode,
      ]);
      if (
        (
          await tx.query(
            "SELECT 1 FROM ai_provider_admin_heads WHERE data_mode=$1",
            [mode],
          )
        ).rowCount
      )
        return; // An independently published policy owns the head after installation.
      await tx.query(
        `INSERT INTO ai_provider_budget_policies(data_mode,fingerprint,count_verified,count_price_micros,
      verification_run_micros,verification_daily_micros,counting_daily_micros,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,'Server configured provider budget policy') ON CONFLICT(data_mode,fingerprint) DO NOTHING`,
        [
          mode,
          hash(JSON.stringify(facts)),
          facts.verified,
          facts.price,
          facts.run,
          facts.verification,
          facts.count,
        ],
      );
      await tx.query(
        `INSERT INTO ai_provider_budget_heads(data_mode,policy_id)
      SELECT data_mode,id FROM ai_provider_budget_policies WHERE data_mode=$1 AND fingerprint=$2
      ON CONFLICT(data_mode) DO UPDATE SET policy_id=excluded.policy_id`,
        [mode, hash(JSON.stringify(facts))],
      );
    },
    undefined,
    true,
  );
}

export interface ProviderBudgetReceipt {
  requests: number;
  knownChargeMicros: number;
  inputTokens: number;
  outputTokens: number;
  uncertain: boolean;
  violation: boolean;
}

/** Verification is platform funded, including its explicit counting fees. */
export async function validationProviderBudgetReceipt(
  db: Database,
  validationId: string,
) {
  return db.tx(
    async (tx) => {
      const r = (
        await tx.query(
          `SELECT count(*)::integer AS requests,
      count(*) FILTER(WHERE dispatched_at IS NOT NULL)::integer AS dispatched,
      coalesce(sum(effective_numerator) FILTER(WHERE cost_state<>'unknown'),0)::text AS numerator,
      coalesce(bool_or(state='dispatched' OR (state='unknown' AND cost_state='unknown')),false) AS uncertain,
      EXISTS(SELECT 1 FROM ai_request_budget_violations x JOIN ai_gateway_requests g ON g.id=x.provider_request_id WHERE g.validation_id=$1) AS violation
      FROM current_ai_provider_requests WHERE validation_id=$1`,
          [validationId],
        )
      ).rows[0];
      const charge = Number((BigInt(r.numerator) + 999_999n) / 1_000_000n);
      if (!Number.isSafeInteger(charge))
        throw new Error("Verification cost exceeds safe billing amounts");
      return { ...r, knownChargeMicros: charge };
    },
    undefined,
    true,
  );
}

/** One aggregate rounding, excluding all platform-funded task counting fees. */
export async function taskProviderBudgetReceipt(
  tx: Tx,
  taskId: string,
): Promise<ProviderBudgetReceipt> {
  const r = (
    await tx.query("SELECT task_ai_budget_receipt($1) AS receipt", [taskId])
  ).rows[0].receipt;
  const numerator = BigInt(r.numerator);
  const charge = Number((numerator + 999_999n) / 1_000_000n);
  if (
    !Number.isSafeInteger(charge) ||
    !Number.isSafeInteger(Number(r.input_tokens)) ||
    !Number.isSafeInteger(Number(r.output_tokens))
  )
    throw new Error("Provider budget receipt exceeds safe billing amounts");
  return {
    requests: r.requests,
    knownChargeMicros: charge,
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    uncertain: r.uncertain,
    violation: r.violation,
  };
}
