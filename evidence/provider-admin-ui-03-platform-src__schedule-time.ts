import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

export const calendarInput = z
  .object({
    timezone: z
      .string()
      .min(1)
      .max(80)
      .refine((value) => {
        if (/^[+-]/.test(value)) return false;
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Choose a supported IANA time zone"),
    frequency: z.enum(["daily", "weekly"]),
    time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
  })
  .strict()
  .refine(
    (c) =>
      c.frequency === "daily"
        ? c.weekdays.length === 0
        : c.weekdays.length > 0 &&
          new Set(c.weekdays).size === c.weekdays.length,
    "Choose unique weekdays for a weekly schedule; daily schedules have no weekday filter",
  );
export type Calendar = z.infer<typeof calendarInput>;
export interface CalendarOccurrence {
  local: string;
  scheduled_at: string | null;
  due_at: string;
  due_ms: number;
  daylight_gap: boolean;
}
function matches(calendar: Calendar, date: Temporal.PlainDate) {
  return (
    calendar.frequency === "daily" || calendar.weekdays.includes(date.dayOfWeek)
  );
}
function occurrence(
  calendar: Calendar,
  date: Temporal.PlainDate,
): CalendarOccurrence {
  const local = date.toPlainDateTime(Temporal.PlainTime.from(calendar.time));
  // A repeated wall time is assigned its first instant, once. A nonexistent
  // time is recorded at the later transition instant but never executed.
  const earlier = local.toZonedDateTime(calendar.timezone, {
    disambiguation: "earlier",
  });
  const gap = !earlier.toPlainDateTime().equals(local);
  const instant = gap ? earlier.getTimeZoneTransition("next") : earlier;
  if (!instant)
    throw new Error("A nonexistent time must have an offset transition");
  return {
    local: `${date}T${calendar.time}`,
    scheduled_at: gap ? null : instant.toInstant().toString(),
    due_at: instant.toInstant().toString(),
    due_ms: instant.epochMilliseconds,
    daylight_gap: gap,
  };
}
export function nextOccurrence(
  calendar: Calendar,
  after: number,
): CalendarOccurrence {
  const date = Temporal.Instant.fromEpochMilliseconds(after)
    .toZonedDateTimeISO(calendar.timezone)
    .toPlainDate();
  for (let days = 0; days <= 14; days++) {
    const day = date.add({ days });
    if (!matches(calendar, day)) continue;
    const candidate = occurrence(calendar, day);
    if (candidate.due_ms > after) return candidate;
  }
  throw new Error("Calendar has no next occurrence");
}
export function latestOccurrence(
  calendar: Calendar,
  at: number,
): CalendarOccurrence {
  const date = Temporal.Instant.fromEpochMilliseconds(at)
    .toZonedDateTimeISO(calendar.timezone)
    .toPlainDate();
  for (let days = 0; days <= 14; days++) {
    const day = date.subtract({ days });
    if (!matches(calendar, day)) continue;
    const candidate = occurrence(calendar, day);
    if (candidate.due_ms <= at) return candidate;
  }
  throw new Error("Calendar has no previous occurrence");
}
/** Calendar opportunities in [from, through), including nonexistent wall times. */
export function countOpportunities(
  calendar: Calendar,
  from: string,
  through: string,
) {
  const start = Temporal.PlainDate.from(from.slice(0, 10));
  const end = Temporal.PlainDate.from(through.slice(0, 10));
  const days = start.until(end, { largestUnit: "days" }).days;
  if (days <= 0) return 0;
  if (calendar.frequency === "daily") return days;
  let count = Math.floor(days / 7) * calendar.weekdays.length;
  for (let i = 0; i < days % 7; i++)
    if (calendar.weekdays.includes(start.add({ days: i }).dayOfWeek)) count++;
  return count;
}
