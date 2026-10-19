import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import { audit, requireAdmin, type Principal } from "./auth.js";
import {
  bindings,
  lockAdminAccess,
  permit,
  requireSensitiveAdmin as recentAdmin,
} from "./admin-access.js";
import { lockUserAuthorities } from "./user-authority.js";
import {
  currentAdminControl,
  pinAdminPolicy,
} from "./admin-operation-policy.js";
import { replay } from "./access.js";
import { canonical, hash, Problem, uuid } from "./lib.js";
import {
  lastOwner,
  lockMemberships,
  projectGrants,
  revokeRecipientInvites,
} from "./membership.js";

const permission = "admin.tenants.members.write";
const action = "tenants.members.write";
export const adminMembershipChange = z
  .object({
    expected_version: z.number().int().min(1),
    reason: z.string().min(3).max(1000),
    user_id: uuid,
    state: z.enum(["active", "removed", "suspended"]),
    role: z.enum(["owner", "admin", "member", "approver", "viewer"]),
    project_ids: z.array(uuid),
  })
  .strict();
type Change = z.infer<typeof adminMembershipChange>;
const key = (headers: Record<string, unknown>) =>
  z.string().min(8).max(128).parse(headers["idempotency-key"]);
const stateOf = (m: any) =>
  m?.admin_suspended ? "suspended" : (m?.status ?? null);
const commandHash = (tenant: string, b: Change) =>
  hash(canonical({ tenant_id: tenant, ...b }));

/** A project grant cannot authorize a change to an enterprise identity. A project
 * deny overlapping that enterprise blocks this indivisible identity operation. */
export async function membershipAdminAuthority(
  tx: Tx,
  p: Principal,
  tenant: string,
  key = permission,
) {
  await permit(tx, p, key, { tenant });
  const denies = (await bindings(tx, p)).filter(
    (b) =>
      b.effect === "deny" &&
      b.scope_kind === "project" &&
      b.permissions.includes(key),
  );
  if (
    denies.length &&
    (
      await tx.query(
        "SELECT 1 FROM projects WHERE tenant_id=$1 AND id=ANY($2::uuid[]) LIMIT 1",
        [tenant, denies.map((b) => b.scope_id)],
      )
    ).rowCount
  )
    throw new Problem(
      403,
      "ADMIN_FORBIDDEN",
      "A project deny prevents this enterprise-wide action",
    );
}

async function currentPolicy(tx: Tx) {
  const entry = await currentAdminControl(tx);
  const rules = z
    .object({
      membership_privileged_requires_approval: z.boolean().default(true),
      membership_approval_window_minutes: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(5),
    })
    .parse(entry?.body ?? {});
  const body = {
    action,
    source: entry ? "published_catalog" : "built_in_default",
    catalog_version_id: entry?.id ?? null,
    catalog_version: entry?.version ?? null,
    rules,
    required_permission: permission,
    recent_mfa_minutes: 10,
    scope: "enterprise_with_overlapping_project_denies",
    version: 1,
  };
  return {
    id: await pinAdminPolicy(tx, body),
    ...rules,
  };
}

async function inspect(tx: Tx, tenant: string, b: Change) {
  const t = (
    await tx.query("SELECT status FROM tenants WHERE id=$1 FOR SHARE", [tenant])
  ).rows[0];
  if (!t) throw new Problem(404, "NOT_FOUND", "Workspace not found");
  if (t.status !== "active")
    throw new Problem(
      409,
      "TENANT_INACTIVE",
      "Restore the workspace before changing membership",
    );
  const u = (
    await tx.query("SELECT status FROM users WHERE id=$1 FOR SHARE", [
      b.user_id,
    ])
  ).rows[0];
  if (!u) throw new Problem(404, "NOT_FOUND", "User not found");
  if (b.state === "active" && u.status !== "active")
    throw new Problem(
      409,
      "USER_INACTIVE",
      "Restore the account before granting access",
    );
  const old = (
    await tx.query(
      "SELECT * FROM memberships WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE",
      [tenant, b.user_id],
    )
  ).rows[0];
  if ((old?.version ?? 1) !== b.expected_version)
    throw new Problem(
      409,
      "VERSION_CONFLICT",
      "Membership changed; refresh the preview",
    );
  if (!old && b.state !== "active")
    throw new Problem(
      409,
      "MEMBERSHIP_MISSING",
      "A new membership must start active",
    );
  const ids = [...new Set(b.project_ids)].sort();
  const projects = (
    await tx.query(
      "SELECT id FROM projects WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND archived=false ORDER BY id FOR SHARE",
      [tenant, ids],
    )
  ).rows;
  if (projects.length !== ids.length)
    throw new Problem(
      404,
      "PROJECT_NOT_FOUND",
      "One or more active projects are outside this workspace",
    );
  if (old)
    await lastOwner(
      tx,
      tenant,
      old,
      b.role,
      b.state === "active" ? "active" : "removed",
    );
  const priorProjects = (
    await tx.query(
      "SELECT project_id FROM project_members WHERE tenant_id=$1 AND user_id=$2 ORDER BY project_id",
      [tenant, b.user_id],
    )
  ).rows.map((r) => r.project_id);
  return {
    old,
    ids,
    before: {
      id: old?.id ?? null,
      state: stateOf(old),
      role: old?.role ?? null,
      version: old?.version ?? null,
      project_ids: priorProjects,
    },
  };
}

