import { z } from "zod";
import { canonical, hash, Problem, uuid } from "./lib.js";
import { calendarDate } from "./connector-model.js";
import { metrics, type MetricRow } from "./metric-calculator.js";

export const CREATIVE_FEEDBACK_VERSION = "confirmed-ad-creative/1.0";
const identity = z.string().trim().min(1).max(200).refine(s => !/[\u0000-\u001f\u007f]/u.test(s));
export const creativeMappingInput = z.object({
  name: z.string().trim().min(1).max(160),
  asset_version_id: uuid,
  dataset_id: uuid,
  channel: identity,
  campaign: z.string().max(200),
  ad_id: identity,
  creative_id: identity,
  date_from: calendarDate,
  date_to: calendarDate,
  match_source: z.enum(["manual", "name_candidate", "provider_metadata"]),
  match_note: z.string().trim().min(5).max(2000),
  allocation: z.literal("single_creative_entire_ad"),
}).strict().refine(b => b.date_from <= b.date_to, "Start must precede end");
export type CreativeMappingInput = z.infer<typeof creativeMappingInput>;
export const creativeFeedbackInput = z.object({
  name: z.string().trim().min(1).max(160),
  mapping_ids: z.array(uuid).min(1).max(40).refine(v => new Set(v).size === v.length, "Remove duplicate mappings"),
  date_from: calendarDate,
  date_to: calendarDate,
}).strict().refine(b => b.date_from <= b.date_to, "Start must precede end");

export type CreativeSource = {
  id: string; tenant_id: string; project_id: string; source: string;
  currency: string; timezone: string; rows: MetricRow[];
  import_spec: any; spec_hash: string; source_sha256: string;
  source_asset_version_id: string | null; supersedes_id?: string | null; correction_ancestors?: string[];
};
export type CreativeVersion = {
  id: string; asset_id: string; version: number; sha256: string; mime_type: string; name: string;
};
export type CreativeMapping = {
  id: string; version: number; state: string; confirmed_by: string | null; confirmed_at: string | Date | null;
  body: ReturnType<typeof freezeCreativeMapping>;
};

export function freezeCreativeMapping(input: CreativeMappingInput, d: CreativeSource, asset: CreativeVersion) {
  if (!["google_ads", "meta_ads"].includes(d.source) || d.import_spec?.entity_level !== "ad"
    || !d.import_spec.account_id || [d.import_spec.attribution_definition, d.import_spec.conversion_definition]
      .some(v => !v || v === "not_provided") || !d.spec_hash || !d.source_sha256) {
    throw new Problem(422, "CREATIVE_AD_SOURCE_REQUIRED", "Choose an ad-level snapshot with confirmed platform, account and metric definitions");
  }
  const facts = d.rows.filter(r => r.channel === input.channel && r.campaign === input.campaign
    && r.entity_id === input.ad_id && r.date >= input.date_from && r.date <= input.date_to);
  if (!facts.length) throw new Problem(422, "CREATIVE_AD_NOT_FOUND", "No exact ad facts match this identity and date range");
  const dates = new Set<string>();
  for (const row of facts) {
    if (dates.has(row.date)) throw new Problem(409, "CREATIVE_FACT_AMBIGUOUS", "Choose a single daily fact at this ad grain");
    dates.add(row.date);
  }
  return {
    schema: CREATIVE_FEEDBACK_VERSION,
    input,
    asset: { id: asset.id, asset_id: asset.asset_id, version: asset.version, sha256: asset.sha256, mime_type: asset.mime_type, name: asset.name },
    dataset: {
      id: d.id, source: d.source, account_id: String(d.import_spec.account_id), currency: d.currency, timezone: d.timezone,
      attribution_definition: String(d.import_spec.attribution_definition), conversion_definition: String(d.import_spec.conversion_definition),
      entity_level: "ad", spec_hash: d.spec_hash, source_sha256: d.source_sha256,
      source_asset_version_id: d.source_asset_version_id,
    },
    facts_sha256: hash(canonical(facts)),
    row_count: facts.length,
    identity_evidence: "user_confirmation_required",
    metric_grain: "ad_daily",
    limitation: "Ad-level performance linked to a single creative by explicit user confirmation; no creative-level measurement or causal claim is inferred.",
  };
}

function scopeOf(m: CreativeMapping) {
  const { input, dataset, asset } = m.body;
  return {
    asset_version_id: asset.id, asset_sha256: asset.sha256, creative_id: input.creative_id,
    source: dataset.source, account_id: dataset.account_id, currency: dataset.currency, timezone: dataset.timezone,
    attribution_definition: dataset.attribution_definition, conversion_definition: dataset.conversion_definition,
    metric_grain: "ad_daily",
  };
}

