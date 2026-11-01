"""Document and bind the existing-model edit/delete increment before publication."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json,re
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';D=DEV/'copypaste-delivery';P=D/'.data/deployment-179'
COMP={'backend':'platform','web':'web','admin':'admin','desktop':'desktop','extension':'extension','delivery':'delivery'}
runs=[p for p in P.glob('browser-*/receipt.json') if json.loads(p.read_bytes()).get('status')=='passed'];assert len(runs)==1
browser=runs[0];r=json.loads(browser.read_bytes());assert r['browser_closed'] and len(r['checks'])==5
media=json.loads((P/'media.sanitized.json').read_bytes())['files']
for row in media:assert sha256((ROOT/row['path']).read_bytes()).hexdigest()==row['sha256']
guide='https://github.com/copypasteltd/workmate/blob/docs/docs/development/179-model-management.md'
diagram='''```mermaid
flowchart LR
 E[Edit existing model] --> C[Same model entry, updated configuration]
 C --> V[Validate and publish for new work]
 D[Confirm deletion] --> X[Remove future availability]
 C --> H[Preserve original task and billing bindings]
 X --> H
```
'''
for branch in ['backend','admin','delivery']:
 repo=DEV/('copypaste-'+COMP[branch])
 for name in ['README.md','README.en.md']:
  p=repo/name;old=p.read_text(encoding='utf-8');assert '<!-- model-management-179 -->' not in old
  english=name.endswith('.en.md')
  title='Edit and delete existing models · stage179' if english else '已有模型可直接编辑和删除 · 阶段179'
  intro=('Open [Model capabilities](https://agent-dashboard.copypaste.hk/catalog?view=capabilities). Each current model has **Edit model** and **Delete model** actions in both the list and detail view. Edit preloads the existing model/API/rates; its masked API Key field accepts a replacement directly. Keep the saved key with the same URL/network scope, or enter a new key after changing that scope.' if english else
   '打开 [模型能力](https://agent-dashboard.copypaste.hk/catalog?view=capabilities)，当前模型的列表和详情均有 **编辑模型**、**删除模型**。编辑表单预填模型、接口和费率，API Key 输入框可直接输入新 Key。同地址／网络范围可保留已保存 Key，更换范围则需填新 Key。')
  behavior=('**Save changes** updates the current model entry. Validate and publish the updated configuration before using it for new customer work. **Delete model → Confirm deletion** removes the model family from new selection, including pinned new-agent/task paths; a deleted default cannot reactivate a bootstrap fallback. Existing tasks and billing keep exact historical versions and encrypted connections. Current/history/deleted views expose the retained records.' if english else
   '**保存更改**后，当前列表直接显示更新后的同一模型条目；完成验证、发布后供新工作使用。**删除模型 → 确认删除** 后移出可用目录，拦截新代理和新顶层任务选择，也不会回退到演示模型。旧任务、账务及加密连接保留；列表可切换当前模型、配置历史、已删除模型。')
  detail={
   'backend':'Migration158 adds stable `capability_model_entries` and immutable `capability_model_revisions`. `POST /v1/admin/capability-releases/:id/edits` requires `admin.catalog.draft`; `/:id/deletions` requires `admin.catalog.publish`. Both require expected document/management revisions, idempotency and audited reasons. Deletion takes the exclusive capability-head lock; new selection takes its shared counterpart. `current_internal_capabilities` filters deleted heads and Catalog removes their bootstrap fallback. Original published/task bindings remain usable. Build: `npm run build`.',
   'admin':'The key field is enabled for saved configurations; typing a replacement automatically deselects retained-key mode. Changing the address/network requires a new key. Save/delete commands use the current revision and report stale edits instead of overwriting newer settings. Historical/deleted model definitions expose no Edit/Delete actions. Build: `npm run build`.',
   'delivery':'Focused native checks: `node scripts/test-model-management-179-v5.mjs` (21 cases: 10 model-management cases plus 11 existing model-connection cases). Runtime: `package-model-management-179-v1.py` and `install-model-management-179-v1.sh`. Overlay `/opt/workmate/overlays/model-management-179/`, schema158. Existing credentials and unrelated services remain unchanged; any frontend rollback must retain a schema158-compatible API. Native PostgreSQL only; no local Docker/WSL. Browser scripts close their own contexts and browser in finally blocks.'
  }[branch]
  shot=r['media'][0]['path'] if branch=='admin' else 'https://raw.githubusercontent.com/copypasteltd/workmate/admin/'+r['media'][0]['path']
  gif='assets/demos/179-model-management.gif' if branch=='admin' else 'https://raw.githubusercontent.com/copypasteltd/workmate/admin/assets/demos/179-model-management.gif'
  block=f'<!-- model-management-179 -->\n## {title}\n\n{intro}\n\n{behavior}\n\n{detail}\n\n{diagram}\n[Usage and implementation / 使用细则]({guide})\n\n![Actual editing of an existing model]({shot})\n\n![Actual save and deletion]({gif})\n\nEarlier implementation and deployment records follow. 以下为原有版本记录。\n\n---\n\n'
  first,_,rest=old.partition('\n');p.write_text(first+'\n\n'+block+rest.lstrip('\n'),encoding='utf-8',newline='\n')
for name in ['README.md','README.en.md']:
 p=ROOT/'docs'/name;old=p.read_text(encoding='utf-8');assert '<!-- model-management-179 -->' not in old
 block='''<!-- model-management-179 -->
## 已有模型可编辑和删除 / Edit and delete existing models

[正式后台 / Admin](https://agent-dashboard.copypaste.hk/catalog?view=capabilities) · [需求 / Requirements](requirements/179-model-management.md) · [操作和开发 / Usage and implementation](development/179-model-management.md) · [变更 / Changes](changes/179-model-management.md) · [核查 / Evidence](quality/model-management-179.json)

列表及详情提供直接编辑、保存更改、确认删除。当前模型显示更新后的配置；已删除模型移出可用目录，新工作不能选择，原任务和账务保留。API Key 可直接输入替换，原 Key 不回显。

Existing models now have explicit Edit/Delete actions. Saving updates the current entry; deletion blocks future selection and bootstrap fallback while preserving old task/accounting facts. Keys remain encrypted and are never returned.

![实际编辑已有模型 / Actual existing-model edit](assets/model-management-179/model-form.png)

![实际保存和删除 / Actual save and delete](assets/model-management-179/179-model-management.gif)

Earlier records follow. 以下为历史记录。

---

'''
 p.write_text(block+old,encoding='utf-8',newline='\n')
def files(repo,patterns):return sorted({p.relative_to(repo).as_posix() for pattern in patterns for p in repo.glob(pattern) if p.is_file()})
names={b:[] for b in [*COMP,'docs']}
names['backend']=['README.md','README.en.md',*['src/'+n+'.ts' for n in ['capability-releases','model-entry-management','catalog','capability-bindings','schema-compatibility','server']],*files(DEV/'copypaste-platform',['migrations/158-model-entry-management.sql','tests/model-management-179-*.test.ts'])]
names['admin']=['README.md','README.en.md',*['src/'+n for n in ['capabilities.tsx','capability-model.ts','model-connection.tsx','capabilities.css']],*files(DEV/'copypaste-admin',['assets/screenshots/179-*.png','assets/demos/179-*'])]
names['delivery']=['README.md','README.en.md',*files(D,['scripts/*179*'])]
names['docs']=['docs/README.md','docs/README.en.md',*files(ROOT,['docs/requirements/179-*','docs/development/179-*','docs/changes/179-*','docs/tools/*model-management-179*','docs/assets/model-management-179/*'])]
sources={}
for b,paths in names.items():
 repo=ROOT if b=='docs' else DEV/('copypaste-'+COMP[b])
 for n in paths:sources[(repo/n).relative_to(ROOT).as_posix()]=sha256((repo/n).read_bytes()).hexdigest()
tests=[]
for version in range(1,6):
 if version==1:log=D/'.data/model-management-179/5b36320f-9e6b-4b73-b734-dc8389b276a9/native-tests.log'
 else:
  output=(D/f'.data/model-management-179-run-v{version}.output.log').read_text(encoding='utf-8')
  metadata=json.loads(next(l for l in output.splitlines() if l.startswith('{"stage":179')));log=Path(metadata['log'])/'native-tests.log'
 text=log.read_text(encoding='utf-8',errors='replace');counts={k:int(re.search(r'^# '+k+r' (\d+)$',text,re.M)[1]) for k in ['tests','pass','fail']}
 if version==5:assert counts=={'tests':21,'pass':21,'fail':0}
 tests.append({'version':version,'path':log.relative_to(ROOT).as_posix(),'sha256':sha256(log.read_bytes()).hexdigest(),**counts})
server=json.loads((P/'server-runtime.json').read_bytes());final=json.loads((P/'server-final.json').read_bytes())
assert server['status']=='deployed' and server['schema_version']==158 and final['status']=='finalized'
admin=(P/'admin-form-tests.log').read_text();assert '# pass 3' in admin and '# fail 0' in admin
report={'stage':179,'at':datetime.now(timezone.utc).isoformat(),'status':'deployed_and_qualified','scope':'Direct editing and deletion of existing model entries; encrypted-key replacement, stable current entry, retained task bindings and blocked new selection','sources':sources,'media':media,'deployment':server,'operator_finalization':final,'browser':{k:v for k,v in r.items() if k!='video'},'backend_attempts':tests,'current_related_backend_checks':21,'current_backend_scope':'10 model-management checks and 11 previous model-connection checks, not a full application regression','admin_form_checks':3,'builds':{'backend':'passed','admin':'passed'},'original_attempts_retained':True,'attempt_notes':['Initial deleted-model view was extended to explicit model connection bindings without a validation row','Duplicate fixture insertion and error/route assertions were corrected in new test versions; original failures remain','Initial public API body timed out; v2 qualifies the actual public administrator proxy and browser UI; it closes its browser'],'limitations':['No real supplier model key or quality qualified','Edited configurations need validation/publication before customer adoption','Existing task bindings and their child work keep their original connection; deletion blocks new top-level selection','No new Desktop/Extension installer; existing clients continue through the company gateway','Frozen releases, prior proof scope, unrelated services and user files retained'],'prior_evidence_sha256':sha256((ROOT/'docs/quality/model-connections-178.json').read_bytes()).hexdigest(),'virtualization_invoked':False}
with (ROOT/'docs/quality/model-management-179.json').open('x',encoding='utf-8',newline='\n') as f:json.dump(report,f,ensure_ascii=False,indent=2)
names['docs'].append('docs/quality/model-management-179.json')
with (P/'publication-paths.json').open('x',encoding='utf-8',newline='\n') as f:json.dump({k:sorted(set(v)) for k,v in names.items()},f,indent=2)
print(json.dumps({'status':'prepared','paths':{k:len(v) for k,v in names.items()},'backend':21,'public_browser':len(r['checks'])}))
