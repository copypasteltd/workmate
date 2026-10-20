import { z } from "zod";
import type { FastifyInstance } from "fastify";
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
import { createApprovalRequest } from "./admin-approval-storage.js";
import { readScope, pageBounds, pageCursor } from "./admin-directory.js";
import { financialAccount, financialAuthority } from "./admin-fees.js";
import { paymentRecord } from "./payment-records.js";
import { planSelect, planVersionDTO } from "./commercial-plans.js";
import { key, replay } from "./access.js";
import { canonical, hash, Problem, uuid } from "./lib.js";
import {
  vipCreate,
  vipExtend,
  vipReason,
  vipSubject,
  vipMode,
  vipPermission,
  vipSelect,
  vipDTO,
  findVip,
  subjectOf,
  subjectVersion,
  lockVipSubject,
  type VipSubject,
  type VipCreate,
  type VipChange,
} from "./vip.js";

const root = "/v1/admin/entitlement-grants";
export const isVipOperation = (op: any) =>
  op?.payload?.vip_command_version === 1;
const commandHash = (action: string, target: string, command: unknown) =>
  hash(canonical({ action, target_id: target, command }));
const parseCommand = (action: string, b: unknown): VipCreate | VipChange =>
  action === "entitlements.grant"
    ? vipCreate.parse(b)
    : action === "entitlements.extend"
      ? vipExtend.parse(b)
      : vipReason.parse(b);
