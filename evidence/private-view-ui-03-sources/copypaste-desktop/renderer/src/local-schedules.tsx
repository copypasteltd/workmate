import { useEffect, useState } from "react";
import { ArrowRight, FolderOpen, FolderSync, Pause, Play, Plus, ShieldCheck, X } from "lucide-react";
import { Modal, Money, useI18n } from "./ui";
import "./local-schedules.css";

interface Job { id: string; input: { path: string; sha256: string }; state: string; taskId?: string; output?: string; error?: string }
interface Rule {
  id: string; name: string; instruction: string; input: string; state: string; reason?: string; extensions: string[];
  budgetMicros: number; totalBudgetMicros: number; maxRuns: number; allocatedRuns: number; allocatedBudgetMicros: number; pending: number; jobTotal: number; jobs: Job[];
}
async function native(action: string, payload: unknown) {
  const result = await window.copyPasteBridge!.localAgent("schedule." + action, payload);
  if (!result.ok) throw new Error(result.code ?? "LOCAL_SCHEDULE_UNAVAILABLE");
  return result.value;
}
function micros(value: FormDataEntryValue | null) {
  const text = String(value ?? ""); if (!/^\d{1,5}(?:\.\d{1,6})?$/.test(text)) return NaN;
  const [whole, decimal = ""] = text.split("."); return Number(BigInt(whole) * 1000000n + BigInt(decimal.padEnd(6, "0")));
}
export function LocalFolderSchedules({ sessionId, writable, pendingQuestions, onAnswer }: {
  sessionId: string; writable: boolean; pendingQuestions: number; onAnswer: () => void;
}) {
  const { t } = useI18n();
  const [rules, setRules] = useState<Rule[]>([]), [creating, setCreating] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState("");
  const [visible, setVisible] = useState<Record<string, number>>({});
  const explanation = (code?: string) => {
    if (!code) return "";
    const messages: Record<string, [string, string]> = {
      LOCAL_SCHEDULE_APP_RESTARTED: ["應用程式已重新開啟。核對內容和額度後，再啟用剩餘工作。", "The app reopened. Review the instructions and limits before activating remaining work."],
      LOCAL_SCHEDULE_USER_PAUSED: ["已暫停新工作；執行中的檔案會先完成。", "New work is paused. The current file can finish."],
      LOCAL_SCHEDULE_LIMIT_REACHED: ["已達本規則的次數或授權上限。需要更多工作時，另建規則並確認額度。", "This rule reached its run or authorized budget limit. Create and confirm another rule for further work."],
      LOCAL_SCHEDULE_PERMISSION_CHANGED: ["本機授權已變更。重新設定權限，再確認是否繼續。", "Local permission changed. Set permission again and confirm whether to continue."],
      LOCAL_PERMISSION_REQUIRED: ["先為此會話設定目錄內讀寫或完整本機權限。", "First grant workspace write or full local access to this session."],
      LOCAL_SCHEDULE_DIRECTORY_CHANGED: ["目錄已移動或被替換。請核對原目錄，或建立新規則。", "A folder moved or was replaced. Review the original folder or create a new rule."],
      LOCAL_SCHEDULE_LINK_REJECTED: ["目錄含有連結或 junction。請選擇不含連結的輸入目錄。", "The folder contains a link or junction. Choose an input folder without links."],
      LOCAL_SCHEDULE_FILE_CONFLICT: ["檔案已改變或被替換。請核對原檔與成果；此項不會自動重跑。", "A file changed or was replaced. Review the original and output; this item will not rerun automatically."],
      LOCAL_SCHEDULE_FILE_INVALID: ["檔案不符合要求，或超過單檔 20 MiB 上限。請分拆輸入。", "A file is unsupported or exceeds 20 MiB. Split the input."],
      LOCAL_SCHEDULE_FILE_MISSING: ["原檔或目錄已不存在。請核對檔案位置和原工作，再處理其餘項目。", "The original file or folder is missing. Review its location and original task before continuing remaining work."],
      LOCAL_SCHEDULE_PATH_INVALID: ["請選擇此會話工作目錄內的實際子目錄。", "Choose a real folder within this session's workspace."],
      LOCAL_SCHEDULE_ACCESS_REQUIRED: ["目前無法存取本機檔案。請核對系統檔案權限。", "The local file is inaccessible. Check its operating system permissions."],
      LOCAL_SCHEDULE_SCAN_LIMIT: ["目錄超過掃描上限。請改選較小的子目錄。", "The folder exceeds scan limits. Choose a smaller subfolder."],
      LOCAL_SCHEDULE_QUEUE_LIMIT: ["佇列已達上限。先處理現有項目，再建立新規則。", "The queue reached its limit. Review existing work before creating another rule."],
      LOCAL_SCHEDULE_RULE_LIMIT: ["此電腦已建立 20 個規則，請先處理現有規則。", "This computer already has 20 rules. Review existing rules first."],
      LOCAL_DISPATCH_LIMIT: ["此會話已達 1,000 次目錄派發上限。請建立新會話再設定規則。", "This session reached 1,000 folder dispatches. Create a new session before setting another rule."],
      LOCAL_EXECUTION_RECONCILIATION_REQUIRED: ["原工作結果或費用需要核對。回到對話同步原回執；不要另行重跑此項。", "The original outcome or cost needs review. Return to the conversation to sync its receipt; do not rerun this item."],
      LOCAL_SCHEDULE_TASK_FAILED: ["原工作沒有成功。先查看對話與費用，再決定是否啟用其餘項目。", "The original task did not succeed. Review the conversation and cost before activating remaining items."],
      LOCAL_SCHEDULE_REVOKED: ["規則已撤銷，不再開始工作。已產生的檔案與費用記錄保留。", "The rule is revoked and cannot start work. Existing files and billing records remain."],
      LOCAL_SCHEDULE_SETTINGS_INVALID: ["請核對副檔名、次數和費用；總額須足以支付至少一個檔案的上限。", "Check extensions, run count and budgets. The total must cover at least one file's limit."],
      LOCAL_SCHEDULE_STORAGE_UNAVAILABLE: ["本機記錄無法儲存，工作已停止。請檢查磁碟空間和存取權限。", "Local state could not be saved. Work stopped. Check disk space and access."],
      LOCAL_SCHEDULE_NOT_FOUND: ["此規則不屬於目前會話，或已不可用。請重新選擇會話。", "This rule is unavailable in the current session. Select the session again."],
    };
    return messages[code] ? t(...messages[code]) : t("暫時無法繼續。請檢查公司連線、本機權限及原工作狀態，再確認啟用。", "Work cannot continue now. Check the company connection, local permission and original task, then confirm activation.");
  };
  const stateName = (state: string) => {
    const names: Record<string, [string, string]> = { active: ["監察中", "Watching"], paused: ["已暫停", "Paused"], blocked: ["需要處理", "Needs review"], revoked: ["已撤銷", "Revoked"],
      queued: ["待處理", "Queued"], preparing: ["準備檔案", "Preparing"], dispatching: ["原工作處理中", "Original task in progress"], succeeded: ["已完成", "Completed"], failed: ["未完成", "Failed"], conflict: ["檔案衝突", "File conflict"], uncertain: ["結果待核對", "Outcome needs review"], cancelled: ["已取消", "Cancelled"], superseded: ["由新版本取代", "Superseded"] };
    return names[state] ? t(...names[state]) : t("需要處理", "Needs review");
  };
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined, loading = false;
    const load = async () => {
      if (loading) return; loading = true;
      try { const value = await native("list", { id: sessionId }); if (alive) setRules(value); }
      catch (e) { if (alive) setError((e as Error).message); }
      finally { loading = false; }
    };
    const off = window.copyPasteBridge!.onLocalAgentChanged(() => { if (!timer) timer = setTimeout(() => { timer = undefined; void load(); }, 300); });
    void load(); const poll = setInterval(() => void load(), 5000);
    return () => { alive = false; off(); clearInterval(poll); if (timer) clearTimeout(timer); };
  }, [sessionId]);
  const act = async (action: string, extra: Record<string, unknown>) => {
    setPending(true); setError("");
    try { const result = await native(action, { id: sessionId, ...extra }); setRules(await native("list", { id: sessionId })); return result; }
    catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  };
  return <section className="folder-work" tabIndex={0} aria-label={t("目錄工作", "Folder work")}>
    {pendingQuestions > 0 && <aside className="folder-work-question" role="status"><div><strong>{t("工作需要你的回答", "Your task needs an answer")}</strong><p>{t("到對話回答問題後，原工作便可繼續。", "Answer in the conversation to continue the original task.")}</p></div><button className="button primary" onClick={onAnswer}>{t("回答問題", "Answer questions")}</button></aside>}
    <header className="folder-work-heading"><div><span className="eyebrow">COPYPASTE · FOLDER WORK</span><h2>{t("讓目錄接手重複工作", "Give repeat work a folder")}</h2>
      <p>{t("選擇輸入目錄和處理方法，逐個檔案在此電腦完成。", "Choose an input folder and instructions. Process files one at a time on this computer.")}</p></div>
      <button className="button primary" disabled={!writable || pending} onClick={() => setCreating(true)}><Plus size={16}/>{t("新增規則", "New rule")}</button></header>
    <div className="folder-work-route" aria-label={t("目錄工作流程", "Folder work flow")}><span><FolderOpen size={17}/>{t("穩定的新增或變更檔案", "Stable new or changed files")}</span><ArrowRight size={15}/><span><FolderSync size={17}/>{t("目前會話的專家", "This session's specialist")}</span><ArrowRight size={15}/><span><ShieldCheck size={17}/>{t("獨立成果與費用記錄", "Separate outputs and cost records")}</span></div>
    {!writable && <p className="folder-work-note">{explanation("LOCAL_PERMISSION_REQUIRED")}</p>}
    {error && <p className="folder-work-note" role="alert">{explanation(error)}</p>}
    <p className="folder-work-note">{t("新增規則先保持暫停；啟用時會再次確認自動計費上限。應用程式關閉後停止監察，重新開啟須再次確認。", "New rules stay paused. Activation asks you to confirm automatic spending limits. Watching stops when the app closes and requires confirmation after reopening.")}</p>
    {rules.length === 0 ? <div className="folder-work-empty"><FolderSync size={32}/><h3>{t("下一份報表、下一批素材", "The next report. The next batch.")}</h3><p>{t("例如：每當有新的 CSV，整理資料並產生摘要。原檔保留，成果放入獨立目錄。", "For example: summarize each new CSV. Keep originals and save deliverables in a separate folder.")}</p></div>
      : <div className="folder-work-rules">{rules.map(rule => <article className="folder-work-rule" key={rule.id} data-rule-id={rule.id}>
        <header><div><h3>{rule.name}</h3><p className="folder-work-path">{rule.input}</p></div><span className={`folder-work-state ${rule.state}`}>{stateName(rule.state)}</span></header>
        <p>{rule.instruction}</p><div className="folder-work-metrics"><span>{t("每檔上限", "Per file")} <Money value={rule.budgetMicros}/></span><span>{t("總授權上限", "Total authorized")} <Money value={rule.totalBudgetMicros}/></span><span>{rule.allocatedRuns} / {rule.maxRuns} {t("次已分配", "runs allocated")}</span><span>{rule.pending} {t("項待處理", "pending")}</span></div>
        <small className="muted">{t("已分配上限", "Allocated limit")} <Money value={rule.allocatedBudgetMicros}/>{t("；實際費用以公司帳本為準。", "; actual charges are recorded in the company ledger.")}</small>
        {rule.reason && <p className="folder-work-note" role="status">{explanation(rule.reason)}</p>}
        <div className="folder-work-actions">{rule.state === "active"
          ? <button className="button" onClick={() => void act("pause", { ruleId: rule.id })}><Pause size={14}/>{t("暫停新工作", "Pause new work")}</button>
          : rule.state !== "revoked" && <button className="button primary" disabled={!writable || pending || rule.reason === "LOCAL_SCHEDULE_LIMIT_REACHED" || rule.jobs.some(job => job.state === "uncertain")} onClick={() => void act("activate", { ruleId: rule.id })}><Play size={14}/>{t("確認並啟用", "Confirm and activate")}</button>}
          {rule.state !== "revoked" && <button className="button" onClick={() => void act("revoke", { ruleId: rule.id })}><X size={14}/>{t("撤銷規則", "Revoke rule")}</button>}</div>
        <details className="folder-work-history"><summary>{t("檔案與原工作記錄", "Files and original tasks")} · {rule.jobTotal}</summary>
          {rule.jobs.length === 0 && <p>{t("尚未發現符合條件的穩定變更。", "No matching stable changes yet.")}</p>}
          {rule.jobs.slice(0, visible[rule.id] ?? 50).map(job => <div className="folder-work-job" key={job.id} data-job-id={job.id}><div><strong>{job.input.path}</strong><small>{stateName(job.state)}{job.taskId ? ` · ${t("工作", "Task")} ${job.taskId.slice(0, 8)}` : ""}</small>{job.error && <p>{explanation(job.error)}</p>}</div>
            {job.output && <button className="button" onClick={() => void act("open-output", { ruleId: rule.id, jobId: job.id })}><FolderOpen size={14}/>{t("開啟成果目錄", "Open output folder")}</button>}</div>)}
          {rule.jobs.length > (visible[rule.id] ?? 50) && <button className="button" onClick={() => setVisible(value => ({ ...value, [rule.id]: (value[rule.id] ?? 50) + 50 }))}>{t("顯示更多記錄", "Show more history")}</button>}
        </details>
      </article>)}</div>}
    {creating && <Modal title={t("新增目錄規則", "New folder rule")} onClose={() => { if (!pending) setCreating(false); }}><form className="folder-work-form" onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      const settings = { name: String(data.get("name")), instruction: String(data.get("instruction")), extensions: String(data.get("extensions")).split(",").map(value => value.trim()).filter(Boolean),
        quietMs: Number(data.get("quietMs")), budgetMicros: micros(data.get("budget")), totalBudgetMicros: micros(data.get("total")), maxRuns: Number(data.get("runs")), includeExisting: data.has("existing") };
      void act("create", { settings }).then(value => { if (value) setCreating(false); });
    }}><label>{t("規則名稱", "Rule name")}<input name="name" required maxLength={80} defaultValue={t("每日資料整理", "Daily data review")}/></label>
      <label>{t("每個檔案要完成甚麼", "Instructions for each file")}<textarea name="instruction" required maxLength={10000} rows={3} placeholder={t("整理 CSV，檢查缺漏，將摘要和整理後的檔案放入成果目錄。", "Review the CSV, flag missing data and save a summary and cleaned file in the output folder.")}/></label>
      <label>{t("副檔名，以逗號分隔", "Extensions, separated by commas")}<input name="extensions" required defaultValue=".csv,.txt,.md" maxLength={260}/></label>
      <div className="folder-work-form-grid"><label>{t("每檔上限 HK$", "Per-file limit HK$")}<input name="budget" type="number" min="0.01" max="10000" step="0.01" defaultValue="1" required/></label>
        <label>{t("總授權上限 HK$", "Total authorized HK$")}<input name="total" type="number" min="0.01" max="10000" step="0.01" defaultValue="5" required/></label>
        <label>{t("最多處理次數", "Maximum runs")}<input name="runs" type="number" min="1" max="100" defaultValue="5" required/></label>
        <label>{t("穩定後開始", "Wait for stable input")}<select name="quietMs" defaultValue="1500"><option value="1500">1.5 {t("秒", "seconds")}</option><option value="5000">5 {t("秒", "seconds")}</option><option value="10000">10 {t("秒", "seconds")}</option></select></label></div>
      <label className="folder-work-checkbox"><input name="existing" type="checkbox"/>{t("包括建立規則時已有的檔案", "Include files that already exist when creating the rule")}</label>
      <p className="folder-work-note">{t("只可選此會話工作目錄內的資料夾。每檔最多 20 MiB，最多 2,000 個匹配檔案；一次新讀取最多 64 MiB。產品成果、.git 和 node_modules 不監察。", "Choose a folder within this session's workspace. Up to 20 MiB per file, 2,000 matching files and 64 MiB of fresh reads per scan. Product outputs, .git and node_modules are excluded.")}</p>
      <p className="folder-work-note">{t("沿用此會話已固定的角色與專案指引；新會話於首次工作時固定。此規則不會縮減你已授予專家的本機權限。", "Keep this session's pinned role and project guidance, fixed on its first task. This rule does not reduce the specialist's existing local permissions.")}</p>
      <button className="button primary" type="submit" disabled={pending}><FolderOpen size={16}/>{pending ? t("正在建立…", "Creating…") : t("選擇輸入目錄並建立", "Choose input folder and create")}</button>
    </form></Modal>}
  </section>;
}
