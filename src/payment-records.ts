import type { Tx } from "./db.js";
import { canonical, hash, Problem } from "./lib.js";

export const paymentCommandHash = (account: string, command: unknown) =>
  hash(
    canonical({
      payment_record_command_version: 1,
      billing_account_id: account,
      command,
    }),
  );
export const isPaymentOperation = (op: any) =>
  op?.action === "billing.reconcile" &&
  op?.payload?.payment_record_command_version === 1;
export function validatePaymentOperation(op: any) {
  if (
    !isPaymentOperation(op) ||
    op.payload_hash !==
      paymentCommandHash(op.payload.billing_account_id, op.payload.command)
  )
    throw new Problem(
      409,
      "PAYLOAD_CHANGED",
      "Recorded payment command does not match its immutable intent",
    );
}
export async function paymentEvidence(tx: Tx, w: any, id: string) {
  const v = (
    await tx.query(
      "SELECT v.id,v.sha256,v.bytes,v.erased_at,a.state,a.retention_expires_at,a.tenant_id,a.project_id,a.private_owner,t.data_mode FROM asset_versions v JOIN assets a ON a.id=v.asset_id JOIN tenants t ON t.id=a.tenant_id WHERE v.id=$1 FOR SHARE OF v,a,t",
      [id],
    )
  ).rows[0];
  if (
    !v ||
    v.state !== "active" ||
    v.erased_at ||
    new Date(v.retention_expires_at).getTime() <= Date.now() ||
    BigInt(v.bytes) <= 0n ||
    !/^[a-f0-9]{64}$/.test(v.sha256) ||
    v.data_mode !== w.data_mode ||
    (w.tenant_id
      ? v.tenant_id !== w.tenant_id || v.private_owner !== null
      : v.private_owner !== w.user_id)
  )
    throw new Problem(
      409,
      "PAYMENT_EVIDENCE_INVALID",
      "Choose an active evidence version belonging to the payment subject and execution mode",
    );
  return v;
}
export async function paymentRecord(tx: Tx, id: string) {
  return (
    await tx.query(
      "SELECT p.*,c.verified_by,c.verified_reference,c.created_at AS confirmed_at,s.ledger_id,s.created_at AS posted_at,1+(CASE WHEN c.payment_record_id IS NULL THEN 0 ELSE 1 END)+(CASE WHEN s.payment_record_id IS NULL THEN 0 ELSE 1 END) AS version FROM payment_records p LEFT JOIN payment_confirmations c ON c.payment_record_id=p.id LEFT JOIN payment_postings s ON s.payment_record_id=p.id WHERE p.id=$1",
      [id],
    )
  ).rows[0];
}
export const paymentDTO = (p: any) => ({
  id: p.id,
  billing_account_id: p.billing_account_id,
  external_reference: p.external_reference,
  amount: { currency: "HKD", amount_micros: p.amount_micros },
  state: p.verified_by ? "confirmed" : "recorded",
  version: p.version,
  received_at: p.received_at.toISOString(),
});
export async function confirmedPayment(
  tx: Tx,
  w: any,
  id: string,
  amount: string,
) {
  const p = await paymentRecord(tx, id);
  if (!p || p.billing_account_id !== w.id || p.data_mode !== w.data_mode)
    throw new Problem(
      409,
      "PAYMENT_ACCOUNT_MISMATCH",
      "The payment must belong to this billing account and execution mode",
    );
  if (!p.verified_by)
    throw new Problem(
      409,
      "PAYMENT_NOT_CONFIRMED",
      "Independently verify the recorded payment before posting credit",
    );
  if (p.ledger_id)
    throw new Problem(
      409,
      "PAYMENT_ALREADY_POSTED",
      "This external payment has already been posted",
    );
  if (p.amount_micros !== amount)
    throw new Problem(
      409,
      "PAYMENT_AMOUNT_MISMATCH",
      "Post the exact verified payment amount",
    );
  const evidence = await paymentEvidence(tx, w, p.evidence_asset_version_id);
  if (evidence.sha256 !== p.evidence_sha256)
    throw new Problem(
      409,
      "PAYMENT_EVIDENCE_CHANGED",
      "The recorded evidence digest no longer matches",
    );
  return p;
}
