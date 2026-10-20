import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import { defaults, planSchema } from "./plans.js";
import { Problem, uuid } from "./lib.js";

export const commercialFeatures = [
  "text",
  "image",
  "video",
  "design",
  "analytics",
  "workflow",
  "local_files",
] as const;
const strings = z
  .array(z.string().min(1))
  .refine((v) => new Set(v).size === v.length, "Choose each item once");
const integer = z.number().int().min(1).max(2_147_483_647);
export const allowancesSchema = z
  .object({
    feature_ids: strings,
    allowed_role_ids: strings,
    seat_limit: integer,
    task_concurrency: integer,
    storage_bytes: z.number().int().nonnegative(),
    included_credit: z
      .object({
        currency: z.literal("HKD"),
        amount_micros: z
          .string()
          .regex(/^(0|[1-9][0-9]*)$/)
          .refine(
            (v) => BigInt(v) <= 9223372036854775807n,
            "Amount exceeds supported range",
          ),
      })
      .strict(),
    credit_policy: z.enum(["no_automatic_credit", "separate_idempotent_grant"]),
  })
  .strict();
export const planDraftSchema = z
  .object({
    plan_id: uuid.transform((v) => v.toLowerCase()),
    name: z.string().min(1),
    allowances: allowancesSchema,
    reason: z.string().min(3).max(1000),
  })
  .strict();
export const planVersionReason = z
  .object({ expected_version: integer, reason: z.string().min(3).max(1000) })
  .strict();
export type PlanDraft = z.infer<typeof planDraftSchema>;
export const legacyPlanIds: Record<string, string> = {
  starter: "3c6e7a1f-a3da-4fb9-9ac1-3bfa0b030c11",
  pro: "3c6e7a1f-a3da-4fb9-9ac1-3bfa0b030c12",
  business: "3c6e7a1f-a3da-4fb9-9ac1-3bfa0b030c13",
};
export const planSelect = `SELECT v.*,p.legacy_key,p.revision AS head_revision,p.published_version_id,
 CASE WHEN p.published_version_id=v.id THEN 'published'
 WHEN v.source_state IN ('published','retired') OR EXISTS(SELECT 1 FROM commercial_plan_publications x WHERE x.plan_version_id=v.id) THEN 'retired'
 ELSE 'draft' END AS state FROM commercial_plan_versions v JOIN commercial_plans p ON p.id=v.plan_id`;
export function planVersionDTO(v: any) {
  return {
    id: v.id,
    plan_id: v.plan_id,
    version: v.version,
    name: v.name,
    allowances: v.allowances,
    state: v.state,
  };
}
export function validatePlanDraft(b: PlanDraft, catalog: Catalog) {
  if (
    b.allowances.feature_ids.some((f) => !commercialFeatures.includes(f as any))
  )
    throw new Problem(
      409,
      "PLAN_FEATURE_UNKNOWN",
      "Select registered product features; a plan cannot register an executable capability",
    );
  for (const key of b.allowances.allowed_role_ids) catalog.role(key);
}
export function runtimeDefinition(b: PlanDraft) {
  return planSchema.parse({
    name: b.name,
    capabilities: b.allowances.feature_ids,
    max_active_tasks: b.allowances.task_concurrency,
    max_task_budget_micros: 1e12,
    monthly_hkd_micros: 0,
    role_keys: b.allowances.allowed_role_ids,
  });
}
const fromLegacy = (body: z.infer<typeof planSchema>, roles: string[]) => ({
  feature_ids: body.capabilities,
  allowed_role_ids: body.role_keys ?? roles,
  // Legacy software imposed no commercial seat/storage allowance. These are
  // explicit compatibility ceilings, not a new paid tier or historical promise.
  seat_limit: 2_147_483_647,
  task_concurrency: body.max_active_tasks,
  storage_bytes: Number.MAX_SAFE_INTEGER,
  included_credit: { currency: "HKD", amount_micros: "0" },
  credit_policy: "no_automatic_credit",
});

/** Capture actual definitions at upgrade. Missing old grant bodies are labelled
 * as an evaluation now; no original administrator, plan UUID or publication time
 * is invented. This transaction finishes before workers or requests start. */
