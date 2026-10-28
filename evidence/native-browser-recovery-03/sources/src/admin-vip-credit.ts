import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import { audit, requireAdmin, type Principal } from "./auth.js";
import { lockAdminAccess } from "./admin-access.js";
import { vipCreate, vipMode } from "./vip.js";
import {
  vipAuthority,
  inspectCombinedVip,
  applyCombinedVip,
} from "./admin-vip.js";
import {
  feeGift,
  financialAccount,
  financialAuthority,
  inspectCombinedGift,
  applyCombinedGift,
} from "./admin-fees.js";
import { pinAdminPolicy } from "./admin-operation-policy.js";
import { adminOperationDTO } from "./admin-memberships.js";
import { createApprovalRequest } from "./admin-approval-storage.js";
import { key, replay } from "./access.js";
import { canonical, hash, Problem, uuid } from "./lib.js";

const action = "entitlements.grant_with_credit";
const root = "/v1/admin/vip-credit-combinations";
const previews = "/v1/admin/vip-credit-previews";
export const vipCreditCommand = z
  .object({ billing_account_id: uuid, vip: vipCreate, gift: feeGift })
  .strict();
type Command = z.infer<typeof vipCreditCommand>;
const commandHash = (command: Command) => hash(canonical({ action, command }));
export const isVipCreditOperation = (op: any) =>
  op?.payload?.vip_credit_command_version === 1;

