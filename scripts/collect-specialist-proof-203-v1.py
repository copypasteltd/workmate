"""Read original server runtime/skill/tool/source bindings; never accept model claims."""
from pathlib import Path
import hashlib,importlib.util,json
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'.data/acceptance-203/real-specialists-v1'
report=json.loads((OUT/'receipt.json').read_text('utf-8'));ids=[x['task_id'] for x in report['items'] if x.get('task_id')];assert len(ids)==12
spec=importlib.util.spec_from_file_location('company_proof_203',ROOT/'scripts/live-company-api-199-v1.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);api=m.CompanyAPI()
script='''import pg from '/opt/workmate/overlays/integrated-202-v2/backend/node_modules/pg/lib/index.js';
const ids=IDS;
const client=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await client.connect();
try{await client.query('BEGIN READ ONLY');
 const tasks=(await client.query("SELECT t.id,t.status,t.kernel,t.role_key,t.role_hash,t.runtime_thread,t.data_mode,t.charged_micros,t.cost_state,t.input_context,b.runtime_profile_id,b.capability_version_ids FROM tasks t LEFT JOIN task_runtime_bindings b ON b.task_id=t.id WHERE t.id=ANY($1::uuid[]) ORDER BY t.role_key",[ids])).rows;
 const skills=(await client.query('SELECT task_id,skill_version_id,content_hash FROM task_skill_bindings WHERE task_id=ANY($1::uuid[]) ORDER BY task_id,skill_version_id',[ids])).rows;
 const tools=(await client.query('SELECT task_id,tool_name,input_hash,output_version_ids,attempt FROM task_tool_receipts WHERE task_id=ANY($1::uuid[]) ORDER BY task_id,created_at',[ids])).rows;
 const assets=(await client.query("SELECT a.id,a.name,v.id AS version_id,v.sha256,v.bytes,v.metadata FROM assets a JOIN asset_versions v ON v.asset_id=a.id WHERE v.metadata->>'task_id'=ANY($1::text[]) ORDER BY a.name",[ids])).rows;
 const calls=(await client.query('SELECT task_id,count(*)::int count FROM current_ai_provider_requests WHERE task_id=ANY($1::uuid[]) GROUP BY task_id',[ids])).rows;
 console.log(JSON.stringify({stage:203,status:'read_original_server_proof',tasks,skills,tools,assets,calls,model_output_is_not_execution_proof:true}));await client.query('ROLLBACK');
}finally{await client.end();}'''.replace('IDS',json.dumps(ids))
try:
 p=ROOT/'.data/deployment-189/server-access.private.json';access=json.loads(p.read_text('utf-8'));channel=api.t.open_session(timeout=15)
 channel.exec_command('sudo -S -p "" /opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node --env-file=/root/cfg/workmate/app.env --input-type=module -')
 channel.sendall(access['password'].encode()+b'\n'+script.encode());channel.shutdown_write();raw=channel.makefile('rb').read();errors=channel.makefile_stderr('rb').read();status=channel.recv_exit_status()
 assert status==0,'Read-only proof collection failed: '+errors.decode(errors='replace')[:300]
 data=json.loads(raw);assert len(data['tasks'])==12
 for task in data['tasks']:
  assert task['kernel']=='codex' and task['runtime_thread'] and task['runtime_profile_id'] and task['capability_version_ids']
  assert any(s['task_id']==task['id'] and len(s['content_hash'])==64 for s in data['skills'])
  assert any(c['task_id']==task['id'] and c['count']>0 for c in data['calls'])
 target=OUT/'server-proof.private.json';assert not target.exists();target.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n','utf-8')
 print(json.dumps({'status':data['status'],'tasks':len(data['tasks']),'skills':len(data['skills']),'transactional_tool_receipts':len(data['tools']),'proof_sha256':hashlib.sha256(target.read_bytes()).hexdigest()}))
finally:api.close()
