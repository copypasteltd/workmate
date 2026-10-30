import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, Check, FileText, RotateCcw } from "lucide-react";
import { api, ApiError } from "./api";
import { useWorkspace } from "./context";
import { ErrorNotice, Field, Loading, Modal, useData, useI18n } from "./ui";
import { ModeField } from "./persistent-work";
import { ProjectConfigurationSummary } from "./project-configuration";
import { roleEnglish } from "./role-templates";
import { VideoBriefFields, videoGenerationBrief } from "./video-brief";
import { acceptWorkSubmission, newWorkDraft, openWorkDraft, prepareWorkSubmission, rejectWorkSubmission, removedWorkSubmission,
  saveWorkDraft, updateWorkDraft, type WorkDraft, type WorkSeed, type WorkValues } from "./work-draft";
import "./new-work-task.css";

export function NewWorkTask({ onClose, role, seed }: { onClose: () => void; role?: string; seed?: WorkSeed }) {
  const w = useWorkspace(), { t, locale } = useI18n(), nav = useNavigate();
  const scope = { user: String(w.me.user.id), tenant: w.tenant, project: w.project };
  const [initial] = useState(() => { try { return { draft: openWorkDraft(scope, seed ?? (role ? { role } : {})), error: null }; }
    catch (error) { return { draft: null, error: error as Error }; } });
  const [draft, setDraft] = useState<WorkDraft | null>(initial.draft), [error, setError] = useState<Error | null>(initial.error);
  const [busy, setBusy] = useState(false), [persistent, setPersistent] = useState(() => initial.draft ? saveWorkDraft(initial.draft) : true);
  const [online, setOnline] = useState(navigator.onLine);
  const live = useRef(true), lock = useRef(false), currentScope = useRef(scope);
  currentScope.current = scope;
  const { data, error: rolesError, loading } = useData("/v1/catalog/roles");
  useEffect(() => { live.current = true; const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { live.current = false; window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  function store(next: WorkDraft) { setPersistent(saveWorkDraft(next)); setDraft(next); }
  function change(changes: Partial<WorkValues>) {
    if (!draft || busy || draft.pending || draft.accepted || draft.removed) return;
    store(updateWorkDraft(draft, changes)); setError(null);
  }
  async function submit() {
    if (lock.current || !draft || draft.accepted || draft.removed || !online || draft.values.role === "computer-operator") return;
    lock.current = true; setBusy(true); setError(null);
    let submitted = draft;
    const origin = { ...scope };
    try {
      if (!submitted.pending) {
        const v = submitted.values, amount = Math.round(Number(v.budget) * 1000000);
        if (!Number.isSafeInteger(amount) || amount < 1000000 || amount > 10000000000) throw new Error("WORK_BUDGET_INVALID");
        const form = new FormData();
        for (const [key, value] of Object.entries(v)) form.set(key, value);
        const body = { title: v.title.trim(), prompt: v.role === "video-motion" ? videoGenerationBrief(v.prompt, form) : v.prompt,
          mode: v.mode, budget_micros: amount,
          ...(v.role !== "assistant" ? { role_key: v.role } : {}),
          ...(v.required_input ? { dependencies: [v.required_input === "file"
            ? { kind: "file", description: t("請提供已批准的工作素材，然後開始。", "Provide approved source materials before starting.") }
            : { kind: "connection", provider: v.required_input, description: t("請選取此工作的獲准連接。", "Select the authorized connection for this work.") }] } : {}) };
        submitted = await prepareWorkSubmission(submitted, body);
        if (live.current) store(submitted);
      }
      if (!live.current || currentScope.current.user !== origin.user || currentScope.current.tenant !== origin.tenant || currentScope.current.project !== origin.project) return;
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
      if (live.current) { store(submitted); setError(failure as Error); }
    } finally { lock.current = false; if (live.current) setBusy(false); }
  }
  const v = draft?.values, pending = !!draft?.pending;
  return <Modal title={t("開始一項新工作", "Start something new")} onClose={onClose}>
    <div className="work-draft-status" role="status"><FileText size={16}/><span>{persistent
      ? t("草稿保存在此分頁；登出會清除正文。", "Draft saved in this tab. Signing out clears its text.")
      : t("此瀏覽器不允許保存；重新整理可能遺失草稿。", "This browser cannot save drafts. Reloading may lose this draft.")}</span></div>
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
          <Field label={t("專案", "Project")}><input value={w.projects.find(p => p.id === w.project)?.name ?? ""} readOnly/></Field>
          <Field label={t("專業角色", "Specialist")}><select name="role" value={v.role} onChange={e => change({ role: e.target.value, required_input: "" })}>
            <option value="assistant">{t("預設助手 — 答覆、計畫與文字交付", "Default assistant — answers, plans and text deliverables")}</option>
            {data?.items.filter((row: any) => !window.copyPasteBridge || row.role_key !== "computer-operator").map((row: any) => <option key={row.role_key} value={row.role_key}>{locale === "en" ? roleEnglish[row.role_key] ?? row.display_name : row.display_name}</option>)}
            {window.copyPasteBridge && v.role === "computer-operator" && <option value={v.role}>{roleEnglish[v.role]}</option>}
            {!(window.copyPasteBridge && v.role === "computer-operator") && !data?.items.some((row: any) => row.role_key === v.role) && v.role !== "assistant" && <option value={v.role}>{roleEnglish[v.role] ?? v.role}</option>}
          </select></Field>
          <ErrorNotice error={rolesError}/>{loading && !data && <Loading/>}
          {v.role === "computer-operator" && (window.copyPasteBridge ? <p className="notice" role="status">{t(
            "這份草稿使用雲端電腦角色，請在 Web 工作台繼續。你也可以另選角色並重新核對工作。",
            "This draft uses a cloud computer role. Continue it in the web workspace, or choose another role and review the work.")}
            <button className="button quiet" type="button" onClick={() => change({ role: "assistant", required_input: "" })}>{t("另選助手角色", "Choose assistant role")}</button></p> : <p className="notice" role="status">{t(
            "先選擇一台已確認費用及操作權限的雲端電腦，再單獨確認 Codex 任務與 AI 預算。",
            "Choose a cloud computer with confirmed cost and control permissions, then approve the Codex task and its separate AI budget.")}
            <Link to="/app/computers" onClick={onClose}>{t("選擇雲端電腦", "Choose a cloud computer")}</Link></p>)}
          <ModeField value={v.mode} onChange={mode => change({ mode })}/>
          <Field label={t("工作名稱", "Task name")}><input name="title" value={v.title} onChange={e => change({ title: e.target.value })} maxLength={160} required
            placeholder={t("例如：秋季新品推廣海報", "e.g. Autumn launch campaign")}/></Field>
          <Field label={t("你想完成什麼？", "What would you like to make?")}><textarea name="prompt" value={v.prompt} onChange={e => change({ prompt: e.target.value })}
            rows={5} minLength={5} maxLength={30000} required placeholder={t("說明目標、對象、交付格式和需要保留的內容…", "Describe your goal, audience, deliverables and anything to preserve…")}/></Field>
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
        </fieldset>
        <button className="button primary" type="submit" disabled={busy || !online || v.role === "computer-operator"}>{busy ? t("正在核對提交…", "Checking submission…") : pending ? t("重試原提交", "Retry original submission") : t("開始工作", "Start task")}<ArrowUpRight size={16}/></button>
        {!pending && <button className="text-button work-draft-reset" type="button" disabled={busy} onClick={() => store(newWorkDraft(scope))}><RotateCcw size={15}/>{t("清除這份草稿", "Clear this draft")}</button>}
      </form>
    </>}
  </Modal>;
}
