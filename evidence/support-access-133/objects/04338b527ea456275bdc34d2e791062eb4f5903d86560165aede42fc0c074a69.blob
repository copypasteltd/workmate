import type { Tx, Database } from "./db.js";
import { gatewayFingerprint } from "./capability-bindings.js";
import { canonical, hash, Problem } from "./lib.js";
import {
  providerPolicyDefinition,
  type ProviderCommand,
} from "./provider-admin-model.js";
import { modeOf } from "./provider-admin-access.js";

export async function providerLock(tx: Tx, mode: string) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    "ai-gateway:" + mode,
  ]);
}
export async function currentProviderPolicy(tx: Tx, db: Database) {
  const mode = modeOf(db);
  await providerLock(tx, mode);
  const limits = (
    await tx.query(
      "SELECT p.* FROM ai_gateway_policy_heads h JOIN ai_gateway_policy_versions p ON p.id=h.policy_version_id WHERE h.data_mode=$1",
      [mode],
    )
  ).rows[0];
  const budget = (
    await tx.query(
      "SELECT p.* FROM ai_provider_budget_heads h JOIN ai_provider_budget_policies p ON p.id=h.policy_id WHERE h.data_mode=$1",
      [mode],
    )
  ).rows[0];
  const head = (
    await tx.query("SELECT * FROM ai_provider_admin_heads WHERE data_mode=$1", [
      mode,
    ])
  ).rows[0];
  const periods = (
    await tx.query(
      "SELECT id,purpose,utc_day::text,amount_micros::text,policy_id FROM ai_platform_budget_periods WHERE data_mode=$1 AND utc_day=(clock_timestamp() AT TIME ZONE 'UTC')::date ORDER BY purpose",
      [mode],
    )
  ).rows;
  return {
    data_mode: mode,
    gateway_fingerprint: gatewayFingerprint(db.config),
    revision: head?.revision ?? 0,
    publication_id: head?.publication_id ?? null,
    limits,
    budget,
    periods,
  };
}
export async function inspectProviderPolicy(
  tx: Tx,
  db: Database,
  b: Extract<ProviderCommand, { action: "ai.policy.publish" }>,
) {
  const current = await currentProviderPolicy(tx, db);
  const draft = (
    await tx.query(
      "SELECT * FROM ai_provider_policy_drafts WHERE id=$1 AND data_mode=$2",
      [b.draft_id, modeOf(db)],
    )
  ).rows[0];
  if (!draft)
    throw new Problem(404, "NOT_FOUND", "Provider policy draft not found");
  if (current.revision !== b.expected_revision)
    throw new Problem(
      409,
      "VERSION_CONFLICT",
      "Reload current provider policy",
    );
  if (draft.gateway_fingerprint !== gatewayFingerprint(db.config))
    throw new Problem(
      409,
      "PROVIDER_GATEWAY_CHANGED",
      "Recreate and review the gateway contract",
    );
  const definition = providerPolicyDefinition.parse(draft.definition);
  if (
    definition.budget.count_verified &&
    Date.parse(definition.count_contract!.effective_at) > Date.now()
  )
    throw new Problem(
      409,
      "CONTRACT_NOT_EFFECTIVE",
      "The counting contract is not effective yet",
    );
  if (
    (
      await tx.query(
        "SELECT 1 FROM ai_provider_admin_publications WHERE draft_id=$1",
        [draft.id],
      )
    ).rowCount
  )
    throw new Problem(
      409,
      "POLICY_ALREADY_PUBLISHED",
      "This immutable policy was already published",
    );
  return {
    scope: { data_mode: modeOf(db), tenant_id: null, project_id: null },
    draft,
    current,
    definition,
  };
}
export async function applyProviderPolicy(
  tx: Tx,
  op: any,
  checked: Awaited<ReturnType<typeof inspectProviderPolicy>>,
  reviewer: string,
) {
  const { current, draft, definition } = checked,
    mode = current.data_mode;
  const keys = Object.keys(definition.limits),
    values = Object.values(definition.limits);
  const policy = (
    await tx.query(
      `INSERT INTO ai_gateway_policy_versions(data_mode,version,${keys.join(",")},created_by,reason)
    VALUES($1,(SELECT coalesce(max(version),0)+1 FROM ai_gateway_policy_versions WHERE data_mode=$1),${values.map((_, i) => "$" + (i + 2)).join(",")},$${values.length + 2},$${values.length + 3}) RETURNING id`,
      [mode, ...values, op.principal_id, op.payload.command.reason],
    )
  ).rows[0];
  const budget = definition.budget;
  const bp = (
    await tx.query(
      `INSERT INTO ai_provider_budget_policies(data_mode,fingerprint,count_verified,count_price_micros,verification_run_micros,verification_daily_micros,counting_daily_micros,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        mode,
        hash(
          canonical({
            draft_id: draft.id,
            gateway: draft.gateway_fingerprint,
            definition,
          }),
        ),
        budget.count_verified,
        budget.count_price_micros,
        budget.verification_run_micros,
        budget.verification_daily_micros,
        budget.counting_daily_micros,
        op.payload.command.reason,
      ],
    )
  ).rows[0];
  const pub = (
    await tx.query(
      `INSERT INTO ai_provider_admin_publications(data_mode,draft_id,policy_version_id,budget_policy_id,previous_policy_version_id,previous_budget_policy_id,operation_id,actor_id,reviewer_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        mode,
        draft.id,
        policy.id,
        bp.id,
        current.limits.id,
        current.budget.id,
        op.id,
        op.principal_id,
        reviewer,
      ],
    )
  ).rows[0];
  await tx.query(
    "UPDATE ai_gateway_policy_heads SET policy_version_id=$2 WHERE data_mode=$1",
    [mode, policy.id],
  );
  await tx.query(
    "UPDATE ai_provider_budget_heads SET policy_id=$2 WHERE data_mode=$1",
    [mode, bp.id],
  );
  await tx.query(
    "INSERT INTO ai_provider_admin_heads(data_mode,publication_id,revision) VALUES($1,$2,1) ON CONFLICT(data_mode) DO UPDATE SET publication_id=excluded.publication_id,revision=ai_provider_admin_heads.revision+1",
    [mode, pub.id],
  );
  return {
    publication_id: pub.id,
    draft_id: draft.id,
    policy_version_id: policy.id,
    budget_policy_id: bp.id,
    revision: current.revision + 1,
  };
}
