import { useEffect, useRef, useState } from "react";
import { FilePenLine, Download, RotateCcw } from "lucide-react";
import { api, download } from "./api";
import { useWorkspace } from "./context";
import { ErrorNotice, Field, useData, useI18n } from "./ui";
import { editablePendingPrefix, readEditableAttempt, type EditableAttempt } from "./editable-project-state";
import "./editable-projects.css";

export function EditableProjects({ refresh, onChanged }: { refresh: number; onChanged: () => void }) {
  const w = useWorkspace(); return <EditableWorkspace key={`${w.me.user.id}:${w.base}`} refresh={refresh} onChanged={onChanged} />;
}
function EditableWorkspace({ refresh, onChanged }: { refresh: number; onChanged: () => void }) {
  const w = useWorkspace(), { t } = useI18n(), root = w.base + "/editable-projects", pendingKey = editablePendingPrefix + `${w.me.user.id}:${w.tenant}:${w.project}`;
  const [revision, setRevision] = useState(0), [pages, setPages] = useState([""]), [sourcePages, setSourcePages] = useState([""]),
    [chosenSource, setChosenSource] = useState(""), [name, setName] = useState(""), [sharing, setSharing] = useState(false),
    [current, setCurrent] = useState<any>(null), [draft, setDraft] = useState<any>(null), [page, setPage] = useState(0), [layer, setLayer] = useState(0),
    [projectName, setProjectName] = useState(""), [oldVersion, setOldVersion] = useState(1), [dirty, setDirty] = useState(false),
    [delivery, setDelivery] = useState<any>(null), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null),
    [pending, setPending] = useState<EditableAttempt | null>(() => readEditableAttempt(pendingKey, root));
  const live = useRef(true), locked = useRef(false), epoch = useRef(0);
  useEffect(() => { live.current = true; return () => { live.current = false; epoch.current++; }; }, []);
  const cursor = pages.at(-1)!, sourceCursor = sourcePages.at(-1)!;
  const list = useData<{ items: any[]; next_cursor: string | null; can_write: boolean }>(root + (cursor ? "?cursor=" + cursor : ""), refresh + revision);
  const sources = useData<{ items: any[]; next_cursor: string | null }>(list.data?.can_write ? root + "/sources" + (sourceCursor ? "?cursor=" + sourceCursor : "") : null, revision);
  const writable = list.data?.can_write === true, disabled = busy || !!pending;
  const scenes = draft ? current.kind === "vector" ? [draft.scene] : draft.slides.map((s: any) => s.scene) : [], selected = scenes[page]?.layers[layer];
  async function run(work: () => Promise<void>) {
    if (locked.current || !live.current) return; locked.current = true; setBusy(true); setError(null);
    try { await work(); } catch (e) { if (live.current) setError(e); }
    finally { locked.current = false; if (live.current) setBusy(false); }
  }
  async function open(id: string, version?: number) {
    const stamp = ++epoch.current, p = await api(`${root}/${id}${version ? "?version=" + version : ""}`);
    if (!live.current || stamp !== epoch.current) return;
    setCurrent(p); setDraft(structuredClone(p.input)); setProjectName(p.name); setOldVersion(p.version); setPage(0); setLayer(0); setDirty(false); setDelivery(null);
  }
  async function finish(attempt: EditableAttempt, result: any) {
    if (!live.current) return;
    localStorage.removeItem(pendingKey); setPending(null); setRevision(r => r + 1); onChanged();
    if (attempt.operation === "render") { await open(result.project_id); if (live.current) setDelivery(result); } else await open(result.id);
  }
  async function submit(attempt: EditableAttempt) {
    localStorage.setItem(pendingKey, JSON.stringify(attempt)); setPending(attempt);
    const receipt = await api(`${root}/requests/${attempt.key}?operation=${attempt.operation}`); if (!live.current) return;
    if (receipt.state === "completed") return finish(attempt, receipt.result);
    if (receipt.state === "removed") throw new Error(t("先前結果或其來源已移除，不會再次建立。請核對後重新選擇。", "The original result or its source was removed. Check before choosing another action."));
    if (receipt.state !== "not_recorded") throw new Error(t("結果尚未確認，請保留原請求。", "The result is still unknown. Keep the original request."));
    const result = await api(attempt.path, { method: attempt.method, headers: { "Idempotency-Key": attempt.key }, body: JSON.stringify(attempt.body) });
    if (live.current) await finish(attempt, result);
  }
  function change(work: (d: any) => void) { setDraft((old: any) => { const next = structuredClone(old); work(next); return next; }); setDirty(true); setDelivery(null); }
  function changeLayer(values: Record<string, unknown>) { change(d => { const s = current.kind === "vector" ? d.scene : d.slides[page].scene; Object.assign(s.layers[layer], values); }); }
  const kindName = (kind: string) => kind === "vector" ? t("矢量設計", "Vector design") : t("演示文稿", "Presentation");
  return <section className="editable-projects" aria-label={t("矢量與演示工程", "Vector & presentation projects")}>
    <header className="matrix-section-heading"><div><p className="eyebrow">MAKE THE NEXT VERSION.</p><h2>{t("讓好設計，繼續生長。", "Good work. Ready for its next chapter.")}</h2>
      <p className="muted">{t("從專員交付的可編輯來源或恢復工程繼續。保留圖片、圖表、分頁及每個儲存版本。", "Continue from a specialist's editable source or a restored project. Keep images, charts, pages and every saved version.")}</p></div><FilePenLine size={27} /></header>
    <ErrorNotice error={error ?? list.error ?? sources.error} />
    {pending && <div className="editable-pending" role="status"><p>{t("有一項操作需要核對；重試會沿用原請求。", "An operation needs checking. Retrying keeps the original request.")}</p>
      <button className="button secondary" disabled={busy} onClick={() => void run(() => submit(pending))}>{t("核對並繼續", "Check & continue")}</button>
      <button className="text-button" disabled={busy} onClick={() => void run(async () => {
        const r = await api(`${root}/requests/${pending.key}?operation=${pending.operation}`);
        if (!live.current) return; if (r.state === "completed") return finish(pending, r.result);
        if (!["not_recorded", "removed"].includes(r.state)) throw new Error(t("請保留尚未確認的操作。", "Keep the unresolved operation."));
        localStorage.removeItem(pendingKey); setPending(null); setDelivery(null); setRevision(r => r + 1);
      })}>{t("核對後重新選擇", "Check before choosing again")}</button></div>}
    {writable && <details className="editable-create"><summary>{t("從已交付來源建立工程", "Create a project from delivered source")}</summary><div className="form-stack">
      <Field label={t("可編輯來源", "Editable source")}><select value={chosenSource} disabled={disabled || sources.loading} onChange={e => { setChosenSource(e.target.value); const v = sources.data?.items.find(v => v.source_version_id === e.target.value); if (v) setName(v.name); }}>
        <option value="">{t("選擇專員交付的來源", "Choose a specialist's source")}</option>{sources.data?.items.map(s => <option key={s.source_version_id} value={s.source_version_id}>{s.name} · {kindName(s.kind)}</option>)}</select></Field>
      <div className="row-actions">{sourcePages.length > 1 && <button disabled={disabled} className="text-button" onClick={() => { setChosenSource(""); setSourcePages(v => v.slice(0, -1)); }}>{t("上一頁來源", "Previous sources")}</button>}
        {sources.data?.next_cursor && <button disabled={disabled} className="text-button" onClick={() => { setChosenSource(""); setSourcePages(v => [...v, sources.data!.next_cursor!]); }}>{t("更多來源", "More sources")}</button>}</div>
      {!sources.loading && !sources.data?.items.length && <p>{t("請先請矢量或簡報專員交付作品，或在上方恢復完整工程包。", "First request a vector or presentation deliverable from a specialist, or restore a complete project package above.")}</p>}
      <Field label={t("工程名稱", "Project name")}><input maxLength={160} value={name} disabled={disabled} onChange={e => setName(e.target.value)} /></Field>
      <label className="creative-package-consent"><input type="checkbox" checked={sharing} disabled={disabled} onChange={e => setSharing(e.target.checked)} />{t("我確認此來源及素材可用於目前專案的共用工程。", "I confirm this source and its media may be used in a shared project here.")}</label>
      <button className="button secondary" disabled={disabled || !sharing || !chosenSource || !name.trim()} onClick={() => void run(async () => {
        const s = sources.data!.items.find(s => s.source_version_id === chosenSource); if (!s) return;
        await submit({ key: crypto.randomUUID(), operation: "create", path: root, method: "POST", body: { name: name.trim(), source_version_id: s.source_version_id, sha256: s.sha256, confirm_project_sharing: true } });
      })}>{t("建立可編輯工程", "Create editable project")}</button></div></details>}
    <div className="editable-project-list">{list.data?.items.map(p => <article key={p.id} className="editable-project-card"><FilePenLine size={20} /><div><h3>{p.name}</h3><p className="muted">{kindName(p.kind)} · v{p.version}</p>
      {p.imported_evidence && <small>{t("包含自行確認的匯入圖表資料", "Includes user-attested imported chart data")}</small>}{!p.available && <small>{t("部分來源暫不可用，請重新核對。", "A source is unavailable. Review it before continuing.")}</small>}</div>
      <button className="button secondary" disabled={disabled || !p.available} onClick={() => void run(() => open(p.id))}>{t("開啟工程", "Open project")}</button></article>)}</div>
    <div className="row-actions">{pages.length > 1 && <button className="text-button" disabled={disabled} onClick={() => setPages(v => v.slice(0, -1))}>{t("上一頁工程", "Previous projects")}</button>}
      {list.data?.next_cursor && <button className="text-button" disabled={disabled} onClick={() => setPages(v => [...v, list.data!.next_cursor!])}>{t("更多工程", "More projects")}</button>}
      <button className="text-button" disabled={disabled || list.loading} onClick={() => setRevision(r => r + 1)}><RotateCcw size={15} />{t("重新整理可編輯工程", "Refresh editable projects")}</button></div>
    {current && draft && <div className="editable-editor" data-editable-editor>
      <header><h3>{current.name} · v{current.version}</h3><p>{t("每次儲存建立新版本。預覽顯示已儲存版本。", "Each save creates a new version. The preview shows the saved version.")}</p></header>
      {current.imported_evidence && <p className="editable-data-note">{t("圖表保留匯入時的原值，尚未連回平台帳戶核實。請在發佈前確認資料。", "Charts retain imported values and have not been verified against platform accounts. Review the data before publishing.")}</p>}
      <div className="editable-version-row"><Field label={t("已儲存版本", "Saved version")}><input type="number" min={1} max={current.current_version} value={oldVersion} disabled={disabled} onChange={e => setOldVersion(Number(e.target.value))} /></Field>
        <button className="text-button" disabled={disabled || !Number.isInteger(oldVersion) || oldVersion < 1 || oldVersion > current.current_version} onClick={() => void run(() => open(current.id, oldVersion))}>{t("開啟此版本", "Open this version")}</button></div>
      <div className="editable-editor-columns"><div className="form-stack">
        <Field label={t("工程名稱", "Project name")}><input value={projectName} disabled={disabled || !writable} maxLength={160} onChange={e => { setProjectName(e.target.value); setDirty(true); }} /></Field>
        <Field label={t("作品標題", "Work title")}><input value={draft.title} disabled={disabled || !writable} maxLength={150} onChange={e => change(d => { d.title = e.target.value; })} /></Field>
        {current.kind === "vector" && <Field label={t("設計用途", "Design purpose")}><textarea value={draft.purpose} disabled={disabled || !writable} maxLength={2000} onChange={e => change(d => { d.purpose = e.target.value; })} /></Field>}
        {current.kind === "presentation" && <>
          <Field label={t("目標觀眾", "Audience")}><input value={draft.audience} disabled={disabled || !writable} maxLength={1000} onChange={e => change(d => { d.audience = e.target.value; })} /></Field>
          <Field label={t("希望促成的決定", "Intended decision")}><textarea value={draft.decision} disabled={disabled || !writable} maxLength={2000} onChange={e => change(d => { d.decision = e.target.value; })} /></Field>
          <Field label={t("頁面", "Page")}><select value={page} disabled={disabled} onChange={e => { setPage(Number(e.target.value)); setLayer(0); }}>{draft.slides.map((s: any, i: number) => <option key={s.id} value={i}>{i + 1}. {s.title}</option>)}</select></Field>
          <Field label={t("頁面標題", "Page title")}><input value={draft.slides[page].title} disabled={disabled || !writable} maxLength={150} onChange={e => change(d => { d.slides[page].title = e.target.value; })} /></Field>
          <Field label={t("演講備註", "Speaker notes")}><textarea value={draft.slides[page].notes} disabled={disabled || !writable} maxLength={6000} onChange={e => change(d => { d.slides[page].notes = e.target.value; })} /></Field>
          <div className="row-actions">{[-1, 1].map(direction => <button key={direction} className="text-button" disabled={disabled || !writable || page + direction < 0 || page + direction >= scenes.length} onClick={() => { change(d => { [d.slides[page], d.slides[page + direction]] = [d.slides[page + direction], d.slides[page]]; }); setPage(page + direction); }}>{direction < 0 ? t("頁面上移", "Move page up") : t("頁面下移", "Move page down")}</button>)}
            <button className="text-button" disabled={disabled || !writable || scenes.length >= 20} onClick={() => { change(d => { const copy = structuredClone(d.slides[page]); copy.id = "page_" + crypto.randomUUID().replaceAll("-", ""); d.slides.splice(page + 1, 0, copy); }); setPage(page + 1); setLayer(0); }}>{t("複製頁面", "Duplicate page")}</button>
            <button className="text-button" disabled={disabled || !writable || scenes.length < 2} onClick={() => { change(d => { d.slides.splice(page, 1); }); setPage(Math.max(0, page - 1)); setLayer(0); }}>{t("移除此頁", "Remove page")}</button></div>
        </>}
        <Field label={t("背景顏色", "Background color")}><input type="color" value={scenes[page].background} disabled={disabled || !writable} onChange={e => change(d => { (current.kind === "vector" ? d.scene : d.slides[page].scene).background = e.target.value; })} /></Field>
        <Field label={t("圖層", "Layer")}><select value={layer} disabled={disabled} onChange={e => setLayer(Number(e.target.value))}>{scenes[page].layers.map((l: any, i: number) => <option key={l.id} value={i}>{i + 1}. {l.kind === "text" ? l.text.slice(0, 50) : l.kind === "image" ? l.alt : l.kind === "chart" ? l.title : l.kind}</option>)}</select></Field>
        <div className="row-actions">{["text", "rect", "ellipse"].map(kind => <button key={kind} className="text-button" disabled={disabled || !writable || scenes[page].layers.length >= 80} onClick={() => { const count = scenes[page].layers.length;
          change(d => { const s = current.kind === "vector" ? d.scene : d.slides[page].scene, geometry = { id: "layer_" + crypto.randomUUID().replaceAll("-", ""), x: 24, y: 24, w: Math.min(320, s.width - 48), h: 96 };
            s.layers.push(kind === "text" ? { ...geometry, kind, text: t("新增文字", "New text"), font_size: 24, weight: 400, color: "#15171a", align: "left", line_height: 1.4 } : { ...geometry, kind, fill: "#e7eefc", stroke: null, stroke_width: 0, ...(kind === "rect" ? { radius: 0 } : {}) }); }); setLayer(count);
        }}>{t(kind === "text" ? "加入文字" : kind === "rect" ? "加入矩形" : "加入橢圓", kind === "text" ? "Add text" : kind === "rect" ? "Add rectangle" : "Add ellipse")}</button>)}</div>
        <div className="row-actions">{[-1, 1].map(direction => <button key={direction} className="text-button" disabled={disabled || !writable || layer + direction < 0 || layer + direction >= scenes[page].layers.length} onClick={() => { change(d => { const ls = (current.kind === "vector" ? d.scene : d.slides[page].scene).layers; [ls[layer], ls[layer + direction]] = [ls[layer + direction], ls[layer]]; }); setLayer(layer + direction); }}>{direction < 0 ? t("圖層後移", "Send layer backward") : t("圖層前移", "Bring layer forward")}</button>)}
          <button className="text-button" disabled={disabled || !writable || scenes[page].layers.length < 2} onClick={() => { change(d => { (current.kind === "vector" ? d.scene : d.slides[page].scene).layers.splice(layer, 1); }); setLayer(Math.max(0, layer - 1)); }}>{t("移除此圖層", "Remove layer")}</button></div>
        {selected?.kind === "text" && <><Field label={t("文字內容", "Layer text")}><textarea value={selected.text} disabled={disabled || !writable} maxLength={6000} rows={4} onChange={e => changeLayer({ text: e.target.value })} /></Field>
          <div className="editable-properties"><Field label={t("字級", "Font size")}><input type="number" min={12} max={180} value={selected.font_size} disabled={disabled || !writable} onChange={e => changeLayer({ font_size: Number(e.target.value) })} /></Field>
            <Field label={t("字重", "Text weight")}><select value={selected.weight} disabled={disabled || !writable} onChange={e => changeLayer({ weight: Number(e.target.value) })}><option value={400}>{t("正常", "Regular")}</option><option value={700}>{t("粗體", "Bold")}</option></select></Field></div></>}
        {selected && "color" in selected && <Field label={t("圖層顏色", "Layer color")}><input type="color" value={selected.color} disabled={disabled || !writable} onChange={e => changeLayer({ color: e.target.value })} /></Field>}
        {selected && "fill" in selected && <><label className="creative-package-consent"><input type="checkbox" checked={selected.fill !== null} disabled={disabled || !writable} onChange={e => changeLayer({ fill: e.target.checked ? "#e7eefc" : null })} />{t("填充形狀", "Fill shape")}</label>
          {selected.fill !== null && <Field label={t("填充顏色", "Fill color")}><input type="color" value={selected.fill} disabled={disabled || !writable} onChange={e => changeLayer({ fill: e.target.value })} /></Field>}</>}
        {selected?.kind === "chart" && <Field label={t("圖表標題", "Chart title")}><input value={selected.title} disabled={disabled || !writable} maxLength={120} onChange={e => changeLayer({ title: e.target.value })} /></Field>}
        {selected?.kind === "image" && <Field label={t("圖片說明", "Image description")}><input value={selected.alt} disabled={disabled || !writable} maxLength={500} onChange={e => changeLayer({ alt: e.target.value })} /></Field>}
        {selected && <details><summary>{t("位置與尺寸", "Position & size")}</summary><div className="editable-properties">{["x", "y", "w", "h"].map(key => <Field key={key} label={t(({ x: "橫向位置", y: "縱向位置", w: "寬度", h: "高度" } as any)[key], ({ x: "Horizontal position", y: "Vertical position", w: "Width", h: "Height" } as any)[key])}><input type="number" min={key === "w" || key === "h" ? 1 : 0} max={4096} value={selected[key]} disabled={disabled || !writable} onChange={e => changeLayer({ [key]: Number(e.target.value) })} /></Field>)}</div></details>}
        {dirty && <p role="status">{t("有未儲存修改；儲存後更新預覽。", "You have unsaved changes. Save to update the preview.")}</p>}
        <div className="row-actions"><button className="button primary" disabled={disabled || !writable || !dirty || !projectName.trim()} onClick={() => void run(() => submit({ key: crypto.randomUUID(), operation: "update", path: root + "/" + current.id, method: "PUT", body: { name: projectName.trim(), expected_version: current.current_version, input: draft } }))}>{t("儲存為新版本", "Save as new version")}</button>
          <button className="button secondary" disabled={disabled || !writable || dirty || current.version !== current.current_version} onClick={() => void run(() => submit({ key: crypto.randomUUID(), operation: "render", path: `${root}/${current.id}/render`, method: "POST", body: { expected_version: current.current_version } }))}>{t("製作交付檔案", "Create delivery files")}</button></div>
      </div><div className="editable-preview-column"><EditablePreview key={`${current.id}:${current.version}:${page}`} path={`${root}/${current.id}/preview?version=${current.version}&page=${page + 1}`} label={`${current.name} · v${current.version} · ${page + 1}`} /></div></div>
      {delivery && <div className="editable-delivery" role="status"><h4>{t("交付檔案已就緒", "Delivery files are ready")}</h4><p>v{delivery.version} · {t("無 AI 調用費用", "No AI request charge")}</p>
        <div className="editable-delivery-files">{delivery.files.map((f: any) => <button key={f.asset_id} className="text-button" disabled={busy} onClick={() => void run(async () => { await download(`${w.base}/assets/${f.asset_id}/download`, f.name, w.tenant); })}><Download size={14} />{f.name}</button>)}</div></div>}
    </div>}
  </section>;
}
function EditablePreview({ path, label }: { path: string; label: string }) {
  const [url, setURL] = useState(""), [error, setError] = useState<unknown>(null);
  useEffect(() => { let live = true, owned = "";
    void api(path).then(async r => { const bytes = Uint8Array.from(atob(r.base64), c => c.charCodeAt(0));
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(v => v.toString(16).padStart(2, "0")).join("");
      if (r.content_type !== "image/png" || r.bytes !== bytes.length || r.sha256 !== digest) throw new Error("Preview integrity check failed");
      if (live) { owned = URL.createObjectURL(new Blob([bytes], { type: "image/png" })); setURL(owned); }
    }).catch(e => { if (live) setError(e); });
    return () => { live = false; if (owned) URL.revokeObjectURL(owned); };
  }, [path]);
  return <figure className="editable-preview"><ErrorNotice error={error} />{url ? <img src={url} alt={label} /> : !error && <p role="status">…</p>}<figcaption>{label}</figcaption></figure>;
}
