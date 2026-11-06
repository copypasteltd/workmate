"""Apply explicitly shared renderer changes without replacing native execution."""
from pathlib import Path
import shutil

root=Path('D:/dev/copypasted/自有agent/dev')
web=root/'copypaste-web'
desktop=root/'copypaste-desktop'
admin=root/'copypaste-admin'
def replace(file,old,new):
 text=file.read_text(encoding='utf-8')
 if old not in text: raise RuntimeError(f'Implementation anchor missing: {file.name}: {old[:60]}')
 file.write_text(text.replace(old,new,1),encoding='utf-8',newline='\n')

# Reduce initial intake to one brief. The reviewed request still freezes every setting.
p=web/'src/new-work-task.tsx'
replace(p,'title: v.title.trim(), prompt:','title: v.title.trim() || v.prompt.trim().replace(/\\s+/g," ").slice(0,80), prompt:')
replace(p,'maxLength={160} required','maxLength={160}')
text=p.read_text(encoding='utf-8')
start=text.index('          <Field label={t("專案", "Project")}')
prompt_start=text.index('          <Field label={t("你想完成什麼？"',start)
prompt_end=text.index('          {v.role === "video-motion"',prompt_start)
prompt=text[prompt_start:prompt_end]
text=text[:start]+prompt+'          <details className="work-intake-options"><summary>{t("角色、預算與更多設定", "Specialist, budget and more settings")} · HK$ {v.budget}</summary>\n'+text[start:prompt_start]+text[prompt_end:]
end=text.index('        </fieldset>',start)
text=text[:end]+'          </details>\n'+text[end:]
p.write_text(text,encoding='utf-8',newline='\n')
with (web/'src/new-work-task.css').open('a',encoding='utf-8') as f:f.write('\n.work-intake-options{border:1px solid var(--line);border-radius:14px;padding:14px}.work-intake-options summary{cursor:pointer;color:var(--muted);padding:4px 0}.work-intake-options[open]{display:grid;gap:16px}.work-intake-options[open] summary{margin-bottom:16px}\n')

# Keep the real local native runner and its permissions; share only the read-only result view.
for name in ['task-workbench.tsx','task-workbench.css']:
 shutil.copyfile(web/'src'/name,desktop/'renderer/src'/name)
p=desktop/'renderer/src/local-agent.tsx'
replace(p,'import { ProjectConfigurationSummary }','import {TaskWorkbench} from "./task-workbench";\nimport type {LocalFileReference} from "../../src/local-attachments";\nimport { ProjectConfigurationSummary }')
replace(p,'Terminal, X }','Terminal, X, Paperclip, ClipboardPaste, Files }')
replace(p,'  const session = sessions.find(s => s.id === selected);','''  const session = sessions.find(s => s.id === selected);
  const [references,setReferences]=useState<LocalFileReference[]>([]),[attachmentBusy,setAttachmentBusy]=useState(false);
  const currentSession=useRef(selected);currentSession.current=selected;
  const attachmentGeneration=useRef(0);
  useEffect(()=>{++attachmentGeneration.current;setReferences([]);setAttachmentBusy(false);setPrompt("");return()=>{++attachmentGeneration.current;};},[workspaceKey,selected]);
  async function attachLocal(action:string,paths?:string[]){
    if(!session||attachmentBusy||pending||session.busy||session.revoked||session.uncertain)return;
    const scope=workspaceKey,id=session.id,revision=attachmentGeneration.current;
    setAttachmentBusy(true);setError("");
    try{const items=await native(action,{id,...(paths?{paths}:{})});
      if(activeWorkspace.current!==scope||currentSession.current!==id||revision!==attachmentGeneration.current)return;
      setReferences(old=>{const next=[...new Map([...old,...items].map(item=>[item.path,item])).values()];return next.slice(0,20);});
    }catch(error){if(revision===attachmentGeneration.current)setError((error as Error).message);}
    finally{if(revision===attachmentGeneration.current)setAttachmentBusy(false);}
  }''')
