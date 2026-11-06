#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_ACTIVATE_200_V1'
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,shutil,socket,subprocess,time,urllib.request
cfg=Path('/root/cfg/workmate');state=cfg/'integrated-202/activation-v1';state.parent.mkdir(mode=0o700,exist_ok=True);state.mkdir(mode=0o700)
root=Path('/opt/workmate/overlays/integrated-202-v1');dest=root/'backend'
previous=Path('/opt/workmate/overlays/integrated-201-v1/backend')
node='/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node'
assert subprocess.check_output(['systemctl','show','workmate-api.service','-p','WorkingDirectory','--value'],text=True).strip()==str(previous)
assert json.loads((dest/'.data/document-preview/qualification-195-v2.json').read_text())['status']=='passed'
for r in json.loads((root/'manifest.json').read_text())['files']:
 data=(root/r['path']).read_bytes();assert len(data)==r['bytes'] and hashlib.sha256(data).hexdigest()==r['sha256']
original={n:(cfg/n).read_bytes() for n in ['app.env','migration.env']}
for n,data in original.items():p=state/(n+'.before');p.write_bytes(data);p.chmod(0o600)
proxy=Path('/opt/workmate/nginx/nginx.conf');proxy_before=proxy.read_bytes()
assert hashlib.sha256(proxy_before).hexdigest()==json.loads((cfg/'integrated-202/downloads-v1/receipt.json').read_text())['proxy_after_sha256']
(state/'nginx.conf.before').write_bytes(proxy_before)
before={u:subprocess.check_output(['systemctl','show',u,'-p','MainPID','-p','NRestarts','-p','ActiveState'],text=True) for u in ['workmate-db.service','workmate-lan-proxy.service']}
preflight="import pg from'pg';const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();try{const r=await c.query(\"SELECT count(*)::int n FROM tasks WHERE status IN ('queued','running')\");if(r.rows[0].n!==0)throw Error('Active customer tasks; deployment deferred');}finally{await c.end();}"
subprocess.run([node,'--env-file='+str(cfg/'app.env'),'--input-type=module','-e',preflight],cwd=dest,check=True)
drop=Path('/etc/systemd/system/workmate-api.service.d')/('z'*41+'-integrated-202-v1.conf');assert not drop.exists()
candidate_unit='workmate-candidate-integrated-202-v1.service'
candidate=state/'candidate.env';candidate.write_bytes(original['app.env']+b'\nHOST=127.0.0.1\nPORT=63079\nWORKER_ENABLED=false\n');candidate.chmod(0o600)
with socket.socket() as s:assert s.connect_ex(('127.0.0.1',63079))!=0
def ready(port):
 for _ in range(80):
  try:
   with urllib.request.urlopen(f'http://127.0.0.1:{port}/health/ready',timeout=2) as r:data=json.load(r)
   if data.get('ok') and data.get('ai_ready') and data.get('data_mode')=='configured_services':return data
  except Exception:pass
  time.sleep(.5)
 raise RuntimeError('Readiness failed')
static_swaps=[];started=time.monotonic()
try:
 subprocess.run(['systemd-run','--quiet','--collect','--unit='+candidate_unit,'--property=User=workmate','--property=Group=workmate','--property=WorkingDirectory='+str(dest),'--property=EnvironmentFile='+str(candidate),'--property=Delegate=yes','--property=NoNewPrivileges=yes','--property=ProtectSystem=strict','--property=PrivateTmp=yes','--property=ProtectControlGroups=no','--property=ReadWritePaths=/var/lib/workmate /var/log/workmate '+str(dest/'.data/document-preview')+' /sys/fs/cgroup/system.slice/'+candidate_unit,'/usr/bin/python3',str(dest/'scripts/launch-linux-native-service.py'),node,str(dest/'dist/src/server.js')],check=True)
 candidate_health=ready(63079);subprocess.run(['systemctl','stop',candidate_unit],check=True)
 subprocess.run(['systemctl','stop','workmate-api.service'],check=True)
 drop.write_text('[Service]\nDelegate=yes\nProtectControlGroups=no\nPrivateTmp=yes\nReadWritePaths=/sys/fs/cgroup/system.slice/workmate-api.service '+str(dest/'.data/document-preview')+'\nWorkingDirectory='+str(dest)+'\nExecStart=\nExecStart=/usr/bin/python3 '+str(dest/'scripts/launch-linux-native-service.py')+' '+node+' '+str(dest/'dist/src/server.js')+'\n');drop.chmod(0o644)
 subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','start','workmate-api.service'],check=True);health=ready(63073)
 # Preserve the existing Nginx root paths and every network byte. Switch
 # only owned application directories; keep the prior static tree for rollback.
 for component in ['web','admin']:
  live=previous.parent/component/'dist';saved=live.with_name('dist.before-integrated-202-v1');link=live.with_name('.dist-integrated-202-v1')
  assert live.is_dir() and not live.is_symlink() and not saved.exists() and not link.exists()
  target=root/component/'dist'
  # Preserve already-open pages' old hashed assets without changing new files.
  for sub in ['assets','fonts']:
   if (live/sub).is_dir():
    for old in (live/sub).rglob('*'):
     if old.is_file():
      new=target/old.relative_to(live)
      if not new.exists():new.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(old,new);new.chmod(0o644)
  link.symlink_to(target,target_is_directory=True);static_swaps.append((live,saved,link));live.rename(saved);link.rename(live)
 assert proxy.read_bytes()==proxy_before
 for port,component in [(63070,'web'),(63071,'admin')]:
  expected=(root/component/'dist/index.html').read_bytes()
  for _ in range(40):
   with urllib.request.urlopen(f'http://127.0.0.1:{port}/',timeout=5) as r:actual=r.read()
   if actual==expected:break
   time.sleep(.2)
  else:raise RuntimeError('Static reload readiness failed: '+component)
 after={u:subprocess.check_output(['systemctl','show',u,'-p','MainPID','-p','NRestarts','-p','ActiveState'],text=True) for u in before};assert before==after
 assert all((cfg/n).read_bytes()==data for n,data in original.items())
 report={'stage':202,'status':'deployed','at':datetime.now(timezone.utc).isoformat(),'schema_version':163,'backend_root':str(dest),'web_root':str(root/'web/dist'),'admin_root':str(root/'admin/dist'),'candidate_health':candidate_health,'health':health,'credentials_unchanged':True,'proxy_configuration_unchanged':proxy.read_bytes()==proxy_before,'static_serving_paths_preserved':True,'static_rollback_suffix':'dist.before-integrated-202-v1','database_and_proxy_processes_unchanged':True,'active_customer_tasks':0,'rollback_compatible_checkout':str(previous),'rollback_compatibility':'Unchanged schema163; previous overlay retained, rollback not triggered by this successful activation','activation_seconds':round(time.monotonic()-started,2)}
 (state/'deployment.sanitized.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
except Exception:
 for live,saved,link in reversed(static_swaps):
  if live.is_symlink():live.unlink()
  if saved.exists() and not live.exists():saved.rename(live)
  if link.is_symlink():link.unlink()
 assert proxy.read_bytes()==proxy_before
 if drop.exists():drop.unlink();subprocess.run(['systemctl','daemon-reload'],check=True)
 subprocess.run(['systemctl','restart','workmate-api.service'],check=True);ready(63073);raise
finally:subprocess.run(['systemctl','stop',candidate_unit],check=False,stderr=subprocess.DEVNULL)
WM_ACTIVATE_200_V1
