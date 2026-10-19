import type { Tx } from "./db.js";
import { Problem } from "./lib.js";

const min = (a: bigint, b: bigint) => (a < b ? a : b);
function exactAmount(value: number, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1))
    throw new Problem(500, "INVALID_USAGE", "Invalid integer amount");
  return BigInt(value);
}
async function balanceState(tx: Tx, tenant: string) {
  const w = (
    await tx.query(
      "SELECT w.*,(coalesce((SELECT sum(remaining_micros) FROM funding_lots WHERE tenant_id=w.tenant_id),0)-w.balance_micros)::text AS debt_micros FROM wallets w WHERE tenant_id=$1",
      [tenant],
    )
  ).rows[0];
  if (BigInt(w.debt_micros) < 0n)
    throw new Problem(
      409,
      "BILLING_RECONCILIATION_REQUIRED",
      "Funding sources do not cover the recorded balance",
    );
  return w;
}

// All amounts are exact integer HKD micros; locks serialize every balance mutation per tenant.
export async function wallet(tx: Tx, tenant: string) {
  const w = (
    await tx.query("SELECT * FROM wallets WHERE tenant_id=$1 FOR UPDATE", [
      tenant,
    ])
  ).rows[0];
  if (!w)
    throw new Problem(
      404,
      "WALLET_NOT_FOUND",
      "Workspace billing account not found",
    );
  await balanceState(tx, tenant);
  const expired = await tx.query(
    "SELECT *,remaining_micros-reserved_micros AS free FROM funding_lots WHERE tenant_id=$1 AND expires_at<=now() AND remaining_micros>reserved_micros FOR UPDATE",
    [tenant],
  );
  for (const lot of expired.rows) {
    const amount = BigInt(lot.free);
    await tx.query(
      "INSERT INTO ledger(tenant_id,kind,amount_micros,source_id,idempotency_key,reason) VALUES($1,'gift_expiry',$2,$3,$4,'Gift credit expired')",
      [
        tenant,
        (-amount).toString(),
        lot.ledger_id,
        `expire:${lot.id}:${lot.remaining_micros}`,
      ],
    );
    await tx.query(
      "UPDATE funding_lots SET remaining_micros=reserved_micros WHERE id=$1",
      [lot.id],
    );
    await tx.query(
      "UPDATE wallets SET balance_micros=balance_micros-$2,version=version+1 WHERE tenant_id=$1",
      [tenant, amount.toString()],
    );
  }
  return balanceState(tx, tenant);
}
export async function reserve(
  tx: Tx,
  tenant: string,
  task: string,
  amount: number,
) {
  const hold = exactAmount(amount);
  const w = await wallet(tx, tenant);
  if (
    BigInt(w.balance_micros) +
      BigInt(w.credit_limit_micros) -
      BigInt(w.reserved_micros) <
    hold
  )
    throw new Problem(
      402,
      "INSUFFICIENT_CREDIT",
      "可用額度不足，請聯絡管理員 / Insufficient available credit",
    );
  await tx.query(
    "INSERT INTO reservations(task_id,tenant_id,amount_micros) VALUES($1,$2,$3)",
    [task, tenant, hold.toString()],
  );
  const lots = (
    await tx.query(
      "SELECT * FROM funding_lots WHERE tenant_id=$1 AND remaining_micros>reserved_micros AND (expires_at IS NULL OR expires_at>now()) ORDER BY expires_at ASC NULLS LAST,created_at,id FOR UPDATE",
      [tenant],
    )
  ).rows;
  let remaining = hold;
  for (const l of lots) {
    const a = min(
      remaining,
      BigInt(l.remaining_micros) - BigInt(l.reserved_micros),
    );
    if (!a) continue;
    await tx.query(
      "UPDATE funding_lots SET reserved_micros=reserved_micros+$2 WHERE id=$1",
      [l.id, a.toString()],
    );
    await tx.query(
      "INSERT INTO reservation_allocations(tenant_id,task_id,lot_id,amount_micros) VALUES($1,$2,$3,$4)",
      [tenant, task, l.id, a.toString()],
    );
    remaining -= a;
    if (!remaining) break;
  }
  // Unallocated remainder uses the explicitly granted credit limit, never a gift lot.
  await tx.query(
    "UPDATE wallets SET reserved_micros=reserved_micros+$2,version=version+1 WHERE tenant_id=$1",
    [tenant, hold.toString()],
  );
}
export async function settle(
  tx: Tx,
  tenant: string,
  task: string,
  actual: number,
  user: string,
  uncertain = false,
) {
  await wallet(tx, tenant);
  const r = (
    await tx.query(
      "SELECT * FROM reservations WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE",
      [tenant, task],
    )
  ).rows[0];
  if (!r || !["reserved", "reconciling"].includes(r.status)) return;
  const chargeAmount = exactAmount(actual, true);
  if (uncertain || chargeAmount > BigInt(r.amount_micros)) {
    await tx.query(
      "UPDATE reservations SET status='reconciling' WHERE task_id=$1",
      [task],
    );
    await tx.query(
      "UPDATE tasks SET status='reconciling',error_code='USAGE_RECONCILIATION_REQUIRED',version=version+1 WHERE id=$1",
      [task],
    );
    return;
  }
  const allocations = (
    await tx.query(
      "SELECT a.*,l.kind,l.expires_at FROM reservation_allocations a JOIN funding_lots l ON l.id=a.lot_id WHERE a.tenant_id=$1 AND a.task_id=$2 ORDER BY l.expires_at ASC NULLS LAST,l.created_at,l.id FOR UPDATE OF l",
      [tenant, task],
    )
  ).rows;
  const sources: Array<{ lot: string | null; kind: string; amount: bigint }> =
    [];
  let remaining = chargeAmount;
  for (const a of allocations) {
    const charge = min(remaining, BigInt(a.amount_micros));
    remaining -= charge;
    await tx.query(
      "UPDATE funding_lots SET remaining_micros=remaining_micros-$2,reserved_micros=reserved_micros-$3 WHERE id=$1",
      [a.lot_id, charge.toString(), a.amount_micros],
    );
    if (charge) sources.push({ lot: a.lot_id, kind: a.kind, amount: charge });
  }
  // A credit-backed hold can predate a top-up. Consume currently free funds
  // before drawing credit, while preserving every other task's allocations.
  if (remaining) {
    const free = (
      await tx.query(
        "SELECT * FROM funding_lots WHERE tenant_id=$1 AND remaining_micros>reserved_micros AND (expires_at IS NULL OR expires_at>now()) ORDER BY expires_at ASC NULLS LAST,created_at,id FOR UPDATE",
        [tenant],
      )
    ).rows;
    for (const lot of free) {
      const charge = min(
        remaining,
        BigInt(lot.remaining_micros) - BigInt(lot.reserved_micros),
      );
      await tx.query(
        "UPDATE funding_lots SET remaining_micros=remaining_micros-$2 WHERE id=$1",
        [lot.id, charge.toString()],
      );
      sources.push({ lot: lot.id, kind: lot.kind, amount: charge });
      remaining -= charge;
      if (!remaining) break;
    }
  }
  if (remaining) sources.push({ lot: null, kind: "credit", amount: remaining });
  await tx.query(
    "UPDATE wallets SET balance_micros=balance_micros-$2,reserved_micros=reserved_micros-$3,spent_micros=spent_micros+$2,version=version+1 WHERE tenant_id=$1",
    [tenant, chargeAmount.toString(), r.amount_micros],
  );
  if (chargeAmount) {
    const entry = (
      await tx.query(
        "INSERT INTO ledger(tenant_id,user_id,task_id,kind,amount_micros,idempotency_key,reason) VALUES($1,$2,$3,'charge',$4,$5,'Metered task usage') RETURNING id",
        [tenant, user, task, (-chargeAmount).toString(), `charge:${task}`],
      )
    ).rows[0];
    const grouped = new Map<string | null, (typeof sources)[number]>();
    for (const source of sources) {
      const prior = grouped.get(source.lot);
      if (prior) prior.amount += source.amount;
      else grouped.set(source.lot, { ...source });
    }
    for (const source of grouped.values())
      await tx.query(
        "INSERT INTO billing_settlement_sources(tenant_id,task_id,charge_id,lot_id,kind,amount_micros) VALUES($1,$2,$3,$4,$5,$6)",
        [
          tenant,
          task,
          entry.id,
          source.lot,
          source.kind,
          source.amount.toString(),
        ],
      );
  }
  await tx.query("UPDATE reservations SET status=$2 WHERE task_id=$1", [
    task,
    actual ? "settled" : "released",
  ]);
  await tx.query("UPDATE tasks SET charged_micros=$2 WHERE id=$1", [
    task,
    chargeAmount.toString(),
  ]);
  await wallet(tx, tenant); // Expire unused gift allocations after releasing their holds.
}
export async function fund(
  tx: Tx,
  b: {
    tenant_id: string;
    action: "top_up" | "gift" | "debit" | "refund";
    amount_micros: number;
    reason: string;
    reference?: string;
    source_id?: string;
    expires_at?: string;
  },
  idempotency: string,
) {
  const w = await wallet(tx, b.tenant_id);
  const amount = exactAmount(b.amount_micros);
  if (b.action === "top_up" && !b.reference)
    throw new Problem(
      400,
      "PAYMENT_REFERENCE_REQUIRED",
      "A confirmed payment reference is required",
    );
  if (b.action === "gift" && !b.expires_at)
    throw new Problem(400, "EXPIRY_REQUIRED", "Gift expiry is required");
  let source: any;
  if (["debit", "refund"].includes(b.action)) {
    if (!b.source_id)
      throw new Problem(
        400,
        "SOURCE_REQUIRED",
        "Original funding entry is required",
      );
    source = (
      await tx.query(
        "SELECT l.*,f.id AS lot_id,f.remaining_micros,f.reserved_micros FROM ledger l JOIN funding_lots f ON f.ledger_id=l.id WHERE l.tenant_id=$1 AND l.id=$2 FOR UPDATE OF f",
        [b.tenant_id, b.source_id],
      )
    ).rows[0];
    if (
      !source ||
      !["top_up", "gift"].includes(source.kind) ||
      (b.action === "refund" && source.kind !== "top_up")
    )
      throw new Problem(
        409,
        "INVALID_SOURCE",
        "This entry cannot be refunded or debited",
      );
    if (
      BigInt(source.remaining_micros) - BigInt(source.reserved_micros) <
        amount ||
      BigInt(w.balance_micros) - BigInt(w.reserved_micros) < amount
    )
      throw new Problem(
        409,
        "FUNDS_UNAVAILABLE",
        "Source credit is spent or reserved",
      );
    if (b.action === "refund" && !b.reference)
      throw new Problem(
        400,
        "REFUND_REFERENCE_REQUIRED",
        "Confirmed refund reference is required",
      );
  }
  const sign = source ? -1n : 1n;
  const l = (
    await tx.query(
      "INSERT INTO ledger(tenant_id,kind,amount_micros,reference,source_id,expires_at,idempotency_key,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [
        b.tenant_id,
        b.action,
        (sign * amount).toString(),
        b.reference ?? null,
        b.source_id ?? null,
        b.expires_at ?? null,
        idempotency,
        b.reason,
      ],
    )
  ).rows[0];
  if (source)
    await tx.query(
      "UPDATE funding_lots SET remaining_micros=remaining_micros-$2 WHERE id=$1",
      [source.lot_id, amount.toString()],
    );
  else {
    // Net balance can be positive while other tasks still hold funded lots.
    // The actual debt is gross remaining lots minus the net wallet balance.
    const creditDebt = min(amount, BigInt(w.debt_micros));
    await tx.query(
      "INSERT INTO funding_lots(tenant_id,ledger_id,kind,remaining_micros,expires_at) VALUES($1,$2,$3,$4,$5)",
      [
        b.tenant_id,
        l.id,
        b.action === "gift" ? "gift" : "paid",
        (amount - creditDebt).toString(),
        b.expires_at ?? null,
      ],
    );
    if (creditDebt)
      await tx.query(
        "INSERT INTO billing_credit_repayments(tenant_id,funding_entry_id,amount_micros) VALUES($1,$2,$3)",
        [b.tenant_id, l.id, creditDebt.toString()],
      );
  }
  await tx.query(
    "UPDATE wallets SET balance_micros=balance_micros+$2,version=version+1 WHERE tenant_id=$1",
    [b.tenant_id, (sign * amount).toString()],
  );
  return l;
}
export async function setCreditLimit(tx: Tx, tenant: string, amount: number) {
  const limit = exactAmount(amount, true),
    w = await wallet(tx, tenant);
  if (
    BigInt(w.balance_micros) + limit < BigInt(w.reserved_micros) ||
    limit < BigInt(w.debt_micros)
  )
    throw new Problem(
      409,
      "CREDIT_RESERVED",
      "Existing charges or holds exceed this limit",
    );
  return (
    await tx.query(
      "UPDATE wallets SET credit_limit_micros=$2,version=version+1 WHERE tenant_id=$1 RETURNING *",
      [tenant, limit.toString()],
    )
  ).rows[0];
}
export function tokenCharge(
  input: number,
  output: number,
  inputRate: number,
  outputRate: number,
) {
  if (
    ![input, output, inputRate, outputRate].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    )
  )
    throw new Error("Invalid metering values");
  return Number(
    (BigInt(input) * BigInt(inputRate) +
      BigInt(output) * BigInt(outputRate) +
      999999n) /
      1000000n,
  );
}
