import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, FileText, History, Pencil, RefreshCw, ShieldCheck } from "lucide-react";
import { api, post } from "./api";
import { useWorkspace } from "./context";
import { DateText, ErrorNotice, Field, Loading, Modal, useData, useI18n } from "./ui";
import "./project-configuration.css";

interface VersionRef { id: string; version: number }
interface Definition {
  schema_version: 1;
  name: string;
  instructions: string;
  delivery_requirements: string;
  default_agent: VersionRef | null;
  brand: VersionRef | null;
  asset_version_ids: string[];
  connection_ids: string[];
  max_task_budget_micros: number | null;
}
const definition = (body: any = {}): Definition => ({
  schema_version: 1, name: body.name ?? "", instructions: body.instructions ?? "",
  delivery_requirements: body.delivery_requirements ?? "", default_agent: body.default_agent ?? null,
  brand: body.brand ?? null, asset_version_ids: [...(body.asset_version_ids ?? [])],
  connection_ids: [...(body.connection_ids ?? [])], max_task_budget_micros: body.max_task_budget_micros ?? null,
});
const versionValue = (v: VersionRef | null) => v ? v.id + ":" + v.version : "";
const versionRef = (value: string): VersionRef | null => {
  if (!value) return null;
  const [id, revision] = value.split(":");
  return { id, version: Number(revision) };
};
const hkd = (micros: number | string) => new Intl.NumberFormat("en-HK", {
  style: "currency", currency: "HKD", minimumFractionDigits: 2, maximumFractionDigits: 6,
}).format(Number(micros) / 1_000_000);
function useBriefRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const change = () => setRevision(v => v + 1);
    const visible = () => { if (!document.hidden) change(); };
    window.addEventListener("copypaste:project-configuration", change);
    window.addEventListener("focus", change);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("copypaste:project-configuration", change);
      window.removeEventListener("focus", change);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return revision;
}

function BriefDetails({ body }: { body: any }) {
  const { t } = useI18n(), resolved = body.resolved ?? {};
  return <div className="project-brief-details">
    {body.instructions && <div><h4>{t("共同工作說明", "Shared instructions")}</h4><p className="project-brief-prose">{body.instructions}</p></div>}
    {body.delivery_requirements && <div><h4>{t("交付標準", "Delivery requirements")}</h4><p className="project-brief-prose">{body.delivery_requirements}</p></div>}
    <dl className="project-brief-facts">
      <div><dt>{t("推薦專家", "Recommended specialist")}</dt><dd>{resolved.default_agent ? `${resolved.default_agent.name} · v${resolved.default_agent.version}` : t("使用預設助手或自行選擇", "Default assistant or your own selection")}</dd></div>
      <div><dt>{t("品牌版本", "Brand version")}</dt><dd>{body.brand ? `${resolved.brand?.name ?? t("已綁定品牌", "Bound brand")} · v${body.brand.version}` : t("未指定", "Not specified")}</dd></div>
      <div><dt>{t("單次工作預算上限", "Maximum task budget")}</dt><dd>{body.max_task_budget_micros === null ? t("沿用企業及方案限制", "Company and plan limits apply") : hkd(body.max_task_budget_micros)}</dd></div>
    </dl>
    {!!resolved.default_agent?.instructions && <details><summary>{t("專家方法", "Specialist method")} · v{resolved.default_agent.version}</summary><p className="project-brief-prose">{resolved.default_agent.instructions}</p></details>}
    {(resolved.resources?.length > 0 || resolved.connections?.length > 0 || resolved.default_agent?.skills?.length > 0) && <div className="project-brief-references">
      {resolved.resources?.map((r: any) => <span key={r.asset_version_id}><FileText size={14} />{r.name} · v{r.version}</span>)}
      {resolved.connections?.map((c: any) => <span key={c.id}>{c.name} · {c.account_ids.length} {t("個帳戶", "accounts")}</span>)}
      {resolved.default_agent?.skills?.map((s: any) => <span key={s.skill_version_id}>{s.skill_key} · {s.package_version}</span>)}
    </div>}
  </div>;
}