replace(p,'if (action === "create" && result?.id && activeWorkspace.current === scope) setSelected(result.id);','if (action === "create" && result?.id && activeWorkspace.current === scope) setSelected(result.id);\n      return {ok:true};')
replace(p,'setActionErrors(current => ({ ...current, [key]: (e as Error).message }));','setActionErrors(current => ({ ...current, [key]: (e as Error).message }));\n      return {ok:false};')
replace(p,'const text = session.role === "video-motion" ? videoGenerationBrief(prompt.trim(), form) : prompt.trim(); setPrompt("");\n      void act("send", { id: session.id, prompt: text, budget: micros });','''const text = session.role === "video-motion" ? videoGenerationBrief(prompt.trim(), form) : prompt.trim();
      const brief=text+(references.length?"\\n\\nCustomer-selected local file references (read only within the current granted permissions; references do not grant additional access):\\n"+JSON.stringify(references.map(item=>({path:item.path,name:item.name}))) : "");
      if(brief.length>30000)throw new Error("LOCAL_REQUEST_INVALID");
      const id=session.id,scope=workspaceKey;
      void act("send", { id, prompt: brief, budget: micros }).then(result=>{if(result?.ok&&currentSession.current===id&&activeWorkspace.current===scope){setPrompt("");setReferences([]);}});''')
replace(p,'<button aria-pressed={panel === "folders"}','<button aria-pressed={panel === "results"} onClick={()=>setPanel("results")}><Files size={14}/>{t("成果與檔案","Results and files")}</button><button aria-pressed={panel === "folders"}')
replace(p,'<form className="local-agent-composer" onSubmit=', '''<form className="local-agent-composer" onDragOver={e=>{if(e.dataTransfer.types.includes("Files"))e.preventDefault();}} onDrop={e=>{if(!e.dataTransfer.files.length)return;e.preventDefault();const paths=[...e.dataTransfer.files].map(file=>window.copyPasteBridge!.localFilePath(file)).filter(Boolean);void attachLocal("attachment.references",paths);}} onSubmit=''')
replace(p,'value={prompt} onChange={e => setPrompt(e.target.value)} disabled={session.revoked || session.uncertain || session.busy || pending}', '''value={prompt} onChange={e => setPrompt(e.target.value)} onPaste={e=>{if([...e.clipboardData.items].some(item=>item.kind==="file"&&item.type.startsWith("image/"))){e.preventDefault();void attachLocal("attachment.paste-image");}}} disabled={session.revoked || session.uncertain || session.busy || pending||attachmentBusy}''')
replace(p,'{session.role === "video-motion" && <VideoBriefFields compact', '''{!!references.length&&<ul className="local-input-references" aria-label={t("本次本機附件","Local references for this turn")}>{references.map(file=><li key={file.path}><span title={file.path}>{file.name}</span><button type="button" disabled={pending||session.busy} aria-label={t("移除 ","Remove ")+file.name} onClick={()=>setReferences(old=>old.filter(item=>item.path!==file.path))}><X size={14}/></button></li>)}</ul>}
          <div className="local-input-tools"><button type="button" className="button" disabled={pending||session.busy||session.revoked||session.uncertain||attachmentBusy||!session.permission} onClick={()=>void attachLocal("attachment.choose")}><Paperclip size={14}/>{t("本機附件","Local references")}</button><button type="button" className="button" disabled={pending||session.busy||session.revoked||session.uncertain||attachmentBusy||!session.permission||session.permission==="read-only"} onClick={()=>void attachLocal("attachment.paste-image")}><ClipboardPaste size={14}/>{t("貼上圖片","Paste image")}</button><small>{attachmentBusy?t("正在準備附件…","Preparing references…"):t("可拖入檔案；原檔留在本機。貼圖副本存於工作目錄。","Drop files; originals remain local. Pasted images save a copy in the workspace.")}</small></div>
          {session.role === "video-motion" && <VideoBriefFields compact''')
