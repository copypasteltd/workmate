import { useState } from "react";
import { Download } from "lucide-react";
import { download } from "./api";
import { ErrorNotice, useI18n } from "./ui";
import { MarketingWarnings } from "./marketing-warnings";

export function MarketingAnalysis({
  base,
  dataset: d,
}: {
  base: string;
  dataset: any;
}) {
  const { t } = useI18n(),
    [error, setError] = useState<unknown>(null);
  const m = d.summary,
    exact = m.exact || {},
    reasons = m.null_reasons || {};
  const unavailable = (key: string) =>
    reasons[key] === "missing_conversions"
      ? t("缺少轉化數據", "Conversions unavailable")
      : reasons[key] === "missing_conversion_value"
        ? t("缺少轉化價值", "Conversion value unavailable")
        : reasons[key] === "zero_denominator"
          ? t("分母為零", "Zero denominator")
          : t("沒有可計算資料", "No usable data");
  const display = (key: string, unit: "money" | "percent" | "ratio") =>
    exact[key] === null || exact[key] === undefined
      ? t("未知", "Unknown")
      : unit === "money"
        ? `${d.currency} ${Number(exact[key]).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : unit === "percent"
          ? `${(Number(exact[key]) * 100).toFixed(2)}%`
          : `${Number(exact[key]).toFixed(2)}×`;
  const points = d.daily || [],
    max = Math.max(1, ...points.map((r: any) => r.spend_micros));
  const columns = points.length > 60 ? [] : points;
  const chartData = columns.length ? columns : (d.channels || []).slice(0, 20);
  const chartMax = columns.length
    ? max
    : Math.max(1, ...chartData.map((r: any) => r.spend_micros));
  const get = (suffix: string, name: string) =>
    void download(`${base}/analytics/${d.id}/${suffix}`, name).catch(setError);
  return (
    <div className="marketing-analysis" data-snapshot-id={d.id}>
      <ErrorNotice error={error} />
      <div className="metrics-grid">
        {[
          ["spend", t("廣告花費", "Ad spend"), "money"],
          ["ctr", t("點擊率", "Click-through rate"), "percent"],
          ["cpc", t("每次點擊成本", "Cost per click"), "money"],
          ["cpm", t("每千次曝光成本", "Cost per thousand"), "money"],
          ["cvr", t("轉化率", "Conversion rate"), "percent"],
          ["cpa", t("每次轉化成本", "Cost per conversion"), "money"],
          ["roas", t("廣告回報", "Return on ad spend"), "ratio"],
        ].map(([key, label, unit]) => (
          <div
            className="metric-card"
            key={key}
            title={exact[key] ?? unavailable(key)}
          >
            <span>{label}</span>
            <strong>
              {display(key, unit as "money" | "percent" | "ratio")}
            </strong>
            <small>
              {exact[key] === null
                ? unavailable(key)
                : t("先加總，再計算比率", "Totals first, then ratios")}
            </small>
          </div>
        ))}
      </div>
      {chartData.length > 0 && (
        <section
          className="card marketing-chart"
          aria-label={t("廣告花費圖表", "Ad spend chart")}
        >
          <div className="section-title">
            <h2>
              {columns.length
                ? t("每日花費", "Daily spend")
                : t("各渠道花費", "Spend by channel")}
            </h2>
            <span className="muted">{d.currency}</span>
          </div>
          <div
            className="marketing-bars"
            role="img"
            aria-label={`${d.currency} ${t("廣告花費，數值見下方明細", "ad spend; values in the table below")}`}
          >
            {chartData.map((r: any, i: number) => (
              <div
                className="marketing-bar-column"
                key={r.date || r.channel}
                title={`${r.date || r.channel}: ${r.exact?.spend} ${d.currency}`}
              >
                <div className="marketing-bar-track">
                  <div
                    style={{ height: `${(r.spend_micros / chartMax) * 100}%` }}
                  />
                </div>
                <span>
                  {i === 0 ||
                  i === chartData.length - 1 ||
                  chartData.length <= 8
                    ? r.date?.slice(5) || r.channel
                    : ""}
                </span>
              </div>
            ))}
          </div>
          <details>
            <summary>{t("檢視圖表數據", "View chart data")}</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>
                      {columns.length
                        ? t("日期", "Date")
                        : t("渠道", "Channel")}
                    </th>
                    <th>
                      {t("花費", "Spend")} ({d.currency})
                    </th>
                    <th>{t("點擊", "Clicks")}</th>
                    <th>CTR</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((r: any) => (
                    <tr key={r.date || r.channel}>
                      <td>{r.date || r.channel}</td>
                      <td>{r.exact?.spend}</td>
                      <td>{r.clicks}</td>
                      <td>
                        {r.exact?.ctr === null
                          ? t("未知", "Unknown")
                          : `${(Number(r.exact?.ctr) * 100).toFixed(2)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {!columns.length && (
            <small className="muted">
              {t(
                "日期超過 60 天時顯示前 20 個渠道；完整數據保留在報告中。",
                "For over 60 daily points, up to 20 channels are shown. The report retains all data.",
              )}
            </small>
          )}
        </section>
      )}
      <section className="card marketing-provenance">
        <div className="section-title">
          <h2>{t("範圍與證據", "Scope & evidence")}</h2>
          <div className="row-actions">
            <button
              className="text-button"
              onClick={() => get("report", "analytics-report.json")}
            >
              <Download size={16} />
              {t("完整計算報告", "Calculation report")}
            </button>
            <button
              className="text-button"
              onClick={() => get("chart", "analytics-chart.svg")}
            >
              <Download size={16} />
              SVG
            </button>
            {d.source_available && (
              <button
                className="text-button"
                onClick={() => get("source", "campaign-source.csv")}
              >
                <Download size={16} />
                {t("原始 CSV", "Source CSV")}
              </button>
            )}
          </div>
        </div>
        <p>
          {d.currency} · {d.timezone} ·{" "}
          {d.source === "csv_upload"
            ? t("CSV 上傳", "CSV upload")
            : d.source === "google_ads"
              ? "Google Ads"
              : d.source === "meta_ads"
                ? "Meta Ads"
                : d.source}{" "}
          · {d.row_count} {t("筆", "rows")}
        </p>
        {d.import_spec ? (
          <dl className="marketing-mapping-result">
            {[
              "account_id",
              "entity_level",
              "attribution_definition",
              "conversion_definition",
            ].map((key) => (
              <div key={key}>
                <dt>
                  {
                    {
                      account_id: t("帳戶", "Account"),
                      entity_level: t("資料粒度", "Entity level"),
                      attribution_definition: t(
                        "歸因定義",
                        "Attribution definition",
                      ),
                      conversion_definition: t(
                        "轉化定義",
                        "Conversion definition",
                      ),
                    }[key]
                  }
                </dt>
                <dd>
                  {!d.import_spec[key] || d.import_spec[key] === "not_provided"
                    ? t("未提供", "Not provided")
                    : key === "entity_level"
                      ? {
                          dataset: t("通用資料集", "Generic dataset"),
                          campaign: t("廣告活動", "Campaign"),
                          adset: t("廣告組合", "Ad set"),
                          ad: t("廣告", "Ad"),
                        }[d.import_spec[key] as string] || d.import_spec[key]
                      : d.import_spec[key]}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="notice">
            {t(
              "這份舊資料未保留完整原檔及口徑，不能作為已核驗的來源。",
              "This legacy dataset has no complete retained source or definitions; its provenance is unverified.",
            )}
          </div>
        )}
        <p className="muted">
          {t("資料日期", "Data dates")}:{" "}
          {d.import_spec?.date_range
            ? `${d.import_spec.date_range.from} → ${d.import_spec.date_range.to}`
            : t("未確認", "Unverified")}
          <br />
          {t(
            "平台取數截止時間未提供；上傳時間不代表資料已更新至當下。",
            "Platform extraction cutoff was not provided; upload time does not prove current data freshness.",
          )}
        </p>
        <p className="marketing-checksum">
          {t("快照", "Snapshot")} <code>{d.id}</code>
          <br />
          SHA-256 <code>{d.source_sha256 || t("未保留", "Not retained")}</code>
        </p>
        <MarketingWarnings data={d.import_metadata} />
        <p className="muted">
          {t(
            "平台歸因各自呈現，未跨平台去重或套用匯率。數值可重算；AI 不負責金額加總。",
            "Platform attribution is kept separate. No cross-platform deduplication or FX is applied. Values are reproducible; AI does not sum amounts.",
          )}
        </p>
        <details>
          <summary>
            {t("檢視精確值與引用", "Exact values & references")}
          </summary>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("指標", "Metric")}</th>
                  <th>{t("精確值", "Exact value")}</th>
                  <th>{t("原因／單位", "Reason / unit")}</th>
                  <th>{t("證據 ID", "Evidence ID")}</th>
                </tr>
              </thead>
              <tbody>
                {m.evidence?.map((e: any) => (
                  <tr key={e.id}>
                    <td>{e.metric_id}</td>
                    <td>{e.value ?? t("未知", "Unknown")}</td>
                    <td>{e.null_reason || e.unit}</td>
                    <td>
                      <code>{e.id}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <small>
            {t("公式版本", "Formula version")} {m.calculation?.formula_version}{" "}
            · {m.calculation?.precision} {t("位小數", "decimal places")}
          </small>
        </details>
      </section>
    </div>
  );
}
