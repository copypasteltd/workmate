import { z } from "zod";
import { uuid } from "./lib.js";

export const audioAccountingChannel = z.enum(["audio_customer", "audio_validation"]);
export type AudioAccountingChannel = z.infer<typeof audioAccountingChannel>;
const reason = z.string().trim().min(3).max(1000);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const audioAccountingEvidenceDocument = z.object({
  schema_version: z.literal(1),
  channel: audioAccountingChannel,
  request_id: uuid,
  data_mode: z.enum(["simulated", "configured_services"]),
  operation_id: uuid,
  request_hash: digest,
  model_alias: z.string().min(1).max(200),
  gateway_fingerprint: digest,
  source_sha256: digest.nullable(),
  provider_reference: z.string().trim().min(3).max(300),
  source_reference: z.string().trim().min(3).max(500),
  source_note: z.string().trim().min(10).max(8000),
  observed_at: z.string().datetime({ offset: true }),
  terminated: z.literal(true),
  outcome: z.enum(["completed", "failed", "cancelled", "not_executed"]),
  currency: z.literal("HKD"),
  billed_micros: z.string().regex(/^(0|[1-9][0-9]{0,15})$/),
  usage: z.object({
    kind: z.enum(["speech", "transcription"]),
    pricing_unit: z.enum(["unicode_scalar", "input_millisecond"]),
    billable_units: z.number().int().min(0).max(1000000),
  }).strict(),
}).strict();
export const audioAccountingEvidenceCreate = z.object({ document: audioAccountingEvidenceDocument, reason }).strict();
export const audioAccountingCommand = z.object({
  action: z.enum(["ai.cost.reconcile", "ai.capacity.release"]),
  channel: audioAccountingChannel,
  request_id: uuid,
  evidence_id: uuid,
  reason,
}).strict();
export type AudioAccountingCommand = z.infer<typeof audioAccountingCommand>;
export const audioAccountingQuery = z.object({
  cursor: z.string().min(1).max(4096).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  channel: audioAccountingChannel.default("audio_customer"),
  state: z.enum(["prepared", "dispatched", "completed", "cancelled", "unknown"]).optional(),
  cost_state: z.enum(["known", "unknown", "manually_confirmed"]).optional(),
  capacity_state: z.enum(["held", "released"]).optional(),
  tenant_id: uuid.optional(), project_id: uuid.optional(), task_id: uuid.optional(),
  validation_id: uuid.optional(), release_id: uuid.optional(), actor_id: uuid.optional(),
  period_from: z.string().datetime({ offset: true }).optional(),
  period_to: z.string().datetime({ offset: true }).optional(),
}).strict().refine(q => !q.period_from || !q.period_to || Date.parse(q.period_from) < Date.parse(q.period_to),
  { path: ["period_to"], message: "Choose an increasing observation period" });
