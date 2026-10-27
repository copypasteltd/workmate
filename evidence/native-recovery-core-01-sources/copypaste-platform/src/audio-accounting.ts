import type { Tx } from "./db.js";
import { Problem } from "./lib.js";
import { audioAccountingEvidenceDocument, type AudioAccountingChannel, type AudioAccountingCommand } from "./audio-accounting-model.js";

export async function audioAccountingRow(tx: Tx, channel: AudioAccountingChannel, id: string, lock = false) {
  if (lock) await tx.query(`SELECT id FROM ${channel === "audio_customer" ? "ai_audio_jobs" : "capability_audio_probes"} WHERE id=$1 FOR UPDATE`, [id]);
  const r = (await tx.query(`SELECT * FROM current_audio_accounting_requests WHERE channel=$1 AND id=$2
    AND data_mode=current_setting('app.data_mode')`, [channel, id])).rows[0];
  if (!r) throw new Problem(404, "NOT_FOUND", "Audio accounting operation not found");
  return r;
}
export function audioAccountingDTO(r: any, costs: boolean) {
  const d: any = {};
  for (const name of ["id", "channel", "data_mode", "tenant_id", "project_id", "task_id", "validation_id", "release_id", "actor_id",
    "capability_version_id", "model_alias", "gateway_fingerprint", "kind", "pricing_unit", "state", "usage_known", "operation_id",
    "request_hash", "source_sha256", "created_at", "dispatched_at", "finished_at", "error_code", "capacity_held", "termination_confirmation_id"])
    d[name] = r[name] instanceof Date ? r[name].toISOString() : r[name];
  if (costs) d.cost = {
    state: r.cost_state, source: r.cost_confirmation_id ? "human_evidence" : r.usage_known ? "company_tariff" : "unknown",
    rate_micros: String(r.rate_micros), quoted_units: String(r.quoted_units), quoted_micros: String(r.quoted_micros),
    original_billable_units: r.billable_units === null ? null : String(r.billable_units),
    original_micros: r.actual_micros === null ? null : String(r.actual_micros),
    billable_units: r.effective_units === null ? null : String(r.effective_units),
    amount_micros: r.effective_micros === null ? null : String(r.effective_micros),
    confirmation_id: r.cost_confirmation_id, evidence_id: r.cost_evidence_id,
    allocation_exceeded: r.allocation_exceeded, accounting_resolved: r.accounting_resolved,
  };
  return d;
}
/** An accounting overlay never rewrites the observed state or qualifies media. */
export async function audioAccountingFact(tx: Tx, channel: AudioAccountingChannel, id: string, original?: any) {
  // Forward-upgrade readers may inspect retained SQL102 audio before SQL122 is
  // applied. Derive only the then-existing observation; never invent a manual
  // confirmation. Once SQL122 exists, a missing view remains an actual error.
  if (original && !(await tx.query("SELECT 1 FROM schema_migrations WHERE version=122")).rowCount)
    return audioAccountingFactDTO({ ...original, cost_state: original.usage_known ? "known" : "unknown",
      effective_micros: original.actual_micros, effective_units: original.billable_units,
      cost_confirmation_id: null, termination_confirmation_id: null, capacity_held: !original.usage_known,
      accounting_resolved: original.usage_known, allocation_exceeded: false });
  const r = await audioAccountingRow(tx, channel, id);
  return audioAccountingFactDTO(r);
}
export function audioAccountingFactDTO(r: any) {
  return { original_state: r.state, original_usage_known: r.usage_known,
    cost_state: r.cost_state, cost_source: r.cost_confirmation_id ? "human_evidence" : r.usage_known ? "company_tariff" : "unknown",
    confirmed_micros: r.effective_micros === null ? null : String(r.effective_micros),
    confirmed_units: r.effective_units === null ? null : String(r.effective_units),
    cost_confirmation_id: r.cost_confirmation_id, termination_confirmation_id: r.termination_confirmation_id,
    capacity_held: r.capacity_held, accounting_resolved: r.accounting_resolved, allocation_exceeded: r.allocation_exceeded };
}
export function assertAudioEvidenceBinding(r: any, raw: unknown, now = Date.now()) {
  const d = audioAccountingEvidenceDocument.parse(raw);
  if (r.state !== "unknown" || r.usage_known || !r.dispatched_at || !r.request_hash)
    throw new Problem(409, "AUDIO_NOT_UNKNOWN", "Only an original dispatched unknown operation accepts external evidence");
  if (d.channel !== r.channel || d.request_id !== r.id || d.data_mode !== r.data_mode
    || d.operation_id !== r.operation_id || d.request_hash !== r.request_hash || d.model_alias !== r.model_alias
    || d.gateway_fingerprint !== r.gateway_fingerprint || d.source_sha256 !== r.source_sha256
    || d.usage.kind !== r.kind || d.usage.pricing_unit !== r.pricing_unit
    || Date.parse(d.observed_at) > now || Date.parse(d.observed_at) < new Date(r.dispatched_at).getTime()
    || (d.outcome === "not_executed" && (d.usage.billable_units !== 0 || BigInt(d.billed_micros) !== 0n)))
    throw new Problem(400, "AUDIO_EVIDENCE_MISMATCH", "Evidence must retain the original audio identity, source, usage kind and observation time");
  return d;
}
export function audioEvidenceCost(r: any, raw: unknown, now = Date.now()) {
  const d = assertAudioEvidenceBinding(r, raw, now), units = BigInt(d.usage.billable_units);
  const amount = units * BigInt(r.rate_micros);
  if (amount !== BigInt(d.billed_micros))
    throw new Problem(409, "AUDIO_PRICE_MISMATCH", "The external audio invoice must match the original frozen tariff; resolve discrepancies separately");
  return { billable_units: units.toString(), rate_micros: String(r.rate_micros), amount_micros: amount.toString(),
    allocation_exceeded: amount > BigInt(r.quoted_micros), pricing_unit: r.pricing_unit };
}
export async function inspectAudioAccountingCommand(tx: Tx, b: AudioAccountingCommand) {
  const r = await audioAccountingRow(tx, b.channel, b.request_id, true);
  const e = (await tx.query("SELECT * FROM ai_audio_evidence WHERE id=$1 AND data_mode=current_setting('app.data_mode')", [b.evidence_id])).rows[0];
  if (!e || (b.channel === "audio_customer" ? e.audio_job_id : e.audio_probe_id) !== r.id)
    throw new Problem(404, "NOT_FOUND", "Audio evidence not found for this operation");
  const document = assertAudioEvidenceBinding(r, e.document);
  if (b.action === "ai.cost.reconcile" ? !!r.cost_confirmation_id : !!r.termination_confirmation_id)
    throw new Problem(409, "AUDIO_ALREADY_CONFIRMED", "This audio accounting fact already has an independent confirmation");
  return { scope: { data_mode: r.data_mode, tenant_id: r.tenant_id, project_id: r.project_id },
    request: audioAccountingDTO(r, true),
    evidence: { id: e.id, document_hash: e.document_hash, document, actor_id: e.actor_id, reason: e.reason },
    cost: b.action === "ai.cost.reconcile" ? audioEvidenceCost(r, document) : null };
}
export async function applyAudioAccountingCommand(tx: Tx, op: any,
  c: Awaited<ReturnType<typeof inspectAudioAccountingCommand>>, reviewer: string) {
  if (reviewer === c.evidence.actor_id)
    throw new Problem(403, "SELF_EVIDENCE_REVIEW_FORBIDDEN", "The evidence author cannot approve its audio accounting consequences");
  const cost = op.action === "ai.cost.reconcile", r = c.request;
  const table = cost ? "ai_audio_cost_confirmations" : "ai_audio_termination_confirmations";
  const values = [r.channel === "audio_customer" ? r.id : null, r.channel === "audio_validation" ? r.id : null,
    c.evidence.id, r.data_mode, op.id, op.principal_id, reviewer,
    ...(cost ? [c.cost!.billable_units, c.cost!.rate_micros] : [])];
  const saved = (await tx.query(`INSERT INTO ${table}(audio_job_id,audio_probe_id,evidence_id,data_mode,operation_id,actor_id,reviewer_id
    ${cost ? ",billable_units,rate_micros" : ""}) VALUES(${values.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING id`, values)).rows[0];
  return { request_id: r.id, channel: r.channel, confirmation_id: saved.id, evidence_id: c.evidence.id,
    original_state_preserved: "unknown", ...(cost ? { cost: c.cost } : { capacity_released: true }),
    customer_charged: false, media_qualified: false };
}