function frozen(op: any) {
  const b = vipCreditCommand.parse(op.payload.command);
  if (
    op.action !== action ||
    commandHash(b) !== op.payload_hash ||
    op.payload.subject_kind !== b.vip.subject.kind ||
    op.payload.subject_id !== b.vip.subject.id ||
    op.payload.billing_account_id !== b.billing_account_id
  )
    throw new Problem(
      409,
      "PAYLOAD_CHANGED",
      "The combined command no longer matches its frozen intent",
    );
  return b;
}
async function authority(
  tx: Tx,
  actor: Principal,
  b: Command,
  mode: string,
  permission?: string,
) {
  const wallet = (
    await tx.query("SELECT * FROM wallets WHERE id=$1 AND data_mode=$2", [
      b.billing_account_id,
      mode,
    ])
  ).rows[0];
  const subject = b.vip.subject;
  if (
    !wallet ||
    (subject.kind === "user"
      ? wallet.user_id !== subject.id || wallet.tenant_id !== null
      : wallet.tenant_id !== subject.id || wallet.user_id !== null)
  )
    throw new Problem(
      404,
      "SUBJECT_ACCOUNT_MISMATCH",
      "Choose the billing account belonging to this exact subject and data mode",
    );
  await vipAuthority(tx, actor, subject, "admin.entitlements.read");
  await financialAuthority(tx, actor, wallet, "admin.billing.read");
  if (permission === "combination.write") {
    await vipAuthority(
      tx,
      actor,
      subject,
      "admin.entitlements.grant",
      Math.ceil(
        (Date.parse(b.vip.ends_at) - Date.parse(b.vip.starts_at)) / 3600000,
      ),
    );
    await financialAuthority(
      tx,
      actor,
      wallet,
      "admin.billing.gift",
      BigInt(b.gift.amount.amount_micros),
    );
  } else if (permission) {
    await vipAuthority(tx, actor, subject, permission);
    await financialAuthority(tx, actor, wallet, permission);
  }
  return wallet;
}
export async function vipCreditOperationAuthority(
  tx: Tx,
  actor: Principal,
  op: any,
  permission: string,
) {
  const mode = (
    await tx.query("SELECT current_setting('app.data_mode',true) AS mode")
  ).rows[0].mode;
  if (!isVipCreditOperation(op) || op.payload.data_mode !== mode)
    throw new Problem(
      404,
      "NOT_FOUND",
      "Combined operation not found in this mode",
    );
  return authority(tx, actor, frozen(op), mode, permission);
}
async function inspect(tx: Tx, db: Database, actor: Principal, b: Command) {
  await lockAdminAccess(tx);
  await authority(
    tx,
    actor,
    b,
    vipMode(db.config.DEMO_MODE),
    "combination.write",
  );
  // Match the canonical VIP lock order: subject, then billing account.
  const vip = await inspectCombinedVip(tx, db, actor, b.vip);
  const wallet = await financialAccount(tx, db, b.billing_account_id);
  const gift = await inspectCombinedGift(tx, actor, wallet, b.gift);
  return {
    vip,
    gift,
    wallet,
    before: { vip: vip.before, gift: gift.checked.before },
    policy: await pinAdminPolicy(tx, {
      type: "vip-credit-combination.v1",
      vip_policy_version_id: vip.rules.id,
      gift_policy_version_id: gift.rules.id,
    }),
    approval: vip.approval || gift.approval,
    minutes: Math.min(
      vip.rules.vip_approval_window_minutes,
      gift.rules.minutes,
    ),
  };
}
type Inspection = Awaited<ReturnType<typeof inspect>>;
function unchanged(checked: Inspection, payload: any) {
  if (checked.policy !== payload.policy_version_id)
    throw new Problem(
      409,
      "POLICY_CHANGED",
      "Create a fresh combined preview under current policy",
    );
  if (canonical(checked.before) !== canonical(payload.before))
    throw new Problem(
      409,
      "TARGET_CHANGED",
      "Entitlement, payment or billing facts changed; preview both effects again",
    );
}
async function execute(
  tx: Tx,
  actor: Principal,
  parent: any,
  checked: Inspection,
) {
  const b = frozen(parent),
    common = {
      actor_session_id: parent.payload.actor_session_id,
      actor_auth_version: parent.payload.actor_auth_version,
      expires_at: parent.payload.expires_at,
      combination_parent_id: parent.id,
    };
  async function child(
    childAction: string,
    payload: any,
    payloadHash: string,
    policy: string,
    targets: string[],
  ) {
    return (
      await tx.query(
        "INSERT INTO admin_operations(principal_id,action,tenant_id,payload_hash,payload,idempotency_key,state,policy_version_id,target_ids,approved_by) VALUES($1,$2,$3,$4,$5,$6,'running',$7,$8,$9) RETURNING *",
        [
          actor.id,
          childAction,
          parent.tenant_id,
          payloadHash,
          { ...payload, ...common },
          hash(`vip-credit-child:${parent.id}:${childAction}`),
          policy,
          targets,
          parent.approved_by,
        ],
      )
    ).rows[0];
  }
  const vip = await child(
    "entitlements.grant",
    {
      vip_command_version: 1,
      target_id: b.vip.subject.id,
      subject_kind: b.vip.subject.kind,
      subject_id: b.vip.subject.id,
      data_mode: parent.payload.data_mode,
      command: b.vip,
      before: checked.vip.before,
      policy_version_id: checked.vip.rules.id,
      approval: false,
    },
    hash(
      canonical({
        action: "entitlements.grant",
        target_id: b.vip.subject.id,
        command: b.vip,
      }),
    ),
    checked.vip.rules.id,
    [b.vip.subject.id, b.vip.plan_version_id],
  );
  const gift = await child(
    "billing.gift",
    {
      financial_command_version: 1,
      billing_account_id: b.billing_account_id,
      command: b.gift,
      before: checked.gift.checked.before,
      policy_version_id: checked.gift.rules.id,
      approval: false,
    },
    hash(
      canonical({ billing_account_id: b.billing_account_id, command: b.gift }),
    ),
    checked.gift.rules.id,
    [b.billing_account_id],
  );
  await applyCombinedVip(tx, actor, vip, checked.vip);
  await applyCombinedGift(
    tx,
    actor,
    checked.wallet,
    b.gift,
    checked.gift.checked,
    gift,
  );
  const children = (
    await tx.query(
      "SELECT * FROM admin_operations WHERE id=ANY($1::uuid[]) ORDER BY action",
      [[vip.id, gift.id]],
    )
  ).rows;
  const v = children.find((c) => c.id === vip.id)!,
    g = children.find((c) => c.id === gift.id)!;
  await tx.query(
    "INSERT INTO admin_vip_credit_combinations(parent_operation_id,vip_operation_id,gift_operation_id,grant_id,credit_journal_id) VALUES($1,$2,$3,$4,$5)",
    [parent.id, vip.id, gift.id, v.result.grant_id, g.result.journal_ids[0]],
  );
  await tx.query(
    "UPDATE admin_operations SET state='succeeded',version=version+1,result=$2,result_ids=$3 WHERE id=$1",
    [
      parent.id,
      {
        atomic: true,
        vip_operation_id: vip.id,
        gift_operation_id: gift.id,
        grant_id: v.result.grant_id,
        billing_account_id: b.billing_account_id,
        journal_ids: g.result.journal_ids,
        credit_reference: `admin:${gift.id}`,
      },
      [vip.id, gift.id, ...new Set<string>([...v.result_ids, ...g.result_ids])],
    ],
  );
  await audit(
    tx,
    actor,
    "admin.entitlements.grant",
    parent.id,
    "succeeded",
    {
      combined_credit: true,
      vip_operation_id: vip.id,
      gift_operation_id: gift.id,
      vip_reason: b.vip.reason,
      gift_reason: b.gift.reason,
      policy_version_id: parent.policy_version_id,
    },
    parent.tenant_id ?? undefined,
  );
}
export async function decideVipCreditOperation(
  tx: Tx,
  db: Database,
  reviewer: Principal,
  op: any,
  b: { decision: "approve" | "reject"; reason: string },
) {
  await vipCreditOperationAuthority(tx, reviewer, op, "combination.write");
  if (b.decision === "reject") {
    await tx.query(
      "UPDATE admin_operations SET state='cancelled',version=version+1,approved_by=$2,result=$3 WHERE id=$1",
      [op.id, reviewer.id, { review_reason: b.reason }],
    );
    return;
  }
  const actor: Principal = {
    id: op.principal_id,
    audience: "admin",
    sessionId: op.payload.actor_session_id,
    authVersion: op.payload.actor_auth_version,
    sessionHash: "",
    name: "",
    email: "",
  };
  await vipCreditOperationAuthority(tx, actor, op, "combination.write");
  const checked = await inspect(tx, db, actor, frozen(op));
  // Reviewer limits apply independently to the same amount and interval.
  await vipAuthority(
    tx,
    reviewer,
    checked.vip.subject,
    "admin.entitlements.grant",
    checked.vip.hours,
  );
  unchanged(checked, op.payload);
  const running = (
    await tx.query(
      "UPDATE admin_operations SET state='running',approved_by=$2 WHERE id=$1 RETURNING *",
      [op.id, reviewer.id],
    )
  ).rows[0];
  await execute(tx, actor, running, checked);
}