function approvalRequired(
  policy: Awaited<ReturnType<typeof currentPolicy>>,
  b: Change,
  old: any,
) {
  return (
    policy.membership_privileged_requires_approval &&
    ((b.state === "active" && ["owner", "admin"].includes(b.role)) ||
      (old?.status === "active" && ["owner", "admin"].includes(old.role)))
  );
}

async function apply(
  tx: Tx,
  tenant: string,
  b: Change,
  checked: Awaited<ReturnType<typeof inspect>>,
  p: Principal,
  opId: string,
) {
  // Absence uses the contract's minimum expected revision (1). The first admin
  // grant advances it to 2, so two concurrent first grants cannot both succeed.
  const member = (
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role,status,admin_suspended,version) VALUES($1,$2,$3,$4,$5,2) ON CONFLICT(tenant_id,user_id) DO UPDATE SET role=EXCLUDED.role,status=EXCLUDED.status,admin_suspended=EXCLUDED.admin_suspended,version=memberships.version+1 RETURNING *",
      [
        tenant,
        b.user_id,
        b.role,
        b.state === "active" ? "active" : "removed",
        b.state === "suspended",
      ],
    )
  ).rows[0];
  const projects = b.state === "removed" ? [] : checked.ids;
  await projectGrants(tx, tenant, b.user_id, b.role, projects);
  // Old links cannot restore or silently overwrite an administrator's decision.
  await revokeRecipientInvites(tx, tenant, b.user_id);
  const after = {
    id: member.id,
    state: b.state,
    role: member.role,
    version: member.version,
    project_ids: projects,
  };
  await tx.query(
    "UPDATE admin_operations SET state='succeeded',version=version+1,result=$2,result_ids=$3 WHERE id=$1",
    [opId, { membership: after }, [member.id]],
  );
  await audit(
    tx,
    p,
    permission,
    opId,
    "succeeded",
    { user_id: b.user_id, reason: b.reason, before: checked.before, after },
    tenant,
  );
  return member;
}

export function adminOperationDTO(op: any) {
  if (!op) throw new Problem(404, "NOT_FOUND", "Operation not found");
  if (!op.policy_version_id)
    throw new Problem(
      409,
      "OPERATION_POLICY_UNRECORDED",
      "This historical operation predates recorded policy versions; use its legacy job record",
    );
  return {
    id: op.id,
    action: op.action,
    target_ids: op.target_ids,
    actor_id: op.principal_id,
    state: op.state,
    payload_hash: op.payload_hash,
    policy_version_id: op.policy_version_id,
    version: op.version,
    created_at: new Date(op.created_at).toISOString(),
    result_ids: op.result_ids,
    ...(op.result?.error_code ? { error_code: op.result.error_code } : {}),
  };
}