replace(p,'disabled={pending || !session.permission || session.revoked || session.uncertain || !prompt.trim()}','disabled={pending || attachmentBusy||!session.permission || session.revoked || session.uncertain || !prompt.trim()}')
replace(p,'</div>{panel === "folders" &&', '''</div>{panel === "results"&&<div className="local-agent-results"><TaskWorkbench taskId={session.task?.task_id} review={session.task?<DeliveryQuality key={w.base+session.task.task_id} base={w.base} taskId={session.task.task_id} nativeRevision={async(selection,instructions,budget,requestId)=>{if(activeWorkspace.current!==workspaceKey)throw new Error("LOCAL_ACCOUNT_CHANGED");try{return await native("revision",{id:session.id,requestId,prompt:instructions,budget,selection});}finally{await refresh.current();}}}/>:null}/></div>}{panel === "folders" &&''')
with (desktop/'renderer/src/local-agent.css').open('a',encoding='utf-8') as f:f.write('''
.local-input-references{display:flex;flex-wrap:wrap;gap:6px;list-style:none;padding:0;margin:4px 0}.local-input-references li{display:flex;align-items:center;gap:6px;max-width:100%;border:1px solid var(--line);border-radius:10px;padding:2px 6px 2px 10px}.local-input-references span{overflow-wrap:anywhere;min-width:0}.local-input-references button{border:0;background:none;color:var(--ink);min-width:32px;min-height:32px}.local-input-tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.local-input-tools small{color:var(--muted);font-size:11px;line-height:1.6}.local-agent-results{flex:1;min-height:0;overflow:auto;overflow-x:hidden;padding:18px}.local-agent-tabs{flex-wrap:wrap}.local-agent-composer:focus-within{outline:2px solid var(--blue);outline-offset:-2px}
''')

# Each modal owns its focus boundary. Nested dialogs no longer trap the parent.
modal='''export function Modal({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}){
 const close=useRef(onClose);close.current=onClose;
 const dialog=useRef<HTMLElement>(null),{t}=useI18n();
 useEffect(()=>{
  const element=dialog.current!,previous=document.activeElement as HTMLElement|null;
  modalFocusStack.push(element);
  if(MODAL_LOCK++===0){previousBodyOverflow=document.body.style.overflow;document.body.style.overflow="hidden";}
  const focusable=()=>[...element.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex="0"]')].filter(node=>!node.matches(':disabled,[aria-hidden="true"]')&&node.getClientRects().length>0);
  const key=(event:KeyboardEvent)=>{
   if(modalFocusStack.at(-1)!==element||event.defaultPrevented)return;
   if(event.key==="Escape"){event.preventDefault();event.stopPropagation();close.current();}
   if(event.key==="Tab"){const items=focusable(),first=items[0],last=items.at(-1);
    if(!first){event.preventDefault();element.focus();}
    else if(event.shiftKey&&(document.activeElement===first||!element.contains(document.activeElement))){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&(document.activeElement===last||!element.contains(document.activeElement))){event.preventDefault();first.focus();}
   }
  };
  document.addEventListener("keydown",key);
  const frame=requestAnimationFrame(()=>{if(modalFocusStack.at(-1)===element)(focusable()[0]??element).focus();});
  return()=>{cancelAnimationFrame(frame);document.removeEventListener("keydown",key);const index=modalFocusStack.indexOf(element);if(index>=0)modalFocusStack.splice(index,1);if(--MODAL_LOCK===0)document.body.style.overflow=previousBodyOverflow;if(previous?.isConnected)previous.focus();};
 },[]);
 return <div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&modalFocusStack.at(-1)===dialog.current)close.current();}}><section ref={dialog} className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}><header><h2>{title}</h2><button type="button" className="icon-button" onClick={onClose} aria-label={t("關閉","Close")}><X size={20}/></button></header>{children}</section></div>;
}
'''
for file,lock in [(web/'src/ui.tsx','modalBodyLocks'),(admin/'src/ui.tsx','modalLocks'),(desktop/'renderer/src/ui.tsx','modalBodyLocks')]:
 text=file.read_text(encoding='utf-8');a=text.index('export function Modal(');b=text.index('export function PageHeader(',a)
 text=text[:a]+modal.replace('MODAL_LOCK',lock)+'\n'+text[b:]
 text=text.replace('let previousBodyOverflow = "";','let previousBodyOverflow = "";\nconst modalFocusStack:HTMLElement[]=[];',1)
 file.write_text(text,encoding='utf-8',newline='\n')
print('Integrated implementation applied; no tests or builds executed.')