export async function seedCommercialPlans(db: Database, catalog: Catalog) {
  await db.tx(
    async (tx) => {
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('commercial-plan-seed',0))",
      );
      const sources = (
        await tx.query(
          "SELECT * FROM catalog_entries WHERE kind='plan' ORDER BY key,version,id",
        )
      ).rows;
      const keys = [
        ...new Set([
          ...Object.keys(defaults),
          ...sources.map((s) => s.key as string),
        ]),
      ];
      const roles = ["assistant", ...catalog.roles.map((r: any) => r.role_key)];
      for (const key of keys) {
        await tx.query(
          "INSERT INTO commercial_plans(id,legacy_key) VALUES($1,$2) ON CONFLICT(legacy_key) DO NOTHING",
          [legacyPlanIds[key] ?? randomUUID(), key],
        );
        const family = (
          await tx.query("SELECT * FROM commercial_plans WHERE legacy_key=$1", [
            key,
          ])
        ).rows[0];
        // Even a family with no valid legacy publication is an evaluated seed.
        if (
          (
            await tx.query(
              "SELECT 1 FROM commercial_plan_versions WHERE plan_id=$1 LIMIT 1",
              [family.id],
            )
          ).rowCount
        )
          continue;
        let published: string | undefined;
        for (const old of sources.filter((s) => s.key === key)) {
          const parsed = planSchema.safeParse(old.body);
          if (!parsed.success) {
            await tx.query(
              "INSERT INTO commercial_plan_migration_issues(source_catalog_entry_id,reason_code) VALUES($1,'LEGACY_PLAN_DEFINITION_INVALID') ON CONFLICT DO NOTHING",
              [old.id],
            );
            continue;
          }
          const v = (
            await tx.query(
              "INSERT INTO commercial_plan_versions(plan_id,version,name,allowances,runtime_body,provenance,source_catalog_entry_id,source_state) VALUES($1,$2,$3,$4,$5,'recorded_legacy_catalog',$6,$7) RETURNING id",
              [
                family.id,
                old.version,
                parsed.data.name,
                fromLegacy(parsed.data, roles),
                parsed.data,
                old.id,
                old.state,
              ],
            )
          ).rows[0];
          if (old.state === "published") published = v.id;
        }
        const originalPublished = sources.some(
          (s) => s.key === key && s.state === "published",
        );
        if (!published && !originalPublished && defaults[key]) {
          const body = planSchema.parse(defaults[key]);
          const next =
            Math.max(
              0,
              ...sources.filter((s) => s.key === key).map((s) => s.version),
            ) + 1;
          published = (
            await tx.query(
              "INSERT INTO commercial_plan_versions(plan_id,version,name,allowances,runtime_body,provenance) VALUES($1,$2,$3,$4,$5,'bootstrap_default') RETURNING id",
              [family.id, next, body.name, fromLegacy(body, roles), body],
            )
          ).rows[0].id;
        }
        if (published) {
          await tx.query(
            "INSERT INTO commercial_plan_publications(plan_id,plan_version_id,provenance) VALUES($1,$2,'evaluated_at_upgrade')",
            [family.id, published],
          );
          await tx.query(
            "UPDATE commercial_plans SET published_version_id=$2,revision=revision+1 WHERE id=$1",
            [family.id, published],
          );
        }
      }
      await tx.query(`INSERT INTO legacy_entitlement_plan_bindings(entitlement_id,tenant_id,user_id,catalog_version_id,plan_version_id,runtime_body,provenance)
     SELECT e.id,e.tenant_id,e.user_id,v.id,CASE WHEN e.plan_body='{}'::jsonb OR e.plan_body=v.runtime_body THEN v.id ELSE NULL END,
     CASE WHEN e.plan_body='{}'::jsonb THEN v.runtime_body ELSE e.plan_body END,
     CASE WHEN e.plan_body='{}'::jsonb THEN 'evaluated_fallback_at_binding' ELSE 'recorded_grant_snapshot' END
     FROM entitlements e JOIN commercial_plans p ON p.legacy_key=e.plan JOIN commercial_plan_versions v ON v.id=p.published_version_id
     WHERE NOT EXISTS(SELECT 1 FROM legacy_entitlement_plan_bindings b WHERE b.entitlement_id=e.id)`);
    },
    undefined,
    true,
  );
}

export async function publishedLegacyDefinition(tx: Tx, key: string) {
  const v = (
    await tx.query(
      `${planSelect} WHERE p.legacy_key=$1 AND v.id=p.published_version_id`,
      [key],
    )
  ).rows[0];
  if (!v)
    throw new Problem(
      409,
      "PLAN_RECONCILIATION_REQUIRED",
      "No valid published definition is bound to this legacy plan",
    );
  return {
    plan: key,
    version: v.version,
    plan_version_id: v.id,
    body: planSchema.parse(v.runtime_body),
  };
}