/** Invoked by the existing independent approval controller, under its row lock. */
export async function decideMembershipOperation(
  tx: Tx,
  actor: Principal,
  op: any,
  decision: "approve" | "reject",
  reason: string,
) {
  await lockAdminAccess(tx);
  await membershipAdminAuthority(
    tx,
    actor,
    op.tenant_id,
    "admin.approvals.decide",
  );
  await recentAdmin(tx, actor);
  if (actor.id === op.principal_id)
    throw new Problem(
      403,
      "SELF_APPROVAL_FORBIDDEN",
      "A different administrator must review this operation",
    );
  if (decision === "reject") {
    await tx.query(
      "UPDATE admin_operations SET state='cancelled',approved_by=$2,version=version+1 WHERE id=$1",
      [op.id, actor.id],
    );
    await audit(
      tx,
      actor,
      "admin.approval.reject",
      op.id,
      "succeeded",
      { reason, payload_hash: op.payload_hash },
      op.tenant_id,
    );
  } else {
    const live = (
      await tx.query("SELECT now()<$1::timestamptz AS valid", [
        op.payload.expires_at,
      ])
    ).rows[0].valid;
    if (!live)
      throw new Problem(
        409,
        "OPERATION_EXPIRED",
        "This approval expired; submit a fresh membership change",
      );
    const p: Principal = {
      id: op.principal_id,
      audience: "admin",
      sessionId: op.payload.actor_session_id,
      authVersion: op.payload.actor_auth_version,
      sessionHash: "",
      name: "",
      email: "",
    };
    await membershipAdminAuthority(tx, p, op.tenant_id);
    await recentAdmin(tx, p);
    const b = adminMembershipChange.parse(op.payload.command);
    await lockUserAuthorities(tx, [b.user_id]);
    await lockMemberships(tx, op.tenant_id);
    if (commandHash(op.tenant_id, b) !== op.payload_hash)
      throw new Problem(
        409,
        "PAYLOAD_CHANGED",
        "Operation payload does not match its frozen hash",
      );
    const policy = await currentPolicy(tx);
    if (policy.id !== op.policy_version_id)
      throw new Problem(
        409,
        "POLICY_CHANGED",
        "Policy changed; submit a fresh membership change",
      );
    const checked = await inspect(tx, op.tenant_id, b);
    if (canonical(checked.before) !== canonical(op.payload.before))
      throw new Problem(
        409,
        "TARGET_CHANGED",
        "Membership changed while awaiting approval; submit a fresh change",
      );
    await apply(tx, op.tenant_id, b, checked, p, op.id);
    await tx.query("UPDATE admin_operations SET approved_by=$2 WHERE id=$1", [
      op.id,
      actor.id,
    ]);
    await audit(
      tx,
      actor,
      "admin.approval.approve",
      op.id,
      "succeeded",
      { reason, payload_hash: op.payload_hash },
      op.tenant_id,
    );
  }
  return adminOperationDTO(
    (await tx.query("SELECT * FROM admin_operations WHERE id=$1", [op.id]))
      .rows[0],
  );
}

