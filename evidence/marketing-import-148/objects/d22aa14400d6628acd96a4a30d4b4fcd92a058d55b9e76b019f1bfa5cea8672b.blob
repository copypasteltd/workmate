import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Link2, RefreshCw } from "lucide-react";
import { api, download } from "./api";
import { useWorkspace } from "./context";
import { ErrorNotice, Loading, Modal, useI18n } from "./ui";
import "./cloud-document-preview.css";
export function CloudFilePreview({node,onClose}:{node:{id:string;name:string;asset_version_id?:string};onClose:()=>void}){
  const w=useWorkspace(),{t}=useI18n(),[reference,setReference]=useState<any|null>(null),[loading,setLoading]=useState(true),
    [error,setError]=useState<Error|null>(null),[refresh,setRefresh]=useState(0),[page,setPage]=useState(1),[count,setCount]=useState(0),
    [jump,setJump]=useState("1"),[result,setResult]=useState<any|null>(null),[rendering,setRendering]=useState(false),[previewError,setPreviewError]=useState<Error|null>(null),
    [copied,setCopied]=useState(false),current=useRef<any|null>(null);
  useEffect(()=>{const c=new AbortController();let pending=false,ended=false;
    const clear=()=>{current.current=null;setReference(null);setResult(null);setCount(0);};
    const check=async()=>{if(pending||c.signal.aborted||ended)return;pending=true;
      try{const next=await api(w.base+"/cloud-nodes/"+node.id+"/reference",{signal:c.signal});if(c.signal.aborted||ended)return;
        if(node.asset_version_id&&next.asset_version_id!==node.asset_version_id||current.current&&(next.asset_version_id!==current.current.asset_version_id||next.sha256!==current.current.sha256))throw new Error(t("引用已更改，請關閉後重新開啟檔案。","This reference changed. Close and reopen the file."));
        current.current=next;setReference(next);setError(null);
      }catch(e){if(!c.signal.aborted&&!ended){clear();setError(e as Error);}}finally{pending=false;if(!c.signal.aborted&&!ended)setLoading(false);}};
    const sessionEnded=()=>{ended=true;c.abort();clear();setLoading(false);};
    window.addEventListener("copypaste:session-ended",sessionEnded);void check();const timer=setInterval(()=>void check(),4000);
    return()=>{c.abort();clearInterval(timer);window.removeEventListener("copypaste:session-ended",sessionEnded);};
  },[w.base,node.id,node.asset_version_id,refresh]);
  useEffect(()=>{setJump(String(page));},[page]);
  const version=reference?.asset_version_id,sha=reference?.sha256,hasSimple=reference&&(reference.text!==undefined||reference.preview_image);
  useEffect(()=>{const c=new AbortController();setResult(null);setPreviewError(null);if(!version||hasSimple){setRendering(false);return()=>c.abort();}
    setRendering(true);void api(w.base+"/cloud-nodes/"+node.id+"/document-preview?asset_version_id="+version+"&page="+page,{signal:c.signal})
      .then(value=>{if(c.signal.aborted)return;if(value.asset_version_id!==version||value.sha256!==sha)throw new Error(t("檔案版本已改變，請重新開啟。","The file version changed. Reopen it."));
        setResult(value);if(value.page_count)setCount(value.page_count);})
      .catch(e=>{if(!c.signal.aborted)setPreviewError(e);}).finally(()=>{if(!c.signal.aborted)setRendering(false);});return()=>c.abort();
  },[w.base,node.id,version,sha,page,!!hasSimple,refresh]);
  const picture=hasSimple?reference?.preview_image:result?.preview_image;
  const image=picture&&["image/png","image/jpeg","image/webp","image/gif"].includes(picture.content_type)?"data:"+picture.content_type+";base64,"+picture.base64:null;
  return <Modal title={error&&!reference?t("檔案預覽","File preview"):node.name} onClose={onClose}><ErrorNotice error={error}/>
    {loading&&<Loading/>}{reference&&<><p className="muted">{t("固定版本：","Pinned version: ")}v{reference.source_version} · {(reference.size_bytes/1024).toFixed(1)} KB</p>
      {count>0&&<nav className="cloud-document-navigation" aria-label={t("文件頁面","Document pages")}>
        <button type="button" className="icon-button" disabled={rendering||page<=1} aria-label={t("上一頁","Previous page")} onClick={()=>setPage(n=>n-1)}><ChevronLeft size={18}/></button>
        <span aria-live="polite">{t("第 ","Page ")}{page}{t(" 頁，共 "," of ")}{count}{t(" 頁","")}</span>
        <button type="button" className="icon-button" disabled={rendering||page>=count} aria-label={t("下一頁","Next page")} onClick={()=>setPage(n=>n+1)}><ChevronRight size={18}/></button>
        <form onSubmit={e=>{e.preventDefault();const n=Number(jump);if(Number.isInteger(n)&&n>=1&&n<=count)setPage(n);}}>
          <input type="number" min={1} max={count} value={jump} disabled={rendering} aria-label={t("跳至頁碼","Go to page number")} onChange={e=>setJump(e.target.value)}/><button className="text-button" disabled={rendering}>{t("前往","Go")}</button></form>
      </nav>}
      <ErrorNotice error={previewError}/>{rendering?<div className="cloud-document-loading"><Loading/></div>:image?<img className="cloud-document-page" alt={node.name+(count?" · "+t("第 ","Page ")+page:"")} src={image}/>:reference.text!==undefined?<pre className="cloud-text-preview">{reference.text}</pre>:!previewError&&<p className="muted">
        {result?.document_preview?.state==='setup_required'?t("Office 預覽尚未啟用，你仍可下載原檔。","Office preview is unavailable. You can download the original."):result?.document_preview?.state==='download_required'?t("此檔案超過預覽大小，請下載原檔。","This file exceeds the preview size. Download the original."):t("此類型可下載到電腦預覽。","Download this file to preview it on your computer.")}</p>}
      {result?.text&&<details className="cloud-document-text"><summary>{t("此頁文字","Page text")}</summary><pre>{result.text}</pre></details>}
      {previewError&&<button type="button" className="text-button" onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={14}/>{t("重試預覽","Retry preview")}</button>}
      <div className="row-actions"><button className="button primary" onClick={()=>void download(`${w.base}/assets/${reference.asset_id}/download?version=${reference.source_version}`,node.name).catch(setError)}><Download size={16}/>{t("下載這一版","Download this version")}</button>
        <button className="button secondary" onClick={()=>void navigator.clipboard.writeText(JSON.stringify({workspace_node_id:node.id,asset_version_id:reference.asset_version_id})).then(()=>setCopied(true)).catch(setError)}><Link2 size={16}/>{copied?t("已複製引用","Reference copied"):t("複製工作引用","Copy work reference")}</button></div>
      <p className="muted small-text">{t("預覽與翻頁會核對目前權限，下載保留原格式與固定版本。移除目錄項目不會刪除素材本體。","Previews and page turns check current access. Downloads preserve the original format and pinned version. Removing an entry preserves its source asset.")}</p>
    </>}{error&&!reference&&<button type="button" className="button secondary" onClick={()=>{setLoading(true);setRefresh(n=>n+1);}}><RefreshCw size={16}/>{t("重新檢查","Check again")}</button>}</Modal>;
}
