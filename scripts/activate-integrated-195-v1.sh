#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_ACTIVATE_195'
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,os,shutil,socket,subprocess,time,urllib.request
cfg=Path('/root/cfg/workmate');state=cfg/'integrated-195/activation-v1';state.mkdir(mode=0o700)
previous=Path('/opt/workmate/overlays/native-recheck-192-v1/backend');root=Path('/opt/workmate/overlays/integrated-195-v7');dest=root/'backend'
node='/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node'
assert subprocess.check_output(['systemctl','show','workmate-api.service','-p','WorkingDirectory','--value'],text=True).strip()==str(previous)
assert json.loads((dest/'.data/document-preview/qualification-195-v2.json').read_text())['status']=='passed'
manifest=json.loads((root/'manifest.json').read_text())
for r in manifest['files']:
 data=(root/r['path']).read_bytes();assert len(data)==r['bytes'] and hashlib.sha256(data).hexdigest()==r['sha256']
original={n:(cfg/n).read_bytes() for n in ['app.env','migration.env']}
for n,data in original.items():p=state/(n+'.before');p.write_bytes(data);p.chmod(0o600)
proxy=Path('/opt/workmate/nginx/nginx.conf');proxy_before=proxy.read_bytes()
expected_proxy='425e21f827498c05da2230e5ade255119d5592a68bf7ef18c2bc336dd391a9ea'
download_receipt=cfg/'integrated-195/downloads-v2/receipt.json'
if download_receipt.exists():expected_proxy=json.loads(download_receipt.read_text())['proxy_after_sha256']
assert hashlib.sha256(proxy_before).hexdigest()==expected_proxy
(state/'nginx.conf.before').write_bytes(proxy_before)
before={u:subprocess.check_output(['systemctl','show',u,'-p','MainPID','-p','NRestarts','-p','ActiveState'],text=True) for u in ['workmate-db.service','workmate-lan-proxy.service']}
preflight="import pg from'pg';const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();try{const r=await c.query(\"SELECT count(*)::int n FROM tasks WHERE status IN ('queued','running')\");if(r.rows[0].n!==0)throw Error('Active customer tasks; deployment deferred');}finally{await c.end();}"
subprocess.run([node,'--env-file='+str(cfg/'app.env'),'--input-type=module','-e',preflight],cwd=dest,check=True)
# Additive migration 163 is safe for the old features. Preserve an explicit old
# checkout with only its schema gate advanced; do not mutate the old release.
rollback_root=Path('/opt/workmate/overlays/integrated-195-rollback-v1/backend');rollback_root.mkdir(parents=True)
for p in previous.iterdir():
 if p.name in ['dist','src']:shutil.copytree(p,rollback_root/p.name,symlinks=True)
 else:(rollback_root/p.name).symlink_to(p.resolve(),target_is_directory=p.is_dir())
compat=[]
for name in ['src/schema-compatibility.ts','dist/src/schema-compatibility.js']:
 p=rollback_root/name;old=p.read_text();assert old.count('requiredSchemaVersion = 162')==1
 new=old.replace('requiredSchemaVersion = 162','requiredSchemaVersion = 163');p.write_text(new)
 compat.append({'path':name,'before_sha256':hashlib.sha256(old.encode()).hexdigest(),'after_sha256':hashlib.sha256(new.encode()).hexdigest()})
(state/'rollback-compatibility.json').write_text(json.dumps(compat,indent=2)+'\n')
drop=Path('/etc/systemd/system/workmate-api.service.d')/('z'*30+'-integrated-195-v1.conf');assert not drop.exists()
candidate_unit='workmate-candidate-integrated-195-v1.service'
candidate=state/'candidate.env';candidate.write_bytes(original['app.env']+b'\nHOST=127.0.0.1\nPORT=63079\nWORKER_ENABLED=false\n');candidate.chmod(0o600)
with socket.socket() as s:assert s.connect_ex(('127.0.0.1',63079))!=0
def ready(port):
 for _ in range(80):
  try:
   with urllib.request.urlopen(f'http://127.0.0.1:{port}/health/ready',timeout=2) as r:data=json.load(r)
   if data.get('ok') and data.get('ai_ready') and data.get('data_mode')=='configured_services':return data
  except Exception:pass
  time.sleep(.5)
 raise RuntimeError('Candidate readiness did not pass')