/** Current defaults are distinct from the immutable brief accepted by a task. */
export function ProjectConfigurationSummary({ taskId, compact = false }: { taskId?: string; compact?: boolean }) {
  const w = useWorkspace(), { t } = useI18n(), revision = useBriefRevision();
  const data = useData(w.project ? w.base + (taskId ? `/tasks/${taskId}/project-configuration` : "/project-configuration") : null, revision, 15000);
  const published = data.data?.published;
  if (!w.project) return null;
  if (data.error) return <div className="project-brief-unavailable" role="status">{t("未能確認專案共享設定，請重新整理後再核對。", "Project guidance could not be verified. Refresh and review it before proceeding.")}</div>;
  if (!published) return null;
  if (!published.available || !published.body) return <div className="project-brief-unavailable" role="status">{t("專案共享資料需要管理員重新確認。", "An administrator needs to review the project's shared references.")}</div>;
  return <details className={`project-brief-summary ${compact ? "compact" : ""}`} data-project-brief-version={published.version}>
    <summary><BookOpen size={16} /><span>{taskId ? t("本次工作採用", "This task uses") : t("新工作將繼承", "New work inherits")} · {published.body.name}</span><span className="project-brief-version">v{published.version}</span></summary>
    <BriefDetails body={published.body} />
    <p className="muted small-text">{t("只繼承獲准的資料與方法。檔案、帳戶、本機權限及費用仍受目前授權限制。", "Only authorized references and methods are inherited. Current file, account, local permission and billing limits still apply.")}</p>
    {taskId && published.current_version !== published.version && <p className="muted small-text">{t("專案已有較新版本；這次工作保留原版本。", "The project has a newer publication; this task keeps its original version.")}</p>}
  </details>;
}

export function ProjectConfigurationPanel() {
  const w = useWorkspace(), { t } = useI18n(), revision = useBriefRevision();
  const current = useData(w.project ? w.base + "/project-configuration" : null, revision, 15000);
  const manager = ["owner", "admin"].includes(w.me?.memberships.find((m: any) => m.id === w.tenant)?.role);
  const [editor, setEditor] = useState<{ body?: any } | null>(null), [history, setHistory] = useState(false), [notice, setNotice] = useState("");
  const published = current.data?.published;
  if (!w.project) return null;
  return <section className="project-brief-panel card" aria-label={t("專案共享設定", "Shared project guidance")}>
    <header className="project-brief-heading"><div><p className="eyebrow">{t("同一份專案，共同的工作方法", "ONE PROJECT. SHARED DIRECTION.")}</p><h2>{t("專案共享設定", "Shared project guidance")}</h2><p className="muted">{t("為這個專案保存說明、品牌、資料和交付標準。新工作會固定採用的版本。", "Keep the brief, brand, references and delivery standards together. Each new task records the version it uses.")}</p></div>
      <div className="project-brief-actions"><button className="button" disabled={current.loading} onClick={() => window.dispatchEvent(new Event("copypaste:project-configuration"))}><RefreshCw size={15} />{t("重新核對設定", "Refresh guidance")}</button><button className="button" onClick={() => setHistory(v => !v)} aria-expanded={history}><History size={15} />{t("版本記錄", "Version history")}</button>{manager && <button className="button primary" onClick={() => setEditor({})}><Pencil size={15} />{t("編輯共享設定", "Edit shared guidance")}</button>}</div></header>
    <ErrorNotice error={current.error} />
    {notice && <p role="status" className="project-brief-success"><Check size={16} />{notice}</p>}
    {current.loading && <Loading />}
    {!current.loading && !current.error && (published ? <><div className="project-brief-publication"><span className="project-brief-version">v{published.version}</span><strong>{published.body?.name ?? t("共享設定需要重新確認", "Shared guidance needs review")}</strong><DateText value={published.created_at} /></div>{published.available && published.body ? <BriefDetails body={published.body} /> : <p className="notice" role="status">{t("部分資料或方法已不可用。請更新參考項目並重新預覽發布。", "Some references or methods are unavailable. Update the selections and preview the publication again.")}</p>}</> : <div className="project-brief-empty"><BookOpen size={25} /><p>{manager ? t("先寫下這個專案的共同要求，讓每次工作都有一致的起點。", "Write this project's shared brief so every task starts with the same direction.") : t("管理員尚未發布共享設定，你仍可直接開始工作。", "An administrator has not published shared guidance yet. You can still start work directly.")}</p></div>)}
    <p className="project-brief-boundary"><ShieldCheck size={16} />{t("發布不會啟動 AI 或增加權限；私有檔案需先明確發布至專案。", "Publication starts no AI task and grants no extra access. Private files must first be explicitly published to the project.")}</p>
    {history && <VersionHistory key={"history:" + w.base} base={w.base} revision={revision} canEdit={manager} onEdit={body => setEditor({ body })} />}
    {editor && <ProjectConfigurationEditor key={"editor:" + w.base} initial={editor.body} onClose={() => setEditor(null)} onSaved={version => { setEditor(null); setNotice(t("已發布共享設定", "Shared guidance published") + ` · v${version}`); window.dispatchEvent(new Event("copypaste:project-configuration")); }} />}
  </section>;
}

