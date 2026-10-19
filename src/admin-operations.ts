import { planDefinition } from "./plans.js";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Database, Tx } from "./db.js";
import { requireAdmin, audit, type Principal } from "./auth.js";
import {
  permit,
  requireRecentMfa,
  lockAdminAccess,
  requireSensitiveAdmin,
} from "./admin-access.js";
import { key, replay } from "./access.js";
import { canonical, hash, micros, name, Problem, uuid } from "./lib.js";
import { fund, setCreditLimit, settle } from "./billing.js";
import { event } from "./tasks.js";
import {
  decideMembershipOperation,
  adminOperationDTO,
  membershipAdminAuthority,
} from "./admin-memberships.js";
import {
  decideAccountOperation,
  isAccountAction,
  userAccountAuthority,
} from "./admin-accounts.js";

const reason = z.string().trim().min(3).max(2000);
const date = z.string().datetime({ offset: true });
const money = z
  .object({
    action: z.enum([
      "billing.top_up",
      "billing.gift",
      "billing.debit",
      "billing.refund",
    ]),
    tenant_id: uuid,
    amount_micros: micros,
    reason,
    reference: z.string().min(3).max(200).optional(),
    source_id: uuid.optional(),
    expires_at: date.optional(),
  })
  .strict();
const entitlement = z
  .object({
    action: z.literal("entitlements.grant"),
    tenant_id: uuid.optional(),
    user_id: uuid.optional(),
    plan: z.enum(["starter", "pro", "business"]),
    starts_at: date,
    ends_at: date,
    reason,
  })
  .strict()
  .refine(
    (b) => !!b.tenant_id !== !!b.user_id,
    "Choose exactly one entitlement subject",
  )
  .refine(
    (b) => Date.parse(b.ends_at) > Date.parse(b.starts_at),
    "End must follow start",
  );
const entUpdate = z
  .object({
    action: z.enum([
      "entitlements.extend",
      "entitlements.revoke",
      "entitlements.suspend",
      "entitlements.resume",
    ]),
    entitlement_id: uuid,
    ends_at: date.optional(),
    reason,
  })
  .strict();
const limit = z
  .object({
    action: z.literal("billing.credit_limit.write"),
    tenant_id: uuid,
    amount_micros: z.number().int().nonnegative().max(1e12),
    reason,
  })
  .strict();
const reconcile = z
  .object({
    action: z.literal("billing.reconcile"),
    tenant_id: uuid,
    task_id: uuid,
    actual_micros: z.number().int().nonnegative().max(1e12),
    reason,
  })
  .strict();
