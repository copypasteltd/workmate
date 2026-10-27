import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unzipSync } from "fflate";
import { PNG } from "pngjs";
import { parse } from "csv-parse/sync";
import { normalizeMetricsCSV } from "../src/analytics-import.js";
import {
  calculateAnalysis,
  normalizedAnalysis,
} from "../src/analysis-calculation.js";
import {
  analysisCalculationPage,
  calculationDigest,
  renderAnalysisDelivery,
} from "../src/analysis-role-delivery.js";
const project = randomUUID();
const header =
  "date,channel,campaign,impressions,clicks,spend,conversions,revenue,currency";
function dataset(currency = "HKD", campaign = "Launch", extra = {}) {
  const d = normalizeMetricsCSV(
    header +
      `\n2026-10-01,Google,${campaign},100,10,10,1,20,${currency}\n2026-10-02,Google,${campaign},1000,200,90,3,180,${currency}\n2026-09-01,Google,${campaign},100,5,20,0,0,${currency}`,
    {
      currency,
      account_id: "account",
      attribution_definition: "7d click",
      conversion_definition: "Purchase",
    },
  );
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
    created_at: new Date("2026-10-25T00:00:00Z"),
    ...extra,
  };
}
function fixture(datasets = [dataset()], extra = {}) {
  const specification = normalizedAnalysis({
    prompt: "Review campaign evidence and propose a creative experiment",
    snapshot_ids: datasets.map((d) => d.id),
    date_from: "2026-10-01",
    date_to: "2026-10-02",
    timezone: "Asia/Hong_Kong",
    currency_policy: "group_by_currency",
    metrics: ["spend", "ctr", "cpa", "roas"],
    dimensions: [],
    comparison: { date_from: "2026-09-01", date_to: "2026-09-02" },
    ...extra,
  });
  const calculation = calculateAnalysis(
    randomUUID(),
    project,
    specification,
    datasets,
  );
  const input = {
    specification,
    calculation_sha256: calculationDigest(calculation),
    title: "Campaign evidence review",
    locale: "en-HK",
    metrics: ["spend", "ctr"],
    scope_ids: calculation.groups.map((g) => g.periods.current.id),
  };
  return { datasets, calculation, input };
}
test("integer count metrics produce actual charts alongside decimal spend and percentage metrics", () => {
  const f = fixture();
  const specification = normalizedAnalysis({
    ...f.input.specification,
    metrics: ["spend", "ctr", "impressions", "clicks"],
  });
  const calculation = calculateAnalysis(
    randomUUID(),
    project,
    specification,
    f.datasets,
  );
  const result = renderAnalysisDelivery(
    calculation,
    {
      ...f.input,
      specification,
      calculation_sha256: calculationDigest(calculation),
      metrics: ["impressions", "clicks", "spend", "ctr"],
      scope_ids: calculation.groups.map((g) => g.periods.current.id),
    },
    f.datasets,
    "simulated",
  );
  const svg = result.files
    .find((f) => f.name === "infographic.svg")!
    .bytes.toString();
  assert.match(svg, />1100<\/text>/);
  assert.match(svg, />210<\/text>/);
  assert.match(svg, /19\.09090900%/);
  assert.ok(
    result.files.find((f) => f.name === "infographic.png")!.bytes.length >
      10000,
  );
});

