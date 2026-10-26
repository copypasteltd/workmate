import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { normalizeMetricsCSV } from "../src/analytics-import.js";
import {
  calculateAnalysis,
  normalizedAnalysis,
  validatedNarrative,
} from "../src/analysis-calculation.js";
const project = randomUUID();
const header =
  "date,channel,campaign,impressions,clicks,spend,conversions,revenue,currency";
function dataset(
  currency = "HKD",
  date = "2026-10-01",
  spend = "100",
  extra = {},
) {
  const csv =
    header + `\n${date},Google,Launch,1000,100,${spend},4,400,${currency}`;
  const d = normalizeMetricsCSV(csv, {
    currency,
    account_id: "account",
    attribution_definition: "7d click",
    conversion_definition: "Purchase",
  });
  return {
    id: randomUUID(),
    project_id: project,
    source: d.source,
    currency,
    timezone: d.timezone,
    rows: d.rows,
    import_spec: d.spec,
    source_sha256: d.source_sha256,
    spec_hash: d.spec_hash,
    metric_snapshot: { summary: d.summary },
    created_at: new Date(),
    ...extra,
  };
}
const spec = (ids: string[], extra = {}) =>
  normalizedAnalysis({
    prompt: "Review campaign performance",
    snapshot_ids: ids,
    date_from: "2026-10-01",
    date_to: "2026-10-02",
    timezone: "Asia/Hong_Kong",
    currency_policy: "group_by_currency",
    metrics: ["spend", "ctr", "cpa", "roas"],
    dimensions: [],
    ...extra,
  });
test("AnalysisSpec separates currencies, platforms and attribution instead of inventing cross-source totals", () => {
  const a = dataset(),
    b = dataset("USD"),
    c = dataset("HKD", "2026-10-01", "100", { source: "meta_ads" });
  const result = calculateAnalysis(
    randomUUID(),
    project,
    spec([a.id, b.id, c.id]),
    [a, b, c],
  );
  assert.equal(result.groups.length, 3);
  assert.equal(result.evidence.length, 12);
  assert.ok(
    result.groups.every(
      (g) => g.periods.current.summary.exact.spend === "100.00000000",
    ),
  );
  assert.ok(result.snapshots.every((s) => s.data_as_of === null));
  const unconfirmed = [dataset(), dataset()];
  for (const d of unconfirmed) d.import_spec.account_id = null;
  assert.equal(
    calculateAnalysis(
      randomUUID(),
      project,
      spec(unconfirmed.map((d) => d.id)),
      unconfirmed,
    ).groups.length,
    2,
  );
  assert.throws(
    () =>
      calculateAnalysis(
        randomUUID(),
        project,
        spec([a.id], { timezone: "UTC" }),
        [a],
      ),
    /timezone differs/,
  );
  assert.throws(
    () => normalizedAnalysis({ ...spec([a.id]), dimensions: ["age"] }),
    /dimension/,
  );
  assert.throws(
    () =>
      normalizedAnalysis({ ...spec([a.id]), connection_ids: [randomUUID()] }),
    /normalized/,
  );
});
test("overlapping snapshots deduplicate identical facts and reject conflicting totals", () => {
  const a = dataset(),
    b = dataset();
  const r = calculateAnalysis(randomUUID(), project, spec([a.id, b.id]), [
    a,
    b,
  ]);
  assert.equal(r.coverage.identical_facts_skipped, 1);
  assert.equal(r.groups[0].periods.current.summary.exact.spend, "100.00000000");
  const c = dataset("HKD", "2026-10-01", "110");
  assert.throws(
    () => calculateAnalysis(randomUUID(), project, spec([a.id, c.id]), [a, c]),
    /conflicting facts/,
  );
  const old = dataset("HKD", "2026-08-01", "200"),
    changedOld = dataset("HKD", "2026-08-01", "300");
  assert.equal(
    calculateAnalysis(
      randomUUID(),
      project,
      spec([a.id, old.id, changedOld.id]),
      [a, old, changedOld],
    ).groups[0].periods.current.summary.exact.spend,
    "100.00000000",
  );
});
test("comparison changes are exact, align date offsets and keep no-row and previous-zero reasons", () => {
  const a = dataset(),
    b = dataset("HKD", "2026-09-01", "0");
  const r = calculateAnalysis(
    randomUUID(),
    project,
    spec([a.id, b.id], {
      dimensions: ["date"],
      comparison: { date_from: "2026-09-01", date_to: "2026-09-02" },
    }),
    [a, b],
  );
  assert.equal(r.groups.length, 1);
  const delta = r.groups[0].changes.find(
    (e: any) => e.metric_id === "spend.change",
  );
  assert.equal(delta.value, null);
  assert.equal(delta.null_reason, "new_value");
  const missing = calculateAnalysis(
    randomUUID(),
    project,
    spec([a.id], {
      comparison: { date_from: "2026-09-01", date_to: "2026-09-02" },
    }),
    [a],
  );
  assert.equal(missing.groups[0].periods.comparison.summary.exact.spend, null);
  assert.equal(
    missing.groups[0].periods.comparison.summary.null_reasons.spend,
    "no_rows",
  );
  const previous = dataset("HKD", "2026-09-01", "80");
  const normal = calculateAnalysis(
    randomUUID(),
    project,
    spec([a.id, previous.id], {
      comparison: { date_from: "2026-09-01", date_to: "2026-09-02" },
    }),
    [a, previous],
  );
  assert.equal(normal.groups[0].changes[0].value, "0.25000000");
});
test("narrative binds frozen evidence, rejects unknown references, invented numeric literals and malformed placeholders", () => {
  const a = dataset(),
    r = calculateAnalysis(randomUUID(), project, spec([a.id]), [a]),
    id = r.evidence[0].id;
  const body = {
    observations: [{ text: `Ad spend is {{${id}}}.`, evidence_ids: [id] }],
    hypotheses: [],
    next_steps: ["Verify tracking before changing the campaign."],
  };
  assert.deepEqual(validatedNarrative(JSON.stringify(body), r), body);
  for (const text of [
    `Spend is 900. {{${id}}}`,
    `Spend is ９００. {{${id}}}`,
    `Spend {{${randomUUID()}}}`,
    `Spend {{${id}}} {{bad}}`,
  ])
    assert.throws(
      () =>
        validatedNarrative(
          JSON.stringify({
            ...body,
            observations: [{ text, evidence_ids: [id] }],
          }),
          r,
        ),
      /unverified numbers/,
    );
});
