import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import { audit, requireAdmin, type Principal } from "./auth.js";
import {
  bindings,
  lockAdminAccess,
  permit,
  requireSensitiveAdmin,
} from "./admin-access.js";
import {
  currentAdminControl,
  pinAdminPolicy,
} from "./admin-operation-policy.js";
import { readScope, pageBounds, pageCursor } from "./admin-directory.js";
import { adminOperationDTO } from "./admin-memberships.js";
import { createApprovalRequest } from "./admin-approval-storage.js";
import { key, replay } from "./access.js";
import { canonical, hash, Problem, uuid } from "./lib.js";
import {
  commercialFeatures,
  planDraftSchema,
  planVersionReason,
  planSelect,
  planVersionDTO,
  runtimeDefinition,
  validatePlanDraft,
} from "./commercial-plans.js";

const pageQuery = z
  .object({
    cursor: z.string().min(1).max(4096).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
const commandHash = (action: string, id: string, b: unknown) =>
  hash(canonical({ action, target_id: id, command: b }));
export const isPlanOperation = (op: any) =>
  op?.payload?.commercial_plan_command_version === 1 &&
  ["plans.draft", "plans.publish"].includes(op.action);

/** A global definition affects all enterprises. A scoped allow cannot publish
 * it, and a scoped explicit deny cannot be bypassed by a global allow. */
export async function globalPlanAuthority(
  tx: Tx,
  p: Principal,
  permission: string,
) {
  await lockAdminAccess(tx);
  await permit(tx, p, permission);
  if (
    (await bindings(tx, p)).some(
      (b) => b.effect === "deny" && b.permissions.includes(permission),
    )
  )
    throw new Problem(
      403,
      "ADMIN_FORBIDDEN",
      "A global commercial operation overlaps an explicit restriction",
    );
  await requireSensitiveAdmin(tx, p);
}
function frozen(op: any) {
  const b =
    op.action === "plans.draft"
      ? planDraftSchema.parse(op.payload.command)
      : planVersionReason.parse(op.payload.command);
  if (
    !isPlanOperation(op) ||
    op.target_ids.length !== 1 ||
    op.target_ids[0] !== op.payload.target_id ||
    commandHash(op.action, op.payload.target_id, b) !== op.payload_hash ||
    (op.action === "plans.draft" &&
      (b as any).plan_id !== op.payload.target_id) ||
    (op.action === "plans.publish" &&
      op.payload.plan_version_id !== op.payload.target_id)
  )
    throw new Problem(
      409,
      "PAYLOAD_CHANGED",
      "Commercial operation no longer matches its frozen command",
    );
  return b;
}
export async function planOperationAuthority(
  tx: Tx,
  p: Principal,
  op: any,
  permission: string,
) {
  frozen(op);
  await globalPlanAuthority(tx, p, permission);
}
async function policy(tx: Tx) {
  const source = await currentAdminControl(tx);
  const rules = z
    .object({
      plan_publication_requires_approval: z.boolean().default(true),
      plan_approval_window_minutes: z.number().int().min(1).max(10).default(5),
    })
    .parse(source?.body ?? {});
  return {
    ...rules,
    id: await pinAdminPolicy(tx, {
      kind: "commercial_plan",
      source_id: source?.id ?? null,
      source_version: source?.version ?? null,
      rules,
    }),
  };
}
async function version(tx: Tx, id: string) {
  const v = (await tx.query(`${planSelect} WHERE v.id=$1`, [id])).rows[0];
  if (!v) throw new Problem(404, "NOT_FOUND", "Plan version not found");
  return v;
}
async function inspect(
  tx: Tx,
  catalog: Catalog,
  id: string,
  b: z.infer<typeof planVersionReason>,
) {
  const v = await version(tx, id);
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `commercial-plan:${v.plan_id}`,
  ]);
  if (v.version !== b.expected_version)
    throw new Problem(
      409,
      "VERSION_CONFLICT",
      "Select the exact immutable plan version",
    );
  if (v.state !== "draft")
    throw new Problem(
      409,
      "PLAN_NOT_DRAFT",
      "Published and retired versions require a new draft",
    );
  const old = v.published_version_id
    ? await version(tx, v.published_version_id)
    : null;
  if (old && old.version >= v.version)
    throw new Problem(
      409,
      "PLAN_VERSION_ORDER",
      "Publication must advance the current family version",
    );
  validatePlanDraft(
    {
      plan_id: v.plan_id,
      name: v.name,
      allowances: v.allowances,
      reason: b.reason,
    },
    catalog,
  );
  return {
    v,
    before: {
      plan_id: v.plan_id,
      head_revision: v.head_revision,
      published_version_id: v.published_version_id,
      previous: old ? planVersionDTO(old) : null,
      proposed: planVersionDTO(v),
    },
  };
}
async function operation(
  tx: Tx,
  p: Principal,
  action: string,
  target: string,
  b: unknown,
  k: string,
  rules: Awaited<ReturnType<typeof policy>>,
  payload: Record<string, unknown>,
  pending = false,
) {
  return (
    await tx.query(
      "INSERT INTO admin_operations(principal_id,action,payload_hash,payload,idempotency_key,state,policy_version_id,target_ids) VALUES($1,$2,$3,$4,$5,$6,$7,ARRAY[$8::uuid]) RETURNING *",
      [
        p.id,
        action,
        commandHash(action, target, b),
        {
          commercial_plan_command_version: 1,
          target_id: target,
          command: b,
          actor_session_id: p.sessionId,
          actor_auth_version: p.authVersion,
          ...payload,
        },
        hash(`${action}:${target}:${k}`),
        pending ? "pending_approval" : "running",
        rules.id,
        target,
      ],
    )
  ).rows[0];
}
async function publish(
  tx: Tx,
  p: Principal,
  op: any,
  checked: Awaited<ReturnType<typeof inspect>>,
) {
  const v = checked.v;
  const fact = (
    await tx.query(
      "INSERT INTO commercial_plan_publications(plan_id,plan_version_id,previous_version_id,operation_id,actor_id,provenance) VALUES($1,$2,$3,$4,$5,'admin_publication') RETURNING id",
      [v.plan_id, v.id, v.published_version_id, op.id, p.id],
    )
  ).rows[0];
  await tx.query(
    "UPDATE commercial_plans SET published_version_id=$2,revision=revision+1 WHERE id=$1",
    [v.plan_id, v.id],
  );
  await tx.query(
    "UPDATE admin_operations SET state='succeeded',version=version+1,result=$2,result_ids=$3 WHERE id=$1",
    [
      op.id,
      {
        plan_version_id: v.id,
        publication_id: fact.id,
        previous_version_id: v.published_version_id,
      },
      [v.id, fact.id],
    ],
  );
  await audit(tx, p, "admin.plans.publish", v.id, "succeeded", {
    reason: op.payload.command.reason,
    before: checked.before.previous,
    after: { ...planVersionDTO(v), state: "published" },
    operation_id: op.id,
    policy_version_id: op.policy_version_id,
  });
}

