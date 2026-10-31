import { useNavigate, Link } from "react-router-dom";
import { ScopeErasureDialog, type ErasureTarget } from "./scope-erasure-dialog";
import { ScopeExportDialog, type ScopeExportTarget } from "./scope-export-dialog";
import "./scope-erasure.css";
import { useEffect, useRef, useState } from "react";
import { Archive, ArrowUpRight, Check, FolderOpen, Pencil, Plus, RotateCcw } from "lucide-react";
import { api, post, clientSessionGeneration } from "./api";
import { completeOperation, operationKey } from "./operation-key";
import { useWorkspace } from "./context";
import { ProjectConfigurationPanel } from "./project-configuration";
import { AsyncForm, DateText, Empty, ErrorNotice, Field, Loading, Modal, PageHeader, useData, useI18n } from "./ui";
import "./project-management.css";

type Project = { id: string; name: string; description: string; archived: boolean; created_at: string };
type Action = { kind: "create" } | { kind: "edit" | "archive" | "restore"; project: Project };

export function ProjectManagement() {
  const { t } = useI18n(), w = useWorkspace(), navigate = useNavigate();
  const [erasure, setErasure] = useState<ErasureTarget | null>(null);
  const [exportTarget, setExportTarget] = useState<ScopeExportTarget | null>(null);
  useEffect(() => { setExportTarget(null); }, [w.tenant]);
  const owner = w.me?.memberships.find((m:any) => m.id === w.tenant)?.role === "owner";
  const manager = ["owner", "admin"].includes(w.me?.memberships.find((m: any) => m.id === w.tenant)?.role);
  const [state, setState] = useState("active"), [search, setSearch] = useState(""), [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0), [action, setAction] = useState<Action | null>(null), [notice, setNotice] = useState("");
  const live = useRef(true), currentAction = useRef(action);
  currentAction.current = action;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const root = `/v1/tenants/${w.tenant}`;
  const directory = useData<{ items: Project[]; total: number }>(manager
    ? `${root}/project-directory?state=${state}&search=${encodeURIComponent(search)}&page=${page}&page_size=12` : null, revision);
  const projects: Project[] = manager ? directory.data?.items ?? [] : w.projects;

  async function submit(form: FormData, chosen: Action) {
    const body = chosen.kind === "create" ? { name: String(form.get("name")), description: String(form.get("description")) }
      : chosen.kind === "edit" ? { name: String(form.get("name")), description: String(form.get("description")), expected_name: chosen.project.name, expected_description: chosen.project.description, expected_archived: chosen.project.archived }
      : { archived: chosen.kind === "archive", expected_archived: chosen.project.archived };
    const endpoint = chosen.kind === "create" ? root + "/projects" : root + "/projects/" + chosen.project.id;
    const session = clientSessionGeneration();
    const attempt = await operationKey(w.me.user.id, endpoint, body);
    if (!live.current || currentAction.current !== chosen || session !== clientSessionGeneration()) return;
    const result = chosen.kind === "create" ? await post(endpoint, body, attempt)
      : await api<Project>(endpoint, { method: "PATCH", headers: { "Idempotency-Key": attempt }, body: JSON.stringify(body) });
    await completeOperation(w.me.user.id, endpoint, body);
    if (!live.current) return;
    if (currentAction.current === chosen) setAction(null);
    setNotice(t("專案已更新。", "Project updated."));
    setPage(1);
    setState(result.archived ? "archived" : "active");
    setRevision(v => v + 1);
    await w.reloadProjects((chosen.kind === "create" || chosen.kind === "restore") && !result.archived ? result.id : undefined);
  }

  return <>
    <PageHeader eyebrow="SPACE FOR THE WORK." title={t("專案", "Projects")}
      description={t("管理專案資料、存取權與封存；保留工作原本的歸屬。", "Manage project details and availability while keeping work in its original home.")}
      action={manager ? <button className="button primary" onClick={() => setAction({ kind: "create" })}><Plus size={17} />{t("新增專案", "New project")}</button> : undefined} />
    {notice && <p className="notice" role="status">{notice}</p>}
    {manager && <div className="project-management-controls" aria-label={t("專案清單篩選", "Project list filters")}>
      <Field label={t("顯示專案", "Project status")}><select value={state} onChange={e => { setState(e.target.value); setPage(1); }}>
        <option value="active">{t("使用中", "Active")}</option><option value="archived">{t("已封存", "Archived")}</option><option value="all">{t("全部專案", "All projects")}</option>
      </select></Field>
      <Field label={t("搜尋專案", "Search projects")}><input type="search" maxLength={160} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></Field>
    </div>}
    <ErrorNotice error={directory.error} />
    {manager && directory.loading && <Loading />}
    <div className="project-grid project-management-grid">
      {projects.map(p => <article className="card project-card" key={p.id} data-project-id={p.id}>
        <FolderOpen size={25} strokeWidth={1.5} /><h2>{p.name}</h2>
        {p.archived && <span className="project-archive-label">{t("已封存", "Archived")}</span>}
        <p className="muted">{p.description || t("讓下一個想法在這裡成形。", "A space for your next idea to take shape.")}</p>
        <footer><DateText value={p.created_at} /><div className="project-management-actions">
          {!p.archived && <button className="text-button" aria-label={t("選用專案：", "Select project: ") + p.name} onClick={() => w.setProject(p.id)}>
            {p.id === w.project ? <Check size={18} /> : <ArrowUpRight size={18} />}{t("選用", "Select")}
          </button>}
          {!p.archived && <button className="text-button" onClick={() => setExportTarget({ endpoint: root + "/projects/" + p.id + "/export", id: p.id, tenant: w.tenant })}>{t("匯出資料", "Export data")}</button>}
          {manager && <><button className="text-button" onClick={() => setAction({ kind: "edit", project: p })}><Pencil size={15} />{t("編輯", "Edit")}</button>
            <button className="text-button" onClick={() => setAction({ kind: p.archived ? "restore" : "archive", project: p })}>
              {p.archived ? <RotateCcw size={15} /> : <Archive size={15} />}{p.archived ? t("恢復", "Restore") : t("封存", "Archive")}
            </button><button className="text-button" onClick={() => setErasure({kind:"projects", id:p.id, endpoint:root+"/projects/"+p.id+"/erasure"})}>{t("永久刪除", "Permanently delete")}</button></>}
        </div></footer>
      </article>)}
    </div>
    {(!manager || directory.data) && !projects.length && <Empty title={state === "archived" ? t("沒有封存專案", "No archived projects") : t("沒有符合的專案", "No matching projects")}
      body={manager ? t("可以建立新專案，或切換清單來恢復已封存的專案。", "Create a project or change the filter to restore an archived one.") : t("請聯絡企業所有者安排專案存取權。", "Ask your workspace owner for project access.")} />}
    {manager && directory.data && <nav className="project-management-pagination" aria-label={t("專案分頁", "Project pages")}>
      <span>{t("共", "Total")} {directory.data.total} · {t("頁", "Page")} {page}</span>
      <button className="button secondary" disabled={page === 1 || directory.loading} onClick={() => setPage(v => v - 1)}>{t("上一頁", "Previous")}</button>
      <button className="button secondary" disabled={page * 12 >= directory.data.total || directory.loading} onClick={() => setPage(v => v + 1)}>{t("下一頁", "Next")}</button>
    </nav>}
    {w.base && <ProjectConfigurationPanel key={w.base} />}
    {manager && <section className="card"><h2>{t("企業資料匯出", "Workspace data export")}</h2><p>{t("打包所有使用中專案的共享資料及你自己的私人資料。先預覽實際範圍，再下載可核對的原始版本。", "Package readable shared materials and your private data across active projects. Review the exact scope before downloading verified original versions.")}</p><button className="button secondary" onClick={() => setExportTarget({ endpoint: root + "/export", id: w.tenant, tenant: w.tenant })}>{t("預覽企業匯出", "Preview workspace export")}</button></section>}
    {exportTarget && <ScopeExportDialog key={exportTarget.endpoint} target={exportTarget} account={w.me.user.id} onClose={() => setExportTarget(null)} />}
    <section className="card scope-danger-zone"><p>{t("永久清理整個範圍的內容與歷史版本，確認前可查看影響範圍。", "Permanently remove content and historical versions across a scope. Review its impact before confirming.")}</p><Link className="button secondary" to="/cleanup">{t("清理記錄", "Cleanup records")}</Link>{owner && <button className="button secondary" onClick={() => setErasure({kind:"tenants",id:w.tenant,endpoint:root+"/erasure"})}>{t("永久刪除工作空間", "Permanently delete workspace")}</button>}</section>
    {erasure && <ScopeErasureDialog key={erasure.endpoint} target={erasure} account={w.me.user.id} onClose={() => setErasure(null)} onAccepted={() => {setErasure(null); navigate("/cleanup"); void w.refresh();}} />}
    {action && <Modal title={action.kind === "create" ? t("建立新專案", "Create a project") : action.kind === "edit" ? t("編輯專案", "Edit project") : action.kind === "archive" ? t("封存專案", "Archive project") : t("恢復專案", "Restore project")} onClose={() => setAction(null)}>
      <AsyncForm key={action.kind + ("project" in action ? action.project.id : "")} submitLabel={action.kind === "create" ? t("建立專案", "Create project") : action.kind === "edit" ? t("儲存變更", "Save changes") : action.kind === "archive" ? t("確認封存", "Confirm archive") : t("確認恢復", "Confirm restore")}
        onSubmit={form => submit(form, action)}>
        {action.kind === "create" || action.kind === "edit" ? <>
          <Field label={t("專案名稱", "Project name")}><input name="name" maxLength={160} required defaultValue={action.kind === "edit" ? action.project.name : ""} /></Field>
          <Field label={t("簡介", "Description")}><textarea name="description" maxLength={2000} rows={3} defaultValue={action.kind === "edit" ? action.project.description : ""} /></Field>
        </> : <>
          <p><strong>{action.project.name}</strong></p>
          <p>{action.kind === "archive" ? t("封存期間，成員不能使用此專案的工作與資料。需要結束的工作請先取消。你可以稍後從封存清單恢復專案。", "Members cannot use this project's work or materials while archived. Cancel any work you need to end first. You can restore the project from the archived list later.")
            : t("專案會重新開放，保留現有資料與成員權限。先前已撤銷的存取權不會重新授予。", "The project becomes available with its existing materials and member permissions. Revoked access stays revoked.")}</p>
          <label className="checkbox-row"><input type="checkbox" required /><span>{t("我確認此專案變更", "I confirm this project change")}</span></label>
        </>}
      </AsyncForm>
    </Modal>}
  </>;
}
