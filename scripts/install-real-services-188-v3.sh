#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path,PurePosixPath
import hashlib,json,subprocess,time,urllib.request,zipfile
dest=Path('/opt/workmate/overlays/real-services-188-v3');assert not dest.exists()
previous=Path('/opt/workmate/overlays/real-services-188-v1/backend')
archive=Path('/home/carzygod/workmate-upload-179/workmate-real-services-188-v3.zip')
digest=Path(str(archive)+'.sha256').read_text().split()[0];assert hashlib.sha256(archive.read_bytes()).hexdigest()==digest
dest.mkdir()
with zipfile.ZipFile(archive) as z:
 m=json.loads(z.read('manifest.json'));assert m['stage']==188 and m['schema_version']==161
 assert hashlib.sha256((previous/'package-lock.json').read_bytes()).hexdigest()==m['backend_dependency_lock_sha256']
 assert set(z.namelist())=={r['path'] for r in m['files']}|{'manifest.json'}
 for row in m['files']:
  part=PurePosixPath(row['path']);assert not part.is_absolute() and '..' not in part.parts and part.parts[0]=='backend'
  raw=z.read(row['path']);assert len(raw)==row['bytes'] and hashlib.sha256(raw).hexdigest()==row['sha256']
  p=dest/row['path'];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw);p.chmod(0o644)
 (dest/'manifest.json').write_bytes(z.read('manifest.json'))
for p in previous.iterdir():
 if p.name in ['src','dist','migrations']:continue
 target=dest/'backend'/p.name
 if not target.exists():target.symlink_to(p.resolve(),target_is_directory=p.is_dir())
assert (dest/'backend/node_modules').is_dir()
node='/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node'
subprocess.run(['systemctl','stop','workmate-candidate-188-v2.service'],check=True)
subprocess.run(['systemd-run','--unit=workmate-candidate-188-v3','--property=User=workmate','--property=Group=workmate','--property=WorkingDirectory='+str(dest/'backend'),'--property=EnvironmentFile=/root/cfg/workmate/live-188-v3/candidate.env',node,str(dest/'backend/dist/src/server.js')],check=True)
def ready(port):
 for _ in range(60):
  try:
   with urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/health/ready',timeout=2) as r:h=json.load(r)
   if h.get('ok') and h.get('ai_ready') and h.get('data_mode')=='configured_services':return h
  except Exception:pass
  time.sleep(.5)
 raise RuntimeError('Updated real-service runtime did not become healthy')
ready(63079)
cfg=Path('/root/cfg/workmate');original=(cfg/'app.env').read_bytes();drop=Path('/etc/systemd/system/workmate-api.service.d/zzzzzzzzz-real-services-188-v3.conf');assert not drop.exists()
before={u:subprocess.check_output(['systemctl','show',u,'-p','ActiveState','-p','MainPID'],text=True) for u in ['workmate-db.service','workmate-lan-proxy.service']}
try:
 drop.write_text('[Service]\nWorkingDirectory='+str(dest/'backend')+'\nExecStart=\nExecStart='+node+' '+str(dest/'backend/dist/src/server.js')+'\n');drop.chmod(0o644)
 subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','restart','workmate-api.service'],check=True);health=ready(63073)
 for u,v in before.items():assert subprocess.check_output(['systemctl','show',u,'-p','ActiveState','-p','MainPID'],text=True)==v
 assert original==(cfg/'app.env').read_bytes()
 report={'stage':188,'status':'real_services_updated','archive_sha256':digest,'overlay':str(dest/'backend'),'health':health,'database_and_proxy_processes_unchanged':True,'configuration_and_credentials_unchanged':True,'schema_version':161,'native_gateway_bounded_causes_enabled':True}
 with (cfg/'real-services-188-v3.sanitized.json').open('x') as f:json.dump(report,f,indent=2)
 print(json.dumps(report))
except Exception:
 if drop.exists():drop.unlink()
 subprocess.run(['systemctl','daemon-reload'],check=False);subprocess.run(['systemctl','restart','workmate-api.service'],check=False)
 raise
PY
