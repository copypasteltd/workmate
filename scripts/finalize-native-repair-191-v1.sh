#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_FINALIZE_191'
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,subprocess,time,urllib.request
cfg=Path('/root/cfg/workmate');state=cfg/'native-191/activation-v1'
dest=Path('/opt/workmate/overlays/native-repair-191-v2/backend');rollback=dest.parent/'rollback-schema162/backend'
node='/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node'
assert subprocess.check_output(['systemctl','show','workmate-api.service','-p','WorkingDirectory','--value'],text=True).strip()==str(rollback)
assert (state/'database.before.dump').stat().st_size>100000
for name in ['app.env','migration.env']:assert (state/(name+'.before')).read_bytes()==(cfg/name).read_bytes()
m=json.loads((dest.parent/'manifest.json').read_text())
for r in m['files']:
 b=(dest.parent/r['path']).read_bytes();assert len(b)==r['bytes'] and hashlib.sha256(b).hexdigest()==r['sha256']
before={u:subprocess.check_output(['systemctl','show',u,'-p','ActiveState','-p','MainPID'],text=True) for u in ['workmate-db.service','workmate-lan-proxy.service']}
verify=r"""
import pg from 'pg';import{readFile}from'node:fs/promises';import assert from'node:assert/strict';
const c=new pg.Client({connectionString:process.env.OWNER_DATABASE_URL});await c.connect();try{
const rows=(await c.query("SELECT t.id,t.status,t.charged_micros::text,t.budget_micros::text,t.version,d.state,d.finished_at FROM tasks t JOIN desktop_executions d ON d.task_id=t.id WHERE t.id IN ('cec8df4d-0614-4a4e-b3d6-568ac9a50912','d46d0357-c423-4775-9218-695b49b1b44a') ORDER BY t.id")).rows;
assert.deepEqual(JSON.parse(JSON.stringify(rows)),JSON.parse(await readFile('/root/cfg/workmate/native-191/activation-v1/terminal-tasks.before.sanitized.json','utf8')));
const slots=(await c.query("SELECT id,public.task_occupies_execution_slot(t) occupies_execution_slot FROM tasks t WHERE id IN ('cec8df4d-0614-4a4e-b3d6-568ac9a50912','d46d0357-c423-4775-9218-695b49b1b44a') ORDER BY id")).rows;assert.equal(slots.length,2);assert.ok(slots.every(r=>r.occupies_execution_slot===false));console.log(JSON.stringify({terminal_tasks_unchanged:true,execution_capacity:slots}));
}finally{await c.end();}

"""
facts=json.loads(subprocess.check_output([node,'--env-file='+str(cfg/'app.env'),'--env-file='+str(cfg/'migration.env'),'--input-type=module','-e',verify],cwd=dest,text=True))
preflight="import pg from'pg';const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();try{const r=await c.query(\"SELECT count(*)::int n FROM tasks WHERE status='running'\");if(r.rows[0].n!==0)throw Error('Running customer task');}finally{await c.end();}"
subprocess.run([node,'--env-file='+str(cfg/'app.env'),'--input-type=module','-e',preflight],cwd=dest,check=True)
drop=Path('/etc/systemd/system/workmate-api.service.d/zzzzzzzzzzzzzzzzzzzz-native-repair-191-v1.conf');original=drop.read_bytes()
try:
 drop.write_text('[Service]\nDelegate=yes\nProtectControlGroups=no\nPrivateTmp=yes\nReadWritePaths=/sys/fs/cgroup/system.slice/workmate-api.service\nWorkingDirectory='+str(dest)+'\nExecStart=\nExecStart=/usr/bin/python3 '+str(dest/'scripts/launch-linux-native-service.py')+' '+node+' '+str(dest/'dist/src/server.js')+'\n')
 subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','restart','workmate-api.service'],check=True)
 health=None
 for _ in range(80):
  try:
   with urllib.request.urlopen('http://127.0.0.1:63073/health/ready',timeout=2) as r:health=json.load(r)
   if health.get('ok') and health.get('ai_ready') and health.get('data_mode')=='configured_services':break
  except Exception:pass
  time.sleep(.5)
 assert health and health.get('ok') and health.get('ai_ready') and health.get('data_mode')=='configured_services'
 for u,v in before.items():assert subprocess.check_output(['systemctl','show',u,'-p','ActiveState','-p','MainPID'],text=True)==v
 for name in ['app.env','migration.env']:assert (state/(name+'.before')).read_bytes()==(cfg/name).read_bytes()
 report=dict(stage=191,status='deployed_for_real_acceptance',at=datetime.now(timezone.utc).isoformat(),overlay=str(dest),schema_version=162,health=health,credentials_unchanged=True,database_and_proxy_processes_unchanged=True,backup_complete=True,rollback_compatible_checkout=str(rollback),initial_attempt='Health passed; timestamp serialization assertion corrected before final activation',**facts)
 with (state/'deployment.sanitized.json').open('x') as f:json.dump(report,f,indent=2);f.write('\n')
 print(json.dumps(report))
except Exception:
 drop.write_bytes(original);subprocess.run(['systemctl','daemon-reload'],check=False);subprocess.run(['systemctl','restart','workmate-api.service'],check=False);raise
WM_FINALIZE_191