export async function decidePlanOperation(
  tx: Tx,
  catalog: Catalog,
  reviewer: Principal,
  op: any,
  decision: { decision: "approve" | "reject"; reason: string },
) {
  frozen(op);
  if (op.action !== "plans.publish")
    throw new Problem(
      409,
      "PLAN_REVIEW_UNAVAILABLE",
      "Only publication is independently reviewed",
    );
  await globalPlanAuthority(tx, reviewer, "admin.plans.publish");
  if (decision.decision === "reject") {
    await tx.query(
      "UPDATE admin_operations SET state='cancelled',approved_by=$2,version=version+1,result=$3 WHERE id=$1",
      [op.id, reviewer.id, { review_reason: decision.reason }],
    );
    return;
  }
  const actor: Principal = {
    id: op.principal_id,
    audience: "admin",
    sessionId: op.payload.actor_session_id,
    authVersion: op.payload.actor_auth_version,
    sessionHash: "",
    email: "",
    name: "",
  };
  await globalPlanAuthority(tx, actor, "admin.plans.publish");
  const rules = await policy(tx);
  if (rules.id !== op.policy_version_id)
    throw new Problem(
      409,
      "POLICY_CHANGED",
      "Create a fresh publication preview after policy changes",
    );
  const checked = await inspect(
    tx,
    catalog,
    op.payload.plan_version_id,
    planVersionReason.parse(op.payload.command),
  );
  if (canonical(checked.before) !== canonical(op.payload.before))
    throw new Problem(
      409,
      "TARGET_CHANGED",
      "The current publication changed while awaiting review",
    );
  await tx.query(
    "UPDATE admin_operations SET state='running',approved_by=$2 WHERE id=$1",
    [op.id, reviewer.id],
  );
  await publish(tx, actor, op, checked);
}

