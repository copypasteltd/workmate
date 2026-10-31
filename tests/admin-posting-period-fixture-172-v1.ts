import { randomUUID } from "node:crypto";
import type { System } from "./admin-history-fixture.js";
import { usageFixture, refundConsumption } from "./admin-usage-report-fixture-169-v1.js";
import { overviewTask, overviewSettle } from "./admin-overview-fixture-160-v2.js";
import { hkDay } from "../src/admin-usage-report-model.js";

/** Explicit historical report facts in a disposable native database. Historical
 * entries are inserted with their original dates, never updated around append-
 * only guards. This is not a payment, provider or historical settlement test. */
export async function postingFixture(s: System) {
  const f = await usageFixture(s);
  const oldCreation = new Date(Date.now() - 40 * 86400000).toISOString();
  await s.db.control.query("UPDATE tasks SET created_at=$2 WHERE id=$1", [f.company, oldCreation]);
  await refundConsumption(s, f);
  const historical = await overviewTask(s, f.first);
  await overviewSettle(s, f.first, historical.id, 0);
  await s.db.control.query("UPDATE tasks SET created_at=$2,status='succeeded',charged_micros=500003 WHERE id=$1", [historical.id, oldCreation]);
  const midnight = Date.parse(hkDay(new Date(Date.now() - 2 * 86400000).toISOString()) + "T00:00:00+08:00");
  const dates = [new Date(midnight - 1000).toISOString(), new Date(midnight + 1000).toISOString(), new Date(midnight + 61000).toISOString()];
  const charges: string[] = [];
  for (let i = 0; i < 2; i++) {
    const row = (await s.db.control.query(`INSERT INTO ledger(tenant_id,user_id,billing_account_id,task_id,kind,amount_micros,idempotency_key,reason,created_at,data_mode)
      VALUES($1,$2,$3,$4,'charge',$5,$6,'Explicit synthetic historical report fact; no real payment',$7,'simulated') RETURNING id`,
      [f.first.tenant, f.first.owner.id, f.first.tenantWallet, historical.id, i === 0 ? "-200001" : "-300002", randomUUID(), dates[i]])).rows[0];
    charges.push(row.id);
  }
  const original = (await s.db.control.query("SELECT id FROM billing_journal WHERE raw_entry_id=$1 AND kind='consume'", [charges[0]])).rows[0];
  const operation = (await s.db.control.query(`INSERT INTO billing_operations(billing_account_id,actor_id,action,source_task_id,provenance,created_at)
    VALUES($1,$2,'billing.refund',$3,'current_event',$4) RETURNING id`, [f.first.tenantWallet, f.first.owner.id, historical.id, dates[2]])).rows[0];
  const refund = (await s.db.control.query(`INSERT INTO billing_journal(billing_account_id,operation_id,actor_id,kind,direction,bucket,amount_micros,reason,source_entry_id,task_id,created_at)
    VALUES($1,$2,$3,'compensation','credit','paid',100001,'Explicit synthetic historical consumption refund; no cash payment',$4,$5,$6) RETURNING id`,
    [f.first.tenantWallet, operation.id, f.first.owner.id, original.id, historical.id, dates[2]])).rows[0];
  return { ...f, historical: historical.id as string, charges, refund: refund.id as string, dates, oldCreation,
    days: [hkDay(dates[0]), hkDay(dates[1])],
    historicalFilters: { period_from: new Date(midnight - 86400000).toISOString(), period_to: new Date(midnight + 86400000).toISOString() },
  };
}
