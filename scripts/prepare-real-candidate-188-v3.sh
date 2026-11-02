#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,os,shutil,socket,subprocess,time,urllib.request
cfg=Path('/root/cfg/workmate');backup=cfg/'live-188-v3'
assert not backup.exists(),'Existing candidate preparation preserved'
with socket.socket() as s:s.bind(('127.0.0.1',63079))
backup.mkdir(mode=0o700)
for name in ['app.env','migration.env','credentials.txt','DEPLOYMENT-README.md']:
 shutil.copy2(cfg/name,backup/(name+'.before'));(backup/(name+'.before')).chmod(0o600)
script=r"""
import {readFile,writeFile,stat} from 'node:fs/promises';import {spawnSync} from 'node:child_process';import{createHash}from'node:crypto';
const b='/root/cfg/workmate/live-188-v3/';const u=new URL(process.env.OWNER_DATABASE_URL);
const p=spawnSync('/opt/workmate/toolchains/pg-client-188-v1/root/usr/lib/postgresql/18/bin/pg_dump',['--format=custom','--file='+b+'database.before.dump'],{env:{...process.env,LD_LIBRARY_PATH:'/opt/workmate/toolchains/pg-client-188-v1/root/usr/lib/x86_64-linux-gnu',PGHOST:u.hostname,PGPORT:u.port,PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:u.pathname.slice(1)},encoding:'utf8'});
if(p.status!==0)throw new Error('Owned database backup failed; no mode changed');
const data=await readFile(b+'database.before.dump');await writeFile(b+'database.before.sha256',createHash('sha256').update(data).digest('hex')+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({database_backup_bytes:data.length,database_backup_complete:true}));
"""
node='/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node'
backend='/opt/workmate/overlays/admin-directory-lifecycle-184-v1/backend'
print(subprocess.check_output([node,'--env-file='+str(cfg/'app.env'),'--env-file='+str(cfg/'migration.env'),'--input-type=module','-e',script],cwd=backend,text=True))
(backup/'database.before.dump').chmod(0o600)
old=(cfg/'app.env').read_text();lines=old.splitlines();updates={'DEMO_MODE':'false','PORT':'63079','WORKER_ENABLED':'false'}
found=set();new=[]
for line in lines:
 key=line.split('=',1)[0]
 if key in updates:new.append(key+'='+updates[key]);found.add(key)
 else:new.append(line)
for key,value in updates.items():
 if key not in found:new.append(key+'='+value)
candidate=backup/'candidate.env';candidate.write_text('\n'.join(new)+'\n');candidate.chmod(0o600)
subprocess.run(['systemd-run','--unit=workmate-candidate-188','--property=User=workmate','--property=Group=workmate','--property=WorkingDirectory='+backend,'--property=EnvironmentFile='+str(candidate),node,backend+'/dist/src/server.js'],check=True)
health=None
for _ in range(40):
 try:
  with urllib.request.urlopen('http://127.0.0.1:63079/health/ready',timeout=2) as r:health=json.load(r)
  if health['ok'] and health['data_mode']=='configured_services':break
 except Exception:time.sleep(.5)
assert health and health['ok'] and health['data_mode']=='configured_services','Candidate did not become ready; current public service is unchanged'
report={'stage':188,'at':datetime.now(timezone.utc).isoformat(),'status':'candidate_ready','public_api_mode_unchanged':True,'candidate_loopback_port':63079,'candidate_worker_enabled':False,'database_backup_complete':True,'prior_configuration_bytes_preserved':True,'candidate_health':health}
with (cfg/'real-candidate-188-v3.sanitized.json').open('x') as f:json.dump(report,f,indent=2);f.write('\n')
print(json.dumps(report))
PY
