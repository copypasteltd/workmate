"""Record controlled-budget qualification and synchronize bilingual delivery documentation."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse,json,re,shutil,subprocess
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';L=DEV/'copypaste-delivery';Q=ROOT/'docs/quality';CP=Q/'external-budget-checkpoint.json'
COMPONENTS=['platform','web','admin','desktop','extension','delivery']
def read(p):return json.loads(p.read_text('utf-8-sig'))
def digest(p):return sha256(p.read_bytes()).hexdigest()
def ref(p):return dict(path=p.relative_to(ROOT).as_posix(),sha256=digest(p))
def write(p,value):
 assert not p.exists(),p
 p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
def checked(p):
 v=read(p);assert v['source_unchanged'],p
 for c in v.get('checks',[]):
  if not isinstance(c,dict) or 'raw_report' not in c:continue
  raw=L/c['raw_report']['path'];assert digest(raw)==c['raw_report']['sha256']
  if 'counts' in c:
   counts={k:int(re.findall(r'^# '+k+r' (\d+)\r?$',raw.read_text('utf-8'),re.M)[0]) for k in ['tests','pass','fail','cancelled','skipped','todo']};assert counts==c['counts']
 return v

def record(core,ui,clients):
 paths=[L/f'evidence/external-budget-core-{core}.json',L/f'evidence/external-budget-ui-{ui}.json',L/f'evidence/external-budget-clients-{clients}.json']
 backend,browser,builds=[checked(p) for p in paths]
 for v in [backend,browser,builds]:assert v['status']=='passed' and v['owned_database_shutdown']
 for v in [backend,builds]:assert all(c['exit_code']==0 for c in v['checks'])
 counts={c['name']:c['counts'] for c in backend['checks'] if 'counts' in c};assert set(counts)=={'backend','desktop-unit','native-codex'}
 for c in counts.values():assert c['tests']==c['pass'] and all(c[k]==0 for k in ['fail','cancelled','skipped','todo'])
 assert browser['packaged_unchanged'] and browser['owned_preview_closed']
 jp=L/browser['journey']['path'];assert digest(jp)==browser['journey']['sha256'];j=read(jp)
 assert j['status']=='passed' and len(j['checks'])==12 and len(j['screenshots'])==6 and len(j['layouts'])==3
 assert len(j['recordings'])==3 and all(r['distinct_frames']>1 and r['skipped_capture_errors']==0 for r in j['recordings'])
 assert j['model_calls']==0 and all(j[k] for k in ['electron_closed','browser_closed','api_closed','fixture_closed'])
 sources={}
 for v in [backend,browser,builds]:
  for n,h in v['source_files'].items():
   assert digest(DEV/n)==h,n
   assert sources.get('dev/'+n,h)==h,n
   sources['dev/'+n]=h
 contract=ROOT/'docs/contracts/external-budget.openapi.json';mirror=DEV/'copypaste-platform/contracts/external-budget-schemas.json'
 assert read(mirror)['normative_source_sha256']==digest(contract) and read(mirror)['schemas']==read(contract)['components']['schemas']
 sources[contract.relative_to(ROOT).as_posix()]=digest(contract)
 baseline=read(Q/'report-layout-checkpoint.json')
 for n,h in baseline['source_files'].items():
  if n.startswith('dev/copypaste-platform/migrations/'):assert sources[n]==h,n
 for row in j['screenshots']+[f for m in j['recordings'] for f in m['files']]:assert digest(DEV/row['path'])==row['sha256']
 original=read(Q/'history/stage96-before-solution-packages/receipt.json');progress=read(Q/'requirements-alignment-progress.json')
 assert progress['requirements']==original['requirements'] and progress['gates']==original['gates']
 assert progress['fully_accepted_requirements']==progress['qualified_live_roles']==0
 attempts=[]
 for pattern in ['external-budget-core-??.json','external-budget-focused-??.json','external-budget-native-??.json','external-budget-ui-??.json','external-budget-clients-??.json']:
  for p in sorted((L/'evidence').glob(pattern)):
   v=checked(p);attempts.append({**ref(p),'status':v['status'],'error':v.get('error')})
 write(CP,dict(at=datetime.now(timezone.utc).isoformat(),stage=113,status='verified_controlled_advertising_budgets',scope='Controlled Google Ads average daily budget policy, immutable actor-bound preview, customer confirmation or explicit within-policy execution, durable single dispatch, encrypted receipt recovery, unknown observation/manual closure, scoped recent-MFA Admin control and marketing-analyst 1.3.0. Actual Web, Admin and unsigned packaged native Desktop; synthetic model/provider accounts. Affected functionality only.',source_files=dict(sorted(sources.items())),selected_core=ref(paths[0]),selected_ui=ref(paths[1]),client_builds=ref(paths[2]),counts=counts,journey=ref(jp),actual_ui_checks=12,screenshots=j['screenshots'],recordings=j['recordings'],layouts=j['layouts'],attempts=attempts,new_migrations=['124-external-budget-operations.sql'],new_routes=read(DEV/'copypaste-platform/contracts/external-budget-route-additions.json')['routes'],retained_stage112=ref(Q/'report-layout-checkpoint.json'),original_requirements_modified=False,fully_accepted_requirements=0,qualified_live_roles=0,verifier_sha256=digest(Path(__file__))))
 print(json.dumps(dict(status='verified_controlled_advertising_budgets',sources=len(sources),counts=counts)))

def sync():
 cp=read(CP);assert cp['verifier_sha256']==digest(Path(__file__))
 changes=[];copies=[]
 for row in cp['screenshots']+[f for m in cp['recordings'] for f in m['files']]:
  src=DEV/row['path'];client=Path(row['path']).parts[0];dst=ROOT/'docs/design/implementation'/(client+'__'+src.name)
  assert not dst.exists();shutil.copyfile(src,dst);assert digest(dst)==row['sha256'];copies.append(dict(source=src.relative_to(ROOT).as_posix(),target=dst.relative_to(ROOT).as_posix(),sha256=digest(dst)))
 diagram='```mermaid\nflowchart LR\n  Login[Login and project authority] --> Policy[Explicit bounded budget policy]\n  Policy --> Preview[Immutable exact preview]\n  Preview --> Confirm[Customer confirmation or authorized policy]\n  Confirm --> Admission[Revalidate and persist dispatch]\n  Admission --> Once[One provider mutation]\n  Once --> Receipt[Encrypted receipt and immutable events]\n  Once --> Unknown[Unknown never resent]\n  Unknown --> Review[Observe and manually close]\n  Admin[Scoped Admin and current MFA] --> Policy\n  Admin --> Review\n```\n'
 details={
 'platform':('Apply forward-only migration 124. The fixed-field Google Ads mutation has no retry; ambiguous outcomes remain unknown. Recovery records the original AEAD-encrypted reply without another mutation. Old role versions and admin bindings retain their permissions.','执行向前迁移 124。固定字段 Google Ads 修改不重试；不明结果保留 unknown。恢复只补记原 AEAD 加密回应，不再调用修改。历史角色及旧管理员授权不自动扩大。'),
 'web':('Connections → Google Ads → authorize and bind an advertiser/project → Manage budgets & operations → configure policy → exact preview → submit → customer-manager confirmation → immutable receipt. Changed inputs require a fresh preview.','连接应用 → Google Ads 授权并绑定广告主及项目 → 管理预算与操作 → 策略 → 确切预览 → 提交 → 客户管理者确认 → 不可改写回执。修改输入须重新预览。'),
 'desktop':('The same complete panel uses the authenticated native bridge. The actual packaged Desktop keeps local Codex, revocable full permission, frameless windows, no Electron menu, hidden scrollbar rails and no horizontal overflow. Read-only local Codex cannot prepare budget changes.','完整面板使用原生授权 bridge。实际打包 Desktop 维持本机 Codex、可撤回完整权限、无边框、无 Electron 菜单、隐藏滚动条且无横向溢出；只读本机 Codex 不可提交预算操作。'),
 'admin':('Open Advertising budget control with separate read, policy-write and resolve permissions. Global/tenant/project scope, explicit deny and recent MFA apply on every request. Admin may cancel undispatched work or review unknown results, and cannot confirm as a customer.','在广告预算控制中按读取、策略修改、异常处理三类权限操作；每次请求校验全局／企业／项目范围、显式拒绝及近期 MFA。可取消未发出操作及核对未知结果，不能冒充客户确认。'),
 'extension':('The native Chrome right Side Panel retains cloud Codex conversations and authorized file uploads. Marketing-analyst 1.3.0 adds policy-bound budget preview, prepare and status tools for new instances; the full policy and confirmation panel opens in company Web. No new Side Panel UI journey is claimed here.','Chrome 原生右侧栏维持云端 Codex 对话及获准文件上传。新实例可用 marketing-analyst 1.3.0 的策略内预算预览、提案和状态工具；完整策略与确认面板在公司 Web 打开。本轮未宣称新增侧栏界面验收。'),
 'delivery':('Immutable scripts run native PostgreSQL, current schema and source checks, real pinned Codex, actual Web/Admin UI and an unsigned packaged Electron candidate. All owned processes and browser pages are closed; failed attempts retain their original bytes.','固定验证脚本使用原生 PostgreSQL、当前迁移与源码、真实固定版本 Codex、实际 Web／Admin 及未签名 Electron 打包版。清理自建进程和页面，失败尝试保留原字节。')}
 count=' · '.join(str(cp['counts'][k]['tests'])+' '+label for k,label in [('backend','backend'),('desktop-unit','Desktop unit'),('native-codex','actual native Codex')])
 for folder in [ROOT/'docs']+[DEV/('copypaste-'+c) for c in COMPONENTS]:
  component=folder.name.removeprefix('copypaste-');client=component if component in ['desktop','admin'] else 'web'
  first=next(r for r in cp['screenshots'] if r['path'].startswith('copypaste-'+client+'/'))
  movie=next(f for m in cp['recordings'] if m['component']==client for f in m['files'] if f['path'].endswith('.gif'))
  for name in ['README.md','README.en.md']:
   p=folder/name;old=p.read_bytes();title,body=old.split(b'\n',1);en=name.endswith('.en.md');text='<!-- controlled-budget-stage113 -->\n'
   text+=('Google Ads budget changes now have an explicit expiring policy, exact immutable previews, customer confirmation, a single durable dispatch and immutable receipts. Unknown outcomes are observed and manually closed without resending.\n\n' if en else 'Google Ads 预算修改已接通有期限的明确策略、不可改写的确切预览、客户确认、一次持久入场及原始回执。未知结果经观察及人工核对关闭，不重发修改。\n\n')
   if component in details:text+=details[component][0 if en else 1]+'\n\n'
   text+=count+' · 12 actual client flows · 3 measured layouts. '
   text+=('Synthetic models/accounts and an unsigned installer candidate; real advertising spend, production signing and full-product acceptance remain unproven. Average daily budget is not a maximum daily charge; Google bills advertising separately.\n\n' if en else '模型及账户为假数据，安装候选未签名；真实广告费、正式签名与全产品验收尚未证明。平均每日预算不是每日最高扣款，Google 广告费与公司 AI 账单独立。\n\n')
   if component in ['platform','admin']:
    text+=('Existing deployments: explicitly grant the new permissions to an enrolled permanent global super through `npm run admin:enable-external-budget -- operator@example.com --acknowledge-global-budget-authority` in the backend repository. Old roles never auto-expand.\n\n' if en else '已有部署：在后端仓库对已登记的永久全局 super 明确运行 `npm run admin:enable-external-budget -- operator@example.com --acknowledge-global-budget-authority` 后再委派新权限，旧角色不自动扩大。\n\n')
   if folder==ROOT/'docs':
    text+='[Design / 方案](technical/113-controlled-advertising-budgets.md) · [Evidence / 证据](quality/external-budget-checkpoint.json)\n\n';image='design/implementation/copypaste-'+client+'__'+Path(first['path']).name;gif='design/implementation/copypaste-'+client+'__'+Path(movie['path']).name
   else:
    text+='[Design / 方案](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/113-controlled-advertising-budgets.md) · [Evidence / 证据](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/external-budget-checkpoint.json)\n\n'
    def media_link(row):
     local=Path(row['path']).relative_to('copypaste-'+client).as_posix();return local if component==client else 'https://raw.githubusercontent.com/copypasteltd/workmate/'+client+'/'+local
    image=media_link(first);gif=media_link(movie)
   text+=diagram+f'\n![Actual scoped budget panel / 实际预算面板]({image})\n\n![Actual interaction / 实际交互]({gif})\n\n'
   p.write_bytes(title+b'\n\n'+text.encode()+body);changes.append(dict(path=p.relative_to(ROOT).as_posix(),before_sha256=sha256(old).hexdigest(),after_sha256=digest(p)))
 p=Q/'requirements-alignment-progress.json';old=p.read_bytes();progress=read(p);progress['controlled_advertising_budgets']=dict(checkpoint=ref(CP),counts=cp['counts'],actual_client_flows=12,original_requirements_modified=False,full_acceptance='not_proven');p.write_text(json.dumps(progress,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n');changes.append(dict(path=p.relative_to(ROOT).as_posix(),before_sha256=sha256(old).hexdigest(),after_sha256=digest(p)))
 for en in [False,True]:
  p=ROOT/('docs/changes/2026-10-27-controlled-advertising-budgets'+('.en' if en else '')+'.md');assert not p.exists();p.write_text(('# Controlled advertising budgets\n\n' if en else '# 广告预算执行\n\n')+('Implemented scoped Google Ads policies, exact preview, customer confirmation, fixed single mutation, encrypted receipt recovery, unknown observation/closure, scoped MFA-bound Admin and marketing-analyst 1.3.0.\n\n' if en else '接通 Google Ads 策略、确切预览、客户确认、固定一次修改、加密回执恢复、未知结果观察／关闭、按范围与近期 MFA 控制的 Admin 及 marketing-analyst 1.3.0。\n\n')+count+'; 12 actual client flows, 3 measured layouts.\n\nSynthetic provider/model data only. Original full acceptance gates and failed attempts remain unchanged. / 使用假供应商及模型，保留原完整验收门槛及失败尝试。\n\n[Design / 方案](../technical/113-controlled-advertising-budgets.md) · [Evidence / 证据](../quality/external-budget-checkpoint.json)\n',encoding='utf-8',newline='\n')
 write(Q/'external-budget-documentation-refresh.json',dict(checkpoint=ref(CP),changes=changes,media_copies=copies,verifier_sha256=digest(Path(__file__))))

def audit():
 from markdown_it import MarkdownIt
 from urllib.parse import urlsplit,unquote
 cp=read(CP);refresh=read(Q/'external-budget-documentation-refresh.json');assert cp['verifier_sha256']==refresh['verifier_sha256']==digest(Path(__file__))
 for n,h in cp['source_files'].items():assert digest(ROOT/n)==h,n
 for r in refresh['changes']:assert digest(ROOT/r['path'])==r['after_sha256']
 for r in refresh['media_copies']:assert digest(ROOT/r['source'])==digest(ROOT/r['target'])==r['sha256']
 links=0;parser=MarkdownIt()
 for folder in [ROOT/'docs']+[DEV/('copypaste-'+c) for c in COMPONENTS]:
  for name in ['README.md','README.en.md']:
   p=folder/name;body=p.read_text('utf-8');assert '<!-- controlled-budget-stage113 -->' in body
   for token in parser.parse(body):
    for child in token.children or []:
     v=child.attrGet('src') if child.type=='image' else child.attrGet('href') if child.type=='link_open' else None
     if v and not urlsplit(v).scheme and not v.startswith('#'):assert (p.parent/unquote(urlsplit(v).path)).exists(),(p,v);links+=1
 decoded=[]
 for movie in cp['recordings']:
  for row in movie['files']:
   p=DEV/row['path'];probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=nb_read_frames:format=duration','-of','json',str(p)]))
   assert int(probe['streams'][0]['nb_read_frames'])>1 and abs(float(probe['format']['duration'])-movie['seconds'])<=.25
   r=subprocess.run(['ffmpeg','-v','error','-xerror','-err_detect','explode','-i',str(p),'-map','0:v:0','-f','null','-'],capture_output=True,check=True);assert not r.stderr.strip();decoded.append(row)
 original=read(Q/'history/stage96-before-solution-packages/receipt.json');now=read(Q/'requirements-alignment-progress.json');assert now['requirements']==original['requirements'] and now['gates']==original['gates']
 write(Q/'external-budget-docs-audit-01.json',dict(status='passed',checkpoint=ref(CP),bilingual_readmes=14,local_readme_links=links,decoded_recordings=decoded,original_matrix_unchanged=True,verifier_sha256=digest(Path(__file__))))
 print(json.dumps(dict(status='passed',readmes=14,links=links,decoded=len(decoded))))
p=argparse.ArgumentParser();p.add_argument('action',choices=['record','sync','audit']);p.add_argument('--core',default='01');p.add_argument('--ui',default='02');p.add_argument('--clients',default='01');a=p.parse_args()
if a.action=='record':record(a.core,a.ui,a.clients)
elif a.action=='sync':sync()
else:audit()
