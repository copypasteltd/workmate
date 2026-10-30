import { useEffect, useRef, useState } from "react";
import { Check, FileText } from "lucide-react";
import { api } from "./api";
import { useWorkspace } from "./context";
import { ErrorNotice, Field, Loading, useI18n } from "./ui";
import "./cloud-document-preview.css";

function usePaged(url:string|null,cursorName="cursor"){
  const [items,setItems]=useState<any[]>([]),[next,setNext]=useState<string|number|null>(null),
    [loading,setLoading]=useState(false),[error,setError]=useState<Error|null>(null),controller=useRef<AbortController|undefined>(undefined);
  useEffect(()=>{const c=new AbortController();controller.current=c;setItems([]);setNext(null);setError(null);setLoading(!!url);
    if(url)void api(url,{signal:c.signal}).then(d=>{if(!c.signal.aborted){setItems(d.items);setNext(d.next_cursor??null);}})
      .catch(e=>{if(!c.signal.aborted)setError(e);}).finally(()=>{if(!c.signal.aborted)setLoading(false);});
    return()=>c.abort();
  },[url]);
  const more=async()=>{const c=controller.current;if(!url||!c||c.signal.aborted||loading||next===null)return;setLoading(true);setError(null);
    try{const d=await api(url+"&"+cursorName+"="+encodeURIComponent(next),{signal:c.signal});
      if(!c.signal.aborted){setItems(old=>[...old,...d.items.filter((x:any)=>!old.some(y=>y.id===x.id))]);setNext(d.next_cursor??null);}
    }catch(e){if(!c.signal.aborted){setItems([]);setNext(null);setError(e as Error);}}
    finally{if(!c.signal.aborted)setLoading(false);}};
  return {items,next,loading,error,more};
}
export function CloudAssetPicker({shared,required,onChange,onReady}:{shared:boolean;required:boolean;onChange:(id:string|undefined)=>void;onReady:(ready:boolean)=>void}){
  const w=useWorkspace(),{t}=useI18n(),[search,setSearch]=useState(""),[query,setQuery]=useState(""),[selected,setSelected]=useState<any|null>(null);
  useEffect(()=>{const timer=setTimeout(()=>setQuery(search.trim()),250);return()=>clearTimeout(timer);},[search]);
  const assets=usePaged(w.base+"/assets?limit=50&scope="+(shared?"shared":"all")+(query?"&q="+encodeURIComponent(query):""));
  return <div className="cloud-asset-picker">
    <Field label={t("搜尋來源素材","Search source assets")}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder={t("輸入檔名搜尋所有素材…","Search all assets by file name…")}/></Field>
    <div className="cloud-asset-options" aria-label={t("來源素材搜尋結果","Source asset search results")}>
      {assets.items.map(a=><button type="button" key={a.id} className={"cloud-asset-option"+(selected?.id===a.id?" selected":"")} aria-pressed={selected?.id===a.id}
        onClick={()=>{setSelected(a);onChange(undefined);onReady(false);}}><FileText size={16}/><span>{a.name}<small>v{a.current_version}</small></span>{selected?.id===a.id&&<Check size={16}/>}</button>)}
    </div>
    {assets.loading&&<Loading/>}<ErrorNotice error={assets.error}/>
    {!assets.loading&&!assets.error&&!assets.items.length&&<p className="muted small-text">{t("沒有符合的素材，請嘗試其他檔名。","No matching assets. Try another file name.")}</p>}
    {assets.next!==null&&<button type="button" className="text-button" disabled={assets.loading} onClick={()=>void assets.more()}>{t("載入更多素材","Load more assets")}</button>}
    {selected&&<div className="cloud-asset-selected"><p><Check size={15}/><strong>{selected.name}</strong></p>
      <button type="button" className="text-button" onClick={()=>{setSelected(null);onChange(undefined);onReady(!required);}}>{required?t("清除選擇","Clear selection"):t("保留目前引用","Keep the current reference")}</button>
      <VersionPicker key={selected.id} assetId={selected.id} onChange={id=>{onChange(id);onReady(!!id);}}/>
    </div>}
  </div>;
}
function VersionPicker({assetId,onChange}:{assetId:string;onChange:(id:string|undefined)=>void}){
  const w=useWorkspace(),{t}=useI18n(),[selected,setSelected]=useState(""),versions=usePaged(w.base+"/assets/"+assetId+"/versions?limit=50","before_version");
  return <><Field label={t("選擇固定版本","Choose a pinned version")}><select required value={selected} disabled={versions.loading&&!versions.items.length} onChange={e=>{setSelected(e.target.value);onChange(e.target.value||undefined);}}>
    <option value="">{t("選擇要使用的版本","Choose the version to use")}</option>{versions.items.map(v=><option key={v.id} value={v.id}>v{v.version} · {new Date(v.created_at).toLocaleString()}</option>)}
    </select></Field><ErrorNotice error={versions.error}/>{versions.next!==null&&<button type="button" className="text-button" disabled={versions.loading} onClick={()=>void versions.more()}>{t("載入較早版本","Load earlier versions")}</button>}
    <p className="muted small-text">{t("選定後會固定這一版，來源更新不會自動替換。","Your choice stays pinned even when the source receives a newer version.")}</p></>;
}
