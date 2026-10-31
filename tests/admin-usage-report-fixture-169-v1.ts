import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { historyOk, type System } from "./admin-history-fixture.js";
import { overviewWorkspace, overviewTask, overviewSettle, overviewAdmin } from "./admin-overview-fixture-160-v2.js";
export const reportPermissions = ["admin.overview.read", "admin.users.read", "admin.usage.read", "admin.usage.internal_cost.read", "admin.exports.create", "admin.exports.download"];
export async function usageFixture(s: System) {
  const first = await overviewWorkspace(s), second = await overviewWorkspace(s);
  await s.db.control.query("UPDATE users SET name=$2 WHERE id=$1", [first.owner.id, "Harbour Marketing"]);
  const company = await overviewTask(s, first), personal = await overviewTask(s, first, first.personalWallet), reserved = await overviewTask(s, first), unknown = await overviewTask(s, first), outside = await overviewTask(s, second);
  await overviewSettle(s, first, company.id, 875000); await overviewSettle(s, first, personal.id, 125001); await overviewSettle(s, first, unknown.id, 150000, true); await overviewSettle(s, second, outside.id, 900000);
  await s.db.control.query("UPDATE tasks SET status='succeeded',attempt=1 WHERE id=ANY($1::uuid[])", [[company.id, personal.id, outside.id]]);
  await s.db.control.query("UPDATE tasks SET status='reconciling',attempt=1 WHERE id=$1", [unknown.id]);
  await s.db.control.query("INSERT INTO tool_operations(tenant_id,task_id,call_id,action,state,input_hash,charge_micros) VALUES($1,$2,'usage-report-safe-op','image.generate','succeeded','synthetic-input-hash',250000)", [first.tenant, company.id]);
  const now = Date.now(), filters = { period_from: new Date(now - 86400000).toISOString(), period_to: new Date(now + 86400000).toISOString() };
  return { first, second, company: company.id as string, personal: personal.id as string, reserved: reserved.id as string, unknown: unknown.id as string, outside: outside.id as string, filters };
}
export async function refundConsumption(s: System, f: Awaited<ReturnType<typeof usageFixture>>, amount = "100000") {
  const a = await overviewAdmin(s, ["admin.billing.read", "admin.billing.refund"]), account = f.first.tenantWallet;
  const original = (await s.db.control.query("SELECT id FROM billing_journal WHERE task_id=$1 AND kind='consume'", [f.company])).rows[0]; assert.ok(original);
  const w = (await s.db.control.query("SELECT version FROM wallets WHERE id=$1", [account])).rows[0];
  const body = { action: "refund", expected_version: w.version, reason: "Explicit synthetic consumption refund; no cash payment", amount: { currency: "HKD", amount_micros: amount }, original_entry_id: original.id, destination: "paid_balance" };
  const preview = await historyOk(s, a.client, "POST", `/v1/admin/billing/accounts/${account}/previews`, body);
  const r = await s.app.inject({ method: "POST", url: `/v1/admin/billing/accounts/${account}/refund`, headers: { origin: s.db.config.ADMIN_ORIGIN, cookie: a.client!.cookie, "x-csrf-token": a.client!.csrf, "x-admin-preview-id": preview.preview_id, "idempotency-key": randomUUID() }, payload: body });
  assert.equal(r.statusCode, 202, r.body); assert.equal(r.json().state, "succeeded", r.body);
}