function VersionHistory({ base, revision, canEdit, onEdit }: { base: string; revision: number; canEdit: boolean; onEdit: (body: any) => void }) {
  const { t } = useI18n(), [before, setBefore] = useState<number>();
  const data = useData(base + "/project-configuration/versions?limit=10" + (before ? "&before=" + before : ""), revision, 15000);
  return <div className="project-brief-history"><h3>{t("已發布版本", "Published versions")}</h3><ErrorNotice error={data.error} />{data.loading && <Loading />}
    {data.data?.items.map((v: any) => <details key={v.version}><summary><span>v{v.version} · {(v.available && v.body?.name) || t("參考資料需要重新確認", "References need review")}</span><DateText value={v.created_at} /></summary>{v.available && v.body ? <><BriefDetails body={v.body} />{canEdit && <button className="button" onClick={() => onEdit(v.body)}>{t("以此版本建立草稿", "Use this version as a draft")}</button>}</> : <p className="notice">{t("此版本的部分資料或方法已不可用，正文暫不顯示。", "Some references or methods in this version are unavailable. Its content is hidden.")}</p>}</details>)}
    {data.data?.items.length === 0 && <p className="muted">{t("尚無已發布版本。", "No published versions yet.")}</p>}
    <div className="project-brief-actions">{before && <button className="button" onClick={() => setBefore(undefined)}>{t("返回最新版本", "Back to latest")}</button>}{data.data?.next_before && <button className="button" onClick={() => setBefore(data.data.next_before)}>{t("較早版本", "Older versions")}</button>}</div>
  </div>;
}

function ProjectConfigurationEditor({ initial, onClose, onSaved }: { initial?: any; onClose: () => void; onSaved: (version: number) => void }) {
  const w = useWorkspace(), { t } = useI18n(), draft = useData(w.base + "/project-configuration/draft"), options = useData(w.base + "/project-configuration/options");
  const pending = useRef(false);
  return <Modal title={t("編輯專案共享設定", "Edit shared project guidance")} onClose={() => { if (!pending.current) onClose(); }}>
    <ErrorNotice error={draft.error ?? options.error} />
    {draft.loading || options.loading ? <Loading /> : draft.data && options.data && <BriefEditor key={w.base + ":" + draft.data.revision} base={w.base} revision={draft.data.revision} initial={initial ?? draft.data.draft ?? { name: w.projects.find(p => p.id === w.project)?.name ?? "" }} options={options.data} onSaved={onSaved} onBusy={value => { pending.current = value; }} />}
  </Modal>;
}

