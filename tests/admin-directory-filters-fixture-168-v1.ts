import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { defaults } from "../src/plans.js";
import { historyOk, type System } from "./admin-history-fixture.js";
import { overviewAdmin, overviewWorkspace, overviewTask, overviewSettle } from "./admin-overview-fixture-160-v2.js";

export const directoryPermissions = ["admin.users.read", "admin.users.contact.read", "admin.usage.read", "admin.billing.read", "admin.entitlements.read"];
export async function directoryFixture(s: System) {
  const first = await overviewWorkspace(s), second = await overviewWorkspace(s), outside = await overviewWorkspace(s);
  const now = Date.now(), day = 86400000, at = (days: number) => new Date(now + days * day).toISOString();
  const firstTask = await overviewTask(s, first), secondTask = await overviewTask(s, second), pending = await overviewTask(s, first), unstarted = await overviewTask(s, outside);
  await overviewSettle(s, first, firstTask.id, 875000); await overviewSettle(s, second, secondTask.id, 250000); await overviewSettle(s, first, pending.id, 100000, true);
  await s.db.control.query("UPDATE tasks SET status='succeeded',attempt=1 WHERE id=ANY($1::uuid[])", [[firstTask.id, secondTask.id]]);
  await s.db.control.query("UPDATE tasks SET status='reconciling',attempt=1 WHERE id=$1", [pending.id]);
  await s.db.control.query("INSERT INTO entitlements(user_id,plan,state,starts_at,ends_at,reason,plan_body) VALUES($1,'pro','active',$2,$3,'Synthetic directory effective grant',$4)", [first.owner.id, at(-1), at(5), defaults.pro]);
  for (const [state, start, end] of [["active", 2, 3], ["active", -3, -2], ["suspended", -1, 4], ["revoked", -1, 6], ["suspended", -4, -3]] as const)
    await s.db.control.query("INSERT INTO entitlements(user_id,plan,state,starts_at,ends_at,reason,plan_body) VALUES($1,'pro',$2,$3,$4,'Synthetic directory historical grant',$5)", [second.owner.id, state, at(start), at(end), defaults.pro]);
  // Exercise the actual canonical grant preview/commit, rather than synthesizing its projection.
  const operator = await overviewAdmin(s, [...directoryPermissions, "admin.entitlements.grant"]);
  const versions = await historyOk(s, operator.client, "GET", "/v1/admin/entitlement-grants/plan-options");
  const plan = versions.items.find((v: any) => v.legacy_key === "pro" || v.name.toLowerCase() === "pro"); assert.ok(plan, "Published Pro option");
  const subject = { kind: "user", id: outside.owner.id };
  const holder = await historyOk(s, operator.client, "GET", `/v1/admin/entitlement-grants/subjects/user/${subject.id}`);
  const command = { subject, plan_version_id: plan.id, starts_at: new Date(now - 1000).toISOString(), ends_at: new Date(now + 3600000).toISOString(), overlap_policy: "reject", source: "manual", auto_renew: false, expected_subject_version: holder.version, reason: "Explicit synthetic directory canonical grant" };
  const preview = await historyOk(s, operator.client, "POST", "/v1/admin/entitlement-previews", command);
  const committed = await s.app.inject({ method: "POST", url: "/v1/admin/entitlement-grants", headers: { origin: s.db.config.ADMIN_ORIGIN, cookie: operator.client!.cookie, "x-csrf-token": operator.client!.csrf, "x-admin-preview-id": preview.preview_id, "idempotency-key": randomUUID() }, payload: command });
  assert.equal(committed.statusCode, 202, committed.body); assert.equal(committed.json().state, "succeeded", committed.body);
  for (const [w, name, registered, active] of [[first, "Harbour Active", at(-10), at(-3)], [second, "Studio Legacy", at(-9), null], [outside, "Restricted Enterprise", at(-8), at(-1)]] as const)
    await s.db.control.query("UPDATE users SET name=$2,created_at=$3,last_active_at=$4,registration_source=$5 WHERE id=$1", [w.owner.id, name, registered, active, w === second ? null : "email_otp"]);
  return { first, second, outside, firstTask: firstTask.id as string, secondTask: secondTask.id as string, pending: pending.id as string, unstarted: unstarted.id as string, canonicalGrant: committed.json().result_ids[0], at };
}
