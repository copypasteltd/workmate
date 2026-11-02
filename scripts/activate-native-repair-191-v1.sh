#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_ACTIVATE_191'
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,shutil,socket,subprocess,time,urllib.request
cfg=Path('/root/cfg/workmate');state=cfg/'native-191';state.mkdir(mode=0o700)
previous=Path('/opt/workmate/overlays/real-services-189-v5/backend')
dest=Path('/opt/workmate/overlays/native-repair-191-v2/backend')
assert subprocess.check_output(['systemctl','show','workmate-api.service','-p','WorkingDirectory','--value'],text=True).strip()==str(previous)
node='/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node'
original={name:(cfg/name).read_bytes() for name in ['app.env','migration.env']}
for name,raw in original.items():
 target=state/(name+'.before');target.write_bytes(raw);target.chmod(0o600)
manifest=json.loads((dest.parent/'manifest.json').read_text());assert manifest['schema_version']==162
for r in manifest['files']:
 b=(dest.parent/r['path']).read_bytes();assert len(b)==r['bytes'] and hashlib.sha256(b).hexdigest()==r['sha256'],r['path']
with socket.socket() as s:assert s.connect_ex(('127.0.0.1',63079))!=0
unit='workmate-candidate-native-191-v1.service'
assert subprocess.run(['systemctl','is-active','--quiet',unit]).returncode!=0
before={u:subprocess.check_output(['systemctl','show',u,'-p','ActiveState','-p','MainPID'],text=True) for u in ['workmate-db.service','workmate-lan-proxy.service']}
# A forward schema upgrade cannot run the old strict-version executable. Prepare
# an independent rollback checkout with only the schema compatibility number advanced.
rollback=dest.parent/'rollback-schema162/backend';rollback.mkdir(parents=True)
for source in previous.iterdir():
 target=rollback/source.name
 if source.name in ['src','dist']:shutil.copytree(source,target,symlinks=False)
 else:target.symlink_to(source.resolve(),target_is_directory=source.is_dir())
for rel in ['src/schema-compatibility.ts','dist/src/schema-compatibility.js']:
 p=rollback/rel;s=p.read_text();assert 'requiredSchemaVersion = 161' in s;s=s.replace('requiredSchemaVersion = 161','requiredSchemaVersion = 162',1);p.write_text(s)
script=r"""
import pg from 'pg';import{writeFile,readFile}from'node:fs/promises';import{createHash}from'node:crypto';import{spawnSync}from'node:child_process';
const c=new pg.Client({connectionString:process.env.OWNER_DATABASE_URL});await c.connect();try{
const r=await c.query("SELECT count(*)::int n FROM tasks WHERE status='running'");if(r.rows[0].n!==0)throw Error('Existing task is running; deployment stopped');
const holds=(await c.query("SELECT t.id,t.status,t.charged_micros::text,t.budget_micros::text,t.version,d.state,d.finished_at FROM tasks t JOIN desktop_executions d ON d.task_id=t.id WHERE t.id IN ('cec8df4d-0614-4a4e-b3d6-568ac9a50912','d46d0357-c423-4775-9218-695b49b1b44a') ORDER BY t.id")).rows;
await writeFile('/root/cfg/workmate/native-191/terminal-tasks.before.sanitized.json',JSON.stringify(holds,null,2)+'\n',{flag:'wx',mode:0o600});
const u=new URL(process.env.OWNER_DATABASE_URL),b='/root/cfg/workmate/native-191/';
const result=spawnSync('/opt/workmate/toolchains/pg-client-188-v1/root/usr/lib/postgresql/18/bin/pg_dump',['--format=custom','--file='+b+'database.before.dump'],{env:{...process.env,LD_LIBRARY_PATH:'/opt/workmate/toolchains/pg-client-188-v1/root/usr/lib/x86_64-linux-gnu',PGHOST:u.hostname,PGPORT:u.port,PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:u.pathname.slice(1)},encoding:'utf8'});
if(result.status!==0)throw Error('Owned database backup failed');const data=await readFile(b+'database.before.dump');await writeFile(b+'database.before.sha256',createHash('sha256').update(data).digest('hex')+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({backup_complete:true,bytes:data.length,running:0}));
}finally{await c.end();}
"""
print(subprocess.check_output([node,'--env-file='+str(cfg/'app.env'),'--env-file='+str(cfg/'migration.env'),'--input-type=module','-e',script],cwd=previous,text=True))
(state/'database.before.dump').chmod(0o600)
candidate=state/'candidate.env';candidate.write_bytes(original['app.env']+b'\nHOST=127.0.0.1\nPORT=63079\nWORKER_ENABLED=false\n');candidate.chmod(0o600)
drop=Path('/etc/systemd/system/workmate-api.service.d/zzzzzzzzzzzzzzzzzzzz-native-repair-191-v1.conf');assert not drop.exists()
def ready(port):
 for _ in range(80):
  try:
   with urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/health/ready',timeout=2) as response:h=json.load(response)
   if h.get('ok') and h.get('ai_ready') and h.get('data_mode')=='configured_services':return h
  except Exception:pass
  time.sleep(.5)
 raise RuntimeError('Native repair readiness failed')