test("professional analysis delivery contains real reproducible files with exact ratios, source scope and a byte-checked ZIP", () => {
  const f = fixture(),
    result = renderAnalysisDelivery(
      f.calculation,
      f.input,
      f.datasets,
      "simulated",
    );
  assert.equal(result.files.length, 9);
  const files = new Map(result.files.map((f) => [f.name, f.bytes]));
  const png = PNG.sync.read(files.get("infographic.png")!);
  assert.equal(png.width, 1200);
  assert.ok(png.height > 500);
  const csv = parse(files.get("metrics.csv")!, {
    columns: true,
    bom: true,
  }) as any[];
  assert.equal(
    csv.find(
      (r: any) =>
        r.metric === "ctr" && JSON.parse(r.scope).period === "current",
    ).exact_value,
    "0.19090909",
  );
  assert.equal(
    csv.find(
      (r: any) =>
        r.metric === "cpa" && JSON.parse(r.scope).period === "comparison",
    ).null_reason,
    "zero_denominator",
  );
  const source = JSON.parse(files.get("analysis.source.json")!.toString());
  assert.equal(
    source.calculation_sha256,
    calculationDigest(source.calculation),
  );
  assert.equal(source.data_mode, "simulated");
  const archived = unzipSync(files.get("analysis-delivery.zip")!);
  for (const f of result.files.filter((f) => !f.name.endsWith(".zip")))
    assert.deepEqual(Buffer.from(archived[f.name]), f.bytes);
  const manifest = JSON.parse(
    Buffer.from(archived["manifest.json"]).toString(),
  );
  assert.equal(manifest.files.length, 7);
  assert.equal(manifest.editable_source, "analysis.source.json");
  assert.match(files.get("infographic.svg")!.toString(), /simulated/);
  assert.match(files.get("infographic.svg")!.toString(), /19\.09090900%/);
  assert.match(files.get("report.html")!.toString(), /Content-Security-Policy/);
});
test("a changed source timestamp or requested specification invalidates the frozen hash before any delivery", () => {
  const f = fixture();
  assert.throws(
    () =>
      renderAnalysisDelivery(
        f.calculation,
        { ...f.input, calculation_sha256: "0".repeat(64) },
        f.datasets,
        "simulated",
      ),
    /does not match/,
  );
  const changed = structuredClone(f.calculation);
  changed.sources[0].captured_at = new Date("2026-10-26T00:00:00Z");
  assert.notEqual(calculationDigest(changed), calculationDigest(f.calculation));
  assert.equal(
    calculationDigest(JSON.parse(JSON.stringify(f.calculation))),
    calculationDigest(f.calculation),
  );
});
test("mixed currencies remain independent chart scopes and null values never become a false zero", () => {
  const a = dataset(),
    b = dataset("USD");
  b.rows = b.rows.map((r) => ({
    ...r,
    conversions: null,
    revenue_micros: null,
  }));
  const f = fixture([a, b]),
    result = renderAnalysisDelivery(
      f.calculation,
      { ...f.input, metrics: ["cpa", "roas"] },
      f.datasets,
      "simulated",
    );
  const svg = result.files
    .find((f) => f.name.endsWith(".svg"))!
    .bytes.toString();
  assert.match(svg, /HKD/);
  assert.match(svg, /USD/);
  assert.match(svg, /N\/A · Conversion data is incomplete/);
  assert.match(svg, /N\/A · Conversion value is incomplete/);
  const csv = parse(result.files.find((f) => f.name === "metrics.csv")!.bytes, {
    columns: true,
    bom: true,
  });
  assert.ok(
    csv.some(
      (r: any) =>
        r.exact_value === "" && r.null_reason === "missing_conversions",
    ),
  );
  assert.equal(f.calculation.groups.length, 2);
});
test("scope/metric substitution, duplicates, invented numerical narrative and numerical headline are rejected", () => {
  const f = fixture();
  for (const input of [
    { ...f.input, scope_ids: [randomUUID()] },
    { ...f.input, metrics: ["clicks"] },
    { ...f.input, scope_ids: [f.input.scope_ids[0], f.input.scope_ids[0]] },
    { ...f.input, metrics: ["spend", "spend"] },
    { ...f.input, title: "ROAS increased 999%" },
    {
      ...f.input,
      narrative: {
        observations: [
          {
            text: `Invented 999 {{${f.calculation.evidence[0].id}}}`,
            evidence_ids: [f.calculation.evidence[0].id],
          },
        ],
        hypotheses: [],
        next_steps: ["Review source coverage."],
      },
    },
  ])
    assert.throws(() =>
      renderAnalysisDelivery(f.calculation, input, f.datasets, "simulated"),
    );
});
test("hostile source labels remain literal text and spreadsheet formula cells cannot execute", () => {
  const f = fixture([dataset("HKD", "=HYPERLINK()")], {
    dimensions: ["campaign"],
  });
  f.calculation.groups[0].scope.account_id = "<img src=x onerror=alert()>";
  f.input.calculation_sha256 = calculationDigest(f.calculation);
  const result = renderAnalysisDelivery(
    f.calculation,
    f.input,
    f.datasets,
    "simulated",
  );
  const html = result.files
    .find((f) => f.name === "report.html")!
    .bytes.toString();
  assert.ok(!html.includes("<img src=x"));
  assert.match(html, /&lt;img/);
  const facts = parse(
    result.files.find((f) => f.name === "source-facts.csv")!.bytes,
    { columns: true, bom: true },
  ) as any[];
  assert.equal(facts[0].campaign, "'=HYPERLINK()");
});
test("evidence paging retains all evidence exactly once with bounded scope context", () => {
  const f = fixture([dataset(), dataset("USD"), dataset("GBP")]);
  const seen = new Set<string>();
  let offset: number | null = 0;
  while (offset !== null) {
    const page = analysisCalculationPage(f.calculation, offset);
    assert.ok(page.evidence.length <= 24);
    assert.equal(page.calculation_sha256, f.input.calculation_sha256);
    for (const e of page.evidence) {
      assert.ok(!seen.has(e.id));
      seen.add(e.id);
    }
    offset = page.next_offset;
  }
  assert.equal(seen.size, f.calculation.evidence.length);
  assert.throws(
    () => analysisCalculationPage(f.calculation, seen.size + 1),
    /offset/,
  );
});
test("revision files preserve the old source version while changed dates recompute all metrics", () => {
  const original = fixture(),
    revision = fixture(original.datasets, {
      date_from: "2026-10-02",
      date_to: "2026-10-02",
    });
  const binding = { source_version_id: randomUUID(), sha256: "a".repeat(64) };
  const result = renderAnalysisDelivery(
    revision.calculation,
    { ...revision.input, revision_of: binding },
    revision.datasets,
    "simulated",
  );
  assert.notEqual(original.input.calculation_sha256, result.calculation_sha256);
  assert.equal(
    revision.calculation.groups[0].periods.current.summary.exact.spend,
    "90.00000000",
  );
  assert.equal(
    original.calculation.groups[0].periods.current.summary.exact.spend,
    "100.00000000",
  );
  assert.deepEqual(result.manifest.revision_of, binding);
  assert.match(
    result.files.find((f) => f.name === "report.html")!.bytes.toString(),
    new RegExp(binding.source_version_id),
  );
});
