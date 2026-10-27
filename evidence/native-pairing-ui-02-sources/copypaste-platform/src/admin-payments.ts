import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import { audit, requireAdmin, type Principal } from "./auth.js";
import { key, replay } from "./access.js";
import { lockAdminAccess } from "./admin-access.js";
import { financialAccount, financialAuthority } from "./admin-fees.js";
import { readScope, pageBounds, pageCursor } from "./admin-directory.js";
import { adminOperationDTO } from "./admin-memberships.js";
import { pinAdminPolicy } from "./admin-operation-policy.js";
import {
  paymentCommandHash,
  paymentRecord,
  paymentDTO,
  paymentEvidence,
} from "./payment-records.js";
import { Problem, uuid } from "./lib.js";

const identifier = uuid.transform((v) => v.toLowerCase());
const reference = z
  .string()
  .min(1)
  .refine(
    (v) => v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v),
    "Use the exact external reference without control characters or surrounding spaces",
  );
const positive = z
  .object({
    currency: z.literal("HKD"),
    amount_micros: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .refine((v) => BigInt(v) <= 9223372036854775807n),
  })
  .strict();
const reason = z.string().min(3).max(1000);
const record = z
  .object({
    billing_account_id: identifier,
    external_reference: reference,
    amount: positive,
    received_at: z.string().datetime({ offset: true }),
    evidence_asset_version_id: identifier,
    reason,
  })
  .strict();
const confirm = z
  .object({
    expected_version: z.number().int().min(1),
    reason,
    verified_reference: reference,
  })
  .strict();
