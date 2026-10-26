import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calendarInput,
  nextOccurrence,
  latestOccurrence,
  countOpportunities,
} from "../src/schedule-time.js";
const daily = (timezone: string, time: string) =>
  calendarInput.parse({ timezone, time, frequency: "daily" });

test("calendar validates IANA zones, clocks and weekday choices and uses local dates across UTC offsets", () => {
  for (const value of [
    { timezone: "Mars/City", frequency: "daily", time: "09:00" },
    { timezone: "+08:00", frequency: "daily", time: "09:00" },
    { timezone: "UTC", frequency: "weekly", time: "09:00", weekdays: [] },
    { timezone: "UTC", frequency: "weekly", time: "09:00", weekdays: [1, 1] },
    { timezone: "UTC", frequency: "daily", time: "24:00" },
  ])
    assert.equal(calendarInput.safeParse(value).success, false);
  assert.equal(
    nextOccurrence(
      daily("Asia/Hong_Kong", "09:00"),
      Date.parse("2026-10-18T12:00:00Z"),
    ).scheduled_at,
    "2026-10-19T01:00:00Z",
  );
  assert.equal(
    nextOccurrence(
      daily("Asia/Kathmandu", "09:00"),
      Date.parse("2026-10-18T12:00:00Z"),
    ).scheduled_at,
    "2026-10-19T03:15:00Z",
  );
});
test("nonexistent DST wall times are skipped at the transition and repeated times select the first instant once", () => {
  const spring = daily("America/New_York", "02:30"),
    gap = nextOccurrence(spring, Date.parse("2026-03-08T00:00:00Z"));
  assert.equal(gap.local, "2026-03-08T02:30");
  assert.equal(gap.scheduled_at, null);
  assert.equal(gap.due_at, "2026-03-08T07:00:00Z");
  assert.equal(
    nextOccurrence(spring, gap.due_ms).scheduled_at,
    "2026-03-09T06:30:00Z",
  );
  const fall = daily("America/New_York", "01:30"),
    repeated = nextOccurrence(fall, Date.parse("2026-11-01T00:00:00Z"));
  assert.equal(repeated.scheduled_at, "2026-11-01T05:30:00Z");
  assert.equal(
    latestOccurrence(fall, Date.parse("2026-11-01T06:45:00Z")).scheduled_at,
    repeated.scheduled_at,
  );
  assert.equal(
    nextOccurrence(fall, repeated.due_ms).scheduled_at,
    "2026-11-02T06:30:00Z",
  );
});
test("half-hour DST transitions and skipped calendar days do not consume the next valid day", () => {
  const half = nextOccurrence(
    daily("Australia/Lord_Howe", "02:15"),
    Date.parse("2026-10-03T12:00:00Z"),
  );
  assert.equal(half.daylight_gap, true);
  assert.equal(half.due_at, "2026-10-03T15:30:00Z");
  const apia = daily("Pacific/Apia", "12:00"),
    missing = nextOccurrence(apia, Date.parse("2011-12-30T00:00:00Z"));
  assert.equal(missing.local, "2011-12-30T12:00");
  assert.equal(missing.daylight_gap, true);
  assert.equal(nextOccurrence(apia, missing.due_ms).local, "2011-12-31T12:00");
});
test("weekly schedules and bounded catch-up counts handle leap years and long downtime without enumerating all dates", () => {
  const c = calendarInput.parse({
    timezone: "Asia/Hong_Kong",
    frequency: "weekly",
    time: "09:00",
    weekdays: [1, 5],
  });
  assert.equal(
    nextOccurrence(c, Date.parse("2026-10-19T01:00:00Z")).local,
    "2026-10-23T09:00",
  );
  assert.equal(
    latestOccurrence(c, Date.parse("2026-10-25T01:00:00Z")).local,
    "2026-10-23T09:00",
  );
  assert.equal(
    countOpportunities(c, "2026-10-19T09:00", "2026-11-02T09:00"),
    4,
  );
  assert.equal(
    countOpportunities(
      daily("UTC", "00:00"),
      "2024-02-28T00:00",
      "2024-03-01T00:00",
    ),
    2,
  );
  assert.equal(
    countOpportunities(c, "2000-01-03T09:00", "2026-10-19T09:00"),
    2796,
  );
});
