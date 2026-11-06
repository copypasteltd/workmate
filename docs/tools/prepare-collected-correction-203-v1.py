from pathlib import Path
from datetime import datetime,timezone
import hashlib,json
R=Path(__file__).resolve().parents[2];D=R/'dev';L=D/'copypaste-delivery';S=L/'scripts'
def put(p,s):assert not p.exists(),p;p.write_text(s,encoding='utf-8',newline='\n')
# Preserve the existing parallel test run; serialize native process test files
# without widening customer deadlines or removing any current case.
p=D/'copypaste-desktop/scripts/run-current-tests-v1.mjs';s=p.read_text('utf-8').replace('"--test",...process.argv.slice(2)','"--test","--test-concurrency=1",...process.argv.slice(2)')
assert '--test-concurrency=1' in s;put(p.with_name('run-current-tests-203-v1.mjs'),s)
p=D/'copypaste-desktop/package.json';b=json.loads(p.read_text('utf-8'));b['scripts']['test']='node scripts/run-current-tests-203-v1.mjs';p.write_text(json.dumps(b,indent=2)+'\n',encoding='utf-8',newline='\n')
# Correct the QA selection: a version picker appears only after choosing a file.
p=S/'qualify-specialist-intake-203-v1.mjs';s=p.read_text('utf-8').replace("await intake.locator('.composer-library select').waitFor();","await intake.locator('.composer-library').getByRole('button').filter({hasText:'controlled-intake-203.txt'}).click();await intake.locator('.composer-library select').waitFor();")
s=s.replace('203-v1','203-v2');put(S/'qualify-specialist-intake-203-v2.mjs',s)
# Complete the full sequential role correction before any trial replay. Every
# rejected request retains its original body/key. Only the terminal fullstack
# task gets a fresh, explicitly linked correction attempt, never an unknown retry.
p=S/'qualify-specialist-roles-203-v1.py';s=p.read_text('utf-8').replace('real-specialists-v1\';OUT.mkdir','real-specialists-v2\';OUT.mkdir')
a=s.index("  key=str(uuid.uuid4());save(folder/'original-request.private.json'");b=s.index(";report['idempotency_key']=key",a)
s=s[:a]+'''  original=json.loads((ROOT/'.data/acceptance-203/real-specialists-v1'/case['role']/'original-request.private.json').read_text('utf-8'))
  assert original['body']==body
  prior=next(r for r in prior_report['items'] if r['role']==case['role'])
  if prior.get('task_id'):
   assert prior['task']['status']=='succeeded' and case['role']=='fullstack'
   body={**body,'parent_id':prior['task_id']};key=str(uuid.uuid4());report['known_terminal_correction_of']=prior['task_id']
  else:
   assert 'PLAN_TASK_LIMIT' in prior['error'];key=original['key'];report['definite_not_admitted_retry']=True
  save(folder/'original-request.private.json',{'endpoint':BASE+'/tasks','key':key,'body':body})'''+s[b:]
a=s.index(" brief=upload(api,");b=s.index(" cases=role_cases(brief,csv);",a)
s=s[:a]+''' prior_report=json.loads((ROOT/'.data/acceptance-203/real-specialists-v1/receipt.json').read_text('utf-8'));assert prior_report['status']=='failures_for_integrated_debugging'
 brief=json.loads((ROOT/'.data/acceptance-203/real-specialists-v1/203-controlled-design-brief.txt.source.json').read_text('utf-8'))
 csv=json.loads((ROOT/'.data/acceptance-203/real-specialists-v1/203-controlled-performance.csv.source.json').read_text('utf-8'))
'''+s[b:]
s=s.replace('ThreadPoolExecutor(max_workers=2)','ThreadPoolExecutor(max_workers=1)');put(S/'qualify-specialist-roles-203-v2.py',s)
p=S/'collect-specialist-proof-203-v1.py';s=p.read_text('utf-8').replace('real-specialists-v1','real-specialists-v2');put(S/'collect-specialist-proof-203-v2.py',s)
# Rerun all318 current Desktop cases with bounded serial native children. Keep
# the complete68 Web and16 Delivery passes and their original exact log hashes.
put(S/'verify-integrated-round-203-v2.mjs',"""import {spawn} from 'node:child_process';import {readFile,writeFile,mkdir} from 'node:fs/promises';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const out='.data/integrated-203-v2';await mkdir(out,{recursive:true});const old=JSON.parse(await readFile('.data/integrated-203-v1/verification.json','utf8'));for(const c of old.checks)assert.equal(createHash('sha256').update(await readFile(c.log)).digest('hex'),c.sha256);
let log='';const p=spawn(process.execPath,['scripts/run-current-tests-203-v1.mjs'],{cwd:'../copypaste-desktop',env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});for(const s of[p.stdout,p.stderr])s.on('data',b=>log+=b);const code=await new Promise(r=>{p.once('error',()=>r(1));p.once('close',c=>r(c??1));});await writeFile(out+'/desktop-test.log',log,{flag:'wx'});const report={stage:203,status:code===0?'passed':'failures_for_integrated_debugging',state:code===0?'passed':'failures_for_integrated_debugging',scope:'Retain original five successful build/type/Web68/Delivery16 phases by log SHA. Rerun all318 Desktop cases serially after parallel-load native argv timeout; no test removed or customer timeout widened. Original317/318 run remains failed.',retained_checks:old.checks.filter(c=>!(c.component==='desktop'&&c.phase==='test')),checks:[{component:'desktop',phase:'test',exit_code:code,log:out+'/desktop-test.log',sha256:createHash('sha256').update(log).digest('hex')}]};await writeFile(out+'/verification.json',JSON.stringify(report,null,2)+'\\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,receipt:out+'/verification.json'}));if(code)process.exitCode=1;
""")
report={'stage':203,'at':datetime.now(timezone.utc).isoformat(),'status':'collected_correction_complete_before_replay','retained_failures':['integrated-203-v1/desktop-test.log','qualify-specialist-intake-203-v1','real-specialists-v1'],'corrections':['Serialize all current native test files without changing customer deadlines','Choose source before checking its optional version field','Sequential real role tasks within the existing plan; retain exact rejected requests/keys and link the known terminal correction','Materialize exact owned native runtime files; preserve original links and sandbox/network policies'],'production_source_changed':False,'server_network_changes_authorized':False}
p=R/'docs/quality/integrated-round-203/correction-batch-v1.json';put(p,json.dumps(report,ensure_ascii=False,indent=2)+'\n');print('Prepared the complete collected correction before replay.')
