import { approvalDTO } from "./admin-approval-storage.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import { audit, requireAdmin, type Principal } from "./auth.js";
import {
  lockAdminAccess,
  permit,
  requireSensitiveAdmin,
} from "./admin-access.js";
import { userAccountAuthority } from "./admin-accounts.js";
import {
  membershipAdminAuthority,
  adminOperationDTO,
} from "./admin-memberships.js";
import {
  currentAdminControl,
  pinAdminPolicy,
} from "./admin-operation-policy.js";
import { fund, setBillingAccountLimit } from "./billing.js";
import { replay } from "./access.js";
import { canonical, hash, Problem, uuid } from "./lib.js";

const amount = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine(
    (v) => BigInt(v) <= 9223372036854775807n,
    "Amount exceeds database range",
  );
const money = z
  .object({ currency: z.literal("HKD"), amount_micros: amount })
  .strict();
const positive = money.refine(
  (m) => BigInt(m.amount_micros) > 0n,
  "Amount must be positive",
);
const reason = z.string().min(3).max(1000);
const base = { expected_version: z.number().int().min(1), reason };
export const feeGift = z
  .object({
    ...base,
    action: z.literal("gift"),
    amount: positive,
    expires_at: z.string().datetime({ offset: true }),
  })
  .strict();
export const feeDebit = z
  .object({
    ...base,
    action: z.literal("debit"),
    amount: positive,
    original_entry_id: uuid,
  })
  .strict();
export const feeLimit = z
  .object({ ...base, action: z.literal("credit_limit"), new_limit: money })
  .strict();
const command = z.discriminatedUnion("action", [feeGift, feeDebit, feeLimit]);
type Command = z.infer<typeof command>;
const definitions = {
  gift: {
    permission: "admin.billing.gift",
    action: "billing.gift",
    path: "gift",
    schema: feeGift,
  },
  debit: {
    permission: "admin.billing.debit",
    action: "billing.debit",
    path: "debit",
    schema: feeDebit,
  },
  credit_limit: {
    permission: "admin.billing.credit_limit.write",
    action: "billing.credit_limit.write",
    path: "credit-limit",
    schema: feeLimit,
  },
} as const;
const value = (b: Command) =>
  BigInt(
    b.action === "credit_limit"
      ? b.new_limit.amount_micros
      : b.amount.amount_micros,
  );
const payloadHash = (id: string, b: Command) =>
  hash(canonical({ billing_account_id: id, command: b }));
const key = (h: Record<string, unknown>) =>
  z.string().min(8).max(128).parse(h["idempotency-key"]);
export const isFeeOperation = (op: any) =>
  op?.payload?.financial_command_version === 1 &&
  Object.values(definitions).some((d) => d.action === op.action);
export const isGuardedLegacyFee = (action: string) =>
  Object.values(definitions).some((d) => d.action === action);

function frozenCommand(op: any) {
  const parsed = command.safeParse(op.payload?.command);
  if (
    !parsed.success ||
    definitions[parsed.data.action].action !== op.action ||
    !Array.isArray(op.target_ids) ||
    op.target_ids.length !== 1 ||
    op.target_ids[0] !== op.payload.billing_account_id ||
    payloadHash(op.payload.billing_account_id, parsed.data) !== op.payload_hash
  )
    throw new Problem(
      409,
      "PAYLOAD_CHANGED",
      "Frozen financial command does not match its recorded intent",
    );
  return parsed.data;
}