export const operationSchema = z.union([
  money,
  entitlement,
  entUpdate,
  limit,
  reconcile,
]);
type Command = z.infer<typeof operationSchema>;
function permission(b: Command) {
  return (
    "admin." +
    (["entitlements.suspend", "entitlements.resume"].includes(b.action)
      ? "entitlements.extend"
      : b.action)
  );
}
async function target(tx: Tx, b: Command) {
  let tenant = "tenant_id" in b ? b.tenant_id : undefined;
  let version: string;
  if (b.action === "billing.reconcile")
    await tx.query(
      "SELECT id FROM tasks WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
      [b.task_id, b.tenant_id],
    );
  if ("entitlement_id" in b) {
    const e = (
      await tx.query("SELECT * FROM entitlements WHERE id=$1 FOR UPDATE", [
        b.entitlement_id,
      ])
    ).rows[0];
    if (!e) throw new Problem(404, "NOT_FOUND", "Entitlement not found");
    tenant = e.tenant_id;
    version = hash(canonical(e));
  } else if (tenant) {
    const t = (await tx.query("SELECT * FROM tenants WHERE id=$1", [tenant]))
      .rows[0];
    if (!t) throw new Problem(404, "NOT_FOUND", "Workspace not found");
    const w = (
      await tx.query(
        "SELECT version FROM wallets WHERE tenant_id=$1 FOR UPDATE",
        [tenant],
      )
    ).rows[0];
    if (!w) throw new Problem(404, "NOT_FOUND", "Billing account not found");
    version = String(w.version);
  } else {
    if (
      !("user_id" in b) ||
      !(await tx.query("SELECT 1 FROM users WHERE id=$1", [b.user_id])).rowCount
    )
      throw new Problem(404, "NOT_FOUND", "User not found");
    version = "user";
  }
  return { tenant, version };
}
async function policy(tx: Tx) {
  const r = (
    await tx.query(
      "SELECT body FROM catalog_entries WHERE kind='policy' AND key='admin-control' AND state='published'",
    )
  ).rows[0];
  return z
    .object({
      approval_threshold_micros: micros,
      max_vip_hours: z
        .number()
        .int()
        .positive()
        .max(24 * 366 * 5),
    })
    .parse(
      r?.body ?? {
        approval_threshold_micros: 10_000_000_000,
        max_vip_hours: 24 * 366,
      },
    );
}
async function validate(tx: Tx, p: Principal, b: Command) {
  const scope = await target(tx, b);
  const hours =
    "ends_at" in b && b.ends_at
      ? Math.max(0, (Date.parse(b.ends_at) - Date.now()) / 3600000)
      : undefined;
  const rules = await policy(tx);
  if (hours && hours > rules.max_vip_hours)
    throw new Problem(
      403,
      "DURATION_LIMIT",
      "Entitlement duration exceeds platform policy",
    );
  if (
    "expires_at" in b &&
    b.expires_at &&
    Date.parse(b.expires_at) <= Date.now()
  )
    throw new Problem(400, "EXPIRY_INVALID", "Expiry must be in the future");
  await permit(
    tx,
    p,
    permission(b),
    { tenant: scope.tenant },
    {
      amount:
        "amount_micros" in b
          ? b.amount_micros
          : "actual_micros" in b
            ? b.actual_micros
            : undefined,
      hours,
    },
  );
  await requireRecentMfa(tx, p);
  return {
    ...scope,
    approval:
      ("amount_micros" in b &&
        b.amount_micros >= rules.approval_threshold_micros) ||
      ("actual_micros" in b &&
        b.actual_micros >= rules.approval_threshold_micros),
  };
}
async function execute(tx: Tx, b: Command, p: Principal, id: string) {
  if (
    [
      "billing.top_up",
      "billing.gift",
      "billing.debit",
      "billing.refund",
    ].includes(b.action)
  ) {
    const m = b as z.infer<typeof money>;
    return fund(
      tx,
      { ...m, action: m.action.replace("billing.", "") as any },
      `admin:${id}`,
    );
  }
  if (b.action === "billing.credit_limit.write") {
    return setCreditLimit(tx, b.tenant_id, b.amount_micros);
  }
  if (b.action === "billing.reconcile") {
    const t = (
      await tx.query(
        "SELECT * FROM tasks WHERE id=$1 AND tenant_id=$2 AND status='reconciling' FOR UPDATE",
        [b.task_id, b.tenant_id],
      )
    ).rows[0];
    if (!t)
      throw new Problem(
        409,
        "NOT_RECONCILING",
        "Task is not awaiting reconciliation",
      );
    const r = (
      await tx.query("SELECT * FROM reservations WHERE task_id=$1", [t.id])
    ).rows[0];
    if (b.actual_micros > Number(r.amount_micros))
      throw new Problem(
        409,
        "RESERVATION_EXCEEDED",
        "Charge exceeds the authorized reservation; handle the difference as an explicit separate billing operation",
      );
    await settle(tx, b.tenant_id, t.id, b.actual_micros, t.created_by);
    await tx.query(
      "UPDATE tasks SET status='failed',error_code='RECONCILED',version=version+1 WHERE id=$1",
      [t.id],
    );
    await event(tx, b.tenant_id, t.id, "billing.reconciled", {
      actual_micros: b.actual_micros,
      reason: b.reason,
    });
    return { task_id: t.id, actual_micros: b.actual_micros };
  }
  if (b.action === "entitlements.grant") {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `entitlement:${b.tenant_id ?? b.user_id}:${b.plan}`,
    ]);
    if (
      (
        await tx.query(
          "SELECT 1 FROM entitlements WHERE (tenant_id=$1 OR user_id=$2) AND plan=$3 AND state<>'revoked' AND starts_at<$5 AND ends_at>$4",
          [
            b.tenant_id ?? null,
            b.user_id ?? null,
            b.plan,
            b.starts_at,
            b.ends_at,
          ],
        )
      ).rowCount
    )
      throw new Problem(
        409,
        "ENTITLEMENT_OVERLAP",
        "An overlapping grant already exists; extend or revoke it explicitly",
      );
    const plan = await planDefinition(tx, b.plan);
    const result = (
      await tx.query(
        "INSERT INTO entitlements(tenant_id,user_id,plan,starts_at,ends_at,reason,created_by,plan_version,plan_body) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
        [
          b.tenant_id ?? null,
          b.user_id ?? null,
          b.plan,
          b.starts_at,
          b.ends_at,
          b.reason,
          p.id,
          plan.version,
          plan.body,
        ],
      )
    ).rows[0];
    await tx.query(
      "INSERT INTO entitlement_events(entitlement_id,principal_id,operation_id,action,after_value) VALUES($1,$2,$3,$4,$5)",
      [result.id, p.id, id, b.action, result],
    );
    return result;
  }
  const e = b as z.infer<typeof entUpdate>;
  const old = (
    await tx.query("SELECT * FROM entitlements WHERE id=$1 FOR UPDATE", [
      e.entitlement_id,
    ])
  ).rows[0];
  if (
    e.action === "entitlements.resume" &&
    new Date(old.ends_at).getTime() <= Date.now()
  )
    throw new Problem(
      409,
      "ENTITLEMENT_EXPIRED",
      "Expired grants cannot be resumed",
    );
  if (old.state === "revoked")
    throw new Problem(
      409,
      "ENTITLEMENT_REVOKED",
      "A revoked entitlement cannot be restored; create a new grant",
    );
  if (e.action === "entitlements.extend") {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `entitlement:${old.tenant_id ?? old.user_id}:${old.plan}`,
    ]);
    if (
      e.ends_at &&
      (
        await tx.query(
          "SELECT 1 FROM entitlements WHERE id<>$1 AND (tenant_id=$2 OR user_id=$3) AND plan=$4 AND state<>'revoked' AND starts_at<$6 AND ends_at>$5",
          [
            old.id,
            old.tenant_id,
            old.user_id,
            old.plan,
            old.starts_at,
            e.ends_at,
          ],
        )
      ).rowCount
    )
      throw new Problem(
        409,
        "ENTITLEMENT_OVERLAP",
        "Extension overlaps another grant",
      );
    if (!e.ends_at || Date.parse(e.ends_at) <= new Date(old.ends_at).getTime())
      throw new Problem(
        400,
        "INVALID_EXTENSION",
        "The new end date must extend the current period",
      );
    const result = (
      await tx.query(
        "UPDATE entitlements SET ends_at=$2,version=version+1 WHERE id=$1 RETURNING *",
        [old.id, e.ends_at],
      )
    ).rows[0];
    await tx.query(
      "INSERT INTO entitlement_events(entitlement_id,principal_id,operation_id,action,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6)",
      [old.id, p.id, id, e.action, old, result],
    );
    return result;
  }
  const result = (
    await tx.query(
      "UPDATE entitlements SET state=$2,version=version+1 WHERE id=$1 RETURNING *",
      [
        old.id,
        e.action === "entitlements.revoke"
          ? "revoked"
          : e.action === "entitlements.suspend"
            ? "suspended"
            : "active",
      ],
    )
  ).rows[0];
  await tx.query(
    "INSERT INTO entitlement_events(entitlement_id,principal_id,operation_id,action,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6)",
    [old.id, p.id, id, e.action, old, result],
  );
  return result;
}
export function registerAdminOperations(app: FastifyInstance, db: Database) {
  app.get(
    "/v1/admin/operations/:operation",
    { preHandler: requireAdmin(db) },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const id = uuid.parse((req.params as any).operation);
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          const op = (
            await tx.query("SELECT * FROM admin_operations WHERE id=$1", [id])
          ).rows[0];
          if (!op) throw new Problem(404, "NOT_FOUND", "Operation not found");
          if (isAccountAction(op.action) && op.action.startsWith("users."))
            await userAccountAuthority(
              tx,
              req.principal,
              op.payload.target_id,
              "admin.jobs.read",
            );
          else if (op.action === "users.status")
            for (const target of op.target_ids)
              await userAccountAuthority(
                tx,
                req.principal,
                target,
                "admin.jobs.read",
              );
          else
            await membershipAdminAuthority(
              tx,
              req.principal,
              op.tenant_id,
              "admin.jobs.read",
            );
          await requireSensitiveAdmin(tx, req.principal);
          await audit(
            tx,
            req.principal,
            "admin.jobs.read",
            id,
            "succeeded",
            {},
            op.tenant_id,
          );
          return adminOperationDTO(op);
        },
        undefined,
        true,
      );
    },
  );

  app.post(
    "/v1/admin/operations/preview",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const b = operationSchema.parse(req.body);
      return db.tx(
        async (tx) => {
          const s = await validate(tx, req.principal, b);
          const payload = {
            command: b,
            target_version: s.version,
            approval: s.approval,
          };
          const preview = (
            await tx.query(
              "INSERT INTO admin_previews(principal_id,action,payload,payload_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '5 minutes') RETURNING id,payload_hash,expires_at",
              [req.principal.id, b.action, payload, hash(canonical(payload))],
            )
          ).rows[0];
          await audit(
            tx,
            req.principal,
            "admin.operation.preview",
            preview.id,
            "succeeded",
            { action: b.action },
            s.tenant,
          );
          return { ...preview, ...payload };
        },
        undefined,
        true,
      );
    },
  );
  app.post(
    "/v1/admin/operations/commit",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const b = z
        .object({
          preview_id: uuid,
          payload_hash: z.string().regex(/^[a-f\d]{64}$/),
        })
        .strict()
        .parse(req.body);
      return db.tx(
        (tx) =>
          replay(
            tx,
            req.principal.id,
            "admin.operation.commit",
            key(req),
            b,
            async () => {
              const preview = (
                await tx.query(
                  "SELECT *,expires_at>now() AS valid FROM admin_previews WHERE id=$1 AND principal_id=$2 FOR UPDATE",
                  [b.preview_id, req.principal.id],
                )
              ).rows[0];
              if (
                !preview ||
                !preview.valid ||
                preview.consumed_at ||
                preview.payload_hash !== b.payload_hash
              )
                throw new Problem(
                  409,
                  "PREVIEW_EXPIRED",
                  "Refresh the operation preview",
                );
              const command = operationSchema.parse(preview.payload.command);
              const s = await validate(tx, req.principal, command);
              if (
                s.version !== preview.payload.target_version ||
                s.approval !== preview.payload.approval
              )
                throw new Problem(
                  409,
                  "TARGET_CHANGED",
                  "Target or policy changed; preview again",
                );
              const op = (
                await tx.query(
                  "INSERT INTO admin_operations(principal_id,action,tenant_id,payload_hash,payload,idempotency_key,state) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
                  [
                    req.principal.id,
                    command.action,
                    s.tenant ?? null,
                    preview.payload_hash,
                    { command, target_version: s.version },
                    key(req),
                    s.approval ? "pending_approval" : "running",
                  ],
                )
              ).rows[0];
              let result = null;
              if (!s.approval) {
                result = await execute(tx, command, req.principal, op.id);
                await tx.query(
                  "UPDATE admin_operations SET state='succeeded',result=$2 WHERE id=$1",
                  [op.id, result],
                );
              }
              await tx.query(
                "UPDATE admin_previews SET consumed_at=now() WHERE id=$1",
                [preview.id],
              );
              await audit(
                tx,
                req.principal,
                permission(command),
                op.id,
                s.approval ? "pending_approval" : "succeeded",
                { payload_hash: op.payload_hash },
                s.tenant,
              );
              return {
                id: op.id,
                state: s.approval ? "pending_approval" : "succeeded",
                result,
              };
            },
          ),
        undefined,
        true,
      );
    },
  );
  app.post(
    "/v1/admin/operations/:id/decision",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const id = uuid.parse((req.params as any).id);
      const b = z
        .object({ decision: z.enum(["approve", "reject"]), reason })
        .strict()
        .parse(req.body);
      return db.tx(
        async (tx) => {
          const op = (
            await tx.query(
              "SELECT * FROM admin_operations WHERE id=$1 FOR UPDATE",
              [id],
            )
          ).rows[0];
          if (!op || op.state !== "pending_approval")
            throw new Problem(
              409,
              "NOT_PENDING",
              "Operation is not awaiting approval",
            );
          if (isAccountAction(op.action))
            return decideAccountOperation(
              tx,
              req.principal,
              op,
              b.decision,
              b.reason,
            );
          if (op.action === "tenants.members.write")
            return decideMembershipOperation(
              tx,
              req.principal,
              op,
              b.decision,
              b.reason,
            );
          await permit(tx, req.principal, "admin.approvals.decide", {
            tenant: op.tenant_id,
          });
          await requireRecentMfa(tx, req.principal);
          if (op.principal_id === req.principal.id)
            throw new Problem(
              403,
              "SELF_APPROVAL_FORBIDDEN",
              "A different administrator must review this operation",
            );
          if (b.decision === "reject") {
            await tx.query(
              "UPDATE admin_operations SET state='cancelled',approved_by=$2 WHERE id=$1",
              [id, req.principal.id],
            );
            await audit(
              tx,
              req.principal,
              "admin.approval.reject",
              id,
              "succeeded",
              { reason: b.reason },
              op.tenant_id,
            );
            return { id, state: "cancelled" };
          }
          const original = (
            await tx.query(
              "SELECT p.*,s.id AS session_id,s.mfa_at FROM admin_principals p JOIN sessions s ON s.admin_id=p.id WHERE p.id=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.auth_version=p.auth_version ORDER BY s.created_at DESC LIMIT 1",
              [op.principal_id],
            )
          ).rows[0];
          if (!original)
            throw new Problem(
              409,
              "ORIGINAL_AUTH_CHANGED",
              "Original administrator must sign in again",
            );
          const p: Principal = {
            id: original.id,
            email: original.email,
            name: original.name,
            audience: "admin",
            authVersion: original.auth_version,
            sessionId: original.session_id,
            sessionHash: "",
            mfaAt: original.mfa_at,
          };
          const command = operationSchema.parse(
            op.payload.command ?? op.payload,
          );
          const checked = await validate(tx, p, command);
          if (
            op.payload.target_version &&
            checked.version !== op.payload.target_version
          )
            throw new Problem(
              409,
              "TARGET_CHANGED",
              "The target changed while awaiting approval; create a new preview",
            );
          const result = await execute(tx, command, p, id);
          await tx.query(
            "UPDATE admin_operations SET state='succeeded',approved_by=$2,result=$3 WHERE id=$1",
            [id, req.principal.id, result],
          );
          await audit(
            tx,
            req.principal,
            "admin.approval.approve",
            id,
            "succeeded",
            { reason: b.reason, payload_hash: op.payload_hash },
            op.tenant_id,
          );
          return { id, state: "succeeded", result };
        },
        undefined,
        true,
      );
    },
  );
}
