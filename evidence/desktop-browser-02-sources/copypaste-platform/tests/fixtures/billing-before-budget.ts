/** Historical fixture for pre067 financial upgrade construction only.
 * Extracted from 0ed17e7:src/billing.ts; original function bodies retained,
 * with the exported reserve name changed and imports resolved to shared code.
 * Never imported by application code; current post-upgrade calls use reserve.
 * Whole original Git blob SHA256: 851d74f99fd1789c1410be9e1c2ff7bfa03b6653c28c6e9eff4562079329729b
 */
import type {Tx} from "../../src/db.js";
import {Problem} from "../../src/lib.js";
import {billingEvent} from "../../src/billing-events.js";
import {billingAccount} from "../../src/billing.js";
const min = (a: bigint, b: bigint) => a < b ? a : b;
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

async function legacyReserve(
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

/** Current production paths must never use a historical reservation constructor. */
export async function reserveBeforeBudget(tx: Tx, tenant: string, task: string, amount: number) {
  const modern = (await tx.query("SELECT to_regprocedure('public.register_task_ai_budget(uuid)') IS NOT NULL AS present")).rows[0].present;
  if (modern) throw new Error("Historical reserve fixture is forbidden after SQL067");
  return legacyReserve(tx, tenant, task, amount);
}
