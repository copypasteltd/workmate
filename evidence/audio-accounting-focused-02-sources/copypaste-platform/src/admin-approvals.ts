import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import {
  isProviderAdminOperation,
  providerOperationAuthority,
  providerOperationReadPermission,
  decideProviderAdminOperation,
} from "./provider-admin.js";
import { providerApprovalVisibility } from "./provider-admin-access.js";
import {
  isCapabilityOperation,
  capabilityOperationAuthority,
  decideCapabilityOperation,
} from "./capability-releases.js";
import {
  isPlanOperation,
  planOperationAuthority,
  decidePlanOperation,
} from "./admin-plans.js";
import { audit, requireAdmin, type Principal } from "./auth.js";
import { lockAdminAccess, requireSensitiveAdmin } from "./admin-access.js";
import {
  readScope,
  pageBounds,
  pageCursor,
  type ReadScope,
} from "./admin-directory.js";
import {
  membershipAdminAuthority,
  adminOperationDTO,
  decideMembershipOperation,
} from "./admin-memberships.js";
import {
  userAccountAuthority,
  isAccountAction,
  decideAccountOperation,
} from "./admin-accounts.js";
import {
  feeOperationAuthority,
  isFeeOperation,
  decideFeeOperation,
} from "./admin-fees.js";
import { decideLegacyOperation } from "./admin-operations.js";
import {
  isVipOperation,
  vipOperationAuthority,
  decideVipOperation,
} from "./admin-vip.js";
import { vipPermission } from "./vip.js";
import {
  isVipCreditOperation,
  vipCreditOperationAuthority,
  decideVipCreditOperation,
} from "./admin-vip-credit.js";
import { approvalDTO } from "./admin-approval-storage.js";
import { key, replay } from "./access.js";
import { Problem, uuid } from "./lib.js";

