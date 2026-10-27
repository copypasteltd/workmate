import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { name, Problem, uuid } from "./lib.js";

export const eventType = z.string().regex(/^[a-z][a-z0-9_.-]{2,79}$/);
export const eventOptions = z.object({
  name,
  event_type: eventType,
  timezone: z.string().min(1).max(80),
  overlap_policy: z.enum(["skip", "latest"]),
  min_interval_seconds: z.number().int().min(10).max(86400),
  max_runs_per_day: z.number().int().min(1).max(100),
  max_event_age_seconds: z.number().int().min(60).max(86400),
  starts_at: z.string().datetime({ offset: true }).optional(),
  ends_at: z.string().datetime({ offset: true }),
  expected_output: z.string().trim().min(3).max(1000),
}).strict();
export const eventRequest = eventOptions.extend({
  workflow_id: uuid,
  workflow_version: z.number().int().positive(),
  workflow_definition_hash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const eventDecision = z.object({
  decision: z.enum(["activate", "decline"]),
  specification_hash: z.string().regex(/^[a-f0-9]{64}$/),
  max_budget_micros: z.number().int().nonnegative().safe(),
  max_daily_budget_micros: z.number().int().nonnegative().safe(),
}).strict();
export const eventControl = z.object({
  action: z.enum(["pause", "retire"]),
  expected_version: z.number().int().positive(),
}).strict();
export type FrozenEventMethod = {
  origin_task_id: string; workflow_id: string; workflow_version: number;
  workflow_definition_hash: string; role_hashes: Record<string, string>;
  source_refs: Record<string, unknown>; max_budget_micros: number;
};
export type EventBody = FrozenEventMethod & Omit<z.infer<typeof eventOptions>, "starts_at"> & {
  starts_at: string; actor_auth_version: number; max_daily_budget_micros: number;
  replaces_trigger_id: string | null; expected_trigger_version: number | null;
};
export const eventBodyDTO = eventOptions.extend({ starts_at: z.string().datetime({ offset: true }), origin_task_id: uuid,
  workflow_id: uuid, workflow_version: z.number().int().positive(), workflow_definition_hash: z.string().regex(/^[a-f0-9]{64}$/),
  role_hashes: z.record(z.string(), z.string()), source_refs: z.record(z.string(), z.unknown()),
  max_budget_micros: z.number().int().nonnegative().safe(), max_daily_budget_micros: z.number().int().nonnegative().safe(),
  actor_auth_version: z.number().int().positive(), replaces_trigger_id: uuid.nullable(), expected_trigger_version: z.number().int().positive().nullable(),
}).strict();
export const eventReceiptDTO = z.object({ id: uuid, trigger_id: uuid, revision: z.number().int().positive(), key_version: z.number().int().positive(),
  event_id: z.string(), event_type: eventType, state: z.enum(["pending","launched","ignored_type","ignored_inactive","expired","skipped_overlap","coalesced","skipped_limit","skipped_revision","blocked"]),
  run_id: uuid.nullable(), code: z.string().nullable(), raw_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  received_at: z.string().datetime(), occurred_at: z.string().datetime(), expires_at: z.string().datetime(), launched_at: z.string().datetime().nullable(),
}).strict();
export const eventTriggerDTO = z.object({ id: uuid, name, state: z.enum(["active","paused","blocked","retired","ended"]),
  revision: z.number().int().positive(), version: z.number().int().positive(), key_version: z.number().int().positive(),
  body: eventBodyDTO, specification_hash: z.string().regex(/^[a-f0-9]{64}$/), endpoint: z.string().url(),
  last_error: z.string().nullable(), last_dispatched_at: z.string().datetime().nullable(), created_at: z.string().datetime(),
}).strict();
export function normalizeEventOptions(raw: z.infer<typeof eventOptions>, at = Date.now()) {
  const v = eventOptions.parse(raw), start = v.starts_at ? Date.parse(v.starts_at) : at, end = Date.parse(v.ends_at);
  if (start < at - 300_000 || end <= Math.max(at, start) || end - start > 366 * 86400_000)
    throw new Problem(400, "EVENT_INTERVAL_INVALID", "Choose a current start and an end within one year");
  let timezone: string;
  try { timezone = new Intl.DateTimeFormat("en", { timeZone: v.timezone }).resolvedOptions().timeZone; }
  catch { throw new Problem(400, "EVENT_TIMEZONE_INVALID", "Choose a valid IANA timezone"); }
  return { ...v, timezone, starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString() };
}

// Workmate owns this protocol. Sign the exact bytes; never reserialize before verification.
export function eventSignature(secret: string, trigger: string, version: number, timestamp: string, raw: Buffer) {
  return "v1=" + createHmac("sha256", secret)
    .update(`workmate.event.v1\n${trigger}\n${version}\n${timestamp}\n`).update(raw).digest("hex");
}
export function verifyEventSignature(secret: string, trigger: string, version: number, timestamp: unknown, signature: unknown, raw: Buffer, at = Date.now()) {
  if (typeof timestamp !== "string" || !/^\d{10}$/.test(timestamp) || typeof signature !== "string" || !/^v1=[a-f0-9]{64}$/.test(signature) || Math.abs(Number(timestamp) * 1000 - at) > 300_000)
    return false;
  return timingSafeEqual(Buffer.from(eventSignature(secret, trigger, version, timestamp, raw)), Buffer.from(signature));
}
export const eventEnvelope = z.object({
  event_id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/),
  event_type: eventType,
  occurred_at: z.string().datetime({ offset: true }),
  data: z.record(z.string(), z.unknown()),
}).strict();
export function parseEventEnvelope(raw: Buffer) {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
  catch { throw new Problem(400, "EVENT_JSON_INVALID", "Supply a valid UTF-8 JSON event"); }
  const event = eventEnvelope.parse(value);
  let nodes = 0;
  function visit(v: unknown, depth: number) {
    if (typeof v === "number" && !Number.isFinite(v))
      throw new Problem(400, "EVENT_DATA_INVALID", "Use finite JSON numbers");
    if (++nodes > 300 || depth > 6 || typeof v === "string" && v.length > 4000)
      throw new Problem(400, "EVENT_DATA_TOO_COMPLEX", "Use at most six JSON levels, 300 values and 4000 characters per string");
    if (v && typeof v === "object") {
      for (const [k, child] of Object.entries(v)) {
        if (k.length > 80 || ["__proto__", "constructor", "prototype"].includes(k))
          throw new Problem(400, "EVENT_DATA_KEY_INVALID", "Use bounded ordinary JSON keys");
        visit(child, depth + 1);
      }
    }
  }
  visit(event.data, 0);
  if (Date.parse(event.occurred_at) > Date.now() + 300_000)
    throw new Problem(400, "EVENT_TIME_INVALID", "The occurrence time is in the future");
  return event;
}
