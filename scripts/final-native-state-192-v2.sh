#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_FINAL_192'
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,socket,subprocess,urllib.request
backend=Path('/opt/workmate/overlays/native-recheck-192-v1/backend');cfg=Path('/root/cfg/workmate');node='/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node'
assert subprocess.check_output(['systemctl','show','workmate-api.service','-p','WorkingDirectory','--value'],text=True).strip()==str(backend)
report={'stage':192,'at':datetime.now(timezone.utc).isoformat(),'scope':'Read-only final application, settlement facts, preserved pending costs, native cleanup and configuration bytes','services':{}}
for unit in ['workmate-api.service','workmate-db.service','workmate-lan-proxy.service']:
 lines=subprocess.check_output(['systemctl','show',unit,'-p','ActiveState','-p','MainPID','-p','NRestarts'],text=True).splitlines();fields=dict(line.split('=',1) for line in lines)
 assert fields['ActiveState']=='active';report['services'][unit]=fields
report['credentials_unchanged']=all((cfg/name).read_bytes()==(cfg/'native-192/code-only-v1'/(name+'.before')).read_bytes() for name in ['app.env','migration.env']);assert report['credentials_unchanged']
report['health']={}
for name,port in [('api',63073),('api_front',63072)]:
 with urllib.request.urlopen(f'http://127.0.0.1:{port}/health/ready',timeout=5) as response:health=json.load(response)
 assert health['ok'] and health['ai_ready'] and health['data_mode']=='configured_services';report['health'][name]=health
script=r"""
import assert from'node:assert/strict';import pg from'pg';
import{desktopClientErrorSql}from'./dist/src/desktop-errors.js';
const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();try{await c.query('BEGIN READ ONLY');
const ids=['cec8df4d-0614-4a4e-b3d6-568ac9a50912','d46d0357-c423-4775-9218-695b49b1b44a','dddcb494-42f4-4d29-80bd-9c4bd4141176','12a332c0-ecc3-4cf1-8f69-0ef902009566','0106f3ed-cd7f-45ac-a3c9-417a08b7f42e','630ce1e9-b6f2-4e3d-a386-3ad619bcccf9'];
const tasks=(await c.query(`SELECT id,status,error_code,charged_micros::text,version,task_occupies_execution_slot(tasks) occupies_execution_slot,${desktopClientErrorSql('tasks.id')} client_error_code FROM tasks WHERE id=ANY($1::uuid[]) ORDER BY id`,[ids])).rows;assert.equal(tasks.length,6);
for(const [id,cost]of[['12a332c0-ecc3-4cf1-8f69-0ef902009566','40595'],['0106f3ed-cd7f-45ac-a3c9-417a08b7f42e','106047'],['630ce1e9-b6f2-4e3d-a386-3ad619bcccf9','55477']]){const task=tasks.find(t=>t.id===id);assert.equal(task.status,'succeeded');assert.equal(task.charged_micros,cost);assert.equal(task.occupies_execution_slot,false);assert.equal(task.client_error_code,null);}
const original=tasks.find(t=>t.id==='dddcb494-42f4-4d29-80bd-9c4bd4141176');assert.equal(original.status,'reconciling');assert.equal(original.error_code,'USAGE_RECONCILIATION_REQUIRED');assert.equal(original.client_error_code,'LOCAL_CODEX_TURN_FAILED');assert.equal(original.occupies_execution_slot,false);
for(const id of ids.slice(0,2)){const t=tasks.find(t=>t.id===id);assert.equal(t.status,'reconciling');assert.equal(t.version,4);assert.equal(t.occupies_execution_slot,false);}
const requests=(await c.query(`SELECT id,task_id,state,cost_state,capacity_held,usage_known,outcome_code FROM current_ai_provider_requests WHERE id=ANY($1::uuid[]) ORDER BY id`,[['ef9ea47b-b247-40ba-a502-efec956d6c1f','dff247a5-fce8-441d-ab79-4af917d57404','9e62e3a1-571d-42ec-8a92-b4dfc68e3835']])).rows;assert.equal(requests.length,3);for(const r of requests){assert.equal(r.capacity_held,false);assert.equal(r.cost_state,'unknown');assert.equal(r.usage_known,false);}
const schema=(await c.query('SELECT max(version) version FROM schema_migrations')).rows[0].version;assert.equal(schema,162);const running=(await c.query("SELECT count(*)::int n FROM tasks WHERE status='running'")).rows[0].n;
console.log(JSON.stringify({tasks,requests,schema,running_tasks:running}));await c.query('ROLLBACK');}finally{await c.end();}
"""
report['facts']=json.loads(subprocess.check_output([node,'--env-file='+str(cfg/'app.env'),'--input-type=module','-e',script],cwd=backend,text=True))
cg=Path('/sys/fs/cgroup/system.slice/workmate-api.service/executions');report['remaining_native_jobs']=[p.name for p in cg.iterdir() if p.is_dir()] if cg.exists() else [];assert not report['remaining_native_jobs']
with socket.socket() as s:report['diagnostic_port_9229_closed']=s.connect_ex(('127.0.0.1',9229))!=0
assert report['diagnostic_port_9229_closed']
report['status']='passed';p=cfg/'native-192/final-state-v2.sanitized.json'
with p.open('x') as f:json.dump(report,f,indent=2);f.write('\n')
p.chmod(0o600);print(json.dumps(report))
WM_FINAL_192
