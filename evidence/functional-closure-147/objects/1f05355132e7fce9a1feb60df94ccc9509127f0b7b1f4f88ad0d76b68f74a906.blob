import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import { requireAdmin, audit } from "./auth.js";
import { lockAdminAccess } from "./admin-access.js";
import { financialAccount, financialAuthority } from "./admin-fees.js";
import { createPaymentEvidenceOperation } from "./admin-payments.js";
import { paymentEvidence } from "./payment-records.js";
import { adminOperationDTO } from "./admin-memberships.js";
import { readScope, pageBounds, pageCursor } from "./admin-directory.js";
import { billingEvent } from "./billing-events.js";
import { replay, key } from "./access.js";
import { Problem, uuid } from "./lib.js";

const identifier = uuid.transform((v) => v.toLowerCase());
const money = z
  .object({
    currency: z.literal("HKD"),
    amount_micros: z
      .string()
      .regex(/^(0|[1-9][0-9]*)$/)
      .refine((v) => BigInt(v) <= 9223372036854775807n),
  })
  .strict();
const reference = z
  .string()
  .min(1)
  .max(512)
  .refine((v) => v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v));
export const refundOutcome = z
  .object({
    expected_version: z.number().int().min(1),
    reason: z.string().min(3).max(1000),
    outcome: z.enum(["paid", "not_paid", "unknown"]),
    observed_amount: money.nullable(),
    external_reference: reference.nullable(),
    evidence_asset_version_id: identifier.nullable(),
    occurred_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()
  .refine(
    (b) =>
      b.outcome === "unknown" ||
      (b.observed_amount !== null &&
        b.external_reference !== null &&
        b.evidence_asset_version_id !== null &&
        b.occurred_at !== null),
    "Known outcomes require an exact observed amount, external reference, evidence version and actual time",
  );
type Outcome = z.infer<typeof refundOutcome>;
const mode = (db: Database) =>
  db.config.DEMO_MODE ? "simulated" : "configured_services";
export async function refundRecord(tx: Tx, id: string) {
  return (
    await tx.query(
      "SELECT r.*,w.data_mode,1+(SELECT count(*)::int FROM billing_refund_events e WHERE e.refund_id=r.id) AS version,coalesce((SELECT sum(e.observed_amount_micros) FROM billing_refund_events e WHERE e.refund_id=r.id AND e.outcome='paid'),0)::text AS paid_micros,EXISTS(SELECT 1 FROM billing_refund_events e WHERE e.refund_id=r.id AND e.outcome='not_paid') AS remainder_not_paid,(SELECT e.outcome FROM billing_refund_events e WHERE e.refund_id=r.id ORDER BY e.expected_version DESC LIMIT 1) AS latest_outcome FROM billing_refunds r JOIN wallets w ON w.id=r.billing_account_id WHERE r.id=$1",
      [id],
    )
  ).rows[0];
}
export function refundDTO(r: any) {
  const amount = BigInt(r.amount_micros),
    paid = BigInt(r.paid_micros),
    held =
      r.destination === "paid_balance" || r.remainder_not_paid
        ? 0n
        : amount - paid;
  return {
    id: r.id,
    billing_account_id: r.billing_account_id,
    operation_id: r.operation_id,
    original_entry_id: r.original_entry_id,
    destination: r.destination,
    amount: { currency: "HKD", amount_micros: r.amount_micros },
    confirmed_paid: { currency: "HKD", amount_micros: r.paid_micros },
    held: { currency: "HKD", amount_micros: held.toString() },
    state:
      r.destination === "paid_balance"
        ? "compensated"
        : r.remainder_not_paid
          ? paid
            ? "partially_paid_closed"
            : "not_paid"
          : paid === amount
            ? "paid"
            : r.latest_outcome === "mismatch"
              ? "reconciling_mismatch"
              : r.latest_outcome === "unknown"
                ? "reconciling_unknown"
                : paid
                  ? "partially_paid"
                  : "awaiting_evidence",
    version: r.version,
    created_by: r.created_by,
    created_at: r.created_at.toISOString(),
    data_mode: r.data_mode,
    payment_record_id: r.payment_record_id ?? null,
  };
}
export function registerAdminRefunds(app: FastifyInstance, db: Database) {
  const auth = { preHandler: requireAdmin(db) },
    root = "/v1/admin/billing/refunds";
  app.get(root, auth, async (req) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(25),
        cursor: z.string().min(1).max(4096).optional(),
        billing_account_id: identifier.optional(),
      })
      .strict()
      .parse(req.query);
    return db.tx(
      async (tx) => {
        const scope = await readScope(tx, req.principal, "admin.billing.read"),
          bounds = await pageBounds(
            tx,
            db,
            req.principal,
            scope,
            { ...q, data_mode: mode(db) },
            "billing_refunds",
          );
        let where = `w.data_mode=${scope.arg(mode(db))} AND ${scope.account("admin.billing.read")} AND r.created_at<=${scope.arg(bounds.asof)}::timestamptz`;
        if (q.billing_account_id)
          where += ` AND r.billing_account_id=${scope.arg(q.billing_account_id)}::uuid`;
        if (bounds.after)
          where += ` AND (r.created_at,r.id)<(${scope.arg(bounds.after.at)}::timestamptz,${scope.arg(bounds.after.id)}::uuid)`;
        const rows = (
          await tx.query(
            `SELECT r.id,to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM billing_refunds r JOIN wallets w ON w.id=r.billing_account_id WHERE ${where} ORDER BY r.created_at DESC,r.id DESC LIMIT ${scope.arg(q.limit + 1)}`,
            scope.values,
          )
        ).rows;
        const selected = rows.slice(0, q.limit),
          items = [];
        for (const row of selected)
          items.push(refundDTO(await refundRecord(tx, row.id)));
        await audit(tx, req.principal, "admin.billing.read", "refunds");
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
  app.get(root + "/:refund", auth, async (req) => {
    const id = identifier.parse((req.params as any).refund);
    return db.tx(
      async (tx) => {
        await lockAdminAccess(tx);
        const r = await refundRecord(tx, id);
        if (!r) throw new Problem(404, "NOT_FOUND", "Refund record not found");
        const w = await financialAccount(tx, db, r.billing_account_id);
        await financialAuthority(tx, req.principal, w, "admin.billing.read");
        const parts = (
          await tx.query(
            "SELECT p.id,p.source_id,p.repayment_part_id,p.cancellation_id,p.restored_lot_id,p.amount_micros,p.journal_id,p.expiry_journal_id,f.kind AS restored_kind,f.expires_at FROM billing_refund_source_parts p LEFT JOIN funding_lots f ON f.id=p.restored_lot_id WHERE p.refund_id=$1 ORDER BY p.created_at,p.id",
            [id],
          )
        ).rows;
        const events = (
          await tx.query(
            "SELECT e.id,e.expected_version,e.outcome,e.observed_amount_micros,e.external_reference,e.evidence_asset_version_id,e.evidence_sha256,e.occurred_at,e.verified_by,e.operation_id,e.reason,e.created_at,c.journal_id,c.release_journal_id FROM billing_refund_events e LEFT JOIN billing_refund_closures c ON c.event_id=e.id WHERE e.refund_id=$1 ORDER BY e.expected_version",
            [id],
          )
        ).rows;
        await audit(tx, req.principal, "admin.billing.read", id);
        return {
          refund: refundDTO(r),
          source_parts: parts,
          events,
          verification_method: "manual_evidence_review",
          bank_api_verified: false,
        };
      },
      undefined,
      true,
    );
  });
  app.post(root + "/:refund/outcomes", auth, async (req, reply) => {
    reply.code(202);
    const id = identifier.parse((req.params as any).refund),
      b = refundOutcome.parse(req.body),
      requestKey = key(req);
    return db.tx(
      async (tx) => {
        await lockAdminAccess(tx);
        let r = await refundRecord(tx, id);
        if (!r) throw new Problem(404, "NOT_FOUND", "Refund record not found");
        const w = await financialAccount(tx, db, r.billing_account_id);
        await financialAuthority(
          tx,
          req.principal,
          w,
          "admin.billing.reconcile",
          BigInt(r.amount_micros),
        );
        await financialAuthority(
          tx,
          req.principal,
          w,
          "admin.billing.refund",
          BigInt(r.amount_micros),
        );
        if (r.created_by === req.principal.id)
          throw new Problem(
            403,
            "INDEPENDENT_REFUND_REVIEW_REQUIRED",
            "Another authorized administrator must verify the actual cash outcome",
          );
        const saved = await replay(
          tx,
          req.principal.id,
          `refund.outcome:${id}`,
          requestKey,
          b,
          async () => {
            r = await refundRecord(tx, id);
            if (r.destination !== "payment_method")
              throw new Problem(
                409,
                "CASH_REFUND_REQUIRED",
                "Product compensation has no external cash payout",
              );
            const remaining = BigInt(r.amount_micros) - BigInt(r.paid_micros);
            if (r.remainder_not_paid || remaining === 0n)
              throw new Problem(
                409,
                "REFUND_ALREADY_CLOSED",
                "This cash refund has no remaining unconfirmed amount",
              );
            if (r.version !== b.expected_version)
              throw new Problem(
                409,
                "VERSION_CONFLICT",
                "Refund evidence changed; reload before reviewing",
              );
            if (
              b.occurred_at &&
              !(
                await tx.query("SELECT $1::timestamptz<=now() AS valid", [
                  b.occurred_at,
                ])
              ).rows[0].valid
            )
              throw new Problem(
                409,
                "REFUND_DATE_INVALID",
                "An external outcome cannot occur in the future",
              );
            const evidence = b.evidence_asset_version_id
              ? await paymentEvidence(tx, w, b.evidence_asset_version_id)
              : null;
            const observed = b.observed_amount
              ? BigInt(b.observed_amount.amount_micros)
              : null;
            const outcome =
              (b.outcome === "paid" &&
                (observed === null ||
                  observed <= 0n ||
                  observed > remaining)) ||
              (b.outcome === "not_paid" && observed !== 0n)
                ? "mismatch"
                : b.outcome;
            if (
              outcome === "paid" &&
              (
                await tx.query(
                  "SELECT 1 FROM billing_refund_events WHERE data_mode=$1 AND external_reference=$2 AND outcome='paid'",
                  [w.data_mode, b.external_reference],
                )
              ).rowCount
            )
              throw new Problem(
                409,
                "REFUND_REFERENCE_DUPLICATE",
                "This actual external refund has already been recorded",
              );
            const op = await createPaymentEvidenceOperation(
              tx,
              req.principal,
              w,
              { kind: "refund_outcome", refund_id: id, body: b },
              requestKey,
            );
            const event = (
              await tx.query(
                "INSERT INTO billing_refund_events(refund_id,billing_account_id,data_mode,expected_version,outcome,observed_amount_micros,external_reference,evidence_asset_version_id,evidence_sha256,occurred_at,verified_by,operation_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id",
                [
                  id,
                  w.id,
                  w.data_mode,
                  b.expected_version,
                  outcome,
                  observed?.toString() ?? null,
                  b.external_reference,
                  b.evidence_asset_version_id,
                  evidence?.sha256 ?? null,
                  b.occurred_at,
                  req.principal.id,
                  op.id,
                  b.reason,
                ],
              )
            ).rows[0];
            const journalIds: string[] = [];
            if (outcome === "paid" || outcome === "not_paid") {
              const amount = outcome === "paid" ? observed! : remaining;
              const held = (
                await tx.query(
                  "SELECT * FROM funding_lots WHERE id=$1 AND billing_account_id=$2 FOR UPDATE",
                  [r.lot_id, w.id],
                )
              ).rows[0];
              if (
                !held ||
                BigInt(held.reserved_micros) < amount ||
                BigInt(w.reserved_micros) < amount
              )
                throw new Problem(
                  409,
                  "REFUND_RECONCILIATION_REQUIRED",
                  "The original cash commitment no longer matches the account",
                );
              const release = await billingEvent(tx, w.id, {
                action: "billing.refund",
                kind: "release",
                direction: "debit",
                bucket: "reserved",
                amount,
                reason: b.reason,
                source_entry_id: r.hold_journal_id,
                actor: {
                  actor_id: req.principal.id,
                  admin_operation_id: op.id,
                },
              });
              journalIds.push(release);
              await tx.query(
                "UPDATE funding_lots SET reserved_micros=reserved_micros-$2,remaining_micros=remaining_micros-$3 WHERE id=$1",
                [
                  r.lot_id,
                  amount.toString(),
                  outcome === "paid" ? amount.toString() : "0",
                ],
              );
              await tx.query(
                "UPDATE wallets SET reserved_micros=reserved_micros-$2,balance_micros=balance_micros-$3,version=version+1 WHERE id=$1",
                [
                  w.id,
                  amount.toString(),
                  outcome === "paid" ? amount.toString() : "0",
                ],
              );
              let journal = release;
              if (outcome === "paid") {
                const raw = (
                  await tx.query(
                    "SELECT raw_entry_id FROM billing_journal WHERE id=$1",
                    [r.original_entry_id],
                  )
                ).rows[0].raw_entry_id;
                const entry = (
                  await tx.query(
                    "INSERT INTO ledger(tenant_id,billing_account_id,kind,amount_micros,reference,source_id,idempotency_key,reason,actor_id,operation_id) VALUES($1,$2,'refund',$3,$4,$5,$6,$7,$8,$9) RETURNING id",
                    [
                      w.tenant_id,
                      w.id,
                      (-amount).toString(),
                      `refund:${id}:${event.id}`,
                      raw,
                      `refund:${event.id}`,
                      b.reason,
                      req.principal.id,
                      op.id,
                    ],
                  )
                ).rows[0];
                journal = entry.id;
                journalIds.push(journal);
              }
              await tx.query(
                "INSERT INTO billing_refund_closures(refund_id,event_id,billing_account_id,journal_id,release_journal_id) VALUES($1,$2,$3,$4,$5)",
                [id, event.id, w.id, journal, release],
              );
            }
            const updated = await refundRecord(tx, id),
              closed =
                updated.remainder_not_paid ||
                updated.paid_micros === updated.amount_micros;
            const state = closed
              ? updated.remainder_not_paid
                ? BigInt(updated.paid_micros)
                  ? "partially_succeeded"
                  : "cancelled"
                : "succeeded"
              : "reconciling";
            await tx.query(
              "UPDATE admin_operations SET state=$2,result=coalesce(result,'{}'::jsonb)||$3::jsonb,version=version+1 WHERE id=$1",
              [
                r.operation_id,
                state,
                JSON.stringify({
                  refund: refundDTO(updated),
                  last_outcome_event_id: event.id,
                }),
              ],
            );
            await tx.query(
              "UPDATE admin_operations SET state='succeeded',result=$2,result_ids=$3,version=version+1 WHERE id=$1",
              [
                op.id,
                {
                  refund_id: id,
                  recorded_outcome: outcome,
                  refund_state: refundDTO(updated).state,
                  journal_ids: journalIds,
                  verification_method: "manual_evidence_review",
                  bank_api_verified: false,
                },
                [id, event.id, ...journalIds],
              ],
            );
            await audit(
              tx,
              req.principal,
              "admin.billing.refund.outcome",
              id,
              outcome === "unknown" || outcome === "mismatch"
                ? "reconciling"
                : "succeeded",
              {
                reason: b.reason,
                operation_id: op.id,
                original_operation_id: r.operation_id,
                outcome,
                observed_amount_micros: observed?.toString() ?? null,
                evidence_sha256: evidence?.sha256 ?? null,
                external_reference: b.external_reference,
                journal_ids: journalIds,
              },
              w.tenant_id ?? undefined,
            );
            return { id: op.id };
          },
        );
        const op = (
          await tx.query("SELECT * FROM admin_operations WHERE id=$1", [
            saved.id,
          ])
        ).rows[0];
        return adminOperationDTO(op);
      },
      undefined,
      true,
    );
  });
}
