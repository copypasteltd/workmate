import {useEffect,useRef,useState} from "react";
import {ErrorNotice,Modal,useI18n} from "./ui";
import {nativeExecutionRecords,nativeCommandSummary,nativeRecordFailed,type NativeEvent} from "./native-execution-state";

export function NativeExecutionView({sessionId,taskId,events,view}:{sessionId:string;taskId:string;events:NativeEvent[];view:"terminal"|"changes"|"browser"}){
 const {t}=useI18n(),records=nativeExecutionRecords(events,taskId),[preview,setPreview]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState<Error|null>(null),epoch=useRef(0);
 useEffect(()=>{++epoch.current;setPreview(null);setError(null);setBusy(false);return()=>{++epoch.current;};},[sessionId,taskId,view]);
 const items=records.items.filter(r=>view==="terminal"?r.kind==="command":view==="changes"?r.kind==="files":r.kind==="browser"||r.kind==="image");
 async function open(file:string){if(busy)return;setBusy(true);setError(null);const current=epoch.current;
  try{const r=await window.copyPasteBridge!.localAgent("result.preview",{id:sessionId,path:file});if(!r.ok)throw Error(r.code??"LOCAL_RESULT_PREVIEW_FAILED");if(epoch.current===current)setPreview(r.value);}
  catch(e){if(epoch.current===current)setError(e as Error);}finally{if(epoch.current===current)setBusy(false);}
 }
 return <div className="native-execution"><p className="muted">{t("來自原 Desktop 會話的本機執行記錄。這裡不會重跑指令；檔案預覽另行核對目前本機權限。","Records from the original local Desktop session. This view never reruns commands; file previews separately check current local permissions.")}</p><ErrorNotice error={error}/>
  {!items.length&&<p role="status">{t("目前工作尚無此類已綁定記錄；較早未綁定記錄仍可在原會話活動查看。","No bound record of this type is available for the current task. Earlier unbound records remain in the original conversation activity.")}</p>}
  {items.map(record=><article className="native-execution-record" data-failed={nativeRecordFailed(record)||undefined} key={record.id}><header><strong>{record.kind==="command"?t("本機指令","Local command"):record.kind==="files"?t("檔案變更","File changes"):record.kind==="image"?t("本機圖片","Local image"):record.tool}</strong><span>{nativeRecordFailed(record)?t("失敗或已停止","Failed or stopped"):record.status==="inProgress"||record.status==="started"?t("執行中","Running"):record.status==="completed"?t("已完成","Completed"):record.status}{record.exit_code!==null&&record.exit_code!==undefined?" · "+t("結束碼 ","Exit ")+record.exit_code:""}</span></header>
   {record.command&&<details className="native-command"><summary><span>{nativeCommandSummary(record.command)}</span><small>{t("查看指令","View command")}</small></summary><pre className="workbench-output">{record.command}</pre></details>}
   {record.output&&<details className="native-command-output"><summary>{t("查看輸出","View output")}<small>{record.output.split("\n").length} {t("行","lines")}</small></summary><pre className="workbench-output" aria-label={t("本機輸出","Local output")}>{record.output}</pre></details>}
   {record.files?.map((file,index)=><details key={file.path+index}><summary>{file.path}</summary><p className="muted">{t("以下為執行當時的變更記錄，未代表檔案目前內容。","This is the change recorded during execution; it does not assert the file's current contents.")}</p>{file.diff?<pre className="workbench-output">{file.diff}</pre>:<p>{t("原生記錄沒有附帶文字差異。","The native record contains no text diff.")}</p>}<button type="button" className="button secondary" disabled={busy} onClick={()=>void open(file.path)}>{t("預覽目前本機檔案","Preview current local file")}</button></details>)}
   {record.path&&<button type="button" className="button secondary" disabled={busy} onClick={()=>void open(record.path!)}>{t("預覽本機圖片","Preview local image")}</button>}{record.truncated&&<p className="muted">{t("此視圖達顯示上限；請查看原檔和會話活動。","This view reached its display limit. Review original files and conversation activity.")}</p>}
  </article>)}
  {records.truncated&&<p>{t("顯示最近 100 個綁定記錄。","Showing the most recent 100 bound records.")}</p>}
  {preview&&<Modal title={preview.name} onClose={()=>setPreview(null)}><p>{t("目前本機內容，與歷史變更可能不同；原檔未上傳。","Current local content may differ from the historical change; the original was not uploaded.")}</p>{preview.preview_image?<img className="native-result-image" alt={preview.name} src={`data:${preview.preview_image.content_type};base64,${preview.preview_image.base64}`}/>:<pre className="workbench-output">{preview.text}</pre>}<p className="workspace-fingerprint">SHA-256 {preview.sha256}</p></Modal>}
 </div>;
}
