import {useEffect,useRef,useState} from "react";
import {Check,LoaderCircle} from "lucide-react";
import {ApiError,post,clientSessionGeneration} from "./api";
import {useWorkspace} from "./context";
import {operationKey,completeOperation} from "./operation-key";
import {adoptionPrice} from "./adoption-price";
import {ErrorNotice,useI18n} from "./ui";

type Preview={preview_token:string;expires_at:string;summary:{source_id:string;source_version:number;source_name:string;
 copy_name:string;role_key:string;runtime_version:string;template_version:number|null;instructions:string;
 brand:{id:string;version:number}|null;skills:{key:string;version:string}[];tool_ids:string[];
 models:{id:string;profile_key:string;model_alias:string|null;rates:(number|null)[];ready:boolean}[]}};
export function CopyReview({sourceId,proposal,onSaved,onBack}:{sourceId:string;proposal:any;onSaved:()=>void;onBack:(stale:boolean)=>void}) {
 const w=useWorkspace(),{t}=useI18n(),account=String(w.me?.user?.id??""),signature=JSON.stringify(proposal);
 const endpoint=w.base+"/agents/"+sourceId,identity=account+":"+endpoint+":"+signature;
 const [preview,setPreview]=useState<Preview|null>(null),[error,setError]=useState<Error|null>(null),[busy,setBusy]=useState(true),[consent,setConsent]=useState(false),[invalid,setInvalid]=useState(false);
 const alive=useRef(false),inFlight=useRef(false),lifecycle=useRef(0),currentIdentity=useRef(identity);currentIdentity.current=identity;
 useEffect(()=>{
  let current=true,withdrawn=false,generation=0;const lifetime=++lifecycle.current;alive.current=true;inFlight.current=false;setBusy(true);setPreview(null);setConsent(false);setInvalid(false);setError(null);
  async function load(){if(inFlight.current||withdrawn)return;const ticket=++generation,session=clientSessionGeneration();inFlight.current=true;setBusy(true);
   const valid=()=>current&&!withdrawn&&ticket===generation&&lifecycle.current===lifetime&&currentIdentity.current===identity&&session===clientSessionGeneration();
   try {const token=await operationKey(account,endpoint+"/copy-previews",proposal);if(!valid())return;
    const value=await post(endpoint+"/copy-previews",proposal,token) as Preview;
    if(valid()){setPreview(value);setError(null);}}
   catch(e){if(valid()){setPreview(null);setConsent(false);setError(e as Error);if(e instanceof ApiError&&[401,403,404,409,410].includes(e.status))setInvalid(true);}}
   finally{if(lifecycle.current===lifetime&&ticket===generation){inFlight.current=false;if(current)setBusy(false);}}
  }
  const clear=()=>{if(current){withdrawn=true;generation++;lifecycle.current++;inFlight.current=false;setBusy(false);setPreview(null);setConsent(false);setInvalid(true);}};
  void load();const timer=window.setInterval(()=>void load(),15000);window.addEventListener("focus",load);window.addEventListener("copypaste:session-ended",clear);
  return()=>{current=false;alive.current=false;if(lifecycle.current===lifetime)lifecycle.current++;window.clearInterval(timer);window.removeEventListener("focus",load);window.removeEventListener("copypaste:session-ended",clear);};
 },[identity]);
 async function confirm(){if(!preview||!consent||busy||inFlight.current||invalid)return;inFlight.current=true;setBusy(true);setError(null);
  const lifetime=lifecycle.current,session=clientSessionGeneration(),valid=()=>alive.current&&currentIdentity.current===identity&&lifecycle.current===lifetime&&session===clientSessionGeneration();
  const payload={proposal,preview_token:preview.preview_token,acknowledged:true};
  try{const requestKey=await operationKey(account,endpoint+"/copies",payload);if(!valid())return;await post(endpoint+"/copies",payload,requestKey);
   if(!valid())return;await completeOperation(account,endpoint+"/copies",payload);
   if(!valid())return;await completeOperation(account,endpoint+"/copy-previews",proposal);if(valid())onSaved();
  }catch(e){if(valid()){setError(e as Error);if(e instanceof ApiError&&[401,403,404,409,410].includes(e.status)){setPreview(null);setConsent(false);setInvalid(true);}}}
  finally{if(valid()){inFlight.current=false;setBusy(false);}}
 }
 async function back(){const lifetime=lifecycle.current,session=clientSessionGeneration();if(invalid)await completeOperation(account,endpoint+"/copy-previews",proposal);
  if(alive.current&&currentIdentity.current===identity&&lifecycle.current===lifetime&&session===clientSessionGeneration())onBack(invalid);
 }
 const s=preview?.summary;
 return <section className="adoption-review" aria-busy={busy}>
  <p className="notice">{t("副本保留原模型、費率、品牌與方法版本。對話、私人記憶、檔案及授權不會複製。", "The copy retains the original models, rates, brand and method versions. Conversations, private memories, files and permissions are excluded.")}</p>
  <ErrorNotice error={error}/>
  {s&&<><div className="adoption-columns"><section className="adoption-version"><h3>{t("來源專家", "Source specialist")}</h3><p>{s.source_name} · v{s.source_version}</p><p>{s.role_key}</p><dl><div><dt>{t("固定品牌版本", "Fixed brand revision")}</dt><dd>{s.brand?"v"+s.brand.version:t("無品牌", "No brand")}</dd></div><div><dt>{t("模板版本", "Template version")}</dt><dd>{s.template_version??t("自訂專家", "Custom specialist")}</dd></div></dl>
   {s.models.map(m=><div className="adoption-capability" key={m.id}><strong>{m.model_alias??t("未記錄模型", "Model not recorded")}</strong><p className="small-text">{m.profile_key}</p><p className="small-text">{m.profile_key==="internal-text-v1"?t("輸入／輸出，每百萬token", "Input / output per million tokens"):m.profile_key==="internal-image2-v1"?t("每張圖片", "Per image"):t("固定費率版本", "Retained rate version")}: {m.rates.map(v=>adoptionPrice(v===null?null:String(v))??t("未記錄", "Not recorded")).join(" / ")}</p></div>)}
   <p className="small-text">Codex {s.runtime_version}</p>{s.skills.map(m=><p className="small-text" key={m.key}>{m.key} · {m.version}</p>)}</section>
   <section className="adoption-version"><h3>{t("新的獨立副本", "New independent copy")}</h3><strong>{s.copy_name}</strong><p className="preserve-text">{s.instructions}</p><p>{s.tool_ids.length} {t("項獲准工具", "approved tools")}</p><p className="muted small-text">{t("現有專家和任務保持原樣。需要其他品牌或新版方法時，可在副本設定中比較並採用。", "Existing specialists and tasks keep their versions. To change the brand or adopt newer methods, compare and adopt them in the copy's settings.")}</p></section></div>
   <label className="check-line"><input type="checkbox" checked={consent} disabled={busy||invalid} onChange={e=>setConsent(e.target.checked)}/>{t("我已確認原版本與複製範圍", "I reviewed the retained versions and copy scope")}</label></>}
  <div className="row-actions"><button className="button secondary" disabled={busy} onClick={()=>void back()}>{invalid?t("重新載入來源", "Reload source"):t("返回編輯", "Back to edit")}</button>
   {s&&<button className="button primary" disabled={busy||!consent||invalid} onClick={()=>void confirm()}>{busy?<LoaderCircle size={16} className="spin"/>:<Check size={16}/>} {t("確認建立副本", "Confirm copy")}</button>}</div>
 </section>;
}
