"""Append audited QA cleanup and construct an explicit publication allowlist."""
from pathlib import Path
from hashlib import sha256
import json,subprocess

ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';D=DEV/'copypaste-delivery';P=D/'.data/acceptance-191'
Q=ROOT/'docs/quality/native-repair-191';target=ROOT/'docs/quality/191-selected-repairs.json'
def load(p):return json.loads(p.read_bytes())
def digest(p):return sha256(p.read_bytes()).hexdigest()
def save(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
report=load(target);assert report['status']=='selected_targets_verified' and report['excluded_items']==[12]
assert 'owned_failed_qa_cleanup_count' not in report
source=P/'owned-qa-cleanup-761cd134-3d33-491b-843c-c1a43b281936/receipt.json';cleanup=load(source)
assert cleanup['status']=='passed' and len(cleanup['operations'])==1
operations=[]
for row in cleanup['operations']:
 after=row['after'];assert after['capacity_held'] is False and after['cost']['state']=='unknown' and after['cost']['amount_micros'] is None
 operations.append({'request_id':row['request_id'],'evidence_id':row['evidence_id'],'release_operation':row['release_operation'],'capacity_held':False,'cost':after['cost']})
public={k:cleanup[k] for k in ['stage','status','scope','proof_sha256','checks','owned_browser_closed','finished_at']}|{'operations':operations}
for name,original,value in [('owned-qa-cleanup.json',source,public),('final-state-v4.json',P/'server-evidence/final-state-v4.json',None)]:
 dest=Q/name
 if value is None:dest.write_bytes(original.read_bytes())
 else:save(dest,value)
 report['evidence'].append({'path':dest.relative_to(ROOT).as_posix(),'sha256':digest(dest),'original_receipt_sha256':digest(original)})
state=load(Q/'final-state-v4.json')
assert state['held']==[] and state['owned_native_jobs_remaining']==[] and state['owned_execution_group_has_no_processes']
assert all(not t['occupies_execution_slot'] for t in state['active'])
assert all(not r['capacity_held'] and r['cost_state']=='unknown' for r in state['requests'])
report['owned_failed_qa_cleanup_count']=1
report['final_owned_workspaces']={'reconciling_native_tasks':len(state['active']),'held_provider_requests':0,'occupied_execution_slots':0,'native_jobs_remaining':0,'unresolved_finances_preserved':True}
note='\n最终补充：本轮失败QA另1条请求也经后台终止证据和审计释放容量。最后只读复核两个自有QA企业：8条待对账本机任务均不占执行名额，仍持有供应商容量的请求为0，本机任务组无残留进程；4条已释放请求费用均仍unknown，原财务预留保留。\n\nFinal observation: one additional failed QA request had capacity released through the same audited evidence workflow. Both owned QA workspaces have zero held provider requests and zero occupied execution slots; eight native tasks retain reconciliation state, unknown fees and original reservations. No native task process remains.\n'
for p in [ROOT/'docs/development/191-native-execution-and-capacity.md',ROOT/'docs/changes/191-selected-repairs.md']:
 with p.open('a',encoding='utf8',newline='\n') as f:f.write(note)
names={};mapping={'backend':'platform','web':'web','admin':'admin','desktop':'desktop','extension':'extension','delivery':'delivery'}
for branch,component in mapping.items():
 repo=DEV/('copypaste-'+component)
 tracked=subprocess.check_output(['git','-C',str(repo),'diff','--name-only','-z']).decode().split('\0')
 chosen={n for n in tracked if n}
 chosen|={p.relative_to(repo).as_posix() for p in (repo/'assets').rglob('191-*') if p.is_file()}
 if branch=='backend':chosen|={'contracts/cloud-browser-runtime.linux.json','contracts/cloud-program-runtime.linux.json','migrations/162-terminated-desktop-execution-capacity.sql','scripts/launch-linux-native-service.py','scripts/setup-cloud-linux.mjs','src/cloud-linux-boundary.ts','src/cloud-linux-host.py','tests/desktop-executions-139-v3.test.ts'}
 if branch=='delivery':chosen|={p.relative_to(repo).as_posix() for p in (repo/'scripts').glob('*191*') if p.is_file() and not p.name.startswith('profile-owned-api-191-')}
 assert all((repo/n).is_file() for n in chosen)
 names[branch]=sorted(chosen)
 for n in chosen:
  if not n.startswith('assets/'):report['sources'][(repo/n).relative_to(ROOT).as_posix()]=digest(repo/n)
docfiles=['docs/README.md','docs/README.en.md','docs/requirements/191-selected-repairs.md','docs/development/191-native-execution-and-capacity.md','docs/changes/191-selected-repairs.md','docs/quality/191-selected-repairs.md','docs/quality/191-selected-repairs.json','docs/quality/191-desktop-artifacts.json','docs/tools/prepare-native-repair-media-191.py','docs/tools/record-selected-repairs-191.py','docs/tools/finalize-selected-repairs-191.py','docs/tools/publish-selected-repairs-191.py']
for folder in [Q,ROOT/'docs/assets/native-repair-191']:docfiles += [p.relative_to(ROOT).as_posix() for p in folder.rglob('*') if p.is_file()]
names['docs']=sorted(set(docfiles))
save(target,report);save(P/'publication-paths.json',names)
print(json.dumps({'status':'ready_for_ordinary_publication','files':{k:len(v) for k,v in names.items()},'selected_items':report['selected_items'],'excluded_items':report['excluded_items']}))
