from pathlib import Path
import json
ROOT=Path('D:/dev/copypasted/自有agent')
def edit(path,pairs):
 p=ROOT/path;s=p.read_text(encoding='utf-8')
 for old,new,count in pairs:
  if s.count(old)!=count:raise RuntimeError(f'{path}: {s.count(old)} != {count}: {old[:100]}')
  s=s.replace(old,new)
 p.write_text(s,encoding='utf-8',newline='\n')
edit('dev/copypaste-extension/src/conversation.ts',[
 ('/** Cloud conversation','import {historyView} from "./history-view.js";\n/** Cloud conversation',1),
 ('  historyLoading = false;','  historyLoading = false;\n  historyNotice = "";',1),
 ('selectedTaskId:this.selectedTaskId });','selectedTaskId:this.selectedTaskId, history:{q:this.historyQuery,archived:this.historyArchived,pages:this.historyPages} });',1),
 ('this.historyLoading = false; ++this.historyRevision;','this.historyLoading = false; this.historyNotice=""; ++this.historyRevision;',1),
 ('const [agents, history, saved, brief] = await Promise.all([','const [agents, saved, brief] = await Promise.all([',1),
 ('        this.io.request(s, chatBase(s) + "/conversations"), this.io.read(this.storageKey(s)),','        this.io.read(this.storageKey(s)),',1),
 ('      this.history = history.items; this.historyNext = history.next_cursor ?? null;','''      const restored=historyView(saved?.history);
      if(restored){this.historyQuery=restored.q;this.historyArchived=restored.archived;this.historyPages=restored.pages;}
      // A directory error must not discard an accepted message receipt or current chat.
      try{
        let history:any;
        try{history=await this.io.request(s,chatBase(s)+(restored?this.historyPath():"/conversations"));}
        catch(e:any){
          if(!restored?.pages.at(-1)||!["CONVERSATION_CURSOR_INVALID","CONVERSATION_CURSOR_EXPIRED"].includes(e.code))throw e;
          if(!this.current(g))return;
          this.historyPages=[""];history=await this.io.request(s,chatBase(s)+this.historyPath());
          this.historyNotice="The saved page expired; showing the first page / 已儲存頁碼失效，已顯示第一頁";
        }
        if(!this.current(g))return;
        this.history=history.items;this.historyNext=history.next_cursor??null;
      }catch(e){if(!this.current(g))return;this.history=[];this.historyNext=null;this.historyNotice="Conversation list is unavailable. Search again to retry / 會話清單暫時無法載入，請重新搜尋";}
''',1),
 ('  /** Browse the private directory','''  private historyPath(){const q=new URLSearchParams({limit:"200",q:this.historyQuery,archived:String(this.historyArchived)});const cursor=this.historyPages.at(-1);if(cursor)q.set("cursor",cursor);return "/conversations?"+q;}
  /** Browse the private directory''',1),
 ('pages.push(this.historyNext);','if(pages.length>=512)throw new Error("Refresh search before continuing / 請重新搜尋後繼續");pages.push(this.historyNext);',1),
 ('this.historyArchived=archived;this.historyLoading=true;','this.historyArchived=archived;this.historyLoading=true;this.historyNotice="";',1),
 ('this.historyPages=pages;\n    }catch','this.historyPages=pages;await this.persist(s);\n    }catch',1),
 ('this.historyPages=[""];throw e;','this.historyPages=[""];this.historyNotice="Conversation list is unavailable. Search again to retry / 會話清單暫時無法載入，請重新搜尋";throw e;',1)])
edit('dev/copypaste-extension/public/sidepanel.html',[
 ('          <form id="chat-history-search-form"','          <p id="chat-history-notice" class="muted" role="status" hidden></p>\n          <form id="chat-history-search-form"',1)])
edit('dev/copypaste-extension/src/chat-panel.ts',[
 ('    const browsing=s.loading||s.historyLoading;','    el("chat-history-notice").textContent=s.historyNotice;el("chat-history-notice").hidden=!s.historyNotice;\n    const browsing=s.loading||s.historyLoading;',1)])

