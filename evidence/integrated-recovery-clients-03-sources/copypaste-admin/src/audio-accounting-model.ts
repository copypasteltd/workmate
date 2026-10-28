import { parseHKD } from "./financial-money";

/** Only observed invoice fields are editable; identity always comes from the API. */
export function audioEvidenceInput(request: any, form: FormData) {
  const units = String(form.get("billable_units") ?? "");
  if (!/^(0|[1-9][0-9]{0,6})$/.test(units) || BigInt(units) > 1000000n)
    throw new Error("計費量必須是 0–1,000,000 的整數 / Billable units must be an integer from 0 to 1,000,000");
  const amount = parseHKD(String(form.get("invoice_hkd") ?? ""), true);
  if (BigInt(amount) > 9999999999999999n) throw new Error("帳單超出支援範圍 / Invoice is outside the supported range");
  if (form.get("terminated") !== "on") throw new Error("請確認原請求已終止 / Confirm original termination");
  const outcome = String(form.get("outcome"));
  if (!["completed", "failed", "cancelled", "not_executed"].includes(outcome)) throw new Error("Invalid final outcome");
  if (outcome === "not_executed" && (BigInt(units) !== 0n || amount !== "0")) throw new Error("未執行的作業必須為零用量及費用 / Unexecuted operations require zero usage and cost");
  const observed = new Date(String(form.get("observed_at")));
  if (!Number.isFinite(observed.getTime()) || observed.getTime() > Date.now() || observed < new Date(request.dispatched_at))
    throw new Error("請填寫派發後的實際證據時間 / Enter an actual observation time after dispatch");
  return { document: {
    schema_version: 1, channel: request.channel, request_id: request.id, data_mode: request.data_mode,
    operation_id: request.operation_id, request_hash: request.request_hash, model_alias: request.model_alias,
    gateway_fingerprint: request.gateway_fingerprint, source_sha256: request.source_sha256,
    provider_reference: String(form.get("provider_reference")).trim(), source_reference: String(form.get("source_reference")).trim(),
    source_note: String(form.get("source_note")).trim(), observed_at: observed.toISOString(), terminated: true,
    outcome, currency: "HKD", billed_micros: amount,
    usage: { kind: request.kind, pricing_unit: request.pricing_unit, billable_units: Number(units) },
  }, reason: String(form.get("reason")).trim() };
}