export async function vipAuthority(
  tx: Tx,
  p: Principal,
  subject: VipSubject,
  permission: string,
  hours?: number,
) {
  await lockAdminAccess(tx);
  if (subject.kind === "user")
    await userAccountAuthority(tx, p, subject.id, permission);
  else await membershipAdminAuthority(tx, p, subject.id, permission);
  await requireSensitiveAdmin(tx, p);
  await permit(
    tx,
    p,
    permission,
    subject.kind === "tenant" ? { tenant: subject.id } : {},
    hours === undefined ? undefined : { hours },
  );
}
export async function vipOperationAuthority(
  tx: Tx,
  p: Principal,
  op: any,
  permission: string,
) {
  const b = parseCommand(op.action, op.payload.command);
  if (
    !isVipOperation(op) ||
    commandHash(op.action, op.payload.target_id, b) !== op.payload_hash
  )
    throw new Problem(
      409,
      "PAYLOAD_CHANGED",
      "VIP intent no longer matches its command",
    );
  if (
    op.payload.data_mode !==
    (await tx.query("SELECT current_setting('app.data_mode',true) AS mode"))
      .rows[0].mode
  )
    throw new Problem(404, "NOT_FOUND", "VIP operation not found in this mode");
  await vipAuthority(
    tx,
    p,
    { kind: op.payload.subject_kind, id: op.payload.subject_id },
    permission,
  );
  if (op.action === "entitlements.grant" && (b as VipCreate).source === "paid")
    await paidRead(
      tx,
      p,
      (b as VipCreate).payment_record_id!,
      op.payload.data_mode,
    );
}
async function paidRead(tx: Tx, p: Principal, payment: string, mode: string) {
  const w = (
    await tx.query(
      "SELECT w.* FROM wallets w JOIN payment_records r ON r.billing_account_id=w.id WHERE r.id=$1 AND w.data_mode=$2",
      [payment, mode],
    )
  ).rows[0];
  if (!w) throw new Problem(404, "NOT_FOUND", "Payment subject not found");
  await financialAuthority(tx, p, w, "admin.billing.read");
}
async function policy(tx: Tx) {
  const source = await currentAdminControl(tx);
  const rules = z
    .object({
      max_vip_hours: z
        .number()
        .int()
        .min(1)
        .max(24 * 366 * 5)
        .default(24 * 366),
      vip_approval_hours: z
        .number()
        .int()
        .min(1)
        .max(24 * 366 * 5)
        .default(24 * 31),
      vip_replace_requires_approval: z.boolean().default(true),
      vip_paid_requires_approval: z.boolean().default(true),
      vip_all_changes_require_approval: z.boolean().default(false),
      vip_approval_window_minutes: z.number().int().min(1).max(10).default(5),
    })
    .parse(source?.body ?? {});
  return {
    ...rules,
    id: await pinAdminPolicy(tx, {
      kind: "canonical_vip",
      source_id: source?.id ?? null,
      source_version: source?.version ?? null,
      rules,
    }),
  };
}
async function scopeState(
  tx: Tx,
  subject: VipSubject,
  activating: boolean,
  mode: string,
) {
  const row = (
    await tx.query(
      `SELECT * FROM ${subject.kind === "tenant" ? "tenants" : "users"} WHERE id=$1`,
      [subject.id],
    )
  ).rows[0];
  if (!row || (subject.kind === "tenant" && row.data_mode !== mode))
    throw new Problem(404, "NOT_FOUND", "Entitlement subject not found");
  if (activating && (row.status !== "active" || row.admin_closed_at))
    throw new Problem(
      409,
      "SUBJECT_INACTIVE",
      "Restore the subject before granting or restoring access",
    );
  return row;
}
async function overlap(
  tx: Tx,
  subject: VipSubject,
  mode: string,
  starts: string,
  ends: string,
  adjacent = false,
  exclude?: string,
) {
  const canonicalRows = (
    await tx.query(
      `${vipSelect} WHERE s.data_mode=$1 AND ${subject.kind === "tenant" ? "s.tenant_id" : "s.user_id"}=$2
    AND g.state<>'revoked' AND g.starts_at<$4::timestamptz AND least(g.ends_at,g.replacement_at)${adjacent ? ">=" : ">"}$3::timestamptz
    AND ($5::uuid IS NULL OR g.id<>$5) ORDER BY g.id`,
      [mode, subject.id, starts, ends, exclude ?? null],
    )
  ).rows;
  const legacyRows = (
    await tx.query(
      `SELECT e.*,b.plan_version_id,b.provenance FROM entitlements e
    LEFT JOIN legacy_entitlement_plan_bindings b ON b.entitlement_id=e.id
    WHERE ${subject.kind === "tenant" ? "e.tenant_id" : "e.user_id"}=$1 AND e.state<>'revoked'
    AND e.starts_at<$3::timestamptz AND least(e.ends_at,(SELECT min(r.effective_from) FROM legacy_vip_replacements r JOIN vip_grants n ON n.id=r.grant_id JOIN entitlement_subjects s ON s.id=n.subject_id WHERE r.entitlement_id=e.id AND s.data_mode=$4))${adjacent ? ">=" : ">"}$2::timestamptz ORDER BY e.id`,
      [subject.id, starts, ends, mode],
    )
  ).rows;
  return { canonicalRows, legacyRows };
}
const overlapFacts = (r: Awaited<ReturnType<typeof overlap>>) => ({
  grants: r.canonicalRows.map(vipDTO),
  legacy: r.legacyRows.map((g) => ({
    id: g.id,
    version: g.version,
    plan: g.plan,
    plan_version_id: g.plan_version_id,
    provenance: g.provenance,
    starts_at: new Date(g.starts_at).toISOString(),
    ends_at: new Date(g.ends_at).toISOString(),
    state: g.state,
    original_actor_id: g.created_by ?? null,
  })),
});
async function inspect(
  tx: Tx,
  db: Database,
  actor: Principal,
  action: string,
  target: string,
  command: VipCreate | VipChange,
) {
  const mode = vipMode(db.config.DEMO_MODE);
  const old =
    action === "entitlements.grant" ? null : await findVip(tx, target, mode);
  const subject = old ? subjectOf(old) : (command as VipCreate).subject;
  await lockVipSubject(tx, subject, mode);
  const holder = await subjectVersion(tx, subject, mode);
  const subject_revision = holder?.version ?? 1;
  await scopeState(
    tx,
    subject,
    [
      "entitlements.grant",
      "entitlements.extend",
      "entitlements.resume",
    ].includes(action),
    mode,
  );
  const rules = await policy(tx);
  const now = Number(
    (await tx.query("SELECT extract(epoch FROM now())*1000 AS ms")).rows[0].ms,
  );
  let hours = 0,
    plan: any,
    conflicts: Awaited<ReturnType<typeof overlap>>,
    extension: any = null,
    payment: any = null;
  if (!old) {
    const b = command as VipCreate;
    if (b.expected_subject_version !== subject_revision)
      throw new Problem(
        409,
        "VERSION_CONFLICT",
        "Refresh the current subject entitlement version",
      );
    plan = (await tx.query(`${planSelect} WHERE v.id=$1`, [b.plan_version_id]))
      .rows[0];
    const pinnedRenewal =
      plan &&
      b.overlap_policy === "extend_same_plan" &&
      (
        await tx.query(
          "SELECT 1 FROM commercial_plan_publications WHERE plan_version_id=$1",
          [plan.id],
        )
      ).rowCount;
    if (!plan || (plan.state !== "published" && !pinnedRenewal))
      throw new Problem(
        409,
        "PLAN_NOT_PUBLISHED",
        "Choose a currently published immutable plan version",
      );
    if (Date.parse(b.ends_at) <= now)
      throw new Problem(
        409,
        "EXPIRY_INVALID",
        "A new grant must end in the future",
      );
    hours =
      Math.max(
        Date.parse(b.ends_at) - Date.parse(b.starts_at),
        Date.parse(b.ends_at) - now,
      ) / 3600000;
    conflicts = await overlap(
      tx,
      subject,
      mode,
      b.starts_at,
      b.ends_at,
      b.overlap_policy === "extend_same_plan",
    );
    if (
      b.overlap_policy === "reject" &&
      (conflicts.canonicalRows.length || conflicts.legacyRows.length)
    )
      throw new Problem(
        409,
        "ENTITLEMENT_OVERLAP",
        "Review overlapping grants and choose an explicit policy",
      );
    if (b.overlap_policy === "extend_same_plan") {
      extension = conflicts.canonicalRows[0];
      if (
        conflicts.legacyRows.length ||
        conflicts.canonicalRows.length !== 1 ||
        extension.plan_version_id !== b.plan_version_id ||
        extension.state !== "active" ||
        extension.replacement_at ||
        Date.parse(b.starts_at) < new Date(extension.starts_at).getTime() ||
        Date.parse(b.ends_at) <= new Date(extension.ends_at).getTime() ||
        b.source !== extension.source ||
        (b.payment_record_id ?? null) !== extension.payment_record_id
      )
        throw new Problem(
          409,
          "EXTEND_SAME_PLAN_INVALID",
          "Extend exactly one matching canonical grant without changing its source",
        );
      hours =
        Math.max(
          Date.parse(b.ends_at) - now,
          Date.parse(b.ends_at) - new Date(extension.ends_at).getTime(),
        ) / 3600000;
    }
    if (b.source === "paid") {
      payment = await paymentRecord(tx, b.payment_record_id!);
      if (!payment)
        throw new Problem(404, "NOT_FOUND", "Verified payment not found");
      const w = await financialAccount(tx, db, payment.billing_account_id);
      await financialAuthority(tx, actor, w, "admin.billing.read");
      if (
        (subject.kind === "tenant" ? w.tenant_id : w.user_id) !== subject.id ||
        !payment.verified_by ||
        payment.refund_pending ||
        payment.refund_reconciling ||
        BigInt(payment.refunded_micros) !== 0n
      )
        throw new Problem(
          409,
          "PAYMENT_NOT_ELIGIBLE",
          "Use an unrefunded verified payment belonging to this subject and mode",
        );
      const used = (
        await tx.query("SELECT id FROM vip_grants WHERE payment_record_id=$1", [
          payment.id,
        ])
      ).rows[0];
      if (used && used.id !== extension?.id)
        throw new Problem(
          409,
          "PAYMENT_ALREADY_LINKED",
          "This payment already identifies another grant",
        );
    }
  } else {
    const b = command as VipChange;
    if (old.version !== b.expected_version)
      throw new Problem(
        409,
        "VERSION_CONFLICT",
        "Refresh the exact grant revision",
      );
    if (old.state === "revoked" || old.replacement_at)
      throw new Problem(
        409,
        "GRANT_TERMINAL",
        "A revoked or replaced grant requires a new grant",
      );
    if (
      action === "entitlements.resume" &&
      (old.state !== "suspended" || new Date(old.ends_at).getTime() <= now)
    )
      throw new Problem(
        409,
        "RESUME_INVALID",
        "Resume only a suspended grant before its original expiry",
      );
    if (
      action === "entitlements.suspend" &&
      (old.state !== "active" || new Date(old.ends_at).getTime() <= now)
    )
      throw new Problem(
        409,
        "SUSPEND_INVALID",
        "Suspend a live or scheduled grant",
      );
    if (action === "entitlements.extend") {
      const end = (b as z.infer<typeof vipExtend>).ends_at;
      if (Date.parse(end) <= Math.max(now, new Date(old.ends_at).getTime()))
        throw new Problem(
          409,
          "EXTENSION_INVALID",
          "Extension must advance the current end into the future",
        );
      hours =
        Math.max(
          Date.parse(end) - now,
          Date.parse(end) - new Date(old.ends_at).getTime(),
        ) / 3600000;
      conflicts = await overlap(
        tx,
        subject,
        mode,
        new Date(old.starts_at).toISOString(),
        end,
        false,
        old.id,
      );
      if (conflicts.canonicalRows.length || conflicts.legacyRows.length)
        throw new Problem(
          409,
          "ENTITLEMENT_OVERLAP",
          "The extension would overlap another grant",
        );
    } else conflicts = { canonicalRows: [], legacyRows: [] };
  }
  if (hours > rules.max_vip_hours)
    throw new Problem(
      403,
      "DURATION_LIMIT",
      "The requested grant or extension exceeds current policy",
    );
  const approval =
    rules.vip_all_changes_require_approval ||
    hours > rules.vip_approval_hours ||
    (!old &&
      (command as VipCreate).overlap_policy === "replace" &&
      rules.vip_replace_requires_approval) ||
    (!old &&
      (command as VipCreate).source === "paid" &&
      rules.vip_paid_requires_approval);
  return {
    subject,
    holder,
    subject_revision,
    mode,
    old,
    plan,
    conflicts: conflicts!,
    extension,
    hours,
    rules,
    approval,
    before: {
      subject,
      subject_version: subject_revision,
      current: old ? vipDTO(old) : null,
      ...(plan ? { plan: planVersionDTO(plan) } : {}),
      ...overlapFacts(conflicts!),
      payment: payment
        ? {
            id: payment.id,
            version: payment.version,
            confirmed_at: new Date(payment.confirmed_at).toISOString(),
          }
        : null,
    },
  };
}