migrated=False;stopped=False
try:
 # Stop only the API after checking idle; preserve PostgreSQL, proxy and all keys.
 subprocess.run(['systemctl','stop','workmate-api.service'],check=True);stopped=True
 migrate="import pg from 'pg';import{runMigrations}from'./dist/scripts/migration-runner.js';const c=new pg.Client({connectionString:process.env.OWNER_DATABASE_URL});await c.connect();try{await runMigrations(c,'production',{throughVersion:162});const r=await c.query('SELECT max(version)::int v,count(*)::int n FROM schema_migrations');if(r.rows[0].v!==162||r.rows[0].n!==162)throw Error('Incomplete schema');}finally{await c.end();}"
 subprocess.run([node,'--env-file='+str(cfg/'app.env'),'--env-file='+str(cfg/'migration.env'),'--input-type=module','-e',migrate],cwd=dest,check=True);migrated=True
 subprocess.run(['systemd-run','--quiet','--collect','--unit='+unit,'--property=User=workmate','--property=Group=workmate','--property=WorkingDirectory='+str(dest),'--property=EnvironmentFile='+str(candidate),'--property=Delegate=yes','--property=NoNewPrivileges=yes','--property=ProtectSystem=strict','--property=PrivateTmp=yes','--property=ProtectControlGroups=no','--property=ReadWritePaths=/var/lib/workmate /var/log/workmate /sys/fs/cgroup/system.slice/'+unit,'/usr/bin/python3',str(dest/'scripts/launch-linux-native-service.py'),node,str(dest/'dist/src/server.js')],check=True)
 candidate_health=ready(63079)
 subprocess.run(['systemctl','stop',unit],check=True)
 drop.write_text('[Service]\nDelegate=yes\nProtectControlGroups=no\nPrivateTmp=yes\nReadWritePaths=/sys/fs/cgroup/system.slice/workmate-api.service\nWorkingDirectory='+str(dest)+'\nExecStart=\nExecStart=/usr/bin/python3 '+str(dest/'scripts/launch-linux-native-service.py')+' '+node+' '+str(dest/'dist/src/server.js')+'\n');drop.chmod(0o644)
 subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','start','workmate-api.service'],check=True)
 health=ready(63073)
 for name,raw in original.items():assert raw==(cfg/name).read_bytes()
 for u,v in before.items():assert subprocess.check_output(['systemctl','show',u,'-p','ActiveState','-p','MainPID'],text=True)==v
 verify=r"""
import pg from 'pg';import{readFile}from'node:fs/promises';import assert from'node:assert/strict';
const c=new pg.Client({connectionString:process.env.OWNER_DATABASE_URL});await c.connect();try{
const rows=(await c.query("SELECT t.id,t.status,t.charged_micros::text,t.budget_micros::text,t.version,d.state,d.finished_at FROM tasks t JOIN desktop_executions d ON d.task_id=t.id WHERE t.id IN ('cec8df4d-0614-4a4e-b3d6-568ac9a50912','d46d0357-c423-4775-9218-695b49b1b44a') ORDER BY t.id")).rows;
assert.deepEqual(rows,JSON.parse(await readFile('/root/cfg/workmate/native-191/terminal-tasks.before.sanitized.json','utf8')));
const slots=(await c.query("SELECT id,public.task_occupies_execution_slot(t) occupies_execution_slot FROM tasks t WHERE id IN ('cec8df4d-0614-4a4e-b3d6-568ac9a50912','d46d0357-c423-4775-9218-695b49b1b44a') ORDER BY id")).rows;assert.equal(slots.length,2);assert.ok(slots.every(r=>r.occupies_execution_slot===false));console.log(JSON.stringify({terminal_tasks_unchanged:true,execution_capacity:slots}));
}finally{await c.end();}
"""
 facts=json.loads(subprocess.check_output([node,'--env-file='+str(cfg/'app.env'),'--env-file='+str(cfg/'migration.env'),'--input-type=module','-e',verify],cwd=dest,text=True))
 report=dict(stage=191,status='deployed_for_real_acceptance',at=datetime.now(timezone.utc).isoformat(),overlay=str(dest),schema_version=162,health=health,candidate_health=candidate_health,credentials_unchanged=True,database_and_proxy_processes_unchanged=True,backup_complete=True,rollback_compatible_checkout=str(rollback),**facts)
 with (state/'deployment.sanitized.json').open('x') as f:json.dump(report,f,indent=2);f.write('\n')
 print(json.dumps(report))
except Exception:
 # Migration is additive. Never roll back customer financial history or restore
 # a database dump over new work. Use the prepared schema-compatible old code.
 if stopped:
  if migrated:
   drop.write_text('[Service]\nWorkingDirectory='+str(rollback)+'\nExecStart=\nExecStart='+node+' '+str(rollback/'dist/src/server.js')+'\n');drop.chmod(0o644)
  elif drop.exists():drop.unlink()
  subprocess.run(['systemctl','daemon-reload'],check=False);subprocess.run(['systemctl','restart','workmate-api.service'],check=False)
 raise
finally:
 subprocess.run(['systemctl','stop',unit],check=False,stderr=subprocess.DEVNULL)
WM_ACTIVATE_191