const query = z
  .object({
    cursor: z.string().min(1).max(4096).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const approvalDecision = z
  .object({
    expected_version: z.number().int().min(1),
    payload_hash: z.string().regex(/^[a-f0-9]{64}$/),
    decision: z.enum(["approve", "reject"]),
    reason: z.string().min(3).max(1000),
  })
  .strict();
const businessPermission = (op: any) =>
  isVipCreditOperation(op)
    ? "combination.write"
    : isVipOperation(op)
      ? vipPermission(op.action)
      : "admin." +
        (["entitlements.suspend", "entitlements.resume"].includes(op.action)
          ? "entitlements.extend"
          : op.action);

async function authority(tx: Tx, p: Principal, op: any, permission: string) {
  if (isProviderAdminOperation(op))
    await providerOperationAuthority(tx, p, op, permission);
  else if (isVipCreditOperation(op))
    await vipCreditOperationAuthority(tx, p, op, permission);
  else if (isCapabilityOperation(op))
    await capabilityOperationAuthority(tx, p, op, permission);
  else if (isPlanOperation(op))
    await planOperationAuthority(tx, p, op, permission);
  else if (isVipOperation(op))
    await vipOperationAuthority(tx, p, op, permission);
  else if (isFeeOperation(op))
    await feeOperationAuthority(tx, p, op, permission);
  else if (op.action.startsWith("users.") && op.payload.target_id)
    await userAccountAuthority(tx, p, op.payload.target_id, permission);
  else if (!op.tenant_id && op.payload?.command?.user_id)
    await userAccountAuthority(tx, p, op.payload.command.user_id, permission);
  else await membershipAdminAuthority(tx, p, op.tenant_id, permission);
  await requireSensitiveAdmin(tx, p);
}
function visibility(s: ReadScope, db: Database) {
  return `(CASE WHEN o.payload->>'provider_admin_command_version'='1' THEN ${providerApprovalVisibility(s, db)} ELSE ${legacyVisibility(s, db)} END)`;
}
function legacyVisibility(s: ReadScope, db: Database) {
  const permission = "admin.approvals.read";
  const globalPlan =
    s.global(permission) &&
    s.global("admin.plans.read") &&
    !s.bs.some(
      (b) =>
        b.effect === "deny" &&
        (b.permissions.includes(permission) ||
          b.permissions.includes("admin.plans.read")),
    );
  const globalCapability =
    s.global(permission) &&
    s.global("admin.catalog.read") &&
    !s.bs.some(
      (b) =>
        b.effect === "deny" &&
        (b.permissions.includes(permission) ||
          b.permissions.includes("admin.catalog.read")),
    );
  return `(CASE WHEN o.payload->>'capability_command_version'='1' THEN o.payload->'before'->>'data_mode'=${s.arg(db.config.DEMO_MODE ? "simulated" : "configured_services")} AND ${s.arg(globalCapability)}::boolean WHEN o.payload->>'commercial_plan_command_version'='1' THEN ${s.arg(globalPlan)}::boolean WHEN o.payload->>'vip_credit_command_version'='1' THEN o.payload->>'data_mode'=${s.arg(db.config.DEMO_MODE ? "simulated" : "configured_services")} AND ${s.account(permission, "target_scope")} AND ${s.account("admin.entitlements.read", "target_scope")} AND ${s.account("admin.billing.read", "target_scope")} WHEN o.payload->>'vip_command_version'='1' THEN o.payload->>'data_mode'=${s.arg(db.config.DEMO_MODE ? "simulated" : "configured_services")} AND ${s.account(permission, "target_scope")} AND ${s.account("admin.entitlements.read", "target_scope")} WHEN o.payload->>'financial_command_version'='1' THEN w.data_mode=${s.arg(db.config.DEMO_MODE ? "simulated" : "configured_services")} AND ${s.account(permission)} AND ${s.account("admin.billing.read")} ELSE ${s.account(permission, "target_scope")} END)`;
}
const from = `FROM admin_approval_requests a JOIN admin_operations o ON o.id=a.operation_id LEFT JOIN wallets w ON w.id::text=o.payload->>'billing_account_id' CROSS JOIN LATERAL (SELECT o.tenant_id,CASE WHEN (o.payload->>'vip_command_version'='1' OR o.payload->>'vip_credit_command_version'='1') AND o.payload->>'subject_kind'='user' THEN (o.payload->>'subject_id')::uuid WHEN o.action LIKE 'users.%' THEN (o.payload->>'target_id')::uuid WHEN o.tenant_id IS NULL THEN (o.payload->'command'->>'user_id')::uuid ELSE NULL::uuid END AS user_id) target_scope`;
async function find(
  tx: Tx,
  selected: string,
  byOperation = false,
  lock = false,
) {
  const r = (
    await tx.query(
      `SELECT * FROM admin_approval_requests WHERE ${byOperation ? "operation_id" : "id"}=$1${lock ? " FOR UPDATE" : ""}`,
      [selected],
    )
  ).rows[0];
  if (!r) throw new Problem(404, "NOT_FOUND", "Approval request not found");
  const op = (
    await tx.query(
      `SELECT * FROM admin_operations WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [r.operation_id],
    )
  ).rows[0];
  return { r, op };
}
export function registerAdminApprovals(
  app: FastifyInstance,
  db: Database,
  catalog: Catalog,
) {
  const auth = { preHandler: requireAdmin(db) };
  app.get("/v1/admin/approvals", auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const q = query.parse(req.query);
    return db.tx(
      async (tx) => {
        const s = await readScope(tx, req.principal, "admin.approvals.read"),
          bounds = await pageBounds(tx, db, req.principal, s, q, "approvals");
        let where =
          visibility(s, db) +
          ` AND a.created_at<=${s.arg(bounds.asof)}::timestamptz`;
        if (bounds.after)
          where += ` AND (a.created_at,a.id)<(${s.arg(bounds.after.at)}::timestamptz,${s.arg(bounds.after.id)}::uuid)`;
        const rows = (
          await tx.query(
            `SELECT a.*,to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at ${from} WHERE ${where} ORDER BY a.created_at DESC,a.id DESC LIMIT ${s.arg(q.limit + 1)}`,
            s.values,
          )
        ).rows;
        const selected = rows.slice(0, q.limit);
        await audit(tx, req.principal, "admin.approvals.read", "requests");
        return {
          items: selected.map(approvalDTO),
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
  app.get("/v1/admin/approvals/summary", auth, async (req) =>
    db.tx(
      async (tx) => {
        z.object({}).strict().parse(req.query);
        const s = await readScope(tx, req.principal, "admin.approvals.read");
        const where = visibility(s, db);
        const r = (
          await tx.query(
            `SELECT count(*)::int AS pending ${from} WHERE ${where} AND a.state='pending' AND a.expires_at>now()`,
            s.values,
          )
        ).rows[0];
        await audit(tx, req.principal, "admin.approvals.read", "summary");
        return r;
      },
      undefined,
      true,
    ),
  );
  app.get("/v1/admin/operations/:operation/approval", auth, async (req) =>
    db.tx(
      async (tx) => {
        z.object({}).strict().parse(req.query);
        await lockAdminAccess(tx);
        const { r, op } = await find(
          tx,
          uuid.parse((req.params as any).operation),
          true,
        );
        await authority(tx, req.principal, op, "admin.approvals.read");
        if (isFeeOperation(op))
          await authority(tx, req.principal, op, "admin.billing.read");
        if (isPlanOperation(op))
          await authority(tx, req.principal, op, "admin.plans.read");
        if (isCapabilityOperation(op))
          await authority(tx, req.principal, op, "admin.catalog.read");
        if (isVipOperation(op))
          await authority(tx, req.principal, op, "admin.entitlements.read");
        await audit(tx, req.principal, "admin.approvals.read", r.id);
        return approvalDTO(r);
      },
      undefined,
      true,
    ),
  );
  app.get("/v1/admin/approvals/:approval/review", auth, async (req) =>
    db.tx(
      async (tx) => {
        z.object({}).strict().parse(req.query);
        await lockAdminAccess(tx);
        const { r, op } = await find(
          tx,
          uuid.parse((req.params as any).approval),
        );
        await authority(tx, req.principal, op, "admin.approvals.read");
        const read = isProviderAdminOperation(op)
          ? providerOperationReadPermission(op)
          : isCapabilityOperation(op)
            ? "admin.catalog.read"
            : isPlanOperation(op)
              ? "admin.plans.read"
              : isFeeOperation(op) || op.action.startsWith("billing.")
                ? "admin.billing.read"
                : op.action.startsWith("entitlements.")
                  ? "admin.entitlements.read"
                  : op.action.startsWith("users.") ||
                      op.action === "tenants.members.write"
                    ? "admin.users.read"
                    : "admin.tenants.read";
        await authority(tx, req.principal, op, read);
        await audit(tx, req.principal, "admin.approvals.read", r.id);
        return {
          approval: approvalDTO(r),
          operation: adminOperationDTO(op),
          command: op.payload.command,
          before: op.payload.before ?? null,
          expires_at: op.payload.expires_at,
        };
      },
      undefined,
      true,
    ),
  );
  for (const path of [
    "/v1/admin/approvals/:approval_id/decisions",
    "/v1/admin/billing/operations/:operation/decision",
  ])
    app.post(path, auth, async (req, reply) => {
      const params = req.params as any,
        b = approvalDecision.parse(req.body);
      reply.code(params.approval_id ? 202 : 200);
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          const { r, op } = await find(
            tx,
            uuid.parse(params.approval_id ?? params.operation),
            !!params.operation,
            true,
          );
          if (params.operation && !isFeeOperation(op))
            throw new Problem(404, "NOT_FOUND", "Financial approval not found");
          await authority(tx, req.principal, op, "admin.approvals.decide");
          await authority(tx, req.principal, op, businessPermission(op));
          if (req.principal.id === op.principal_id)
            throw new Problem(
              403,
              "SELF_APPROVAL_FORBIDDEN",
              "A different authorized administrator must review this operation",
            );
          const saved = await replay(
            tx,
            req.principal.id,
            `admin.approval.decision:${r.id}`,
            key(req),
            b,
            async () => {
              if (r.state !== "pending" || op.state !== "pending_approval")
                throw new Problem(
                  409,
                  "NOT_PENDING",
                  "Approval is no longer pending",
                );
              if (
                r.version !== b.expected_version ||
                r.payload_hash !== b.payload_hash ||
                op.payload_hash !== r.payload_hash
              )
                throw new Problem(
                  409,
                  "VERSION_CONFLICT",
                  "Reload the exact frozen approval request",
                );
              if (
                b.decision === "approve" &&
                !(
                  await tx.query("SELECT now()<$1::timestamptz AS valid", [
                    r.expires_at,
                  ])
                ).rows[0].valid
              )
                throw new Problem(
                  409,
                  "OPERATION_EXPIRED",
                  "Approval expired; create a fresh preview",
                );
              if (isProviderAdminOperation(op))
                await decideProviderAdminOperation(
                  tx,
                  db,
                  req.principal,
                  op,
                  b,
                );
              else if (isVipCreditOperation(op))
                await decideVipCreditOperation(tx, db, req.principal, op, b);
              else if (isCapabilityOperation(op))
                await decideCapabilityOperation(
                  tx,
                  db,
                  catalog,
                  req.principal,
                  op,
                  b,
                );
              else if (isPlanOperation(op))
                await decidePlanOperation(tx, catalog, req.principal, op, b);
              else if (isVipOperation(op))
                await decideVipOperation(tx, db, req.principal, op, b);
              else if (isFeeOperation(op))
                await decideFeeOperation(tx, db, req.principal, op, b);
              else if (isAccountAction(op.action))
                await decideAccountOperation(
                  tx,
                  req.principal,
                  op,
                  b.decision,
                  b.reason,
                );
              else if (op.action === "tenants.members.write")
                await decideMembershipOperation(
                  tx,
                  req.principal,
                  op,
                  b.decision,
                  b.reason,
                );
              else await decideLegacyOperation(tx, req.principal, op, b);
              await tx.query(
                "INSERT INTO admin_approval_decisions(approval_id,reviewer_id,expected_version,payload_hash,decision,reason) VALUES($1,$2,$3,$4,$5,$6)",
                [
                  r.id,
                  req.principal.id,
                  r.version,
                  b.payload_hash,
                  b.decision,
                  b.reason,
                ],
              );
              await tx.query(
                "UPDATE admin_approval_requests SET state=$2,version=version+1 WHERE id=$1",
                [r.id, b.decision === "approve" ? "approved" : "rejected"],
              );
              return { operation_id: op.id };
            },
          );
          return adminOperationDTO(
            (
              await tx.query("SELECT * FROM admin_operations WHERE id=$1", [
                saved.operation_id,
              ])
            ).rows[0],
          );
        },
        undefined,
        true,
      );
    });
}
