import { z } from "zod";
import type { Tx } from "./db.js";
import { Problem, uuid } from "./lib.js";
import { planSchema } from "./plans.js";
import { publishedLegacyDefinition } from "./commercial-plans.js";

const date = z.string().datetime({ offset: true });
const revision = z.number().int().min(1).max(2_147_483_647);
export const vipSubject = z
  .object({ kind: z.enum(["user", "tenant"]), id: uuid })
  .strict();
export type VipSubject = z.infer<typeof vipSubject>;
export const vipCreate = z
  .object({
    subject: vipSubject,
    plan_version_id: uuid,
    starts_at: date,
    ends_at: date,
    overlap_policy: z.enum(["reject", "replace", "extend_same_plan"]),
    source: z.enum([
      "manual",
      "paid",
      "trial",
      "promotion",
      "compensation",
      "contract",
    ]),
    payment_record_id: uuid.optional(),
    auto_renew: z.literal(false),
    expected_subject_version: revision,
    reason: z.string().min(3).max(1000),
  })
  .strict()
  .superRefine((b, ctx) => {
    if ((b.source === "paid") !== !!b.payment_record_id)
      ctx.addIssue({
        code: "custom",
        path: ["payment_record_id"],
        message: "Only a paid grant references a verified payment",
      });
    if (Date.parse(b.ends_at) <= Date.parse(b.starts_at))
      ctx.addIssue({
        code: "custom",
        path: ["ends_at"],
        message: "End must follow start",
      });
  });
export const vipReason = z
  .object({ expected_version: revision, reason: z.string().min(3).max(1000) })
  .strict();
export const vipExtend = vipReason.extend({ ends_at: date }).strict();
export type VipCreate = z.infer<typeof vipCreate>;
export type VipChange = z.infer<typeof vipExtend> | z.infer<typeof vipReason>;
export const vipMode = (demo: boolean) =>
  demo ? "simulated" : "configured_services";
export const vipPermission = (action: string) =>
  "admin." +
  (action === "entitlements.suspend"
    ? "entitlements.revoke"
    : action === "entitlements.resume"
      ? "entitlements.grant"
      : action);
export const vipSelect = `SELECT g.*,s.tenant_id,s.user_id,s.data_mode,s.version AS subject_version,
 v.name AS plan_name,p.legacy_key,v.runtime_body,v.allowances,
 CASE WHEN g.state='revoked' THEN 'revoked' WHEN g.replacement_at<=now() THEN 'replaced'
 WHEN g.ends_at<=now() THEN 'expired' WHEN g.state='suspended' THEN 'suspended'
 WHEN g.starts_at>now() THEN 'scheduled' ELSE 'active' END AS effective_state
 FROM vip_grants g JOIN entitlement_subjects s ON s.id=g.subject_id
 JOIN commercial_plan_versions v ON v.id=g.plan_version_id JOIN commercial_plans p ON p.id=v.plan_id`;
export const subjectOf = (g: {
  tenant_id: string | null;
  user_id: string | null;
}): VipSubject =>
  g.tenant_id
    ? { kind: "tenant", id: g.tenant_id }
    : { kind: "user", id: g.user_id! };
export const vipDTO = (g: any) => ({
  id: g.id,
  subject: subjectOf(g),
  plan_version_id: g.plan_version_id,
  starts_at: new Date(g.starts_at).toISOString(),
  ends_at: new Date(g.ends_at).toISOString(),
  state: g.effective_state,
  source: g.source,
  auto_renew: false,
  actor_id: g.actor_id,
  version: g.version,
  operation_id: g.operation_id,
});
export async function findVip(tx: Tx, id: string, mode: string) {
  const row = (
    await tx.query(`${vipSelect} WHERE g.id=$1 AND s.data_mode=$2`, [id, mode])
  ).rows[0];
  if (!row) throw new Problem(404, "NOT_FOUND", "VIP grant not found");
  return row;
}
export async function subjectVersion(
  tx: Tx,
  subject: VipSubject,
  mode: string,
) {
  return (
    await tx.query(
      `SELECT * FROM entitlement_subjects WHERE ${subject.kind === "user" ? "user_id" : "tenant_id"}=$1 AND data_mode=$2`,
      [subject.id, mode],
    )
  ).rows[0];
}
export async function lockVipSubject(
  tx: Tx,
  subject: VipSubject,
  mode: string,
) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `entitlement:${mode}:${subject.kind}:${subject.id}`,
  ]);
}

