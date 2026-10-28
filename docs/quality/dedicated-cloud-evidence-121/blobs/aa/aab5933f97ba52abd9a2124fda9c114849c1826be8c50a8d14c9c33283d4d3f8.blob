import type { Tx } from "./db.js";
import { billingAccount } from "./billing.js";
import { billingEvent } from "./billing-events.js";
import { Problem } from "./lib.js";

const min = (a: bigint, b: bigint) => a < b ? a : b;
const unavailable = () => new Problem(409, "CLOUD_RUNTIME_BILLING_UNAVAILABLE", "Review the resource session's original payer and usage");

/** Optional computer leases use the same wallets, funding lots and journal as
 * AI tasks. They do not masquerade as an Agent task or receive an AI budget. */
export async function reserveDedicatedComputer(tx: Tx, session: any, quote: any) {
  const w = await billingAccount(tx, quote.billing_account_id);
  const hold = BigInt(quote.maximum_cost_micros);
  if ((w.user_id ? w.user_id !== quote.private_owner : w.tenant_id !== quote.tenant_id) || w.data_mode !== quote.body.data_mode)
    throw unavailable();
  if (BigInt(w.balance_micros) + BigInt(w.credit_limit_micros) - BigInt(w.reserved_micros) < hold)
    throw new Problem(402, "INSUFFICIENT_CREDIT", "The confirmed computer lease exceeds available credit");
  const journal = await billingEvent(tx, w.id, {
    action: "billing.cloud_runtime.reserve", kind: "reserve", direction: "credit", bucket: "reserved",
    amount: hold, reason: "Customer-confirmed dedicated computer ceiling", actor: { actor_id: quote.private_owner },
  });
  await tx.query(`INSERT INTO cloud_runtime_holds(session_id,tenant_id,project_id,private_owner,billing_account_id,amount_micros,journal_entry_id)
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [session.id, quote.tenant_id, quote.project_id, quote.private_owner, w.id, hold.toString(), journal]);
  const lots = (await tx.query(`SELECT * FROM funding_lots WHERE billing_account_id=$1 AND remaining_micros>reserved_micros
    AND (expires_at IS NULL OR expires_at>now()) ORDER BY expires_at ASC NULLS LAST,created_at,id FOR UPDATE`, [w.id])).rows;
  let remaining = hold;
  for (const lot of lots) {
    const amount = min(remaining, BigInt(lot.remaining_micros) - BigInt(lot.reserved_micros));
    if (!amount) continue;
    await tx.query("UPDATE funding_lots SET reserved_micros=reserved_micros+$2 WHERE id=$1", [lot.id, amount.toString()]);
    await tx.query("INSERT INTO cloud_runtime_hold_allocations(session_id,lot_id,amount_micros) VALUES($1,$2,$3)", [session.id, lot.id, amount.toString()]);
    remaining -= amount;
    if (!remaining) break;
  }
  await tx.query("UPDATE wallets SET reserved_micros=reserved_micros+$2,version=version+1 WHERE id=$1", [w.id, hold.toString()]);
}

/** Unknown or unverified cleanup keeps the original hold. A later exact
 * receipt settles it once; stopping a browser cannot silently release money. */
export async function settleDedicatedComputer(tx: Tx, session: any, actual: string) {
  const before = (await tx.query("SELECT billing_account_id FROM cloud_runtime_holds WHERE session_id=$1", [session.id])).rows[0];
  if (!before) throw unavailable();
  // Wallet before hold/lot row locks matches normal task settlement order.
  const w = await billingAccount(tx, before.billing_account_id);
  const hold = (await tx.query("SELECT * FROM cloud_runtime_holds WHERE session_id=$1 FOR UPDATE", [session.id])).rows[0];
  if (!hold || !["reserved", "reconciling"].includes(hold.state)) return;
  if (!/^(0|[1-9][0-9]*)$/.test(actual) || BigInt(actual) > BigInt(hold.amount_micros) || !session.cleanup_verified)
    throw unavailable();
  const charge = BigInt(actual), allocations = (await tx.query(`SELECT a.*,l.kind FROM cloud_runtime_hold_allocations a
    JOIN funding_lots l ON l.id=a.lot_id WHERE a.session_id=$1 AND l.billing_account_id=$2
    ORDER BY l.expires_at ASC NULLS LAST,l.created_at,l.id FOR UPDATE OF l`, [session.id, w.id])).rows;
  let remaining = charge;
  const sources: Array<{lot_id: string | null;kind: string;amount: bigint}> = [];
  for (const allocation of allocations) {
    const used = min(remaining, BigInt(allocation.amount_micros));
    remaining -= used;
    await tx.query("UPDATE funding_lots SET remaining_micros=remaining_micros-$2,reserved_micros=reserved_micros-$3 WHERE id=$1",
      [allocation.lot_id, used.toString(), allocation.amount_micros]);
    if (used) sources.push({ lot_id: allocation.lot_id, kind: allocation.kind, amount: used });
  }
  // A top-up received after a credit-backed hold repays free funds first,
  // without taking another Agent task's or computer session's allocations.
  if (remaining) {
    const free = (await tx.query(`SELECT * FROM funding_lots WHERE billing_account_id=$1 AND remaining_micros>reserved_micros
      AND (expires_at IS NULL OR expires_at>now()) ORDER BY expires_at ASC NULLS LAST,created_at,id FOR UPDATE`, [w.id])).rows;
    for (const lot of free) {
      const used = min(remaining, BigInt(lot.remaining_micros) - BigInt(lot.reserved_micros));
      if (!used) continue;
      await tx.query("UPDATE funding_lots SET remaining_micros=remaining_micros-$2 WHERE id=$1", [lot.id, used.toString()]);
      sources.push({ lot_id: lot.id, kind: lot.kind, amount: used }); remaining -= used;
      if (!remaining) break;
    }
  }
  if (remaining) sources.push({ lot_id: null, kind: "credit", amount: remaining });
  await tx.query(`UPDATE wallets SET balance_micros=balance_micros-$2,reserved_micros=reserved_micros-$3,
    spent_micros=spent_micros+$2,version=version+1 WHERE id=$1`, [w.id, charge.toString(), hold.amount_micros]);
  let chargeId: string | null = null;
  if (charge) {
    chargeId = (await tx.query(`INSERT INTO ledger(tenant_id,billing_account_id,user_id,kind,amount_micros,idempotency_key,reason,cloud_runtime_session_id)
      VALUES($1,$2,$3,'charge',$4,$5,'Confirmed dedicated computer usage',$6) RETURNING id`,
      [hold.tenant_id, w.id, hold.private_owner, (-charge).toString(), "cloud-runtime-charge:" + session.id, session.id])).rows[0].id;
    const grouped = new Map<string | null, typeof sources[number]>();
    for (const source of sources) {
      const existing = grouped.get(source.lot_id);
      if (existing) existing.amount += source.amount;
      else grouped.set(source.lot_id, { ...source });
    }
    for (const source of grouped.values())
      await tx.query("INSERT INTO cloud_runtime_charge_sources(charge_id,lot_id,kind,amount_micros) VALUES($1,$2,$3,$4)",
        [chargeId, source.lot_id, source.kind, source.amount.toString()]);
  }
  await tx.query("UPDATE cloud_runtime_holds SET state=$2,charge_id=$3 WHERE session_id=$1", [session.id, charge ? "settled" : "released", chargeId]);
  if (BigInt(hold.amount_micros) > charge)
    await billingEvent(tx, w.id, {
      action: "billing.cloud_runtime.release", kind: "release", direction: "debit", bucket: "reserved",
      amount: BigInt(hold.amount_micros) - charge, reason: "Unused confirmed computer budget released",
      source_entry_id: hold.journal_entry_id, actor: { actor_id: hold.private_owner },
    });
  await billingAccount(tx, w.id);
}
