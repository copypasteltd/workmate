import {useEffect,useId,useRef,useState} from "react";
import {FileText,Paperclip,Upload,X,AtSign} from "lucide-react";
import {CloudAssetPicker} from "./cloud-asset-picker";
import {ResumableUpload} from "./resumable-upload";
import {useI18n} from "./ui";
import "./work-composer.css";
import {browserCrypto as crypto} from "./browser-crypto";

export type WorkAttachment={id:string;assetId:string;name:string};
type Transfer={id:string;file:File};
/** Scope-keyed by the caller. Server authorization remains authoritative. */
export function WorkComposer({value,onChange,attachments,onAttachments,conversationId,disabled=false,onReady,minLength=5,placeholder}:{
 value:string;onChange:(text:string)=>void;attachments:WorkAttachment[];onAttachments:(items:WorkAttachment[])=>void;
 conversationId?:string;disabled?:boolean;onReady?:(ready:boolean)=>void;minLength?:number;placeholder?:string;
}){
 const {t}=useI18n(),uid=useId(),input=useRef<HTMLInputElement>(null),text=useRef<HTMLTextAreaElement>(null);
 const [queue,setQueue]=useState<Transfer[]>([]),[library,setLibrary]=useState(false),[drag,setDrag]=useState(false),[notice,setNotice]=useState("");
 const alive=useRef(true),current=useRef(attachments),transfers=useRef<Transfer[]>([]);current.current=attachments;
 const changeQueue=(items:Transfer[])=>{transfers.current=items;setQueue(items);};
 const callbacks=useRef({onAttachments,onReady});callbacks.current={onAttachments,onReady};
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{callbacks.current.onReady?.(queue.length===0);},[queue.length]);
 const add=(item:WorkAttachment)=>{
  if(!alive.current||current.current.some(a=>a.id===item.id))return;
  if(current.current.length>=20){setNotice(t("每次最多附加20個固定版本。","Attach up to 20 pinned versions."));return;}
  const next=[...current.current,item];current.current=next;callbacks.current.onAttachments(next);setLibrary(false);
 };
 function select(files:File[]){
  if(disabled)return;
  const valid=files.filter(f=>f.size>0&&f.size<=(/^(audio|video)\//.test(f.type)?1024**3:100*1024**2));
  const room=Math.max(0,20-current.current.length-transfers.current.length);
  if(valid.length!==files.length||valid.length>room)setNotice(t("請選擇有效檔案；一般檔案100 MiB、媒體1 GiB，每次最多20個。","Choose valid files: 100 MiB for files, 1 GiB for media, up to 20 attachments."));
  changeQueue([...transfers.current,...valid.slice(0,room).map(file=>({id:crypto.randomUUID(),file}))]);
 }
 return <div className={"work-composer"+(drag?" is-dragging":"")} onDragOver={e=>{if(e.dataTransfer.types.includes("Files")){e.preventDefault();if(!disabled)setDrag(true);}}}
  onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDrag(false);}}
  onDrop={e=>{if(e.dataTransfer.files.length){e.preventDefault();setDrag(false);select([...e.dataTransfer.files]);}}}>
  <label className="sr-only" htmlFor={uid}>{t("你的訊息","Your message")}</label>
  <textarea id={uid} ref={text} value={value} disabled={disabled} minLength={minLength} maxLength={30000} required rows={4}
   placeholder={placeholder??t("描述要完成的工作，拖入檔案，或輸入 @ 引用專案素材…","Describe your work, drop files, or type @ to reference project materials…")}
   onChange={e=>{onChange(e.target.value);if(e.target.value.endsWith("@"))setLibrary(true);}}
   onPaste={e=>{const files=[...e.clipboardData.items].filter(i=>i.kind==="file").map(i=>i.getAsFile()).filter((f):f is File=>!!f);if(files.length){e.preventDefault();select(files);}}}/>
  {!!attachments.length&&<ul className="composer-attachments" aria-label={t("本次固定版本附件","Pinned attachments for this message")}>{attachments.map(a=><li key={a.id}><FileText size={15}/><span>{a.name}</span><button type="button" disabled={disabled} aria-label={t("移除附件 ","Remove attachment ")+a.name} onClick={()=>{const next=current.current.filter(x=>x.id!==a.id);current.current=next;onAttachments(next);}}><X size={14}/></button></li>)}</ul>}
  <div className="composer-tools"><input ref={input} className="sr-only" type="file" multiple disabled={disabled} aria-label={t("選擇附件","Choose attachments")} onChange={e=>{select([...e.target.files??[]]);e.target.value="";}}/>
   <button type="button" className="button quiet" disabled={disabled||queue.length>0} onClick={()=>input.current?.click()}><Paperclip size={16}/>{t("附加檔案","Attach files")}</button>
   <button type="button" className="button quiet" disabled={disabled||queue.length>0} aria-expanded={library} onClick={()=>setLibrary(v=>!v)}><AtSign size={16}/>{t("引用素材","Reference materials")}</button>
   <span className="muted small-text">{t("可貼上圖片 · 固定檔案版本","Paste images · pinned file versions")}</span>
  </div>
  {notice&&<p className="notice" role="status">{notice}</p>}
  {library&&!disabled&&!queue.length&&<div className="composer-library"><CloudAssetPicker shared={false} required={false} onChange={()=>{}} onReady={()=>{}} onReference={item=>{add(item);if(value.endsWith("@"))onChange(value+item.name+" ");text.current?.focus();}}/></div>}
  {!!queue.length&&<div className="composer-transfers" aria-label={t("附件上傳","Attachment uploads")}>
   <p className="muted small-text">{conversationId?t("檔案只加入目前私人會話；傳送後才交給助手。","Files join this private conversation. Send the message to give them to your assistant."):t("檔案加入此專案；有專案權限的成員可使用。","Files join this project and are accessible to its authorized members.")}</p>
   {queue.map((entry,index)=><section key={entry.id}><header><Upload size={15}/><strong>{entry.file.name}</strong><button type="button" className="text-button" disabled={disabled} onClick={()=>changeQueue(transfers.current.filter(x=>x.id!==entry.id))}>{t("移除","Remove")}</button></header>
    <ResumableUpload initialFile={entry.file} autoStart={index===0} conversationId={conversationId} onDone={asset=>{if(!alive.current||!transfers.current.some(x=>x.id===entry.id))return;add({id:asset.version.id,assetId:asset.id,name:asset.name??entry.file.name});changeQueue(transfers.current.filter(x=>x.id!==entry.id));}}/>
   </section>)}
  </div>}
 </div>;
}
