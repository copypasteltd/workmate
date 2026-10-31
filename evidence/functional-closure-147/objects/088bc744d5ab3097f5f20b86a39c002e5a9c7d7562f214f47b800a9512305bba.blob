import { useEffect, useRef, useState } from "react";
import { Archive, Download, FolderInput, RotateCcw } from "lucide-react";
import { api, download, ApiError } from "./api";
import { useWorkspace } from "./context";
import { ErrorNotice, Field, useData, useI18n } from "./ui";
import { ResumableUpload } from "./resumable-upload";
import { CreativePackageBrand, type BrandApproval, type BrandRequirements } from "./creative-package-brand";
import { CreativePackageEvidence, type PackageEvidence } from "./creative-package-evidence";
import "./creative-packages.css";

type Selection = { asset_id: string; version: number; sha256: string };
type Preview = { kind: "poster" | "video" | "vector" | "presentation"; name: string; preview_hash: string; media_count: number; total_bytes: number;
  files: { path: string; bytes: number }[]; limitations: string[]; brand_requirements?: BrandRequirements; brand_design_colors?: string[]; has_imported_evidence?: boolean; evidence_rows?: PackageEvidence[] };
type Attempt = { key: string; body: Selection & { name: string; preview_hash: string; confirm_project_sharing: true; confirm_media_rights: true; confirm_imported_evidence?: true } & Partial<BrandApproval> };
export function CreativePackages({ refresh, onRestored }: { refresh: number; onRestored: () => void }) {
  const w = useWorkspace();
  return <CreativePackageWorkspace key={`${w.me.user.id}:${w.base}`} refresh={refresh} onRestored={onRestored} />;
}
function CreativePackageWorkspace({ refresh, onRestored }: { refresh: number; onRestored: () => void }) {
  const w = useWorkspace(), { t } = useI18n(), root = w.base + "/creative-project-packages";
  const [listRevision, setListRevision] = useState(0);
  const [evidenceApproved, setEvidenceApproved] = useState(false);
  const [brandApproval, setBrandApproval] = useState<BrandApproval | null>(null);
  const list = useData<{ items: { id: string; name: string; kind: string; version: number; private_owner: string | null }[] }>(root, refresh + listRevision);
  const pendingKey = `cp_creative_restore:${w.me.user.id}:${w.tenant}:${w.project}`;
  const [chosen, setChosen] = useState(""), [sharing, setSharing] = useState(false), [rights, setRights] = useState(false),
    [selection, setSelection] = useState<Selection | null>(null), [preview, setPreview] = useState<Preview | null>(null),
    [name, setName] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null),
    [result, setResult] = useState<any>(null), [pending, setPending] = useState<Attempt | null>(() => {
      try { const p = JSON.parse(localStorage.getItem(pendingKey) ?? "null");
        return p && typeof p.key === "string" && p.body?.confirm_project_sharing === true && p.body?.confirm_media_rights === true ? p : null;
      } catch { return null; }
    });
  const live = useRef(true), locked = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const effect = async (work: () => Promise<void>) => {
    if (locked.current || !live.current) return; locked.current = true; setBusy(true); setError(null);
    try { await work(); } catch (e) { if (live.current) setError(e); }
    finally { locked.current = false; if (live.current) setBusy(false); }
  };
  const completed = (value: any) => {
    localStorage.removeItem(pendingKey);
    if (!live.current) return; setPending(null); setResult(value); setPreview(null); setSelection(null); setRights(false); setBrandApproval(null); onRestored();
  };
  const submit = async (attempt: Attempt) => {
    localStorage.setItem(pendingKey, JSON.stringify(attempt)); setPending(attempt);
    const receipt = await api(root + "/requests/" + attempt.key);
    if (!live.current) return;
    if (receipt.state === "completed") { completed(receipt.result); return; }
    if (receipt.state === "removed") { localStorage.removeItem(pendingKey); setPending(null); throw new Error(t("先前已恢復的工程已被移除；不會再次建立。", "The previously restored project was removed; it will not be recreated.")); }
    const restored = await api(root + "/restore", { method: "POST", headers: { "Idempotency-Key": attempt.key }, body: JSON.stringify(attempt.body) });
    completed(restored);
  };
  const uploaded = (asset?: any) => { if (!asset || !live.current) return;
    const selected = { asset_id: asset.id, version: asset.version.version, sha256: asset.version.sha256 };
    setSelection(selected); setResult(null); setEvidenceApproved(false);
    void effect(async () => { const data = await api(root + "/preview", { method: "POST", body: JSON.stringify(selected) });
      if (live.current) { setPreview(data); setName(data.name + t(" · 恢復副本", " · Restored")); setRights(false); setBrandApproval(null); } });
  };
  const project = list.data?.items.find(p => p.id === chosen);
  return <section className="creative-packages" aria-label={t("工程打包與恢復", "Project packages & restore")}>
    <header className="matrix-section-heading"><div><p className="eyebrow">KEEP CREATING.</p>
      <h2>{t("工程與素材，一起帶走。", "Your project. Every source included.")}</h2>
      <p className="muted">{t("打包畫布、影片、矢量設計或演示文稿，恢復為新工程繼續編輯。AI HK$0。", "Package a canvas, video, vector design or presentation. Restore a new copy and keep editing. AI HK$0.")}</p></div><Archive size={25} /></header>
    <ErrorNotice error={error ?? list.error} />
    <div className="creative-package-columns"><div className="form-stack">
      <Field label={t("選擇固定工程版本", "Choose a fixed project version")}><select value={chosen} disabled={busy} onChange={e => setChosen(e.target.value)}>
        <option value="">{t("選擇工程", "Choose a project")}</option>{list.data?.items.map(p => <option key={p.id} value={p.id}>{p.name} · v{p.version} · {p.kind === "video" ? t("影片", "Video") : p.kind === "vector" ? t("矢量", "Vector") : p.kind === "presentation" ? t("演示文稿", "Presentation") : t("畫布", "Canvas")}</option>)}
      </select></Field>
      <button className="text-button" disabled={busy || list.loading} onClick={() => { setError(null); setListRevision(v => v + 1); }}><RotateCcw size={15} />{t("重新整理工程版本", "Refresh project versions")}</button>
      <button className="button secondary" disabled={!project || busy || list.loading} onClick={() => void effect(async () => {
        try { await download(`${root}/${project!.id}?expected_version=${project!.version}`, `workmate-${project!.kind}-${project!.id}-v${project!.version}.zip`); }
        catch (e) { if (live.current && e instanceof ApiError && e.status === 409) setListRevision(v => v + 1); throw e; }
      })}><Download size={16} />{t("下載完整工程 ZIP", "Download complete project ZIP")}</button>
      <p className="muted">{t("包含固定素材、可編輯來源與校驗清單；矢量及演示文稿附字型、逐頁預覽與圖表資料。品牌與資料須分別核對。100 MiB 上限。", "Includes fixed media, editable source and checksums. Vector and presentation packages include fonts, page previews and chart data. Review brand mappings and imported values separately. Up to 100 MiB.")}</p>
    </div><div className="form-stack">
      {pending ? <div role="status"><h3>{t("核對上次恢復結果", "Check the previous restore")}</h3>
        <p>{pending.body.name}</p><p className="muted">{t("上次結果尚未確認。核對或重試會沿用原請求，避免重複建立。", "The previous outcome is unconfirmed. Checking or retrying uses the original request to prevent duplicates.")}</p>
        <button className="button secondary" disabled={busy} onClick={() => void effect(() => submit(pending))}><RotateCcw size={16} />{t("核對並繼續原恢復", "Check & continue original restore")}</button>
        {error instanceof ApiError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status) && <button className="text-button" disabled={busy} onClick={() => void effect(async () => {
          const receipt = await api(root + "/requests/" + pending.key);
          if (receipt.state === "completed") { completed(receipt.result); return; }
          if (live.current) { localStorage.removeItem(pendingKey); setPending(null); setPreview(null); setBrandApproval(null); }
        })}>{t("核對後重新選擇來源", "Check before choosing another source")}</button>}
      </div> : <><label className="creative-package-consent"><input type="checkbox" checked={sharing} disabled={busy || !!preview}
        onChange={e => setSharing(e.target.checked)} /><span>{t("我確認上傳的工程包和恢復素材可供目前專案成員使用。", "I confirm this archive and restored media may be shared with members of the current project.")}</span></label>
        {!preview && sharing && <ResumableUpload onDone={uploaded} accept=".zip,application/zip" />}
        {!preview && selection && <button className="text-button" disabled={busy} onClick={() => void effect(async () => {
          const data = await api(root + "/preview", { method: "POST", body: JSON.stringify(selection) });
          if (live.current) { setPreview(data); setName(data.name + t(" · 恢復副本", " · Restored")); setBrandApproval(null); }
        })}>{t("重新校驗已上傳工程包", "Recheck uploaded package")}</button>}
        {preview && <div className="creative-package-review" data-package-preview>
          <h3>{t("恢復前確認", "Review before restoring")}</h3><p>{preview.media_count} {t("個來源素材", "source files")} · {(preview.total_bytes / 1024 ** 2).toFixed(1)} MiB</p>
          <ul>{preview.limitations.map(v => <li key={v}>{v}</li>)}</ul>
          <details><summary>{t("完整檔案清單", "Complete file list")}</summary><ul>{preview.files.map(f => <li key={f.path}>{f.path} · {Math.ceil(f.bytes / 1024)} KiB</li>)}</ul></details>
          <Field label={t("新工程名稱", "New project name")}><input value={name} maxLength={150} disabled={busy} onChange={e => setName(e.target.value)} /></Field>
          {preview.brand_requirements && selection && <CreativePackageBrand key={selection.sha256} root={root} selection={selection} requirements={preview.brand_requirements}
            colors={preview.brand_design_colors ?? []} editableFonts={preview.kind === "vector" || preview.kind === "presentation"} disabled={busy} onChange={setBrandApproval} />}
          {preview.has_imported_evidence && <CreativePackageEvidence key={preview.preview_hash} rows={preview.evidence_rows ?? []} disabled={busy} approved={evidenceApproved} onChange={setEvidenceApproved} />}
          <label className="creative-package-consent"><input type="checkbox" checked={rights} disabled={busy} onChange={e => setRights(e.target.checked)} />
            <span>{t("我確認素材授權適用於目前專案，並建立新的共用工程；來源工程不會被覆寫。", "I confirm media rights for this project and agree to create a new shared copy. The source will not be overwritten.")}</span></label>
          <div className="row-actions"><button className="button primary" disabled={busy || !rights || !name.trim() || !selection || !!preview.has_imported_evidence && !evidenceApproved || !!preview.brand_requirements && !brandApproval} onClick={() => void effect(() => submit({ key: crypto.randomUUID(), body: { ...selection!, name: name.trim(), preview_hash: preview.preview_hash, confirm_project_sharing: true, confirm_media_rights: true, ...(preview.has_imported_evidence && evidenceApproved ? { confirm_imported_evidence: true } : {}), ...(brandApproval ?? {}) } }))}>
            <FolderInput size={16} />{t("恢復為新工程", "Restore a new project")}</button>
            <button className="text-button" disabled={busy} onClick={() => { setPreview(null); setSelection(null); setRights(false); setEvidenceApproved(false); }}>{t("改選其他工程包", "Choose another package")}</button></div>
        </div>}
      </>}
      {result && <p role="status" data-package-restored>{t("已恢復，可在下方繼續編輯：", "Restored. Continue editing below: ")}{result.name} · {result.imported_assets} {t("個素材", "media files")}</p>}
    </div></div>
  </section>;
}
