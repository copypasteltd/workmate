import { useState } from "react";
import { useI18n } from "./ui";

export type PackageEvidence = { id: string; source_version_id: string; metric_id: string; label: string; value: string | null; unit: string; null_reason: string | null; scope: string };
export function CreativePackageEvidence({ rows, disabled, approved, onChange }: {
  rows: PackageEvidence[]; disabled: boolean; approved: boolean; onChange: (value: boolean) => void;
}) {
  const { t } = useI18n(), [page, setPage] = useState(0), count = Math.ceil(rows.length / 20);
  return <section className="creative-evidence-review" aria-label={t("匯入圖表資料核對", "Imported chart data review")}>
    <h4>{t("核對圖表的原值與範圍", "Review chart values and scope")}</h4>
    <p>{t("這是工程包內的資料快照。恢復後會標示為自行確認的匯入資料。", "These values are a snapshot in the package. Restored charts will be labelled as user-attested imported data.")}</p>
    <p>{rows.length} {t("筆資料", "records")} · {page + 1}/{count}</p>
    {rows.slice(page * 20, (page + 1) * 20).map(r => <article key={r.source_version_id + r.id}>
      <strong>{r.label}</strong><p>{r.value ?? t("缺少數值", "Missing value")} {r.unit}</p>
      {r.value === null && <p>{r.null_reason}</p>}
      <details><summary>{t("資料定義與範圍", "Definition & scope")}</summary><p>{r.metric_id}</p><pre>{JSON.stringify(JSON.parse(r.scope), null, 2)}</pre></details>
    </article>)}
    <div className="row-actions"><button type="button" className="text-button" disabled={disabled || page === 0} onClick={() => setPage(p => p - 1)}>{t("上一頁資料", "Previous records")}</button>
      <button type="button" className="text-button" disabled={disabled || page + 1 >= count} onClick={() => setPage(p => p + 1)}>{t("下一頁資料", "Next records")}</button></div>
    <label className="creative-package-consent"><input type="checkbox" checked={approved} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span>{t("我已核對匯入圖表原值與範圍，了解這些資料尚未透過目的專案的平台帳戶核實。", "I reviewed the imported chart values and scope and understand they have not been verified against the destination project's platform accounts.")}</span></label>
  </section>;
}
