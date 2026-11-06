import {useEffect,useRef,useState} from "react";
import {api,ApiError,download,clientSessionGeneration} from "./api";
import {readWorkspaceSave,prepareWorkspaceSave,keepWorkspaceSave,forgetWorkspaceSave,type WorkspaceSave} from "./workspace-edit-state";
import {useWorkspace} from "./context";
import {ErrorNotice,Field,Loading,Modal,useData,useI18n} from "./ui";

export function WorkspaceChanges({taskId,files}:{taskId:string;files:any[]}){
 const w=useWorkspace(),{t}=useI18n(),[file,setFile]=useState(""),[against,setAgainst]=useState(""),[failure,setFailure]=useState<Error|null>(null);
 const selected=files.find(f=>f.version_id===file),path=w.base+"/tasks/"+taskId+"/workspace";
 const versions=useData(selected?path+"/versions?asset_version_id="+selected.version_id:null,0,5000,"",{retainOnRefresh:true});
 const eligible=versions.data?.items??[],valid=eligible.some((v:any)=>v.asset_version_id===against);
 const diff=useData(selected&&valid?path+"/compare?"+new URLSearchParams({asset_version_id:selected.version_id,against_version_id:against}):null);
 useEffect(()=>{setAgainst("");},[file]);
 return <div className="workspace-changes"><p className="muted">{t("選擇目前交付與可用的舊版本。原稿會保留；差異不會執行程式或修改檔案。","Compare the current delivery with an available earlier version. Originals remain; comparison does not execute code or modify files.")}</p>
  <Field label={t("目前交付檔案","Current deliverable")}><select value={selected?.version_id??""} onChange={e=>setFile(e.target.value)}><option value="">{t("選擇檔案…","Choose a file…")}</option>{files.map(f=><option key={f.version_id} value={f.version_id}>{f.name} · v{f.version}</option>)}</select></Field>
  <ErrorNotice error={versions.error??diff.error??failure}/>{versions.loading&&!versions.data&&<Loading/>}
  {versions.data&&<><Field label={t("對比版本","Compare against")}><select value={valid?against:""} onChange={e=>setAgainst(e.target.value)}><option value="">{t("選擇舊版本…","Choose an earlier version…")}</option>{eligible.map((v:any)=><option key={v.asset_version_id} value={v.asset_version_id}>{v.name} · v{v.version} · {v.origin==="original_delivery"?t("原交付","Original delivery"):t("版本記錄","Version history")} · {v.asset_version_id.slice(0,8)}</option>)}</select></Field>
   {!eligible.length&&<p role="status">{t("此檔案沒有可存取的舊版本。首次交付不會產生虛構差異。","No earlier authorized version is available. A first delivery has no invented baseline.")}</p>}
   {versions.data.truncated&&<p className="muted">{t("顯示最近100個檔案版本及最多200份原交付。","Showing up to100 recent file versions and200 original deliverables.")}</p>}
   {valid&&diff.loading&&!diff.data&&<Loading/>}{valid&&diff.data&&<><p role="status">{diff.data.identical?t("兩個版本內容完全相同。","The versions contain identical bytes."):diff.data.state==="ready"?t(`新增 ${diff.data.added} 行，移除 ${diff.data.removed} 行。`,`Added ${diff.data.added} lines; removed ${diff.data.removed}.`):t("此格式或差異超出線上文字比對範圍；請下載兩份原檔檢視。","This format or comparison exceeds the online text limits. Download both originals to compare.")}</p>
    {diff.data.format_changed&&<p className="notice">{t("換行或 UTF-8 BOM 也已改變，文字差異之外請一併檢查。","Line endings or the UTF-8 BOM also changed. Review this format change alongside the text.")}</p>}
    {diff.data.lines&&<ol className="workspace-diff" aria-label={t("固定版本文字差異","Pinned text differences")}>{diff.data.lines.map((line:any,i:number)=><li key={i} data-kind={line.kind}><span aria-hidden="true">{line.old_line??""}</span><span aria-hidden="true">{line.new_line??""}</span><code>{line.kind==="skip"?t(`略去 ${line.count} 行未改動內容`,`Omitted ${line.count} unchanged lines`):(line.kind==="add"?"+ ":line.kind==="remove"?"− ":"  ")+(line.text??"")}</code></li>)}</ol>}
    <div className="row-actions">{[diff.data.before,diff.data.after].map((v:any,i:number)=><button key={v.asset_version_id} type="button" className="text-button" onClick={()=>{setFailure(null);void download(`${w.base}/assets/${v.asset_id}/download?version=${v.version}`,v.name).catch(setFailure);}}>{i===0?t("下載舊版本","Download earlier"):t("下載目前版本","Download current")}</button>)}</div>
    <details><summary>{t("版本與完整性","Versions and integrity")}</summary><pre className="workspace-fingerprint">{[diff.data.before,diff.data.after].map((v:any)=>v.name+" · v"+v.version+"\nSHA-256 "+v.sha256).join("\n\n")}</pre></details>
   </>}
  </>}
 </div>;
}

