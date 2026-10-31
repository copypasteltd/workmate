import { z } from "zod";
import { name, uuid } from "./lib.js";
import {workflowInputValues} from "./workflow-contracts.js";
import {
  calendarInput,
  nextOccurrence,
  type Calendar,
} from "./schedule-time.js";

export const scheduleOptions = z
  .object({
    name,
    calendar: calendarInput,
    catch_up: z.enum(["latest", "skip"]),
    starts_at: z.string().datetime({ offset: true }).optional(),
    ends_at: z.string().datetime({ offset: true }).nullable(),
    expected_output: z.string().trim().min(3).max(1000),
  })
  .strict();
export const scheduleToolRequest = scheduleOptions
  .extend({
    workflow_id: uuid,
    workflow_version: z.number().int().positive(),
    workflow_definition_hash: z.string().regex(/^[a-f0-9]{64}$/),
    inputs:workflowInputValues.optional(),
  })
  .strict();
export const scheduleRequestDecision = z
  .object({
    decision: z.enum(["activate", "decline"]),
    specification_hash: z.string().regex(/^[a-f0-9]{64}$/),
    max_budget_micros: z.number().int().nonnegative().safe(),
  })
  .strict();
export const scheduleControl = z
  .object({
    action: z.enum(["pause", "resume", "retire"]),
    expected_version: z.number().int().positive(),
    specification_hash: z.string().regex(/^[a-f0-9]{64}$/),
    max_budget_micros: z.number().int().nonnegative().safe(),
  })
  .strict();
export type CloudScheduleBody = {
  name: string;
  calendar: Calendar;
  catch_up: "latest" | "skip";
  starts_at: string;
  ends_at: string | null;
  expected_output: string;
  origin_task_id: string;
  workflow_id: string;
  workflow_version: number;
  workflow_definition_hash: string;
  role_hashes: Record<string, string>;
  source_refs: Record<string, unknown>;
  input_binding?:{values:Record<string,string|number|boolean>;files:any[];input_hash:string};
  max_budget_micros: number;
  actor_auth_version: number;
  replaces_schedule_id: string | null;
  expected_schedule_version: number | null;
};
export function normalizeScheduleOptions(
  raw: z.infer<typeof scheduleOptions>,
  now = Date.now(),
) {
  const start = raw.starts_at ? Date.parse(raw.starts_at) : now;
  const end = raw.ends_at ? Date.parse(raw.ends_at) : null;
  if (start < now - 300_000 || (end !== null && (end <= start || end <= now)))
    throw new Error("SCHEDULE_INTERVAL");
  const body = {
    ...raw,
    calendar: {
      ...raw.calendar,
      weekdays: [...raw.calendar.weekdays].sort((a, b) => a - b),
    },
    starts_at: new Date(start).toISOString(),
    ends_at: end === null ? null : new Date(end).toISOString(),
  };
  if (end !== null && nextOccurrence(body.calendar, start - 1).due_ms >= end)
    throw new Error("SCHEDULE_EMPTY");
  return body;
}
export function upcomingScheduleTimes(
  body: Pick<CloudScheduleBody, "calendar" | "starts_at" | "ends_at">,
  now = Date.now(),
) {
  let after = Math.max(now, Date.parse(body.starts_at)) - 1;
  const result = [];
  for (let i = 0; i < 5; i++) {
    const point = nextOccurrence(body.calendar, after);
    if (body.ends_at && point.due_ms >= Date.parse(body.ends_at)) break;
    result.push(point);
    after = point.due_ms;
  }
  return result;
}