type Inspection = Awaited<ReturnType<typeof inspect>>;
async function recordRevision(
  tx: Tx,
  grant: string,
  op: any,
  action: string,
  before: unknown,
) {
  const event = (
    await tx.query(
      "INSERT INTO vip_grant_events(grant_id,operation_id,actor_id,action,version,before_value,after_value) SELECT g.id,$2,$3,$4,g.version,$5,to_jsonb(g) FROM vip_grants g WHERE g.id=$1 RETURNING id",
      [grant, op.id, op.principal_id, action, before],
    )
  ).rows[0];
  await tx.query(
    `INSERT INTO entitlement_outbox(subject_id,grant_id,operation_id,kind,grant_version)
    SELECT subject_id,id,$2,'changed',version FROM vip_grants WHERE id=$1`,
    [grant, op.id],
  );
  await tx.query(
    `INSERT INTO entitlement_outbox(subject_id,grant_id,operation_id,kind,grant_version,available_at)
    SELECT subject_id,id,$2,b.kind,version,b.at FROM vip_grants g
    CROSS JOIN LATERAL (VALUES ('starts',g.starts_at),('expires',g.ends_at),('replaced',g.replacement_at)) b(kind,at)
    WHERE g.id=$1 AND g.state<>'revoked' AND b.at>now()`,
    [grant, op.id],
  );
  return event.id;
}
async function execute(tx: Tx, actor: Principal, op: any, checked: Inspection) {
  const b = parseCommand(op.action, op.payload.command),
    c = b as VipCreate;
  let holder = checked.holder;
  if (!holder)
    holder = (
      await tx.query(
        "INSERT INTO entitlement_subjects(tenant_id,user_id,data_mode) VALUES($1,$2,$3) RETURNING *",
        [
          checked.subject.kind === "tenant" ? checked.subject.id : null,
          checked.subject.kind === "user" ? checked.subject.id : null,
          checked.mode,
        ],
      )
    ).rows[0];
  await tx.query(
    "UPDATE entitlement_subjects SET version=version+1,last_operation_id=$2 WHERE id=$1 AND version=$3",
    [holder.id, op.id, checked.subject_revision],
  );
  const ids: string[] = [];
  let grant: string;
  if (op.action === "entitlements.grant" && !checked.extension) {
    grant = (
      await tx.query(
        `INSERT INTO vip_grants(subject_id,plan_version_id,starts_at,initial_ends_at,ends_at,source,payment_record_id,actor_id,operation_id,last_operation_id)
       VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$8) RETURNING id`,
        [
          holder.id,
          c.plan_version_id,
          c.starts_at,
          c.ends_at,
          c.source,
          c.payment_record_id ?? null,
          actor.id,
          op.id,
        ],
      )
    ).rows[0].id;
    ids.push(grant, await recordRevision(tx, grant, op, "grant", null));
    if (c.overlap_policy === "replace") {
      for (const old of checked.conflicts.canonicalRows) {
        const before = (
          await tx.query(
            "SELECT to_jsonb(g) AS value FROM vip_grants g WHERE id=$1",
            [old.id],
          )
        ).rows[0].value;
        await tx.query(
          "UPDATE vip_grants SET replacement_at=$2,replacement_grant_id=$3,version=version+1,last_operation_id=$4 WHERE id=$1",
          [old.id, c.starts_at, grant, op.id],
        );
        ids.push(
          old.id,
          await recordRevision(tx, old.id, op, "replace", before),
        );
      }
      for (const old of checked.conflicts.legacyRows) {
        const fact = (
          await tx.query(
            "INSERT INTO legacy_vip_replacements(entitlement_id,grant_id,effective_from,operation_id,actor_id) VALUES($1,$2,$3,$4,$5) RETURNING id",
            [old.id, grant, c.starts_at, op.id, actor.id],
          )
        ).rows[0];
        ids.push(fact.id);
      }
    }
  } else {
    const old = checked.old ?? checked.extension;
    grant = old.id;
    const before = (
      await tx.query(
        "SELECT to_jsonb(g) AS value FROM vip_grants g WHERE id=$1",
        [grant],
      )
    ).rows[0].value;
    const kind =
      op.action === "entitlements.grant" ? "extend" : op.action.split(".")[1];
    if (kind === "extend")
      await tx.query(
        "UPDATE vip_grants SET ends_at=$2,version=version+1,last_operation_id=$3 WHERE id=$1",
        [grant, (b as z.infer<typeof vipExtend>).ends_at, op.id],
      );
    else
      await tx.query(
        "UPDATE vip_grants SET state=$2,version=version+1,last_operation_id=$3 WHERE id=$1",
        [
          grant,
          kind === "revoke"
            ? "revoked"
            : kind === "suspend"
              ? "suspended"
              : "active",
          op.id,
        ],
      );
    ids.push(grant, await recordRevision(tx, grant, op, kind, before));
  }
  await tx.query(
    "UPDATE admin_operations SET state='succeeded',version=version+1,result=$2,result_ids=$3 WHERE id=$1",
    [
      op.id,
      {
        grant_id: grant,
        subject_version: checked.subject_revision + 1,
        creates_credit: false,
        creates_charge: false,
      },
      ids,
    ],
  );
  await audit(
    tx,
    actor,
    "admin." + op.action,
    grant,
    "succeeded",
    {
      operation_id: op.id,
      policy_version_id: op.policy_version_id,
      reason: b.reason,
      before: checked.before,
      result_ids: ids,
    },
    checked.subject.kind === "tenant" ? checked.subject.id : undefined,
  );
}
export async function decideVipOperation(
  tx: Tx,
  db: Database,
  reviewer: Principal,
  op: any,
  b: { decision: "approve" | "reject"; reason: string },
) {
  await vipOperationAuthority(tx, reviewer, op, vipPermission(op.action));
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
  await vipOperationAuthority(tx, actor, op, vipPermission(op.action));
  await vipOperationAuthority(tx, actor, op, "admin.entitlements.read");
  const checked = await inspect(
    tx,
    db,
    actor,
    op.action,
    op.payload.target_id,
    parseCommand(op.action, op.payload.command),
  );
  await vipAuthority(
    tx,
    actor,
    checked.subject,
    vipPermission(op.action),
    checked.hours,
  );
  await vipAuthority(
    tx,
    reviewer,
    checked.subject,
    vipPermission(op.action),
    checked.hours,
  );
  if (checked.rules.id !== op.policy_version_id)
    throw new Problem(
      409,
      "POLICY_CHANGED",
      "Create a new VIP preview under current policy",
    );
  if (canonical(checked.before) !== canonical(op.payload.before))
    throw new Problem(
      409,
      "TARGET_CHANGED",
      "Entitlement or payment facts changed while awaiting review",
    );
  await tx.query(
    "UPDATE admin_operations SET state='running',approved_by=$2 WHERE id=$1",
    [op.id, reviewer.id],
  );
  await execute(tx, actor, op, checked);
}

