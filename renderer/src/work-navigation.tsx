import {useEffect,useRef,useState,type ReactNode} from "react";
import {Link,useLocation,useNavigate} from "react-router-dom";
import {ArrowLeft} from "lucide-react";
import {clientNavigationEpoch} from "./api";
import {useWorkspace} from "./context";
import {ErrorNotice,Loading,useI18n} from "./ui";
import {directoryView,emptyDirectory,readDirectory,routeScope,scopedWorkPath,updateNavigation,workId,type DirectoryView} from "./work-navigation-state";

export function navigationIdentity(w:ReturnType<typeof useWorkspace>,project=true){
 return JSON.stringify([w.me?.user?.id??"",clientNavigationEpoch(),w.tenant,project?w.project:""]);
}
export function useDirectoryNavigation(kind:string,project=true){
 const w=useWorkspace(),location=useLocation(),navigate=useNavigate(),scope=navigationIdentity(w,project);
 const value=readDirectory(location.state,scope,kind);
 const save=(next:DirectoryView)=>{const valid=directoryView(next);if(!valid)throw Error("Invalid directory navigation");navigate(location.pathname+location.search,{replace:true,state:updateNavigation(location.state,scope,kind,valid),preventScrollReset:true});};
 return {value,save,reset:()=>save(emptyDirectory())};
}
export function useWorkLocation(){
 const w=useWorkspace(),location=useLocation();
 return {currentPath:location.pathname,path:(path:string)=>scopedWorkPath(path,w.tenant,w.project),
  returnState:{workReturn198:{scope:navigationIdentity(w,false),path:scopedWorkPath(location.pathname==="/app"||/^\/app\/(conversations|files|notifications)(\/|$)/.test(location.pathname)||location.pathname==="/app/tasks"?location.pathname+location.search:"/app/tasks",w.tenant,w.project),
   state:{workNavigation198:location.state?.workNavigation198}}}};
}
/** Remember only one validated view per current route, account and task. */
export function useWorkReviewState(taskId:string){
 const w=useWorkspace(),location=useLocation(),navigate=useNavigate(),scope=navigationIdentity(w)+":"+taskId;
 const saved=location.state?.workNavigation198?.review;
 const value=saved?.scope===scope?saved.value:null;
 const tab=["results","files","changes","terminal","browser","activity","usage"].includes(value?.tab)?value.tab:"results";
 const selected=typeof value?.selected==="string"&&workId.test(value.selected)?value.selected:"";
 return {tab:tab as "results"|"files"|"changes"|"terminal"|"browser"|"activity"|"usage",selected,
  save:(next:{tab:string;selected:string})=>navigate(location.pathname+location.search,{replace:true,state:updateNavigation(location.state,scope,"review",next),preventScrollReset:true})};
}
export function useConversationTaskSelection(conversationId:string){
 const w=useWorkspace(),location=useLocation(),navigate=useNavigate(),scope=navigationIdentity(w)+":"+conversationId;
 const saved=location.state?.workNavigation198?.conversationTask,q=new URLSearchParams(location.search),requested=q.get("task");
 const selected=q.has("task")?(q.getAll("task").length===1&&workId.test(requested??"")?requested!:"invalid"):
  saved?.scope===scope&&workId.test(saved?.value?.selected??"")?saved.value.selected:"";
 return {selected,setSelected:(id:string)=>{if(!workId.test(id))return;q.set("task",id);navigate(location.pathname+"?"+q,{replace:true,state:updateNavigation(location.state,scope,"conversationTask",{selected:id}),preventScrollReset:true});}};
}
export function WorkBackLink({fallback="/app/tasks"}:{fallback?:"/app/tasks"|"/app/conversations"}){
 const w=useWorkspace(),location=useLocation(),{t}=useI18n(),back=location.state?.workReturn198;
 let target=scopedWorkPath(fallback,w.tenant,w.project),state:unknown;
 if(back?.scope===navigationIdentity(w,false)&&typeof back.path==="string"){
  try{const u=new URL(back.path,"https://workmate.invalid");if(u.origin==="https://workmate.invalid"&&(["/app","/app/tasks","/app/conversations","/app/notifications"].includes(u.pathname)||/^\/app\/conversations\/[a-f\d-]{36}$/i.test(u.pathname))){
   const scope=routeScope(u.pathname,u.search);if(scope!=="invalid"&&(!scope||scope.tenant===w.tenant)){target=u.pathname+u.search;state={workNavigation198:back.state?.workNavigation198};}
  }}catch{/* Only a validated internal list can be a return destination. */}
 }
 const name=target.split("?")[0]==="/app"?t("返回工作空間","Back to workspace"):target.startsWith("/app/conversations/")?t("返回原會話","Back to conversation"):target.startsWith("/app/conversations")?t("返回會話清單","Back to conversations"):target.startsWith("/app/notifications")?t("返回工作通知","Back to notifications"):t("返回工作清單","Back to tasks");
 return <Link className="text-link work-back-link" to={target} state={state}><ArrowLeft size={15}/>{name}</Link>;
}
/** Do not render a target task against a different account/project while switching. */
export function WorkScopeGate({children}:{children:ReactNode}){
 const w=useWorkspace(),location=useLocation(),navigate=useNavigate(),{t}=useI18n(),[retryError,setRetryError]=useState<Error|null>(null);
 const target=routeScope(location.pathname,location.search),invalid=target==="invalid"||!!target&&!w.me.memberships.some((m:any)=>m.id===target.tenant);
 const missing=!!target&&target!=="invalid"&&w.tenant===target.tenant&&w.projectsReady&&!w.projects.some(p=>p.id===target.project);
 useEffect(()=>{
  if(!target||target==="invalid"||invalid||missing)return;
  if(w.tenant!==target.tenant)w.setTenant(target.tenant);
  else if(w.projectsReady&&w.project!==target.project)w.setProject(target.project);
 },[location.pathname,location.search,w.tenant,w.project,w.projectsReady,invalid,missing]);
 if(!target)return <>{children}</>;
 if(invalid||missing)return <section className="card work-location-notice" role="alert"><h2>{t("無法開啟這項工作","This work location is unavailable")}</h2><p>{t("企業、專案或存取權可能已變更。請返回目前工作空間確認。","The organization, project or access may have changed. Return to your current workspace to check.")}</p><button className="button secondary" onClick={()=>navigate("/app",{replace:true})}>{t("開啟工作空間","Open workspace")}</button></section>;
 if(w.tenant!==target.tenant||!w.projectsReady||w.project!==target.project)return <section className="card work-location-notice"><Loading/><ErrorNotice error={retryError??w.error}/>{(retryError||w.error)&&<button className="button secondary" onClick={()=>{setRetryError(null);void w.reloadProjects().catch(setRetryError);}}>{t("重新確認專案","Check project again")}</button>}</section>;
 return <>{children}</>;
}
export function useScopeLifetime(identity:string){
 const current=useRef(identity),lifetime=useRef(0),alive=useRef(false);current.current=identity;
 useEffect(()=>{alive.current=true;const generation=++lifetime.current;return()=>{alive.current=false;if(lifetime.current===generation)++lifetime.current;};},[identity]);
 return ()=>{const generation=lifetime.current;return ()=>alive.current&&generation===lifetime.current&&current.current===identity;};
}