export function registerAdminVipCredit(app: FastifyInstance, db: Database) {
  const auth = { preHandler: requireAdmin(db) },
    mode = vipMode(db.config.DEMO_MODE);
  app.post(previews, auth, async (req) => {
    const b = vipCreditCommand.parse(req.body);
    return db.tx(
      async (tx) => {
        await lockAdminAccess(tx);
        await authority(tx, req.principal, b, mode, "combination.write");
        return replay(
          tx,
          req.principal.id,
          `vip-credit.preview:${mode}`,
          key(req),
          b,
          async () => {
            const checked = await inspect(tx, db, req.principal, b);
            const payload = {
              vip_credit_command_version: 1,
              data_mode: mode,
              subject_kind: b.vip.subject.kind,
              subject_id: b.vip.subject.id,
              billing_account_id: b.billing_account_id,
              command: b,
              before: checked.before,
              policy_version_id: checked.policy,
              vip_policy_version_id: checked.vip.rules.id,
              gift_policy_version_id: checked.gift.rules.id,
              actor_session_id: req.principal.sessionId,
              actor_auth_version: req.principal.authVersion,
              approval: checked.approval,
            };
            const row = (
              await tx.query(
                "INSERT INTO admin_previews(principal_id,action,payload,payload_hash,expires_at) VALUES($1,$2,$3,$4,now()+$5*interval '1 minute') RETURNING *",
                [
                  req.principal.id,
                  action,
                  payload,
                  commandHash(b),
                  checked.minutes,
                ],
              )
            ).rows[0];
            await audit(
              tx,
              req.principal,
              "admin.entitlements.grant",
              row.id,
              "preview",
              { combined_credit: true },
              checked.wallet.tenant_id ?? undefined,
            );
            return {
              preview_id: row.id,
              payload_hash: row.payload_hash,
              target_ids: [
                b.vip.subject.id,
                b.vip.plan_version_id,
                b.billing_account_id,
              ],
              policy_version_id: checked.policy,
              decision: checked.approval
                ? "independent_approval"
                : "recent_mfa",
              missing_permission_keys: [],
              impact_summary:
                "Grant this fixed VIP interval and explicit expiring HKD credit atomically. Independent credit reference; no charge or renewal.",
              expires_at: new Date(row.expires_at).toISOString(),
              creates_business_effect: false,
              expected_target_versions: [
                { id: b.vip.subject.id, version: checked.vip.subject_revision },
                { id: b.billing_account_id, version: checked.wallet.version },
              ],
            };
          },
        );
      },
      undefined,
      true,
    );
  });
  app.get(previews + "/:id", auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    return db.tx(
      async (tx) => {
        z.object({}).strict().parse(req.query);
        await lockAdminAccess(tx);
        const row = (
          await tx.query(
            "SELECT * FROM admin_previews WHERE id=$1 AND principal_id=$2 AND action=$3",
            [uuid.parse((req.params as any).id), req.principal.id, action],
          )
        ).rows[0];
        if (!row || row.payload.data_mode !== mode)
          throw new Problem(404, "NOT_FOUND", "Combined preview not found");
        await authority(
          tx,
          req.principal,
          row.payload.command,
          mode,
          "combination.write",
        );
        return {
          command: row.payload.command,
          before: row.payload.before,
          expires_at: new Date(row.expires_at).toISOString(),
        };
      },
      undefined,
      true,
    );
  });
  app.post(root, auth, async (req, reply) => {
    const b = vipCreditCommand.parse(req.body);
    reply.code(202);
    return db.tx(
      async (tx) => {
        await lockAdminAccess(tx);
        await authority(tx, req.principal, b, mode, "combination.write");
        const saved = await replay(
          tx,
          req.principal.id,
          `vip-credit.commit:${mode}`,
          key(req),
          b,
          async () => {
            const row = (
              await tx.query(
                "SELECT *,expires_at>now() AS valid FROM admin_previews WHERE id=$1 AND principal_id=$2 FOR UPDATE",
                [
                  uuid.parse(req.headers["x-admin-preview-id"]),
                  req.principal.id,
                ],
              )
            ).rows[0];
            if (
              !row ||
              !row.valid ||
              row.consumed_at ||
              row.action !== action ||
              row.payload_hash !== commandHash(b) ||
              row.payload.data_mode !== mode ||
              row.payload.actor_session_id !== req.principal.sessionId ||
              row.payload.actor_auth_version !== req.principal.authVersion
            )
              throw new Problem(
                409,
                "PREVIEW_INVALID",
                "Create a current preview of this exact VIP and credit command",
              );
            const checked = await inspect(tx, db, req.principal, b);
            unchanged(checked, row.payload);
            const op = (
              await tx.query(
                "INSERT INTO admin_operations(principal_id,action,tenant_id,payload_hash,payload,idempotency_key,state,policy_version_id,target_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
                [
                  req.principal.id,
                  action,
                  checked.wallet.tenant_id,
                  row.payload_hash,
                  {
                    ...row.payload,
                    expires_at: new Date(row.expires_at).toISOString(),
                  },
                  hash(`vip-credit:${mode}:${req.principal.id}:${key(req)}`),
                  checked.approval ? "pending_approval" : "running",
                  checked.policy,
                  [
                    b.vip.subject.id,
                    b.vip.plan_version_id,
                    b.billing_account_id,
                  ],
                ],
              )
            ).rows[0];
            if (checked.approval) await createApprovalRequest(tx, op);
            else await execute(tx, req.principal, op, checked);
            await tx.query(
              "UPDATE admin_previews SET consumed_at=now() WHERE id=$1",
              [row.id],
            );
            if (checked.approval)
              await audit(
                tx,
                req.principal,
                "admin.entitlements.grant",
                op.id,
                "pending_approval",
                { combined_credit: true },
                op.tenant_id ?? undefined,
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
  app.get(root + "/:id", auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    return db.tx(
      async (tx) => {
        z.object({}).strict().parse(req.query);
        await lockAdminAccess(tx);
        const op = (
          await tx.query("SELECT * FROM admin_operations WHERE id=$1", [
            uuid.parse((req.params as any).id),
          ])
        ).rows[0];
        if (!op || !isVipCreditOperation(op))
          throw new Problem(404, "NOT_FOUND", "Combined operation not found");
        await vipCreditOperationAuthority(
          tx,
          req.principal,
          op,
          "admin.jobs.read",
        );
        const link = (
          await tx.query(
            "SELECT * FROM admin_vip_credit_combinations WHERE parent_operation_id=$1",
            [op.id],
          )
        ).rows[0];
        const children = link
          ? (
              await tx.query(
                "SELECT * FROM admin_operations WHERE id=ANY($1::uuid[]) ORDER BY action",
                [[link.vip_operation_id, link.gift_operation_id]],
              )
            ).rows
          : [];
        await audit(tx, req.principal, "admin.jobs.read", op.id);
        return {
          operation: adminOperationDTO(op),
          command: op.payload.command,
          before: op.payload.before,
          atomic: true,
          children: children.map((c) => ({
            operation: adminOperationDTO(c),
            result: c.result,
          })),
          result: op.result,
        };
      },
      undefined,
      true,
    );
  });
}
