import {useEffect,useState} from "react";
import {Link,useLocation} from "react-router-dom";
import {Search,RefreshCw,ArrowUpRight,MessageSquare,Monitor,Cloud,BriefcaseBusiness} from "lucide-react";
import {useWorkspace} from "./context";
import {Badge,DateText,Empty,ErrorNotice,Field,Loading,Money,PageHeader,useData,useI18n} from "./ui";
import {useDirectoryNavigation,useWorkLocation} from "./work-navigation";
import {pageForward} from "./work-navigation-state";
import "./task-directory.css";

const states=["queued","running","needs_input","awaiting_approval","paused","reconciling","succeeded","failed","cancelled"];
export function TaskDirectory(){
 const w=useWorkspace(),{t}=useI18n(),location=useLocation(),browse=useDirectoryNavigation("tasks"),view=browse.value,work=useWorkLocation();
 const [query,setQuery]=useState(view.q),[status,setStatus]=useState(view.status),[place,setPlace]=useState(view.location),[mode,setMode]=useState(view.mode),[refresh,setRefresh]=useState(0),[pageError,setPageError]=useState<Error|null>(null);
 useEffect(()=>{setQuery(view.q);setStatus(view.status);setPlace(view.location);setMode(view.mode);setPageError(null);},[location.key]);
 const params=new URLSearchParams({limit:"40",...(view.q?{q:view.q}:{}),...(view.status?{status:view.status}:{}),...(view.location?{location:view.location}:{}),...(view.mode?{mode:view.mode}:{}),...(view.pages.at(-1)?{cursor:view.pages.at(-1)!}:{})});
 const data=useData<{items:any[];next_cursor:string|null}>(w.base+"/task-directory?"+params,refresh,15000,"",{retainOnRefresh:true});
 const rows=data.error?null:data.data?.items;
 const labels:Record<string,string>={queued:t("排隊中","Queued"),running:t("執行中","Running"),needs_input:t("需要資料","Needs input"),awaiting_approval:t("等待審批","Awaiting approval"),paused:t("已暫停","Paused"),reconciling:t("費用待確認","Reconciling"),succeeded:t("已完成","Completed"),failed:t("未完成","Failed"),cancelled:t("已取消","Cancelled")};
 const reload=()=>{browse.save({...view,pages:[""]});setPageError(null);setRefresh(v=>v+1);};
 return <>
  <PageHeader eyebrow="FIND YOUR WORK." title={t("所有工作","All tasks")} description={t("查找目前專案的工作，查看原會話、成果和費用。","Find work in this project and return to its original conversation, results and usage.")}
   action={<button className="button secondary" onClick={reload} disabled={data.loading}><RefreshCw size={17}/>{t("重新整理清單","Refresh task list")}</button>}/>
  <form className="card task-directory-filters" aria-label={t("工作搜尋與篩選","Task search and filters")} onSubmit={e=>{e.preventDefault();setPageError(null);browse.save({...view,q:query.trim(),status,location:place,mode,pages:[""]});}}>
   <Field label={t("工作名稱","Task title")}><input type="search" value={query} maxLength={160} onChange={e=>setQuery(e.target.value)} placeholder={t("搜尋工作名稱…","Search task titles…")}/></Field>
   <Field label={t("工作狀態","Task status")}><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">{t("全部狀態","All statuses")}</option>{states.map(s=><option key={s} value={s}>{labels[s]}</option>)}</select></Field>
   <Field label={t("執行位置","Execution location")}><select value={place} onChange={e=>setPlace(e.target.value)}><option value="">{t("全部位置","All locations")}</option><option value="cloud">{t("公司雲端","Company cloud")}</option><option value="desktop">{t("本機 Desktop","Local Desktop")}</option></select></Field>
   <Field label={t("工作方式","Working mode")}><select value={mode} onChange={e=>setMode(e.target.value)}><option value="">{t("全部方式","All modes")}</option><option value="ask">{t("諮詢","Ask")}</option><option value="plan">{t("規劃","Plan")}</option><option value="execute">{t("執行","Execute")}</option></select></Field>
   <div className="row-actions"><button className="button primary" type="submit" disabled={data.loading}><Search size={17}/>{t("查找工作","Find tasks")}</button><button className="button quiet" type="button" onClick={()=>{browse.reset();setRefresh(n=>n+1);}}>{t("清除篩選","Clear filters")}</button></div>
  </form>
  <ErrorNotice error={data.error??pageError}/>{data.error&&<p><button className="button secondary" onClick={reload}>{t("重新載入第一頁","Reload the first page")}</button></p>}
  {data.loading&&!rows?<Loading/>:rows?.length?<section className="task-directory-list" aria-label={t("工作搜尋結果","Task search results")} aria-busy={data.loading}>
   {rows.map(task=><article className="card task-directory-row" key={task.id} data-task-id={task.id}>
    <div className="task-directory-marker" aria-hidden="true">{task.execution_location==="desktop"?<Monitor size={20}/>:<Cloud size={20}/>}</div>
    <div className="task-directory-copy"><Link className="task-directory-title" to={work.path("/app/tasks/"+task.id)} state={work.returnState}>{task.title}<ArrowUpRight size={16}/></Link><div className="task-directory-meta"><Badge value={task.status}/><span>{task.execution_location==="desktop"?t("本機 Desktop","Local Desktop"):t("公司雲端","Company cloud")}</span><DateText value={task.created_at}/></div>
     {task.cancel_requested&&!["succeeded","failed","cancelled"].includes(task.status)&&<p className="muted small-text">{t("已要求停止；等待原執行確認。","Stop requested; waiting for the original execution to confirm.")}</p>}
     {task.source_unavailable&&<p className="muted small-text">{t("部分來源目前無法確認；開啟工作查看狀態。","Some sources are unavailable. Open the task to check its status.")}</p>}
    </div>
    <div className="task-directory-usage"><span className="muted small-text">{t("已記錄用量","Recorded usage")}</span><Money value={task.charged_micros}/></div>
    {task.execution_location==="desktop"&&<Link className="button secondary" to={work.path("/app?native_task="+task.id)} state={work.returnState}><Monitor size={16}/>{t("在本機開啟","Open locally")}</Link>}
    {task.execution_location!=="desktop"&&task.conversation_id&&<Link className="button secondary" to={work.path("/app/conversations/"+task.conversation_id+"?task="+task.id)} state={work.returnState}><MessageSquare size={16}/>{t("開啟原會話","Open conversation")}</Link>}
   </article>)}
  </section>:!data.error&&!data.loading&&<Empty icon={BriefcaseBusiness} title={t("沒有符合的工作","No matching tasks")} body={t("調整篩選，或回到工作空間開始一項工作。","Adjust the filters or start a task from your workspace.")} action={<Link className="button secondary" to="/app">{t("開啟工作空間","Open workspace")}</Link>}/>}
  <nav className="row-actions task-directory-pages" aria-label={t("工作分頁","Task pages")}>
   <button className="button secondary" disabled={data.loading||view.pages.length===1} onClick={()=>browse.save({...view,pages:view.pages.slice(0,-1)})}>{t("上一頁工作","Previous tasks")}</button><span role="status">{t("第 ","Page ")}{view.pages.length}{t(" 頁","")}{rows?" · "+rows.length+t(" 項工作"," tasks"):""}</span>
   <button className="button secondary" disabled={data.loading||!!data.error||!data.data?.next_cursor} onClick={()=>{try{if(data.data?.next_cursor)browse.save(pageForward(view,data.data.next_cursor));}catch(e){setPageError(e as Error);}}}>{t("下一頁工作","Next tasks")}</button>
  </nav>
 </>;
}
