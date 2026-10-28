import { randomUUID } from "node:crypto";
import type { Tx } from "./db.js";
import type { Principal } from "./auth.js";
import { billingAccount } from "./billing.js";
import { billingEvent } from "./billing-events.js";
import { paymentEvidence, paymentRecord } from "./payment-records.js";
import { Problem } from "./lib.js";

export type RefundCommand = {
  action: "refund";
  amount: { currency: "HKD"; amount_micros: string };
  original_entry_id: string;
  destination: "paid_balance" | "payment_method";
  expected_version: number;
  reason: string;
};
type Part = {
  source_id: string;
  repayment_part_id: string | null;
  restored_lot_id: string | null;
  kind: "paid" | "gift" | "credit";
  amount_micros: string;
  expires_at: string | null;
  expired: boolean;
};
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const range = (v: bigint) => {
  if (v > 9223372036854775807n)
    throw new Problem(
      409,
      "AMOUNT_RANGE",
      "The refunded balance exceeds the supported range",
    );
};
export async function inspectRefund(
  tx: Tx,
  w: any,
  b: RefundCommand,
  effectiveBalance: bigint,
) {
  const entry = (
    await tx.query(
      "SELECT * FROM billing_journal WHERE id=$1 AND billing_account_id=$2",
      [b.original_entry_id, w.id],
    )
  ).rows[0];
  const amount = BigInt(b.amount.amount_micros);
  if (!entry || !entry.raw_entry_id)
    throw new Problem(
      409,
      "INVALID_REFUND_SOURCE",
      "Choose the original recorded consumption or verified payment in this account",
    );
  const original = {
    id: entry.id,
    raw_entry_id: entry.raw_entry_id,
    kind: entry.kind,
    amount_micros: entry.amount_micros,
  };
  if (b.destination === "payment_method") {
    if (entry.kind !== "top_up" || !entry.payment_record_id)
      throw new Problem(
        409,
        "CONFIRMED_PAYMENT_REQUIRED",
        "Cash refunds require the original independently verified payment",
      );
    const p = await paymentRecord(tx, entry.payment_record_id);
    if (
      !p?.verified_by ||
      p.ledger_id !== entry.raw_entry_id ||
      p.billing_account_id !== w.id ||
      p.data_mode !== w.data_mode
    )
      throw new Problem(
        409,
        "CONFIRMED_PAYMENT_REQUIRED",
        "The original payment and actual posting must match this account",
      );
    const evidence = await paymentEvidence(tx, w, p.evidence_asset_version_id);
    if (evidence.sha256 !== p.evidence_sha256)
      throw new Problem(
        409,
        "PAYMENT_EVIDENCE_CHANGED",
        "Original payment evidence has changed",
      );
    const lot = (
      await tx.query(
        "SELECT * FROM funding_lots WHERE billing_account_id=$1 AND ledger_id=$2 AND kind='paid'",
        [w.id, entry.raw_entry_id],
      )
    ).rows[0];
    const already = (
      await tx.query(
        "SELECT coalesce((SELECT sum(-amount_micros) FROM ledger WHERE billing_account_id=$1 AND source_id=$2 AND kind='refund'),0)::text AS paid,coalesce((SELECT sum(r.amount_micros-coalesce((SELECT sum(e.observed_amount_micros) FROM billing_refund_events e WHERE e.refund_id=r.id AND e.outcome='paid'),0)) FROM billing_refunds r WHERE r.original_entry_id=$3 AND r.destination='payment_method' AND NOT EXISTS(SELECT 1 FROM billing_refund_events e WHERE e.refund_id=r.id AND e.outcome='not_paid')),0)::text AS held",
        [w.id, entry.raw_entry_id, entry.id],
      )
    ).rows[0];
    const refundable =
      BigInt(entry.amount_micros) - BigInt(already.paid) - BigInt(already.held);
    if (
      !lot ||
      amount > refundable ||
      amount > BigInt(lot.remaining_micros) - BigInt(lot.reserved_micros) ||
      amount > effectiveBalance - BigInt(w.reserved_micros)
    )
      throw new Problem(
        409,
        "REFUND_FUNDS_UNAVAILABLE",
        "Cash refunds cannot use spent, reserved, already refunded or credit-backed funds",
      );
    return {
      original,
      parts: [] as Part[],
      net_credit_micros: "0",
      cash: {
        payment_record_id: p.id,
        payment_evidence_sha256: evidence.sha256,
        lot_id: lot.id,
        remaining_micros: lot.remaining_micros,
        reserved_micros: lot.reserved_micros,
        refundable_micros: refundable.toString(),
        paid_micros: already.paid,
        held_micros: already.held,
      },
    };
  }
  if (entry.kind !== "consume" || entry.direction !== "debit")
    throw new Problem(
      409,
      "CONSUMPTION_REQUIRED",
      "A product-balance refund must reference its original consumption",
    );
  const sources = (
    await tx.query(
      "SELECT s.*,f.expires_at,(f.kind='gift' AND f.expires_at<=now()) AS expired,coalesce((SELECT sum(p.amount_micros) FROM billing_refund_source_parts p WHERE p.source_id=s.id),0)::text AS refunded FROM billing_settlement_sources s LEFT JOIN funding_lots f ON f.id=s.lot_id WHERE s.billing_account_id=$1 AND s.charge_id=$2 ORDER BY CASE s.kind WHEN 'gift' THEN 0 WHEN 'paid' THEN 1 ELSE 2 END,f.expires_at ASC NULLS LAST,s.created_at,s.id",
      [w.id, entry.raw_entry_id],
    )
  ).rows;
  if (
    sources.reduce((n, s) => n + BigInt(s.amount_micros), 0n) !==
    BigInt(entry.amount_micros)
  )
    throw new Problem(
      409,
      "REFUND_RECONCILIATION_REQUIRED",
      "This historical charge has no complete recorded funding allocation",
    );
  const refunded = sources.reduce((n, s) => n + BigInt(s.refunded), 0n);
  if (refunded + amount > BigInt(entry.amount_micros))
    throw new Problem(
      409,
      "REFUND_LIMIT_EXCEEDED",
      "Cumulative refunds cannot exceed the original consumption",
    );
  const parts: Part[] = [];
  let remaining = amount;
  for (const s of sources) {
    if (!remaining) break;
    const available = BigInt(s.amount_micros) - BigInt(s.refunded),
      take = min(remaining, available);
    if (!take) continue;
    if (s.kind !== "credit") {
      parts.push({
        source_id: s.id,
        repayment_part_id: null,
        restored_lot_id: s.lot_id,
        kind: s.kind,
        amount_micros: take.toString(),
        expires_at: s.expires_at?.toISOString() ?? null,
        expired: !!s.expired,
      });
    } else {
      if (
        (
          await tx.query(
            "SELECT 1 FROM billing_credit_legacy_sources WHERE source_id=$1",
            [s.id],
          )
        ).rowCount
      )
        throw new Problem(
          409,
          "REFUND_RECONCILIATION_REQUIRED",
          "Historical credit repayments were not recorded per charge; reconcile the original facts before refunding",
        );
      const repaid = (
        await tx.query(
          "SELECT p.*,f.id AS lot_id,f.kind,f.expires_at,(f.kind='gift' AND f.expires_at<=now()) AS expired,coalesce((SELECT sum(r.amount_micros) FROM billing_refund_source_parts r WHERE r.repayment_part_id=p.id),0)::text AS returned FROM billing_credit_repayment_parts p JOIN funding_lots f ON f.ledger_id=p.funding_entry_id WHERE p.credit_source_id=$1 ORDER BY p.created_at,p.id",
          [s.id],
        )
      ).rows;
      const cancelled = BigInt(
        (
          await tx.query(
            "SELECT coalesce(sum(amount_micros),0)::text AS n FROM billing_credit_refund_cancellations WHERE credit_source_id=$1",
            [s.id],
          )
        ).rows[0].n,
      );
      const unpaid =
        BigInt(s.amount_micros) -
        cancelled -
        repaid.reduce((n, p) => n + BigInt(p.amount_micros), 0n);
      if (unpaid < 0n)
        throw new Problem(
          409,
          "REFUND_RECONCILIATION_REQUIRED",
          "Credit repayment history does not balance",
        );
      let needed = take;
      const cancel = min(needed, unpaid);
      if (cancel) {
        parts.push({
          source_id: s.id,
          repayment_part_id: null,
          restored_lot_id: null,
          kind: "credit",
          amount_micros: cancel.toString(),
          expires_at: null,
          expired: false,
        });
        needed -= cancel;
      }
      for (const p of repaid) {
        const returned = min(
          needed,
          BigInt(p.amount_micros) - BigInt(p.returned),
        );
        if (returned) {
          parts.push({
            source_id: s.id,
            repayment_part_id: p.id,
            restored_lot_id: p.lot_id,
            kind: p.kind,
            amount_micros: returned.toString(),
            expires_at: p.expires_at?.toISOString() ?? null,
            expired: !!p.expired,
          });
          needed -= returned;
        }
        if (!needed) break;
      }
      if (needed)
        throw new Problem(
          409,
          "REFUND_RECONCILIATION_REQUIRED",
          "The original credit refund cannot be fully attributed",
        );
    }
    remaining -= take;
  }
  if (remaining)
    throw new Problem(
      409,
      "REFUND_RECONCILIATION_REQUIRED",
      "The refund cannot be allocated to recorded sources",
    );
  const net = parts.reduce(
    (n, p) => n + (p.expired ? 0n : BigInt(p.amount_micros)),
    0n,
  );
  range(effectiveBalance + net);
  return {
    original,
    parts,
    net_credit_micros: net.toString(),
    cash: null,
    refunded_micros: refunded.toString(),
  };
}
export async function applyRefund(
  tx: Tx,
  w: any,
  b: RefundCommand,
  checked: Awaited<ReturnType<typeof inspectRefund>>,
  op: any,
  p: Principal,
) {
  const id = randomUUID(),
    amount = BigInt(b.amount.amount_micros);
  await billingAccount(tx, w.id);
  const actor = { actor_id: p.id, admin_operation_id: op.id };
  let hold: string | null = null;
  if (checked.cash) {
    hold = await billingEvent(tx, w.id, {
      action: "billing.refund",
      kind: "reserve",
      direction: "credit",
      bucket: "reserved",
      amount,
      reason: b.reason,
      source_entry_id: checked.original.id,
      actor,
    });
  }
  await tx.query(
    "INSERT INTO billing_refunds(id,billing_account_id,operation_id,original_entry_id,destination,amount_micros,payment_record_id,lot_id,hold_journal_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [
      id,
      w.id,
      op.id,
      checked.original.id,
      b.destination,
      b.amount.amount_micros,
      checked.cash?.payment_record_id ?? null,
      checked.cash?.lot_id ?? null,
      hold,
      p.id,
    ],
  );
  if (checked.cash) {
    await tx.query(
      "UPDATE funding_lots SET reserved_micros=reserved_micros+$2 WHERE id=$1",
      [checked.cash.lot_id, b.amount.amount_micros],
    );
    await tx.query(
      "UPDATE wallets SET reserved_micros=reserved_micros+$2,version=version+1 WHERE id=$1",
      [w.id, b.amount.amount_micros],
    );
    return { id, state: "reconciling" as const };
  }
  for (const part of checked.parts) {
    let cancellation: string | null = null;
    if (part.kind === "credit") {
      cancellation = (
        await tx.query(
          "INSERT INTO billing_credit_refund_cancellations(billing_account_id,credit_source_id,refund_operation_id,amount_micros) VALUES($1,$2,$3,$4) RETURNING id",
          [w.id, part.source_id, op.id, part.amount_micros],
        )
      ).rows[0].id;
    }
    const journal = await billingEvent(tx, w.id, {
      action: "billing.refund",
      kind: "compensation",
      direction: "credit",
      bucket:
        part.kind === "gift"
          ? "promotional"
          : part.kind === "credit"
            ? "credit_limit"
            : "paid",
      amount: BigInt(part.amount_micros),
      reason: b.reason,
      source_entry_id: checked.original.id,
      actor,
    });
    let expiry: string | null = null;
    if (part.expired) {
      expiry = await billingEvent(tx, w.id, {
        action: "billing.refund",
        kind: "gift_expiry",
        direction: "debit",
        bucket: "promotional",
        amount: BigInt(part.amount_micros),
        reason: "Original promotional credit was already expired when refunded",
        source_entry_id: journal,
        actor,
      });
    } else if (part.restored_lot_id) {
      await tx.query(
        "UPDATE funding_lots SET remaining_micros=remaining_micros+$2 WHERE id=$1",
        [part.restored_lot_id, part.amount_micros],
      );
    }
    await tx.query(
      "INSERT INTO billing_refund_source_parts(refund_id,billing_account_id,source_id,repayment_part_id,cancellation_id,restored_lot_id,amount_micros,journal_id,expiry_journal_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        id,
        w.id,
        part.source_id,
        part.repayment_part_id,
        cancellation,
        part.restored_lot_id,
        part.amount_micros,
        journal,
        expiry,
      ],
    );
  }
  await tx.query(
    "UPDATE wallets SET balance_micros=balance_micros+$2,version=version+1 WHERE id=$1",
    [w.id, checked.net_credit_micros],
  );
  await billingAccount(tx, w.id);
  return { id, state: "succeeded" as const };
}
