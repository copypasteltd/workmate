#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path,PurePosixPath
from datetime import datetime,timezone
import hashlib,json,shutil,subprocess,time,urllib.request,zipfile
cfg=Path('/root/cfg/workmate');backup=cfg/'model-management-179-backup'
dest=Path('/opt/workmate/overlays/model-management-179')
previous=Path('/opt/workmate/overlays/model-connections-178/backend')
upload=Path('/home/carzygod/workmate-upload-179/workmate-model-management-179.zip')
node='/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node'
expected=Path(str(upload)+'.sha256').read_text().split()[0]
assert hashlib.sha256(upload.read_bytes()).hexdigest()==expected
assert not dest.exists() and not backup.exists(),'Existing deployment/backup preserved'
original=json.loads((cfg/'preservation-before.sanitized.json').read_bytes())
before={'foreign_cfg':[],'foreign_services':[]}
for row in original['cfg']:
 p=Path(row['path']);before['foreign_cfg'].append({'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
for row in original['services']:
 props=dict(x.split('=',1) for x in subprocess.check_output(['systemctl','show',row['unit'],'-p','ActiveState','-p','MainPID'],text=True).splitlines() if '=' in x)
 before['foreign_services'].append({'unit':row['unit'],**props})
backup.mkdir(mode=0o700)
for name in ['app.env','migration.env','credentials.txt','DEPLOYMENT-README.md']:
 shutil.copy2(cfg/name,backup/name)
(backup/'preservation-before.sanitized.json').write_text(json.dumps(before,indent=2))
dest.mkdir(mode=0o755)
with zipfile.ZipFile(upload) as z:
 m=json.loads(z.read('manifest.json'));assert m['stage']==179 and m['schema_version']==158
 assert hashlib.sha256((previous/'package-lock.json').read_bytes()).hexdigest()==m['backend_dependency_lock_sha256']
 assert set(z.namelist())==set([r['path'] for r in m['files']]+['manifest.json'])
 for row in m['files']:
  part=PurePosixPath(row['path']);assert not part.is_absolute() and '..' not in part.parts and part.parts[0] in ['backend','admin','web']
  raw=z.read(row['path']);assert len(raw)==row['bytes'] and hashlib.sha256(raw).hexdigest()==row['sha256']
  target=dest/row['path'];target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw);target.chmod(0o644)
 (dest/'manifest.json').write_bytes(z.read('manifest.json'))
for p in previous.iterdir():
 if p.name in ['src','dist','migrations']:continue
 target=dest/'backend'/p.name
 if not target.exists():target.symlink_to(p.resolve(),target_is_directory=p.is_dir())
assert (dest/'backend/node_modules').is_dir()
idle_script="import pg from 'pg';const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();try{const r=await c.query(\"SELECT count(*)::int AS active FROM tasks WHERE status IN ('queued','running','reconciling')\");console.log(JSON.stringify(r.rows[0]));}finally{await c.end();}"
idle=json.loads(subprocess.check_output([node,'--env-file='+str(cfg/'app.env'),'--input-type=module','-e',idle_script],cwd=dest/'backend',text=True))
assert idle['active']==0,'Active customer work preserved; retry deployment when idle'
proxy=Path('/opt/workmate/nginx/nginx.conf');old_proxy=proxy.read_text();shutil.copy2(proxy,backup/'nginx.conf')
drop_dir=Path('/etc/systemd/system/workmate-api.service.d');drop=drop_dir/'model-management-179.conf';assert not drop.exists()
# No new work can enter between the idle check, forward migration and API switch.
subprocess.run(['systemctl','stop','workmate-api.service'],check=True)
migrate="import pg from 'pg';import {runMigrations} from './dist/scripts/migration-runner.js';const c=new pg.Client({connectionString:process.env.OWNER_DATABASE_URL});await c.connect();try{await runMigrations(c,'model-management-179');}finally{await c.end();}"
try:
 subprocess.run([node,'--env-file='+str(cfg/'migration.env'),'--input-type=module','-e',migrate],cwd=dest/'backend',check=True)
 drop.write_text('[Service]\nWorkingDirectory='+str(dest/'backend')+'\nExecStart=\nExecStart='+node+' '+str(dest/'backend/dist/src/server.js')+'\n');drop.chmod(0o644)
 subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','start','workmate-api.service'],check=True)
 ready=None
 for _ in range(45):
  try:
   with urllib.request.urlopen('http://127.0.0.1:63073/health/ready',timeout=2) as r:ready=json.load(r)
   if ready.get('model_management')=='editable':break
  except Exception:pass
  time.sleep(1)
 assert ready and ready.get('model_management')=='editable','New owned API failed readiness; preserve overlay and additive schema for diagnosis'
 new=old_proxy
 for client in ['web','admin']:
  old='/opt/workmate/overlays/model-connections-178/'+client+'/dist'
  assert new.count('root '+old+';')==1
  new=new.replace('root '+old+';','root '+str(dest/client/'dist')+';')
 proxy.write_text(new)
 subprocess.run(['/usr/sbin/nginx','-t','-p','/opt/workmate/nginx/','-c',str(proxy)],check=True)
 subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=True)
except Exception:
 # The forward schema stays intact. Never start an API that only supports schema157.
 proxy.write_text(old_proxy)
 subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=False)
 raise
for row in before['foreign_cfg']:assert hashlib.sha256(Path(row['path']).read_bytes()).hexdigest()==row['sha256']
for row in before['foreign_services']:
 props=dict(x.split('=',1) for x in subprocess.check_output(['systemctl','show',row['unit'],'-p','ActiveState','-p','MainPID'],text=True).splitlines() if '=' in x)
 assert props=={k:row[k] for k in props},'Unrelated service changed'
assert (cfg/'app.env').read_bytes()==(backup/'app.env').read_bytes()
assert (cfg/'credentials.txt').read_bytes()==(backup/'credentials.txt').read_bytes()
receipt={'stage':179,'at':datetime.now(timezone.utc).isoformat(),'status':'deployed','schema_version':158,
 'overlay':str(dest),'archive_sha256':expected,'model_connections':'per_model','model_management':'editable','credentials_unchanged':True,
 'foreign_configuration_unchanged':True,'foreign_service_pids_unchanged':True,'virtualization_invoked':False}
with (cfg/'model-management-179.sanitized.json').open('x') as f:json.dump(receipt,f,indent=2)
print(json.dumps(receipt))
PY
