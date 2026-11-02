#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path,PurePosixPath
import hashlib,json,subprocess,time,urllib.request,zipfile
dest=Path('/opt/workmate/overlays/real-services-188-v1');assert not dest.exists()
previous=Path('/opt/workmate/overlays/admin-directory-lifecycle-184-v1/backend')
archive=Path('/home/carzygod/workmate-upload-179/workmate-real-services-188-v1.zip')
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
subprocess.run(['systemctl','stop','workmate-candidate-188.service'],check=True)
subprocess.run(['systemctl','reset-failed','workmate-candidate-188.service'],check=False,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
node='/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node'
subprocess.run(['systemd-run','--unit=workmate-candidate-188-v2','--property=User=workmate','--property=Group=workmate','--property=WorkingDirectory='+str(dest/'backend'),'--property=EnvironmentFile=/root/cfg/workmate/live-188-v3/candidate.env',node,str(dest/'backend/dist/src/server.js')],check=True)
health=None
for _ in range(45):
 try:
  with urllib.request.urlopen('http://127.0.0.1:63079/health/ready',timeout=2) as r:health=json.load(r)
  if health.get('ok'):break
 except Exception:pass
 time.sleep(1)
assert health and health['ok'] and health['data_mode']=='configured_services'
receipt={'stage':188,'status':'candidate_updated','archive_sha256':digest,'health':health,'public_service_unchanged':True}
with Path('/root/cfg/workmate/candidate-code-188-v1.sanitized.json').open('x') as f:json.dump(receipt,f,indent=2)
print(json.dumps(receipt))
PY
