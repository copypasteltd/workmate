"""Bind this model configuration increment to its actual source and media."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json,subprocess

ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';D=DEV/'copypaste-delivery';P=D/'.data/deployment-178'
COMP={'backend':'platform','web':'web','admin':'admin','desktop':'desktop','extension':'extension','delivery':'delivery'}
browser=P/'browser-cdb03034-7f0f-4f3b-b68c-da666853b1c2/receipt.json'
r=json.loads(browser.read_bytes());assert r['status']=='passed' and r['browser_closed'] and len(r['checks'])==4
media=json.loads((P/'media.sanitized.json').read_bytes())['files']
for row in media:assert sha256((ROOT/row['path']).read_bytes()).hexdigest()==row['sha256']
guide='https://github.com/copypasteltd/workmate/blob/docs/docs/releases/model-connections-178.md'
diagram='''```mermaid
flowchart LR
 A[Model, URL and API Key] --> D[Immutable model configuration]
 D --> C[Connection check]
 C --> V[Validation and independent publication]
 V --> T[Task freezes model version]
 T --> G[Company gateway]
 G --> U[That model upstream]
```
'''
for branch in ['backend','web','admin','delivery']:
 repo=DEV/('copypaste-'+COMP[branch])
 for name in ['README.md','README.en.md']:
  p=repo/name;old=p.read_text(encoding='utf-8');assert '<!-- per-model-connections-178 -->' not in old
  english=name=='README.en.md'
  title='Per-model API configuration · stage178' if english else '每个模型独立配置上游 · 阶段178'
  intro=('Open [Admin → Model capabilities](https://agent-dashboard.copypaste.hk/catalog?view=capabilities) → **Create configuration**. Enter `gpt-6-luna` (or the actual upstream alias), its **API Base URL** and **API Key** in the same form. Each model owns its address and key. Text models require the OpenAI Responses API.' if english else
   '进入 [Admin → 模型能力](https://agent-dashboard.copypaste.hk/catalog?view=capabilities) → **建立配置**，在同一表单填写 `gpt-6-luna`（或上游实际模型别名）、**API Base URL** 和 **API Key**。每个模型独立保存地址及密钥，文字模型须支持 OpenAI Responses API。')
  flow=('Save draft → test connection → run full capability validation → independent approval/publication → assign the published capability to roles/templates. A connection test reads `/models`; it does not publish a model. Validation and real use consume actual upstream credit, including in the current trial-accounting environment.' if english else
   '使用流程：保存草稿 → 测试连接 → 完整能力验证 → 独立审批发布 → 在角色／模板中绑定已发布能力。连接测试读取 `/models`，保存和测试不会自动发布。完整验证和真实使用会消耗实际上游额度，当前试用记账环境也一样。')
  security=('The server encrypts keys and never returns them. Version changes preserve frozen task connections. Retain an existing key explicitly when copying a version; changing the URL or network scope requires a new key. Missing explicit connections fail closed. No real supplier key was configured for this deployment.' if english else
   '密钥由服务器加密保存且不回显；新版本保留原任务冻结的连接。复制版本可明确保留原密钥，更换地址或网络范围必须重新填写。缺少明确连接时直接报错。本轮没有代填真实供应商密钥。')
  details={
   'backend':'Storage: `capability_model_connections`, migration157, cp_control-only encrypted credentials. Draft: `POST /v1/admin/capability-releases/drafts` with `connection: {base_url, api_key, allow_private_network}`. Probe: `POST /v1/admin/capability-releases/:id/connection-test`. Both use existing `admin.catalog.publish` authorization. Task execution resolves credentials by the frozen capability version and verifies model/operation; clients cannot override that identity. Build: `npm run build`. Related native PostgreSQL checks: `../copypaste-delivery/scripts/test-model-connections-178-v4.mjs`.',
   'admin':'The same upstream fields appear for text, image, video, speech and transcription profiles. New configurations require an explicit URL/key. Detail views show only the URL and configured-key status. Copying a version supports explicit key retention with the same normalized URL/network scope. Build: `npm run build`; focused form checks: `node --import tsx --test tests/model-connection-178-v1.test.ts`.',
   'web':'Customer requests continue through the company API. Supplier keys never reach the browser. The trial notice distinguishes simulated accounting/default fixtures from real calls made by explicitly configured models. Existing task authorization, credits and published role selection remain in force. Build: `npm run build`.',
   'delivery':'Run `node scripts/test-model-connections-178-v4.mjs` for the isolated native PostgreSQL model-connection checks. `package-model-connections-178-v1.py` creates the immutable runtime overlay; `install-model-connections-178-v1.sh` migrates schema157 and switches only owned services. Existing server credentials are preserved. Forward-compatible API is required when rolling back frontends after migration. Never invoke local Docker/WSL. Browser verifiers close their own contexts and browser in finally blocks.'
  }[branch]
  shot=r['media'][0]['path'] if branch=='admin' else 'https://raw.githubusercontent.com/copypasteltd/workmate/admin/'+r['media'][0]['path']
  gif='assets/demos/178-model-connections.gif' if branch=='admin' else 'https://raw.githubusercontent.com/copypasteltd/workmate/admin/assets/demos/178-model-connections.gif'
  block=f'<!-- per-model-connections-178 -->\n## {title}\n\n{intro}\n\n{flow}\n\n{security}\n\n{details}\n\n{diagram}\n[使用细则 / Usage and operations]({guide}) · [Source/runtime increment](https://agent.copypaste.hk/downloads/workmate-model-configuration-178.zip)\n\n![Actual model form]({shot})\n\n![Actual save and connection test]({gif})\n\nEarlier deployment/release records follow; their synthetic-service descriptions describe their original scope. 以下历史记录保留原部署范围。\n\n---\n\n'
  first,sep,rest=old.partition('\n');p.write_text(first+'\n\n'+block+rest.lstrip('\n'),encoding='utf-8',newline='\n')
for name in ['README.md','README.en.md']:
 p=ROOT/'docs'/name;old=p.read_text(encoding='utf-8');assert '<!-- per-model-connections-178 -->' not in old
 p.write_text('<!-- per-model-connections-178 -->\n## 每个模型独立配置上游 / Per-model upstream configuration\n\n[正式后台 / Admin](https://agent-dashboard.copypaste.hk/catalog?view=capabilities) · [使用 / Usage](releases/model-connections-178.md) · [需求 / Requirements](requirements/178-per-model-connections.md) · [开发 / Implementation](development/178-per-model-connections.md) · [变更 / Changes](changes/178-per-model-connections.md) · [核查 / Evidence](quality/model-connections-178.json)\n\n新增模型时填写该模型的 API 地址和 API Key；保存、连接测试、能力验证及独立审批发布后使用。每个模型版本保留独立连接；明确配置的上游会实际请求。\n\nEach model owns its URL and encrypted key. Connection checks and full validation precede independent publication. Existing task versions keep their original upstream. No real supplier key was supplied for this deployment.\n\n![实际模型配置 / Actual model form](assets/model-connections-178/model-form.png)\n\n![实际交互 / Actual interaction](assets/model-connections-178/178-model-connections.gif)\n\nEarlier deployment records follow. 以下为历史记录。\n\n---\n\n'+old,encoding='utf-8',newline='\n')

names={b:[] for b in [*COMP,'docs']}
def relative_files(repo,patterns):
 return sorted({p.relative_to(repo).as_posix() for pattern in patterns for p in repo.glob(pattern) if p.is_file()})
names['backend']=['README.md','README.en.md',*['src/'+n+'.ts' for n in ['capability-audio-verification','capability-bindings','capability-releases','capability-verification','capability-video-verification','catalog','config','internal-ai-gateway','runtime','schema-compatibility','server','model-connections','model-connection-http']],*relative_files(DEV/'copypaste-platform',['migrations/157-per-model-connections.sql','tests/model-connections-178-*.test.ts'])]
names['admin']=['README.md','README.en.md',*['src/'+n for n in ['capabilities.css','capabilities.tsx','capability-model.ts','data-mode.tsx','model-connection.tsx']],*relative_files(DEV/'copypaste-admin',['tests/model-connection-178-*.test.ts','assets/screenshots/178-*.png','assets/demos/178-*'])]
names['web']=['README.md','README.en.md','src/data-mode.tsx']
names['delivery']=['README.md','README.en.md',*relative_files(D,['scripts/*178*'])]
names['docs']=['docs/README.md','docs/README.en.md',*relative_files(ROOT,['docs/requirements/178-*','docs/development/178-*','docs/changes/178-*','docs/releases/model-connections-178.md','docs/tools/*model-connections-178*','docs/assets/model-connections-178/*'])]
sources={}
for b,paths in names.items():
 repo=ROOT if b=='docs' else DEV/('copypaste-'+COMP[b])
 for n in paths:sources[(repo/n).relative_to(ROOT).as_posix()]=sha256((repo/n).read_bytes()).hexdigest()
test_runs=[]
for version,run in [(1,'27c79538-70ab-4fdb-9998-a5af43a5af2b'),(2,'cb18de2b-845b-445d-8778-9b0bea8f9d48'),(3,'094573d9-6fa5-4054-9faf-de8b0aed108e'),(4,'530fc42a-572f-4ae1-854d-2a2e8adad9f0')]:
 log=D/'.data/model-connections-178'/run/'native-tests.log'
 # Retain every original attempt; only the final versions are current assertions.
 if not log.exists():
  assert version==1
  log=next(p for p in (D/'.data/model-connections-178').glob('27c79538-*/native-tests.log'))
 text=log.read_text(encoding='utf-8',errors='replace')
 counts={key:int(__import__('re').search(r'^# '+key+r' (\d+)$',text,__import__('re').M)[1]) for key in ['tests','pass','fail']}
 if version>=3:assert counts['fail']==0
 test_runs.append({'version':version,'path':log.relative_to(ROOT).as_posix(),'sha256':sha256(log.read_bytes()).hexdigest(),**counts})
server=json.loads((P/'server-runtime.json').read_bytes());assert server['status']=='deployed' and server['schema_version']==157
report={'stage':178,'at':datetime.now(timezone.utc).isoformat(),'status':'deployed_and_qualified','scope':'Per-model API address/key configuration, protected storage, frozen-version routing, Admin UI and owned deployment only','sources':sources,'media':media,'deployment':server,'browser':r,'related_backend_runs':test_runs,'test_count_note':'v3 includes 9 model cases and 25 existing gateway/schema cases; v4 contains the final 11 model cases. These overlap and are not 45 unique tests. Original failed attempts remain unchanged. Admin form checks: 3 passed; platform, Admin and Web builds passed.','limitations':['No real supplier API key or vendor model quality qualified','Connection test reads /models only; actual inference still requires full capability validation and independent publication','Trial accounting remains simulated; explicitly bound model connections use actual upstream calls','One clearly marked unpublished invalid-host verification draft remains; no customer model was published','Intermittent public network timeouts and missing browser-recording dependency retained as failed verifier receipts; successful v5 closes its browser','Unchanged Desktop/Extension installers, frozen releases, user-owned files and original full-product acceptance scope retained'],'virtualization_invoked':False}
report['browser'].pop('video',None)
with (ROOT/'docs/quality/model-connections-178.json').open('x',encoding='utf-8',newline='\n') as f:json.dump(report,f,ensure_ascii=False,indent=2)
names['docs'].append('docs/quality/model-connections-178.json')
with (P/'publication-paths.json').open('x',encoding='utf-8',newline='\n') as f:json.dump({k:sorted(set(v)) for k,v in names.items()},f,indent=2)
print(json.dumps({'status':'prepared','paths':{k:len(v) for k,v in names.items()},'backend_runs':[r['pass'] for r in test_runs],'browser_checks':len(r['checks'])}))
