import { useEffect, useRef, useState } from "react";
import { ArrowUp, Download, FolderOpen, Monitor, Plus, ShieldCheck, Square, Terminal, X } from "lucide-react";
import { download } from "./api";
import { useWorkspace } from "./context";
import { Money, useI18n } from "./ui";
import "./local-agent.css";

type Permission = "read-only" | "workspace-write" | "full-access";
interface LocalSession {
  id: string; workspace: string; role: string; permission: Permission | null;
  revoked: boolean; busy: boolean; phase: string; uncertain: boolean; retryable: boolean; error?: string;
  task?: { task_id: string; status: string; charged_micros: string; accrued_micros: string };
  messages: { role: "user" | "assistant"; text: string; status?: string }[];
  events: { kind: string; value: any }[];
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
};
async function native(action: string, payload: unknown) {
  const reply = await window.copyPasteBridge!.localAgent(action, payload);
  if (!reply.ok) throw new Error(reply.code ?? "LOCAL_OPERATION_FAILED");
  return reply.value;
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
  const refresh = useRef<() => Promise<void>>(async () => {}), end = useRef<HTMLDivElement>(null);
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
  const lastStart = session?.events.map(e => e.kind).lastIndexOf("turn/started") ?? -1;
  const stream = session?.busy ? session.events.slice(Math.max(0, lastStart)).filter(e => e.kind === "item/agentMessage/delta").map(e => e.value.delta ?? "").join("") : "";
  const artifacts = [...new Map((session?.events ?? []).filter(event => event.kind === "local.company-tool.completed")
    .flatMap(event => event.value.artifacts ?? []).filter(artifact => artifact?.id && artifact?.asset_version_id && Number.isSafeInteger(artifact?.version))
    .map(artifact => [artifact.asset_version_id, artifact] as const)).values()];
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [session?.messages.length, stream]);
  const act = async (action: string, payload: unknown) => {
    setPending(true); setError("");
    try { const result = await native(action, payload); if (result?.id) setSelected(result.id); }
    catch (e) { setError((e as Error).message); }
    finally { setPending(false); await refresh.current(); }
  };
  const send = () => {
    const amount = Number(budget), micros = Math.round(amount * 1_000_000);
    if (!session || !prompt.trim() || !Number.isFinite(amount) || micros < 10000 || micros > 10000000000) return;
    const text = prompt.trim(); setPrompt("");
    void act("send", { id: session.id, prompt: text, budget: micros });
  };
  return <div className="local-agent-workspace">
    <header className="local-agent-heading"><div><div className="eyebrow">COPYPASTE · ON YOUR COMPUTER</div>
      <h1>{t("你的本機工作夥伴", "Your local workmate")}</h1><p>{t("從一個目錄、一個想法開始。讓工作在你的電腦上完成。", "Start with a folder and an idea. Get the work done on your computer.")}</p></div>
      <span className="local-agent-chip"><Monitor size={16}/>{t("在此電腦執行", "Runs on this computer")}</span></header>
    {error && <div role="alert" className="local-agent-alert">{t("操作未完成：", "Action incomplete: ")}{error}</div>}
    <div className="local-agent-grid"><aside className="local-agent-sessions">
      <label>{t("專業角色", "Specialist")}<select aria-label={t("本機角色", "Local specialist")} value={role} onChange={e => setRole(e.target.value)}>
        {roles.map(key => <option key={key} value={key}>{roleNames[key] ? t(...roleNames[key]) : key}</option>)}</select></label>
      <button className="button primary" disabled={pending || !roles.includes(role)} onClick={() => void act("create", { tenant: w.tenant, project: w.project, role })}><Plus size={16}/>{t("選擇目錄開始", "Choose folder to start")}</button>
      <p className="muted">{t("檔案與終端在此電腦處理；圖片與專案工具使用公司服務。", "Files and terminal run on this computer; image and project tools use company services.")}</p>
      <nav aria-label={t("本機會話", "Local sessions")}>{sessions.map(s => <button key={s.id} className={s.id === selected ? "selected" : ""} onClick={() => { setSelected(s.id); setError(""); }}>
        <FolderOpen size={16}/><span>{s.workspace.split(/[\\/]/).filter(Boolean).at(-1)}<small>{roleNames[s.role] ? t(...roleNames[s.role]) : s.role}{s.revoked ? t(" · 已撤權", " · Revoked") : ""}</small></span></button>)}</nav>
    </aside><section className="local-agent-conversation" aria-label={t("本機工作對話", "Local work conversation")}>
      {session ? <><div className="local-agent-toolbar"><div className="local-agent-folder"><FolderOpen size={17}/><span title={session.workspace}>{session.workspace}</span></div>
        <div className="local-agent-permission"><ShieldCheck size={16}/><select aria-label={t("本機權限", "Local permission")} value={mode} onChange={e => setMode(e.target.value as Permission)} disabled={session.busy || session.revoked || pending}>
          <option value="read-only">{t("唯讀", "Read only")}</option><option value="workspace-write">{t("目錄內讀寫", "Workspace write")}</option><option value="full-access">{t("完整本機權限", "Full local access")}</option></select>
          <button className="button" disabled={pending || session.busy || session.revoked} onClick={() => void act("permission", { id: session.id, mode })}>{t("設定授權", "Set permission")}</button>
          <button className="icon-button" aria-label={t("撤銷本機權限", "Revoke local permission")} disabled={session.revoked} onClick={() => void native("revoke", { id: session.id }).then(() => refresh.current()).catch(e => setError(e.message))}><X size={17}/></button></div></div>
        <div className="local-agent-safety">{t("目前授權：", "Current permission: ")}{session.permission ? t(...({ "read-only": ["唯讀", "Read only"], "workspace-write": ["目錄內讀寫", "Workspace write"], "full-access": ["完整本機權限", "Full local access"] } as Record<Permission, [string, string]>)[session.permission]) : t("尚未授權", "Not granted")}
          <span>{t("模型服務經公司伺服器", "Model service via company server")}</span></div>
        <div className="local-agent-messages" aria-live="polite">{session.messages.length === 0 && <div className="local-agent-empty"><Terminal size={30}/><h2>{t("把想法變成檔案", "Turn an idea into files")}</h2><p>{t("先設定本機權限，再描述你想完成的工作。完整本機權限需要你在系統對話框中確認。", "Set local permission, then describe the work. Full local access requires your confirmation in a native dialog.")}</p></div>}
          {session.messages.map((m, i) => <article key={i} className={`local-agent-message ${m.role}`}><small>{m.role === "user" ? t("你", "You") : "COPYPASTE"}{m.status ? " · " + m.status : ""}</small><p>{m.text || t("本次未返回文字。請檢查工作記錄。", "No text was returned. Review the activity log.")}</p></article>)}
          {session.busy && <article className="local-agent-message assistant"><small>COPYPASTE · {t("執行中", "Working")}</small><p>{stream || t("正在處理本機工作…", "Working on your computer…")}</p></article>}<div ref={end}/></div>
        {artifacts.length > 0 && <div className="local-agent-artifacts" aria-label={t("專案成果", "Project artifacts")}><span>{t("專案成果", "Project artifacts")}</span>{artifacts.map(artifact => <button className="button" key={artifact.asset_version_id}
          onClick={() => void download(`${w.base}/assets/${artifact.id}/download?version=${artifact.version}`, artifact.name, w.tenant).catch(e => setError(e.message))}><Download size={14}/>{artifact.name} · v{artifact.version}</button>)}</div>}
        {session.events.length > 0 && <details className="local-agent-activity"><summary><Terminal size={14}/>{t("本機與公司工具記錄", "Local and company tool activity")}</summary><pre>{session.events.slice(-40).filter(e => !e.kind.includes("agentMessage/delta")).map(e => `${e.kind}\n${JSON.stringify(e.value, null, 2)}`).join("\n\n")}</pre></details>}
        {session.uncertain && <div role="status" className="local-agent-alert">{t("上次本機操作的結果需要核對，系統不會重新執行。請檢查本機檔案與費用記錄。", "The last local outcome needs review and will not be replayed. Check local files and the billing record.")}</div>}
        <form className="local-agent-composer" onSubmit={e => { e.preventDefault(); send(); }}><textarea aria-label={t("本機工作要求", "Local task")} placeholder={t("描述你想完成的工作…", "What would you like to get done?")} maxLength={30000} value={prompt} onChange={e => setPrompt(e.target.value)} disabled={session.revoked || session.uncertain || session.busy || pending}/>
          <div><label>{t("本次預算上限 HK$", "Turn budget HK$")}<input type="number" aria-label="Turn budget HK$" min="0.01" max="10000" step="0.01" value={budget} onChange={e => setBudget(e.target.value)}/></label>
            {session.busy ? <button type="button" className="button" onClick={() => void native("stop", { id: session.id }).then(() => refresh.current()).catch(e => setError(e.message))}><Square size={14}/>{t("停止", "Stop")}</button>
              : session.retryable ? <><button type="button" className="button" disabled={pending} onClick={() => void act("retry", { id: session.id })}>{session.phase === "settling" ? t("同步執行結果", "Sync result") : t("重試連線", "Retry connection")}</button>{session.phase !== "settling" && <button type="button" className="button" disabled={pending} onClick={() => void act("stop", { id: session.id })}>{t("取消待處理工作", "Cancel pending work")}</button>}</>
                : <button className="button primary" type="submit" disabled={pending || !session.permission || session.revoked || session.uncertain || !prompt.trim()}><ArrowUp size={18}/>{t("開始工作", "Start work")}</button>}</div></form>
        {session.task && <div className="local-agent-receipt"><span>{t("公司費用記錄", "Company billing record")} · {session.task.status}</span><span>{t("已結算", "Charged")} <Money value={session.task.charged_micros}/> · {t("已觀測", "Observed")} <Money value={session.task.accrued_micros}/></span></div>}
      </> : <div className="local-agent-empty"><FolderOpen size={36}/><h2>{t("選擇你的工作目錄", "Choose your workspace")}</h2><p>{t("本機會話保存在此電腦，並與你的帳戶和企業專案綁定。", "Local sessions stay on this computer and belong to your account and company project.")}</p></div>}
    </section></div>
  </div>;
}
