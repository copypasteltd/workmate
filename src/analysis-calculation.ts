import { z } from "zod";
import { canonical, hash, Problem, uuid } from "./lib.js";
import { metrics, type MetricRow } from "./metric-calculator.js";

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().startsWith(s),
  );
export const metricIds = [
  "spend",
  "impressions",
  "clicks",
  "conversions",
  "conversion_value",
  "ctr",
  "cpc",
  "cpm",
  "cvr",
  "cpa",
  "roas",
] as const;
export const analysisSpec = z
  .object({
    prompt: z.string().trim().min(1).max(8000),
    snapshot_ids: z.array(uuid).max(10).default([]),
    connection_ids: z.array(uuid).max(10).default([]),
    date_from: day,
    date_to: day,
    timezone: z.string().min(1).max(80),
    currency_policy: z.literal("group_by_currency"),
    metrics: z.array(z.enum(metricIds)).min(1).max(11),
    dimensions: z.array(z.string().min(1).max(80)).max(7),
    account_ids: z.array(z.string().min(1).max(200)).max(100).default([]),
    attribution_definition: z.string().trim().min(1).max(1000).optional(),
    comparison: z.object({ date_from: day, date_to: day }).strict().optional(),
  })
  .strict();
export type AnalysisSpec = z.infer<typeof analysisSpec>;
export type Evidence = {
  id: string;
  snapshot_id: string;
  metric_id: string;
  value: string | null;
  unit: string;
  formula_version: string;
  scope: string;
  null_reason: string | null;
};
type Dataset = {
  id: string;
  project_id: string;
  source: string;
  currency: string;
  timezone: string;
  rows: MetricRow[];
  import_spec: any;
  source_sha256: string;
  spec_hash: string;
  metric_snapshot: any;
  supersedes_id?: string | null;
  correction_ancestors?: string[];
  created_at: string | Date;
};
export function stableAnalysisId(value: unknown) {
  const h = hash(canonical(value));
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const supportedDimensions = new Set([
  "date",
  "channel",
  "campaign",
  "entity_id",
  "source",
  "account_id",
  "currency",
]);
export function normalizedAnalysis(input: unknown) {
  const b = analysisSpec.parse(input);
  if (
    b.date_from > b.date_to ||
    (b.comparison && b.comparison.date_from > b.comparison.date_to)
  )
    throw new Problem(
      422,
      "ANALYSIS_DATE_RANGE",
      "The start date must not follow the end date",
    );
  try {
    new Intl.DateTimeFormat("en", { timeZone: b.timezone });
  } catch {
    throw new Problem(422, "ANALYSIS_TIMEZONE", "Choose a valid IANA timezone");
  }
  for (const d of b.dimensions)
    if (!supportedDimensions.has(d))
      throw new Problem(
        422,
        "ANALYSIS_DIMENSION_UNAVAILABLE",
        `This source does not provide dimension: ${d}`,
      );
  if (b.connection_ids.length)
    throw new Problem(
      409,
      "ANALYSIS_SYNC_REQUIRED",
      "Import a verified daily snapshot before analysis; live connector reports are not yet normalized",
    );
  if (!b.snapshot_ids.length)
    throw new Problem(
      422,
      "ANALYSIS_SOURCE_REQUIRED",
      "Select at least one verified source snapshot",
    );
  return {
    ...b,
    snapshot_ids: [...new Set(b.snapshot_ids)].sort(),
    metrics: [...new Set(b.metrics)].sort(),
    dimensions: [...new Set(b.dimensions)].sort(),
    account_ids: [...new Set(b.account_ids)].sort(),
  };
}
const money = new Set(["spend", "conversion_value", "cpc", "cpm", "cpa"]);
const unit = (metric: string, currency: string) =>
  money.has(metric)
    ? currency
    : ["ctr", "cvr", "roas"].includes(metric)
      ? "ratio"
      : "count";
const indexDay = (s: string) => Date.parse(s) / 86400000;
const scaled = (s: string) => {
  const [a, b = ""] = s.split(".");
  return BigInt(a) * 100000000n + BigInt(b.padEnd(8, "0"));
};
function change(current: string | null, previous: string | null) {
  if (current === null || previous === null)
    return { value: null, reason: "missing_metric" };
  const a = scaled(current),
    b = scaled(previous);
  if (!b) return { value: null, reason: a ? "new_value" : "zero_previous" };
  const n = a - b,
    abs = n < 0n ? -n : n,
    v = (abs * 100000000n + b / 2n) / b;
  return {
    value: `${n < 0n && v ? "-" : ""}${v / 100000000n}.${(v % 100000000n).toString().padStart(8, "0")}`,
    reason: null,
  };
}
export function calculateAnalysis(
  reportId: string,
  project: string,
  spec: AnalysisSpec,
  datasets: Dataset[],
) {
  if (
    datasets.some((d) =>
      [
        ...(d.correction_ancestors ?? []),
        ...(d.supersedes_id ? [d.supersedes_id] : []),
      ].some((id) => spec.snapshot_ids.includes(id)),
    )
  )
    throw new Problem(
      409,
      "ANALYSIS_CORRECTION_OVERLAP",
      "Select either the original snapshot or its correction, not both",
    );
  if (
    datasets.length !== spec.snapshot_ids.length ||
    datasets.some((d) => !spec.snapshot_ids.includes(d.id))
  )
    throw new Problem(404, "NOT_FOUND", "A source snapshot is unavailable");
  type Group = {
    scope: Record<string, unknown>;
    current: MetricRow[];
    comparison: MetricRow[];
    origins: Set<string>;
  };
  const groups = new Map<string, Group>(),
    identities = new Map<string, string>();
  let skipped = 0,
    inputRows = 0;
  for (const d of datasets) {
    if (
      d.project_id !== project ||
      !d.import_spec ||
      !d.metric_snapshot ||
      !d.source_sha256 ||
      !d.spec_hash
    )
      throw new Problem(
        409,
        "ANALYSIS_SOURCE_UNVERIFIED",
        "Import the original file with confirmed source definitions before creating a report",
      );
    if (d.timezone !== spec.timezone)
      throw new Problem(
        422,
        "ANALYSIS_TIMEZONE_MISMATCH",
        "Source timezone differs from the requested report; no implicit date conversion is applied",
      );
    const account = d.import_spec.account_id;
    if (
      spec.account_ids.length &&
      (!account || !spec.account_ids.includes(account))
    )
      throw new Problem(
        422,
        "ANALYSIS_ACCOUNT_MISMATCH",
        "Every selected snapshot must match a confirmed report account",
      );
    if (
      spec.attribution_definition &&
      d.import_spec.attribution_definition !== spec.attribution_definition
    )
      throw new Problem(
        422,
        "ANALYSIS_ATTRIBUTION_MISMATCH",
        "The snapshot attribution definition differs from the report request",
      );
    const base = {
      source: d.source,
      account_id: account,
      currency: d.currency,
      timezone: d.timezone,
      attribution_definition: d.import_spec.attribution_definition,
      conversion_definition: d.import_spec.conversion_definition,
      entity_level: d.import_spec.entity_level,
      ...(!account ||
      [
        d.import_spec.attribution_definition,
        d.import_spec.conversion_definition,
      ].includes("not_provided")
        ? { unverified_source_snapshot_id: d.id }
        : {}),
    };
    for (const row of d.rows) {
      if (++inputRows > 100000)
        throw new Problem(
          422,
          "ANALYSIS_ROW_LIMIT",
          "Split the analysis into at most 100,000 input rows",
        );
      const inRange = (
        range: { date_from: string; date_to: string } | undefined,
      ) => !!range && row.date >= range.date_from && row.date <= range.date_to;
      if (!inRange(spec) && !inRange(spec.comparison)) continue;
      const identity = canonical({
        base,
        date: row.date,
        channel: row.channel,
        entity: row.entity_id || row.campaign,
      });
      const body = canonical(row),
        prior = identities.get(identity);
      if (prior) {
        if (prior !== body)
          throw new Problem(
            409,
            "ANALYSIS_OVERLAPPING_FACTS",
            "Selected snapshots contain conflicting facts at the same grain; select one source version",
          );
        skipped++;
        continue;
      }
      identities.set(identity, body);
      for (const period of ["current", "comparison"] as const) {
        const range = period === "current" ? spec : spec.comparison;
        if (!range || row.date < range.date_from || row.date > range.date_to)
          continue;
        const values: Record<string, unknown> = {};
        for (const dimension of spec.dimensions)
          values[dimension] =
            dimension === "date"
              ? { period_day: indexDay(row.date) - indexDay(range.date_from) }
              : dimension in base
                ? base[dimension as keyof typeof base]
                : (row[dimension as keyof MetricRow] ?? null);
        const scope = { ...base, dimensions: values },
          key = canonical(scope);
        let group = groups.get(key);
        if (!group) {
          group = { scope, current: [], comparison: [], origins: new Set() };
          groups.set(key, group);
        }
        group[period].push(row);
        group.origins.add(d.id);
        if (groups.size > 100)
          throw new Problem(
            422,
            "ANALYSIS_GROUP_LIMIT",
            "This query creates more than 100 independent groups; reduce dimensions or date range",
          );
      }
    }
  }
  if (!groups.size)
    throw new Problem(
      422,
      "ANALYSIS_NO_ROWS",
      "No selected facts fall within the requested date ranges",
    );
  const snapshots: any[] = [],
    evidence: Evidence[] = [],
    results: any[] = [];
  for (const [key, g] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const result: any = { scope: g.scope, periods: {}, changes: [] };
    for (const period of ["current", "comparison"] as const) {
      const range =
        period === "current"
          ? { date_from: spec.date_from, date_to: spec.date_to }
          : spec.comparison;
      if (!range) continue;
      const facts = g[period],
        summary = metrics(facts);
      if (!facts.length)
        for (const metric of metricIds) {
          summary.exact[metric] = null;
          summary.null_reasons[metric] = "no_rows";
        }
      const scope = {
        project_id: project,
        ...g.scope,
        period,
        ...range,
        source_snapshot_ids: [...g.origins].sort(),
        spec_hash: hash(canonical(spec)),
      };
      const id = stableAnalysisId({ reportId, key, period }),
        scopeText = canonical(scope);
      const refs = spec.metrics.map((metric_id) => ({
        id: stableAnalysisId({ snapshot: id, metric_id }),
        snapshot_id: id,
        metric_id,
        value: summary.exact[metric_id],
        unit: unit(metric_id, String(g.scope.currency)),
        formula_version: summary.calculation.formula_version,
        scope: scopeText,
        null_reason: summary.null_reasons[metric_id] || null,
      }));
      const dates = facts.map((r) => r.date).sort();
      const snapshot = {
        id,
        project_id: project,
        source: String(g.scope.source),
        state: facts.length ? "complete" : "partial",
        row_count: facts.length,
        data_as_of: null,
        spec_hash: scope.spec_hash,
        scope,
        summary,
        evidence_ids: refs.map((e) => e.id),
        observed_range: dates.length
          ? { from: dates[0], to: dates.at(-1) }
          : null,
      };
      snapshots.push(snapshot);
      evidence.push(...refs);
      result.periods[period] = snapshot;
    }
    if (spec.comparison)
      for (const metric of spec.metrics) {
        const a = result.periods.current,
          b = result.periods.comparison,
          delta = change(a.summary.exact[metric], b.summary.exact[metric]);
        const metric_id = metric + ".change",
          e: Evidence = {
            id: stableAnalysisId({ snapshot: a.id, metric_id }),
            snapshot_id: a.id,
            metric_id,
            value: delta.value,
            unit: "ratio",
            formula_version: a.summary.calculation.formula_version,
            scope: canonical({
              ...a.scope,
              comparison_snapshot_id: b.id,
              formula: "(current-previous)/abs(previous)",
            }),
            null_reason: delta.reason,
          };
        evidence.push(e);
        result.changes.push(e);
      }
    results.push(result);
  }
  return {
    schema_version: "analysis-calculation/1.0",
    spec_hash: hash(canonical(spec)),
    spec,
    groups: results,
    snapshots,
    evidence,
    sources: datasets.map((d) => ({
      snapshot_id: d.id,
      source: d.source,
      source_sha256: d.source_sha256,
      spec_hash: d.spec_hash,
      captured_at: d.created_at,
      data_as_of: null,
    })),
    coverage: {
      input_rows: inputRows,
      identical_facts_skipped: skipped,
      groups: results.length,
    },
    limitations: [
      "Sources, accounts, currencies, entity grains and attribution/conversion definitions are independent groups. No cross-platform conversion deduplication or FX.",
      "CSV extraction cutoff is unknown. Requested dates do not prove complete platform coverage.",
      "Observations and hypotheses require source review; numerical references use frozen tool results.",
      "Statistical significance, conversion delay and tracking completeness are not established by this file; verify them before acting on a change.",
    ],
  };
}
export type AnalysisCalculation = ReturnType<typeof calculateAnalysis>;
const statement = z
  .object({
    text: z.string().trim().min(1).max(2000),
    evidence_ids: z.array(uuid).min(1).max(20),
  })
  .strict();
export const reportNarrative = z
  .object({
    observations: z.array(statement).min(1).max(12),
    hypotheses: z.array(statement).max(12),
    next_steps: z.array(z.string().trim().min(1).max(2000)).min(1).max(12),
  })
  .strict();
export function validatedNarrative(
  text: string,
  calculation: AnalysisCalculation,
) {
  try {
    const body = reportNarrative.parse(
      JSON.parse(text.trim().replace(/^```json\s*([\s\S]*?)\s*```$/, "$1")),
    );
    const known = new Set(calculation.evidence.map((e) => e.id));
    for (const s of [...body.observations, ...body.hypotheses]) {
      if (s.evidence_ids.some((id) => !known.has(id)))
        throw new Error("Unknown evidence");
      const used = [...s.text.matchAll(/\{\{([a-f0-9-]{36})\}\}/g)].map(
        (m) => m[1],
      );
      if (!used.length || used.some((id) => !s.evidence_ids.includes(id)))
        throw new Error("Unbound numerical reference");
      const prose = s.text.replace(/\{\{[a-f0-9-]{36}\}\}/g, "");
      if (/\p{N}/u.test(prose) || prose.includes("{{") || prose.includes("}}"))
        throw new Error("Unverified numerical literal");
    }
    if (body.next_steps.some((s) => /\p{N}/u.test(s) || s.includes("{{")))
      throw new Error("Unverified next-step number");
    return body;
  } catch {
    throw new Problem(
      422,
      "REPORT_NARRATIVE_INVALID",
      "The generated narrative contains invalid evidence references or unverified numbers; no report was published",
    );
  }
}
