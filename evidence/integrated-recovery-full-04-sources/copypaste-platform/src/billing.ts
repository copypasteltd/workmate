import type { Tx } from "./db.js";
import { Problem } from "./lib.js";
import { billingEvent, type FinancialActor } from "./billing-events.js";

const min = (a: bigint, b: bigint) => (a < b ? a : b);
function exactAmount(value: number | string, allowZero = false) {
  if (
    (typeof value === "number" && !Number.isSafeInteger(value)) ||
    (typeof value === "string" && !/^(0|[1-9][0-9]*)$/.test(value))
  )
    throw new Problem(500, "INVALID_USAGE", "Invalid integer amount");
  const amount = BigInt(value);
  if (amount < (allowZero ? 0n : 1n) || amount > 9223372036854775807n)
    throw new Problem(500, "INVALID_USAGE", "Invalid integer amount");
  return amount;
}
async function balanceState(tx: Tx, account: string) {
  const w = (
    await tx.query(
      "SELECT w.*,(coalesce((SELECT sum(remaining_micros) FROM funding_lots WHERE billing_account_id=w.id),0)-w.balance_micros)::text AS debt_micros FROM wallets w WHERE id=$1",
      [account],
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

// Compatibility entry for enterprise callers. Personal and enterprise accounts
// share exactly the same funding, hold, expiry and settlement implementation.
export async function wallet(tx: Tx, tenant: string) {
  return loadWallet(tx, { tenant });
}
export async function billingAccount(tx: Tx, account: string) {
  return loadWallet(tx, { account });
}
async function loadWallet(
  tx: Tx,
  ref: { account: string } | { tenant: string },
) {
  const w = (
    await tx.query(
      `SELECT * FROM wallets WHERE ${"account" in ref ? "id" : "tenant_id"}=$1 FOR NO KEY UPDATE`,
      ["account" in ref ? ref.account : ref.tenant],
    )
  ).rows[0];
  if (!w)
    throw new Problem(404, "WALLET_NOT_FOUND", "Billing account not found");
  await balanceState(tx, w.id);
  const expired = await tx.query(
    "SELECT *,remaining_micros-reserved_micros AS free FROM funding_lots WHERE billing_account_id=$1 AND expires_at<=now() AND remaining_micros>reserved_micros FOR UPDATE",
    [w.id],
  );
  for (const lot of expired.rows) {
    const amount = BigInt(lot.free);
    await tx.query(
      "INSERT INTO ledger(tenant_id,billing_account_id,kind,amount_micros,source_id,idempotency_key,reason) VALUES($1,$5,'gift_expiry',$2,$3,$4,'Gift credit expired')",
      [
        w.tenant_id,
        (-amount).toString(),
        lot.ledger_id,
        `expire:${lot.id}:${lot.remaining_micros}`,
        w.id,
      ],
    );
    await tx.query(
      "UPDATE funding_lots SET remaining_micros=reserved_micros WHERE id=$1",
      [lot.id],
    );
    await tx.query(
      "UPDATE wallets SET balance_micros=balance_micros-$2,version=version+1 WHERE id=$1",
      [w.id, amount.toString()],
    );
  }
  return balanceState(tx, w.id);
}
async function taskWallet(tx: Tx, tenant: string, task: string) {
  const t = (
    await tx.query(
      "SELECT billing_account_id,created_by,data_mode FROM tasks WHERE tenant_id=$1 AND id=$2",
      [tenant, task],
    )
  ).rows[0];
  if (!t) throw new Problem(404, "NOT_FOUND", "Task not found");
  // This context is financial only. It never changes content/identity scopes.
  await tx.query("SELECT set_config('app.billing_actor_id',$1,true)", [
    t.created_by,
  ]);
  const w = await billingAccount(tx, t.billing_account_id);
  if (
    (w.user_id ? w.user_id !== t.created_by : w.tenant_id !== tenant) ||
    w.data_mode !== t.data_mode
  )
    throw new Problem(
      409,
      "INVALID_TASK_PAYER",
      "Task payer does not match its frozen subject or execution mode",
    );
  return { ...w, task_actor: t.created_by };
}
export async function reserve(
  tx: Tx,
  tenant: string,
  task: string,
  amount: number,
) {
  const hold = exactAmount(amount);
  const w = await taskWallet(tx, tenant, task);
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
    "INSERT INTO reservations(task_id,tenant_id,billing_account_id,amount_micros) VALUES($1,$2,$4,$3)",
    [task, tenant, hold.toString(), w.id],
  );
  await tx.query("SELECT register_task_ai_budget($1)", [task]);
  const lots = (
    await tx.query(
      "SELECT * FROM funding_lots WHERE billing_account_id=$1 AND remaining_micros>reserved_micros AND (expires_at IS NULL OR expires_at>now()) ORDER BY expires_at ASC NULLS LAST,created_at,id FOR UPDATE",
      [w.id],
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
    "UPDATE wallets SET reserved_micros=reserved_micros+$2,version=version+1 WHERE id=$1",
    [w.id, hold.toString()],
  );
  const journal = await billingEvent(tx, w.id, {
    action: "billing.reserve",
    kind: "reserve",
    direction: "credit",
    bucket: "reserved",
    amount: hold,
    reason: "Task budget reserved",
    task_id: task,
    actor: { actor_id: w.task_actor },
  });
  await tx.query(
    "UPDATE reservations SET journal_entry_id=$2 WHERE task_id=$1",
    [task, journal],
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
  const w = await taskWallet(tx, tenant, task);
  if (user !== w.task_actor)
    throw new Problem(
      409,
      "USAGE_ACTOR_MISMATCH",
      "Usage must retain the task's original actor",
    );
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
      "SELECT a.*,l.kind,l.expires_at FROM reservation_allocations a JOIN funding_lots l ON l.id=a.lot_id WHERE a.tenant_id=$1 AND a.task_id=$2 AND l.billing_account_id=$3 ORDER BY l.expires_at ASC NULLS LAST,l.created_at,l.id FOR UPDATE OF l",
      [tenant, task, w.id],
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
        "SELECT * FROM funding_lots WHERE billing_account_id=$1 AND remaining_micros>reserved_micros AND (expires_at IS NULL OR expires_at>now()) ORDER BY expires_at ASC NULLS LAST,created_at,id FOR UPDATE",
        [w.id],
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
    "UPDATE wallets SET balance_micros=balance_micros-$2,reserved_micros=reserved_micros-$3,spent_micros=spent_micros+$2,version=version+1 WHERE id=$1",
    [w.id, chargeAmount.toString(), r.amount_micros],
  );
  if (chargeAmount) {
    const entry = (
      await tx.query(
        "INSERT INTO ledger(tenant_id,billing_account_id,user_id,task_id,kind,amount_micros,idempotency_key,reason) VALUES($1,$6,$2,$3,'charge',$4,$5,'Metered task usage') RETURNING id",
        [
          tenant,
          user,
          task,
          (-chargeAmount).toString(),
          `charge:${task}`,
          w.id,
        ],
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
        "INSERT INTO billing_settlement_sources(tenant_id,billing_account_id,task_id,charge_id,lot_id,kind,amount_micros) VALUES($1,$7,$2,$3,$4,$5,$6)",
        [
          tenant,
          task,
          entry.id,
          source.lot,
          source.kind,
          source.amount.toString(),
          w.id,
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
  if (BigInt(r.amount_micros) > chargeAmount)
    await billingEvent(tx, w.id, {
      action: "billing.release",
      kind: "release",
      direction: "debit",
      bucket: "reserved",
      amount: BigInt(r.amount_micros) - chargeAmount,
      reason: "Unused task budget released",
      task_id: task,
      ...(r.journal_entry_id ? { source_entry_id: r.journal_entry_id } : {}),
    });
  await billingAccount(tx, w.id); // Expire unused gift allocations after releasing their holds.
}
export async function fund(
  tx: Tx,
  b: {
    tenant_id?: string;
    billing_account_id?: string;
    action: "top_up" | "gift" | "debit" | "refund";
    amount_micros: number | string;
    reason: string;
    reference?: string;
    source_id?: string;
    expires_at?: string;
  },
  idempotency: string,
) {
  if (!b.billing_account_id && !b.tenant_id)
    throw new Problem(
      400,
      "BILLING_ACCOUNT_REQUIRED",
      "Choose a billing account",
    );
  const w = b.billing_account_id
    ? await billingAccount(tx, b.billing_account_id)
    : await wallet(tx, b.tenant_id!);
  if (b.tenant_id && w.tenant_id !== b.tenant_id)
    throw new Problem(404, "WALLET_NOT_FOUND", "Billing account not found");
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
        "SELECT l.*,f.id AS lot_id,f.remaining_micros,f.reserved_micros FROM ledger l JOIN funding_lots f ON f.ledger_id=l.id WHERE f.billing_account_id=$1 AND l.id=$2 FOR UPDATE OF f",
        [w.id, b.source_id],
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
      "INSERT INTO ledger(tenant_id,billing_account_id,kind,amount_micros,reference,source_id,expires_at,idempotency_key,reason) VALUES($1,$9,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [
        w.tenant_id,
        b.action,
        (sign * amount).toString(),
        b.reference ?? null,
        b.source_id ?? null,
        b.expires_at ?? null,
        idempotency,
        b.reason,
        w.id,
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
      "INSERT INTO funding_lots(tenant_id,billing_account_id,ledger_id,kind,remaining_micros,expires_at) VALUES($1,$6,$2,$3,$4,$5)",
      [
        w.tenant_id,
        l.id,
        b.action === "gift" ? "gift" : "paid",
        (amount - creditDebt).toString(),
        b.expires_at ?? null,
        w.id,
      ],
    );
    if (creditDebt)
      await tx.query(
        "INSERT INTO billing_credit_repayments(tenant_id,billing_account_id,funding_entry_id,amount_micros) VALUES($1,$4,$2,$3)",
        [w.tenant_id, l.id, creditDebt.toString(), w.id],
      );
  }
  await tx.query(
    "UPDATE wallets SET balance_micros=balance_micros+$2,version=version+1 WHERE id=$1",
    [w.id, (sign * amount).toString()],
  );
  return l;
}
export async function setCreditLimit(
  tx: Tx,
  tenant: string,
  amount: number | string,
  actor?: FinancialActor & { reason: string },
) {
  return limitWallet(tx, await wallet(tx, tenant), amount, actor);
}
export async function setBillingAccountLimit(
  tx: Tx,
  account: string,
  amount: number | string,
  actor?: FinancialActor & { reason: string },
) {
  return limitWallet(tx, await billingAccount(tx, account), amount, actor);
}
async function limitWallet(
  tx: Tx,
  w: any,
  amount: number | string,
  actor?: FinancialActor & { reason: string },
) {
  const limit = exactAmount(amount, true);
  if (
    BigInt(w.balance_micros) + limit < BigInt(w.reserved_micros) ||
    limit < BigInt(w.debt_micros)
  )
    throw new Problem(
      409,
      "CREDIT_RESERVED",
      "Existing charges or holds exceed this limit",
    );
  const result = (
    await tx.query(
      "UPDATE wallets SET credit_limit_micros=$2,version=version+1 WHERE id=$1 RETURNING *",
      [w.id, limit.toString()],
    )
  ).rows[0];
  await billingEvent(tx, w.id, {
    action: "billing.credit_limit.write",
    kind: "credit_limit",
    direction: "neutral",
    bucket: "credit_limit",
    amount: limit,
    reason: actor?.reason ?? "Internal credit limit adjustment",
    actor,
  });
  return result;
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
  const amount =
    (BigInt(input) * BigInt(inputRate) +
      BigInt(output) * BigInt(outputRate) +
      999999n) /
    1000000n;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Metered charge exceeds the safe settlement range");
  return Number(amount);
}