/** The same live evaluation is used at requests, claims, tools and output gates.
 * Definition quotas are not summed, and the free tier does not silently widen
 * an explicitly granted restricted plan. Resource and budget guards stay separate. */
export async function effectiveVip(
  tx: Tx,
  tenant: string,
  user: string,
  scope: "merged" | "personal" | "tenant" = "merged",
) {
  await tx.query("SELECT set_config('app.actor_id',$1,true)", [user]);
  const rows = (
    await tx.query(
      `SELECT * FROM entitlement_access WHERE (($3<>'tenant' AND user_id=$2) OR ($3<>'personal' AND tenant_id=$1))
     AND state='active' AND starts_at<=now() AND ends_at>now() ORDER BY id`,
      [tenant, user, scope],
    )
  ).rows;
  if (rows.some((g) => !g.plan_body))
    throw new Problem(
      409,
      "PLAN_RECONCILIATION_REQUIRED",
      "A historical grant has no bound valid definition",
    );
  const fallback = rows.length
    ? null
    : await publishedLegacyDefinition(tx, "starter");
  const definitions = rows.length
    ? rows.map((g) => planSchema.parse(g.plan_body))
    : [fallback!.body];
  const features = [
    ...new Set<string>(definitions.flatMap((b) => b.capabilities)),
  ].sort();
  const unrestrictedRoles = definitions.some((b) => b.role_keys === undefined);
  const roleKeys = unrestrictedRoles
    ? undefined
    : [
        ...new Set<string>(definitions.flatMap((b) => b.role_keys ?? [])),
      ].sort();
  const ids = [
    ...new Set<string>(rows.map((g) => g.plan_version_id).filter(Boolean)),
  ];
  if (fallback) ids.push(fallback.plan_version_id);
  const boundary = (
    await tx.query(
      `SELECT min(boundary) AS at FROM (
      SELECT starts_at AS boundary FROM entitlement_access WHERE (($3<>'tenant' AND user_id=$2) OR ($3<>'personal' AND tenant_id=$1)) AND state='active' AND starts_at>now() AND ends_at>starts_at
      UNION ALL SELECT ends_at FROM entitlement_access WHERE (($3<>'tenant' AND user_id=$2) OR ($3<>'personal' AND tenant_id=$1)) AND state='active' AND starts_at<=now() AND ends_at>now()
     ) b`,
      [tenant, user, scope],
    )
  ).rows[0].at;
  const version = (
    await tx.query(
      `SELECT 1+coalesce(sum(revision),0)::double precision AS version FROM (
      SELECT version::bigint-1 AS revision FROM entitlement_subjects WHERE data_mode=current_setting('app.data_mode',true) AND (($3<>'tenant' AND user_id=$2) OR ($3<>'personal' AND tenant_id=$1))
      UNION ALL SELECT version::bigint FROM entitlements WHERE (($3<>'tenant' AND user_id=$2) OR ($3<>'personal' AND tenant_id=$1))
     ) revisions`,
      [tenant, user, scope],
    )
  ).rows[0].version;
  return {
    plan:
      rows.length === 1 ? rows[0].plan : rows.length ? "combined" : "starter",
    version:
      rows.length === 1 ? rows[0].plan_version : (fallback?.version ?? version),
    body: {
      name: definitions.length === 1 ? definitions[0].name : "Combined access",
      capabilities: features,
      max_active_tasks: Math.max(...definitions.map((b) => b.max_active_tasks)),
      max_task_budget_micros: Math.max(
        ...definitions.map((b) => b.max_task_budget_micros),
      ),
      monthly_hkd_micros: Math.max(
        ...definitions.map((b) => b.monthly_hkd_micros),
      ),
      ...(roleKeys === undefined ? {} : { role_keys: roleKeys }),
    },
    subject:
      rows.length === 1
        ? rows[0].tenant_id
          ? "tenant"
          : "user"
        : rows.length
          ? "combined"
          : "default",
    ends_at: boundary,
    ...(rows.length === 1
      ? {
          grant_id: rows[0].id,
          plan_version_id: rows[0].plan_version_id,
          binding_provenance: rows[0].provenance,
        }
      : {}),
    entitlement_version: version,
    plan_version_ids: ids,
    restriction_codes: rows.some((g) => g.provenance !== "canonical_grant")
      ? ["LEGACY_GRANT_PROVENANCE_RETAINED"]
      : [],
  };
}