export function registerAdminVip(app: FastifyInstance, db: Database) {
  const auth = { preHandler: requireAdmin(db) },
    mode = vipMode(db.config.DEMO_MODE);
  app.get(root + "/plan-options", auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const q = z
      .object({
        cursor: uuid.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      })
      .strict()
      .parse(req.query);
    return db.tx(
      async (tx) => {
        await readScope(tx, req.principal, "admin.entitlements.read");
        if (
          q.cursor &&
          !(
            await tx.query(
              "SELECT 1 FROM commercial_plans WHERE published_version_id=$1",
              [q.cursor],
            )
          ).rowCount
        )
          throw new Problem(
            410,
            "CURSOR_EXPIRED",
            "Refresh current published VIP options",
          );
        const rows = (
          await tx.query(
            `${planSelect} WHERE p.published_version_id=v.id AND ($1::uuid IS NULL OR v.id>$1) ORDER BY v.id LIMIT $2`,
            [q.cursor ?? null, q.limit + 1],
          )
        ).rows;
        await audit(
          tx,
          req.principal,
          "admin.entitlements.read",
          "published_options",
        );
        return {
          items: rows.slice(0, q.limit).map(planVersionDTO),
          next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
        };
      },
      undefined,
      true,
    );
  });
  app.get(root + "/legacy", auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const q = z
      .object({
        subject_id: uuid,
        cursor: uuid.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .strict()
      .parse(req.query);
    return db.tx(
      async (tx) => {
        const s = await readScope(tx, req.principal, "admin.entitlements.read");
        const where = `${s.account("admin.entitlements.read", "e")} AND coalesce(e.tenant_id,e.user_id)=${s.arg(q.subject_id)}::uuid`;
        const cursor = s.arg(q.cursor ?? null);
        const accessible = `FROM entitlements e LEFT JOIN legacy_entitlement_plan_bindings b ON b.entitlement_id=e.id WHERE ${where}`;
        if (
          q.cursor &&
          !(
            await tx.query(
              `SELECT e.id ${accessible} AND e.id=${cursor}::uuid`,
              s.values,
            )
          ).rowCount
        )
          throw new Problem(
            410,
            "CURSOR_EXPIRED",
            "Refresh accessible historical grants",
          );
        const rows = (
          await tx.query(
            `SELECT e.id,e.tenant_id,e.user_id,e.plan,e.plan_version,e.version,e.state,e.starts_at,e.ends_at,
        e.created_by AS original_actor_id,b.plan_version_id,b.provenance,
        (SELECT min(r.effective_from) FROM legacy_vip_replacements r JOIN vip_grants n ON n.id=r.grant_id JOIN entitlement_subjects ns ON ns.id=n.subject_id WHERE r.entitlement_id=e.id AND ns.data_mode=${s.arg(mode)}) AS replaced_at
        ${accessible} AND (${cursor}::uuid IS NULL OR e.id>${cursor}::uuid) ORDER BY e.id LIMIT ${s.arg(q.limit + 1)}`,
            s.values,
          )
        ).rows;
        await audit(
          tx,
          req.principal,
          "admin.entitlements.read",
          q.subject_id,
          "historical_grants",
        );
        return {
          items: rows.slice(0, q.limit).map((r) => ({
            ...r,
            data_mode: "historically_unrecorded",
            source: null,
            original_operation_id: null,
          })),
          next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
        };
      },
      undefined,
      true,
    );
  });
  app.get(root, auth, async (req) => {
    const q = z
      .object({
        subject_id: uuid.optional(),
        cursor: z.string().min(1).max(4096).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .strict()
      .parse(req.query);
    return db.tx(
      async (tx) => {
        const s = await readScope(tx, req.principal, "admin.entitlements.read"),
          bounds = await pageBounds(tx, db, req.principal, s, q, "vip_grants");
        let where = `${s.account("admin.entitlements.read", "s")} AND s.data_mode=${s.arg(mode)} AND g.created_at<=${s.arg(bounds.asof)}::timestamptz`;
        if (q.subject_id)
          where += ` AND coalesce(s.tenant_id,s.user_id)=${s.arg(q.subject_id)}::uuid`;
        if (bounds.after)
          where += ` AND (g.created_at,g.id)<(${s.arg(bounds.after.at)}::timestamptz,${s.arg(bounds.after.id)}::uuid)`;
        const rows = (
          await tx.query(
            `${vipSelect.replace("SELECT g.*,", "SELECT to_char(g.created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS cursor_at,g.*,")} WHERE ${where} ORDER BY g.created_at DESC,g.id DESC LIMIT ${s.arg(q.limit + 1)}`,
            s.values,
          )
        ).rows;
        const items = rows.slice(0, q.limit);
        await audit(tx, req.principal, "admin.entitlements.read", "grants");
        return {
          items: items.map(vipDTO),
          next_cursor:
            rows.length > q.limit ? pageCursor(db, bounds, items.at(-1)) : null,
        };
      },
      undefined,
      true,
    );
  });
  app.get(root + "/subjects/:kind/:id", auth, async (req) =>
    db.tx(
      async (tx) => {
        z.object({}).strict().parse(req.query);
        const p = req.params as any,
          subject = vipSubject.parse({ kind: p.kind, id: p.id });
        await vipAuthority(
          tx,
          req.principal,
          subject,
          "admin.entitlements.read",
        );
        const entity = await scopeState(tx, subject, false, mode),
          holder = await subjectVersion(tx, subject, mode);
        await audit(tx, req.principal, "admin.entitlements.read", subject.id);
        return {
          subject,
          name: entity.name,
          version: holder?.version ?? 1,
          active: entity.status === "active" && !entity.admin_closed_at,
        };
      },
      undefined,
      true,
    ),
  );
  app.get(root + "/:grant_id", auth, async (req) =>
    db.tx(
      async (tx) => {
        z.object({}).strict().parse(req.query);
        await lockAdminAccess(tx);
        const g = await findVip(
          tx,
          uuid.parse((req.params as any).grant_id),
          mode,
        );
        await vipAuthority(
          tx,
          req.principal,
          subjectOf(g),
          "admin.entitlements.read",
        );
        await audit(tx, req.principal, "admin.entitlements.read", g.id);
        return vipDTO(g);
      },
      undefined,
      true,
    ),
  );
  app.get(root + "/:grant_id/history", auth, async (req) =>
    db.tx(
      async (tx) => {
        z.object({}).strict().parse(req.query);
        await lockAdminAccess(tx);
        const g = await findVip(
          tx,
          uuid.parse((req.params as any).grant_id),
          mode,
        );
        await vipAuthority(
          tx,
          req.principal,
          subjectOf(g),
          "admin.entitlements.read",
        );
        const rows = (
          await tx.query(
            "SELECT id,operation_id,actor_id,action,version,before_value,after_value,created_at FROM vip_grant_events WHERE grant_id=$1 ORDER BY version",
            [g.id],
          )
        ).rows;
        await audit(
          tx,
          req.principal,
          "admin.entitlements.read",
          g.id,
          "history",
        );
        const publicRevision = (value: any) => {
          if (!value) return null;
          const { payment_record_id: omitted, ...rest } = value;
          return rest;
        };
        return {
          grant: vipDTO(g),
          items: rows.map((r) => ({
            ...r,
            before_value: publicRevision(r.before_value),
            after_value: publicRevision(r.after_value),
          })),
        };
      },
      undefined,
      true,
    ),
  );

  const preview = (action: string, path: string) =>
    app.post(path, auth, async (req) => {
      const b = parseCommand(action, req.body),
        target =
          action === "entitlements.grant"
            ? (b as VipCreate).subject.id
            : uuid.parse((req.params as any).grant_id);
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          const subject =
            action === "entitlements.grant"
              ? (b as VipCreate).subject
              : subjectOf(await findVip(tx, target, mode));
          await vipAuthority(tx, req.principal, subject, vipPermission(action));
          await vipAuthority(
            tx,
            req.principal,
            subject,
            "admin.entitlements.read",
          );
          return replay(
            tx,
            req.principal.id,
            `vip.preview:${mode}:${action}:${target}`,
            key(req),
            b,
            async () => {
              const checked = await inspect(
                tx,
                db,
                req.principal,
                action,
                target,
                b,
              );
              await vipAuthority(
                tx,
                req.principal,
                subject,
                vipPermission(action),
                checked.hours,
              );
              const payload = {
                vip_command_version: 1,
                target_id: target,
                subject_kind: subject.kind,
                subject_id: subject.id,
                data_mode: mode,
                command: b,
                before: checked.before,
                policy_version_id: checked.rules.id,
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
                    commandHash(action, target, b),
                    checked.rules.vip_approval_window_minutes,
                  ],
                )
              ).rows[0];
              await audit(
                tx,
                req.principal,
                "admin." + action,
                target,
                "preview",
                { preview_id: row.id },
              );
              return {
                preview_id: row.id,
                payload_hash: row.payload_hash,
                target_ids: [
                  subject.id,
                  ...(action === "entitlements.grant"
                    ? [(b as VipCreate).plan_version_id]
                    : [target]),
                ],
                policy_version_id: checked.rules.id,
                decision: checked.approval
                  ? "independent_approval"
                  : "recent_mfa",
                missing_permission_keys: [],
                impact_summary:
                  "Apply only the reviewed subject, fixed plan and effective interval. Preserve original provenance. No automatic credit, renewal or payment.",
                expires_at: new Date(row.expires_at).toISOString(),
                creates_business_effect: false,
                expected_target_versions: [
                  { id: subject.id, version: checked.subject_revision },
                  ...(checked.old
                    ? [{ id: target, version: checked.old.version }]
                    : []),
                ],
              };
            },
          );
        },
        undefined,
        true,
      );
    });
  const commit = (action: string, path: string) =>
    app.post(path, auth, async (req, reply) => {
      const b = parseCommand(action, req.body),
        target =
          action === "entitlements.grant"
            ? (b as VipCreate).subject.id
            : uuid.parse((req.params as any).grant_id);
      reply.code(202);
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          const subject =
            action === "entitlements.grant"
              ? (b as VipCreate).subject
              : subjectOf(await findVip(tx, target, mode));
          await vipAuthority(tx, req.principal, subject, vipPermission(action));
          await vipAuthority(
            tx,
            req.principal,
            subject,
            "admin.entitlements.read",
          );
          const saved = await replay(
            tx,
            req.principal.id,
            `vip.commit:${mode}:${action}:${target}`,
            key(req),
            b,
            async () => {
              const p = (
                await tx.query(
                  "SELECT *,expires_at>now() AS valid FROM admin_previews WHERE id=$1 AND principal_id=$2 FOR UPDATE",
                  [
                    uuid.parse(req.headers["x-admin-preview-id"]),
                    req.principal.id,
                  ],
                )
              ).rows[0];
              if (
                !p ||
                !p.valid ||
                p.consumed_at ||
                p.action !== action ||
                p.payload_hash !== commandHash(action, target, b) ||
                p.payload.actor_session_id !== req.principal.sessionId ||
                p.payload.actor_auth_version !== req.principal.authVersion ||
                p.payload.data_mode !== mode
              )
                throw new Problem(
                  409,
                  "PREVIEW_INVALID",
                  "Create a current frozen preview of this exact VIP command",
                );
              const checked = await inspect(
                tx,
                db,
                req.principal,
                action,
                target,
                b,
              );
              await vipAuthority(
                tx,
                req.principal,
                subject,
                vipPermission(action),
                checked.hours,
              );
              if (checked.rules.id !== p.payload.policy_version_id)
                throw new Problem(
                  409,
                  "POLICY_CHANGED",
                  "Preview again under current policy",
                );
              if (canonical(checked.before) !== canonical(p.payload.before))
                throw new Problem(
                  409,
                  "TARGET_CHANGED",
                  "Subject, grant or payment facts changed; preview again",
                );
              const op = (
                await tx.query(
                  "INSERT INTO admin_operations(principal_id,action,tenant_id,payload_hash,payload,idempotency_key,state,policy_version_id,target_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
                  [
                    req.principal.id,
                    action,
                    subject.kind === "tenant" ? subject.id : null,
                    p.payload_hash,
                    {
                      ...p.payload,
                      expires_at: new Date(p.expires_at).toISOString(),
                    },
                    hash(`${mode}:${action}:${target}:${key(req)}`),
                    checked.approval ? "pending_approval" : "running",
                    checked.rules.id,
                    [
                      subject.id,
                      ...(action === "entitlements.grant" ? [] : [target]),
                    ],
                  ],
                )
              ).rows[0];
              if (checked.approval) await createApprovalRequest(tx, op);
              else await execute(tx, req.principal, op, checked);
              await tx.query(
                "UPDATE admin_previews SET consumed_at=now() WHERE id=$1",
                [p.id],
              );
              if (checked.approval)
                await audit(
                  tx,
                  req.principal,
                  "admin." + action,
                  target,
                  "pending_approval",
                  { operation_id: op.id },
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
  preview("entitlements.grant", "/v1/admin/entitlement-previews");
  commit("entitlements.grant", root);
  for (const [suffix, action] of [
    ["extensions", "extend"],
    ["revocations", "revoke"],
    ["suspensions", "suspend"],
    ["resumptions", "resume"],
  ]) {
    preview("entitlements." + action, `${root}/:grant_id/${suffix}/previews`);
    commit("entitlements." + action, `${root}/:grant_id/${suffix}`);
  }
  app.get("/v1/admin/entitlement-previews/:preview_id", auth, async (req) =>
    db.tx(
      async (tx) => {
        z.object({}).strict().parse(req.query);
        const row = (
          await tx.query(
            "SELECT *,expires_at>now() AS valid FROM admin_previews WHERE id=$1 AND principal_id=$2",
            [uuid.parse((req.params as any).preview_id), req.principal.id],
          )
        ).rows[0];
        if (
          !row ||
          row.payload.vip_command_version !== 1 ||
          row.payload.actor_session_id !== req.principal.sessionId ||
          row.payload.actor_auth_version !== req.principal.authVersion ||
          row.payload.data_mode !== mode
        )
          throw new Problem(404, "NOT_FOUND", "VIP preview not found");
        await vipAuthority(
          tx,
          req.principal,
          { kind: row.payload.subject_kind, id: row.payload.subject_id },
          vipPermission(row.action),
        );
        await vipAuthority(
          tx,
          req.principal,
          { kind: row.payload.subject_kind, id: row.payload.subject_id },
          "admin.entitlements.read",
        );
        if (!row.valid || row.consumed_at)
          throw new Problem(
            409,
            "PREVIEW_EXPIRED",
            "Create a fresh VIP preview",
          );
        await audit(
          tx,
          req.principal,
          "admin.entitlements.read",
          row.id,
          "preview",
        );
        return {
          preview_id: row.id,
          action: row.action,
          command: row.payload.command,
          before: row.payload.before,
          decision: row.payload.approval
            ? "independent_approval"
            : "recent_mfa",
          expires_at: new Date(row.expires_at).toISOString(),
        };
      },
      undefined,
      true,
    ),
  );
}
