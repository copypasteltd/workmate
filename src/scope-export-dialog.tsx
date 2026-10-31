import { useEffect, useRef, useState } from "react";
import { clientSessionGeneration, downloadScopeArchive } from "./api";
import { ErrorNotice, Loading, Modal, useData, useI18n } from "./ui";
import "./scope-export.css";

export type ScopeExportTarget = { endpoint: string; id: string; tenant?: string };
export function ScopeExportDialog({ target, account, onClose }: { target: ScopeExportTarget; account: string; onClose: () => void }) {
  const { t } = useI18n(), [revision, setRevision] = useState(0), [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState<Error | null>(null);
  const preview = useData<any>(target.endpoint + "-preview", revision);
  const current = useRef({ target, account }), alive = useRef(true), pending = useRef(false), abort = useRef<AbortController | null>(null);
  current.current = { target, account };
  useEffect(() => { alive.current = true; return () => { alive.current = false; abort.current?.abort(); }; }, []);
  useEffect(() => { setAcknowledge(false); setNotice(""); setError(null); }, [preview.data?.snapshot]);
  const p = preview.data;
  async function save() {
    if (!p || preview.error || !acknowledge || pending.current) return;
    const chosen = target, actor = account, generation = clientSessionGeneration();
    const live = () => alive.current && current.current.target === chosen && current.current.account === actor && generation === clientSessionGeneration();
    pending.current = true; setBusy(true); setError(null); setNotice("");
    const controller = new AbortController(); abort.current = controller;
    try {
      if (!live()) return;
      const query = new URLSearchParams({ expected_snapshot: p.snapshot, acknowledge: "true" });
      const result = await downloadScopeArchive(chosen.endpoint + "-package?" + query, `workmate-${chosen.id}-data.zip`, chosen.tenant, controller.signal);
      if (live()) setNotice(result.saved ? t("資料包已儲存，可依清單核對內容。", "Archive saved. Verify its manifest and checksums.") : t("已取消儲存。", "Save cancelled."));
    } catch (error) { if (live()) { setError(error as Error); setAcknowledge(false); } }
    finally { pending.current = false; if (live()) setBusy(false); }
  }
  return <Modal title={t("匯出資料", "Export data")} onClose={() => { abort.current?.abort(); onClose(); }}>
    <div className="scope-export-dialog form-stack">
      {preview.loading && <Loading />}<ErrorNotice error={preview.error} />
      {p && <>
        <p><strong>{p.name}</strong></p>
        <p>{p.audience === "admin_shared_content"
          ? t("以目前後台權限匯出共享資料。私人正文由客戶本人登入匯出，不能代為登入。", "Export shared data under current admin permissions. Customers export their private content from their own sign-in.")
          : t("包含此範圍目前有權讀取的業務記錄、原始檔及可用歷史版本。", "Includes currently readable business records, original files and available historical versions in this scope.")}</p>
        <dl className="scope-export-summary"><div><dt>{t("專案", "Projects")}</dt><dd>{p.projects.length}</dd></div><div><dt>{t("檔案版本", "File versions")}</dt><dd>{p.versions}</dd></div><div><dt>{t("記錄", "Records")}</dt><dd>{p.categories.reduce((n: number, c: any) => n + c.records, 0)}</dd></div><div><dt>{t("原始資料", "Source size")}</dt><dd>{((p.binary_bytes + p.text_bytes) / 1024 ** 2).toFixed(2)} MiB</dd></div></dl>
        <details><summary>{t("查看資料類別", "View data categories")}</summary><div className="scope-export-categories">{p.categories.filter((c: any) => c.records).map((c: any) => <p key={c.name}><span>{c.name.replaceAll("_", " ")}</span><strong>{c.records}</strong></p>)}</div></details>
        {p.archived_projects.length > 0 && <p className="notice">{t("以下封存專案未包括正文；需要先恢復：", "Restore these archived projects to include their content: ")}{p.archived_projects.map((r: any) => r.name).join("、")}</p>}
        <p className="muted small-text">{t("不包含憑據、備份、未上傳的本機檔案、已撤回或刪除內容。ZIP 包含資料清單、原始版本與獨立校驗碼，無需 AI 費用。", "Credentials, backups, unsubmitted local files and withdrawn or deleted content are excluded. The ZIP includes a manifest, exact versions and independent checksums. No AI charge.")}</p>
        <label className="checkbox-row"><input type="checkbox" checked={acknowledge} disabled={busy || preview.loading} onChange={e => setAcknowledge(e.target.checked)} /><span>{t("我確認匯出範圍，並會妥善保管下載副本。", "I confirm this scope and will safeguard the downloaded copy.")}</span></label>
        {notice && <p className="notice" role="status">{notice}</p>}<ErrorNotice error={error} />
        <div className="scope-export-actions"><button className="button secondary" disabled={busy || preview.loading} onClick={() => { setAcknowledge(false); setRevision(v => v + 1); }}>{t("更新預覽", "Refresh preview")}</button><button className="button primary" disabled={busy || preview.loading || !!preview.error || !acknowledge} onClick={() => void save()}>{busy ? t("正在打包及儲存…", "Preparing and saving…") : t("下載完整資料包", "Download data archive")}</button></div>
      </>}
    </div>
  </Modal>;
}
