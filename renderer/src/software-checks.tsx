import { useState } from "react";
import { Check, Download, FileCode2, RefreshCw, Terminal, X } from "lucide-react";
import { download } from "./api";
import { DateText, ErrorNotice, useData, useI18n } from "./ui";
import "./software-checks.css";
interface FileRef { id:string;version:number;name:string }
interface CheckResult {kind:"api"|"sqlite";passed:boolean;checks:{name:string;passed:boolean;expected?:unknown;actual?:unknown;error?:string}[];error?:string}
interface CheckRecord { id:string;execution_id:string;program:string;entry:string;exit_code:number;passed:boolean;stop_reason:string|null;source_digest:string;matches_current_sources:boolean|null;stdout:string;stderr:string;output_truncated:boolean;elapsed_ms:number;created_at:string;receipt:FileRef;artifacts:FileRef;files:{path:string;bytes:number;sha256:string}[];check_result?:CheckResult|null }
function CheckAssertions({result}:{result:CheckResult}) {
  const {t}=useI18n();
  return <div className="software-check-assertions">
    <p className="muted small-text">{result.kind==="api"?t("檢查程式的 HTTP 請求與回應；不涵蓋外部網址或 TLS 連線。","Checks the application's HTTP requests and responses. External URLs and TLS connections are outside this check."):t("使用全新的 SQLite 資料庫檢查 SQL、資料及約束。其他資料庫引擎需要另行驗證。","Checks SQL, data and constraints in a fresh SQLite database. Other database engines require separate validation.")}</p>
    <p className="software-check-count">{result.checks.filter(row=>row.passed).length} / {result.checks.length} {t("項斷言通過","assertions passed")}</p>
    {result.error&&<p className="software-check-error" role="status">{result.error}</p>}
    {result.checks.map((row,index)=><details className="software-check-assertion" key={index+":"+row.name} data-passed={row.passed}>
      <summary><span className="software-assertion-mark" aria-hidden="true">{row.passed?<Check size={14}/>:<X size={14}/>}</span><span>{row.name}</span><small>{row.passed?t("通過","Passed"):t("未通過","Failed")}</small></summary>
      {row.error&&<p className="software-check-error">{row.error}</p>}
      {row.expected!==undefined&&<><p className="small-text">{t("預期結果","Expected result")}</p><pre aria-label={t("預期結果","Expected result")}>{JSON.stringify(row.expected,null,2)}</pre></>}
      {row.actual!==undefined&&<><p className="small-text">{t("實際結果","Actual result")}</p><pre aria-label={t("實際結果","Actual result")}>{JSON.stringify(row.actual,null,2)}</pre></>}
    </details>)}
  </div>;
}
export function SoftwareChecks({base,taskId}:{base:string;taskId:string}) {
  const {t}=useI18n(),[refresh,setRefresh]=useState(0),[cursors,setCursors]=useState<string[]>([]),[downloadError,setDownloadError]=useState<unknown>(null);
  const cursor=cursors.at(-1),url=base+`/tasks/${taskId}/software-checks?limit=10`+(cursor?"&before="+encodeURIComponent(cursor):"");
  const {data,error,loading}=useData<{items:CheckRecord[];next_cursor:string|null}>(url,refresh,5000,"",{retainOnRefresh:true});
  async function getFile(file:FileRef) {setDownloadError(null);try{await download(base+`/assets/${file.id}/download?version=${file.version}`,file.name);}catch(e){setDownloadError(e);}}
  return <section className="software-checks" aria-labelledby="software-checks-heading">
    <header><div><p className="eyebrow">CODE. CHECK. DELIVER.</p><h3 id="software-checks-heading">{t("軟體檢查記錄","Software checks")}</h3></div><button className="icon-button" type="button" disabled={loading} aria-label={t("更新檢查記錄","Refresh software checks")} onClick={()=>setRefresh(v=>v+1)}><RefreshCw size={16}/></button></header>
    <p className="muted small-text">{t("每次檢查保留當時的程式碼版本及結果。通過只代表該次檢查成功；修改程式碼後需要重新檢查。","Each check keeps its source version and result. A pass applies to those checks. Run checks again after changing the code.")}</p>
    <ErrorNotice error={error??downloadError}/>
    {!data&&!error&&<p role="status">{t("正在讀取檢查…","Loading checks…")}</p>}
    {data&&!data.items.length&&<p className="muted">{t("這項工作尚未保存程式檢查結果。你可以在會話中要求助手執行測試。","No program check has been saved for this task. Ask your specialist to run tests in the conversation.")}</p>}
    <div className="software-check-list">{data?.items.map(check=><article className="software-check" key={check.id} data-passed={check.passed}>
      <div className="software-check-result"><span className="software-check-mark" aria-hidden="true">{check.passed?<Check size={18}/>:<X size={18}/>}</span><div><strong>{check.check_result?.kind==="api"?(check.passed?t("API 檢查通過","API checks passed"):t("API 檢查未通過","API checks failed")):check.check_result?.kind==="sqlite"?(check.passed?t("SQLite 檢查通過","SQLite checks passed"):t("SQLite 檢查未通過","SQLite checks failed")):check.passed?t("指令通過","Command passed"):t("指令未通過","Command failed")}</strong><small>{check.program} · {(check.elapsed_ms/1000).toFixed(1)}s · {t("結束碼","Exit")} {check.exit_code}</small></div><span className="software-check-date"><DateText value={check.created_at}/></span></div>
      <p className="software-check-entry"><FileCode2 size={15}/><code>{check.entry}</code></p>
      {check.matches_current_sources===false&&<p className="software-check-stale" role="status">{t("程式碼已變更：這項結果不適用於目前版本。","Code has changed: this result does not apply to the current version.")}</p>}
      {check.stop_reason&&<p className="muted small-text">{({timeout:t("指令超時，已停止。","The command timed out and was stopped."),cancelled:t("指令已取消。","The command was cancelled."),output_limit:t("指令輸出超過上限，已停止。","The command exceeded its output limit and was stopped."),workspace_limit:t("工作檔案超過上限，已停止。","Working files exceeded their limit and the command was stopped.")} as Record<string,string>)[check.stop_reason]??t("指令已停止，請查看完整記錄。","The command was stopped. See the complete record.")}</p>}
      <details><summary><Terminal size={15}/>{t("查看輸出","View output")}</summary>{check.check_result?<CheckAssertions result={check.check_result}/>:check.stdout&&<pre aria-label={t("標準輸出","Standard output")}>{check.stdout}</pre>}{check.stderr&&<pre className="software-check-stderr" aria-label={t("錯誤輸出","Error output")}>{check.stderr}</pre>}{!check.check_result&&!check.stdout&&!check.stderr&&<p className="muted">{t("指令沒有文字輸出。","The command produced no text output.")}</p>}{check.output_truncated&&<p>{t("輸出已達上限，記錄保留上限內的內容。","The output limit was reached; the record keeps the bounded output.")}</p>}<p className="software-check-digest">SHA-256 · {check.source_digest}</p></details>
      <footer><button className="text-button" type="button" onClick={()=>void getFile(check.artifacts)}><Download size={14}/>{t("下載執行檔案","Download execution files")}</button><button className="text-button" type="button" onClick={()=>void getFile(check.receipt)}>{t("下載完整記錄","Download full record")}</button><span className="muted small-text">{check.files.length} {t("個檔案","files")}</span></footer>
    </article>)}</div>
    {(cursors.length>0||data?.next_cursor)&&<nav className="row-actions" aria-label={t("檢查記錄分頁","Check history pages")}>{cursors.length>0&&<button className="text-button" disabled={loading} onClick={()=>setCursors(v=>v.slice(0,-1))}>{t("較新的記錄","Newer checks")}</button>}{data?.next_cursor&&<button className="text-button" disabled={loading} onClick={()=>setCursors(v=>[...v,data.next_cursor!])}>{t("較早的記錄","Older checks")}</button>}</nav>}
  </section>;
}
