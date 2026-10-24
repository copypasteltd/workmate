import { DeliveryQuality } from "./delivery-quality";
import { GeneratedVideos } from "./generated-videos";
import { AudioProductions } from "./audio-production";
import { VideoBriefFields, videoGenerationBrief } from "./video-brief";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Download, FolderOpen, Monitor, Plus, ShieldCheck, Square, Terminal, X } from "lucide-react";
import { download } from "./api";
import { useWorkspace } from "./context";
import { Money, useI18n } from "./ui";
import "./local-agent.css";
import type { LocalPendingInput, LocalInputAnswers } from "../../src/local-input";
import { LocalVideoJobs, type LocalVideoJob } from "./local-video";

type Permission = "read-only" | "workspace-write" | "full-access";
interface LocalSession {
  id: string; workspace: string; role: string; permission: Permission | null;
  revoked: boolean; busy: boolean; phase: string; uncertain: boolean; retryable: boolean; error?: string;
  task?: { task_id: string; status: string; charged_micros: string; accrued_micros: string };
  messages: { role: "user" | "assistant"; text: string; status?: string }[];
  events: { kind: string; value: any }[];
  inputs: LocalPendingInput[];
}
const roleNames: Record<string, [string, string]> = {
  fullstack: ["全端工程師", "Full-stack developer"], frontend: ["前端工程師", "Frontend developer"],
  "backend-api": ["後端與 API 工程師", "Backend & API developer"], "software-qa": ["軟體測試工程師", "Software QA engineer"],
  "landing-page": ["落地頁設計師", "Landing page designer"],
  "ui-ux": ["UI / UX 設計師", "UI / UX designer"], designer: ["平面設計師", "Graphic designer"],
  "brand-visual": ["品牌視覺設計師", "Brand designer"], "ad-creative": ["廣告創意設計師", "Ad creative designer"],
  ecommerce: ["電商設計師", "E-commerce designer"], "social-content": ["社群內容設計師", "Social content designer"],
  "illustration-ip": ["插畫與角色設計師", "Illustration & character designer"],
  "typography-layout": ["字體與排版設計師", "Typography & layout designer"], presentation: ["簡報設計師", "Presentation designer"],
  "information-design": ["資訊與圖表設計師", "Information designer"], "marketing-analyst": ["營銷數據分析師", "Marketing analyst"],
  "video-motion": ["影片與動效設計師", "Video & motion designer"],
  "workflow-consultant": ["企業流程顧問", "Workflow consultant"],
};
async function native(action: string, payload: unknown) {
  const reply = await window.copyPasteBridge!.localAgent(action, payload);
  if (!reply.ok) throw new Error(reply.code ?? "LOCAL_OPERATION_FAILED");
  return reply.value;
}
function LocalInputCard({ input, sessionId, onDone, onStop }: {
  input: LocalPendingInput; sessionId: string; onDone: () => Promise<void>; onStop: () => void;
}) {
  const { t } = useI18n();
  const [choices, setChoices] = useState<Record<string, string>>({}), [texts, setTexts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false), [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { form.current?.querySelector<HTMLElement>("input,textarea")?.focus({ preventScroll: true }); }, []);
  const answerFor = (question: LocalPendingInput["questions"][number]) => {
    const choice = choices[question.id];
    return question.options && choice !== "other" ? question.options.find((_, index) => String(index) === choice)?.label ?? "" : texts[question.id] ?? "";
  };
  const ready = input.questions.every(question => !!answerFor(question).trim());
  const submit = async () => {
    if (!ready || submitting || input.submitting) return;
    setSubmitting(true); setError("");
    const answers: LocalInputAnswers = Object.fromEntries(input.questions.map(question => [question.id, { answers: [answerFor(question)] }]));
    try { await native("answer", { id: sessionId, requestId: input.requestId, answers }); setTexts({}); await onDone(); }
    catch (e) { setError((e as Error).message); setSubmitting(false); }
  };
  const disabled = submitting || input.submitting;
  return <form ref={form} className="local-agent-input" aria-label={t("回答工作問題", "Answer task questions")} aria-live="off" onSubmit={e => { e.preventDefault(); void submit(); }}>
    <div className="local-agent-input-heading"><span className="eyebrow">COPYPASTE</span><strong>{t("需要你的意見", "A question for you")}</strong></div>
    {input.questions.map(question => <fieldset key={question.id} disabled={disabled}>
      <legend><span>{question.header}</span>{question.question}</legend>
      {question.options?.map((option, index) => <label className="local-agent-input-option" key={option.label}>
        <input type="radio" name={input.requestId + question.id} value={index} checked={choices[question.id] === String(index)} onChange={() => setChoices(current => ({ ...current, [question.id]: String(index) }))}/>
        <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
      </label>)}
      {question.options && question.isOther && <label className="local-agent-input-option"><input type="radio" name={input.requestId + question.id} value="other" checked={choices[question.id] === "other"} onChange={() => setChoices(current => ({ ...current, [question.id]: "other" }))}/><span>{t("自行填寫", "Write your own")}</span></label>}
      {(!question.options || (question.isOther && choices[question.id] === "other")) && <label className="local-agent-input-text">{t("你的回答", "Your answer")}
        {question.isSecret ? <input type="password" autoComplete="off" aria-label={question.header + t("：你的回答", ": your answer")} maxLength={8000} value={texts[question.id] ?? ""} onChange={e => setTexts(current => ({ ...current, [question.id]: e.target.value }))}/>
          : <textarea aria-label={question.header + t("：你的回答", ": your answer")} maxLength={8000} value={texts[question.id] ?? ""} onChange={e => setTexts(current => ({ ...current, [question.id]: e.target.value }))}/>}
      </label>}
    </fieldset>)}
    {error && <p role="alert" className="local-agent-input-error">{t("未能送出：", "Could not send: ")}{error}</p>}
    <div className="local-agent-input-actions"><button type="button" className="button" onClick={onStop}><Square size={13}/>{t("停止工作", "Stop task")}</button>
      <button type="submit" className="button primary" disabled={disabled || !ready}>{disabled ? t("正在送出…", "Sending…") : t("回答並繼續", "Answer and continue")}<ArrowUp size={15}/></button></div>
  </form>;
}
export function CloudWorkspaceLink() {
  const { t } = useI18n();
  return <div className="local-agent-empty"><Monitor size={32}/><h2>{t("前往雲端工作台", "Open the cloud workspace")}</h2><p>{t("Desktop 的 Agent 在此電腦執行。雲端會話與尚未提供本機工具的創作角色，請在 Web 工作台使用。", "The Desktop Agent runs on this computer. Open the Web workspace for cloud conversations and specialists whose local tools are still being prepared.")}</p><button className="button primary" onClick={() => void window.copyPasteBridge!.openCloudWorkspace()}>{t("在瀏覽器開啟 Web", "Open Web in browser")}</button></div>;
}
export function LocalAgentWorkspace() {
  const w = useWorkspace(), { t } = useI18n();
  const [sessions, setSessions] = useState<LocalSession[]>([]), [roles, setRoles] = useState<string[]>([]);
  const [selected, setSelected] = useState(""), [role, setRole] = useState("fullstack"), [mode, setMode] = useState<Permission>("workspace-write");
  const [prompt, setPrompt] = useState(""), [budget, setBudget] = useState("5"), [pending, setPending] = useState(false), [error, setError] = useState("");
  const [videoTask, setVideoTask] = useState("");
  const refresh = useRef<() => Promise<void>>(async () => {}), end = useRef<HTMLDivElement>(null), messages = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined, loading = false;
    setSessions([]); setSelected(""); setError("");
    const load = async () => {
      if (loading || !alive) return; loading = true;
      try {
        const data = await native("list", { tenant: w.tenant, project: w.project });
        if (alive) { setSessions(data.sessions); setRoles(data.roles); setSelected(id => data.sessions.some((s: LocalSession) => s.id === id) ? id : data.sessions.at(-1)?.id ?? ""); }
      } catch (e) { if (alive) {
        const code = (e as Error).message;
        if (["LOCAL_ACCOUNT_CHANGED", "LOCAL_PROJECT_ACCESS_REQUIRED", "AUTH_REQUIRED", "AUTH_CHANGED"].includes(code)) { setSessions([]); setSelected(""); }
        setError(code);
      } }
      finally { loading = false; }
    };
    refresh.current = load;
    const off = window.copyPasteBridge!.onLocalAgentChanged(() => {
      if (!timer) timer = setTimeout(() => { timer = undefined; void load(); }, 250);
    });
    void load();
    const poll = setInterval(() => void load(), 5000);
    return () => { alive = false; off(); clearInterval(poll); if (timer) clearTimeout(timer); };
  }, [w.tenant, w.project]);
  const session = sessions.find(s => s.id === selected);
  const videoTaskIds = [...new Set([session?.task?.task_id, ...(session?.events ?? []).slice().reverse()
    .filter(event => event.kind === "local.company-tool.completed").map(event => event.value.generated_video?.task_id ?? event.value.audio?.task_id)]
    .filter((id): id is string => typeof id === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)))];
  const currentVideoTask = videoTaskIds.includes(videoTask) ? videoTask : videoTaskIds[0];
  useEffect(() => { setVideoTask(""); }, [session?.id, session?.task?.task_id]);
  useEffect(() => { if (session?.permission) setMode(session.permission); }, [session?.id, session?.permission]);
  useEffect(() => {
    const scroller = messages.current;
    if (!scroller) return;
    // A focused control can move out of view after a native window resize;
    // focusing the same element again does not make Chromium reveal it.
    const observer = new ResizeObserver(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== scroller && scroller.contains(active))
        active.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [session?.id]);
  const lastStart = session?.events.map(e => e.kind).lastIndexOf("turn/started") ?? -1;
  const stream = session?.busy ? session.events.slice(Math.max(0, lastStart)).filter(e => e.kind === "item/agentMessage/delta").map(e => e.value.delta ?? "").join("") : "";
  const artifacts = [...new Map((session?.events ?? []).filter(event => event.kind === "local.company-tool.completed")
    .flatMap(event => event.value.artifacts ?? []).filter(artifact => artifact?.id && artifact?.asset_version_id && Number.isSafeInteger(artifact?.version))
    .map(artifact => [artifact.asset_version_id, artifact] as const)).values()];
  const videos = [...(session?.events ?? []).reduce((found, event) => {
    const video = event.kind === "local.company-tool.completed" && event.value.video;
    if (video?.project_id && video?.render_id) found.set(video.render_id, { ...found.get(video.render_id), ...video });
    return found;
  }, new Map<string, LocalVideoJob>()).values()];
  const workflows = [...(session?.events ?? []).reduce((found, event) => {
    const flow = event.kind === "local.workflow.progress" && event.value;
    if (flow?.run_id && Number.isSafeInteger(flow.cursor) && Number.isSafeInteger(flow.steps)) found.set(flow.run_id, flow);
    return found;
  }, new Map<string, any>()).values()];
  useEffect(() => {
    const scroller = messages.current, card = scroller?.querySelector<HTMLElement>(".local-agent-input");
    if (session?.inputs?.length && scroller && card) {
      scroller.scrollTop += card.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    } else end.current?.scrollIntoView({ block: "nearest" });
  }, [session?.id, session?.messages.length, session?.inputs?.[0]?.requestId, stream]);
  const act = async (action: string, payload: unknown) => {
    setPending(true); setError("");
    try { const result = await native(action, payload); if (result?.id) setSelected(result.id); }
    catch (e) { setError((e as Error).message); }
    finally { setPending(false); await refresh.current(); }
  };
  const send = (form: FormData) => {
    const amount = Number(budget), micros = Math.round(amount * 1_000_000);
    if (!session || !prompt.trim() || !Number.isFinite(amount) || micros < 10000 || micros > 10000000000) return;
    try {
      const text = session.role === "video-motion" ? videoGenerationBrief(prompt.trim(), form) : prompt.trim(); setPrompt("");
      void act("send", { id: session.id, prompt: text, budget: micros });
    } catch (failure) { setError((failure as Error).message); }
  };
  return <div className="local-agent-workspace">
    <header className="local-agent-heading"><div><div className="eyebrow">COPYPASTE · ON YOUR COMPUTER</div>
      <h1>{t("你的本機工作夥伴", "Your local workmate")}</h1><p>{t("從一個目錄、一個想法開始。讓工作在你的電腦上完成。", "Start with a folder and an idea. Get the work done on your computer.")}</p></div>
      <span className="local-agent-chip"><Monitor size={16}/>{t("在此電腦執行", "Runs on this computer")}</span></header>
    {error && <div role="alert" className="local-agent-alert">{t("操作未完成：", "Action incomplete: ")}{error}</div>}
    <div className="local-agent-grid"><aside className="local-agent-sessions" tabIndex={0} aria-label={t("本機工作目錄與會話", "Local workspaces and sessions")}>
      <label>{t("專業角色", "Specialist")}<select aria-label={t("本機角色", "Local specialist")} value={role} onChange={e => setRole(e.target.value)}>
        {roles.map(key => <option key={key} value={key}>{roleNames[key] ? t(...roleNames[key]) : key}</option>)}</select></label>
      <button className="button primary" disabled={pending || !roles.includes(role)} onClick={() => void act("create", { tenant: w.tenant, project: w.project, role })}><Plus size={16}/>{t("選擇目錄開始", "Choose folder to start")}</button>
      <p className="muted">{t("檔案與終端在此電腦處理；圖片、影片與專案工具使用公司服務。", "Files and terminal run on this computer; image, video and project tools use company services.")}</p>
      <nav aria-label={t("本機會話", "Local sessions")}>{sessions.map(s => <button key={s.id} title={s.workspace} aria-pressed={s.id === selected} className={s.id === selected ? "selected" : ""} onClick={() => { setSelected(s.id); setError(""); }}>
        <FolderOpen size={16}/><span>{s.workspace.split(/[\\/]/).filter(Boolean).at(-1)}<small>{roleNames[s.role] ? t(...roleNames[s.role]) : s.role}{s.revoked ? t(" · 已撤權", " · Revoked") : ""}</small></span></button>)}</nav>
    </aside><section className="local-agent-conversation" aria-label={t("本機工作對話", "Local work conversation")}>
      {session ? <><div className="local-agent-toolbar"><div className="local-agent-folder"><FolderOpen size={17}/><span title={session.workspace}>{session.workspace}</span></div>
        <div className="local-agent-permission"><ShieldCheck size={16}/><select aria-label={t("本機權限", "Local permission")} value={mode} onChange={e => setMode(e.target.value as Permission)} disabled={session.busy || session.revoked || pending}>
          <option value="read-only">{t("唯讀", "Read only")}</option><option value="workspace-write">{t("目錄內讀寫", "Workspace write")}</option><option value="full-access">{t("完整本機權限", "Full local access")}</option></select>
          <button className="button" disabled={pending || session.busy || session.revoked} onClick={() => void act("permission", { id: session.id, mode })}>{t("設定授權", "Set permission")}</button>
          <button className="icon-button" aria-label={t("撤銷本機權限", "Revoke local permission")} disabled={session.revoked} onClick={() => void native("revoke", { id: session.id }).then(() => refresh.current()).catch(e => setError(e.message))}><X size={17}/></button></div></div>
        <div className="local-agent-safety">{t("目前授權：", "Current permission: ")}{session.permission ? t(...({ "read-only": ["唯讀", "Read only"], "workspace-write": ["目錄內讀寫", "Workspace write"], "full-access": ["完整本機權限", "Full local access"] } as Record<Permission, [string, string]>)[session.permission]) : t("尚未授權", "Not granted")}
          <span>{t("模型服務經公司伺服器", "Model service via company server")}</span></div>
        <div ref={messages} className="local-agent-messages" tabIndex={0} role="log" aria-label={t("本機工作記錄", "Local work history")} aria-live="polite">{session.messages.length === 0 && <div className="local-agent-empty"><Terminal size={30}/><h2>{t("把想法變成檔案", "Turn an idea into files")}</h2><p>{t("先設定本機權限，再描述你想完成的工作。完整本機權限需要你在系統對話框中確認。", "Set local permission, then describe the work. Full local access requires your confirmation in a native dialog.")}</p></div>}
          {session.messages.map((m, i) => <article key={i} className={`local-agent-message ${m.role}`}><small>{m.role === "user" ? t("你", "You") : "COPYPASTE"}{m.status ? " · " + m.status : ""}</small><p>{m.text || t("本次未返回文字。請檢查工作記錄。", "No text was returned. Review the activity log.")}</p></article>)}
          {session.busy && <article className="local-agent-message assistant"><small>COPYPASTE · {session.inputs?.length ? t("等待你的回答", "Waiting for your answer") : t("執行中", "Working")}</small><p>{stream || (session.inputs?.length ? t("回答以下問題後，工作便可繼續。", "Answer below to continue the work.") : t("正在處理本機工作…", "Working on your computer…"))}</p></article>}
          {videos.length > 0 && <LocalVideoJobs key={session.id} jobs={videos}/>}
          {session.role === "video-motion" && currentVideoTask && <>
            {videoTaskIds.length > 1 && <label className="local-agent-video-history">{t("影音工作記錄", "Media task history")}<select value={currentVideoTask} onChange={e => setVideoTask(e.target.value)}>
              {videoTaskIds.map((id, index) => <option key={id} value={id}>{index === 0 ? t("目前工作", "Current task") : t("較早工作", "Earlier task")} · {id.slice(0, 8)}</option>)}
            </select></label>}
            <GeneratedVideos key={w.base + currentVideoTask} base={w.base} taskId={currentVideoTask} />
            <AudioProductions key={"audio:" + w.base + currentVideoTask} base={w.base} taskId={currentVideoTask} />
          </>}
          {workflows.map(flow => <article className="local-agent-message assistant local-workflow-progress" key={flow.run_id}
            aria-label={t("本機流程進度", "Local workflow progress")}>
            <small>{t("本機流程", "Local workflow")} · v{flow.version}</small>
            <strong>{["running", "awaiting_approval"].includes(flow.state) && (!session.busy || session.revoked) ? t("本機已停止，等待核對", "Local execution stopped; review pending")
              : flow.state === "succeeded" ? t("流程已完成", "Workflow completed") : flow.state === "failed" ? t("流程未完成", "Workflow incomplete")
              : flow.state === "cancelled" ? t("流程已停止", "Workflow stopped") : !flow.authorized ? t("等待費用確認", "Awaiting fee confirmation")
              : flow.state === "awaiting_approval" ? t("等待審批", "Awaiting approval") : t("本機執行中", "Running locally")}</strong>
            <p>{t("已完成步驟", "Completed steps")} {flow.cursor} / {flow.steps} · {t("已完成步驟費用", "Completed-step usage")} <Money value={flow.charged_micros ?? "0"}/></p>
            <small>{t("顧問對話及未完成步驟的費用，請到用量記錄查看。", "See usage records for this conversation and any unfinished steps.")}</small>
            {flow.error_code && <p role="status">{flow.error_code}</p>}
          </article>)}
        {session.task && ["succeeded", "failed", "cancelled"].includes(session.task.status) && <details className="local-agent-activity"><summary>{t("審閱本次交付", "Review this delivery")}</summary><DeliveryQuality key={w.base + session.task.task_id} base={w.base} taskId={session.task.task_id}/></details>}
          {session.inputs?.map(input => <LocalInputCard key={input.requestId} input={input} sessionId={session.id} onDone={() => refresh.current()} onStop={() => void native("stop", { id: session.id }).then(() => refresh.current()).catch(e => setError(e.message))}/>)}<div ref={end}/></div>
        {artifacts.length > 0 && <div className="local-agent-artifacts" tabIndex={0} role="region" aria-label={t("專案成果", "Project artifacts")}><span>{t("專案成果", "Project artifacts")}</span>{artifacts.map(artifact => <button className="button" key={artifact.asset_version_id}
          onClick={() => void download(`${w.base}/assets/${artifact.id}/download?version=${artifact.version}`, artifact.name, w.tenant).catch(e => setError(e.message))}><Download size={14}/><span>{artifact.name} · v{artifact.version}</span></button>)}</div>}
        {session.events.length > 0 && <details className="local-agent-activity"><summary><Terminal size={14}/>{t("本機與公司工具記錄", "Local and company tool activity")}</summary><pre>{session.events.slice(-40).filter(e => !e.kind.includes("agentMessage/delta")).map(e => `${e.kind}\n${JSON.stringify(e.value, null, 2)}`).join("\n\n")}</pre></details>}
        {session.uncertain && <div role="status" className="local-agent-alert">{t("上次本機操作的結果需要核對，系統不會重新執行。請檢查本機檔案與費用記錄。", "The last local outcome needs review and will not be replayed. Check local files and the billing record.")}</div>}
        <form className="local-agent-composer" onSubmit={e => { e.preventDefault(); send(new FormData(e.currentTarget)); }}><textarea aria-label={t("本機工作要求", "Local task")} placeholder={t("描述你想完成的工作…", "What would you like to get done?")} maxLength={30000} value={prompt} onChange={e => setPrompt(e.target.value)} disabled={session.revoked || session.uncertain || session.busy || pending}/>
          {session.role === "video-motion" && <VideoBriefFields compact disabled={session.revoked || session.uncertain || session.busy || pending} />}
          <div><label>{t("本次預算上限 HK$", "Turn budget HK$")}<input type="number" aria-label="Turn budget HK$" min="0.01" max="10000" step="0.01" value={budget} onChange={e => setBudget(e.target.value)}/></label>
            {session.busy ? <button type="button" className="button" onClick={() => void native("stop", { id: session.id }).then(() => refresh.current()).catch(e => setError(e.message))}><Square size={14}/>{t("停止", "Stop")}</button>
              : session.retryable ? <><button type="button" className="button" disabled={pending} onClick={() => void act("retry", { id: session.id })}>{session.phase === "settling" ? t("同步執行結果", "Sync result") : t("重試連線", "Retry connection")}</button>{session.phase !== "settling" && <button type="button" className="button" disabled={pending} onClick={() => void act("stop", { id: session.id })}>{t("取消待處理工作", "Cancel pending work")}</button>}</>
                : <button className="button primary" type="submit" disabled={pending || !session.permission || session.revoked || session.uncertain || !prompt.trim()}><ArrowUp size={18}/>{t("開始工作", "Start work")}</button>}</div></form>
        {session.task && <div className="local-agent-receipt"><span>{t("公司費用記錄", "Company billing record")} · {session.task.status}</span><span>{t("已結算", "Charged")} <Money value={session.task.charged_micros}/> · {t("已觀測", "Observed")} <Money value={session.task.accrued_micros}/></span></div>}
      </> : <div className="local-agent-empty"><FolderOpen size={36}/><h2>{t("選擇你的工作目錄", "Choose your workspace")}</h2><p>{t("本機會話保存在此電腦，並與你的帳戶和企業專案綁定。", "Local sessions stay on this computer and belong to your account and company project.")}</p></div>}
    </section></div>
  </div>;
}