export function registerAdminMemberships(app: FastifyInstance, db: Database) {
  const auth = { preHandler: requireAdmin(db) };
  app.get(
    "/v1/admin/tenants/:tenant/membership-options",
    auth,
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const tenant = uuid.parse((req.params as any).tenant);
      const { user_id } = z.object({ user_id: uuid }).strict().parse(req.query);
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          await membershipAdminAuthority(tx, req.principal, tenant);
          await recentAdmin(tx, req.principal);
          if (
            !(await tx.query("SELECT 1 FROM tenants WHERE id=$1", [tenant]))
              .rowCount
          )
            throw new Problem(404, "NOT_FOUND", "Workspace not found");
          if (
            !(await tx.query("SELECT 1 FROM users WHERE id=$1", [user_id]))
              .rowCount
          )
            throw new Problem(404, "NOT_FOUND", "User not found");
          const m = (
            await tx.query(
              "SELECT * FROM memberships WHERE tenant_id=$1 AND user_id=$2",
              [tenant, user_id],
            )
          ).rows[0];
          const projects = (
            await tx.query(
              "SELECT id,name,archived FROM projects WHERE tenant_id=$1 ORDER BY name,id",
              [tenant],
            )
          ).rows;
          const grants = (
            await tx.query(
              "SELECT project_id FROM project_members WHERE tenant_id=$1 AND user_id=$2 ORDER BY project_id",
              [tenant, user_id],
            )
          ).rows.map((r) => r.project_id);
          await audit(
            tx,
            req.principal,
            "admin.tenants.members.inspect",
            tenant,
            "succeeded",
            { user_id },
            tenant,
          );
          return {
            tenant_id: tenant,
            user_id,
            membership: m
              ? {
                  id: m.id,
                  role: m.role,
                  state: stateOf(m),
                  version: m.version,
                  project_ids: grants,
                }
              : null,
            projects,
          };
        },
        undefined,
        true,
      );
    },
  );
  app.post(
    "/v1/admin/tenants/:tenant/memberships/preview",
    auth,
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const tenant = uuid.parse((req.params as any).tenant),
        b = adminMembershipChange.parse(req.body);
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          await membershipAdminAuthority(tx, req.principal, tenant);
          await recentAdmin(tx, req.principal);
          await lockUserAuthorities(tx, [b.user_id]);
          await lockMemberships(tx, tenant);
          const checked = await inspect(tx, tenant, b),
            policy = await currentPolicy(tx);
          const payload = {
            tenant_id: tenant,
            command: b,
            before: checked.before,
            policy_version_id: policy.id,
            approval: approvalRequired(policy, b, checked.old),
          };
          const r = (
            await tx.query(
              "INSERT INTO admin_previews(principal_id,action,payload,payload_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '5 minutes') RETURNING id,expires_at",
              [req.principal.id, action, payload, commandHash(tenant, b)],
            )
          ).rows[0];
          await audit(
            tx,
            req.principal,
            "admin.tenants.members.preview",
            r.id,
            "succeeded",
            { user_id: b.user_id, payload_hash: commandHash(tenant, b) },
            tenant,
          );
          return { ...r, ...payload, payload_hash: commandHash(tenant, b) };
        },
        undefined,
        true,
      );
    },
  );
  app.post(
    "/v1/admin/tenants/:tenant/memberships",
    auth,
    async (req, reply) => {
      reply.code(202).header("Cache-Control", "no-store");
      const tenant = uuid.parse((req.params as any).tenant),
        b = adminMembershipChange.parse(req.body),
        k = key(req.headers);
      const previewId =
        req.headers["x-admin-preview-id"] === undefined
          ? undefined
          : uuid.parse(req.headers["x-admin-preview-id"]);
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          await membershipAdminAuthority(tx, req.principal, tenant);
          await recentAdmin(tx, req.principal);
          await lockUserAuthorities(tx, [b.user_id]);
          await lockMemberships(tx, tenant);
          const saved = await replay(
            tx,
            req.principal.id,
            "admin.membership.change",
            k,
            { tenant_id: tenant, ...b },
            async () => {
              const checked = await inspect(tx, tenant, b),
                policy = await currentPolicy(tx);
              const approval = approvalRequired(policy, b, checked.old);
              if (previewId) {
                const preview = (
                  await tx.query(
                    "SELECT *,expires_at>now() AS valid FROM admin_previews WHERE id=$1 AND principal_id=$2 AND action=$3 FOR UPDATE",
                    [previewId, req.principal.id, action],
                  )
                ).rows[0];
                if (
                  !preview ||
                  !preview.valid ||
                  preview.consumed_at ||
                  preview.payload_hash !== commandHash(tenant, b) ||
                  preview.payload.policy_version_id !== policy.id ||
                  preview.payload.approval !== approval ||
                  canonical(preview.payload.before) !==
                    canonical(checked.before)
                )
                  throw new Problem(
                    409,
                    "PREVIEW_CHANGED",
                    "Preview expired or changed; preview again",
                  );
              }
              const payload = {
                command: b,
                before: checked.before,
                actor_session_id: req.principal.sessionId,
                actor_auth_version: req.principal.authVersion,
                expires_at: new Date(
                  Date.now() +
                    policy.membership_approval_window_minutes * 60000,
                ).toISOString(),
              };
              const op = (
                await tx.query(
                  "INSERT INTO admin_operations(principal_id,action,tenant_id,payload_hash,payload,idempotency_key,state,policy_version_id,target_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
                  [
                    req.principal.id,
                    action,
                    tenant,
                    commandHash(tenant, b),
                    payload,
                    `membership:${k}`,
                    approval ? "pending_approval" : "running",
                    policy.id,
                    [tenant, b.user_id],
                  ],
                )
              ).rows[0];
              if (approval)
                await audit(
                  tx,
                  req.principal,
                  permission,
                  op.id,
                  "pending_approval",
                  {
                    user_id: b.user_id,
                    reason: b.reason,
                    before: checked.before,
                    payload_hash: op.payload_hash,
                    policy_version_id: policy.id,
                  },
                  tenant,
                );
              else await apply(tx, tenant, b, checked, req.principal, op.id);
              if (previewId)
                await tx.query(
                  "UPDATE admin_previews SET consumed_at=now() WHERE id=$1",
                  [previewId],
                );
              return { id: op.id };
            },
          );
          return adminOperationDTO(
            (
              await tx.query("SELECT * FROM admin_operations WHERE id=$1", [
                saved.id,
              ])
            ).rows[0],
          );
        },
        undefined,
        true,
      );
    },
  );
  app.get(
    "/v1/admin/operations/:operation/membership-review",
    auth,
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const id = uuid.parse((req.params as any).operation);
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          const op = (
            await tx.query(
              "SELECT * FROM admin_operations WHERE id=$1 AND action=$2",
              [id, action],
            )
          ).rows[0];
          if (!op)
            throw new Problem(
              404,
              "NOT_FOUND",
              "Membership operation not found",
            );
          await membershipAdminAuthority(
            tx,
            req.principal,
            op.tenant_id,
            "admin.approvals.read",
          );
          await recentAdmin(tx, req.principal);
          const policy = (
            await tx.query(
              "SELECT body FROM admin_operation_policy_versions WHERE id=$1",
              [op.policy_version_id],
            )
          ).rows[0];
          await audit(
            tx,
            req.principal,
            "admin.approvals.read",
            id,
            "succeeded",
            {},
            op.tenant_id,
          );
          return {
            operation: adminOperationDTO(op),
            tenant_id: op.tenant_id,
            command: op.payload.command,
            before: op.payload.before,
            expires_at: op.payload.expires_at,
            policy: policy.body,
          };
        },
        undefined,
        true,
      );
    },
  );
}
