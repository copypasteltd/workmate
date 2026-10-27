import { z } from "zod";
import { canonical, csvCell, hash, Problem } from "./lib.js";
import {
  calendarDate,
  connectorFact,
  connectorLimits,
  connectorQuery,
  type ConnectorFact,
} from "./connector-model.js";

export const webAnalyticsVersion = "web-analytics/1.0.0";
export const webAnalyticsProfile = z.enum([
  "ga4_traffic", "ga4_events", "search_performance",
]);
export const webAnalyticsSelection = z.object({
  profile: webAnalyticsProfile,
  account_id: z.string().min(1).max(512),
  date_from: calendarDate,
  date_to: calendarDate,
  group_by: z.array(z.enum([
    "date", "channel", "landing_page", "event", "query", "page", "country", "device",
  ])).max(5).default([]),
}).strict();
export type WebAnalyticsSelection = z.infer<typeof webAnalyticsSelection>;
export const capturedWebSnapshot = z.object({
  schema: z.literal("copypaste-connector-snapshot-1"),
  source_mode: z.enum(["simulated", "configured_services"]),
  spec_hash: z.string().regex(/^[a-f\d]{64}$/),
  specification: z.record(z.string(), z.unknown()),
  facts: z.array(connectorFact).max(connectorLimits.facts),
  limitations: z.array(z.string().max(200)).max(200),
  captured_at: z.iso.datetime(),
  data_as_of: z.null(),
}).strict();
type Snapshot = z.infer<typeof capturedWebSnapshot>;
export type WebSnapshotIdentity = {
  id: string; sha256: string; spec_hash: string; state: string;
  data_mode: string; row_count: number;
  project_id?: string;
};
const dimensions = {
  ga4_traffic: { date: "date", channel: "sessionDefaultChannelGroup", landing_page: "landingPagePlusQueryString" },
  ga4_events: { date: "date", event: "eventName" },
  search_performance: { date: "date", query: "query", page: "page", country: "country", device: "device" },
} as const;
const metricNames = {
  ga4_traffic: ["sessions", "totalUsers", "screenPageViews", "keyEvents", "totalRevenue", "key_events_per_session"],
  ga4_events: ["eventCount", "totalUsers", "keyEvents"],
  search_performance: ["clicks", "impressions", "ctr", "weighted_position"],
} as const;
const SCALE = 1_000_000_000_000n;
const OUTPUT_SCALE = 100_000_000n;
function scaled(s: string) {
  const negative = s.startsWith("-"), [whole, fraction = ""] = (negative ? s.slice(1) : s).split(".");
  return (BigInt(whole) * SCALE + BigInt(fraction.padEnd(12, "0"))) * (negative ? -1n : 1n);
}
function decimal(n: bigint, scale = SCALE) {
  const sign = n < 0n ? "-" : "", abs = n < 0n ? -n : n;
  const places = scale.toString().length - 1;
  const fraction = (abs % scale).toString().padStart(places, "0").replace(/0+$/, "");
  return `${sign}${abs / scale}${fraction ? "." + fraction : ""}`;
}
function ratio(a: bigint, b: bigint) {
  const sign = a < 0n ? -1n : 1n, abs = a < 0n ? -a : a;
  return decimal(sign * ((abs * OUTPUT_SCALE + b / 2n) / b), OUTPUT_SCALE);
}
export type WebMetric = {
  value: string | null; unit: string; null_reason: string | null;
  formula: string; evidence_id: string;
};
type Aggregate = { id: string; dimensions: Record<string, string>; row_count: number; metrics: Record<string, WebMetric> };
function aggregate(rows: ConnectorFact[], profile: WebAnalyticsSelection["profile"], currency: string | null,
  seed: unknown, scope: Record<string, string>): Aggregate {
  const id = hash(canonical({ seed, scope })), result: Record<string, WebMetric> = {};
  function metric(name: string, value: string | null, reason: string | null, formula: string, unit = "count") {
    result[name] = { value, null_reason: reason, formula, unit,
      evidence_id: hash(canonical({ version: webAnalyticsVersion, id, name, value, reason })) };
  }
  function total(name: string) {
    if (!rows.length) return { value: null, reason: "no_rows" };
    if (rows.some(r => r.metrics[name] === null || r.metrics[name] === undefined))
      return { value: null, reason: "missing_source_metric" };
    return { value: rows.reduce((sum, r) => sum + scaled(r.metrics[name]!), 0n), reason: null };
  }
  if (profile === "search_performance") {
    const clicks = total("clicks"), impressions = total("impressions");
    for (const [name, v] of [["clicks", clicks], ["impressions", impressions]] as const)
      metric(name, v.value === null ? null : decimal(v.value), v.reason, "sum_observed_rows");
    const reason = clicks.reason ?? impressions.reason ?? (impressions.value === 0n ? "zero_denominator" : null);
    metric("ctr", reason ? null : ratio(clicks.value!, impressions.value!), reason, "sum(clicks)/sum(impressions)", "ratio");
    let positionReason = impressions.reason ?? (impressions.value === 0n ? "zero_denominator" : null);
    if (!positionReason && rows.some(r => scaled(r.metrics.impressions!) > 0n && r.metrics.position == null))
      positionReason = "missing_source_position";
    const numerator = positionReason ? 0n : rows.reduce((sum, r) =>
      sum + (r.metrics.position == null ? 0n : scaled(r.metrics.position) * scaled(r.metrics.impressions!)), 0n);
    metric("weighted_position", positionReason ? null : ratio(numerator, impressions.value! * SCALE),
      positionReason, "sum(position*impressions)/sum(impressions);observed_byPage_rows", "position");
  } else {
    for (const name of metricNames[profile]) {
      if (name === "key_events_per_session") continue;
      if (name === "totalUsers") {
        const reason = !rows.length ? "no_rows" : rows.length > 1 ? "non_additive_unique_users" : rows[0].metrics.totalUsers == null ? "missing_source_metric" : null;
        metric(name, reason ? null : decimal(scaled(rows[0].metrics.totalUsers!)), reason, "single_source_row_only;distinct_users_not_additive");
      } else {
        const v = total(name), reason = name === "totalRevenue" && !currency ? "currency_unavailable" : v.reason;
        metric(name, reason || v.value === null ? null : decimal(v.value), reason, "sum_observed_rows", name === "totalRevenue" ? currency ?? "unknown_currency" : "count");
      }
    }
    if (profile === "ga4_traffic") {
      const events = total("keyEvents"), sessions = total("sessions"), reason = events.reason ?? sessions.reason ?? (sessions.value === 0n ? "zero_denominator" : null);
      metric("key_events_per_session", reason ? null : ratio(events.value!, sessions.value!), reason,
        "sum(keyEvents)/sum(sessions);not_a_conversion_rate", "events/session");
    }
  }
  return { id, dimensions: scope, row_count: rows.length, metrics: result };
}
function queryOptions(body: Snapshot) {
  if (body.spec_hash !== hash(canonical(body.specification)))
    throw new Problem(409, "CONNECTOR_SNAPSHOT_INTEGRITY", "The retained query specification failed its digest check");
  const result = z.array(connectorQuery).max(400).safeParse(body.specification.queries);
  if (!result.success) throw new Problem(409, "CONNECTOR_SNAPSHOT_INTEGRITY", "The captured query specification is invalid");
  const queries = result.data;
  return queries.filter(q => webAnalyticsProfile.safeParse(q.profile).success);
}
export function webAnalyticsOptions(body: Snapshot) {
  return queryOptions(body).map(q => ({ profile: q.profile, account_id: q.account.account_id,
    account_name: q.account.name, timezone: q.account.timezone, currency: q.account.currency,
    date_from: q.date_from, date_to: q.date_to,
    dimensions: Object.keys(dimensions[q.profile as WebAnalyticsSelection["profile"]]),
    reporting_identity: q.account.reporting_identity, reporting_identity_source: q.account.reporting_identity_source,
  }));
}
export function checkedWebSnapshot(row: WebSnapshotIdentity, bytes: Buffer) {
  if (bytes.length > connectorLimits.rawBytes || hash(bytes) !== row.sha256)
    throw new Problem(409, "CONNECTOR_SNAPSHOT_INTEGRITY", "The retained snapshot failed its byte check");
  let raw: unknown;
  try { raw = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Problem(409, "CONNECTOR_SNAPSHOT_INTEGRITY", "The retained snapshot is not valid JSON"); }
  const parsed = capturedWebSnapshot.safeParse(raw);
  if (!parsed.success) throw new Problem(409, "CONNECTOR_SNAPSHOT_INTEGRITY", "The retained snapshot has invalid source facts");
  const body = parsed.data;
  if (body.spec_hash !== row.spec_hash || body.source_mode !== row.data_mode || body.facts.length !== Number(row.row_count) ||
    !["complete", "partial"].includes(row.state))
    throw new Problem(409, "CONNECTOR_SNAPSHOT_INTEGRITY", "The retained snapshot binding is invalid");
  if (row.project_id && (!Array.isArray(body.specification.project_ids) || !body.specification.project_ids.includes(row.project_id)))
    throw new Problem(409, "CONNECTOR_SNAPSHOT_INTEGRITY", "The snapshot does not include this project");
  queryOptions(body);
  return body;
}
export function calculateWebAnalytics(row: WebSnapshotIdentity, body: Snapshot, raw: unknown) {
  const input = webAnalyticsSelection.parse(raw), queries = queryOptions(body);
  if (input.date_from > input.date_to)
    throw new Problem(422, "WEB_ANALYTICS_DATE_RANGE", "Start must precede end");
  const selected = queries.filter(q => q.profile === input.profile && q.account.account_id === input.account_id);
  if (selected.length !== 1)
    throw new Problem(422, "WEB_ANALYTICS_SOURCE_SCOPE", "Choose one account and profile from this captured snapshot");
  const q = selected[0];
  if (input.date_from < q.date_from || input.date_to > q.date_to)
    throw new Problem(422, "WEB_ANALYTICS_DATE_RANGE", "The report must remain inside the captured date range");
  if (!q.account.timezone)
    throw new Problem(422, "WEB_ANALYTICS_TIMEZONE", "The captured account has no verified timezone");
  const map = dimensions[input.profile] as Record<string, string>;
  if (new Set(input.group_by).size !== input.group_by.length || input.group_by.some(k => !(k in map)))
    throw new Problem(422, "WEB_ANALYTICS_DIMENSION", "Choose supported, distinct dimensions for this profile");
  const selection = { ...input, group_by: [...input.group_by].sort() }, seen = new Set<string>();
  const rows: ConnectorFact[] = [];
  for (const f of body.facts) {
    if (f.account_id !== q.account.account_id || f.profile !== q.profile) continue;
    if (f.date < q.date_from || f.date > q.date_to || f.timezone !== q.account.timezone || f.currency !== q.account.currency)
      throw new Problem(409, "WEB_ANALYTICS_FACT_SCOPE", "Captured facts do not match the fixed account definition");
    const expected = Object.values(map).filter(k => k !== "date").sort();
    if (canonical(Object.keys(f.dimensions).sort()) !== canonical(expected) ||
      f.key !== hash(canonical({ provider: q.provider, account: f.account_id, profile: f.profile, date: f.date, dimensions: f.dimensions })) || seen.has(f.key))
      throw new Problem(409, "WEB_ANALYTICS_FACT_SCOPE", "Captured facts have duplicate or invalid dimensions");
    seen.add(f.key);
    if (f.date >= input.date_from && f.date <= input.date_to) rows.push(f);
  }
  const source = { snapshot_id: row.id, sha256: row.sha256, spec_hash: row.spec_hash,
    state: row.state, provider: q.provider, data_mode: body.source_mode, captured_at: body.captured_at,
    platform_data_as_of: body.data_as_of, account_id: q.account.account_id, account_name: q.account.name,
    timezone: q.account.timezone, currency: q.account.currency, profile: q.profile,
    reporting_identity: q.account.reporting_identity, reporting_identity_source: q.account.reporting_identity_source,
    api_version: q.api_version,
  };
  const seed = { version: webAnalyticsVersion, source, selection }, grouped = new Map<string, { scope: Record<string, string>; rows: ConnectorFact[] }>();
  for (const r of selection.group_by.length ? rows : []) {
    const scope = Object.fromEntries(selection.group_by.map(k => [k, k === "date" ? r.date : r.dimensions[map[k]]]));
    const key = canonical(scope), group = grouped.get(key) ?? { scope, rows: [] };
    group.rows.push(r); grouped.set(key, group);
    if (grouped.size > 10000)
      throw new Problem(422, "WEB_ANALYTICS_GROUP_LIMIT", "Reduce dates or dimensions to at most ten thousand groups");
  }
  const observedDates = [...new Set(rows.map(r => r.date))].sort(), daysWithoutRows: string[] = [];
  for (let d = Date.parse(input.date_from); d <= Date.parse(input.date_to); d += 86400000) {
    const date = new Date(d).toISOString().slice(0, 10);
    if (!observedDates.includes(date)) daysWithoutRows.push(date);
  }
  const report = { schema: webAnalyticsVersion, source, selection,
    coverage: { selected_rows: rows.length, snapshot_rows: body.facts.length, observed_dates: observedDates,
      days_without_rows: daysWithoutRows, missing_dates_are_zero: false, scope: "observed_source_rows" },
    summary: aggregate(rows, input.profile, q.account.currency, seed, {}),
    groups: [...grouped.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, g]) => aggregate(g.rows, input.profile, q.account.currency, seed, g.scope)),
    limitations: [...new Set([...body.limitations, ...(row.state === "partial" ? ["WEB_ANALYTICS_PARTIAL_SOURCE"] : []),
      "WEB_ANALYTICS_OBSERVED_ROWS_ONLY", "WEB_ANALYTICS_NO_CROSS_PLATFORM_ATTRIBUTION", "WEB_ANALYTICS_MISSING_DATES_NOT_ZERO",
      ...(input.profile === "search_performance" ? ["GSC_TOP_ROWS_ONLY_NOT_FULL_COVERAGE", "GSC_ANONYMIZED_QUERIES_OMITTED", "GSC_WEB_FINAL_BY_PAGE_PACIFIC_TIME"] : ["GA4_USERS_NOT_ADDITIVE_ACROSS_ROWS_OR_REPORTS"]),
    ])], provider_calls: 0, additional_ai_calls: 0, additional_ai_charge_micros: "0",
  };
  return { ...report, calculation_sha256: hash(canonical(report)) };
}
export type WebAnalyticsReport = ReturnType<typeof calculateWebAnalytics>;
export function webAnalyticsPage(report: WebAnalyticsReport, offset: number, limit: number) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > report.groups.length || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Problem(422, "WEB_ANALYTICS_PAGE_RANGE", "Choose an available report page");
  return { ...report, groups: report.groups.slice(offset, offset + limit), total_groups: report.groups.length,
    next_offset: offset + limit < report.groups.length ? offset + limit : null };
}
const reportLabels: Record<string, [string, string]> = {
  sessions: ["工作階段", "Sessions"], totalUsers: ["不重複用戶", "Distinct users"], screenPageViews: ["頁面與畫面瀏覽", "Page and screen views"],
  keyEvents: ["重要事件", "Key events"], totalRevenue: ["收入（含退款）", "Revenue including refunds"], key_events_per_session: ["每工作階段重要事件（非轉換率）", "Key events per session (not conversion rate)"],
  eventCount: ["事件次數", "Event count"], clicks: ["點擊", "Clicks"], impressions: ["曝光", "Impressions"], ctr: ["點擊率", "CTR"], weighted_position: ["曝光加權排名", "Impression-weighted position"],
  no_rows: ["此範圍未返回來源行，不能視為零。", "No source rows were returned; this is not zero."],
  non_additive_unique_users: ["跨行用戶可能重複，不能直接合計。", "Users may overlap across rows and cannot be summed."],
  missing_source_metric: ["來源未提供此指標。", "The source did not supply this metric."], missing_source_position: ["部分曝光缺少排名。", "Some impressions have no source position."],
  zero_denominator: ["分母為零，無法計算。", "The denominator is zero."], currency_unavailable: ["來源幣種未確認。", "Source currency is unconfirmed."],
  WEB_ANALYTICS_PARTIAL_SOURCE: ["來源僅完成部分同步。", "The source sync is partial."],
  WEB_ANALYTICS_OBSERVED_ROWS_ONLY: ["只覆蓋已捕獲行，不代表平台全部資料。", "Only captured rows are covered, not all platform data."],
  WEB_ANALYTICS_NO_CROSS_PLATFORM_ATTRIBUTION: ["不進行跨帳戶、跨報告或跨平台歸因。", "No cross-account, cross-report or cross-platform attribution."],
  WEB_ANALYTICS_MISSING_DATES_NOT_ZERO: ["缺少記錄的日期不補零。", "Dates without records are not filled with zero."],
  GA4_USERS_NOT_ADDITIVE_ACROSS_ROWS_OR_REPORTS: ["GA4 不重複用戶不可跨行或跨報告相加。", "GA4 distinct users cannot be added across rows or reports."],
  GSC_TOP_ROWS_ONLY_NOT_FULL_COVERAGE: ["搜尋平台僅返回部分排名靠前的行。", "Search Console returns top rows, not complete coverage."],
  GSC_ANONYMIZED_QUERIES_OMITTED: ["搜尋平台可能省略匿名查詢。", "Search Console may omit anonymized queries."],
  GSC_WEB_FINAL_BY_PAGE_PACIFIC_TIME: ["搜尋數據為 web / final / byPage，日期依洛杉磯時區。", "Search data uses web / final / byPage and Los Angeles dates."],
};
const xml = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function renderWebAnalytics(report: WebAnalyticsReport, format: "json" | "csv" | "html", locale: "zh-HK" | "en-HK") {
  const groups = [report.summary, ...report.groups], zh = locale === "zh-HK", title = zh ? "網站與搜尋分析" : "Website and search analysis";
  const label = (key: string) => reportLabels[key]?.[zh ? 0 : 1] ?? key;
  let text: string;
  if (format === "json") text = JSON.stringify(report, null, 2);
  else if (format === "csv") text = "\uFEFF" + [
    ["scope", "dimensions", "metric", "value", "unit", "null_reason", "formula", "source_rows", "evidence_id", "snapshot_id", "source_sha256", "calculation_sha256", "account_id", "profile", "date_from", "date_to", "timezone", "captured_at", "source_state", "data_mode", "limitations"],
    ...groups.flatMap((g, i) => Object.entries(g.metrics).map(([name, m]) => [i ? "group" : "summary", canonical(g.dimensions), name, m.value ?? "", m.unit, m.null_reason ?? "", m.formula, String(g.row_count), m.evidence_id, report.source.snapshot_id, report.source.sha256, report.calculation_sha256, report.source.account_id, report.source.profile, report.selection.date_from, report.selection.date_to, report.source.timezone, report.source.captured_at, report.source.state, report.source.data_mode, canonical(report.limitations)])),
  ].map(r => r.map(csvCell).join(",")).join("\r\n");
  else text = `<!doctype html><html lang="${zh ? "zh-Hant" : "en"}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${title}</title><style>body{font:16px/1.6 system-ui,sans-serif;background:#f6f8fc;color:#192b43;margin:0;padding:clamp(16px,4vw,48px)}main{max-width:1120px;margin:auto}h1{font-size:clamp(26px,4vw,40px);color:#1769e8}article,header,section{background:#fff;border:1px solid #d9e1ed;border-radius:16px;padding:24px;margin-bottom:20px;overflow-wrap:anywhere}dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:18px}dt{color:#52627a}dd{margin:4px 0;font-weight:600}code{font-size:12px;word-break:break-all}table{width:100%;border-collapse:collapse;table-layout:fixed}td,th{padding:10px;text-align:left;border-bottom:1px solid #d9e1ed;overflow-wrap:anywhere}small{display:block;color:#52627a}@media(max-width:600px){td,th{padding:6px;font-size:13px}}@media print{body{background:white;padding:0}article{break-inside:avoid}}</style><main><header><p>CopyPaste · Workmate · ${xml(report.source.data_mode)}</p><h1>${title}</h1><p>${xml(report.source.account_name)} · ${xml(report.source.profile)}</p><p>${report.selection.date_from} → ${report.selection.date_to} · ${xml(report.source.timezone)}</p><p>${zh ? "只彙總已捕獲行，不代表全站覆蓋；未知值與無記錄日期均不補零。" : "Only captured rows are summarized. Unknown metrics and dates without records are not filled with zero."}</p><p>${zh ? "抓取時間" : "Captured"}: ${xml(report.source.captured_at)} · ${zh ? "平台截止時間未知" : "Platform cutoff unknown"}</p><code>Snapshot ${xml(report.source.snapshot_id)}<br>Source ${xml(report.source.sha256)}<br>Calculation ${report.calculation_sha256}</code></header>${groups.map((g, i) => `<article><h2>${i ? xml(Object.entries(g.dimensions).map(([k, v]) => k + ": " + v).join(" · ")) : zh ? "已觀察資料彙總" : "Observed source summary"}</h2><p>${g.row_count} ${zh ? "行" : "source rows"}</p><dl>${Object.entries(g.metrics).map(([name, m]) => `<div><dt>${xml(label(name))}</dt><dd>${m.value === null ? (zh ? "未知" : "Unknown") : xml(m.value)} ${xml(m.unit)}</dd><small>${xml(m.null_reason ? label(m.null_reason) : m.formula)}</small></div>`).join("")}</dl></article>`).join("")}<section><h2>${zh ? "覆蓋與統計口徑" : "Coverage and definitions"}</h2><p>${zh ? "無記錄日期" : "Dates without records"}: ${xml(report.coverage.days_without_rows.join(", ") || "—")}</p><p>${zh ? "Reporting identity" : "Reporting identity"}: ${xml(report.source.reporting_identity ?? "unavailable")}</p><ul>${report.limitations.map(v => `<li>${xml(label(v))} <small>${xml(v)}</small></li>`).join("")}</ul><p>${zh ? "此確定性報告不新增模型呼叫或費用。" : "This deterministic report makes no new model call or charge."}</p></section></main></html>`;
  const bytes = Buffer.from(text);
  if (bytes.length > 8 * 1024 * 1024)
    throw new Problem(422, "WEB_ANALYTICS_EXPORT_LIMIT", "Reduce report dates or dimensions for an export below eight MiB");
  return bytes;
}
