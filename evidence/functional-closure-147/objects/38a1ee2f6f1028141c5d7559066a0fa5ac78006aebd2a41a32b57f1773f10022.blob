import { z } from "zod";
import type { Tx } from "./db.js";
import { hash, Problem } from "./lib.js";
import { publishedLegacyDefinition } from "./commercial-plans.js";
import { effectiveVip } from "./vip.js";
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
  return effectiveVip(tx, tenant, user);
}
export async function authorizeTaskPlan(
  tx: Tx,
  tenant: string,
  user: string,
  role: any,
  budget: number,
  mode: "execute" | "ask" | "plan" = "execute",
  localHandoff?: { id: string; task_id: string; project: string; prompt: string; role_hash: string; execution_location: "cloud" | "desktop" },
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
  // Only the direct, frozen waiting parent of this admitted native child yields
  // its execution slot. Money remains reserved independently for both tasks.
  let waitingParent: string | null = null;
  if (localHandoff) {
    const bound = (await tx.query(`SELECT t.id FROM task_local_handoffs h
      JOIN tasks t ON t.id=h.source_task_id JOIN users u ON u.id=t.created_by
      JOIN task_dependencies d ON d.id=h.dependency_id
      WHERE h.id=$1 AND h.native_task_id=$2 AND h.state='working'
      AND h.tenant_id=$3 AND h.project_id=$4 AND h.created_by=$5
      AND t.tenant_id=$3 AND t.project_id=$4 AND t.created_by=$5
      AND t.execution_location='cloud' AND t.mode='execute' AND t.status='needs_input'
      AND NOT t.cancel_requested AND t.content_state='active' AND t.retention_expires_at>clock_timestamp()
      AND u.status='active' AND u.auth_version=t.actor_auth_version
      AND d.task_id=t.id AND d.kind='file' AND d.state='pending' AND d.version=h.dependency_version
      AND h.parent_prompt_hash=encode(digest(t.prompt,'sha256'),'hex')
      AND h.description_hash=encode(digest(d.description,'sha256'),'hex')
      AND h.native_prompt_hash=$6 AND h.role_key=$7 AND h.role_hash=$8 AND h.budget_micros=$9
      AND NOT EXISTS(SELECT 1 FROM tasks existing WHERE existing.id=h.native_task_id)`,
      [localHandoff.id,localHandoff.task_id,tenant,localHandoff.project,user,hash(localHandoff.prompt),role.role_key,localHandoff.role_hash,budget])).rows[0];
    if (!bound || localHandoff.execution_location !== "desktop" || mode !== "execute")
      throw new Problem(409,"LOCAL_HANDOFF_CHANGED","Refresh the original task and local preparation before continuing");
    waitingParent=bound.id;
  }
  const n = (
    await tx.query(
      "SELECT count(*)::int AS n FROM tasks WHERE tenant_id=$1 AND created_by=$2 AND ($3::uuid IS NULL OR id<>$3) AND status IN ('queued','running','paused','awaiting_approval','reconciling','needs_input')",
      [tenant, user, waitingParent],
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
