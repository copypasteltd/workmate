import type { Tx } from "./db.js";
import { Problem } from "./lib.js";

export type FinancialActor = { actor_id: string; admin_operation_id?: string };
export async function billingEvent(
  tx: Tx,
  account: string,
  event: {
    action: string;
    kind: "reserve" | "release" | "credit_limit" | "compensation";
    direction: "credit" | "debit" | "neutral";
    bucket: "paid" | "promotional" | "reserved" | "credit_limit";
    amount: bigint;
    reason: string;
    task_id?: string;
    source_entry_id?: string;
    actor?: FinancialActor;
  },
) {
  let actor = event.actor?.actor_id;
  if (!actor)
    actor = (
      await tx.query(
        "SELECT id FROM billing_actors WHERE service_key='billing.internal'",
      )
    ).rows[0].id;
  let operation;
  if (event.actor?.admin_operation_id) {
    operation = (
      await tx.query(
        "INSERT INTO billing_operations(id,billing_account_id,actor_id,action,admin_operation_id,policy_version_id,source_task_id,provenance) SELECT id,$2,principal_id,$3,id,policy_version_id,$4,'current_event' FROM admin_operations WHERE id=$1 AND principal_id=$5 RETURNING id",
        [
          event.actor.admin_operation_id,
          account,
          event.action,
          event.task_id ?? null,
          actor,
        ],
      )
    ).rows[0];
    if (!operation)
      throw new Problem(
        409,
        "BILLING_ACTOR_MISMATCH",
        "The financial operation must retain its actual administrator",
      );
  } else
    operation = (
      await tx.query(
        "INSERT INTO billing_operations(billing_account_id,actor_id,action,source_task_id,provenance) VALUES($1,$2,$3,$4,'current_event') RETURNING id",
        [account, actor, event.action, event.task_id ?? null],
      )
    ).rows[0];
  return (
    await tx.query(
      "INSERT INTO billing_journal(billing_account_id,operation_id,actor_id,kind,direction,bucket,amount_micros,reason,task_id,source_entry_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
      [
        account,
        operation.id,
        actor,
        event.kind,
        event.direction,
        event.bucket,
        event.amount.toString(),
        event.reason,
        event.task_id ?? null,
        event.source_entry_id ?? null,
      ],
    )
  ).rows[0].id as string;
}
