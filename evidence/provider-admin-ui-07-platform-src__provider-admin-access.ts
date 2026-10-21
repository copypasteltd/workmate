import type { Tx, Database } from "./db.js";
import type { Principal } from "./auth.js";
import {
  bindings,
  lockAdminAccess,
  permit,
  requireSensitiveAdmin,
} from "./admin-access.js";
import { membershipAdminAuthority } from "./admin-memberships.js";
import { ReadScope } from "./admin-directory.js";
import { Problem } from "./lib.js";

export interface ProviderScope {
  data_mode: string;
  tenant_id: string | null;
  project_id: string | null;
}
export const modeOf = (db: Database) =>
  db.config.DEMO_MODE ? "simulated" : "configured_services";
export function assertProviderMode(db: Database, mode: string) {
  if (mode !== modeOf(db))
    throw new Problem(
      404,
      "NOT_FOUND",
      "Provider record not found in this data mode",
    );
}
export async function globalProviderAuthority(
  tx: Tx,
  p: Principal,
  key: string,
) {
  await lockAdminAccess(tx);
  await permit(tx, p, key);
  if (
    (await bindings(tx, p)).some(
      (b) => b.effect === "deny" && b.permissions.includes(key),
    )
  )
    throw new Problem(
      403,
      "ADMIN_FORBIDDEN",
      "Global provider control overlaps an explicit restriction",
    );
  await requireSensitiveAdmin(tx, p);
}
export async function providerAuthority(
  tx: Tx,
  p: Principal,
  s: ProviderScope,
  key: string,
  wholeTenant = false,
) {
  await lockAdminAccess(tx);
  if (
    s.data_mode !==
    (await tx.query("SELECT current_setting('app.data_mode') AS mode")).rows[0]
      .mode
  )
    throw new Problem(
      404,
      "NOT_FOUND",
      "Provider record not found in this data mode",
    );
  if (!s.tenant_id) return globalProviderAuthority(tx, p, key);
  if (wholeTenant) await membershipAdminAuthority(tx, p, s.tenant_id, key);
  else
    await permit(tx, p, key, {
      tenant: s.tenant_id,
      project: s.project_id ?? undefined,
    });
  await requireSensitiveAdmin(tx, p);
}
export function providerVisibility(s: ReadScope, key: string, alias = "r") {
  const global =
    s.global(key) &&
    !s.bs.some((b) => b.effect === "deny" && b.permissions.includes(key));
  return `(CASE WHEN ${alias}.tenant_id IS NULL THEN ${s.arg(global)}::boolean ELSE ${s.scope(key, `${alias}.tenant_id`, `${alias}.project_id`)} END)`;
}
export function providerApprovalVisibility(
  s: ReadScope,
  db: Database,
  additional = "admin.approvals.read",
) {
  const global = (key: string) =>
    s.global(key) &&
    !s.bs.some((b) => b.effect === "deny" && b.permissions.includes(key));
  const scoped = (key: string) =>
    `(CASE WHEN o.action='ai.tasks.settle' THEN ${s.account(key, "provider_scope")} ELSE ${providerVisibility(s, key, "provider_scope")} END)`;
  return `EXISTS(SELECT 1 FROM (SELECT (o.payload#>>'{scope,tenant_id}')::uuid AS tenant_id,(o.payload#>>'{scope,project_id}')::uuid AS project_id,NULL::uuid AS user_id) provider_scope WHERE o.payload->>'data_mode'=${s.arg(modeOf(db))} AND (CASE WHEN o.action IN ('ai.policy.publish','ai.policy.draft') THEN ${s.arg(global(additional) && global("admin.ai.policy.read"))}::boolean ELSE ${scoped(additional)} AND ${scoped("admin.ai.requests.read")} AND ${scoped("admin.ai.cost.read")} END))`;
}
export async function requestRow(
  tx: Tx,
  channel: string,
  id: string,
  lock = false,
) {
  if (lock)
    await tx.query(
      `SELECT id FROM ${channel === "generation" ? "ai_gateway_requests" : "ai_input_count_requests"} WHERE id=$1 FOR UPDATE`,
      [id],
    );
  const r = (
    await tx.query(
      "SELECT * FROM current_ai_provider_requests WHERE channel=$1 AND id=$2 AND data_mode=current_setting('app.data_mode')",
      [channel, id],
    )
  ).rows[0];
  if (!r) throw new Problem(404, "NOT_FOUND", "Provider request not found");
  return r;
}
export function providerRequestDTO(r: any, cost: boolean) {
  const d: any = {};
  for (const k of [
    "id",
    "channel",
    "data_mode",
    "subject_kind",
    "task_id",
    "validation_id",
    "tenant_id",
    "project_id",
    "actor_id",
    "attempt",
    "capability_version_id",
    "release_id",
    "request_class",
    "operation",
    "operation_id",
    "model_alias",
    "request_hash",
    "request_bytes",
    "policy_version_id",
    "dispatch_policy_version_id",
    "state",
    "prepared_until",
    "created_at",
    "dispatched_at",
    "finished_at",
    "released_at",
    "outcome_code",
    "http_status",
    "capacity_held",
    "termination_confirmation_id",
  ])
    d[k] = r[k] instanceof Date ? r[k].toISOString() : r[k];
  if (cost)
    d.cost = {
      state: r.cost_state,
      source:
        r.cost_state === "manually_confirmed"
          ? "human_evidence"
          : r.usage_known
            ? "gateway_observation"
            : "unknown",
      rate_snapshot: r.rate_snapshot,
      numerator: r.effective_numerator ?? null,
      amount_micros:
        r.effective_numerator === null
          ? null
          : ((BigInt(r.effective_numerator) + 999999n) / 1000000n).toString(),
      input_tokens: r.effective_input_tokens,
      output_tokens: r.effective_output_tokens,
      image_units: r.effective_image_units,
      counted_input_tokens: r.effective_counted_input_tokens,
      confirmation_id: r.cost_confirmation_id,
      evidence_id: r.cost_evidence_id,
    };
  return d;
}
