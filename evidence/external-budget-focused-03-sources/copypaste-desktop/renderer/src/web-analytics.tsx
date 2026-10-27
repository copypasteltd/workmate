import { useState } from "react";
import { Download, RefreshCw, ArrowLeft } from "lucide-react";
import { download } from "./api";
import { useWorkspace } from "./context";
import { ErrorNotice, Field, useData, useI18n } from "./ui";
import { connectorLimit } from "./connector-labels";
import "./web-analytics.css";

export type WebAnalysisOption = {
  profile: string; account_id: string; account_name: string; timezone: string | null;
  currency: string | null; date_from: string; date_to: string; dimensions: string[];
};
type Metric = { value: string | null; unit: string; null_reason: string | null; evidence_id: string };
type Group = { id: string; dimensions: Record<string, string>; row_count: number; metrics: Record<string, Metric> };
type Report = {
  calculation_sha256: string; summary: Group; groups: Group[]; total_groups: number; next_offset: number | null;
  source: { sha256: string; state: string; captured_at: string; reporting_identity: string | null; timezone: string; data_mode: string };
  coverage: { selected_rows: number; days_without_rows: string[] }; limitations: string[];
  selection: { date_from: string; date_to: string; group_by: string[] };
};
const labels: Record<string, [string, string]> = {
  ga4_traffic: ["GA4 流量與到達頁", "GA4 traffic and landing pages"], ga4_events: ["GA4 事件", "GA4 events"], search_performance: ["Google 搜尋表現", "Google search performance"],
  sessions: ["工作階段", "Sessions"], totalUsers: ["不重複用戶", "Distinct users"], screenPageViews: ["頁面與畫面瀏覽", "Page and screen views"], keyEvents: ["重要事件", "Key events"], totalRevenue: ["收入（含退款）", "Revenue including refunds"], key_events_per_session: ["每工作階段重要事件", "Key events per session"],
  eventCount: ["事件次數", "Event count"], clicks: ["點擊", "Clicks"], impressions: ["曝光", "Impressions"], ctr: ["點擊率", "CTR"], weighted_position: ["曝光加權排名", "Impression-weighted position"],
  date: ["日期", "Date"], channel: ["流量渠道", "Channel"], landing_page: ["到達頁", "Landing page"], event: ["事件", "Event"], query: ["搜尋字詞", "Search query"], page: ["頁面", "Page"], country: ["地區", "Country"], device: ["裝置", "Device"],
  non_additive_unique_users: ["跨行用戶可能重複，不能直接合計。", "Users can overlap across rows and cannot be summed."],
  missing_source_metric: ["來源未提供此指標。", "The source did not provide this metric."],
  missing_source_position: ["部分曝光缺少排名。", "Some impressions have no position."],
  zero_denominator: ["分母為零，無法計算。", "The denominator is zero."], no_rows: ["此範圍沒有返回資料，不視為零。", "No rows were returned for this scope; this is not zero."],
  currency_unavailable: ["來源幣種未確認。", "The source currency is unconfirmed."],
};
export function webMetricValue(metric: Metric) {
  if (metric.value === null) return "—";
  if (metric.unit !== "ratio") return metric.value;
  const [whole, fraction = ""] = metric.value.split("."), digits = fraction.padEnd(2, "0");
  const integer = (BigInt(whole) * 100n + BigInt(digits.slice(0, 2))).toString();
  const rest = digits.slice(2).replace(/0+$/, "");
  return integer + (rest ? "." + rest : "") + "%";
}
export function WebsiteAnalytics({ id, options, onBack }: { id: string; options: WebAnalysisOption[]; onBack: () => void }) {
  const { t, locale } = useI18n(), w = useWorkspace();
  const [chosen, setChosen] = useState(0), option = options[chosen] ?? options[0];
  const [from, setFrom] = useState(option.date_from), [to, setTo] = useState(option.date_to);
  const [dimensions, setDimensions] = useState<string[]>([]), [submitted, setSubmitted] = useState<string | null>(null);
  const [offset, setOffset] = useState(0), [refresh, setRefresh] = useState(0), [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false);
  const base = `/v1/tenants/${w.tenant}/projects/${w.project}/connector-snapshots/${id}/web-analysis`;
  const query = submitted ? new URLSearchParams(submitted) : null;
  if (query) { query.set("offset", String(offset)); query.set("limit", "12"); }
  const report = useData<Report>(query ? base + "?" + query.toString() : null, refresh, 15000, w.tenant);
  const d = report.data, label = (key: string) => labels[key] ? t(...labels[key]) : key;
  const pendingChange = submitted !== null && new URLSearchParams({ profile: option.profile, account_id: option.account_id, date_from: from, date_to: to, group_by: [...dimensions].sort().join(",") }).toString() !== submitted;
  async function exportReport(format: "html" | "csv" | "json") {
    if (!submitted || !d || busy) return;
    const q = new URLSearchParams(submitted); q.set("format", format); q.set("locale", locale === "en" ? "en-HK" : "zh-HK");
    setBusy(true); setError(null);
    try { await download(base + "?" + q.toString(), "workmate-web-analysis." + format, w.tenant); }
    catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  function metric(name: string, m: Metric) { return <div key={name} className="web-analysis-metric"><span>{label(name)}</span><strong>{webMetricValue(m)}</strong><small>{m.null_reason ? label(m.null_reason) : m.unit === "ratio" ? t("以合計分子與分母計算", "Calculated from aggregate counts") : m.unit === "events/session" ? t("事件可多次發生，此值不是轉換率。", "Events can repeat; this is not a conversion rate.") : m.unit === "count" ? t("已捕獲行的資料", "Captured source rows") : m.unit}</small></div>; }
  return <section className="web-analysis" aria-label={t("網站分析報告", "Website analysis report")}>
    <button className="button secondary small" onClick={onBack}><ArrowLeft size={16} />{t("返回原始資料", "Back to source facts")}</button>
    <header><span className="eyebrow">{t("網站與搜尋", "Website & search")}</span><h2>{t("讓數據有清楚的依據", "A clear basis for every metric")}</h2><p>{t("選擇已同步的範圍，核對流量、事件與搜尋表現。此報告不新增 AI 費用。", "Review traffic, events and search performance from a captured scope. This report adds no AI charge.")}</p></header>
    <form onSubmit={e => { e.preventDefault(); setError(null); setOffset(0); setSubmitted(new URLSearchParams({ profile: option.profile, account_id: option.account_id, date_from: from, date_to: to, group_by: [...dimensions].sort().join(",") }).toString()); setRefresh(v => v + 1); }}>
      <Field label={t("帳戶與報告", "Account and report")}><select value={chosen} onChange={e => { const n = Number(e.target.value), o = options[n]; setChosen(n); setFrom(o.date_from); setTo(o.date_to); setDimensions([]); setSubmitted(null); setOffset(0); }}>
        {options.map((o, i) => <option value={i} key={o.profile + o.account_id}>{o.account_name} · {label(o.profile)}</option>)}
      </select></Field>
      <div className="web-analysis-dates"><Field label={t("開始日期", "From")}><input type="date" required min={option.date_from} max={to} value={from} onChange={e => setFrom(e.target.value)} /></Field><Field label={t("結束日期", "To")}><input type="date" required min={from} max={option.date_to} value={to} onChange={e => setTo(e.target.value)} /></Field></div>
      <fieldset><legend>{t("拆分維度（可選）", "Break down by (optional)")}</legend><div className="web-analysis-dimensions">{option.dimensions.map(key => <label key={key}><input type="checkbox" checked={dimensions.includes(key)} onChange={e => setDimensions(v => e.target.checked ? [...v, key] : v.filter(s => s !== key))} />{label(key)}</label>)}</div></fieldset>
      <div className="row-actions"><button className="button primary" type="submit" disabled={!from || !to || from > to || report.loading}><RefreshCw size={16} />{report.loading ? t("計算中…", "Calculating…") : t("查看分析", "View analysis")}</button><small className="muted">{option.timezone ?? t("來源時區未確認", "Source timezone unconfirmed")}</small></div>
    </form>
    <ErrorNotice error={error ?? report.error} />
    {pendingChange && <p className="notice" role="status">{t("篩選已修改。按「查看分析」更新報告。下載沿用目前已顯示的範圍。", "Filters have changed. View analysis to update the report. Downloads use the currently displayed scope.")}</p>}
    {d && <div className="web-analysis-results"><div className="web-analysis-source"><strong>{d.source.data_mode === "simulated" ? t("合成數據", "Synthetic data") : t("供應商數據", "Provider data")}</strong><span>{d.selection.date_from} → {d.selection.date_to} · {d.source.timezone}</span><span>{d.coverage.selected_rows} {t("行已捕獲資料", "captured rows")}</span><span>{t("抓取於", "Captured")} {new Date(d.source.captured_at).toLocaleString()} · {t("平台截止時間未知", "Platform cutoff unknown")}</span>{d.source.state === "partial" && <p className="notice" role="status">{t("此來源只有部分同步結果，以下數字只反映已捕獲行。", "This source is a partial sync. These metrics cover captured rows only.")}</p>}</div>
      <h3>{t("已觀察資料摘要", "Observed source summary")}</h3><div className="web-analysis-metrics">{Object.entries(d.summary.metrics).map(([name, m]) => metric(name, m))}</div>
      <div className="row-actions" aria-label={t("下載分析報告", "Download analysis report")}>{(["html", "csv", "json"] as const).map(format => <button className="button secondary small" disabled={busy} key={format} onClick={() => void exportReport(format)}><Download size={16} />{format === "html" ? t("完整報告 HTML", "Full report HTML") : format === "csv" ? t("指標 CSV", "Metrics CSV") : t("可核對 JSON", "Verifiable JSON")}</button>)}</div>
      <div className="web-analysis-groups">{d.groups.map(g => <article key={g.id}><h3>{Object.entries(g.dimensions).map(([k, v]) => label(k) + ": " + v).join(" · ") || t("全部已選資料", "All selected rows")}</h3><div className="web-analysis-metrics">{Object.entries(g.metrics).map(([name, m]) => metric(name, m))}</div><small>{g.row_count} {t("來源行", "source rows")}</small></article>)}</div>
      {d.total_groups > 12 && <div className="row-actions"><button className="button secondary small" disabled={!offset} onClick={() => setOffset(v => Math.max(0, v - 12))}>{t("上一頁", "Previous")}</button><span>{offset + 1}–{Math.min(offset + 12, d.total_groups)} / {d.total_groups}</span><button className="button secondary small" disabled={d.next_offset === null} onClick={() => setOffset(d.next_offset!)}>{t("下一頁", "Next")}</button></div>}
      <details className="web-analysis-provenance"><summary>{t("來源、覆蓋與計算依據", "Source, coverage and calculation")}</summary><p>{t("無返回資料的日期不補零：", "Dates without returned rows are not zero: ")}{d.coverage.days_without_rows.join(", ") || "—"}</p><p>Reporting identity: {d.source.reporting_identity ?? t("來源未提供", "Not supplied")}</p><ul>{d.limitations.map(code => <li key={code}>{connectorLimit(code, t)}</li>)}</ul><p>{t("計算摘要", "Calculation SHA-256")}<code>{d.calculation_sha256}</code></p><p>{t("原始來源摘要", "Source SHA-256")}<code>{d.source.sha256}</code></p></details>
    </div>}
  </section>;
}
