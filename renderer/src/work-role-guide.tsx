import {Link} from "react-router-dom";
import {Sparkles,CheckCircle2,ArrowUpRight} from "lucide-react";
import {useWorkspace} from "./context";
import {ErrorNotice,useData,useI18n} from "./ui";
import {examplesEnglish,roleEnglish} from "./role-templates";

export function WorkRoleGuide({role,disabled,onExample,onExplore}:{role:string;disabled:boolean;onExample:(text:string)=>void;onExplore:()=>void}){
 const w=useWorkspace(),{t,locale}=useI18n();
 const source=useData("/v1/agent-templates?"+new URLSearchParams({project_id:w.project,q:role,limit:"100"}),0,20000,w.tenant,{retainOnRefresh:true});
 const template=source.data?.items.find((v:any)=>v.role_key===role),preset=template?.preset_definition;
 const example=locale==="en"?examplesEnglish[role]??template?.examples?.[0]:template?.examples?.[0];
 return <section className="work-role-guide" aria-label={t("所選角色與交付","Selected specialist and delivery")}>
  <header><Sparkles size={17}/><strong>{locale==="en"?roleEnglish[role]??template?.name??role:template?.name??roleEnglish[role]??role}</strong>
   {template&&<span className={template.available?"guide-ready":"guide-pending"}>{template.available?t("依賴可用","Dependencies available"):t("需要先檢查","Check dependencies")}</span>}</header>
  {role==="assistant"&&!template&&<p>{t("先描述需要的答覆、計畫或文字交付；專業工具工作可在更多設定選擇相應角色。","Describe the answer, plan or written result you need. Choose a specialist under more settings for work requiring professional tools.")}</p>}
  <ErrorNotice error={source.error}/>
  {preset?.deliverables?.length>0&&<div><p className="muted small-text">{t("這個模板的交付形式","This template's deliverables")}</p><ul>{preset.deliverables.slice(0,6).map((v:any)=><li key={v.name+v.format}><CheckCircle2 size={14}/><span>{v.name}<small>{v.format}</small></span></li>)}</ul></div>}
  {example&&<blockquote>{example}<button className="text-button" type="button" disabled={disabled} onClick={()=>onExample(example)}>{t("使用這個示例","Use this example")}<ArrowUpRight size={13}/></button></blockquote>}
  {template&&<p className="muted small-text">{template.available?t("目前服務依賴可用，提交時仍會檢查權限、方案與費用；專業產出由你審閱。","Current service dependencies are available. Submission still checks permissions, plan and budget; you review the professional result."):t("部分依賴目前未就緒。先查看模板的服務需求；此面板不會啟動或收費。","Some dependencies are not ready. Review the template's service requirements; this panel starts no work and creates no charge.")}</p>}
  <Link className="text-link" to="/app/roles" onClick={onExplore}>{t("查看角色方法與完整交付範圍","View specialist methods and complete delivery scope")} →</Link>
 </section>;
}

export function RoleDirectoryCount(){
 const {t}=useI18n(),roles=useData("/v1/catalog/roles"),count=roles.data?.items?.filter((r:any)=>r.role_key!=="assistant"&&(!window.copyPasteBridge||r.role_key!=="computer-operator")).length;
 return <>{typeof count==="number"?t(`全部 ${count} 個角色`,`All ${count} specialists`):t("查看全部角色","All specialists")}</>;
}
