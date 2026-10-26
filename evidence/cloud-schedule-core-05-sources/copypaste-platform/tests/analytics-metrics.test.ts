import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { metrics, decimalMicros, parseMetricsCSV } from "../src/analytics.js";
import { normalizeMetricsCSV } from "../src/analytics-import.js";
import { metricRow } from "../src/metric-calculator.js";
import { Problem } from "../src/lib.js";

const vectors = JSON.parse(
  readFileSync(
    new URL("../catalog/analytics-metric-vectors.json", import.meta.url),
    "utf8",
  ),
);
for (const vector of vectors.cases)
  test(`authoritative Decimal vector: ${vector.id}`, () => {
    for (const [currency, expected] of Object.entries(vector.expected) as [
      string,
      Record<string, unknown>,
    ][]) {
      const rows = vector.rows
        .filter((r: any) => r.currency === currency)
        .map((r: any) => ({
          date: "2026-10-01",
          channel: "test",
          impressions: r.impressions,
          clicks: r.clicks,
          spend_micros: decimalMicros(r.spend),
          conversions: r.conversions,
          revenue_micros:
            r.conversion_value === null
              ? null
              : decimalMicros(r.conversion_value),
        }));
      const result = metrics(rows);
      assert.equal(result.calculation.formula_version, vectors.formula_version);
      assert.equal(result.calculation.precision, vectors.precision);
      for (const [key, value] of Object.entries(expected)) {
        const exact = result.exact[key];
        if (
          ["ctr", "cpc", "cpm", "cvr", "cpa", "roas"].includes(key) ||
          value === null
        )
          assert.equal(exact, value, key);
        else assert.equal(Number(exact), Number(value), key);
      }
    }
  });
const head =
  "date,channel,campaign,impressions,clicks,spend,conversions,revenue,currency";
