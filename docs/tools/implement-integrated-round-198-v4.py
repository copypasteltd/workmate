from pathlib import Path
ROOT=Path('D:/dev/copypasted/自有agent')
def edit(path,pairs):
 p=ROOT/path;s=p.read_text(encoding='utf-8')
 for old,new,count in pairs:
  if s.count(old)!=count:raise RuntimeError(f'{path}: {s.count(old)} != {count}: {old[:100]}')
  s=s.replace(old,new)
 p.write_text(s,encoding='utf-8',newline='\n')
for base in ['dev/copypaste-web/src','dev/copypaste-desktop/renderer/src']:
 edit(base+'/work-navigation-state.ts',[
  ('/^\\/app\\/(?:tasks|conversations|files|notifications)(?:\\/[a-f\\d-]{36})?$/','/^\\/app(?:\\/(?:tasks|conversations|files|notifications)(?:\\/[a-f\\d-]{36})?)?$/',2)])
edit('dev/copypaste-desktop/src/main.ts',[
 ('import ', 'import {cloudWorkDestination} from "./cloud-work-destination.js";\nimport ',1) if False else (
  '  ipcMain.handle("workspace:cloud", (_e, section?: string) => shell.openExternal(config.web + (section === "geo" ? "/app/analytics?view=geo" : section === "devices" ? "/app/devices" : "/app")));',
  '  ipcMain.handle("workspace:cloud", (_e, destination?: unknown) => shell.openExternal(cloudWorkDestination(config.web,destination)));',1)])
p=ROOT/'dev/copypaste-desktop/src/main.ts';s=p.read_text(encoding='utf-8');p.write_text('import {cloudWorkDestination} from "./cloud-work-destination.js";\n'+s,encoding='utf-8',newline='\n')
for path in ['dev/copypaste-desktop/src/preload.cts','dev/copypaste-desktop/renderer/src/api.ts']:
 edit(path,[('section?: "geo" | "devices"','section?: "geo" | "devices" | {kind:"work";tenant:string;project:string;conversation?:string;task?:string}',1)])
edit('dev/copypaste-desktop/renderer/src/local-agent.tsx',[
 ('  const { t } = useI18n();\n  return <div className="local-agent-empty">','''  const { t } = useI18n(),w=useWorkspace(),location=useLocation(),[error,setError]=useState<Error|null>(null);
  const conversation=location.pathname.match(/^\\/app\\/conversations\\/([a-f\\d-]{36})$/i)?.[1],task=new URLSearchParams(location.search).get("task");
  const destination=conversation&&workId.test(conversation)?{kind:"work" as const,tenant:w.tenant,project:w.project,conversation,...(task&&workId.test(task)?{task}:{})}:undefined;
  return <div className="local-agent-empty"><WorkBackLink fallback="/app/conversations"/><ErrorNotice error={error}/>''',1),
 ('onClick={() => void window.copyPasteBridge!.openCloudWorkspace()}','onClick={() => void window.copyPasteBridge!.openCloudWorkspace(destination).catch(setError)}',1)])
edit('dev/copypaste-desktop/renderer/src/task-directory.tsx',[
 ('    {task.conversation_id&&<Link','    {task.execution_location==="desktop"&&<Link className="button secondary" to={work.path("/app?native_task="+task.id)} state={work.returnState}><Monitor size={16}/>{t("在本機開啟","Open locally")}</Link>}\n    {task.execution_location!=="desktop"&&task.conversation_id&&<Link',1)])
print('Round198 destination and native-context implementation batch written.')