async function account(tx: Tx, db: Database, id: string) {
  const row = (
    await tx.query("SELECT * FROM wallets WHERE id=$1 FOR NO KEY UPDATE", [id])
  ).rows[0];
  if (
    !row ||
    row.data_mode !==
      (db.config.DEMO_MODE ? "simulated" : "configured_services")
  )
    throw new Problem(404, "NOT_FOUND", "Billing account not found");
  return row;
}
export async function feeOperationAuthority(
  tx: Tx,
  p: Principal,
  op: any,
  permission: string,
) {
  frozenCommand(op);
  const w = (
    await tx.query("SELECT * FROM wallets WHERE id=$1", [
      op.payload.billing_account_id,
    ])
  ).rows[0];
  if (!w) throw new Problem(404, "NOT_FOUND", "Billing account not found");
  await authority(tx, p, w, permission);
}
async function authority(
  tx: Tx,
  p: Principal,
  w: any,
  permission: string,
  amount?: bigint,
) {
  if (w.user_id) await userAccountAuthority(tx, p, w.user_id, permission);
  else await membershipAdminAuthority(tx, p, w.tenant_id, permission);
  await requireSensitiveAdmin(tx, p);
  return permit(
    tx,
    p,
    permission,
    w.tenant_id ? { tenant: w.tenant_id } : {},
    amount === undefined ? undefined : { amount },
  );
}
async function policy(tx: Tx) {
  const entry = await currentAdminControl(tx);
  const threshold = amount
    .refine((v) => BigInt(v) > 0n)
    .parse(String(entry?.body?.approval_threshold_micros ?? 10_000_000_000));
  const minutes = z
    .number()
    .int()
    .min(1)
    .max(10)
    .parse(entry?.body?.fee_approval_window_minutes ?? 5);
  const body = {
    type: "financial-command.v1",
    source: entry
      ? { id: entry.id, version: entry.version, body: entry.body }
      : null,
    approval_threshold_micros: threshold,
    fee_approval_window_minutes: minutes,
    preview_business_effect: false,
  };
  return {
    id: await pinAdminPolicy(tx, body),
    threshold: BigInt(threshold),
    minutes,
  };
}
// This function deliberately does not call billingAccount()/wallet(): those
// execution helpers expire gifts and would give a preview business effects.
async function inspect(tx: Tx, w: any, b: Command) {
  if (w.version !== b.expected_version)
    throw new Problem(
      409,
      "VERSION_CONFLICT",
      "Account changed; refresh before previewing",
    );
  const sums = (
    await tx.query(
      "SELECT coalesce(sum(remaining_micros),0)::text AS gross,coalesce(sum(remaining_micros-reserved_micros) FILTER(WHERE expires_at<=now()),0)::text AS expired_free FROM funding_lots WHERE billing_account_id=$1",
      [w.id],
    )
  ).rows[0];
  const debt = BigInt(sums.gross) - BigInt(w.balance_micros),
    effectiveBalance = BigInt(w.balance_micros) - BigInt(sums.expired_free);
  if (b.action === "gift" && effectiveBalance + value(b) > 9223372036854775807n)
    throw new Problem(
      409,
      "AMOUNT_RANGE",
      "The resulting balance exceeds the supported range",
    );
  if (debt < 0n)
    throw new Problem(
      409,
      "BILLING_RECONCILIATION_REQUIRED",
      "Recorded funding does not cover the account balance",
    );
  const before: any = {
    version: w.version,
    balance_micros: w.balance_micros,
    reserved_micros: w.reserved_micros,
    credit_limit_micros: w.credit_limit_micros,
    gross_micros: sums.gross,
    expired_free_micros: sums.expired_free,
  };
  let source: any;
  if (
    b.action === "gift" &&
    !(await tx.query("SELECT $1::timestamptz>now() AS valid", [b.expires_at]))
      .rows[0].valid
  )
    throw new Problem(
      400,
      "EXPIRY_INVALID",
      "Gift expiry must be in the future",
    );
  if (
    b.action === "credit_limit" &&
    (value(b) < debt || effectiveBalance + value(b) < BigInt(w.reserved_micros))
  )
    throw new Problem(
      409,
      "CREDIT_RESERVED",
      "Existing debt or reserved commitments exceed this limit",
    );
  if (b.action === "debit") {
    source = (
      await tx.query(
        "SELECT j.id,j.kind,j.raw_entry_id,f.id AS lot_id,f.remaining_micros,f.reserved_micros,f.expires_at,(f.expires_at IS NULL OR f.expires_at>now()) AS valid FROM billing_journal j JOIN funding_lots f ON f.ledger_id=j.raw_entry_id AND f.billing_account_id=j.billing_account_id WHERE j.id=$1 AND j.billing_account_id=$2 AND j.kind IN ('top_up','gift')",
        [b.original_entry_id, w.id],
      )
    ).rows[0];
    if (!source)
      throw new Problem(
        409,
        "INVALID_SOURCE",
        "Choose an original funding entry in this account",
      );
    if (
      !source.valid ||
      BigInt(source.remaining_micros) - BigInt(source.reserved_micros) <
        value(b) ||
      effectiveBalance - BigInt(w.reserved_micros) < value(b)
    )
      throw new Problem(
        409,
        "FUNDS_UNAVAILABLE",
        "Source credit is spent, expired or reserved",
      );
    before.source = {
      id: source.id,
      lot_id: source.lot_id,
      remaining_micros: source.remaining_micros,
      reserved_micros: source.reserved_micros,
      expires_at: source.expires_at?.toISOString() ?? null,
    };
  }
  const risk =
    b.action === "credit_limit"
      ? value(b) > BigInt(w.credit_limit_micros)
        ? value(b) - BigInt(w.credit_limit_micros)
        : 0n
      : value(b);
  return { before, source, risk };
}
async function daily(
  tx: Tx,
  p: Principal,
  allowed: any[],
  b: Command,
  risk: bigint,
  dataMode: string,
) {
  if (allowed.some((a) => a.limits.max_daily_amount_micros === undefined))
    return;
  const spent = BigInt(
    (
      await tx.query(
        "SELECT coalesce(sum(CASE WHEN j.kind='credit_limit' THEN greatest(0,j.amount_micros-coalesce((o.payload#>>'{before,credit_limit_micros}')::numeric,0)) ELSE j.amount_micros END),0)::text AS n FROM billing_journal j JOIN admin_operations o ON o.id=j.operation_id JOIN wallets w ON w.id=j.billing_account_id WHERE j.actor_id=$1 AND o.action=$2 AND w.data_mode=$3 AND j.created_at>=(date_trunc('day',now() AT TIME ZONE 'Asia/Hong_Kong') AT TIME ZONE 'Asia/Hong_Kong')",
        [p.id, definitions[b.action].action, dataMode],
      )
    ).rows[0].n,
  );
  if (
    !allowed.some(
      (a) => spent + risk <= BigInt(a.limits.max_daily_amount_micros),
    )
  )
    throw new Problem(
      403,
      "DAILY_AMOUNT_LIMIT",
      "This administrator's daily financial limit would be exceeded",
    );
}
const approval = (
  p: Awaited<ReturnType<typeof policy>>,
  checked: Awaited<ReturnType<typeof inspect>>,
) => checked.risk >= p.threshold;
async function apply(
  tx: Tx,
  p: Principal,
  w: any,
  b: Command,
  checked: Awaited<ReturnType<typeof inspect>>,
  op: any,
) {
  const result =
    b.action === "credit_limit"
      ? await setBillingAccountLimit(tx, w.id, b.new_limit.amount_micros, {
          actor_id: p.id,
          admin_operation_id: op.id,
          reason: b.reason,
        })
      : await fund(
          tx,
          {
            billing_account_id: w.id,
            action: b.action,
            amount_micros: b.amount.amount_micros,
            reason: b.reason,
            ...(b.action === "gift"
              ? { expires_at: b.expires_at }
              : { source_id: checked.source.raw_entry_id }),
          },
          `admin:${op.id}`,
        );
  const journal = (
    await tx.query(
      "SELECT id FROM billing_journal WHERE operation_id=$1 ORDER BY id",
      [op.id],
    )
  ).rows.map((r) => r.id);
  const after = (
    await tx.query(
      "SELECT version,balance_micros,reserved_micros,credit_limit_micros FROM wallets WHERE id=$1",
      [w.id],
    )
  ).rows[0];
  await tx.query(
    "UPDATE admin_operations SET state='succeeded',result=$2,result_ids=$3,version=version+1 WHERE id=$1",
    [
      op.id,
      {
        billing_account_id: w.id,
        before: checked.before,
        after,
        journal_ids: journal,
      },
      journal,
    ],
  );
  await audit(
    tx,
    p,
    definitions[b.action].permission,
    op.id,
    "succeeded",
    {
      reason: b.reason,
      billing_account_id: w.id,
      before: checked.before,
      after,
      policy_version_id: op.policy_version_id,
    },
    w.tenant_id ?? undefined,
  );
  return result;
}
const actor = (op: any): Principal => ({
  id: op.principal_id,
  audience: "admin",
  sessionId: op.payload.actor_session_id,
  authVersion: op.payload.actor_auth_version,
  sessionHash: "",
  name: "",
  email: "",
});
export function registerAdminFees(app: FastifyInstance, db: Database) {
  const auth = { preHandler: requireAdmin(db) },
    root = "/v1/admin/billing/accounts/:account";
  app.post(root + "/previews", auth, async (req) => {
    const id = uuid.parse((req.params as any).account),
      b = command.parse(req.body);
    return db.tx(
      async (tx) => {
        await lockAdminAccess(tx);
        const w = await account(tx, db, id),
          allowed = await authority(
            tx,
            req.principal,
            w,
            definitions[b.action].permission,
            value(b),
          );
        return replay(
          tx,
          req.principal.id,
          `fee.preview:${id}`,
          key(req.headers),
          b,
          async () => {
            const checked = await inspect(tx, w, b),
              rules = await policy(tx);
            await daily(
              tx,
              req.principal,
              allowed,
              b,
              checked.risk,
              w.data_mode,
            );
            const payload = {
              financial_command_version: 1,
              billing_account_id: id,
              command: b,
              before: checked.before,
              policy_version_id: rules.id,
              approval: approval(rules, checked),
            };
            const row = (
              await tx.query(
                "INSERT INTO admin_previews(principal_id,action,payload,payload_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '5 minutes') RETURNING id,expires_at",
                [
                  req.principal.id,
                  definitions[b.action].action,
                  payload,
                  payloadHash(id, b),
                ],
              )
            ).rows[0];
            await audit(
              tx,
              req.principal,
              "admin.fee.preview",
              row.id,
              "succeeded",
              { billing_account_id: id, payload_hash: payloadHash(id, b) },
              w.tenant_id ?? undefined,
            );
            return {
              preview_id: row.id,
              payload_hash: payloadHash(id, b),
              target_ids: [id],
              policy_version_id: rules.id,
              decision: payload.approval
                ? "independent_approval"
                : "recent_mfa",
              missing_permission_keys: [],
              impact_summary:
                b.action === "credit_limit"
                  ? `Set credit limit to HKD ${b.new_limit.amount_micros} micros; no payment or VIP change.`
                  : b.action === "gift"
                    ? `Grant HKD ${b.amount.amount_micros} micros until ${b.expires_at}; no payment received.`
                    : `Debit HKD ${b.amount.amount_micros} micros from original funding entry ${b.original_entry_id}; no cash refund.`,
              expires_at: row.expires_at.toISOString(),
              creates_business_effect: false,
              expected_target_versions: [{ id, version: w.version }],
            };
          },
        );
      },
      undefined,
      true,
    );
  });
  for (const def of Object.values(definitions))
    app.post(root + "/" + def.path, auth, async (req, reply) => {
      reply.code(202);
      const id = uuid.parse((req.params as any).account),
        b = def.schema.parse(req.body),
        preview = uuid.optional().parse(req.headers["x-admin-preview-id"]);
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          const w = await account(tx, db, id),
            allowed = await authority(
              tx,
              req.principal,
              w,
              def.permission,
              value(b),
            );
          const saved = await replay(
            tx,
            req.principal.id,
            `fee.${b.action}:${id}`,
            key(req.headers),
            b,
            async () => {
              const checked = await inspect(tx, w, b),
                rules = await policy(tx);
              await daily(
                tx,
                req.principal,
                allowed,
                b,
                checked.risk,
                w.data_mode,
              );
              if (!preview)
                throw new Problem(
                  409,
                  "PREVIEW_REQUIRED",
                  "Preview this financial change before submitting",
                );
              const pv = (
                await tx.query(
                  "SELECT *,expires_at>now() AS valid FROM admin_previews WHERE id=$1 AND principal_id=$2 AND action=$3 FOR UPDATE",
                  [preview, req.principal.id, def.action],
                )
              ).rows[0];
              if (
                !pv ||
                !pv.valid ||
                pv.consumed_at ||
                pv.payload.billing_account_id !== id ||
                pv.payload_hash !== payloadHash(id, b) ||
                pv.payload.policy_version_id !== rules.id ||
                pv.payload.approval !== approval(rules, checked) ||
                canonical(pv.payload.before) !== canonical(checked.before)
              )
                throw new Problem(
                  409,
                  "PREVIEW_CHANGED",
                  "Financial preview expired or changed; preview again",
                );
              const payload = {
                financial_command_version: 1,
                billing_account_id: id,
                command: b,
                before: checked.before,
                actor_session_id: req.principal.sessionId,
                actor_auth_version: req.principal.authVersion,
                expires_at: new Date(
                  Date.now() + rules.minutes * 60000,
                ).toISOString(),
              };
              const op = (
                await tx.query(
                  "INSERT INTO admin_operations(principal_id,action,tenant_id,payload_hash,payload,idempotency_key,state,policy_version_id,target_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
                  [
                    req.principal.id,
                    def.action,
                    w.tenant_id,
                    payloadHash(id, b),
                    payload,
                    `fee:${hash(canonical([id, b.action, key(req.headers)]))}`,
                    approval(rules, checked) ? "pending_approval" : "running",
                    rules.id,
                    [id],
                  ],
                )
              ).rows[0];
              if (op.state === "running")
                await apply(tx, req.principal, w, b, checked, op);
              else {
                await tx.query(
                  "INSERT INTO admin_approval_requests(operation_id,requester_id,payload_hash,policy_version_id,expires_at) VALUES($1,$2,$3,$4,$5)",
                  [
                    op.id,
                    op.principal_id,
                    op.payload_hash,
                    op.policy_version_id,
                    payload.expires_at,
                  ],
                );
                await audit(
                  tx,
                  req.principal,
                  def.permission,
                  op.id,
                  "pending_approval",
                  {
                    reason: b.reason,
                    billing_account_id: id,
                    before: checked.before,
                    payload_hash: op.payload_hash,
                    policy_version_id: rules.id,
                  },
                  w.tenant_id ?? undefined,
                );
              }
              await tx.query(
                "UPDATE admin_previews SET consumed_at=now() WHERE id=$1",
                [preview],
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
  app.get(
    "/v1/admin/billing/operations/:operation/review",
    auth,
    async (req) => {
      const id = uuid.parse((req.params as any).operation);
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          const op = (
            await tx.query("SELECT * FROM admin_operations WHERE id=$1", [id])
          ).rows[0];
          if (!isFeeOperation(op))
            throw new Problem(
              404,
              "NOT_FOUND",
              "Financial operation not found",
            );
          await feeOperationAuthority(
            tx,
            req.principal,
            op,
            "admin.billing.read",
          );
          await feeOperationAuthority(tx, req.principal, op, "admin.jobs.read");
          const approvalRequest = (
            await tx.query(
              "SELECT * FROM admin_approval_requests WHERE operation_id=$1",
              [op.id],
            )
          ).rows[0];
          return {
            operation: adminOperationDTO(op),
            billing_account_id: op.payload.billing_account_id,
            command: op.payload.command,
            before: op.payload.before,
            expires_at: op.payload.expires_at,
            ...(approvalRequest
              ? { approval: approvalDTO(approvalRequest) }
              : {}),
          };
        },
        undefined,
        true,
      );
    },
  );
}

export async function decideFeeOperation(
  tx: Tx,
  db: Database,
  reviewer: Principal,
  op: any,
  b: { decision: "approve" | "reject"; reason: string },
) {
  const id = op.id,
    c = frozenCommand(op),
    w = await account(tx, db, op.payload.billing_account_id);
  await authority(tx, reviewer, w, "admin.approvals.decide");
  await authority(tx, reviewer, w, definitions[c.action].permission, value(c));
  if (b.decision === "approve") {
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
        "Financial approval expired; submit a fresh preview",
      );
    const original = actor(op),
      allowed = await authority(
        tx,
        original,
        w,
        definitions[c.action].permission,
        value(c),
      ),
      rules = await policy(tx);
    if (rules.id !== op.policy_version_id)
      throw new Problem(
        409,
        "POLICY_CHANGED",
        "Policy changed; submit a fresh preview",
      );
    if (payloadHash(w.id, c) !== op.payload_hash)
      throw new Problem(
        409,
        "PAYLOAD_CHANGED",
        "Frozen financial command changed",
      );
    const checked = await inspect(tx, w, c);
    if (canonical(checked.before) !== canonical(op.payload.before))
      throw new Problem(
        409,
        "TARGET_CHANGED",
        "Financial sources changed while awaiting review",
      );
    await daily(tx, original, allowed, c, checked.risk, w.data_mode);
    await apply(tx, original, w, c, checked, op);
    await tx.query("UPDATE admin_operations SET approved_by=$2 WHERE id=$1", [
      id,
      reviewer.id,
    ]);
  } else
    await tx.query(
      "UPDATE admin_operations SET state='cancelled',approved_by=$2,version=version+1 WHERE id=$1",
      [id, reviewer.id],
    );
  await audit(
    tx,
    reviewer,
    `admin.approval.${b.decision}`,
    id,
    "succeeded",
    { reason: b.reason, payload_hash: op.payload_hash },
    w.tenant_id ?? undefined,
  );
}
