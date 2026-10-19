import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import { audit, requireAdmin, type Principal } from "./auth.js";
import {
  bindings,
  lockAdminAccess,
  permit,
  requireSensitiveAdmin,
} from "./admin-access.js";
import { replay } from "./access.js";
import { canonical, hash, Problem, uuid } from "./lib.js";
import {
  adminOperationDTO,
  membershipAdminAuthority,
} from "./admin-memberships.js";
import { lockMemberships } from "./membership.js";
import { lockUserAuthorities } from "./user-authority.js";
import {
  currentAdminControl,
  pinAdminPolicy,
} from "./admin-operation-policy.js";
import { requestTaskCancellation } from "./task-control.js";

const reason = z.string().min(3).max(1000);
export const adminUserProfileChange = z
  .object({
    expected_version: z.number().int().min(1),
    reason,
    display_name: z.string().min(1).optional(),
    labels: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .refine(
    (b) => b.display_name !== undefined || b.labels !== undefined,
    "Supply a display name or labels",
  );
export const adminUserStatusChange = z
  .object({
    expected_version: z.number().int().min(1),
    reason,
    state: z.enum(["active", "frozen", "closed"]),
    inflight_policy: z.enum(["stop_new", "request_cancel"]),
  })
  .strict();
export const adminTenantStatusChange = z
  .object({
    expected_version: z.number().int().min(1),
    reason,
    state: z.enum(["active", "suspended", "closed"]),
    inflight_policy: z.enum(["stop_new", "request_cancel"]),
  })
  .strict();
export const adminSessionRevocation = z.object({ reason }).strict();
const definitions = {
  "users.profile.write": {
    permission: "admin.users.profile.write",
    type: "users",
    path: "profile",
    schema: adminUserProfileChange,
  },
  "users.status.write": {
    permission: "admin.users.status.write",
    type: "users",
    path: "status",
    schema: adminUserStatusChange,
  },
  "users.sessions.revoke": {
    permission: "admin.users.sessions.revoke",
    type: "users",
    path: "session-revocations",
    schema: adminSessionRevocation,
  },
  "tenants.status.write": {
    permission: "admin.tenants.status.write",
    type: "tenants",
    path: "status",
    schema: adminTenantStatusChange,
  },
} as const;
export type AccountAction = keyof typeof definitions;
export const isAccountAction = (action: string): action is AccountAction =>
  Object.hasOwn(definitions, action);
const commandHash = (action: AccountAction, target: string, b: unknown) =>
  hash(canonical({ action, target_id: target, command: b }));
export const accountState = (u: any, type: "users" | "tenants") =>
  u.admin_closed_at
    ? "closed"
    : u.status === "active"
      ? "active"
      : type === "users"
        ? "frozen"
        : "suspended";

/** An account spans every workspace. Tenant/project-only grants cannot freeze a
 * person's entire account; explicit overlapping denies also constrain globals. */
export async function userAccountAuthority(
  tx: Tx,
  p: Principal,
  user: string,
  permission: string,
) {
  await permit(tx, p, permission);
  const denies = (await bindings(tx, p)).filter(
    (b) =>
      b.effect === "deny" &&
      b.scope_kind !== "global" &&
      b.permissions.includes(permission),
  );
  if (
    denies.length &&
    (
      await tx.query(
        "SELECT 1 FROM memberships m WHERE m.user_id=$1 AND (m.tenant_id=ANY($2::uuid[]) OR EXISTS(SELECT 1 FROM projects p WHERE p.tenant_id=m.tenant_id AND p.id=ANY($3::uuid[]))) LIMIT 1",
        [
          user,
          denies
            .filter((b) => b.scope_kind === "tenant")
            .map((b) => b.scope_id),
          denies
            .filter((b) => b.scope_kind === "project")
            .map((b) => b.scope_id),
        ],
      )
    ).rowCount
  )
    throw new Problem(
      403,
      "ADMIN_FORBIDDEN",
      "A workspace or project deny prevents this global account action",
    );
}
async function authority(
  tx: Tx,
  p: Principal,
  a: AccountAction,
  target: string,
  permission = definitions[a].permission as string,
) {
  if (definitions[a].type === "users")
    await userAccountAuthority(tx, p, target, permission);
  else await membershipAdminAuthority(tx, p, target, permission);
  await requireSensitiveAdmin(tx, p);
}
export async function lockAccountTarget(
  tx: Tx,
  a: AccountAction,
  target: string,
) {
  if (definitions[a].type === "users") {
    await lockUserAuthorities(tx, [target]);
    if (a === "users.status.write") {
      const tenants = (
        await tx.query(
          "SELECT tenant_id FROM memberships WHERE user_id=$1 UNION SELECT tenant_id FROM invites WHERE created_by=$1 OR email=(SELECT email FROM users WHERE id=$1) ORDER BY tenant_id",
          [target],
        )
      ).rows;
      for (const t of tenants) await lockMemberships(tx, t.tenant_id);
    }
  } else await lockMemberships(tx, target);
}
export async function accountPolicy(
  tx: Tx,
  action: AccountAction | "users.status.batch",
) {
  const entry = await currentAdminControl(tx);
  const rules = z
    .object({
      account_close_requires_approval: z.boolean().default(true),
      account_approval_window_minutes: z
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
    recent_mfa_minutes: 10,
    scope: "global_account_or_enterprise_with_overlapping_denies",
    version: 1,
  };
  return { id: await pinAdminPolicy(tx, body), ...rules };
}
async function impact(tx: Tx, type: "users" | "tenants", target: string) {
  const counts = (
    await tx.query(
      `SELECT status,count(*)::int AS count FROM tasks WHERE ${type === "users" ? "created_by" : "tenant_id"}=$1 AND status IN ('queued','running','paused','awaiting_approval','needs_input','reconciling') GROUP BY status ORDER BY status`,
      [target],
    )
  ).rows;
  return {
    tasks: counts,
    cancellation_is_best_effort: true,
    accepted_usage_requires_settlement: true,
  };
}
async function inspect(tx: Tx, a: AccountAction, target: string, b: any) {
  const type = definitions[a].type;
  // Non-key changes must not block FK key-share locks held by task accounting.
  const row = (
    await tx.query(`SELECT * FROM ${type} WHERE id=$1 FOR NO KEY UPDATE`, [
      target,
    ])
  ).rows[0];
  if (!row) throw new Problem(404, "NOT_FOUND", "Account not found");
  if (b.expected_version !== undefined && row.version !== b.expected_version)
    throw new Problem(
      409,
      "VERSION_CONFLICT",
      "Account changed; refresh the preview",
    );
  if (b.state === "closed") {
    if (
      type === "users" &&
      (
        await tx.query(
          "SELECT 1 FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND m.role='owner' AND m.status='active' AND t.admin_closed_at IS NULL AND NOT EXISTS(SELECT 1 FROM memberships o JOIN users u ON u.id=o.user_id WHERE o.tenant_id=m.tenant_id AND o.user_id<>m.user_id AND o.role='owner' AND o.status='active' AND u.status='active') LIMIT 1",
          [target],
        )
      ).rowCount
    )
      throw new Problem(
        409,
        "OWNER_TRANSFER_REQUIRED",
        "Transfer ownership to another active owner before closing this account",
      );
    if (
      (
        await tx.query(
          `SELECT 1 FROM tasks t JOIN reservations r ON r.task_id=t.id WHERE t.${type === "users" ? "created_by" : "tenant_id"}=$1 AND r.status IN ('reserved','reconciling') LIMIT 1`,
          [target],
        )
      ).rowCount
    )
      throw new Problem(
        409,
        "UNSETTLED_USAGE",
        "Freeze access and settle or reconcile outstanding tasks before closure",
      );
  }
  return {
    row,
    before: {
      state: accountState(row, type),
      version: row.version,
      ...(type === "users"
        ? {
            display_name: row.name,
            labels: row.labels,
            auth_version: row.auth_version,
          }
        : { name: row.name }),
    },
  };
}
function needsApproval(
  policy: Awaited<ReturnType<typeof accountPolicy>>,
  a: AccountAction,
  b: any,
  before: any,
) {
  return (
    a.endsWith("status.write") &&
    policy.account_close_requires_approval &&
    (b.state === "closed" || before.state === "closed")
  );
}
export async function revokeUserCredentials(tx: Tx, user: string) {
  await tx.query(
    "UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
    [user],
  );
  await tx.query(
    "UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
    [user],
  );
  await tx.query(
    "UPDATE native_auth_codes SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL",
    [user],
  );
}
async function revokeAccountInvitations(
  tx: Tx,
  type: "users" | "tenants",
  target: string,
) {
  const ids = (
    await tx.query(
      `UPDATE invites SET revoked_at=now(),version=version+1 WHERE ${type === "users" ? "(created_by=$1 OR email=(SELECT email FROM users WHERE id=$1))" : "tenant_id=$1"} AND consumed_at IS NULL AND revoked_at IS NULL RETURNING id`,
      [target],
    )
  ).rows.map((r) => r.id);
  if (ids.length)
    await tx.query(
      "UPDATE invitation_deliveries SET state='cancelled',token_cipher=NULL,lease_id=NULL,lease_until=NULL WHERE invite_id=ANY($1::uuid[])",
      [ids],
    );
}
/** Used by canonical single-account commands and guarded legacy batch jobs. */
export async function changeAccountStatus(
  tx: Tx,
  type: "users" | "tenants",
  target: string,
  state: string,
  inflight: string,
) {
  const status = state === "active" ? "active" : "suspended";
  await tx.query(
    `UPDATE ${type} SET status=$2,admin_closed_at=CASE WHEN $3='closed' THEN coalesce(admin_closed_at,now()) ELSE NULL END,version=version+1${type === "users" ? ",auth_version=auth_version+1" : ""} WHERE id=$1`,
    [target, status, state],
  );
  if (type === "users") await revokeUserCredentials(tx, target);
  if (state !== "active") await revokeAccountInvitations(tx, type, target);
  if (inflight === "request_cancel") {
    const tasks = (
      await tx.query(
        `SELECT * FROM tasks WHERE ${type === "users" ? "created_by" : "tenant_id"}=$1 AND status IN ('queued','running','paused','awaiting_approval','needs_input','reconciling') ORDER BY id FOR UPDATE`,
        [target],
      )
    ).rows;
    for (const task of tasks) await requestTaskCancellation(tx, task);
  }
}
async function apply(
  tx: Tx,
  a: AccountAction,
  target: string,
  b: any,
  before: any,
  p: Principal,
  op: string,
) {
  if (a === "users.profile.write")
    await tx.query(
      "UPDATE users SET name=coalesce($2,name),labels=coalesce($3::jsonb,labels),version=version+1 WHERE id=$1",
      [
        target,
        b.display_name ?? null,
        b.labels === undefined ? null : JSON.stringify([...new Set(b.labels)]),
      ],
    );
  else if (a === "users.sessions.revoke") {
    await tx.query("UPDATE users SET auth_version=auth_version+1 WHERE id=$1", [
      target,
    ]);
    await revokeUserCredentials(tx, target);
  } else
    await changeAccountStatus(
      tx,
      definitions[a].type,
      target,
      b.state,
      b.inflight_policy,
    );
  const after = (
    await tx.query(
      `SELECT version,status,admin_closed_at${definitions[a].type === "users" ? ",name,labels,auth_version" : ""} FROM ${definitions[a].type} WHERE id=$1`,
      [target],
    )
  ).rows[0];
  await tx.query(
    "UPDATE admin_operations SET state='succeeded',result=$2,result_ids=$3,version=version+1 WHERE id=$1",
    [op, { target_id: target, before, after }, [target]],
  );
  await audit(
    tx,
    p,
    definitions[a].permission,
    target,
    "succeeded",
    {
      operation_id: op,
      reason: b.reason,
      before,
      after,
      inflight_policy: b.inflight_policy,
    },
    definitions[a].type === "tenants" ? target : undefined,
  );
}
function originalActor(op: any): Principal {
  return {
    id: op.principal_id,
    audience: "admin",
    sessionId: op.payload.actor_session_id,
    authVersion: op.payload.actor_auth_version,
    sessionHash: "",
    name: "",
    email: "",
  };
}
export async function decideAccountOperation(
  tx: Tx,
  reviewer: Principal,
  op: any,
  decision: "approve" | "reject",
  reason: string,
) {
  const a = op.action as AccountAction,
    target = uuid.parse(op.payload.target_id);
  await lockAdminAccess(tx);
  await lockAccountTarget(tx, a, target);
  await authority(tx, reviewer, a, target, "admin.approvals.decide");
  if (reviewer.id === op.principal_id)
    throw new Problem(
      403,
      "SELF_APPROVAL_FORBIDDEN",
      "A different administrator must review this operation",
    );
  if (decision === "reject")
    await tx.query(
      "UPDATE admin_operations SET state='cancelled',approved_by=$2,version=version+1 WHERE id=$1",
      [op.id, reviewer.id],
    );
  else {
    if (
      !(
        await tx.query("SELECT now()<$1::timestamptz AS valid", [
          op.payload.expires_at,
        ])
      ).rows[0].valid
    )
      throw new Problem(
        409,
        "OPERATION_EXPIRED",
        "This approval expired; submit a fresh account change",
      );
    const actor = originalActor(op),
      b = definitions[a].schema.parse(op.payload.command);
    await authority(tx, actor, a, target);
    if (commandHash(a, target, b) !== op.payload_hash)
      throw new Problem(
        409,
        "PAYLOAD_CHANGED",
        "Frozen account command was changed",
      );
    const policy = await accountPolicy(tx, a);
    if (policy.id !== op.policy_version_id)
      throw new Problem(
        409,
        "POLICY_CHANGED",
        "Policy changed; submit a fresh account change",
      );
    const checked = await inspect(tx, a, target, b);
    if (canonical(checked.before) !== canonical(op.payload.before))
      throw new Problem(
        409,
        "TARGET_CHANGED",
        "Account changed while awaiting review",
      );
    await apply(tx, a, target, b, checked.before, actor, op.id);
    await tx.query("UPDATE admin_operations SET approved_by=$2 WHERE id=$1", [
      op.id,
      reviewer.id,
    ]);
  }
  await audit(
    tx,
    reviewer,
    `admin.approval.${decision}`,
    op.id,
    "succeeded",
    { reason, payload_hash: op.payload_hash },
    op.tenant_id,
  );
  return adminOperationDTO(
    (await tx.query("SELECT * FROM admin_operations WHERE id=$1", [op.id]))
      .rows[0],
  );
}

export function registerAdminAccounts(app: FastifyInstance, db: Database) {
  const auth = { preHandler: requireAdmin(db) };
  for (const [action, def] of Object.entries(definitions) as [
    AccountAction,
    (typeof definitions)[AccountAction],
  ][]) {
    const path = `/v1/admin/${def.type}/:id/${def.path}`;
    app.post(path + "/preview", auth, async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const target = uuid.parse((req.params as any).id),
        b = def.schema.parse(req.body);
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          await lockAccountTarget(tx, action, target);
          await authority(tx, req.principal, action, target);
          const checked = await inspect(tx, action, target, b),
            policy = await accountPolicy(tx, action);
          const payload = {
            action,
            target_id: target,
            command: b,
            before: checked.before,
            policy_version_id: policy.id,
            approval: needsApproval(policy, action, b, checked.before),
            impact: await impact(tx, def.type, target),
          };
          const r = (
            await tx.query(
              "INSERT INTO admin_previews(principal_id,action,payload,payload_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '5 minutes') RETURNING id,expires_at",
              [
                req.principal.id,
                action,
                payload,
                commandHash(action, target, b),
              ],
            )
          ).rows[0];
          await audit(
            tx,
            req.principal,
            `admin.${action}.preview`,
            r.id,
            "succeeded",
            { target_id: target, payload_hash: commandHash(action, target, b) },
            def.type === "tenants" ? target : undefined,
          );
          return {
            ...r,
            ...payload,
            payload_hash: commandHash(action, target, b),
          };
        },
        undefined,
        true,
      );
    });
    app.post(path, auth, async (req, reply) => {
      reply.code(202).header("Cache-Control", "no-store");
      const target = uuid.parse((req.params as any).id),
        b = def.schema.parse(req.body),
        k = z.string().min(8).max(128).parse(req.headers["idempotency-key"]);
      const previewId =
        req.headers["x-admin-preview-id"] === undefined
          ? undefined
          : uuid.parse(req.headers["x-admin-preview-id"]);
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          await lockAccountTarget(tx, action, target);
          await authority(tx, req.principal, action, target);
          const saved = await replay(
            tx,
            req.principal.id,
            `admin.${action}:${target}`,
            k,
            { target_id: target, command: b },
            async () => {
              const checked = await inspect(tx, action, target, b),
                policy = await accountPolicy(tx, action),
                approval = needsApproval(policy, action, b, checked.before);
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
                  preview.payload_hash !== commandHash(action, target, b) ||
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
                target_id: target,
                command: b,
                before: checked.before,
                actor_session_id: req.principal.sessionId,
                actor_auth_version: req.principal.authVersion,
                expires_at: new Date(
                  Date.now() + policy.account_approval_window_minutes * 60000,
                ).toISOString(),
              };
              const op = (
                await tx.query(
                  "INSERT INTO admin_operations(principal_id,action,tenant_id,payload_hash,payload,idempotency_key,state,policy_version_id,target_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
                  [
                    req.principal.id,
                    action,
                    def.type === "tenants" ? target : null,
                    commandHash(action, target, b),
                    payload,
                    `account:${operationKey(action, target, k)}`,
                    approval ? "pending_approval" : "running",
                    policy.id,
                    [target],
                  ],
                )
              ).rows[0];
              if (approval)
                await audit(
                  tx,
                  req.principal,
                  def.permission,
                  op.id,
                  "pending_approval",
                  {
                    reason: b.reason,
                    before: checked.before,
                    payload_hash: op.payload_hash,
                    policy_version_id: policy.id,
                  },
                  op.tenant_id,
                );
              else
                await apply(
                  tx,
                  action,
                  target,
                  b,
                  checked.before,
                  req.principal,
                  op.id,
                );
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
    });
  }
  for (const type of ["users", "tenants"] as const)
    app.get(
      `/v1/admin/${type}/:id/account-control`,
      auth,
      async (req, reply) => {
        reply.header("Cache-Control", "no-store");
        const target = uuid.parse((req.params as any).id);
        return db.tx(
          async (tx) => {
            await lockAdminAccess(tx);
            await lockAccountTarget(
              tx,
              type === "users" ? "users.status.write" : "tenants.status.write",
              target,
            );
            if (type === "users")
              await userAccountAuthority(
                tx,
                req.principal,
                target,
                "admin.users.read",
              );
            else
              await membershipAdminAuthority(
                tx,
                req.principal,
                target,
                "admin.tenants.read",
              );
            await requireSensitiveAdmin(tx, req.principal);
            const row = (
              await tx.query(`SELECT * FROM ${type} WHERE id=$1`, [target])
            ).rows[0];
            if (!row) throw new Problem(404, "NOT_FOUND", "Account not found");
            const capabilities: string[] = [];
            for (const [a, d] of Object.entries(definitions) as [
              AccountAction,
              (typeof definitions)[AccountAction],
            ][])
              if (d.type === type) {
                try {
                  await authority(tx, req.principal, a, target);
                  capabilities.push(a);
                } catch (e) {
                  if (!(e instanceof Problem) || e.status !== 403) throw e;
                }
              }
            await audit(
              tx,
              req.principal,
              `admin.${type}.account-control.read`,
              target,
              "succeeded",
              {},
              type === "tenants" ? target : undefined,
            );
            return {
              id: target,
              version: row.version,
              state: accountState(row, type),
              display_name: row.name,
              ...(type === "users"
                ? { labels: row.labels, auth_version: row.auth_version }
                : {}),
              capabilities,
              impact: await impact(tx, type, target),
            };
          },
          undefined,
          true,
        );
      },
    );
  app.get(
    "/v1/admin/operations/:id/account-review",
    auth,
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const id = uuid.parse((req.params as any).id);
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          const op = (
            await tx.query("SELECT * FROM admin_operations WHERE id=$1", [id])
          ).rows[0];
          if (!op || !isAccountAction(op.action))
            throw new Problem(404, "NOT_FOUND", "Account operation not found");
          await lockAccountTarget(tx, op.action, op.payload.target_id);
          await authority(
            tx,
            req.principal,
            op.action,
            op.payload.target_id,
            "admin.approvals.read",
          );
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
            target_id: op.payload.target_id,
            command: op.payload.command,
            before: op.payload.before,
            expires_at: op.payload.expires_at,
            policy: policy?.body,
          };
        },
        undefined,
        true,
      );
    },
  );
}
const operationKey = (a: AccountAction, target: string, key: string) =>
  hash(canonical({ a, target, key }));
