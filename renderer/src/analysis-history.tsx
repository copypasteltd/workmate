import { useEffect, useState } from "react";
import { useData, useI18n } from "./ui";
export function useAnalysisHistory(url: string, refresh = 0, interval = 0) {
  const [search, setSearchState] = useState(""), [cursors, setCursors] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  useEffect(() => { const timer = setTimeout(() => { setQuery(search); setCursors([]); }, 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { setCursors([]); }, [url, refresh]);
  const params = new URLSearchParams({ limit: "20", ...(query ? { search: query } : {}), ...(cursors.length ? { cursor: cursors.at(-1)! } : {}) });
  const result = useData(url + "?" + params, refresh, interval);
  return { ...result, search, setSearch: setSearchState, page: cursors.length + 1, previous: () => setCursors(old => old.slice(0, -1)), next: () => { if (result.data?.next_cursor) setCursors(old => old.at(-1) === result.data.next_cursor ? old : [...old, result.data.next_cursor]); }, first: () => { setCursors([]); setSearchState(""); setQuery(""); } };
}
export function AnalysisHistoryControls({ history, label }: { history: ReturnType<typeof useAnalysisHistory>; label: string }) {
  const { t } = useI18n();
  return <div className="review-list-controls"><input type="search" aria-label={label} placeholder={label} value={history.search} maxLength={160} onChange={e => history.setSearch(e.target.value)}/><button type="button" className="button secondary" disabled={history.page <= 1 || history.loading} onClick={history.previous}>{t("上一頁", "Previous")}</button><span aria-live="polite">{t("第", "Page")} {history.page}</span><button type="button" className="button secondary" disabled={!history.data?.next_cursor || history.loading} onClick={history.next}>{t("下一頁", "Next")}</button>{history.error && <button type="button" className="text-button" onClick={history.first}>{t("從第一頁重新載入", "Start again from the first page")}</button>}</div>;
}
