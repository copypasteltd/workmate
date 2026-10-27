import { useEffect, useState } from "react";
import { ErrorNotice, Field, useData, useI18n } from "./ui";

type Choice = { id: string; brand_id: string; name: string; version: number; current: boolean; available: boolean };

/** Optional, paged project-only selection. Paging never changes the chosen revision. */
export function RoleBrandVersion({ tenant, project, value, disabled, onChange }: {
  tenant: string; project: string; value: string; disabled?: boolean; onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const [cursors, setCursors] = useState<string[]>([""]), [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<Choice | null>(null);
  const cursor = cursors.at(-1)!;
  const result = useData<{ items: Choice[]; next_cursor: string | null }>(
    `/v1/brand-version-options?project_id=${project}&limit=30${cursor ? "&cursor=" + cursor : ""}`, refresh, 0, tenant,
  );
  useEffect(() => {
    const chosen = result.data?.items.find(row => row.id === value);
    if (chosen) setSelected(chosen);
  }, [value, result.data]);
  const label = (row: Choice) => `${row.name} · v${row.version}${row.current ? t(" · 目前版本", " · Current") : ""}${row.available ? "" : t(" · 來源不可用", " · Sources unavailable")}`;
  return <div>
    <Field label={t("品牌版本（選填）", "Brand version (optional)")} hint={t(
      "選定後保留此版本的品牌資料；日後更新品牌不會自動替換專家的版本。",
      "Pin this revision's brand guidance. Later brand updates will not silently replace it.",
    )}>
      <select name="template_brand_version" value={value} disabled={disabled || result.loading} onChange={event => {
        setSelected(result.data?.items.find(row => row.id === event.target.value) ?? null);
        onChange(event.target.value);
      }}>
        <option value="">{t("不指定品牌", "No brand binding")}</option>
        {value && !result.data?.items.some(row => row.id === value) && <option value={value}>{selected?.id === value ? label(selected) : t("已選定的固定版本", "Selected fixed revision")}</option>}
        {result.data?.items.map(row => <option key={row.id} value={row.id} disabled={!row.available}>{label(row)}</option>)}
      </select>
    </Field>
    <ErrorNotice error={result.error}/>
    <div className="row-actions">
      {cursors.length > 1 && <button type="button" className="button quiet" disabled={disabled || result.loading} onClick={() => setCursors(rows => rows.slice(0, -1))}>{t("上一頁品牌版本", "Previous brand versions")}</button>}
      {result.data?.next_cursor && <button type="button" className="button quiet" disabled={disabled || result.loading} onClick={() => setCursors(rows => [...rows, result.data!.next_cursor!])}>{t("更多品牌版本", "More brand versions")}</button>}
      {result.error && <button type="button" className="button quiet" disabled={disabled || result.loading} onClick={() => { setCursors([""]); setRefresh(n => n + 1); }}>{t("重新載入品牌", "Reload brands")}</button>}
    </div>
  </div>;
}