export function WorkspaceTextEditor({taskId,file,onClose,onSaved}:{taskId:string;file:any;onClose:()=>void;onSaved:()=>void}){
 const w=useWorkspace(),{t}=useI18n(),[refresh,setRefresh]=useState(0),[text,setText]=useState(""),[initialized,setInitialized]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<Error|null>(null);
 const path=w.base+"/tasks/"+taskId+"/workspace",scope=w.me.user.id+":"+w.base+":"+taskId,live=useRef(true),generation=useRef(clientSessionGeneration()),lock=useRef(false);
 const [initial]=useState(()=>{try{return {pending:readWorkspaceSave(scope,file.id),error:null};}catch(e){return {pending:null,error:e as Error};}});
 const [pending,setPending]=useState<WorkspaceSave|null>(initial.pending),attempt=useRef<WorkspaceSave|null>(initial.pending),[persistent,setPersistent]=useState(true);
 const source=useData(path+"/editor?asset_version_id="+file.version_id,refresh,5000,"",{retainOnRefresh:true}),data=source.data;
 useEffect(()=>{if(!initialized&&(pending||data?.state==="ready")){setText(pending?.body.text??data.text);setInitialized(true);}},[data,initialized,pending]);
 useEffect(()=>{live.current=true;const ended=()=>{live.current=false;setText("");setPending(null);attempt.current=null;};window.addEventListener("copypaste:session-ended",ended);return()=>{live.current=false;window.removeEventListener("copypaste:session-ended",ended);};},[]);
 async function save(){
  if(lock.current||initial.error||!live.current||generation.current!==clientSessionGeneration()||!attempt.current&&!data?.can_edit)return;
  lock.current=true;setBusy(true);setError(null);
  let request=attempt.current;
  try{
   if(!request){request=prepareWorkspaceSave({asset_version_id:file.version_id,expected_task_version:data.task_version,expected_delivery_hash:data.delivery_hash,expected_sha256:data.file.sha256,text});attempt.current=request;setPending(request);setPersistent(keepWorkspaceSave(scope,file.id,request));}
   if(!live.current||generation.current!==clientSessionGeneration())return;
   await api(path+"/edit",{method:"POST",headers:{"Idempotency-Key":request.key},body:JSON.stringify(request.body)});
   forgetWorkspaceSave(scope,file.id);
   if(live.current&&generation.current===clientSessionGeneration()){attempt.current=null;setPending(null);onSaved();}
  }catch(e){
   if(!live.current)return;
   const definite=e instanceof ApiError&&e.status>=400&&e.status<500&&![401,408,425,429].includes(e.status)&&!["SESSION_CHANGED","IDEMPOTENCY_CONFLICT"].includes(e.code);
   if(definite){forgetWorkspaceSave(scope,file.id);attempt.current=null;setPending(null);setRefresh(v=>v+1);}
   setError(e as Error);
  }finally{lock.current=false;if(live.current)setBusy(false);}
 }
 return <Modal title={t("編輯文字副本 · ","Edit text copy · ")+file.name} onClose={()=>{if(!busy)onClose();}}>
  <p className="muted">{t("儲存會新增檔案版本，保留原稿；人工編輯不啟動 AI 或產生模型費用。關閉前請儲存需要保留的修改。","Saving creates a new version and preserves the original. Manual editing starts no AI work or model charge. Save changes you need before closing.")}</p>
  <ErrorNotice error={initial.error??error??source.error}/>{source.loading&&!initialized&&<Loading/>}
  {!persistent&&<p role="status">{t("此瀏覽器不能保存待確認記錄；重新整理可能遺失內容，請先核對原儲存。","This browser cannot persist the pending save. Reloading may lose its contents; check the original save first.")}</p>}
  {pending&&<p className="notice" role="status">{t("這份儲存的結果尚未確認。重試會核對原請求；內容已鎖定。記錄保存在此分頁，重新開啟同一檔案可接續核對。","This save is unconfirmed. Retry checks the original request; its contents are locked. The record stays in this tab; reopen the same file to resume checking.")}</p>}
  {initial.error&&<button type="button" className="button secondary" onClick={()=>{forgetWorkspaceSave(scope,file.id);onClose();}}>{t("清除此分頁損壞記錄並查看交付","Clear this tab's damaged record and review delivery")}</button>}
  {data?.state==="ready"&&<><p className="muted">v{data.file.version} · UTF-8{data.format.bom?" BOM":""} · {data.format.newline.toUpperCase()}</p>
   {!data.can_edit&&<p role="status">{data.reason==="mixed_newlines"?t("此檔案混合換行格式，請下載原檔或交給原任務修改。","This file mixes line endings. Download the original or request a task revision."):t("目前權限或工作狀態只允許檢視。Desktop 原檔請在本機修改。","Current permissions/task state allow viewing only. Edit Desktop originals locally.")}</p>}
   <Field label={t("文字內容","Text content")}><textarea className="workspace-editor-text" value={text} onChange={e=>setText(e.target.value)} readOnly={!data.can_edit||busy||!!pending} spellCheck={false} maxLength={262144} rows={16}/></Field>
  </>}
  {data?.state==="download_required"&&<p>{t("請下載原檔或要求整份修改此格式。","Download the original or request a complete-file revision for this format.")}</p>}
  <div className="row-actions"><button className="button primary" type="button" disabled={!!initial.error||busy||!pending&&!data?.can_edit} onClick={()=>void save()}>{busy?t("正在核對儲存…","Checking save…"):pending?t("核對原儲存","Check original save"):t("儲存新版本","Save new version")}</button>
   {!pending&&<button type="button" className="button secondary" disabled={busy} onClick={()=>setRefresh(v=>v+1)}>{t("重新核對交付","Recheck delivery")}</button>}
   <button type="button" className="button quiet" disabled={busy} onClick={onClose}>{pending?t("關閉，稍後核對原儲存","Close and check the original save later"):t("關閉","Close")}</button></div>
 </Modal>;
}
