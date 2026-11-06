"""Explicit shared renderer changes; preserve Desktop native routing and APIs."""
from pathlib import Path
import json,subprocess
DEV=Path(__file__).resolve().parents[2];WEB=DEV/'copypaste-web';DESKTOP=DEV/'copypaste-desktop'
def edit(p,old,new):
 s=p.read_text(encoding='utf-8');assert old in s,str(p)+': missing source anchor';p.write_text(s.replace(old,new),encoding='utf-8')
def original(repo,p):return subprocess.check_output(['git','-c','core.fsmonitor=false','show','HEAD:'+p],cwd=repo).decode('utf-8').replace('\r\n','\n')
for f in ['task-workbench.tsx','task-workbench.css','software-checks.tsx']:
 assert original(WEB,'src/'+f)==original(DESKTOP,'renderer/src/'+f),f+' has native divergence; review before copying'
for f in ['task-workbench.tsx','task-workbench.css','software-checks.tsx','workspace-edit.tsx','workspace-edit-state.ts','work-role-guide.tsx']:
 (DESKTOP/'renderer/src'/f).write_text((WEB/'src'/f).read_text(encoding='utf-8'),encoding='utf-8')
edit(DESKTOP/'renderer/src/role-templates.tsx','const examplesEnglish:','export const examplesEnglish:')
edit(DESKTOP/'renderer/src/api.ts','import { clearEditableProjectRequests } from "./editable-project-state";','import { clearEditableProjectRequests } from "./editable-project-state";\nimport {clearWorkspaceSaves} from "./workspace-edit-state";')
edit(DESKTOP/'renderer/src/api.ts','if (broadcast) { clearDeliveryRevisionDrafts(); clearEditableProjectRequests(); }','if (broadcast) { clearDeliveryRevisionDrafts(); clearEditableProjectRequests(); clearWorkspaceSaves(); }')
style=(WEB/'src/new-work-task.css').read_text(encoding='utf-8').splitlines()
with (DESKTOP/'renderer/src/task-workbench.css').open('a',encoding='utf-8') as f:
 for line in style:
  if line.startswith('.work-role-guide'):f.write('\n'+line+'\n')
 f.write('\n.native-execution{display:grid;gap:14px;min-width:0}.native-execution-record{border:1px solid var(--line);border-radius:12px;padding:14px;min-width:0}.native-execution-record header{display:flex;gap:12px;flex-wrap:wrap;justify-content:space-between}.native-execution-record header span{color:var(--muted);font-size:12px}.native-execution-record summary{overflow-wrap:anywhere;cursor:pointer;padding:10px 0}.native-result-image{display:block;max-width:100%;height:auto}.local-role-guide{margin:12px 0;min-width:0}.local-role-guide>summary{cursor:pointer;padding:10px 0;color:var(--muted)}\n')
edit(DESKTOP/'renderer/src/local-agent.tsx','import {TaskWorkbench} from "./task-workbench";','import {TaskWorkbench} from "./task-workbench";\nimport {NativeExecutionView} from "./native-execution";\nimport {WorkRoleGuide} from "./work-role-guide";')
old='<TaskWorkbench taskId={session.task?.task_id} review='
new='<TaskWorkbench taskId={session.task?.task_id} native={session.task?{changes:<NativeExecutionView sessionId={session.id} taskId={session.task.task_id} events={session.events} view="changes"/>,terminal:<NativeExecutionView sessionId={session.id} taskId={session.task.task_id} events={session.events} view="terminal"/>,browser:<NativeExecutionView sessionId={session.id} taskId={session.task.task_id} events={session.events} view="browser"/>}:undefined} review='
edit(DESKTOP/'renderer/src/local-agent.tsx',old,new)
edit(DESKTOP/'renderer/src/local-agent.tsx','{session.messages.map((m, i) =>','{session.messages.length===0&&<details className="local-role-guide"><summary>{t("角色交付與示例","Specialist deliverables and example")}</summary><WorkRoleGuide role={session.role} disabled={pending||session.busy||session.revoked} onExample={setPrompt} onExplore={()=>setError("")}/></details>}\n          {session.messages.map((m, i) =>')
for repo,filename in [(WEB,'src/main.tsx'),(DESKTOP,'renderer/src/main.tsx')]:
 p=repo/filename
 edit(p,'import { RoleTemplateCards, roleEnglish } from "./role-templates";','import { RoleTemplateCards, roleEnglish } from "./role-templates";\nimport {RoleDirectoryCount} from "./work-role-guide";')
 edit(p,'{t("全部 18 個角色", "All 18 specialists")}','<RoleDirectoryCount/>')
 edit(p,'18 個專業角色，從完整設計到軟件開發。選擇角色，查看方法和交付標準。','從完整設計到軟件開發，選擇預設角色，查看方法和交付標準。')
 edit(p,'18 specialists, from full design services to software development. Explore their methods and what they deliver.','Preset specialists cover full design services and software development. Explore their methods and what they deliver.')
print(json.dumps({'status':'explicit_renderer_batch_updated','native_desktop_routing_preserved':True}))
