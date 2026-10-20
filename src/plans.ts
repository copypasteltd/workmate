import { z } from "zod";
import type { Tx } from "./db.js";
import { Problem } from "./lib.js";
import { publishedLegacyDefinition } from "./commercial-plans.js";
const all = [
  "text",
  "image",
  "video",
  "design",
  "analytics",
  "workflow",
  "local_files",
];
// Pilot operational defaults. These limits are configurable; they are not commercial prices.
export const defaults: Record<string, any> = {
  starter: {
    name: "Starter",
    capabilities: all,
    max_active_tasks: 1,
    max_task_budget_micros: 100_000_000,
    monthly_hkd_micros: 0,
  },
  pro: {
    name: "Pro",
    capabilities: all,
    max_active_tasks: 3,
    max_task_budget_micros: 500_000_000,
    monthly_hkd_micros: 0,
  },
  business: {
    name: "Business",
    capabilities: all,
    max_active_tasks: 8,
    max_task_budget_micros: 5_000_000_000,
    monthly_hkd_micros: 0,
  },
};
export const planSchema = z
  .object({
    name: z.string().min(1),
    capabilities: z
      .array(
        z.enum([
          "text",
          "image",
          "video",
          "design",
          "analytics",
          "workflow",
          "local_files",
        ]),
      )
      .max(7),
    monthly_hkd_micros: z.number().int().nonnegative().max(1e12),
    max_active_tasks: z.number().int().min(1).max(2_147_483_647).default(1),
    max_task_budget_micros: z
      .number()
      .int()
      .positive()
      .max(1e12)
      .default(100_000_000),
    role_keys: z.array(z.string().max(80)).max(100).optional(),
  })
  .strict();
export async function planDefinition(tx: Tx, key: string) {
  return publishedLegacyDefinition(tx, key);
}
export async function effectivePlan(tx: Tx, tenant: string, user: string) {
  await tx.query("SELECT set_config('app.actor_id',$1,true)", [user]);
  const grants = (
    await tx.query(
      "SELECT e.*,b.runtime_body AS bound_body,b.plan_version_id AS bound_plan_version_id,b.provenance AS binding_provenance FROM entitlements e LEFT JOIN legacy_entitlement_plan_bindings b ON b.entitlement_id=e.id WHERE (e.tenant_id=$1 OR e.user_id=$2) AND e.state='active' AND e.starts_at<=now() AND e.ends_at>now() ORDER BY CASE e.plan WHEN 'business' THEN 3 WHEN 'pro' THEN 2 ELSE 1 END DESC,e.ends_at DESC,e.id DESC",
      [tenant, user],
    )
  ).rows;
  const g = grants[0];
  if (!g)
    return {
      ...(await planDefinition(tx, "starter")),
      subject: "default",
      ends_at: null,
    };
  if (!g.bound_body)
    throw new Problem(
      409,
      "PLAN_RECONCILIATION_REQUIRED",
      "This historical grant has no bound valid plan definition",
    );
  const body = planSchema.parse(g.bound_body);
  return {
    plan: g.plan,
    version: g.plan_version,
    body,
    subject: g.tenant_id ? "tenant" : "user",
    ends_at: g.ends_at,
    grant_id: g.id,
    plan_version_id: g.bound_plan_version_id,
    binding_provenance: g.binding_provenance,
  };
}
export async function authorizeTaskPlan(
  tx: Tx,
  tenant: string,
  user: string,
  role: any,
  budget: number,
  mode: "execute" | "ask" | "plan" = "execute",
) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `task-quota:${tenant}:${user}`,
  ]);
  const p = await authorizeExecutionPlan(tx, tenant, user, role, mode);
  if (budget > p.body.max_task_budget_micros)
    throw new Problem(
      403,
      "PLAN_BUDGET_LIMIT",
      "Task budget exceeds your current plan limit",
    );
  const n = (
    await tx.query(
      "SELECT count(*)::int AS n FROM tasks WHERE tenant_id=$1 AND created_by=$2 AND status IN ('queued','running','paused','awaiting_approval','reconciling','needs_input')",
      [tenant, user],
    )
  ).rows[0].n;
  if (n >= p.body.max_active_tasks)
    throw new Problem(
      409,
      "PLAN_TASK_LIMIT",
      "Finish or reconcile existing tasks before starting another",
    );
  return p;
}
/** Current access may be revoked while previously reserved money stays frozen. */
export async function authorizeExecutionPlan(
  tx: Tx,
  tenant: string,
  user: string,
  role: any,
  mode: "execute" | "ask" | "plan" = "execute",
) {
  const p = await effectivePlan(tx, tenant, user);
  const needed: ("text" | "image")[] = [
    "text",
    ...(mode === "execute" &&
    role.model_bindings.some((b: any) =>
      JSON.stringify(b).includes("internal-image2"),
    )
      ? ["image" as const]
      : []),
  ];
  if (
    needed.some((n) => !p.body.capabilities.includes(n)) ||
    (p.body.role_keys && !p.body.role_keys.includes(role.role_key))
  )
    throw new Problem(
      403,
      "PLAN_CAPABILITY_REQUIRED",
      "Your current plan does not include this role capability",
    );
  return p;
}
