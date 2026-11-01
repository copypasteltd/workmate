"""Bind stage181 to actual source, native checks, deployment, billing and UI evidence."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json, re, shutil

ROOT=Path(__file__).resolve().parents[2]; DEV=ROOT/'dev'; D=DEV/'copypaste-delivery'; P=D/'.data/deployment-181'
COMP={'backend':'platform','web':'web','admin':'admin','desktop':'desktop','extension':'extension','delivery':'delivery'}
digest=lambda p:sha256(p.read_bytes()).hexdigest()
attempts=[json.loads(p.read_bytes()) for p in sorted(P.glob('browser-*/receipt.json'))]
passed=[r for r in attempts if r['status']=='passed']; assert len(passed)==1
r=passed[0]; v=r['validation']; assert r['browser_closed'] and v['state']=='passed' and v['result']['usage_known']
assert set(['pinned_codex','requested_model_and_effort','tool_call_and_result','completed_output','known_usage'])<=set(v['result']['checks'])
assert r['prior_validation']['state']=='reconciling'
accounting=json.loads((P/'model-accounting.json').read_bytes());assert accounting['status']=='real_model_accounting_verified' and accounting['validation']['id']==v['id'] and accounting['current_validation_violations']==0
media=json.loads((P/'media.sanitized.json').read_bytes())['files']
for row in media:assert digest(ROOT/row['path'])==row['sha256']
server=json.loads((P/'server-runtime-v3.json').read_bytes()); headroom=json.loads((P/'validation-headroom.json').read_bytes())
assert server['status']=='deployed' and server['overlay'].endswith('model-tool-contract-181-v3')
assert headroom['historical_holds_unchanged'] and headroom['budget_policy_unchanged'] and not headroom['admin_policy_overridden']
assert headroom['after']=={'actor_slots':4,'verification_slots':4}

proof=ROOT/'docs/quality/model-tool-contract-181'; proof.mkdir(exist_ok=False)
checks=[]
for name,total in [('focused-final-v3.log',33),('budget-test-output-v5.log',7),('admin-validation-final-v2.log',2)]:
 p=P/name; text=p.read_text(encoding='utf-8'); count={k:int(re.findall(r'^# '+k+r' (\d+)$',text,re.M)[-1]) for k in ['tests','pass','fail']}
 assert count=={'tests':total,'pass':total,'fail':0},(name,count)
 dest=proof/name;shutil.copyfile(p,dest);checks.append({'path':dest.relative_to(ROOT).as_posix(),'sha256':digest(dest),**count})
# V4 retained one invalid new fixture (missing requested effort). Select only
# its independently passing 25 original accounting cases and 3 HTTP cases.
# The corrected 5 native cases and 2 schema cases run green in V5 above.
legacy=P/'budget-test-output-v4.log';legacy_text=legacy.read_text(encoding='utf-8')
assert re.findall(r'^# tests (\d+)$',legacy_text,re.M)[-1]=='35'
assert re.findall(r'^# fail (\d+)$',legacy_text,re.M)[-1]=='1'
assert re.findall(r'^not ok (\d+) - (.+)$',legacy_text,re.M)==[('4','native tool context is pre-funded from serialized bytes while retaining the actual count proof and measured charge')]
selected={1,2,3,*range(9,34)}
cases=[{'id':int(n),'name':name,'status':'passed'} for n,name in re.findall(r'^ok (\d+) - (.+)$',legacy_text,re.M) if int(n) in selected]
assert {c['id'] for c in cases}==selected
shutil.copyfile(legacy,proof/legacy.name)
checks.append({'path':(proof/legacy.name).relative_to(ROOT).as_posix(),'sha256':digest(legacy),'tests':28,'pass':28,'fail':0,'scope':'Selected original accounting and HTTP cases only; original failed new fixture is retained, corrected and rerun in V5','whole_attempt_failures':1,'selected_cases':cases})
for name in ['backend-build-v4.log','admin-build-v3.log']:
 text=(P/name).read_text(encoding='utf-8');assert 'error TS' not in text and 'ERR!' not in text
 shutil.copyfile(P/name,proof/name)
assert 'built in' in (P/'admin-build-v3.log').read_text(encoding='utf-8')
logs=[]
for p in sorted(P.glob('*.log')):
 if p.name in [x.name for x in proof.iterdir()]:continue
 dest=proof/p.name;shutil.copyfile(p,dest);logs.append({'path':dest.relative_to(ROOT).as_posix(),'sha256':digest(dest)})

guide='https://github.com/copypasteltd/workmate/blob/docs/docs/development/181-model-tool-contract.md'
for branch in ['backend','admin','delivery']:
 repo=DEV/('copypaste-'+COMP[branch])
 for name in ['README.md','README.en.md']:
  p=repo/name;old=p.read_text(encoding='utf-8');assert '<!-- model-tool-contract-181 -->' not in old
  en=name.endswith('.en.md')
  title='Complete Codex model validation · stage181' if en else 'Codex 完整模型验证修复 · 阶段181'
  intro=('The current saved **gpt-6-luna** passed real production Admin validation: pinned Codex, requested model/effort, a registered tool/result round trip, completed text and known usage. Per-model API URLs/keys are retained. Both flat function tools and native code-mode additional_tools are supported, with business permissions enforced.' if en else '当前保存的 **gpt-6-luna** 已在正式后台通过完整验证：固定 Codex、指定模型与推理强度、注册工具调用及结果返回、最终文字回复、用量记录均完成。保留每模型接口和 Key，兼容普通 function 与原生 code mode 工具格式，并继续执行原业务权限检查。')
  outcome=(f'Receipt `{v["id"]}`; input/output tokens `{v["result"]["input_tokens"]}/{v["result"]["output_tokens"]}`. Earlier uncertain requests remain intact. The unpublished bootstrap policy moves actor/verification ceilings from2 to4 to retain two old holds and restore two available slots; all budget amounts and other limits stay intact. Native code-mode context is pre-funded from complete serialized bytes, then settled using measured tokens; exceeding input, output or monetary bounds still fails.' if en else f'实际回执 `{v["id"]}`；输入／输出 tokens 为 `{v["result"]["input_tokens"]}/{v["result"]["output_tokens"]}`。旧待对账记录保留。未自定义发布的初始策略中，管理员／验证总名额由2调整为4，保留旧占位2个并恢复可用名额2个；费用上限及其他限制不变。原生工具上下文按完整请求字节预留输入额度，再按实际 tokens 结算；输入、输出或费用超额仍会拦截。')
  detail=('Run `npm run build`. Focused checks use `scripts/run-tests-owned.mjs` with the current181 test versions and `tests/internal-ai-gateway.test.ts`. Failed historical attempts remain available and excluded from current automatic selection.' if branch=='backend' else 'Open Model capabilities → Configuration & validation → Test connection → Run validation. Text retries create separately budgeted receipts. The panel explains specific tool/protocol/capacity failures.' if branch=='admin' else 'Package V3/install V4 with the181 scripts; qualify using `qualify-model-tool-contract-181-v4.mjs` with `PLAYWRIGHT_BROWSERS_PATH=.data/browsers`. The bounded bootstrap recovery refuses to replace a published Admin policy. Forward migration159 pre-funds native context from complete request bytes; historical exact-count allocations and frozen installers remain intact.')
  shot=r['media'][-1]['path'] if branch=='admin' else 'https://raw.githubusercontent.com/copypasteltd/workmate/admin/'+r['media'][-1]['path']
  gif='assets/demos/181-model-tool-contract.gif' if branch=='admin' else 'https://raw.githubusercontent.com/copypasteltd/workmate/admin/assets/demos/181-model-tool-contract.gif'
  block=f'<!-- model-tool-contract-181 -->\n## {title}\n\n{intro}\n\n{outcome}\n\n{detail}\n\n[Implementation, workflow and evidence / 方案、逻辑图与回执]({guide})\n\n![Actual full Codex validation]({shot})\n\n![Actual Admin interaction recording]({gif})\n\nEarlier records follow. 以下为历史记录。\n\n---\n\n'
  first,_,rest=old.partition('\n');p.write_text(first+'\n\n'+block+rest.lstrip('\n'),encoding='utf-8',newline='\n')
for name in ['README.md','README.en.md']:
 p=ROOT/'docs'/name;old=p.read_text(encoding='utf-8');assert '<!-- model-tool-contract-181 -->' not in old
 block='''<!-- model-tool-contract-181 -->
## Codex 完整模型验证 / Complete Codex model validation

修复原生工具协议兼容、错误归因、原生上下文预算和后台文字重试；保留旧待对账记录，恢复初始策略中的可用验证名额。当前 gpt-6-luna 已在正式后台通过完整 Codex 验证，附实际截图和交互录制。本轮70项针对性检查通过。

The current gpt-6-luna passed real production Codex validation after repairing the native tool contract, specific errors, text retry, bounded bootstrap headroom and native input budgeting. Historical uncertain records remain intact. Actual captures and70 passing focused checks are recorded.

[需求 / Requirements](requirements/181-model-tool-contract.md) · [开发及逻辑图 / Implementation](development/181-model-tool-contract.md) · [变更 / Changes](changes/181-model-tool-contract.md) · [实际证据 / Evidence](quality/model-tool-contract-181.json)

'''
 p.write_text(block+old,encoding='utf-8',newline='\n')
publisher=(ROOT/'docs/tools/publish-model-http-180-v1.py').read_text(encoding='utf-8').replace('deployment-180','deployment-181').replace('model-http-180','model-tool-contract-181').replace("'stage':180","'stage':181").replace('Allow model upstream HTTP and HTTPS (stage180)','Repair scoped Codex tool validation and Admin retry (stage181)')
with (ROOT/'docs/tools/publish-model-tool-contract-181-v1.py').open('x',encoding='utf-8',newline='\n') as f:f.write(publisher)

def files(repo,patterns):return sorted({p.relative_to(repo).as_posix() for pattern in patterns for p in repo.glob(pattern) if p.is_file()})
names={b:[] for b in [*COMP,'docs']}
names['backend']=['.gitattributes','README.md','README.en.md','src/cloud-tool-contract.ts','src/internal-ai-gateway.ts','src/runtime.ts','src/capability-verification.ts','src/server.ts','src/provider-budgets.ts','src/provider-request-control.ts','src/capability-releases.ts','src/schema-compatibility.ts','migrations/159-native-context-input-ceiling.sql','tsconfig.json',*files(DEV/'copypaste-platform',['tests/*181*.test.ts'])]
adminmedia={row['path'] for a in attempts for row in a.get('media',[])}
names['admin']=['README.md','README.en.md','src/capabilities.tsx','src/capability-validation-ui.ts','tests/capability-validation-ui-181-v1.test.ts',*adminmedia,*files(DEV/'copypaste-admin',['assets/demos/181-*'])]
names['delivery']=['.gitattributes','README.md','README.en.md',*files(D,['scripts/*181*'])]
names['docs']=['.gitattributes','docs/README.md','docs/README.en.md',*files(ROOT,['docs/requirements/181-*','docs/development/181-*','docs/changes/181-*','docs/tools/*model-tool-contract-181*','docs/assets/model-tool-contract-181/*','docs/quality/model-tool-contract-181/*'])]
names={b:sorted(set(paths)) for b,paths in names.items()}
sources={}
for b,paths in names.items():
 repo=ROOT if b=='docs' else DEV/('copypaste-'+COMP[b])
 for n in paths:sources[(repo/n).relative_to(ROOT).as_posix()]=digest(repo/n)
clean=lambda a:{k:value for k,value in a.items() if k!='video'}
report={'stage':181,'at':datetime.now(timezone.utc).isoformat(),'status':'deployed_and_qualified','scope':'Actual full gpt-6-luna Codex tool/result verification, safe failure attribution, Admin text retry and bounded bootstrap headroom and pre-funded native input ceilings','sources':sources,'media':media,'deployment':server,'previous_deployment':json.loads((P/'server-runtime.json').read_bytes()),'headroom':headroom,'real_model_accounting':accounting,'browser':clean(r),'browser_attempts':[clean(a) for a in attempts],'focused_checks':checks,'total_passing_checks':sum(x['pass'] for x in checks),'builds':{'backend':'passed','admin':'passed'},'attempt_logs':logs,'attempt_notes':['V1 test module had an incorrect cleanup import; retained and superseded. First migration159 attempt failed before commit due to an unparenthesized SQL CASE expression; a later run exposed a missing schema-version advance. Both unsuccessful logs are retained, and neither touched production. A new native fixture initially omitted the explicit reasoning effort; its original failure is retained and the corrected V2 fixture passes in V5. The V4 deployment script fixes the Windows shell line ending before any database change.','V2-V4 fixtures corrected metric shape, reset timing, native model-specific tool selection and missing Responses total_tokens; all original attempts retained.','First browser attempt lacked the configured recorder dependency path. A later V1 assertion expected200 instead of this route\'s202 response; server inspection also identified two original capacity holds. Neither attempt is reported as successful.','V3 production qualification preserved a real INPUT_COUNT_MISMATCH: upstream estimated5218 input tokens but measured10032. Forward migration159 adds an independently pre-funded serialized input ceiling for validated native code mode; exact legacy allocations and historical violations remain unchanged. V4 production qualification uses the real saved model after this repair.'],'prior_evidence_sha256':digest(ROOT/'docs/quality/model-http-180.json'),'limitations':['This focused repair and full model verification do not establish complete-product acceptance','Earlier unknown spending and capacity holds remain pending their original evidence/reconciliation process','Forward-only schema159 requires its matching API; private migration-object backup is retained and no automatic database downgrade is attempted','No automatic model publication or new native installers','The bootstrap headroom change affects only the unpublished simulated-mode deployment policy; all other limits and budget amounts are retained'],'virtualization_invoked':False}
with (ROOT/'docs/quality/model-tool-contract-181.json').open('x',encoding='utf-8',newline='\n') as f:json.dump(report,f,ensure_ascii=False,indent=2)
names['docs'].append('docs/quality/model-tool-contract-181.json')
with (P/'publication-paths.json').open('x',encoding='utf-8',newline='\n') as f:json.dump(names,f,indent=2)
print(json.dumps({'status':'prepared','paths':{k:len(v) for k,v in names.items()},'tests':report['total_passing_checks'],'validation':v['id']}))
