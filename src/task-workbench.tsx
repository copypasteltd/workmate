import {useEffect,useId,useRef,useState,type ReactNode} from "react";
import {Link} from "react-router-dom";
import {Download,Files,FileText,Activity,Wallet,ChevronLeft,ChevronRight,GitCompare,Terminal,Globe,PenLine} from "lucide-react";
import {useWorkReviewState,useWorkLocation} from "./work-navigation";
import {download} from "./api";
import {useWorkspace} from "./context";
import {Badge,DateText,ErrorNotice,Loading,Money,useData,useI18n} from "./ui";
import {ConversationDeliveryDownload} from "./delivery-quality";
import {SoftwareChecks} from "./software-checks";
import {WorkspaceChanges,WorkspaceTextEditor} from "./workspace-edit";
import "./task-workbench.css";

const tabs=["results","files","changes","terminal","browser","activity","usage"] as const;
type Tab=typeof tabs[number];
type NativeViews={changes:ReactNode;terminal:ReactNode;browser:ReactNode};
export function TaskWorkbench({taskId,refresh=0,review,native}:{taskId?:string;refresh?:number;review?:ReactNode;native?:NativeViews}){
 const w=useWorkspace(),{t}=useI18n();
 if(!taskId)return <section className="card task-workbench"><h3>{t("成果工作區","Work results")}</h3><p className="muted">{t("交辦後，成果、檔案、進度和費用會集中在這裡。","Your results, files, progress and usage appear here after delegation.")}</p></section>;
 return <Workspace key={w.me.user.id+":"+w.base+":"+taskId} taskId={taskId} refresh={refresh} review={review} native={native}/>;
}
function Workspace({taskId,refresh,review,native}:{taskId:string;refresh:number;review?:ReactNode;native?:NativeViews}){
 const w=useWorkspace(),{t}=useI18n(),uid=useId(),tabButtons=useRef<Array<HTMLButtonElement|null>>([]);
 const remembered=useWorkReviewState(taskId),work=useWorkLocation(),tab=remembered.tab;
 const [error,setError]=useState<Error|null>(null),[editing,setEditing]=useState<any>(null),[revision,setRevision]=useState(0);
 const result=useData(w.base+"/tasks/"+taskId+"/workspace",refresh+revision,5000,"",{retainOnRefresh:true}),task=result.data?.task,files=result.data?.files??[];
 const selected=files.find((f:any)=>f.version_id===remembered.selected)??null;
 const setTab=(value:Tab)=>remembered.save({tab:value,selected:remembered.selected});
 const setSelected=(file:any)=>remembered.save({tab,selected:file?.version_id??""});
 const activity=useData(tab==="activity"?w.base+"/tasks/"+taskId+"/events":"",refresh,tab==="activity"?5000:0);
 const labels={results:t("成果","Results"),files:t("檔案","Files"),changes:t("變更","Changes"),terminal:t("執行","Execution"),browser:t("網頁","Browser"),activity:t("活動","Activity"),usage:t("費用","Usage")};
 const icons={results:FileText,files:Files,changes:GitCompare,terminal:Terminal,browser:Globe,activity:Activity,usage:Wallet};
 useEffect(()=>{if(result.data&&!result.error&&remembered.selected&&!files.some((f:any)=>f.version_id===remembered.selected))setSelected(null);},[result.data]);
 return <section className="card task-workbench" aria-label={t("工作成果與活動","Work results and activity")}>
  <header className="workbench-heading"><h3>{task?.title??t("成果工作區","Work results")}</h3>{task&&<Badge value={task.status}/>}</header>
  <div className="workbench-tabs" role="tablist" aria-label={t("成果檢視","Result views")} onKeyDown={e=>{let index=tabs.indexOf(tab);if(e.key==="ArrowRight")index=(index+1)%tabs.length;else if(e.key==="ArrowLeft")index=(index+tabs.length-1)%tabs.length;else if(e.key==="Home")index=0;else if(e.key==="End")index=tabs.length-1;else return;e.preventDefault();setTab(tabs[index]);tabButtons.current[index]?.focus();}}>
   {tabs.map((key,index)=>{const Icon=icons[key];return <button key={key} ref={el=>{tabButtons.current[index]=el;}} id={uid+key} type="button" role="tab" aria-selected={tab===key} aria-controls={uid+"panel"} tabIndex={tab===key?0:-1} onClick={()=>setTab(key)}><Icon size={16}/>{labels[key]}{key==="files"&&!!files.length&&<span>{files.length}</span>}</button>;})}
  </div>
  <div className="workbench-panel" id={uid+"panel"} role="tabpanel" aria-labelledby={uid+tab} tabIndex={0}>
   <ErrorNotice error={result.error??error}/>{result.loading&&!task&&<Loading/>}
   {task&&tab==="results"&&<>{task.output?<pre className="workbench-output">{task.output}</pre>:<p className="muted">{["queued","running","needs_input","paused"].includes(task.status)?t("成果會隨工作進度更新。","Results will appear as the work progresses."):t("此工作沒有文字成果；請查看檔案及活動。","This task has no written result. Check files and activity.")}</p>}
    {review??<ConversationDeliveryDownload base={w.base} taskId={taskId}/>}</>}
   {task&&tab==="files"&&<>{files.length?<ul className="workbench-files">{files.map((file:any)=><li key={file.version_id}><button type="button" className="workbench-file" aria-pressed={selected?.version_id===file.version_id} onClick={()=>setSelected(file)}><FileText size={18}/><span><strong>{file.name}</strong><small>v{file.version} · {(Number(file.bytes)/1024).toFixed(1)} KiB</small></span></button><button type="button" className="icon-button" aria-label={t("下載 ","Download ")+file.name} onClick={()=>void download(`${w.base}/assets/${file.id}/download?version=${file.version}`,file.name).catch(setError)}><Download size={17}/></button></li>)}</ul>:<p className="muted">{t("尚無交付檔案。文字回覆顯示在成果頁。","No deliverable files yet. Written replies appear under Results.")}</p>}
    {result.data.files_truncated&&<Link to={work.path("/app/files")}>{t("查看全部檔案","View all files")}</Link>}{selected&&<><PinnedPreview key={selected.version_id} taskId={taskId} file={selected}/>{task.execution_location!=="desktop"&&/^(text\/|application\/(json|xml|javascript|x-yaml)$)/.test(selected.mime_type)&&<button type="button" className="button secondary" onClick={()=>setEditing(selected)}><PenLine size={15}/>{t("檢視與編輯文字","View and edit text")}</button>}</>}</>}
   {task&&tab==="changes"&&(native?native.changes:<WorkspaceChanges taskId={taskId} files={files}/>)}
   {task&&tab==="terminal"&&(native?native.terminal:task.execution_location==="desktop"?<p>{t("本機執行記錄保存在原 Desktop 會話，請回到該電腦查看。","Local execution history stays in the original Desktop session. Open it on that computer.")}</p>:<SoftwareChecks key={w.base+taskId+"terminal"} base={w.base} taskId={taskId} view="terminal"/>)}
   {task&&tab==="browser"&&(native?native.browser:task.execution_location==="desktop"?<p>{t("本機瀏覽器由原 Desktop 會話管理。","The original Desktop session manages its local browser.")}</p>:<SoftwareChecks key={w.base+taskId+"browser"} base={w.base} taskId={taskId} view="browser"/>)}
   {task&&tab==="activity"&&<><ErrorNotice error={activity.error}/>{activity.loading&&!activity.data&&<Loading/>}<ol className="workbench-activity">{activity.data?.items?.map((event:any)=><li key={event.id}><strong>{String(event.body?.label??event.kind).replaceAll("_"," ")}</strong><DateText value={event.created_at}/>{event.body?.status&&<Badge value={event.body.status}/>}</li>)}</ol>{activity.data?.items?.length===200&&<p className="muted">{t("顯示最早200條事件；完整進度見工作詳情。","Showing the first 200 events. Open task details for the complete stream.")}</p>}</>}
   {task&&tab==="usage"&&<dl className="workbench-usage"><dt>{t("預算上限","Budget limit")}</dt><dd><Money value={task.budget_micros}/></dd><dt>{t("已結算","Settled")}</dt><dd><Money value={task.charged_micros}/></dd><dt>{t("已記錄用量","Recorded usage")}</dt><dd><Money value={task.accrued_micros??task.charged_micros}/></dd><dt>{t("輸入 / 輸出 tokens","Input / output tokens")}</dt><dd>{task.input_tokens??0} / {task.output_tokens??0}</dd></dl>}
  </div>
  {editing&&<WorkspaceTextEditor key={editing.version_id} taskId={taskId} file={editing} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);setSelected(null);setRevision(v=>v+1);}}/>}
  {work.currentPath!=="/app/tasks/"+taskId&&<Link className="text-link workbench-detail" to={work.path("/app/tasks/"+taskId)} state={work.returnState}>{t("完整工作與交付審閱","Full task and delivery review")} →</Link>}
 </section>;
}
function PinnedPreview({taskId,file}:{taskId:string;file:any}){
 const w=useWorkspace(),{t}=useI18n(),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0);
 const doc=/\.(pdf|docx|xlsx|pptx)$/i.test(file.name)||file.mime_type==="application/pdf";
 // The containing workspace reauthorizes every five seconds. Render each page
 // only on selection/retry rather than running Office/PDF workers on a timer.
 const data=useData(doc?`${w.base}/assets/${file.id}/document-preview?asset_version_id=${file.version_id}&page=${page}`:`${w.base}/tasks/${taskId}/workspace/preview?asset_version_id=${file.version_id}`,refresh);
 const p=data.data,image=p?.preview_image;
 return <section className="workbench-preview" aria-label={t("固定版本預覽","Pinned version preview")}><h4>{file.name} · v{file.version}</h4><ErrorNotice error={data.error}/>{data.loading&&!p&&<Loading/>}
  {image?<img alt={file.name+(doc?" · "+page:"")} src={`data:${image.content_type};base64,${image.base64}`}/>:p?.text!==undefined?<pre>{p.text}</pre>:p&&<p className="muted">{p.document_preview?.state==="setup_required"?t("伺服器尚未啟用 Office 預覽；可下載原檔。","Office preview is not enabled on the server. Download the original."):t("此檔案請下載原檔預覽。","Download the original to preview this file.")}</p>}
  {p?.page_count>1&&<nav aria-label={t("預覽頁碼","Preview pages")}><button type="button" className="icon-button" disabled={page===1||data.loading} aria-label={t("上一頁","Previous page")} onClick={()=>setPage(n=>n-1)}><ChevronLeft size={16}/></button><span>{page} / {p.page_count}</span><button type="button" className="icon-button" disabled={page>=p.page_count||data.loading} aria-label={t("下一頁","Next page")} onClick={()=>setPage(n=>n+1)}><ChevronRight size={16}/></button></nav>}
  {data.error&&<button type="button" className="text-button" onClick={()=>setRefresh(n=>n+1)}>{t("重新檢查權限與預覽","Recheck access and preview")}</button>}
 </section>;
}