export function calculateCreativeFeedback(
  report: string, input: z.infer<typeof creativeFeedbackInput>, mappings: CreativeMapping[], datasets: CreativeSource[],
) {
  if (mappings.length !== input.mapping_ids.length || mappings.some(m => !input.mapping_ids.includes(m.id)
    || m.state !== "confirmed" || !m.confirmed_by || !m.confirmed_at))
    throw new Problem(409, "CREATIVE_CONFIRMATION_REQUIRED", "Only current, explicitly confirmed mappings can contribute to feedback");
  const ids = new Set(datasets.map(d => d.id));
  if (datasets.some(d => [d.supersedes_id, ...(d.correction_ancestors ?? [])].some(id => id && ids.has(id))))
    throw new Problem(409, "CREATIVE_CORRECTION_OVERLAP", "Choose the original or corrected snapshot, not both");
  const facts = new Map<string, { mapping: string; asset: string; creative: string; row: string }>();
  const groups = new Map<string, { scope: ReturnType<typeof scopeOf>; rows: MetricRow[]; mappings: Set<string>; datasets: Set<string>; ad_ids: Set<string> }>();
  let duplicateRows = 0, inputRows = 0;
  for (const mapping of [...mappings].sort((a, b) => a.id.localeCompare(b.id))) {
    const body = mapping.body, d = datasets.find(v => v.id === body.dataset.id);
    if (!d) throw new Problem(404, "CREATIVE_SOURCE_UNAVAILABLE", "A selected source is unavailable");
    const current = freezeCreativeMapping(body.input, d, { ...body.asset });
    if (canonical(current) !== canonical(body))
      throw new Problem(409, "CREATIVE_SOURCE_CHANGED", "A frozen source changed; create and confirm a new mapping");
    const scope = scopeOf(mapping), groupKey = canonical(scope);
    const chosen = d.rows.filter(r => r.channel === body.input.channel && r.campaign === body.input.campaign
      && r.entity_id === body.input.ad_id && r.date >= body.input.date_from && r.date <= body.input.date_to
      && r.date >= input.date_from && r.date <= input.date_to);
    if (!chosen.length) throw new Problem(422, "CREATIVE_MAPPING_OUTSIDE_PERIOD", "Every selected mapping must contain facts within this feedback period");
    let group = groups.get(groupKey);
    if (!group) { group = { scope, rows: [], mappings: new Set(), datasets: new Set(), ad_ids: new Set() }; groups.set(groupKey, group); }
    group.mappings.add(mapping.id); group.datasets.add(d.id); group.ad_ids.add(body.input.ad_id);
    for (const row of chosen) {
      if (++inputRows > 100000) throw new Problem(422, "CREATIVE_ROW_LIMIT", "Use at most 100,000 selected facts");
      // Identity intentionally excludes asset/creative: one measured ad-day cannot
      // be silently allocated to two creative versions, even across snapshots.
      const factKey = canonical({ source: scope.source, account: scope.account_id, currency: scope.currency,
        timezone: scope.timezone, attribution: scope.attribution_definition, conversion: scope.conversion_definition,
        channel: row.channel, entity: row.entity_id, date: row.date });
      const previous = facts.get(factKey), value = canonical(row);
      if (previous) {
        if (previous.asset !== scope.asset_version_id || previous.creative !== scope.creative_id || previous.row !== value)
          throw new Problem(409, "CREATIVE_OVERLAPPING_FACTS", "The same measured ad-day has conflicting facts or creative allocation; select one confirmed source");
        duplicateRows++; continue;
      }
      facts.set(factKey, { mapping: mapping.id, asset: scope.asset_version_id, creative: scope.creative_id, row: value });
      group.rows.push(row);
    }
  }
  const results = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, g]) => ({
    id: hash(canonical({ report, scope: key })), scope: g.scope,
    mapping_ids: [...g.mappings].sort(), dataset_ids: [...g.datasets].sort(), ad_ids: [...g.ad_ids].sort(),
    metrics: metrics(g.rows), observed_days: [...new Set(g.rows.map(r => r.date))].sort(),
  }));
  return {
    schema: CREATIVE_FEEDBACK_VERSION, report_id: report, period: { date_from: input.date_from, date_to: input.date_to },
    mapping_versions: mappings.map(m => ({ id: m.id, version: m.version, confirmed_by: m.confirmed_by,
      confirmed_at: new Date(m.confirmed_at!).toISOString(), sha256: hash(canonical(m.body)) })).sort((a, b) => a.id.localeCompare(b.id)),
    groups: results, input_rows: inputRows, deduplicated_rows: duplicateRows,
    limitations: ["Confirmed ad-level allocation, not independent creative-level measurement.",
      "Account, currency, timezone, attribution and conversion definitions remain separate; no cross-platform total or causal uplift.",
      "Unobserved dates are not assumed to have zero spend or zero conversions.",
      "Mappings are user-confirmed identity evidence, not automatic platform verification."],
  };
}
