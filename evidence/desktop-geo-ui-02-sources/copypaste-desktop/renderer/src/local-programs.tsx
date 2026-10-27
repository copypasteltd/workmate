import { useEffect, useState } from "react";
import { AppWindow, Check, Plus, Terminal, X } from "lucide-react";
import { useI18n } from "./ui";
import "./local-programs.css";
interface Program { id: string; name: string; path: string; sha256: string; active: boolean; approvedAt: string; revokedAt?: string }
interface Receipt {
  id: string; taskId: string; programName: string; argv: string[]; state: string; startedAt: string; finishedAt?: string;
  pid?: number; exitCode?: number | null; stdout: string; stderr: string; outputTruncated: boolean; error?: string; reviewedAt?: string;
}
interface Catalog { ready: boolean; programs: Program[]; receipts: Receipt[] }
async function native(action: string, payload: unknown) {
  const reply = await window.copyPasteBridge!.localAgent("program." + action, payload);
  if (!reply.ok) throw new Error(reply.code ?? "LOCAL_PROGRAM_UNAVAILABLE");
  return reply.value;
}
export function LocalPrograms({ sessionId, fullAccess }: { sessionId: string; fullAccess: boolean }) {
  const { t } = useI18n();
  const [data, setData] = useState<Catalog>({ ready: false, programs: [], receipts: [] });
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [visible, setVisible] = useState(20);
  const explanation = (code: string) => {
    const messages: Record<string, [string, string]> = {
      LOCAL_PROGRAM_FULL_ACCESS_REQUIRED: ["先在此會話設定完整本機權限，再選擇程式。", "Grant this session full local access before choosing a program."],
      LOCAL_PROGRAM_NEW_SESSION_REQUIRED: ["此舊會話保留原工具。請建立新會話以使用本機程式清單。", "This older conversation keeps its original tools. Start a new session to use approved programs."],
      LOCAL_PROGRAM_CHANGED: ["程式已更新或被替換。核對新版本後，重新選擇並批准。", "The program changed or was replaced. Review and approve its new version."],
      LOCAL_PROGRAM_FILE_INVALID: ["請選擇此電腦上的實際 Windows 程式檔案（.exe 或 .com）。", "Choose a real local Windows program (.exe or .com)."],
      LOCAL_PROGRAM_PERMISSION_CHANGED: ["登入或本機權限已變更。核對目前會話後重新選擇。", "Your sign-in or local permission changed. Review the current session before choosing again."],
      LOCAL_PROGRAM_NOT_SUPPORTED: ["此程式不在目前支援範圍，請選擇其他本機工具。", "This program is outside the supported scope. Choose another local tool."],
      LOCAL_PROGRAM_CATALOG_LIMIT: ["此電腦的程式批准記錄已達上限。", "This computer reached its program-approval record limit."],
      LOCAL_PROGRAM_STORAGE_FAILED: ["本機記錄未能儲存，已停止新執行。請核對磁碟及原工作，再重新開啟應用程式。", "Local records could not be saved. New execution stopped. Check the disk and original task before reopening the app."],
    };
    return messages[code] ? t(...messages[code]) : t("未能完成，請核對登入、權限和程式檔案。", "Could not complete. Check your sign-in, permission and program file.") + " · " + code;
  };
  const stateName = (state: string) => t(...({ prepared: ["準備中", "Preparing"], running: ["執行中", "Running"], succeeded: ["已完成", "Completed"], failed: ["未完成", "Failed"], cancelled: ["已停止", "Stopped"], timed_out: ["已逾時", "Timed out"], unknown: ["需要核對", "Review needed"] } as Record<string, [string, string]>)[state] ?? [state, state]);
  useEffect(() => {
    let alive = true, loading = false, timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (loading || !alive) return; loading = true;
      try { const value = await native("list", { id: sessionId }); if (alive) setData(value); }
      catch (e) { if (alive) setError((e as Error).message); }
      finally { loading = false; }
    };
    const off = window.copyPasteBridge!.onLocalAgentChanged(() => { if (!timer) timer = setTimeout(() => { timer = undefined; void load(); }, 250); });
    void load(); const poll = setInterval(() => void load(), 5000);
    return () => { alive = false; off(); clearInterval(poll); if (timer) clearTimeout(timer); };
  }, [sessionId]);
  const act = async (action: string, fields: Record<string, unknown> = {}) => {
    setPending(true); setError("");
    try { await native(action, { id: sessionId, ...fields }); setData(await native("list", { id: sessionId })); }
    catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  };
  return <section className="local-programs" tabIndex={0} aria-label={t("本機程式", "Local programs")}>
    <header className="local-programs-heading"><div><span className="eyebrow">COPYPASTE · YOUR TOOLS</span><h2>{t("把常用工具交給工作夥伴", "Bring your own tools")}</h2><p>{t("選擇並批准此電腦上的程式，再於對話描述要完成的工作。", "Choose and approve programs on this computer, then describe the work in the conversation.")}</p></div>
      <button className="button primary" disabled={pending || !fullAccess || !data.ready} onClick={() => void act("approve")}><Plus size={15}/>{pending ? t("處理中…", "Working…") : t("選擇程式", "Choose program")}</button></header>
    {!data.ready ? <p className="local-programs-note">{explanation("LOCAL_PROGRAM_NEW_SESSION_REQUIRED")}</p> : !fullAccess && <p className="local-programs-note">{explanation("LOCAL_PROGRAM_FULL_ACCESS_REQUIRED")}</p>}
    <p className="local-programs-note">{t("批准只適用於目前會話及本機權限版本。程式以你的 Windows 帳戶執行；停止、撤銷或關閉應用程式會停止本次工作擁有的程式。", "Approval applies to this session and local permission version. Programs run under your Windows account. Stop, revoke or app closure stops the programs owned by this task.")}</p>
    {error && <p className="local-programs-error" role="alert">{explanation(error)}</p>}
    {data.programs.length === 0 ? <div className="local-programs-empty"><AppWindow size={32}/><h3>{t("用熟悉的工具完成工作", "Work with familiar tools")}</h3><p>{t("例如資料處理、影像轉換或開發工具。你選擇程式，Agent 按工作要求提供參數。", "Use data processing, image conversion or development tools. You choose the program; the Agent supplies arguments for the task.")}</p></div>
      : <div className="local-programs-catalog">{data.programs.map(program => <article className="local-program-card" key={program.id} data-program-id={program.id}><div className="local-program-icon"><AppWindow size={20}/></div><div><header><h3>{program.name}</h3><span className={program.active ? "is-active" : ""}>{program.active ? <><Check size={12}/>{t("已批准", "Approved")}</> : program.revokedAt ? t("已撤銷", "Revoked") : t("授權已變更", "Permission changed")}</span></header><p>{program.path}</p><details><summary>{t("程式版本", "Program version")}</summary><code>SHA-256 {program.sha256}</code></details></div>{!program.revokedAt && <button className="button" disabled={pending} onClick={() => void act("revoke", { programId: program.id })}><X size={13}/>{t("撤銷", "Revoke")}</button>}</article>)}</div>}
    <div className="local-programs-history-heading"><Terminal size={17}/><h3>{t("執行記錄", "Run history")}</h3><span>{data.receipts.length}</span></div>
    {!data.receipts.length ? <p className="local-programs-note">{t("開始工作後，這裡會顯示原任務、輸出和實際結束狀態。", "Runs appear here with the original task, output and actual exit status.")}</p> : [...data.receipts].reverse().slice(0, visible).map(receipt => <article className="local-program-run" key={receipt.id} data-program-receipt={receipt.id}>
      <header><strong>{receipt.programName}</strong><span>{stateName(receipt.state)}</span></header><p>{t("原工作", "Original task")} · {receipt.taskId.slice(0, 8)}{receipt.pid ? " · PID " + receipt.pid : ""}{receipt.exitCode !== undefined && receipt.exitCode !== null ? " · " + t("結束代碼", "Exit code") + " " + receipt.exitCode : ""}</p>
      {receipt.state === "unknown" && <><p role="status">{t("請先核對原工作、檔案及費用。此項不會自動重新執行。", "Review the original task, files and costs. This invocation will not rerun automatically.")}</p>{receipt.reviewedAt ? <p>{t("已記錄你的核對；原結果仍為未知。", "Your review is recorded; the original outcome remains unknown.")}</p> : <button className="button" disabled={!fullAccess || pending} onClick={() => void act("review", { receiptId: receipt.id })}>{t("我已核對原工作", "I have reviewed the original run")}</button>}</>}
      <details><summary>{t("參數與輸出", "Arguments and output")}</summary><pre aria-label={t("程式參數", "Program arguments")}>{JSON.stringify(receipt.argv, null, 2)}</pre>{receipt.stdout && <pre aria-label={t("標準輸出", "Standard output")}>{receipt.stdout}</pre>}{receipt.stderr && <pre aria-label={t("錯誤輸出", "Error output")}>{receipt.stderr}</pre>}{receipt.outputTruncated && <p>{t("輸出超過顯示上限；請查看實際成果檔案。", "Output exceeded the display limit. Review the actual output files.")}</p>}{receipt.error && <p>{receipt.error}</p>}</details>
    </article>)}
    {data.receipts.length > visible && <button className="button" onClick={() => setVisible(value => value + 20)}>{t("顯示較早記錄", "Show earlier runs")}</button>}
  </section>;
}
