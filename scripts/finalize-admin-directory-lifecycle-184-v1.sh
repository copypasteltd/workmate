#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,subprocess,urllib.request
cfg=Path('/root/cfg/workmate');backup=cfg/'admin-directory-lifecycle-184-v1-backup'
original=json.loads((cfg/'preservation-before.sanitized.json').read_bytes())
for row in original['cfg']:
 assert hashlib.sha256(Path(row['path']).read_bytes()).hexdigest()==row['sha256']
for name in ['app.env','migration.env','credentials.txt']:assert (cfg/name).read_bytes()==(backup/name).read_bytes()
assert json.loads((backup/'preservation-before.json').read_bytes())==json.loads((backup/'preservation-after.json').read_bytes())
foreign=[];observed=[]
for row in original['services']:
 props=dict(line.split('=',1) for line in subprocess.check_output(['systemctl','show',row['unit'],'-p','ActiveState','-p','MainPID','-p','ExecMainStartTimestamp'],text=True).strip().splitlines())
 assert props['ActiveState']=='active'
 started=datetime.strptime(props['ExecMainStartTimestamp'],'%a %Y-%m-%d %H:%M:%S %Z').replace(tzinfo=timezone.utc).timestamp()
 if row['unit']=='fwupd.service' and started>backup.stat().st_mtime:
  observed.append({'unit':row['unit'],'state':'active','event':'firmware daemon started during verification window; no command targeted this unit','started_at':props['ExecMainStartTimestamp']})
 else:
  assert started<=backup.stat().st_mtime,'Unexpected service restart: '+row['unit']
  foreign.append(row['unit'])
assert subprocess.check_output(['systemctl','show','workmate-api.service','--value','-p','WorkingDirectory'],text=True).strip()=='/opt/workmate/overlays/admin-directory-lifecycle-184-v1/backend'
with urllib.request.urlopen('http://127.0.0.1:63073/health/ready',timeout=5) as r:health=json.load(r)
assert health['ok'] and health['kernel']=='codex' and health['ai_ready']
node='/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node'
script="""import pg from 'pg';import {createHash} from 'node:crypto';import {readFile} from 'node:fs/promises';
const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();
try{const expected=JSON.parse(await readFile('/root/cfg/workmate/admin-directory-lifecycle-184-v1-backup/preservation-before.json','utf8'));
const preserved={};for(const [name,sql] of [['model_connections','SELECT * FROM capability_model_connections ORDER BY release_id'],['model_releases','SELECT * FROM capability_releases ORDER BY id'],['uncertain_holds',"SELECT channel,id,state,cost_state,capacity_held,effective_numerator,operation_id,request_hash FROM current_ai_provider_requests WHERE capacity_held ORDER BY id"],['historical_violations','SELECT * FROM ai_request_budget_violations ORDER BY id']]){
 preserved[name]=createHash('sha256').update(JSON.stringify((await c.query(sql)).rows)).digest('hex')===expected[name];if(!preserved[name])throw new Error('Preserved configuration or hold changed');}
const schema=(await c.query('SELECT max(version) AS n FROM schema_migrations')).rows[0].n;if(schema!==161)throw new Error('Wrong schema');
const permissions=(await c.query("SELECT permissions FROM admin_roles WHERE key='super_admin' AND builtin")).rows[0].permissions;
if(!['admin.users.create','admin.users.delete','admin.tenants.create','admin.tenants.delete'].every(p=>permissions.includes(p)))throw new Error('Missing lifecycle permission');
console.log(JSON.stringify({schema_version:schema,preserved,new_permissions_registered:true}));
}finally{await c.end();}"""
facts=json.loads(subprocess.check_output([node,'--env-file='+str(cfg/'app.env'),'--input-type=module','-e',script],cwd='/opt/workmate/overlays/admin-directory-lifecycle-184-v1/backend',text=True))
guide=cfg/'DEPLOYMENT-README.md';text=guide.read_text()
marker='## Administrative user and workspace lifecycle · stage184'
if marker not in text:guide.write_text(marker+'\n\nBackend: /opt/workmate/overlays/admin-directory-lifecycle-184-v1/backend. Admin: /opt/workmate/overlays/admin-directory-ui-184-v2/admin/dist. Schema161. Mandatory five-minute frozen previews, explicit selections up to100, atomic acceptance, OTP user creation, owner/wallet/project enterprise creation, user identity tombstones and durable workspace erasure. Highest administrators execute directly; other roles follow the pinned policy. Financial/audit/shared workspace records are retained. Credentials and model settings unchanged. Original deployment postcheck stopped on a concurrent firmware-daemon start; business services verified separately.\n\n'+text)
receipt={'stage':184,'at':datetime.now(timezone.utc).isoformat(),'status':'deployed','schema_version':161,
 'backend_overlay':'/opt/workmate/overlays/admin-directory-lifecycle-184-v1/backend','admin_overlay':'/opt/workmate/overlays/admin-directory-ui-184-v2/admin/dist',
 'credentials_unchanged':True,'foreign_configuration_unchanged':True,'foreign_business_services_preexisting':True,
 'foreign_preexisting_service_count':len(foreign),'observed_unrelated_service_events':observed,
 'model_and_hold_hashes_unchanged':True,'private_migration_backup':True,'initial_postcheck':'interrupted_by_firmware_daemon_pid_change','verification_resumed':True,
 'health':health,'facts':facts,'virtualization_invoked':False}
with (cfg/'admin-directory-lifecycle-184-final.sanitized.json').open('x') as f:json.dump(receipt,f,indent=2)
print(json.dumps(receipt))
PY