test("decimal conversion sums retain eight fractional places; unknown rows do not become zero", () => {
  // Click definitions can count events rather than unique impression exposure.
  // Preserve the supplied totals instead of imposing an undocumented cap.
  assert.equal(
    parseMetricsCSV(
      "date,channel,impressions,clicks,spend\n2026-10-01,Meta,10,12,2",
    ).summary.exact.ctr,
    "1.20000000",
  );
  const d = parseMetricsCSV(
    head +
      "\n2026-10-01,Google,A,100,10,0.1,0.10000001,0.3,HKD\n2026-10-02,Google,A,100,10,0.2,0.2,0.6,HKD",
  );
  assert.equal(d.summary.exact.conversions, "0.30000001");
  assert.equal(d.summary.exact.spend, "0.30000000");
  assert.equal(d.summary.exact.roas, "3.00000000");
  for (const conversions of ["abc", "1e2", ".5", "1.000000000"])
    assert.equal(
      metricRow.safeParse({ ...d.rows[0], conversions }).success,
      false,
    );
  const missing = parseMetricsCSV(
    head +
      "\n2026-10-01,Google,A,100,10,20,,--,HKD\n2026-10-02,Google,A,100,10,20,2,40,HKD",
  );
  assert.equal(missing.rows[0].conversions, null);
  assert.equal(missing.summary.conversions, null);
  assert.equal(missing.summary.exact.cpa, null);
  assert.equal(missing.summary.null_reasons.roas, "missing_conversion_value");
  assert.equal(missing.summary.coverage.unknown_conversion_rows, 1);
  assert.equal(
    parseMetricsCSV(
      "date,channel,impressions,clicks,spend\n2026-10-01,Google,10,1,2",
    ).summary.exact.conversions,
    null,
  );
  assert.equal(
    metrics([
      {
        date: "2026-10-01",
        channel: "x",
        campaign: "",
        impressions: 3,
        clicks: 2,
        spend_micros: 1,
        conversions: "0.00000001",
        revenue_micros: 0,
      },
    ]).exact.cpa,
    "100.00000000",
  );
});
test("CSV fact identity skips identical rows, rejects conflicts and retains source and mappings", () => {
  const row = "2026-10-01,Google,A,100,10,20,2,40,HKD";
  const csv = "\ufeff" + head + "\r\n" + row + "\r\n" + row;
  const a = parseMetricsCSV(csv),
    b = normalizeMetricsCSV(csv, { source_filename: "another-name.csv" });
  assert.equal(a.row_count, 1);
  assert.equal(a.duplicate_row_count, 1);
  assert.equal(a.summary.spend_micros, 20000000);
  assert.equal(a.import_key, b.import_key);
  assert.equal(a.mapping.spend, "spend");
  assert.notEqual(
    a.import_key,
    normalizeMetricsCSV(csv, { attribution_definition: "7d click" }).import_key,
  );
  assert.throws(
    () =>
      parseMetricsCSV(head + "\n" + row + "\n" + row.replace(",100,", ",101,")),
    (e: any) =>
      e.code === "CSV_GRAIN_CONFLICT" && e.details[0].path.startsWith("row 3."),
  );
});
test("official-style Google/Meta headers require explicit daily account, grain and attribution scope", () => {
  const options = {
    source: "google_ads" as const,
    currency: "HKD",
    account_id: "123",
    entity_level: "campaign" as const,
    attribution_definition: "7d click / 1d view",
    conversion_definition: "Purchase",
    timezone: "Asia/Hong_Kong",
  };
  const google =
    "Day,Campaign,Campaign ID,Customer ID,Impressions,Clicks,Cost,Conversions,Conv. value\n2026-10-01,Launch,456,123,100,10,20,2.5,50";
  const a = normalizeMetricsCSV(google, options);
  assert.equal(a.rows[0].entity_id, "456");
  assert.equal(a.summary.exact.cpa, "8.00000000");
  assert.equal(a.spec.account_id, "123");
  assert.equal(a.rows[0].channel, "Google Ads");
  const meta =
    "Reporting starts,Reporting ends,Campaign name,Campaign ID,Account ID,Impressions,Link clicks,Amount spent (HKD),Purchases,Purchase conversion value\n2026-10-01,2026-10-01,Launch,456,123,100,10,20,,";
  assert.equal(
    normalizeMetricsCSV(meta, { ...options, source: "meta_ads" }).summary
      .null_reasons.cpa,
    "missing_conversions",
  );
  assert.throws(
    () =>
      normalizeMetricsCSV(
        meta.replace("2026-10-01,2026-10-01", "2026-10-01,2026-10-07"),
        { ...options, source: "meta_ads" },
      ),
    /daily rows/,
  );
  assert.throws(
    () => normalizeMetricsCSV(google, { source: "google_ads" }),
    /require account/,
  );
  assert.throws(
    () => normalizeMetricsCSV(google, { ...options, account_id: "999" }),
    /Account does not match/,
  );
  assert.throws(
    () =>
      normalizeMetricsCSV(meta, {
        ...options,
        source: "meta_ads",
        currency: "USD",
      }),
    /Currency does not match/,
  );
});
test("bad CSV fields report physical lines; ambiguous and duplicate mappings cannot silently choose a metric", () => {
  const bad = (csv: string, code?: string) =>
    assert.throws(
      () => parseMetricsCSV(csv),
      (e: unknown) =>
        e instanceof Problem &&
        (!code || e.code === code) &&
        Array.isArray(e.details) &&
        e.details[0].path.startsWith("row "),
    );
  bad(head + "\n2026-10-01,Google,A,100,,20,2,40,HKD");
  assert.throws(
    () => parseMetricsCSV(head + "\n2026-10-01,,A,100,2,20,2,40,HKD"),
    (e: unknown) =>
      e instanceof Problem &&
      Array.isArray(e.details) &&
      e.details[0].path === "row 2.channel",
  );
  const blankCurrency = head + "\n2026-10-01,Google,A,100,2,20,2,40,";
  const assumed = parseMetricsCSV(blankCurrency);
  assert.equal(assumed.currency, "HKD");
  assert.ok(assumed.warning_codes.includes("assumed_currency"));
  assert.ok(
    assumed.warnings.some((warning) => warning.includes("assumed HKD")),
  );
  assert.ok(
    !normalizeMetricsCSV(blankCurrency, {
      currency: "USD",
    }).warning_codes.includes("assumed_currency"),
  );
  bad(head + "\n2026-02-30,Google,A,100,2,20,2,40,HKD");
  bad(head + "\n2026-10-01,Google,A,100,2,=1+1,2,40,HKD");
  for (const c of ["\u0000", "\u0001", "\uD800", "\uFFFF"])
    bad(head + `\n2026-10-01,Google,A${c},100,2,20,2,40,HKD`, "CSV_INVALID");
  assert.equal(
    parseMetricsCSV(head + "\n2026-10-01,Google,高端🚀,100,2,20,2,40,HKD")
      .rows[0].campaign,
    "高端🚀",
  );
  bad(head + ",Clicks\n2026-10-01,Google,A,100,2,20,2,40,HKD,2", "CSV_COLUMNS");
  const ambiguous =
    head + ",Link clicks\n2026-10-01,Google,A,100,2,20,2,40,HKD,1";
  bad(ambiguous, "CSV_MAPPING_AMBIGUOUS");
  assert.equal(
    normalizeMetricsCSV(ambiguous, { mapping: { clicks: "Link clicks" } })
      .summary.clicks,
    1,
  );
  bad(head + '\n2026-10-01,Google,"Line one\nLine two",100,nope,20,2,40,HKD');
  assert.throws(
    () =>
      parseMetricsCSV(
        head +
          "\n2026-10-01,Google,A,100,2,20,2,40,HKD\n2026-10-02,Google,A,100,2,20,2,40,USD",
      ),
    /separate dataset/,
  );
});