def configure(folder):
 drop.write_text('[Service]\nDelegate=yes\nProtectControlGroups=no\nPrivateTmp=yes\nReadWritePaths=/sys/fs/cgroup/system.slice/workmate-api.service '+str(dest/'.data/document-preview')+'\nWorkingDirectory='+str(folder)+'\nExecStart=\nExecStart=/usr/bin/python3 '+str(folder/'scripts/launch-linux-native-service.py')+' '+node+' '+str(folder/'dist/src/server.js')+'\n');drop.chmod(0o644)
 subprocess.run(['systemctl','daemon-reload'],check=True)
migrated=False;api_stopped=False;changed_proxy=False;started=time.monotonic()
try:
 subprocess.run(['systemctl','stop','workmate-api.service'],check=True);api_stopped=True
 migrate="import pg from'pg';import{runMigrations}from'./dist/scripts/migration-runner.js';const u=new URL(process.env.OWNER_DATABASE_URL);const c=new pg.Client({connectionString:u.href});await c.connect();try{await runMigrations(c,u.pathname.slice(1));}finally{await c.end();}"
 subprocess.run([node,'--env-file='+str(cfg/'migration.env'),'--input-type=module','-e',migrate],cwd=dest,check=True);migrated=True
 subprocess.run(['systemd-run','--quiet','--collect','--unit='+candidate_unit,'--property=User=workmate','--property=Group=workmate','--property=WorkingDirectory='+str(dest),'--property=EnvironmentFile='+str(candidate),'--property=Delegate=yes','--property=NoNewPrivileges=yes','--property=ProtectSystem=strict','--property=PrivateTmp=yes','--property=ProtectControlGroups=no','--property=ReadWritePaths=/var/lib/workmate /var/log/workmate '+str(dest/'.data/document-preview')+' /sys/fs/cgroup/system.slice/'+candidate_unit,'/usr/bin/python3',str(dest/'scripts/launch-linux-native-service.py'),node,str(dest/'dist/src/server.js')],check=True)
 candidate_health=ready(63079);subprocess.run(['systemctl','stop',candidate_unit],check=True)
 configure(dest);subprocess.run(['systemctl','start','workmate-api.service'],check=True);api_stopped=False;health=ready(63073)
 text=proxy_before.decode();old_web='root /opt/workmate/overlays/product-downloads-193-v3/web/dist;';old_admin='root /opt/workmate/overlays/native-recheck-192-v1/admin/dist;'
 assert text.count(old_web)==1 and text.count(old_admin)==1
 text=text.replace(old_web,'root '+str(root/'web/dist')+';').replace(old_admin,'root '+str(root/'admin/dist')+';')
 proxy.write_text(text);changed_proxy=True
 subprocess.run(['/usr/sbin/nginx','-t','-p','/opt/workmate/nginx/','-c',str(proxy)],check=True,capture_output=True)
 subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=True)
 for port,component in [(63070,'web'),(63071,'admin')]:
  with urllib.request.urlopen(f'http://127.0.0.1:{port}/',timeout=10) as r:assert r.read()==(root/component/'dist/index.html').read_bytes()
 after={u:subprocess.check_output(['systemctl','show',u,'-p','MainPID','-p','NRestarts','-p','ActiveState'],text=True) for u in before};assert before==after
 assert all((cfg/n).read_bytes()==data for n,data in original.items())
 report={'stage':195,'status':'deployed','at':datetime.now(timezone.utc).isoformat(),'schema_version':163,'backend_root':str(dest),'web_root':str(root/'web/dist'),'admin_root':str(root/'admin/dist'),'candidate_health':candidate_health,'health':health,'credentials_unchanged':True,'database_and_proxy_processes_unchanged':True,'active_customer_tasks':0,'rollback_compatible_checkout':str(rollback_root),'activation_seconds':round(time.monotonic()-started,2)}
 (state/'deployment.sanitized.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
except Exception:
 if changed_proxy:
  proxy.write_bytes(proxy_before);subprocess.run(['/usr/sbin/nginx','-t','-p','/opt/workmate/nginx/','-c',str(proxy)],check=True,capture_output=True);subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=True)
 if migrated:configure(rollback_root)
 elif drop.exists():drop.unlink();subprocess.run(['systemctl','daemon-reload'],check=True)
 subprocess.run(['systemctl','start','workmate-api.service'],check=True)
 ready(63073)
 raise
finally:subprocess.run(['systemctl','stop',candidate_unit],check=False,stderr=subprocess.DEVNULL)
WM_ACTIVATE_195
