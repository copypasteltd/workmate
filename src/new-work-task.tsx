import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, Check, FileText, RotateCcw } from "lucide-react";
import { api, ApiError } from "./api";
import { useWorkspace } from "./context";
import { ErrorNotice, Field, Loading, Modal, useData, useI18n } from "./ui";
import { ModeField } from "./persistent-work";
import { ProjectConfigurationSummary } from "./project-configuration";
import { roleEnglish } from "./role-templates";
import {WorkRoleGuide} from "./work-role-guide";
import {WorkComposer} from "./work-composer";
import {workInputDependencies} from "./work-attachments";
import { VideoBriefFields, videoGenerationBrief } from "./video-brief";
import { acceptWorkSubmission, newWorkDraft, openWorkDraft, prepareWorkSubmission, rejectWorkSubmission, removedWorkSubmission,
  saveWorkDraft, updateWorkDraft, updateWorkAttachments, durableWorkSubmission, assertWorkScope, type WorkDraft, type WorkSeed, type WorkValues } from "./work-draft";
import "./new-work-task.css";

export function NewWorkTask({ onClose, role, seed }: { onClose: () => void; role?: string; seed?: WorkSeed }) {
  const w=useWorkspace();
  return <ScopedNewWorkTask key={[w.me.user.id,w.tenant,w.project].join(":")} onClose={onClose} role={role} seed={seed}/>;
}
function ScopedNewWorkTask({ onClose, role, seed }: { onClose: () => void; role?: string; seed?: WorkSeed }) {
  const w = useWorkspace(), { t, locale } = useI18n(), nav = useNavigate();
  const scope = { user: String(w.me.user.id), tenant: w.tenant, project: w.project };
  const [initial] = useState(() => { try { return { draft: openWorkDraft(scope, seed ?? (role ? { role } : {})), error: null }; }
    catch (error) { return { draft: null, error: error as Error }; } });
  const [draft, setDraft] = useState<WorkDraft | null>(initial.draft), [error, setError] = useState<Error | null>(initial.error);
  const [busy, setBusy] = useState(false), [persistent, setPersistent] = useState(() => initial.draft ? saveWorkDraft(initial.draft) : true);
  const [uploadsReady,setUploadsReady]=useState(true),[rolesRefresh,setRolesRefresh]=useState(0),readyRef=useRef(true),draftRef=useRef(initial.draft);draftRef.current=draft;
  const [online, setOnline] = useState(navigator.onLine);
  const live = useRef(true), lock = useRef(false), currentScope = useRef(scope);
  currentScope.current = scope;
  const { data, error: rolesError, loading } = useData("/v1/catalog/roles",rolesRefresh);
  const defaultRole=useData(draft?.values.role==="assistant"?"/v1/catalog/default-assistant":null,rolesRefresh);
  const selectedRole=draft?.values.role==="assistant"?defaultRole.data:data?.items.find((row:any)=>row.role_key===draft?.values.role);
  useEffect(() => { live.current = true; const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { live.current = false; window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  function store(next: WorkDraft) { draftRef.current=next;setPersistent(saveWorkDraft(next)); setDraft(next); }
  function change(changes: Partial<WorkValues>) {
    const current=draftRef.current;
    if (!current || lock.current || current.pending || current.accepted || current.removed) return;
    store(updateWorkDraft(current, changes)); setError(null);
  }
  async function submit() {
    const draft=draftRef.current;
    if (lock.current || !draft || draft.accepted || draft.removed || !online || !readyRef.current || draft.values.role === "computer-operator" || (!draft.pending&&selectedRole?.available!==true)) return;
    lock.current = true; setBusy(true); setError(null);
    let submitted = draft;
    const origin = { ...scope };
    try {
      assertWorkScope(submitted,origin);
      if (!submitted.pending) {
        const v = submitted.values, amount = Math.round(Number(v.budget) * 1000000);
        if (!Number.isSafeInteger(amount) || amount < 1000000 || amount > 10000000000) throw new Error("WORK_BUDGET_INVALID");
        const form = new FormData();
        for (const [key, value] of Object.entries(v)) form.set(key, value);
        const dependencies=workInputDependencies(submitted.attachments??[],v.required_input,
          t("使用本次明確選取的素材；未選取時請先提供獲准檔案。","Use the explicitly selected materials; provide authorized files first when none are selected."),
          t("請選取此工作的獲准連接。","Select the authorized connection for this work."));
        const body = { title: v.title.trim() || v.prompt.trim().replace(/\s+/g," ").slice(0,80), prompt: v.role === "video-motion" ? videoGenerationBrief(v.prompt, form) : v.prompt,
          mode: v.mode, budget_micros: amount,
          ...(v.role !== "assistant" ? { role_key: v.role } : {}),
          ...(dependencies.length?{dependencies}:{}) };
        submitted = await prepareWorkSubmission(submitted, body);
        if (live.current) store(submitted);
      }
      if (!live.current || currentScope.current.user !== origin.user || currentScope.current.tenant !== origin.tenant || currentScope.current.project !== origin.project) return;
      assertWorkScope(submitted,currentScope.current);
      submitted=durableWorkSubmission(submitted);
      const request = submitted.pending!;
      const result = await api(request.endpoint, { method: "POST", headers: { "Idempotency-Key": request.key }, body: JSON.stringify(request.body) });
      const destination = submitted.values.role === "assistant" ? "/app/conversations/" + result.conversation?.id : "/app/tasks/" + result.id;
      const accepted = acceptWorkSubmission(submitted, destination);
      if (live.current && currentScope.current.user === origin.user && currentScope.current.tenant === origin.tenant && currentScope.current.project === origin.project) {
        store(accepted); onClose(); nav(destination);
      }
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "SESSION_CHANGED") return;
      if (failure instanceof ApiError && failure.code === "REQUEST_RESULT_REMOVED" && failure.status === 410) {
        submitted = removedWorkSubmission(submitted);
      }
      // A definite validation/permission rejection can be edited. Network/5xx,
      // session changes and removed results retain the original attempt.
      const rejected = failure instanceof ApiError && failure.status >= 400 && failure.status < 500
        && ![401, 408, 425, 429].includes(failure.status)
        && !["SESSION_CHANGED", "IDEMPOTENCY_CONFLICT", "REQUEST_RESULT_REMOVED"].includes(failure.code);
      if (rejected && submitted.pending) submitted = rejectWorkSubmission(submitted);
      if (live.current) { store(submitted); setError(failure instanceof Error&&failure.message==="WORK_STORAGE_REQUIRED"
        ?new Error(t("瀏覽器未能安全保存原提交，本次沒有發送或重試。請允許此網站使用儲存空間後再繼續；已有工作的費用請到用量查看。","The browser could not safely retain the original request, so this attempt was not sent or retried. Allow site storage before continuing; review existing work charges under Usage.")):failure as Error); }
    } finally { lock.current = false; if (live.current) setBusy(false); }
  }
  const v = draft?.values, pending = !!draft?.pending;
  return <Modal title={t("開始一項新工作", "Start something new")} size="wide" onClose={onClose}>
    <div className="work-draft-status" role="status"><FileText size={16}/><span>{persistent
      ? t("草稿保存在此分頁；登出會清除正文。", "Draft saved in this tab. Signing out clears its text.")
      : t("草稿目前只在此頁；提交前需允許網站安全保存原請求。", "This draft is only in this page. Allow site storage before submitting the original request.")}</span></div>
    {!online && <p className="notice" role="status">{t("目前離線。草稿已保留，連線後再提交。", "You are offline. Your draft is retained; reconnect before submitting.")}</p>}
    <ErrorNotice error={error}/>
    {!draft && <Link className="button secondary" to="/app" onClick={onClose}>{t("查看已提交工作", "View submitted work")}</Link>}
    {draft?.removed && <section className="work-submission-receipt"><h3>{t("原提交記錄已移除", "The original submission record was removed")}</h3>
      <p>{t("原請求不會重新執行。你可以先查看工作和用量，再明確開始另一項工作；這不代表原工作沒有費用。", "The original request will not run again. Review your work and usage before starting another task. This does not mean the original work had no cost.")}</p>
      <Link className="button secondary" to="/app/usage" onClick={onClose}>{t("查看用量", "View usage")}</Link>
      <button className="button primary" onClick={() => store(newWorkDraft(scope))}>{t("開始另一項工作", "Start another task")}</button></section>}
    {draft?.accepted && <section className="work-submission-receipt"><Check size={22}/><h3>{t("原工作已提交", "Your original work was submitted")}</h3>
      <p>{t("可以繼續查看原工作，或明確開始另一項工作。", "Continue with the original work or start another task.")}</p>
      <Link className="button primary" to={draft.accepted} onClick={onClose}>{t("查看原工作", "Open original work")}<ArrowUpRight size={16}/></Link>
      <button className="button secondary" onClick={() => store(newWorkDraft(scope))}>{t("開始另一項工作", "Start another task")}</button></section>}
    {draft && v && !draft.accepted && !draft.removed && <>
      {pending && <p className="notice work-submission-pending" role="status">{t(
        "上一份提交的結果尚未確認。重試會核對同一份內容，不會另建一項工作。你也可以先查看最近的工作。",
        "The previous submission is unconfirmed. Retry checks the same request and does not create a second task. You can also check your recent work.")}
        <Link to="/app" onClick={onClose}>{t("查看最近工作", "View recent work")}</Link></p>}
      <ProjectConfigurationSummary compact/>
      <form className="form-stack work-intake" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <fieldset disabled={busy || pending}>
          <div className="work-intake-prompt"><p>{t("你想完成什麼？", "What would you like to make?")}</p><p className="muted small-text">{t("附加檔案會上傳到目前專案，依專案權限供成員使用。未按開始前不會調用模型。","Attachments upload to the current project for its authorized members. No model runs before you start.")}</p><WorkComposer value={v.prompt} onChange={prompt=>change({prompt})} attachments={draft.attachments??[]}
            disabled={busy||pending} label={t("你想完成什麼？", "What would you like to make?")} currentVersionsOnly sharedSourcesOnly
            onReady={ready=>{readyRef.current=ready;setUploadsReady(ready);}}
            onAttachments={items=>{const current=draftRef.current;if(current&&!lock.current&&!current.pending)store(updateWorkAttachments(current,items));}}
            placeholder={t("說明目標、對象與交付格式。可拖入檔案、貼上圖片或用 @ 引用素材…", "Describe your goal, audience and deliverables. Drop files, paste images or use @ to reference materials…")}/></div>
          <WorkRoleGuide key={w.tenant+w.project+v.role} role={v.role} disabled={busy||pending} onExample={prompt=>change({prompt})} onExplore={onClose}/>
          <details className="work-intake-options"><summary>{t("角色、預算與更多設定", "Specialist, budget and more settings")} · HK$ {v.budget}</summary>
          <Field label={t("專案", "Project")}><input value={w.projects.find(p => p.id === w.project)?.name ?? ""} readOnly/></Field>
          <Field label={t("專業角色", "Specialist")}><select name="role" value={v.role} onChange={e => change({ role: e.target.value, required_input: "" })}>
            <option value="assistant">{t("預設助手 — 答覆、計畫與文字交付", "Default assistant — answers, plans and text deliverables")}</option>
            {data?.items.filter((row: any) => !window.copyPasteBridge || row.role_key !== "computer-operator").map((row: any) => <option key={row.role_key} value={row.role_key}>{locale === "en" ? roleEnglish[row.role_key] ?? row.display_name : row.display_name}</option>)}
            {window.copyPasteBridge && v.role === "computer-operator" && <option value={v.role}>{roleEnglish[v.role]}</option>}
            {!(window.copyPasteBridge && v.role === "computer-operator") && !data?.items.some((row: any) => row.role_key === v.role) && v.role !== "assistant" && <option value={v.role}>{roleEnglish[v.role] ?? v.role}</option>}
          </select></Field>
          <ErrorNotice error={rolesError??defaultRole.error}/>{loading && !data && <Loading/>}
          {(!selectedRole||selectedRole.available!==true)&&!pending&&<p className="notice" role="status">{selectedRole?t("此角色的服務依賴未就緒，請先查看角色需求或另選角色。","This specialist's service dependencies are not ready. Review its requirements or choose another specialist."):t("正在核對角色服務…","Checking specialist services…")}<button type="button" className="text-button" onClick={()=>setRolesRefresh(n=>n+1)}>{t("重新核對","Check again")}</button></p>}
          {v.role === "computer-operator" && (window.copyPasteBridge ? <p className="notice" role="status">{t(
            "這份草稿使用雲端電腦角色，請在 Web 工作台繼續。你也可以另選角色並重新核對工作。",
            "This draft uses a cloud computer role. Continue it in the web workspace, or choose another role and review the work.")}
            <button className="button quiet" type="button" onClick={() => change({ role: "assistant", required_input: "" })}>{t("另選助手角色", "Choose assistant role")}</button></p> : <p className="notice" role="status">{t(
            "先選擇一台已確認費用及操作權限的雲端電腦，再單獨確認 Codex 任務與 AI 預算。",
            "Choose a cloud computer with confirmed cost and control permissions, then approve the Codex task and its separate AI budget.")}
            <Link to="/app/computers" onClick={onClose}>{t("選擇雲端電腦", "Choose a cloud computer")}</Link></p>)}
          <ModeField value={v.mode} onChange={mode => change({ mode })}/>
          <Field label={t("工作名稱", "Task name")}><input name="title" value={v.title} onChange={e => change({ title: e.target.value })} maxLength={160}
            placeholder={t("例如：秋季新品推廣海報", "e.g. Autumn launch campaign")}/></Field>
          {v.role === "video-motion" && <div onChange={event => { const field = event.target;
            if (field instanceof HTMLSelectElement && ["video_mode", "video_seconds", "video_size"].includes(field.name)) change({ [field.name]: field.value }); }}>
            <VideoBriefFields defaults={v}/></div>}
          <Field label={t("開始前需要補齊資料嗎？", "Inputs needed before starting?")} hint={t("先保存同一項工作並預留預算，補齊資料前不呼叫模型。", "Save the same task and reserve its budget; the model waits for these inputs.")}>
            <select name="required_input" value={v.required_input} onChange={e => change({ required_input: e.target.value })}>
              <option value="">{t("資料已齊，可開始", "Ready to start")}</option><option value="file">{t("先等我提供檔案", "Wait for my file")}</option>
              {data?.items.find((row: any) => row.role_key === v.role)?.tool_ids.includes("connector.read") && [["google_ads", "Google Ads"], ["ga4", "Google Analytics"], ["search_console", "Search Console"], ["meta", "Meta"]].map(([key, label]) => <option value={key} key={key}>{t("先選取連接：", "Choose connection first: ")}{label}</option>)}
            </select></Field>
          <Field label={t("本次工作預算上限（HKD）", "Task budget limit (HKD)")} hint={t("提交時預留，依實際用量結算；等待資料期間保持預留。", "Reserved on submission and settled against measured usage; retained while waiting for inputs.")}>
            <input name="budget" type="number" min="1" max="10000" step="0.01" value={v.budget} onChange={e => change({ budget: e.target.value })} required/></Field>
          </details>
        </fieldset>
        <p className="muted small-text">{t("在公司雲端執行。只有按下開始後才建立工作及預留預算；已上傳素材依專案權限保存。","Runs in the company cloud. Start creates the task and budget reservation; uploaded materials are retained under project permissions.")}</p>
        <button className="button primary" type="submit" disabled={busy || !online || !uploadsReady || (!pending&&selectedRole?.available!==true) || v.role === "computer-operator"}>{busy ? t("正在核對提交…", "Checking submission…") : pending ? t("重試原提交", "Retry original submission") : t(`開始工作 · 上限 HK$${v.budget}`, `Start task · up to HK$${v.budget}`)}<ArrowUpRight size={16}/></button>
        {!pending && <button className="text-button work-draft-reset" type="button" disabled={busy} onClick={() => store(newWorkDraft(scope))}><RotateCcw size={15}/>{t("清除這份草稿", "Clear this draft")}</button>}
      </form>
    </>}
  </Modal>;
}
