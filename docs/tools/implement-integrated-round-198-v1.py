from pathlib import Path
import json, shutil

ROOT=Path('D:/dev/copypasted/自有agent')
def edit(path, pairs):
 p=ROOT/path;s=p.read_text(encoding='utf-8')
 for old,new,count in pairs:
  n=s.count(old)
  if n!=count:raise RuntimeError(f'{path}: expected {count}, found {n}: {old[:100]}')
  s=s.replace(old,new)
 p.write_text(s,encoding='utf-8',newline='\n')

for folder in ['dev/copypaste-web/src','dev/copypaste-desktop/renderer/src']:
 edit(folder+'/api.ts',[
  ('export const clientSessionGeneration = () => sessionRevision;', '''export const clientSessionGeneration = () => sessionRevision;
// Non-secret browser-history partition. Never a credential or server authority.
let navigationEpoch = "";
export function clientNavigationEpoch() {
 if(navigationEpoch)return navigationEpoch;
 try{const saved=sessionStorage.getItem("cp_navigation_epoch");if(saved&&/^[a-f\\d-]{36}$/i.test(saved))navigationEpoch=saved;}catch{/* Memory-only fallback. */}
 if(!navigationEpoch)rotateNavigationEpoch();return navigationEpoch;
}
function rotateNavigationEpoch(){navigationEpoch=crypto.randomUUID();try{sessionStorage.setItem("cp_navigation_epoch",navigationEpoch);}catch{/* Memory-only fallback. */}}''',1),
  ('  ++sessionRevision;','  rotateNavigationEpoch();\n  ++sessionRevision;',2)])
 edit(folder+'/context.tsx',[
  ('  projects: any[];','  projects: any[];\n  projectsReady: boolean;',1),
  ('  const loadRevision = useRef(0);','  const [loadedProjectTenant,setLoadedProjectTenant]=useState("");\n  const loadRevision = useRef(0);',1),
  ('    setProjects([]);','    setProjects([]);\n    setLoadedProjectTenant("");',3),
  ('    setProjects(d.items);','    setProjects(d.items);\n    setLoadedProjectTenant(tenant);\n    setError(null);',2),
  ('        projects,','        projects,\n        projectsReady: !!tenant && loadedProjectTenant===tenant,',1)])
 edit(folder+'/main.tsx',[
  ('import { WorkspaceCreationForm }','import {TaskDirectory} from "./task-directory";\nimport {WorkScopeGate,WorkBackLink,useWorkLocation} from "./work-navigation";\nimport {scopedWorkPath} from "./work-navigation-state";\nimport { WorkspaceCreationForm }',1),
  ('  ["notifications", Bell,','  ["tasks", FileText, "所有工作", "All tasks"],\n  ["notifications", Bell,',1),
  ('  const location = useLocation();\n  const published', '  const location = useLocation(), shellNavigate=useNavigate();\n  const published',1),
  ('onChange={(e) => w.setTenant(e.target.value)}','onChange={(e) => {w.setTenant(e.target.value);shellNavigate("/app");}}',1),
  ('onChange={(e) => w.setProject(e.target.value)}','onChange={(e) => {w.setProject(e.target.value);shellNavigate("/app");}}',1),
  ('          {w.base || [','          <WorkScopeGate>{w.base || [',1),
  ('          )}\n        </main>','          )}</WorkScopeGate>\n        </main>',1),
  ('              <Route path="tasks/:id"','              <Route path="tasks" element={<TaskDirectory />} />\n              <Route path="tasks/:id"',1),
  ('function TaskTable({ items }: { items: any[] }) {\n  const { t } = useI18n();','function TaskTable({ items }: { items: any[] }) {\n  const { t } = useI18n(),work=useWorkLocation();',1),
  ('to={"/app/tasks/" + r.id}','to={work.path("/app/tasks/" + r.id)} state={work.returnState}',1),
  ('      <Link to="/app" className="text-link">\n        ← {t("返回工作台", "Back to workspace")}\n      </Link>','      <WorkBackLink/>',1),
  ('<h2>{t("最近的工作", "Your recent work")}</h2>','<h2>{t("最近的工作", "Your recent work")}</h2><Link className="text-link" to={scopedWorkPath("/app/tasks",w.tenant,w.project)}>{t("查看所有工作","View all tasks")}<ArrowRight size={15}/></Link>',1)])
 edit(folder+'/persistent-work.tsx',[
  ('import {conversationAttempt,','import {useDirectoryNavigation,useWorkLocation,WorkBackLink,useConversationTaskSelection} from "./work-navigation";\nimport {pageForward} from "./work-navigation-state";\nimport {conversationAttempt,',1),
  ('  const [query, setQuery] = useState(""),\n    [archived, setArchived] = useState(false),\n    [open, setOpen] = useState(false),[refresh,setRefresh]=useState(0),\n    [pages,setPages]=useState<string[]>([""]),[pagingScope,setPagingScope]=useState("");\n  const identity=String(w.me?.user?.id??"")+":"+w.base+":"+archived+":"+query;\n  useEffect(()=>{setPages([""]);setPagingScope(identity);},[identity]);\n  const stack=pagingScope===identity?pages:[""],cursor=stack.at(-1)!;', '''  const browse=useDirectoryNavigation("conversations"),view=browse.value,work=useWorkLocation();
  const query=view.q,archived=view.archived,stack=view.pages,cursor=stack.at(-1)!;
  const setQuery=(q:string)=>browse.save({...view,q,pages:[""]});
  const setArchived=(archived:boolean)=>browse.save({...view,archived,pages:[""]});
  const [open,setOpen]=useState(false),[refresh,setRefresh]=useState(0),[pageError,setPageError]=useState<Error|null>(null);
  const setPages=(pages:string[])=>{setPageError(null);browse.save({...view,pages});};''',1),
  ('      <ErrorNotice error={data.error} />\n      {data.loading && !data.data ?', '      <ErrorNotice error={data.error??pageError} />\n      {data.error&&<button className="button secondary" onClick={()=>setPages([""])}>{t("重新載入第一頁","Reload first page")}</button>}\n      {data.loading && !data.data ?',1),
  ('onClick={()=>{if(data.data?.next_cursor)setPages([...stack,data.data.next_cursor]);}}','onClick={()=>{try{if(data.data?.next_cursor)browse.save(pageForward(view,data.data.next_cursor));}catch(e){setPageError(e as Error);}}}',1),
  ('              to={"/app/conversations/" + c.id}', '              to={work.path("/app/conversations/" + c.id)} state={work.returnState}',1),
  ('onSaved={(id) => nav("/app/conversations/" + id)}','onSaved={(id) => nav(work.path("/app/conversations/" + id),{state:work.returnState})}',1),
  ('export function RecentConversations() {\n  const w = useWorkspace(),','export function RecentConversations() {\n  const work=useWorkLocation();\n  const w = useWorkspace(),',1),
  ('to={"/app/conversations/" + c.id}>','to={work.path("/app/conversations/" + c.id)} state={work.returnState}>',1),
  ('  const [selectedTaskId,setSelectedTaskId]=useState("");','  const {selected:selectedTaskId,setSelected:setSelectedTaskId}=useConversationTaskSelection(id??"");\n  const work=useWorkLocation();',1),
  ('pending.current=null;setSelectedTaskId("");','pending.current=null;',1),
  ('    active = c?.tasks.find((task:any)=>task.id===selectedTaskId) ??\n      c?.tasks.slice().reverse().find((task:any)=>["queued","running","paused","awaiting_approval","reconciling","needs_input"].includes(task.status)) ?? c?.tasks.at(-1);', '    active = selectedTaskId?c?.tasks.find((task:any)=>task.id===selectedTaskId):(c?.tasks.slice().reverse().find((task:any)=>["queued","running","paused","awaiting_approval","reconciling","needs_input"].includes(task.status)) ?? c?.tasks.at(-1));',1),
  ('      <Link className="text-link" to="/app/conversations">\n        ← {t("我的會話", "Your conversations")}\n      </Link>','      <WorkBackLink fallback="/app/conversations"/>\n      {c&&selectedTaskId&&!active&&<p role="status" className="card work-location-notice">{t("連結指定的工作目前不在此會話內，或已無法存取。請從會話工作清單重新選擇。","The linked task is unavailable in this conversation. Select an accessible task from the conversation list.")}</p>}',1),
  ('to={"/app/files?conversation=" + id}','to={work.path("/app/files?conversation=" + id)}',1),
  ('to={"/app/tasks/" + m.task_id}','to={work.path("/app/tasks/" + m.task_id)} state={work.returnState}',1),
  ('                  {c.tasks.map((task:any)=>','                  {!active&&<option value="" disabled>{t("請選擇會話中的工作","Select a conversation task")}</option>}\n                  {c.tasks.map((task:any)=>',1)])
 edit(folder+'/task-workbench.tsx',[
  ('import {download}', 'import {useWorkReviewState,useWorkLocation} from "./work-navigation";\nimport {download}',1),
  (' const [tab,setTab]=useState<Tab>("results"),[selected,setSelected]=useState<any>(null),[error,setError]=useState<Error|null>(null),[editing,setEditing]=useState<any>(null),[revision,setRevision]=useState(0);',''' const remembered=useWorkReviewState(taskId),work=useWorkLocation(),tab=remembered.tab;
 const [error,setError]=useState<Error|null>(null),[editing,setEditing]=useState<any>(null),[revision,setRevision]=useState(0);''',1),
  (' const activity=useData(',''' const selected=files.find((f:any)=>f.version_id===remembered.selected)??null;
 const setTab=(value:Tab)=>remembered.save({tab:value,selected:remembered.selected});
 const setSelected=(file:any)=>remembered.save({tab,selected:file?.version_id??""});
 const activity=useData(''',1),
  ('useEffect(()=>{if(selected&&!files.some((f:any)=>f.version_id===selected.version_id))setSelected(null);},[result.data]);','useEffect(()=>{if(result.data&&!result.error&&remembered.selected&&!files.some((f:any)=>f.version_id===remembered.selected))setSelected(null);},[result.data]);',1),
  ('to="/app/files"','to={work.path("/app/files")}',1),
  ('to={"/app/tasks/"+taskId}','to={work.path("/app/tasks/"+taskId)} state={work.returnState}',1)])
 edit(folder+'/notifications.tsx',[
  ('import { patch }','import {useDirectoryNavigation,useWorkLocation,useScopeLifetime,navigationIdentity} from "./work-navigation";\nimport {pageForward,scopedWorkPath} from "./work-navigation-state";\nimport { patch }',1),
  ('  const [refresh, setRefresh] = useState(0),\n    [unread, setUnread] = useState(false),\n    [cursors, setCursors] = useState<(string | null)[]>([null]),\n    [scope, setScope] = useState(w.tenant),','''  const browse=useDirectoryNavigation("notifications",false),view=browse.value,work=useWorkLocation(),capture=useScopeLifetime(navigationIdentity(w));
  const unread=view.archived,cursors=view.pages;
  const setUnread=(archived:boolean)=>browse.save({...view,archived,pages:[""]});
  const setCursors=(pages:string[])=>browse.save({...view,pages});
  const [refresh, setRefresh] = useState(0),''',1),
  ('    setCursors([null]);\n    setScope(w.tenant);\n','',1),
  ('  const cursor = scope === w.tenant ? cursors[cursors.length - 1] : null;','  const cursor = cursors.at(-1);',1),
  ('    setBusy(n.id);','    const current=capture();\n    if(busy)return;\n    setBusy(n.id);',1),
  ('      setRefresh((v) => v + 1);\n      document.dispatchEvent', '      if(!current())return;\n      setRefresh((v) => v + 1);\n      document.dispatchEvent',1),
  ('        w.setProject(n.project_id);\n        nav("/app/tasks/" + n.task_id);','''        if(!w.projects.some(p=>p.id===n.project_id))throw new Error(t("目前已無法存取通知中的專案。","This notification project is no longer accessible."));
        nav(scopedWorkPath("/app/tasks/"+n.task_id,w.tenant,n.project_id),{state:work.returnState});''',1),
  ('      setError(e as Error);\n    } finally {\n      setBusy("");','      if(current())setError(e as Error);\n    } finally {\n      if(current())setBusy("");',1),
  ('setCursors([null])','setCursors([""])',2),
  ('onClick={() => setCursors((v) => v.slice(0, -1))}','onClick={() => setCursors(cursors.slice(0,-1))}',1),
  ('setCursors((v) => [...v, inbox.next_cursor]);','try{browse.save(pageForward(view,inbox.next_cursor));}catch(e){setError(e as Error);}',1),
  ('disabled={busy === n.id}','disabled={!!busy}',2)])

edit('dev/copypaste-web/src/task-directory.css',[
 ('var(--accent)','var(--blue)',2),('var(--text)','var(--ink)',1),('var(--text-muted)','var(--muted)',1)])
for f in ['work-navigation-state.ts','work-navigation.tsx','task-directory.tsx','task-directory.css']:
 shutil.copyfile(ROOT/'dev/copypaste-web/src'/f,ROOT/'dev/copypaste-desktop/renderer/src'/f)
edit('dev/copypaste-platform/src/server.ts',[
 ('import {registerTaskWorkspace}', 'import {registerTaskDirectory} from "./task-directory.js";\nimport {registerTaskWorkspace}',1),
 ('  registerTaskWorkspace(app, db, storage);','  registerTaskDirectory(app, db);\n  registerTaskWorkspace(app, db, storage);',1)])
print('Round198 shared code batch written; no build or tests run.')