export function registerAdminPlans(
  app: FastifyInstance,
  db: Database,
  catalog: Catalog,
) {
  const auth = { preHandler: requireAdmin(db) };
  app.get("/v1/admin/plans", auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const q = pageQuery.parse(req.query);
    return db.tx(
      async (tx) => {
        await globalPlanAuthority(tx, req.principal, "admin.plans.read");
        const s = await readScope(tx, req.principal, "admin.plans.read"),
          bounds = await pageBounds(
            tx,
            db,
            req.principal,
            s,
            q,
            "commercial_plans",
          );
        let where = `v.created_at<=${s.arg(bounds.asof)}::timestamptz`;
        if (bounds.after)
          where += ` AND (v.created_at,v.id)<(${s.arg(bounds.after.at)}::timestamptz,${s.arg(bounds.after.id)}::uuid)`;
        const rows = (
          await tx.query(
            `${planSelect.replace("SELECT v.*,", "SELECT to_char(v.created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS cursor_at,v.*,")} WHERE ${where} ORDER BY v.created_at DESC,v.id DESC LIMIT ${s.arg(q.limit + 1)}`,
            s.values,
          )
        ).rows;
        const selected = rows.slice(0, q.limit);
        await audit(tx, req.principal, "admin.plans.read", "versions");
        return {
          items: selected.map(planVersionDTO),
          next_cursor:
            rows.length > q.limit
              ? pageCursor(db, bounds, selected.at(-1))
              : null,
        };
      },
      undefined,
      true,
    );
  });
  app.get("/v1/admin/plans/options", auth, async (req) =>
    db.tx(
      async (tx) => {
        z.object({}).strict().parse(req.query);
        await globalPlanAuthority(tx, req.principal, "admin.plans.read");
        await audit(tx, req.principal, "admin.plans.read", "options");
        return {
          feature_ids: [...commercialFeatures],
          role_ids: ["assistant", ...catalog.roles.map((r) => r.role_key)],
        };
      },
      undefined,
      true,
    ),
  );
  app.get("/v1/admin/plans/:plan_version_id", auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    z.object({}).strict().parse(req.query);
    return db.tx(
      async (tx) => {
        await globalPlanAuthority(tx, req.principal, "admin.plans.read");
        const v = await version(
          tx,
          uuid.parse((req.params as any).plan_version_id),
        );
        await audit(tx, req.principal, "admin.plans.read", v.id);
        return planVersionDTO(v);
      },
      undefined,
      true,
    );
  });
  app.post("/v1/admin/plans/drafts", auth, async (req, reply) => {
    const b = planDraftSchema.parse(req.body);
    reply.code(202);
    return db.tx(
      async (tx) => {
        await globalPlanAuthority(tx, req.principal, "admin.plans.draft");
        validatePlanDraft(b, catalog);
        return replay(
          tx,
          req.principal.id,
          "commercial-plan.draft",
          key(req),
          b,
          async () => {
            await tx.query(
              "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
              [`commercial-plan:${b.plan_id}`],
            );
            await tx.query(
              "INSERT INTO commercial_plans(id) VALUES($1) ON CONFLICT(id) DO NOTHING",
              [b.plan_id],
            );
            const n = (
              await tx.query(
                "SELECT greatest(coalesce((SELECT max(v.version) FROM commercial_plan_versions v WHERE v.plan_id=p.id),0),coalesce((SELECT max(e.version) FROM catalog_entries e WHERE e.kind='plan' AND e.key=p.legacy_key),0))+1 AS next FROM commercial_plans p WHERE p.id=$1",
                [b.plan_id],
              )
            ).rows[0].next;
            const rules = await policy(tx),
              op = await operation(
                tx,
                req.principal,
                "plans.draft",
                b.plan_id,
                b,
                key(req),
                rules,
                {},
              );
            const v = (
              await tx.query(
                "INSERT INTO commercial_plan_versions(plan_id,version,name,allowances,runtime_body,provenance,actor_id,operation_id) VALUES($1,$2,$3,$4,$5,'admin_draft',$6,$7) RETURNING id",
                [
                  b.plan_id,
                  n,
                  b.name,
                  b.allowances,
                  runtimeDefinition(b),
                  req.principal.id,
                  op.id,
                ],
              )
            ).rows[0];
            await tx.query(
              "UPDATE admin_operations SET state='succeeded',version=version+1,result=$2,result_ids=ARRAY[$3::uuid] WHERE id=$1",
              [op.id, { plan_version_id: v.id }, v.id],
            );
            await audit(
              tx,
              req.principal,
              "admin.plans.draft",
              v.id,
              "succeeded",
              {
                reason: b.reason,
                plan_id: b.plan_id,
                version: n,
                operation_id: op.id,
              },
            );
            return adminOperationDTO(
              (
                await tx.query("SELECT * FROM admin_operations WHERE id=$1", [
                  op.id,
                ])
              ).rows[0],
            );
          },
        );
      },
      undefined,
      true,
    );
  });
  app.post(
    "/v1/admin/plans/:plan_version_id/publication-previews",
    auth,
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const id = uuid.parse((req.params as any).plan_version_id),
        b = planVersionReason.parse(req.body);
      return db.tx(
        async (tx) => {
          await globalPlanAuthority(tx, req.principal, "admin.plans.publish");
          return replay(
            tx,
            req.principal.id,
            "commercial-plan.preview:" + id,
            key(req),
            b,
            async () => {
              const checked = await inspect(tx, catalog, id, b),
                rules = await policy(tx);
              const payload = {
                commercial_plan_command_version: 1,
                target_id: id,
                plan_version_id: id,
                command: b,
                before: checked.before,
                policy_version_id: rules.id,
                actor_session_id: req.principal.sessionId,
                actor_auth_version: req.principal.authVersion,
                approval: rules.plan_publication_requires_approval,
              };
              const preview = (
                await tx.query(
                  "INSERT INTO admin_previews(principal_id,action,payload,payload_hash,expires_at) VALUES($1,'plans.publish',$2,$3,now()+$4*interval '1 minute') RETURNING *",
                  [
                    req.principal.id,
                    payload,
                    commandHash("plans.publish", id, b),
                    rules.plan_approval_window_minutes,
                  ],
                )
              ).rows[0];
              await audit(
                tx,
                req.principal,
                "admin.plans.publish",
                id,
                "preview",
                { preview_id: preview.id, payload_hash: preview.payload_hash },
              );
              return {
                preview_id: preview.id,
                payload_hash: preview.payload_hash,
                target_ids: [id],
                policy_version_id: rules.id,
                decision: rules.plan_publication_requires_approval
                  ? "independent_approval"
                  : "recent_mfa",
                missing_permission_keys: [],
                impact_summary:
                  "Publish this immutable version for future grants. Existing grants keep their bound definitions. Publication does not credit a wallet or charge a payment.",
                expires_at: new Date(preview.expires_at).toISOString(),
                creates_business_effect: false,
                expected_target_versions: [{ id, version: checked.v.version }],
              };
            },
          );
        },
        undefined,
        true,
      );
    },
  );
  // Supplemental read of the exact frozen comparison, so the confirmation UI
  // never substitutes a fresh head for the facts actually being approved.
  app.get(
    "/v1/admin/plans/publication-previews/:preview_id",
    auth,
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      z.object({}).strict().parse(req.query);
      return db.tx(
        async (tx) => {
          await globalPlanAuthority(tx, req.principal, "admin.plans.publish");
          const p = (
            await tx.query(
              "SELECT *,now()<expires_at AS valid FROM admin_previews WHERE id=$1 AND principal_id=$2 AND action='plans.publish'",
              [uuid.parse((req.params as any).preview_id), req.principal.id],
            )
          ).rows[0];
          if (
            !p ||
            p.payload.commercial_plan_command_version !== 1 ||
            p.payload.actor_session_id !== req.principal.sessionId ||
            p.payload.actor_auth_version !== req.principal.authVersion
          )
            throw new Problem(
              404,
              "NOT_FOUND",
              "Publication preview not found",
            );
          if (!p.valid || p.consumed_at)
            throw new Problem(
              409,
              "PREVIEW_EXPIRED",
              "Create a fresh publication preview",
            );
          await audit(tx, req.principal, "admin.plans.read", p.id, "preview");
          return {
            preview_id: p.id,
            payload_hash: p.payload_hash,
            before: p.payload.before,
            reason: p.payload.command.reason,
            decision: p.payload.approval
              ? "independent_approval"
              : "recent_mfa",
            expires_at: new Date(p.expires_at).toISOString(),
          };
        },
        undefined,
        true,
      );
    },
  );
  app.post(
    "/v1/admin/plans/:plan_version_id/publications",
    auth,
    async (req, reply) => {
      const id = uuid.parse((req.params as any).plan_version_id),
        b = planVersionReason.parse(req.body);
      reply.code(202);
      return db.tx(
        async (tx) => {
          await globalPlanAuthority(tx, req.principal, "admin.plans.publish");
          return replay(
            tx,
            req.principal.id,
            "commercial-plan.publish:" + id,
            key(req),
            b,
            async () => {
              const preview = (
                await tx.query(
                  "SELECT * FROM admin_previews WHERE id=$1 AND principal_id=$2 AND action='plans.publish' FOR UPDATE",
                  [
                    uuid.parse(req.headers["x-admin-preview-id"]),
                    req.principal.id,
                  ],
                )
              ).rows[0];
              if (
                !preview ||
                preview.consumed_at ||
                preview.payload.plan_version_id !== id ||
                preview.payload_hash !== commandHash("plans.publish", id, b) ||
                preview.payload.actor_session_id !== req.principal.sessionId ||
                preview.payload.actor_auth_version !== req.principal.authVersion
              )
                throw new Problem(
                  409,
                  "PREVIEW_INVALID",
                  "Create a fresh preview of this exact publication",
                );
              if (
                !(
                  await tx.query("SELECT now()<$1::timestamptz AS valid", [
                    preview.expires_at,
                  ])
                ).rows[0].valid
              )
                throw new Problem(
                  409,
                  "PREVIEW_EXPIRED",
                  "Create a fresh publication preview",
                );
              const checked = await inspect(tx, catalog, id, b),
                rules = await policy(tx);
              if (rules.id !== preview.payload.policy_version_id)
                throw new Problem(
                  409,
                  "POLICY_CHANGED",
                  "Create a fresh preview after policy changes",
                );
              if (
                canonical(checked.before) !== canonical(preview.payload.before)
              )
                throw new Problem(
                  409,
                  "TARGET_CHANGED",
                  "The current publication changed; preview again",
                );
              const op = await operation(
                tx,
                req.principal,
                "plans.publish",
                id,
                b,
                key(req),
                rules,
                {
                  plan_version_id: id,
                  before: checked.before,
                  expires_at: new Date(preview.expires_at).toISOString(),
                },
                rules.plan_publication_requires_approval,
              );
              await tx.query(
                "UPDATE admin_previews SET consumed_at=now() WHERE id=$1",
                [preview.id],
              );
              if (rules.plan_publication_requires_approval) {
                await createApprovalRequest(tx, op);
                await audit(
                  tx,
                  req.principal,
                  "admin.plans.publish",
                  id,
                  "pending_approval",
                  {
                    operation_id: op.id,
                    reason: b.reason,
                    policy_version_id: rules.id,
                  },
                );
              } else await publish(tx, req.principal, op, checked);
              return adminOperationDTO(
                (
                  await tx.query("SELECT * FROM admin_operations WHERE id=$1", [
                    op.id,
                  ])
                ).rows[0],
              );
            },
          );
        },
        undefined,
        true,
      );
    },
  );
}
