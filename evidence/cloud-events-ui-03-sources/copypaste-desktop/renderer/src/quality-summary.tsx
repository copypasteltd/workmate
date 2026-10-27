import { useState } from "react";
import { DateText, ErrorNotice, Loading, Money, useData, useI18n } from "./ui";
import "./delivery-quality.css";
export function QualitySummary({ url }: { url: string }) {
  const { t } = useI18n(), [query, setQuery] = useState(""), [revision, setRevision] = useState(0), [inputError, setInputError] = useState<Error | null>(null);
  const { data, error, loading } = useData(url + query, revision);
  const value = (v: any) => v === null || v === undefined ? "—" : v;
  return <section className="quality-summary card" aria-label={t("交付品質", "Delivery quality")}><header><span className="eyebrow">WORK THAT GETS USED</span><h2>{t("交付，與真正用上的成果", "Deliveries, and work put to use")}</h2><p className="muted">{t("依工作建立時間統計。執行完成、客戶接受和人工投入分別記錄。", "Grouped by task creation time. Execution, customer acceptance and human effort are recorded separately.")}</p></header>
    <form onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget), params = new URLSearchParams(); try {
      for (const k of ["from", "to"]) { const v = String(form.get(k) ?? ""); if (v) params.set(k, new Date(v).toISOString()); }
      const mode = String(form.get("data_mode") ?? ""); if (mode) params.set("data_mode", mode);
      setQuery(params.size ? "?" + params : ""); setRevision(v => v + 1); setInputError(null);
    } catch { setInputError(new Error(t("請選擇有效的時間。", "Choose valid dates."))); } }}>
      <label>{t("建立時間自", "Created from")}<input type="datetime-local" name="from"/></label><label>{t("至（不含）", "Until (exclusive)")}<input type="datetime-local" name="to"/></label>
      <label>{t("資料模式", "Data mode")}<select name="data_mode"><option value="">{t("全部", "All")}</option><option value="simulated">{t("模擬資料", "Simulated")}</option><option value="configured_services">{t("已配置服務", "Configured services")}</option></select></label><button className="button secondary" type="submit">{t("更新統計", "Update metrics")}</button>
    </form><ErrorNotice error={inputError || error}/>{loading && <Loading/>}
    {data && <><p className="muted">{t("實際統計區間", "Actual reporting interval")}: <DateText value={data.cohort.from}/> → <DateText value={data.cohort.to}/> · {t("依工作建立時間；結束時間不含", "By task creation; end exclusive")}</p><dl>{[
      [t("工作總數", "Tasks"), data.tasks], [t("技術執行成功", "Technical successes"), data.technical_successes],
      [t("目前完整交付已接受", "Current deliveries accepted"), data.accepted], [t("接受率（可審閱交付）", "Acceptance (reviewable deliveries)"), data.acceptance_rate === null ? "—" : (data.acceptance_rate * 100).toFixed(1) + "%"],
      [t("待審閱", "Awaiting review"), data.pending_review], [t("需修改", "Changes requested"), data.changes_requested], [t("客戶累計要求修改次數", "Customer revision requests"), data.revision_requests], [t("已棄用", "Discarded"), data.discarded],
      [t("失敗 / 取消", "Failed / cancelled"), `${data.failed} / ${data.cancelled}`],
      [t("已知費用（含失敗）", "Known cost (includes failures)"), <Money value={data.known_cost_micros}/>],
      [t("失敗與取消費用", "Failed & cancelled cost"), <Money value={data.failed_cancelled_cost_micros}/>],
      [t("費用尚未完整確認的工作", "Tasks with incomplete cost"), data.incomplete_cost_tasks],
      [t("每份接受交付的已確認服務成本", "Confirmed service cost per accepted delivery"), data.complete_cost_per_accepted_micros === null ? "—" : <Money value={data.complete_cost_per_accepted_micros}/>],
      [t("填報人工投入（分鐘）", "Reported human effort (minutes)"), value(data.human_minutes)], [t("人工投入記錄覆蓋", "Human effort records"), `${data.human_minutes_coverage} / ${data.tasks}`],
      [t("填報全人工基線（分鐘）", "Reported manual baseline (minutes)"), value(data.baseline_minutes)], [t("基線記錄覆蓋", "Baseline records"), `${data.baseline_minutes_coverage} / ${data.tasks}`],
      [t("填報人工修改次數", "Reported manual revisions"), value(data.manual_revisions)], [t("修改次數記錄覆蓋", "Revision records"), `${data.manual_revisions_coverage} / ${data.tasks}`],
      [t("已觀測復用 / 其中執行成功", "Observed reuse / technically successful"), `${data.observed_reuse_pairs} / ${data.successful_reuse_pairs}`],
    ].map(([label, metric], i) => <div key={i}><dt>{label}</dt><dd>{metric}</dd></div>)}</dl>
      <small>{t("費用未完整確認時，均攤成本留空。服務成本不含退款、外部服務及人力費用。人工數字由客戶填報；復用依據為其他工作實際讀取固定版本成果，不代表續費或收益。", "Cost per accepted delivery stays blank while costs are incomplete. Service costs exclude refunds, external services and labor. Human figures are customer reported. Reuse means another task read a fixed artifact version; it does not establish retention or financial returns.")}</small>
      <small>{t("模擬工作 / 已配置服務工作", "Simulated / configured-service tasks")} {data.simulated_tasks} / {data.configured_services_tasks} · {t("來源不可用", "Unavailable sources")} {data.sources_unavailable}</small></>}
  </section>;
}