function SharedFileChoices({ base, initial, options, selected, onToggle }: { base: string; initial: any; options: any; selected: string[]; onToggle: (id: string, checked: boolean) => void }) {
  const { t } = useI18n(), [search, setSearch] = useState(""), [query, setQuery] = useState(""), [after, setAfter] = useState<string>();
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 200); return () => clearTimeout(timer); }, [search]);
  const filtered = !!query || !!after;
  const page = useData(filtered ? base + "/project-configuration/options?resource_query=" + encodeURIComponent(query) + (after ? "&resource_after=" + after : "") : null);
  const result = filtered ? page.data : options;
  const known = useRef(new Map<string, any>([...(initial.resolved?.resources ?? []), ...options.resources].map(r => [r.asset_version_id, r])));
  for (const resource of result?.resources ?? []) known.current.set(resource.asset_version_id, resource);
  return <fieldset className="project-brief-choices"><legend>{t("共享參考檔案", "Shared reference files")} · {selected.length}/20</legend>
    <p className="muted small-text">{t("只選取專案共享檔案的明確版本。更新檔案不會替換已選版本。", "Select exact versions of shared project files. Later file updates do not replace these selections.")}</p>
    <Field label={t("搜尋共享檔案", "Search shared files")}><input type="search" value={search} maxLength={160} onChange={e => { setSearch(e.target.value); setAfter(undefined); }} /></Field>
    {!!selected.length && <div className="project-brief-selected" aria-label={t("已選取的檔案版本", "Selected file versions")}>{selected.map(id => {
      const resource = known.current.get(id), label = resource ? `${resource.name} · v${resource.version}` : t("已儲存的檔案版本（發布時重新核對）", "Saved file version (rechecked on publication)");
      return <span key={id}>{label}<button className="button small" type="button" aria-label={t("移除 ", "Remove ") + label} onClick={() => onToggle(id, false)}>×</button></span>;
    })}</div>}
    <ErrorNotice error={filtered ? page.error : null} />{filtered && page.loading && <Loading />}
    <div className="project-brief-file-list">{result?.resources.map((r: any) => <label className="project-brief-choice" key={r.asset_version_id}><input type="checkbox" checked={selected.includes(r.asset_version_id)} disabled={!selected.includes(r.asset_version_id) && selected.length >= 20} onChange={e => onToggle(r.asset_version_id, e.target.checked)} /><span>{r.name} · v{r.version}</span></label>)}</div>
    {result?.resources.length === 0 && <p className="muted">{query ? t("找不到符合的共享檔案。", "No shared files match this search.") : t("尚無可用共享檔案。請先在雲端檔案中上傳或明確發布。", "No shared files are available. Upload or explicitly publish a file in Cloud files first.")}</p>}
    <div className="project-brief-actions">{after && <button className="button" type="button" onClick={() => setAfter(undefined)}>{t("返回第一頁", "Back to first page")}</button>}{result?.resources_next_after && <button className="button" type="button" disabled={filtered && page.loading} onClick={() => setAfter(result.resources_next_after)}>{t("更多共享檔案", "More shared files")}</button>}</div>
  </fieldset>;
}

