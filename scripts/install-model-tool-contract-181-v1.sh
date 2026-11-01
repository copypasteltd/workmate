#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path,PurePosixPath
from datetime import datetime,timezone
import hashlib,json,shutil,subprocess,time,urllib.request,zipfile
cfg=Path('/root/cfg/workmate');backup=cfg/'model-tool-contract-181-backup'
dest=Path('/opt/workmate/overlays/model-tool-contract-181')
previous=Path('/opt/workmate/overlays/model-http-180/backend')
upload=Path('/home/carzygod/workmate-upload-179/workmate-model-tool-contract-181.zip')
node='/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node'
expected=Path(str(upload)+'.sha256').read_text().split()[0]
assert hashlib.sha256(upload.read_bytes()).hexdigest()==expected
assert not dest.exists() and not backup.exists(),'Existing deployment/backup preserved'
original=json.loads((cfg/'preservation-before.sanitized.json').read_bytes())
foreign={}
for row in original['cfg']:
 p=Path(row['path']);foreign[str(p)]=hashlib.sha256(p.read_bytes()).hexdigest()
services={}
for row in original['services']:
 services[row['unit']]=subprocess.check_output(['systemctl','show',row['unit'],'-p','ActiveState','-p','MainPID'],text=True)
backup.mkdir(mode=0o700)
for name in ['app.env','migration.env','credentials.txt','DEPLOYMENT-README.md']:
 shutil.copy2(cfg/name,backup/name)
proxy=Path('/opt/workmate/nginx/nginx.conf');old_proxy=proxy.read_text();shutil.copy2(proxy,backup/'nginx.conf')
dest.mkdir(mode=0o755)
with zipfile.ZipFile(upload) as z:
 m=json.loads(z.read('manifest.json'));assert m['stage']==181 and m['schema_version']==158
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
check="import pg from 'pg';const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();try{const r=await c.query(\"SELECT (SELECT count(*)::int FROM tasks WHERE status IN ('queued','running','reconciling')) AS active,(SELECT max(version) FROM schema_migrations) AS schema\");console.log(JSON.stringify(r.rows[0]));}finally{await c.end();}"
state=json.loads(subprocess.check_output([node,'--env-file='+str(cfg/'app.env'),'--input-type=module','-e',check],cwd=dest/'backend',text=True))
assert state['active']==0 and int(state['schema'])==158,'Active work or incompatible schema; no service switch performed'
drop=Path('/etc/systemd/system/workmate-api.service.d/zzz-model-tool-contract-181.conf');assert not drop.exists()
drop.write_text('[Service]\nWorkingDirectory='+str(dest/'backend')+'\nExecStart=\nExecStart='+node+' '+str(dest/'backend/dist/src/server.js')+'\n');drop.chmod(0o644)
new=old_proxy
for client in ['web','admin']:
 old='/opt/workmate/overlays/model-http-180/'+client+'/dist';assert new.count('root '+old+';')==1
 new=new.replace('root '+old+';','root '+str(dest/client/'dist')+';')
try:
 subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','restart','workmate-api.service'],check=True)
 ready=None
 for _ in range(40):
  try:
   with urllib.request.urlopen('http://127.0.0.1:63073/health/ready',timeout=2) as r:ready=json.load(r)
   if ready.get('codex_tool_contract')=='scoped_code_mode_v1':break
  except Exception:pass
  time.sleep(1)
 assert ready and ready.get('codex_tool_contract')=='scoped_code_mode_v1'
 proxy.write_text(new);subprocess.run(['/usr/sbin/nginx','-t','-p','/opt/workmate/nginx/','-c',str(proxy)],check=True)
 subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=True)
except Exception:
 proxy.write_text(old_proxy);drop.unlink(missing_ok=True)
 subprocess.run(['systemctl','daemon-reload'],check=False);subprocess.run(['systemctl','restart','workmate-api.service'],check=False)
 subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=False)
 raise
for name,h in foreign.items():assert hashlib.sha256(Path(name).read_bytes()).hexdigest()==h
for name,value in services.items():assert subprocess.check_output(['systemctl','show',name,'-p','ActiveState','-p','MainPID'],text=True)==value
for name in ['app.env','migration.env','credentials.txt']:assert (cfg/name).read_bytes()==(backup/name).read_bytes()
guide=cfg/'DEPLOYMENT-README.md'
guide.write_text('## Codex scoped code-mode tool contract · stage181\n\nCloud Codex supports flat function tools and pinned native additional_tools / functions.exec code mode, scoped to registered business tools. OS and delegation tools remain disabled. Rejected streams retain their real failure codes. Admin permits separately budgeted text verification retries and explains failures. Existing gpt-6-luna model settings, encrypted keys and earlier uncertain accounting records are preserved. Native and Admin validation are required after deployment. Schema158 is unchanged. Overlay: /opt/workmate/overlays/model-tool-contract-181.\n\n'+guide.read_text())
receipt={'stage':181,'at':datetime.now(timezone.utc).isoformat(),'status':'deployed','schema_version':158,'overlay':str(dest),'archive_sha256':expected,'model_transport':'http_and_https','codex_tool_contract':'scoped_code_mode_v1','credentials_unchanged':True,'model_configuration_unchanged':True,'foreign_configuration_unchanged':True,'foreign_service_pids_unchanged':True,'virtualization_invoked':False}
with (cfg/'model-tool-contract-181.sanitized.json').open('x') as f:json.dump(receipt,f,indent=2)
print(json.dumps(receipt))
PY
