"""Bind stage182 to deployed code, actual permission checks and authenticated UI evidence."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json,re,shutil
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';D=DEV/'copypaste-delivery';P=D/'.data/deployment-182'
COMP={'backend':'platform','web':'web','admin':'admin','desktop':'desktop','extension':'extension','delivery':'delivery'}
def digest(p):return sha256(p.read_bytes()).hexdigest()
def files(repo,patterns):return sorted({p.relative_to(repo).as_posix() for pattern in patterns for p in repo.glob(pattern) if p.is_file()})
attempts=[json.loads(p.read_bytes()) for p in sorted(P.glob('browser-*/receipt.json'))]
passed=[r for r in attempts if r['status']=='passed'];assert len(passed)==1
r=passed[0];assert r['browser_closed'] and len(r['checks'])==6
production=json.loads((P/'production-verification.json').read_bytes());assert production['status']=='production_direct_publication_verified'
assert production['operation']['id']==r['operation']['id'] and production['pending_review_count']==0
assert production['operation']['execution_mode']=='super_admin_direct' and all(production['preserved'].values())
server=json.loads((P/'server-runtime.json').read_bytes());assert server['status']=='deployed' and server['schema_version']==160
assert all(server[k] for k in ['credentials_unchanged','model_configuration_unchanged','foreign_configuration_unchanged','foreign_service_pids_unchanged','model_and_hold_hashes_unchanged'])
media=json.loads((P/'media.sanitized.json').read_bytes())['files']
for row in media:assert digest(ROOT/row['path'])==row['sha256']
proof=ROOT/'docs/quality/highest-admin-direct-182';proof.mkdir(exist_ok=False)
checks=[]
for name,total in [('direct-tests-v2.log',14),('financial-tests-v2.log',4)]:
 p=P/name;content=p.read_text(encoding='utf-8');counts={k:int(re.findall(r'^# '+k+r' (\d+)$',content,re.M)[-1]) for k in ['tests','pass','fail']}
 assert counts=={'tests':total,'pass':total,'fail':0},(name,counts)
 shutil.copyfile(p,proof/name);checks.append({'path':(proof/name).relative_to(ROOT).as_posix(),'sha256':digest(p),**counts})
for name in ['backend-build-v4.log','admin-build-v4.log']:
 content=(P/name).read_text(encoding='utf-8');assert 'error TS' not in content and 'ERR!' not in content
 shutil.copyfile(P/name,proof/name)
assert 'built in' in (P/'admin-build-v4.log').read_text(encoding='utf-8')
logs=[]
for p in sorted(P.glob('*.log')):
 if p.name in [x.name for x in proof.iterdir()]:continue
 shutil.copyfile(p,proof/p.name);logs.append({'path':(proof/p.name).relative_to(ROOT).as_posix(),'sha256':digest(p)})
guide='https://github.com/copypasteltd/workmate/blob/docs/docs/development/182-highest-admin-direct.md'
for branch in ['backend','admin','delivery']:
 repo=DEV/('copypaste-'+COMP[branch])
 for name in ['README.md','README.en.md']:
  p=repo/name;old=p.read_text(encoding='utf-8');assert '<!-- highest-admin-direct-182 -->' not in old
  en=name.endswith('.en.md')
  title='Highest-administrator direct execution · stage182' if en else '最高管理员直接执行 · 阶段182'
  intro=('Active global built-in super_admin executes protected administrative changes directly. Other roles keep policy-based approval and cannot approve their own protected requests. Sensitive operations retain MFA, business permissions, scope, limits and original evidence checks. Actual actors, reasons, command hashes and outcomes are audited atomically.' if en else '有效的全局内置 super_admin 可直接执行管理变更；其他角色按业务策略审批，不能审批自己的受控申请。敏感操作继续核对 MFA、业务权限、范围、限额和原始证据，真实操作者、原因、命令摘要及结果与业务效果一并保存审计。')
  actual=(f'Production gpt-6-luna was published directly through the real Admin UI. Operation `{r["operation"]["id"]}`, audit `{production["audit"]["id"]}`; no pending review was created.18 focused checks and6 real browser checks passed. Existing model settings, encrypted keys, unknown holds and historical violations are preserved. Additive schema160 requires the matching API.' if en else f'当前 gpt-6-luna 已通过真实后台直接发布：操作 `{r["operation"]["id"]}`、审计 `{production["audit"]["id"]}`，未生成待审批申请。18项相关检查、6项真实页面检查通过。原模型配置、加密 Key、未知费用预留及旧违规记录保持原样。追加迁移160须搭配对应 API。')
  block='<!-- highest-admin-direct-182 -->\n\n## '+title+'\n\n'+intro+'\n\n'+actual+'\n\n[设计、使用和逻辑图 / Design, usage and diagram]('+guide+')\n\n'
  if branch=='admin':
   shots=r['media'];block+='![直接执行预览 / Direct preview]('+shots[0]['path']+')\n\n![实际审计 / Actual audit]('+shots[2]['path']+')\n\n![实际交互 / Actual interaction](assets/demos/182-highest-admin-direct.gif)\n\n[交互录像 / Interaction recording](assets/demos/182-highest-admin-direct.mp4)\n\n'
  else:block+='![实际交互 / Actual interaction](https://raw.githubusercontent.com/copypasteltd/workmate/docs/docs/assets/highest-admin-direct-182/182-highest-admin-direct.gif)\n\n'
  p.write_text(block+old,encoding='utf-8',newline='\n')
for name in ['README.md','README.en.md']:
 p=ROOT/'docs'/name;old=p.read_text(encoding='utf-8');assert '<!-- highest-admin-direct-182 -->' not in old
 intro='Highest administrators execute directly; other roles follow approval policy; every action retains audit. Production gpt-6-luna publication,18 focused checks and6 actual browser checks are verified.' if name.endswith('.en.md') else '最高管理员直接执行，其他角色按策略审批，完整保留审计。已验证线上 gpt-6-luna 直接发布、18项相关检查和6项实际页面检查。'
 p.write_text('<!-- highest-admin-direct-182 -->\n\n'+intro+'\n\n[需求 / Requirements](requirements/182-highest-admin-direct.md) · [开发及逻辑图 / Implementation](development/182-highest-admin-direct.md) · [变更 / Changes](changes/182-highest-admin-direct.md) · [实际证据 / Evidence](quality/highest-admin-direct-182.json)\n\n'+old,encoding='utf-8',newline='\n')
publisher=(ROOT/'docs/tools/publish-model-tool-contract-181-v1.py').read_text(encoding='utf-8').replace('deployment-181','deployment-182').replace('model-tool-contract-181','highest-admin-direct-182').replace("'stage':181","'stage':182").replace('Repair scoped Codex tool validation and Admin retry (stage181)','Allow highest-admin direct execution with immutable audit (stage182)')
with (ROOT/'docs/tools/publish-highest-admin-direct-182-v1.py').open('x',encoding='utf-8',newline='\n') as f:f.write(publisher)
names={b:[] for b in [*COMP,'docs']}
backend=DEV/'copypaste-platform';admin=DEV/'copypaste-admin'
names['backend']=['README.md','README.en.md','package.json','tsconfig.json','src/admin-execution-policy.ts','src/admin-approval-decision.ts','src/admin-accounts.ts','src/admin-approvals.ts','src/admin-fees.ts','src/admin-memberships.ts','src/admin-operations.ts','src/admin-payments.ts','src/admin-plans.ts','src/admin-refunds.ts','src/admin-vip.ts','src/admin.ts','src/audio-accounting.ts','src/capability-releases.ts','src/provider-admin.ts','src/schema-compatibility.ts','migrations/160-highest-admin-direct-execution.sql',*files(backend,['tests/*182*.test.ts'])]
names['admin']=['README.md','README.en.md','src/accounts.tsx','src/approvals.tsx','src/audio-accounting.tsx','src/capabilities.tsx','src/capability-model.ts','src/fees.tsx','src/main.tsx','src/payments.tsx','src/provider-control.tsx','src/refunds.tsx',*[row['path'] for attempt in attempts for row in attempt.get('media',[])],*files(admin,['assets/demos/182-*'])]
names['delivery']=['README.md','README.en.md',*files(D,['scripts/*182*'])]
names['docs']=['docs/README.md','docs/README.en.md',*files(ROOT,['docs/requirements/182-*','docs/development/182-*','docs/changes/182-*','docs/tools/*highest-admin-direct-182*','docs/assets/highest-admin-direct-182/*','docs/quality/highest-admin-direct-182/*'])]
names={b:sorted(set(paths)) for b,paths in names.items()};sources={}
for b,paths in names.items():
 repo=ROOT if b=='docs' else DEV/('copypaste-'+COMP[b])
 for n in paths:sources[(repo/n).relative_to(ROOT).as_posix()]=digest(repo/n)
clean=lambda a:{k:v for k,v in a.items() if k!='video'}
report={'stage':182,'at':datetime.now(timezone.utc).isoformat(),'status':'deployed_and_qualified','scope':'Highest-administrator direct execution, ordinary policy approval, original pending requests and immutable audit','sources':sources,'media':media,'deployment':server,'production_verification':production,'browser':clean(r),'browser_attempts':[clean(a) for a in attempts],'focused_checks':checks,'total_passing_checks':18,'actual_browser_checks':6,'builds':{'backend':'passed','admin':'passed'},'attempt_logs':logs,'attempt_notes':['Core V1 reached nine passing cases; its audit-failure fixture incorrectly attempted test-only DDL using the restricted control role. V2 uses the isolated owner for that fixture and passes all14 checks.','Financial V1 omitted a local fixture money helper. Its original four failures are preserved; V2 adds that helper and passes all4 checks. The historical V1 source remains available but is excluded from compilation.','The first read-only server inspector used the old DTO document name instead of the database definition column and failed before mutation; V2 corrected the inspector.','Browser V1 authenticated but attempted a credentialed read from a fresh about:blank page and failed CORS before any publication. V2 navigates to the real origin first and passes the complete journey. Public network timeouts and bounded retries are retained.'],'prior_evidence_sha256':digest(ROOT/'docs/quality/model-tool-contract-181.json'),'limitations':['Focused permission and publication acceptance only; no full-product regression rerun','Existing business evidence, current MFA, permissions, scope and monetary restrictions still apply','Existing pending requests require explicit action; expired commands need fresh previews','No new model validation calls or native-client installers were needed; publication reused the original passed gpt-6-luna receipt','Forward-only schema160 requires its matching API; private migration-object/configuration backups are retained','Legacy independent-review assertions for all global super administrators describe the prior requirement and retain their historical scope'],'virtualization_invoked':False,'browser_closed':True}
with (ROOT/'docs/quality/highest-admin-direct-182.json').open('x',encoding='utf-8',newline='\n') as f:json.dump(report,f,ensure_ascii=False,indent=2)
names['docs'].append('docs/quality/highest-admin-direct-182.json')
with (P/'publication-paths.json').open('x',encoding='utf-8',newline='\n') as f:json.dump(names,f,indent=2)
print(json.dumps({'status':'prepared','paths':{k:len(v) for k,v in names.items()},'tests':18,'browser_checks':6,'operation':r['operation']['id']}))
