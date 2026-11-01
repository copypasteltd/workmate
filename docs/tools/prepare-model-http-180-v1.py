"""Bind this transport change to actual tests, deployment and authenticated browser evidence."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json,re

ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';D=DEV/'copypaste-delivery';P=D/'.data/deployment-180'
COMP={'backend':'platform','web':'web','admin':'admin','desktop':'desktop','extension':'extension','delivery':'delivery'}
browser=[p for p in P.glob('browser-*/receipt.json') if json.loads(p.read_bytes()).get('status')=='passed']
assert len(browser)==1
r=json.loads(browser[0].read_bytes());assert r['browser_closed'] and r['connection_result']['reachable'] and r['connection_result']['model_available']
media=json.loads((P/'media.sanitized.json').read_bytes())['files']
for row in media:assert sha256((ROOT/row['path']).read_bytes()).hexdigest()==row['sha256']
output=(P/'native-test-output.log').read_text(encoding='utf-8')
meta=json.loads(next(l for l in output.splitlines() if l.startswith('{"stage":180')))
test=Path(meta['log'])/'native-tests.log';text=test.read_text(encoding='utf-8')
counts={k:int(re.search(r'^# '+k+r' (\d+)$',text,re.M)[1]) for k in ['tests','pass','fail']}
assert counts=={'tests':24,'pass':24,'fail':0}
server=json.loads((P/'server-runtime.json').read_bytes());assert server['status']=='deployed' and server['model_transport']=='http_and_https'
guide='https://github.com/copypasteltd/workmate/blob/docs/docs/development/180-model-http.md'
for branch in ['backend','admin','delivery']:
 repo=DEV/('copypaste-'+COMP[branch])
 for name in ['README.md','README.en.md']:
  p=repo/name;old=p.read_text(encoding='utf-8');assert '<!-- model-http-180 -->' not in old
  en=name.endswith('.en.md')
  title='HTTP and HTTPS model upstreams · stage180' if en else '模型接口支持 HTTP 和 HTTPS · 阶段180'
  intro=('Model API base URLs accept **HTTP and HTTPS**. Public HTTP does not need the private-network checkbox. Saving, connection tests, Codex capability verification and inference use the same transport. Existing addresses and encrypted keys are retained.' if en else '每模型 API 基础地址支持 **HTTP 和 HTTPS**；公网上游使用 HTTP 无须勾选内网选项。保存、连接测试、Codex 完整能力验证及推理使用同一传输规则。原模型地址及加密 Key 保留。')
  outcome=('The deployed gpt-6-luna connection was tested through the real Admin UI: authentication succeeded and the model list contains gpt-6-luna. This is a connection check, not full Codex capability qualification or automatic publication.' if en else '已在正式后台使用当前 gpt-6-luna 配置进行连接测试，接口及 Key 认证成功，返回列表包含该模型。这是实际连接结果，不代替 Codex 完整能力验证，也不自动发布模型。')
  detail=('Native related checks: `node scripts/test-model-http-180-v1.mjs` (24 cases). Runtime: `package-model-http-180-v1.py` and `install-model-http-180-v1.sh`. Overlay `/opt/workmate/overlays/model-http-180/`; schema158 unchanged. Backend and Admin builds passed. No new native installers or changes to unrelated services.' if branch=='delivery' else 'Build: `npm run build`. The per-model normalizer and shared transport support both schemes. Private address access still uses its explicit setting; the Admin label reflects this meaning.')
  shot=r['media'][-1]['path'] if branch=='admin' else 'https://raw.githubusercontent.com/copypasteltd/workmate/admin/'+r['media'][-1]['path']
  gif='assets/demos/180-model-http.gif' if branch=='admin' else 'https://raw.githubusercontent.com/copypasteltd/workmate/admin/assets/demos/180-model-http.gif'
  block=f'<!-- model-http-180 -->\n## {title}\n\n{intro}\n\n{outcome}\n\n{detail}\n\n[Usage and implementation / 使用与开发]({guide})\n\n![Actual HTTP model connection]({shot})\n\n![Actual connection test recording]({gif})\n\nEarlier records follow. 以下为历史记录。\n\n---\n\n'
  first,_,rest=old.partition('\n');p.write_text(first+'\n\n'+block+rest.lstrip('\n'),encoding='utf-8',newline='\n')
for name in ['README.md','README.en.md']:
 p=ROOT/'docs'/name;old=p.read_text(encoding='utf-8');assert '<!-- model-http-180 -->' not in old
 block='''<!-- model-http-180 -->
## 模型 HTTP/HTTPS 上游 / Model HTTP/HTTPS upstreams

公网模型 HTTP 不再被拦截，也不需要勾选内网选项。当前 gpt-6-luna 已在真实后台完成连接测试，认证成功且模型列表包含此模型。该结果不代替 Codex 完整验证或发布。

Public model HTTP is accepted without a private-network override. The real Admin connection test authenticates and lists the current gpt-6-luna model. Full Codex validation and publication remain separate.

[需求 / Requirements](requirements/180-model-http.md) · [开发 / Implementation](development/180-model-http.md) · [变更 / Changes](changes/180-model-http.md) · [实际证据 / Evidence](quality/model-http-180.json)

![实际连接成功 / Actual successful connection](assets/model-http-180/connected.png)

![实际操作 / Actual recording](assets/model-http-180/180-model-http.gif)

---

'''
 p.write_text(block+old,encoding='utf-8',newline='\n')
page=ROOT/'docs/development/180-model-http.md'
page.write_text(page.read_text(encoding='utf-8')+'\n\n![实际 HTTP 连接 / Actual HTTP connection](../assets/model-http-180/connected.png)\n\n![实际连接测试 / Actual connection test](../assets/model-http-180/180-model-http.gif)\n',encoding='utf-8',newline='\n')
publisher=(ROOT/'docs/tools/publish-model-management-179-v1.py').read_text(encoding='utf-8')
publisher=publisher.replace('deployment-179','deployment-180').replace('model-management-179','model-http-180').replace("'stage':179","'stage':180")
publisher=publisher.replace("(P/'qa-login-context.json')","(D/'.data/deployment-179/qa-login-context.json')")
publisher=publisher.replace('Enable direct model edits and deletion with retained task history (stage179)','Allow model upstream HTTP and HTTPS (stage180)')
with (ROOT/'docs/tools/publish-model-http-180-v1.py').open('x',encoding='utf-8',newline='\n') as f:f.write(publisher)

def files(repo,patterns):return sorted({p.relative_to(repo).as_posix() for pattern in patterns for p in repo.glob(pattern) if p.is_file()})
names={b:[] for b in [*COMP,'docs']}
names['backend']=['README.md','README.en.md','src/model-connections.ts','src/model-connection-http.ts','src/server.ts','tests/model-http-180-v1.test.ts']
names['admin']=['README.md','README.en.md','src/model-connection.tsx',*files(DEV/'copypaste-admin',['assets/screenshots/180-*.png','assets/demos/180-*'])]
names['delivery']=['README.md','README.en.md',*files(D,['scripts/*180*'])]
names['docs']=['docs/README.md','docs/README.en.md',*files(ROOT,['docs/requirements/180-*','docs/development/180-*','docs/changes/180-*','docs/tools/*model-http-180*','docs/assets/model-http-180/*'])]
sources={}
for branch,paths in names.items():
 repo=ROOT if branch=='docs' else DEV/('copypaste-'+COMP[branch])
 for n in paths:sources[(repo/n).relative_to(ROOT).as_posix()]=sha256((repo/n).read_bytes()).hexdigest()
attempts=[]
for p in sorted(P.glob('browser-*/receipt.json')):
 a=json.loads(p.read_bytes());attempts.append({k:v for k,v in a.items() if k!='video'})
report={'stage':180,'at':datetime.now(timezone.utc).isoformat(),'status':'deployed_and_qualified','scope':'Remove per-model public HTTP blocking; save-time and shared transport compatibility; actual gpt-6-luna model-list connection','sources':sources,'media':media,'deployment':server,'browser':{k:v for k,v in r.items() if k!='video'},'backend_checks':{'path':test.relative_to(ROOT).as_posix(),'sha256':sha256(test.read_bytes()).hexdigest(),**counts},'builds':{'backend':'passed','admin':'passed'},'limitations':['Actual connection test is not Codex capability validation, model quality qualification or publication','No database migration or native installer rebuild','Unchanged environment gateway configuration retains its separate legacy policy'],'incidental_build':{'path':'dev/copypaste-delivery/.data/deployment-180/admin-build.log','result':'Pre-existing Delivery type error in qa-admin-usage-report-169-v1.ts; accidentally invoked Delivery build, not used for this deployment. Actual Admin build passed.'},'prior_evidence_sha256':sha256((ROOT/'docs/quality/model-management-179.json').read_bytes()).hexdigest(),'virtualization_invoked':False}
report['browser_attempts']=attempts
report['server_livecheck']=json.loads((P/'server-livecheck.json').read_bytes())
assert report['server_livecheck']['http_status']==200 and report['server_livecheck']['model_available']
report['attempt_notes']=['The first public-browser attempt timed out reading the model list via APIRequestContext; original failed receipt retained. V2 reads through the actual authenticated browser fetch transport.']
with (ROOT/'docs/quality/model-http-180.json').open('x',encoding='utf-8',newline='\n') as f:json.dump(report,f,ensure_ascii=False,indent=2)
names['docs'].append('docs/quality/model-http-180.json')
with (P/'publication-paths.json').open('x',encoding='utf-8',newline='\n') as f:json.dump({k:sorted(set(v)) for k,v in names.items()},f,indent=2)
print(json.dumps({'status':'prepared','paths':{k:len(v) for k,v in names.items()},'native_tests':counts,'browser':len(r['checks'])}))
