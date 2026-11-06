import { useEffect, useState } from "react";
import { ErrorNotice, Field, useData, useI18n } from "./ui";

type Resource = { source_version_id: string; sha256: string; name: string };
export function DesignResourcePicker({ root, disabled, canAdd, replaceKind, apply }: {
  root: string; disabled: boolean; canAdd: boolean; replaceKind?: string; apply: (resource: any, title: string, evidence: any[], replace: boolean) => void;
}) {
  const { t } = useI18n(), [kind, setKind] = useState("image"), [query, setQuery] = useState(""), [search, setSearch] = useState(""),
    [pages, setPages] = useState([""]), [refresh, setRefresh] = useState(0), [chosen, setChosen] = useState<Resource | null>(null);
  const path = root + "/resources?kind=" + kind + "&q=" + encodeURIComponent(search) + (pages.at(-1) ? "&cursor=" + pages.at(-1) : "");
  const list = useData<{ items: Resource[]; next_cursor: string | null }>(path, refresh);
  return <div className="design-resource-picker">
    <p className="muted">{t("只選用此專案已共用的固定版本。私人對話成果請先在檔案中明確發佈至專案。", "Choose fixed versions already shared with this project. Publish private chat files to the project first.")}</p>
    <div className="editable-properties"><Field label={t("素材類型", "Resource type")}><select value={kind} disabled={disabled} onChange={e => { setKind(e.target.value); setPages([""]); setChosen(null); }}><option value="image">{t("圖片", "Images")}</option><option value="chart">{t("資料圖表", "Data charts")}</option></select></Field>
      <Field label={t("搜尋素材", "Find resources")}><input value={query} disabled={disabled} maxLength={150} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); setSearch(query.trim()); setPages([""]); setChosen(null); } }} /></Field></div>
    <div className="row-actions"><button className="text-button" disabled={disabled || list.loading} onClick={() => { setSearch(query.trim()); setPages([""]); setChosen(null); setRefresh(v => v + 1); }}>{t("搜尋並更新素材", "Search & refresh resources")}</button></div>
    <ErrorNotice error={list.error} />
    <Field label={t("共用素材固定版本", "Fixed shared resource version")}><select value={chosen?.source_version_id ?? ""} disabled={disabled || list.loading} onChange={e => setChosen(list.data?.items.find(r => r.source_version_id === e.target.value) ?? null)}>
      <option value="">{list.loading ? t("正在讀取素材…", "Loading resources…") : t("選擇素材", "Choose a resource")}</option>{list.data?.items.map(r => <option key={r.source_version_id} value={r.source_version_id}>{r.name}</option>)}</select></Field>
    {!list.loading && list.data && !list.data.items.length && <p>{t("沒有符合的共用素材。請先上傳PNG，或請分析專員交付並發佈分析源文件。", "No matching shared resources. Upload a PNG, or ask an analyst to deliver and publish an analysis source.")}</p>}
    <div className="row-actions">{pages.length > 1 && <button className="text-button" disabled={disabled || list.loading} onClick={() => { setPages(v => v.slice(0, -1)); setChosen(null); }}>{t("上一頁素材", "Previous resources")}</button>}{list.data?.next_cursor && <button className="text-button" disabled={disabled || list.loading} onClick={() => { setPages(v => [...v, list.data!.next_cursor!]); setChosen(null); }}>{t("更多素材", "More resources")}</button>}</div>
    {chosen && <ResourceReview key={chosen.source_version_id + chosen.sha256} root={root} resource={chosen} kind={kind} disabled={disabled} canAdd={canAdd} replaceKind={replaceKind} apply={apply} />}
  </div>;
}
function ResourceReview({ root, resource, kind, disabled, canAdd, replaceKind, apply }: {
  root: string; resource: Resource; kind: string; disabled: boolean; canAdd: boolean; replaceKind?: string;
  apply: (resource: any, title: string, evidence: any[], replace: boolean) => void;
}) {
  const { t } = useI18n(), [offset, setOffset] = useState(0), [picked, setPicked] = useState<any[]>([]), [title, setTitle] = useState(resource.name.slice(0, kind === "image" ? 500 : 120)),
    [preview, setPreview] = useState(""), [error, setError] = useState<unknown>(null), [confirmed, setConfirmed] = useState(false), [refresh, setRefresh] = useState(0);
  const detail = useData<any>(`${root}/resources/${resource.source_version_id}?sha256=${resource.sha256}&offset=${offset}`, refresh);
  const current = detail.data?.source_version_id === resource.source_version_id && detail.data?.sha256 === resource.sha256 && detail.data?.kind === kind ? detail.data : null;
  useEffect(() => {
    let live = true; setPreview(""); setError(null);
    if (current?.kind === "image") void (async () => {
      const p = current.preview;
      if (p?.content_type !== "image/png" || typeof p.base64 !== "string" || p.base64.length > 4_000_000) throw Error(t("圖片預覽不可用", "Image preview unavailable"));
      const bytes = Uint8Array.from(atob(p.base64), c => c.charCodeAt(0)), digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(v => v.toString(16).padStart(2, "0")).join("");
      if (bytes.length !== p.bytes || digest !== p.sha256) throw Error(t("圖片預覽校驗失敗", "Image preview integrity check failed"));
      if (live) setPreview("data:image/png;base64," + p.base64);
    })().catch(e => { if (live) setError(e); });
    return () => { live = false; };
  }, [current]);
  const ready = current && (kind === "image" ? !!preview : picked.length > 0) && confirmed && title.trim();
  return <div className="design-resource-review">
    <ErrorNotice error={error ?? detail.error} />
    {detail.error && <button className="text-button" disabled={disabled || detail.loading} onClick={() => setRefresh(v => v + 1)}>{t("重新核對來源", "Check source again")}</button>}
    {current?.kind === "image" && preview && <figure><img src={preview} alt={resource.name} /><figcaption>{current.width} × {current.height}</figcaption></figure>}
    {current?.kind === "chart" && <>
      <p className="muted">{t("勾選最多八項同口徑數值。來源、指標、帳戶、幣種、時區、期間與歸因必須一致。", "Choose up to eight values with matching source, metric, account, currency, timezone, period and attribution.")}</p>
      {current.imported_evidence && <p className="editable-data-note">{t("此資料由使用者確認匯入，尚未向平台帳戶核實。", "User-attested imported data; not verified against a platform account.")}</p>}
      {current.unsupported_count > 0 && <p>{t("部分變化率或超出範圍的值不適用此條形圖，未列入選項；原分析內容保留。", "Some signed changes or out-of-range values are unsupported by this bar chart. They remain in the original analysis.")}</p>}
      <div className="design-evidence-list">{current.items.map((row: any) => { const selected = picked.some(v => v.id === row.id), different = picked.length > 0 && picked[0].series_key !== row.series_key;
        return <article key={row.id}><label><input type="checkbox" checked={selected} disabled={disabled || !selected && (picked.length >= 8 || different)} onChange={e => { setPicked(v => e.target.checked ? [...v, row] : v.filter(r => r.id !== row.id)); setConfirmed(false); }} /><span><strong>{row.label} · {row.metric_id}</strong><span>{row.value === null ? t("未知", "Unknown") + " · " + row.null_reason : row.value + " " + row.unit}</span></span></label><details><summary>{t("核對原始口徑", "Review original scope")}</summary><pre>{JSON.stringify(JSON.parse(row.scope), null, 2)}</pre></details></article>;
      })}</div>
      {!current.items.length && <p>{t("此來源沒有受支援的圖表數值。請選擇其他分析來源。", "This source has no supported chart values. Choose another analysis source.")}</p>}
      <div className="row-actions"><span role="status">{picked.length}/8 {t("已選", "selected")} · {offset + 1}–{Math.min(offset + 64, current.total_count)}/{current.total_count}</span>
        {offset > 0 && <button disabled={disabled || detail.loading} className="text-button" onClick={() => setOffset(v => Math.max(0, v - 64))}>{t("上一頁數值", "Previous values")}</button>}{current.next_offset !== null && <button disabled={disabled || detail.loading} className="text-button" onClick={() => setOffset(current.next_offset)}>{t("更多數值", "More values")}</button>}
        {!!picked.length && <button className="text-button" disabled={disabled} onClick={() => { setPicked([]); setConfirmed(false); }}>{t("清除已選數值", "Clear selected values")}</button>}</div>
      {!!picked.length && <p className="design-picked-evidence">{picked.map(r => `${r.label}: ${r.value ?? "N/A"} ${r.unit}`).join(" · ")}</p>}
    </>}
    {current && <><Field label={kind === "image" ? t("圖片說明", "Image description") : t("新圖表標題", "New chart title")}><input value={title} disabled={disabled} maxLength={kind === "image" ? 500 : 120} onChange={e => setTitle(e.target.value)} /></Field>
      <details><summary>{t("固定來源資訊", "Fixed source details")}</summary><p>{resource.source_version_id}</p><code>{resource.sha256}</code></details>
      <label className="creative-package-consent"><input type="checkbox" checked={confirmed} disabled={disabled} onChange={e => setConfirmed(e.target.checked)} />{t("我已核對來源與使用權；同意在此共用工程中使用。", "I reviewed the source and usage rights and agree to use it in this shared work.")}</label>
      <div className="row-actions"><button className="button secondary" disabled={disabled || !canAdd || !ready} onClick={() => apply(current, title.trim(), picked, false)}>{t("加入新圖層", "Add as new layer")}</button>{replaceKind === kind && <button className="button secondary" disabled={disabled || !ready} onClick={() => apply(current, title.trim(), picked, true)}>{t("替換所選圖層來源", "Replace selected layer source")}</button>}</div>
    </>}
  </div>;
}