# Native session and panel hints are scoped to the authenticated account and project.
edit('dev/copypaste-desktop/renderer/src/local-agent.tsx',[
 ('import {TaskWorkbench}','import {navigationIdentity,WorkBackLink} from "./work-navigation";\nimport {workId,updateNavigation} from "./work-navigation-state";\nimport {TaskWorkbench}',1),
 ('import { Link, useSearchParams }','import { Link, useSearchParams,useLocation,useNavigate }',1),
 ('  const [methodQuery, setMethodQuery] = useSearchParams();','''  const [methodQuery, setMethodQuery] = useSearchParams();
  const location=useLocation(),navigate=useNavigate(),navigationScope=navigationIdentity(w);
  const savedNavigation=location.state?.workNavigation198?.local;
  const savedLocal=savedNavigation?.scope===navigationScope?savedNavigation.value:null;
  const requestedTask=workId.test(methodQuery.get("native_task")??"")?methodQuery.get("native_task")!:"";
  const taskRequest=useRef(requestedTask);taskRequest.current=requestedTask;
  const initialLocal=useRef(savedLocal),[missingRequestedTask,setMissingRequestedTask]=useState(false);''',1),
 ('  const requested = useRef(requestedSession);','  const requested = useRef(requestedSession|| (workId.test(savedLocal?.session??"")?savedLocal.session:""));',1),
 ('useEffect(() => { requested.current = requestedSession; }, [requestedSession, w.project]);','useEffect(() => { if(requestedSession)requested.current = requestedSession; }, [requestedSession, w.project]);',1),
 ('          const wanted = requested.current;','''          const target=taskRequest.current;
          if(target){const found=data.sessions.find((s:LocalSession)=>s.task?.task_id===target);setMissingRequestedTask(!found);return found?.id??"";}
          const wanted = requested.current;''',1),
 ('  const [panel, setPanel] = useState("chat");\n  useEffect(() => setPanel("chat"), [session?.id]);','''  const [panel, setPanel] = useState("chat");
  useEffect(()=>{const remembered=initialLocal.current;setPanel(session?.id&&remembered?.session===session.id&&["chat","results","folders","programs"].includes(remembered.panel)?remembered.panel:requestedTask&&session?"results":"chat");},[session?.id]);
  useEffect(()=>{if(!selected)return;const prior=location.state?.workNavigation198?.local;
   if(prior?.scope===navigationScope&&prior.value?.session===selected&&prior.value?.panel===panel)return;
   navigate(location.pathname+location.search,{replace:true,state:updateNavigation(location.state,navigationScope,"local",{session:selected,panel}),preventScrollReset:true});
  },[selected,panel,navigationScope]);''',1),
 ('onClick={() => { setSelected(s.id); setError(""); }}','onClick={() => {taskRequest.current="";setMissingRequestedTask(false);const q=new URLSearchParams(methodQuery);q.delete("native_task");q.delete("native_session");setMethodQuery(q,{replace:true});setSelected(s.id);setError("");}}',1),
 ('    {error && <div role="alert"','    {location.state?.workReturn198&&<WorkBackLink/>}\n    {missingRequestedTask&&<p className="local-agent-alert" role="status">{t("此工作目前不在這台電腦的會話內，請從所有工作查看交付記錄。","This task is unavailable in the sessions on this computer. Open All tasks to review the delivery record.")}</p>}\n    {error && <div role="alert"',1)])

# API metadata is additive; source/provider execution remains unchanged.
for component,version in [('platform','0.5.6'),('web','0.5.5'),('desktop','0.7.9'),('extension','0.5.7'),('delivery','0.5.4')]:
 base=ROOT/f'dev/copypaste-{component}'
 for name in ['package.json','package-lock.json']:
  p=base/name
  if not p.exists():continue
  obj=json.loads(p.read_text(encoding='utf-8'));obj['version']=version
  if name=='package-lock.json' and '' in obj.get('packages',{}):obj['packages']['']['version']=version
  p.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print('Round198 extension, native view and version batch written; no build or tests run.')
