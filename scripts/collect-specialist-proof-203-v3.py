"""Read original server runtime/skill/tool/source bindings; never accept model claims."""
from pathlib import Path
import hashlib,importlib.util,json
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'.data/acceptance-203/real-specialists-v3'
selected_by_role={};selected_origins={}
for folder in sorted((ROOT/'.data/acceptance-203').glob('real-specialists-v*'),key=lambda p:int(p.name.rsplit('v',1)[1])):
 if (folder/'receipt.json').exists():
  for row in json.loads((folder/'receipt.json').read_text('utf-8'))['items']:
   if row['status']=='passed_controlled_functional_sample':selected_by_role[row['role']]=row;selected_origins[row['role']]=folder/row['role']
selected=list(selected_by_role.values());assert 3<=len(selected)<=12;ids=[x['task_id'] for x in selected];assert len(set(ids))==len(ids)
spec=importlib.util.spec_from_file_location('company_proof_203',ROOT/'scripts/live-company-api-199-v1.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);api=m.CompanyAPI()
script='''import pg from '/opt/workmate/overlays/integrated-202-v2/backend/node_modules/pg/lib/index.js';
const ids=IDS;
const client=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await client.connect();
try{await client.query('BEGIN READ ONLY');
 const tasks=(await client.query("SELECT t.id,t.status,t.kernel,t.role_key,t.role_hash,t.runtime_thread,t.data_mode,t.charged_micros,t.accrued_micros,t.input_context,b.runtime_profile_id,b.capability_version_ids FROM tasks t LEFT JOIN task_runtime_bindings b ON b.task_id=t.id WHERE t.id=ANY($1::uuid[]) ORDER BY t.role_key",[ids])).rows;
 const skills=(await client.query('SELECT task_id,skill_version_id,content_hash FROM task_skill_bindings WHERE task_id=ANY($1::uuid[]) ORDER BY task_id,skill_version_id',[ids])).rows;
 const tools=(await client.query('SELECT task_id,tool_name,input_hash,output_version_ids,attempt FROM task_tool_receipts WHERE task_id=ANY($1::uuid[]) ORDER BY task_id,created_at',[ids])).rows;
 const assets=(await client.query("SELECT a.id,a.name,v.id AS version_id,v.sha256,v.bytes,v.metadata FROM assets a JOIN asset_versions v ON v.asset_id=a.id WHERE v.metadata->>'task_id'=ANY($1::text[]) ORDER BY a.name",[ids])).rows;
 const calls=(await client.query("SELECT task_id,count(*)::int count,count(*) FILTER(WHERE state='completed' AND usage_known)::int completed_known FROM current_ai_provider_requests WHERE task_id=ANY($1::uuid[]) GROUP BY task_id",[ids])).rows;
 const sources=(await client.query('SELECT task_id,kind,resource_id,asset_version_id,sha256 FROM task_source_reads WHERE task_id=ANY($1::uuid[])',[ids])).rows;
 console.log(JSON.stringify({stage:203,status:'read_original_server_proof',tasks,skills,tools,assets,calls,sources,model_output_is_not_execution_proof:true}));await client.query('ROLLBACK');
}finally{await client.end();}'''.replace('IDS',json.dumps(ids))
try:
 p=ROOT/'.data/deployment-189/server-access.private.json';access=json.loads(p.read_text('utf-8'));channel=api.t.open_session(timeout=15)
 channel.exec_command('sudo -S -p "" /opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module -')
 channel.sendall(access['password'].encode()+b'\n'+script.encode());channel.shutdown_write();raw=channel.makefile('rb').read();errors=channel.makefile_stderr('rb').read();status=channel.recv_exit_status()
 assert status==0,'Read-only proof collection failed: '+errors.decode(errors='replace')[:300]
 data=json.loads(raw);assert len(data['tasks'])==len(ids)
 for task in data['tasks']:
  assert task['kernel']=='codex' and task['runtime_thread'] and task['runtime_profile_id'] and task['capability_version_ids']
  assert any(s['task_id']==task['id'] and len(s['content_hash'])==64 for s in data['skills'])
  assert any(c['task_id']==task['id'] and c['count']>0 for c in data['calls'])
 native_checks=[]
 for row in selected:
  expected={'fullstack':'browser_preview','frontend':'browser_preview','backend-api':'api_test','software-qa':'node_test','ui-ux':'browser_preview','landing-page':'browser_preview'}.get(row['role'])
  if not expected:continue
  checks=[]
  for asset in row['files']:
   if not asset['name'].endswith('.json'):continue
   p=selected_origins[row['role']]/(asset['version_id']+'.artifact');content=p.read_bytes();assert hashlib.sha256(content).hexdigest()==asset['sha256']
   receipt=json.loads(content)
   if isinstance(receipt,dict) and receipt.get('program')==expected and receipt.get('passed') is True:
    assert receipt['host']['job_empty'] and receipt['workspace_deleted']
    checks.append({'execution_id':receipt['execution_id'],'program':expected,'passed':True,'source_digest':receipt['source_digest'],'receipt_sha256':asset['sha256'],'check_input':receipt.get('check_input'),'job_empty':True,'workspace_deleted':True})
  assert checks,row['role']
  if row['role']=='ui-ux':
   assert len(checks)>=2 and len({c['source_digest'] for c in checks})==1
   assert any(any(a.get('value')=='not-an-email' for a in c['check_input']['actions']) and any(a.get('expect')=={'visible':False} for a in c['check_input']['checks']) for c in checks)
   assert any(any(a.get('value')=='hello@example.com' for a in c['check_input']['actions']) and any('hello@example.com' in str(a['expect']) for a in c['check_input']['checks']) for c in checks)
  native_checks.append({'role':row['role'],'task_id':row['task_id'],'checks':checks})
 data['qualified_native_checks']=native_checks
 target=OUT/'server-proof.private.json';assert not target.exists();target.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n','utf-8')
 print(json.dumps({'status':data['status'],'tasks':len(data['tasks']),'skills':len(data['skills']),'transactional_tool_receipts':len(data['tools']),'proof_sha256':hashlib.sha256(target.read_bytes()).hexdigest()}))
finally:api.close()