const query = z
  .object({
    cursor: z.string().min(1).max(4096).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
const mode = (db: Database) =>
  db.config.DEMO_MODE ? "simulated" : "configured_services";

export async function createPaymentEvidenceOperation(
  tx: Tx,
  p: Principal,
  w: any,
  command: unknown,
  requestKey: string,
) {
  const policy = await pinAdminPolicy(tx, {
    type:
      (command as any).kind === "refund_outcome"
        ? "manual-refund-evidence.v1"
        : "manual-payment-evidence.v1",
    independent_evidence_verifier: true,
    posts_credit: false,
  });
  return (
    await tx.query(
      "INSERT INTO admin_operations(principal_id,action,tenant_id,payload_hash,payload,idempotency_key,state,policy_version_id,target_ids) VALUES($1,'billing.reconcile',$2,$3,$4,$5,'running',$6,$7) RETURNING *",
      [
        p.id,
        w.tenant_id,
        paymentCommandHash(w.id, command),
        {
          payment_record_command_version: 1,
          billing_account_id: w.id,
          command,
        },
        `payment:${paymentCommandHash(w.id, { kind: (command as any).kind, target: (command as any).refund_id ?? (command as any).payment_id ?? w.id, requestKey })}`,
        policy,
        [w.id],
      ],
    )
  ).rows[0];
}
async function succeeded(
  tx: Tx,
  p: Principal,
  w: any,
  op: any,
  id: string,
  action: string,
  reason: string,
) {
  await tx.query(
    "UPDATE admin_operations SET state='succeeded',version=version+1,result_ids=$2,result=$3 WHERE id=$1",
    [op.id, [id], { payment_record_id: id, posts_credit: false }],
  );
  await audit(
    tx,
    p,
    action,
    id,
    "succeeded",
    {
      reason,
      billing_account_id: w.id,
      operation_id: op.id,
      posts_credit: false,
      verification_method: "manual_evidence_review",
    },
    w.tenant_id ?? undefined,
  );
}
export function registerAdminPayments(app: FastifyInstance, db: Database) {
  const auth = { preHandler: requireAdmin(db) },
    root = "/v1/admin/billing/payments";
  app.get(root, auth, async (req) => {
    const q = query.parse(req.query);
    return db.tx(
      async (tx) => {
        const s = await readScope(tx, req.principal, "admin.billing.read"),
          bounds = await pageBounds(
            tx,
            db,
            req.principal,
            s,
            { ...q, data_mode: mode(db) },
            "billing_payments",
          );
        let where = `w.data_mode=${s.arg(mode(db))} AND ${s.account("admin.billing.read")} AND p.created_at<=${s.arg(bounds.asof)}::timestamptz`;
        if (bounds.after)
          where += ` AND (p.created_at,p.id)<(${s.arg(bounds.after.at)}::timestamptz,${s.arg(bounds.after.id)}::uuid)`;
        const rows = (
          await tx.query(
            `SELECT p.id,to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM payment_records p JOIN wallets w ON w.id=p.billing_account_id WHERE ${where} ORDER BY p.created_at DESC,p.id DESC LIMIT ${s.arg(q.limit + 1)}`,
            s.values,
          )
        ).rows;
        const selected = rows.slice(0, q.limit),
          items = [];
        for (const row of selected)
          items.push(paymentDTO(await paymentRecord(tx, row.id)));
        await audit(tx, req.principal, "admin.billing.read", "payments");
        return {
          items,
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
  // Supplemental evidence/provenance view. The normative list remains strict.
  app.get(root + "/:payment", auth, async (req) => {
    const id = identifier.parse((req.params as any).payment);
    return db.tx(
      async (tx) => {
        await lockAdminAccess(tx);
        const p = await paymentRecord(tx, id);
        if (!p) throw new Problem(404, "NOT_FOUND", "Payment record not found");
        const w = await financialAccount(tx, db, p.billing_account_id);
        await financialAuthority(tx, req.principal, w, "admin.billing.read");
        await audit(tx, req.principal, "admin.billing.read", id);
        return {
          payment: paymentDTO(p),
          evidence_asset_version_id: p.evidence_asset_version_id,
          evidence_sha256: p.evidence_sha256,
          recorded_by: p.created_by,
          verification_method: p.verified_by ? "manual_evidence_review" : null,
          verified_by: p.verified_by ?? null,
          confirmed_at: p.confirmed_at?.toISOString() ?? null,
          posted_entry_id: p.ledger_id ?? null,
          posted_at: p.posted_at?.toISOString() ?? null,
          data_mode: w.data_mode,
          refunded_amount: {
            currency: "HKD",
            amount_micros: p.refunded_micros,
          },
          refund_pending: p.refund_pending,
        };
      },
      undefined,
      true,
    );
  });
  app.post(root, auth, async (req, reply) => {
    reply.code(202);
    const b = record.parse(req.body),
      requestKey = key(req);
    return db.tx(
      async (tx) => {
        await lockAdminAccess(tx);
        const w = await financialAccount(tx, db, b.billing_account_id);
        await financialAuthority(
          tx,
          req.principal,
          w,
          "admin.billing.reconcile",
          BigInt(b.amount.amount_micros),
        );
        const saved = await replay(
          tx,
          req.principal.id,
          "payment.record",
          requestKey,
          b,
          async () => {
            if (
              !(
                await tx.query("SELECT $1::timestamptz<=now() AS valid", [
                  b.received_at,
                ])
              ).rows[0].valid
            )
              throw new Problem(
                409,
                "PAYMENT_DATE_INVALID",
                "A recorded receipt cannot be in the future",
              );
            const evidence = await paymentEvidence(
              tx,
              w,
              b.evidence_asset_version_id,
            );
            if (
              (
                await tx.query(
                  "SELECT 1 FROM payment_records WHERE data_mode=$1 AND external_reference=$2",
                  [w.data_mode, b.external_reference],
                )
              ).rowCount
            )
              throw new Problem(
                409,
                "PAYMENT_REFERENCE_DUPLICATE",
                "This external payment has already been recorded",
              );
            if (
              (
                await tx.query(
                  "SELECT 1 FROM ledger WHERE kind='top_up' AND data_mode=$1 AND reference=$2 LIMIT 1",
                  [w.data_mode, b.external_reference],
                )
              ).rowCount
            )
              throw new Problem(
                409,
                "PAYMENT_REFERENCE_HISTORICAL",
                "This external reference already occurs in the historical funding ledger; reconcile that original transaction",
              );
            const op = await createPaymentEvidenceOperation(
              tx,
              req.principal,
              w,
              { kind: "record", body: b },
              requestKey,
            );
            const row = (
              await tx.query(
                "INSERT INTO payment_records(billing_account_id,data_mode,external_reference,amount_micros,received_at,evidence_asset_version_id,evidence_sha256,created_by,operation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
                [
                  w.id,
                  w.data_mode,
                  b.external_reference,
                  b.amount.amount_micros,
                  b.received_at,
                  evidence.id,
                  evidence.sha256,
                  req.principal.id,
                  op.id,
                ],
              )
            ).rows[0];
            await succeeded(
              tx,
              req.principal,
              w,
              op,
              row.id,
              "admin.payment.record",
              b.reason,
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
  app.post(root + "/:payment/confirmations", auth, async (req, reply) => {
    reply.code(202);
    const id = identifier.parse((req.params as any).payment),
      b = confirm.parse(req.body),
      requestKey = key(req);
    return db.tx(
      async (tx) => {
        await lockAdminAccess(tx);
        const p = await paymentRecord(tx, id);
        if (!p) throw new Problem(404, "NOT_FOUND", "Payment record not found");
        const w = await financialAccount(tx, db, p.billing_account_id);
        await financialAuthority(
          tx,
          req.principal,
          w,
          "admin.billing.reconcile",
          BigInt(p.amount_micros),
        );
        const saved = await replay(
          tx,
          req.principal.id,
          `payment.confirm:${id}`,
          requestKey,
          b,
          async () => {
            if (p.created_by === req.principal.id)
              throw new Problem(
                403,
                "PAYMENT_SELF_VERIFICATION",
                "Another authorized administrator must independently check the evidence",
              );
            if (p.version !== b.expected_version)
              throw new Problem(
                409,
                "VERSION_CONFLICT",
                "Payment record changed; review its current version",
              );
            if (p.verified_by)
              throw new Problem(
                409,
                "PAYMENT_ALREADY_CONFIRMED",
                "This receipt has already been verified",
              );
            if (p.external_reference !== b.verified_reference)
              throw new Problem(
                409,
                "PAYMENT_REFERENCE_MISMATCH",
                "The independently verified reference must match the original receipt exactly",
              );
            const evidence = await paymentEvidence(
              tx,
              w,
              p.evidence_asset_version_id,
            );
            if (evidence.sha256 !== p.evidence_sha256)
              throw new Problem(
                409,
                "PAYMENT_EVIDENCE_CHANGED",
                "The evidence no longer matches its recorded digest",
              );
            const op = await createPaymentEvidenceOperation(
              tx,
              req.principal,
              w,
              { kind: "confirm", payment_id: id, body: b },
              requestKey,
            );
            await tx.query(
              "INSERT INTO payment_confirmations(payment_record_id,verified_reference,verified_by,evidence_sha256,operation_id) VALUES($1,$2,$3,$4,$5)",
              [
                id,
                b.verified_reference,
                req.principal.id,
                p.evidence_sha256,
                op.id,
              ],
            );
            await succeeded(
              tx,
              req.principal,
              w,
              op,
              id,
              "admin.payment.confirm",
              b.reason,
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
