"""Keep per-fixture native pins without overriding the cloud catalog profile."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib,json

R=Path(__file__).resolve().parents[2];P=R/'dev/copypaste-platform';L=R/'dev/copypaste-delivery';Q=R/'docs/quality/integrated-round-204'
def fresh(p,text):
    with p.open('x',encoding='utf-8',newline='\n') as f:f.write(text)
def edit(p,before,after):
    text=p.read_text('utf-8');assert before in text,p
    p.write_text(text.replace(before,after),encoding='utf-8',newline='\n')
previous=json.loads((L/'.data/integrated-204-v9/verification.json').read_text('utf-8'))
assert previous['qualified_backend_case_count']==183 and previous['backend_failed_cases']==21
original=P/'tests/audio-accounting-188-v1.test.ts'
test=original.read_text('utf-8')
anchor='  assert.ok(process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN);'
assert test.count(anchor)==1
test=test.replace(anchor,anchor+'\n  assert.ok(process.env.COPYPASTE_RUNTIME_STARTUP_TEST_VERSION);')
anchor='CODEX_BIN:process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN!,'
assert test.count(anchor)==1
test=test.replace(anchor,anchor+'CODEX_VERSION:process.env.COPYPASTE_RUNTIME_STARTUP_TEST_VERSION!,')
fresh(P/'tests/audio-accounting-188-v2.test.ts',test)
verify=(L/'scripts/verify-integrated-round-204-v9.mjs').read_text('utf-8')
verify=verify.replace('integrated-204-v9','integrated-204-v10').replace('backend_groups:2','backend_groups:3').replace('two independent isolated-database groups','three independent isolated-database groups')
verify=verify.replace('CODEX_VERSION:pin.runtime_version,','').replace("'audio-accounting-188-v1'","'audio-accounting-188-v2'")
verify=verify.replace("async function run(phase,args){","delete env.CODEX_VERSION; // Each fixture explicitly selects its profile; .env/default cloud profile remains independent.\nasync function run(phase,args){")
before="await Promise.all([run('test-a',['--env-file=.env','scripts/run-tests-owned.mjs',...files.filter((_,i)=>i%2===0)]),run('test-b',['--env-file=.env','scripts/run-tests-owned.mjs',...files.filter((_,i)=>i%2===1)])]);"
assert before in verify
verify=verify.replace(before,"report.test_file_sha256=await Promise.all(files.map(async file=>({path:file,sha256:sha(await readFile(path.resolve('../copypaste-platform',file)))})));\n await Promise.all(['a','b','c'].map((name,group)=>run('test-'+name,['--env-file=.env','scripts/run-tests-owned.mjs',...files.filter((_,i)=>i%3===group)]))); ")
verify=verify.replace('report.checks.length===3','report.checks.length===4').replace('tests.length===2','tests.length===3')
verify=verify.replace('Exact Windows native CODEX_VERSION/bin/hash are explicit.','The Windows audio accounting fixture explicitly binds its native CODEX_VERSION; other fixtures retain their own cloud/native profiles. Native binary/hash remain explicit.')
fresh(L/'scripts/verify-integrated-round-204-v10.mjs',verify)
for p in [L/'scripts/deploy-integrated-204-v1.py',L/'scripts/finalize-release-metadata-204-v1.mjs',R/'docs/tools/document-integrated-round-204-v1.py']:
    edit(p,'integrated-204-v9','integrated-204-v10')
edit(R/'docs/tools/document-integrated-round-204-v1.py','two independent isolated-database groups','three independent isolated-database groups')
edit(R/'docs/tools/finalize-integrated-round-204-v1.py',"verification['backend_groups']==2","verification['backend_groups']==3")
edit(R/'docs/tools/publish-integrated-round-204-v1.py',"'tests/audio-authorization-upgrade-189-v2.test.ts'","'tests/audio-authorization-upgrade-189-v2.test.ts','tests/audio-accounting-188-v2.test.ts'")
fresh(Q/'collected-profile-isolation-v1.json',json.dumps({'stage':204,'at':datetime.now(timezone.utc).isoformat(),'original_whole_verification':'.data/integrated-204-v9/verification.json','tests':204,'passed':183,'failed':21,'observed_failures':{'analysis_role_catalog_version':12,'cloud_workflow_catalog_version':8,'paid_worker_fixture_runtime_profile':1},'correction':'Remove global Windows CODEX_VERSION override from the whole suite. Clone original audio accounting assertions unchanged, adding its explicit native fixture version only at its loadConfig boundary. Keep cloud/default and other fixture profiles intact.','original_audio_test_sha256':hashlib.sha256(original.read_bytes()).hexdigest(),'production_source_changed':False,'production_version_guard_changed':False,'final_source_snapshot':'implementation-batch-v6.json','backend_groups':3,'server_network_changes':False},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':'complete_environment_correction_batch_prepared','production_source_changed':False,'backend_cases':204,'groups':3}))
