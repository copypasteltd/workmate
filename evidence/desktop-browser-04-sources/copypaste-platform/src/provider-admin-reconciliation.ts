import type { Tx } from "./db.js";
import { canonical, hash, Problem } from "./lib.js";
import {
  providerEvidenceDocument,
  type ProviderCommand,
} from "./provider-admin-model.js";
import { requestRow, providerRequestDTO } from "./provider-admin-access.js";
import { taskProviderBudgetReceipt } from "./provider-budgets.js";
import { settle } from "./billing.js";
import { event } from "./tasks.js";

export function assertProviderEvidenceBinding(
  r: any,
  raw: unknown,
  now = Date.now(),
) {
  if (r.state !== "unknown")
    throw new Problem(
      409,
      "PROVIDER_NOT_UNKNOWN",
      "Evidence requires an original unknown observation",
    );
  const d = providerEvidenceDocument.parse(raw),
    u = d.usage;
  if (
    d.data_mode !== r.data_mode ||
    d.operation_id !== r.operation_id ||
    d.request_hash !== r.request_hash ||
    Date.parse(d.observed_at) > now ||
    Date.parse(d.observed_at) < new Date(r.dispatched_at).getTime()
  )
    throw new Problem(
      400,
      "PROVIDER_EVIDENCE_MISMATCH",
      "Evidence must bind the original unknown request and dispatch time",
    );
  const kind = r.channel === "input_count" ? "input_count" : r.request_class;
  if (u.kind !== kind)
    throw new Problem(
      400,
      "PROVIDER_EVIDENCE_MISMATCH",
      "Evidence usage kind differs from the original service",
    );
  return d;
}
/** Exact frozen-rate calculation; an invoice cannot substitute a client charge. */
export function providerEvidenceCost(r: any, raw: unknown, now = Date.now()) {
  const d = assertProviderEvidenceBinding(r, raw, now),
    u = d.usage;
  let input = 0,
    output = 0,
    images = 0,
    counted: number | null = null,
    numerator: bigint;
  if (u.kind === "text") {
    input = u.input_tokens;
    output = u.output_tokens;
    numerator =
      BigInt(input) * BigInt(r.rate_snapshot[0]) +
      BigInt(output) * BigInt(r.rate_snapshot[1]);
  } else if (u.kind === "image") {
    images = u.image_units;
    numerator = BigInt(images) * BigInt(r.rate_snapshot[0]) * 1000000n;
  } else {
    counted = u.counted_input_tokens;
    if (r.price_micros === null)
      throw new Problem(
        409,
        "PROVIDER_PRICE_UNKNOWN",
        "The original counting price was never known",
      );
    numerator =
      d.outcome === "not_executed" ? 0n : BigInt(r.price_micros) * 1000000n;
  }
  if (
    d.outcome === "not_executed" &&
    (input !== 0 ||
      output !== 0 ||
      images !== 0 ||
      counted !== null ||
      numerator !== 0n)
  )
    throw new Problem(
      409,
      "PROVIDER_EVIDENCE_MISMATCH",
      "A not-executed claim requires explicitly absent usage",
    );
  const amount = (numerator + 999999n) / 1000000n;
  if (amount !== BigInt(d.billed_micros))
    throw new Problem(
      409,
      "PROVIDER_PRICE_MISMATCH",
      "Invoice amount differs from original frozen pricing; resolve the discrepancy first",
    );
  return {
    numerator: numerator.toString(),
    amount_micros: amount.toString(),
    input_tokens: input,
    output_tokens: output,
    image_units: images,
    counted_input_tokens: counted,
  };
}
export async function inspectProviderRequestCommand(
  tx: Tx,
  b: Extract<ProviderCommand, { request_id: string }>,
) {
  const r = await requestRow(tx, b.channel, b.request_id, true);
  const e = (
    await tx.query("SELECT * FROM ai_provider_evidence WHERE id=$1", [
      b.evidence_id,
    ])
  ).rows[0];
  if (
    !e ||
    e.data_mode !== r.data_mode ||
    e.provider_request_id !== (r.channel === "generation" ? r.id : null) ||
    e.count_request_id !== (r.channel === "input_count" ? r.id : null)
  )
    throw new Problem(404, "NOT_FOUND", "Evidence not found for this request");
  if (r.state !== "unknown")
    throw new Problem(
      409,
      "PROVIDER_NOT_UNKNOWN",
      "Only original unknown observations require human reconciliation",
    );
  if (
    (b.action === "ai.cost.reconcile" && r.cost_confirmation_id) ||
    (b.action === "ai.capacity.release" && r.termination_confirmation_id)
  )
    throw new Problem(
      409,
      "PROVIDER_ALREADY_CONFIRMED",
      "This fact was already independently confirmed",
    );
  // Cost and capacity have independent facts: invoice price is not a prerequisite
  // for validating a termination claim. The evidence remains inspectable in both.
  const d = providerEvidenceDocument.parse(e.document);
  if (
    d.data_mode !== r.data_mode ||
    d.operation_id !== r.operation_id ||
    d.request_hash !== r.request_hash ||
    !d.terminated
  )
    throw new Problem(
      409,
      "PROVIDER_EVIDENCE_MISMATCH",
      "Evidence identity differs from the request",
    );
  const cost =
    b.action === "ai.cost.reconcile" ? providerEvidenceCost(r, d) : null;
  return {
    scope: {
      data_mode: r.data_mode,
      tenant_id: r.tenant_id,
      project_id: r.project_id,
    },
    request: providerRequestDTO(r, true),
    evidence: {
      id: e.id,
      document_hash: e.document_hash,
      document: e.document,
      actor_id: e.actor_id,
      reason: e.reason,
    },
    cost,
  };
}
export async function applyProviderRequestCommand(
  tx: Tx,
  op: any,
  c: Awaited<ReturnType<typeof inspectProviderRequestCommand>>,
  reviewer: string,
) {
  const r = c.request,
    generation = r.channel === "generation";
  const common = [
    generation ? r.id : null,
    generation ? null : r.id,
    c.evidence.id,
    r.data_mode,
    op.id,
    op.principal_id,
    reviewer,
  ];
  const table =
    op.action === "ai.cost.reconcile"
      ? "ai_provider_cost_confirmations"
      : "ai_provider_termination_confirmations";
  const cost = c.cost;
  const saved = (
    await tx.query(
      `INSERT INTO ${table}(provider_request_id,count_request_id,evidence_id,data_mode,operation_id,actor_id,reviewer_id${cost ? ",charge_numerator,input_tokens,output_tokens,image_units,counted_input_tokens" : ""})
    VALUES(${common.map((_, i) => "$" + (i + 1)).join(",")}${cost ? ",$8,$9,$10,$11,$12" : ""}) RETURNING id`,
      [
        ...common,
        ...(cost
          ? [
              cost.numerator,
              cost.input_tokens,
              cost.output_tokens,
              cost.image_units,
              cost.counted_input_tokens,
            ]
          : []),
      ],
    )
  ).rows[0];
  if (cost && generation) {
    const a = (
      await tx.query(
        "SELECT * FROM ai_request_budget_allocations WHERE provider_request_id=$1",
        [r.id],
      )
    ).rows[0];
    if (a) {
      const code =
        a.input_tokens_bound !== null &&
        BigInt(cost.input_tokens) !== BigInt(a.input_tokens_bound)
          ? "INPUT_COUNT_MISMATCH"
          : a.max_output_tokens !== null &&
              cost.output_tokens > a.max_output_tokens
            ? "OUTPUT_LIMIT_EXCEEDED"
            : BigInt(cost.numerator) > BigInt(a.amount_numerator)
              ? "ALLOCATION_EXCEEDED"
              : null;
      if (code)
        await tx.query(
          "INSERT INTO ai_request_budget_violations(provider_request_id,envelope_id,code) VALUES($1,$2,$3) ON CONFLICT(provider_request_id) DO NOTHING",
          [r.id, a.envelope_id, code],
        );
    }
  }
  return {
    request_id: r.id,
    channel: r.channel,
    confirmation_id: saved.id,
    evidence_id: c.evidence.id,
    ...(cost ? { cost } : {}),
    original_state_preserved: "unknown",
  };
}
export async function inspectProviderTaskSettlement(
  tx: Tx,
  b: Extract<ProviderCommand, { action: "ai.tasks.settle" }>,
) {
  const t = (
    await tx.query(
      "SELECT * FROM tasks WHERE id=$1 AND data_mode=current_setting('app.data_mode') FOR UPDATE",
      [b.task_id],
    )
  ).rows[0];
  if (!t) throw new Problem(404, "NOT_FOUND", "Task not found");
  if (t.status !== "reconciling" || t.version !== b.expected_task_version)
    throw new Problem(
      409,
      "TASK_CHANGED",
      "Reload the task awaiting reconciliation",
    );
  const reservation = (
    await tx.query("SELECT * FROM reservations WHERE task_id=$1 FOR UPDATE", [
      t.id,
    ])
  ).rows[0];
  if (!reservation || !["reserved", "reconciling"].includes(reservation.status))
    throw new Problem(
      409,
      "RESERVATION_CHANGED",
      "Original task reservation is unavailable",
    );
  const all = (
    await tx.query(
      "SELECT * FROM current_ai_provider_requests WHERE task_id=$1 ORDER BY created_at,id,channel",
      [t.id],
    )
  ).rows;
  const receipt = await taskProviderBudgetReceipt(tx, t.id);
  if (
    !receipt.requests ||
    receipt.uncertain ||
    all.some(
      (r) =>
        r.state === "dispatched" ||
        (r.state === "unknown" && r.cost_state === "unknown") ||
        (r.state === "prepared" && r.capacity_held),
    )
  )
    throw new Problem(
      409,
      "PROVIDER_COST_UNKNOWN",
      "Confirm every relevant call before settling the original task",
    );
  if (
    (
      await tx.query(
        `SELECT 1 FROM tool_operations o WHERE task_id=$1
    AND (o.charge_micros>0 OR o.state IN ('accepted','reconciling')) AND NOT EXISTS(
    SELECT 1 FROM current_ai_provider_requests g WHERE g.task_id=o.task_id AND g.channel='generation' AND g.operation_id=o.id::text AND g.cost_state<>'unknown') LIMIT 1`,
        [t.id],
      )
    ).rowCount
  )
    throw new Problem(
      409,
      "UNMAPPED_TOOL_COST",
      "Resolve unassigned tool costs before task settlement",
    );
  const violations = (
    await tx.query(
      "SELECT x.id,x.code FROM ai_request_budget_violations x JOIN ai_gateway_requests r ON r.id=x.provider_request_id WHERE r.task_id=$1 ORDER BY x.id",
      [t.id],
    )
  ).rows;
  if (
    canonical(violations.map((r) => r.id).sort()) !==
    canonical([...b.acknowledge_violation_ids].sort())
  )
    throw new Problem(
      409,
      "VIOLATIONS_CHANGED",
      "Explicitly acknowledge the current immutable budget violations",
    );
  if (BigInt(receipt.knownChargeMicros) > BigInt(reservation.amount_micros))
    throw new Problem(
      409,
      "RESERVATION_EXCEEDED",
      "Observed cost exceeds the original authorized budget; resolve the difference separately",
    );
  const facts = all.map((r) => ({
    id: r.id,
    channel: r.channel,
    state: r.state,
    cost_state: r.cost_state,
    numerator: r.effective_numerator,
    cost_confirmation_id: r.cost_confirmation_id,
  }));
  return {
    scope: { data_mode: t.data_mode, tenant_id: t.tenant_id, project_id: null },
    task: {
      id: t.id,
      version: t.version,
      status: t.status,
      created_by: t.created_by,
    },
    reservation: {
      id: reservation.id ?? null,
      status: reservation.status,
      amount_micros: reservation.amount_micros,
    },
    receipt,
    violations,
    facts,
    receipt_hash: hash(canonical(facts)),
  };
}
export async function applyProviderTaskSettlement(
  tx: Tx,
  op: any,
  c: Awaited<ReturnType<typeof inspectProviderTaskSettlement>>,
  reviewer: string,
) {
  await settle(
    tx,
    c.scope.tenant_id!,
    c.task.id,
    c.receipt.knownChargeMicros,
    c.task.created_by,
  );
  const actual = (
    await tx.query("SELECT status FROM reservations WHERE task_id=$1", [
      c.task.id,
    ])
  ).rows[0];
  if (!["settled", "released"].includes(actual.status))
    throw new Problem(
      409,
      "SETTLEMENT_INCOMPLETE",
      "The original hold could not be settled",
    );
  const charge = (
    await tx.query("SELECT id FROM ledger WHERE task_id=$1 AND kind='charge'", [
      c.task.id,
    ])
  ).rows[0];
  const record = (
    await tx.query(
      `INSERT INTO ai_provider_task_settlements(task_id,data_mode,receipt_hash,amount_micros,reservation_micros,charge_id,operation_id,actor_id,reviewer_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        c.task.id,
        c.scope.data_mode,
        c.receipt_hash,
        c.receipt.knownChargeMicros,
        c.reservation.amount_micros,
        charge?.id ?? null,
        op.id,
        op.principal_id,
        reviewer,
      ],
    )
  ).rows[0];
  await tx.query(
    "UPDATE tasks SET status='failed',error_code='PROVIDER_COST_RECONCILED',input_tokens=$2,output_tokens=$3,version=version+1 WHERE id=$1",
    [c.task.id, c.receipt.inputTokens, c.receipt.outputTokens],
  );
  await event(tx, c.scope.tenant_id!, c.task.id, "billing.reconciled", {
    actual_micros: c.receipt.knownChargeMicros,
    reason: op.payload.command.reason,
    settlement_id: record.id,
  });
  return {
    task_id: c.task.id,
    settlement_id: record.id,
    actual_micros: String(c.receipt.knownChargeMicros),
    charge_id: charge?.id ?? null,
    business_status: "failed",
  };
}
