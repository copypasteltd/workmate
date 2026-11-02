#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_CODE_191'
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,socket,subprocess,time,urllib.request
cfg=Path('/root/cfg/workmate');previous=Path('/opt/workmate/overlays/native-repair-191-v2/backend');dest=Path('/opt/workmate/overlays/native-repair-191-v3/backend')
node='/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node';unit='workmate-candidate-native-191-v3.service'
assert subprocess.check_output(['systemctl','show','workmate-api.service','-p','WorkingDirectory','--value'],text=True).strip()==str(previous)
manifest=json.loads((dest.parent/'manifest.json').read_text())
for r in manifest['files']:
 b=(dest.parent/r['path']).read_bytes();assert len(b)==r['bytes'] and hashlib.sha256(b).hexdigest()==r['sha256']
original={name:(cfg/name).read_bytes() for name in ['app.env','migration.env']}
preflight="import pg from'pg';const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();try{const r=await c.query(\"SELECT count(*)::int n FROM tasks WHERE status='running'\");if(r.rows[0].n!==0)throw Error('Running customer task; no restart');}finally{await c.end();}"
subprocess.run([node,'--env-file='+str(cfg/'app.env'),'--input-type=module','-e',preflight],cwd=dest,check=True)
state=cfg/'native-191/code-only-v3';state.mkdir(mode=0o700)
for name,raw in original.items():p=state/(name+'.before');p.write_bytes(raw);p.chmod(0o600)
with socket.socket() as s:assert s.connect_ex(('127.0.0.1',63079))!=0
candidate=state/'candidate.env';candidate.write_bytes(original['app.env']+b'\nHOST=127.0.0.1\nPORT=63079\nWORKER_ENABLED=false\n');candidate.chmod(0o600)
before={u:subprocess.check_output(['systemctl','show',u,'-p','ActiveState','-p','MainPID'],text=True) for u in ['workmate-db.service','workmate-lan-proxy.service']}
drop=Path('/etc/systemd/system/workmate-api.service.d')/('z'*24+'-native-repair-191-v3.conf');assert not drop.exists()
def ready(port):
 for _ in range(80):
  try:
   with urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/health/ready',timeout=2) as r:h=json.load(r)
   if h.get('ok') and h.get('ai_ready') and h.get('data_mode')=='configured_services':return h
  except Exception:pass
  time.sleep(.5)
 raise RuntimeError('Readiness failed')
try:
 subprocess.run(['systemd-run','--quiet','--collect','--unit='+unit,'--property=User=workmate','--property=Group=workmate','--property=WorkingDirectory='+str(dest),'--property=EnvironmentFile='+str(candidate),'--property=Delegate=yes','--property=NoNewPrivileges=yes','--property=ProtectSystem=strict','--property=PrivateTmp=yes','--property=ProtectControlGroups=no','--property=ReadWritePaths=/var/lib/workmate /var/log/workmate /sys/fs/cgroup/system.slice/'+unit,'/usr/bin/python3',str(dest/'scripts/launch-linux-native-service.py'),node,str(dest/'dist/src/server.js')],check=True)
 candidate_health=ready(63079);subprocess.run(['systemctl','stop',unit],check=True)
 subprocess.run([node,'--env-file='+str(cfg/'app.env'),'--input-type=module','-e',preflight],cwd=dest,check=True)
 drop.write_text('[Service]\nDelegate=yes\nProtectControlGroups=no\nPrivateTmp=yes\nReadWritePaths=/sys/fs/cgroup/system.slice/workmate-api.service\nWorkingDirectory='+str(dest)+'\nExecStart=\nExecStart=/usr/bin/python3 '+str(dest/'scripts/launch-linux-native-service.py')+' '+node+' '+str(dest/'dist/src/server.js')+'\n');drop.chmod(0o644)
 subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','restart','workmate-api.service'],check=True);health=ready(63073)
 for name,raw in original.items():assert raw==(cfg/name).read_bytes()
 for u,v in before.items():assert subprocess.check_output(['systemctl','show',u,'-p','ActiveState','-p','MainPID'],text=True)==v
 assert subprocess.check_output(['systemctl','show','workmate-api.service','-p','WorkingDirectory','--value'],text=True).strip()==str(dest)
 report=dict(stage=191,status='deployed_for_final_acceptance',at=datetime.now(timezone.utc).isoformat(),overlay=str(dest),schema_version=162,health=health,candidate_health=candidate_health,credentials_unchanged=True,database_and_proxy_processes_unchanged=True,rollback_compatible_checkout=str(previous),existing_customer_tasks_preserved=True)
 with (state/'deployment.sanitized.json').open('x') as f:json.dump(report,f,indent=2);f.write('\n')
 print(json.dumps(report))
except Exception:
 if drop.exists():drop.unlink();subprocess.run(['systemctl','daemon-reload'],check=False);subprocess.run(['systemctl','restart','workmate-api.service'],check=False)
 raise
finally:subprocess.run(['systemctl','stop',unit],check=False,stderr=subprocess.DEVNULL)
WM_CODE_191