function BriefEditor({ base, revision: initialRevision, initial, options, onSaved, onBusy }: { base: string; revision: number; initial: any; options: any; onSaved: (version: number) => void; onBusy: (value: boolean) => void }) {
  const { t } = useI18n(), [body, setBody] = useState(() => definition(initial)), [revision, setRevision] = useState(initialRevision);
  const [budget, setBudget] = useState(body.max_task_budget_micros === null ? "" : String(body.max_task_budget_micros / 1_000_000));
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(), [saved, setSaved] = useState(false), [preview, setPreview] = useState<any>();
  const keys = useRef(new Map<string, string>()), form = useRef<HTMLFormElement>(null), pending = useRef(false), review = useRef<HTMLElement>(null);
  useEffect(() => { if (preview) review.current?.focus(); }, [preview]);
  const idempotency = (payload: unknown) => { const fingerprint = JSON.stringify(payload); if (!keys.current.has(fingerprint)) keys.current.set(fingerprint, crypto.randomUUID()); return keys.current.get(fingerprint)!; };
  const change = (patch: Partial<Definition>) => { setBody(v => ({ ...v, ...patch })); setPreview(undefined); setSaved(false); setError(undefined); };
  const toggle = (field: "asset_version_ids" | "connection_ids", id: string, checked: boolean) => change({ [field]: checked ? [...body[field], id] : body[field].filter(x => x !== id) });
  const save = async (review: boolean) => {
    if (pending.current || !form.current?.reportValidity()) return;
    pending.current = true; onBusy(true); setBusy(true); setError(undefined);
    try {
      let micros: number | null = null;
      if (budget.trim()) {
        if (!/^\d{1,5}(\.\d{1,6})?$/.test(budget)) throw new Error(t("請輸入正數港幣預算，最多六位小數。", "Enter a positive HKD limit with up to six decimal places."));
        const [whole, fraction = ""] = budget.split("."); micros = Number(BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0")));
        if (micros <= 0 || micros > 10_000_000_000) throw new Error(t("預算上限須為 HK$0.000001–10,000。", "The limit must be HK$0.000001–10,000."));
      }
      const payload = { expected_revision: revision, definition: { ...body, max_task_budget_micros: micros } };
      const result = await api(base + "/project-configuration/draft", { method: "PUT", headers: { "Idempotency-Key": idempotency(payload) }, body: JSON.stringify(payload) });
      setRevision(result.revision); setSaved(true); setPreview(undefined);
      if (review) setPreview(await post(base + "/project-configuration/preview", { expected_revision: result.revision }));
    } catch (e) { setError(e); } finally { pending.current = false; onBusy(false); setBusy(false); }
  };
  const publish = async () => {
    if (!preview || pending.current) return; pending.current = true; onBusy(true); setBusy(true); setError(undefined);
    try {
      const payload = { expected_revision: preview.revision, draft_sha256: preview.draft_sha256 };
      const result = await post(base + "/project-configuration/publish", payload, idempotency(payload));
      onSaved(result.current_version);
    } catch (e) { setError(e); } finally { pending.current = false; onBusy(false); setBusy(false); }
  };
  const versionOptions = (items: any[], value: VersionRef | null, oldName: string | undefined) => <>
    <option value="">{t("不指定", "Not specified")}</option>
    {value && !items.some(v => v.id === value.id && v.version === value.version) && <option value={versionValue(value)}>{oldName ?? t("已儲存的選擇", "Saved selection")} · v{value.version}</option>}
    {items.map(v => <option key={versionValue(v)} value={versionValue(v)}>{v.name} · v{v.version}</option>)}
  </>;
  const connections = [...options.connections];
  for (const id of body.connection_ids) if (!connections.some(c => c.id === id)) connections.push(initial.resolved?.connections?.find((c: any) => c.id === id) ?? { id, name: t("需要重新確認的連接", "Connection needs review") });
  return <form ref={form} className="project-brief-editor" onSubmit={e => { e.preventDefault(); if (!preview) void save(true); }}>
    <ErrorNotice error={error} />
    <fieldset className={preview ? "project-brief-form-hidden" : undefined} disabled={busy || !!preview}>
      <Field label={t("共享設定名稱", "Guidance name")}><input required maxLength={160} value={body.name} onChange={e => change({ name: e.target.value })} /></Field>
      <Field label={t("共同工作說明", "Shared instructions")} hint={t("例如：使用香港繁體中文，所有報價必須引用已確認資料。", "For example: use Hong Kong Traditional Chinese and cite approved sources for every price.")}><textarea rows={4} maxLength={8000} value={body.instructions} onChange={e => change({ instructions: e.target.value })} /></Field>
      <Field label={t("交付標準", "Delivery requirements")}><textarea rows={3} maxLength={4000} value={body.delivery_requirements} onChange={e => change({ delivery_requirements: e.target.value })} /></Field>
      <div className="project-brief-form-pair">
        <Field label={t("推薦專家與方法版本", "Recommended specialist and method version")}><select value={versionValue(body.default_agent)} onChange={e => change({ default_agent: versionRef(e.target.value) })}>{versionOptions(options.agents, body.default_agent, initial.resolved?.default_agent?.name)}</select></Field>
        <Field label={t("品牌版本", "Brand version")}><select value={versionValue(body.brand)} onChange={e => change({ brand: versionRef(e.target.value) })}>{versionOptions(options.brands, body.brand, initial.resolved?.brand?.name)}</select></Field>
      </div>
      <SharedFileChoices base={base} initial={initial} options={options} selected={body.asset_version_ids} onToggle={(id, checked) => toggle("asset_version_ids", id, checked)} />
      <fieldset className="project-brief-choices"><legend>{t("連接資源", "Connected resources")} · {body.connection_ids.length}/12</legend>
        {connections.map(c => <label className="project-brief-choice" key={c.id}><input type="checkbox" checked={body.connection_ids.includes(c.id)} disabled={!body.connection_ids.includes(c.id) && body.connection_ids.length >= 12} onChange={e => toggle("connection_ids", c.id, e.target.checked)} /><span>{c.name}</span></label>)}
        {!connections.length && <p className="muted">{t("尚無已授權至此專案的連接；可先保存其他設定。", "No authorized connections are assigned to this project. You can save the other guidance now.")}</p>}
      </fieldset>
      <Field label={t("單次工作預算上限（HKD，可留空）", "Maximum task budget (HKD, optional)")} hint={t("這是上限，不是預付款。仍會套用企業、方案及個人可用額度。", "This is a limit, not a payment. Company, plan and available account limits still apply.")}><input type="number" min="0.000001" max="10000" step="0.000001" value={budget} onChange={e => { setBudget(e.target.value); setPreview(undefined); setSaved(false); }} /></Field>
      <div className="project-brief-actions"><button className="button" type="button" onClick={() => void save(false)}>{t("儲存草稿", "Save draft")}</button><button className="button primary" type="submit">{busy ? t("正在核對…", "Reviewing…") : t("預覽發布", "Preview publication")}</button></div>
    </fieldset>
    {saved && !preview && <p role="status" className="muted">{t("草稿已儲存，尚未發布。", "Draft saved. It has not been published.")}</p>}
    {preview && <section ref={review} tabIndex={-1} className="project-brief-preview" aria-label={t("發布預覽", "Publication preview")}><p className="eyebrow">{t("核對後再發布", "REVIEW BEFORE PUBLICATION")}</p><h3>{preview.current ? `v${preview.current.version} → v${preview.proposed_version}` : t("首次發布", "First publication") + ` · v${preview.proposed_version}`}</h3>
      <div className="project-brief-comparison">{preview.current && <details><summary>{t("目前已發布的內容", "Currently published guidance")} · v{preview.current.version}</summary>{preview.current.body ? <BriefDetails body={preview.current.body} /> : <p role="status">{t("舊版本的參考資料需要重新確認，暫不顯示正文。", "The old publication's references need review, so its body is unavailable.")}</p>}</details>}<div><h4>{t("準備發布的內容", "Proposed guidance")}</h4><BriefDetails body={preview.body} /></div></div>
      <p className="muted small-text">{t("新工作使用新版本；既有工作保留原版本。發布前會再次核對資料、方法及連接授權。", "New tasks use the new publication; accepted tasks keep their version. References, methods and connection permissions are checked again before publication.")}</p>
      <div className="project-brief-actions"><button className="button" type="button" disabled={busy} onClick={() => setPreview(undefined)}>{t("返回編輯", "Back to editing")}</button><button className="button primary" type="button" disabled={busy} onClick={() => void publish()}><Check size={16} />{t("確認發布", "Confirm publication")} · v{preview.proposed_version}</button></div>
    </section>}
  </form>;
}
