#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_STAGE_191'
from pathlib import Path,PurePosixPath
import hashlib,json,shutil,subprocess,zipfile
previous=Path('/opt/workmate/overlays/real-services-189-v5/backend')
assert subprocess.check_output(['systemctl','show','workmate-api.service','--property=WorkingDirectory','--value'],text=True).strip()==str(previous)
dest=Path('/opt/workmate/overlays/native-repair-191-v2');assert not dest.exists()
archive=Path('/home/carzygod/workmate-upload-191/workmate-native-repair-191-v2.zip')
assert hashlib.sha256(archive.read_bytes()).hexdigest()==Path(str(archive)+'.sha256').read_text().split()[0]
with zipfile.ZipFile(archive) as z:
 m=json.loads(z.read('manifest.json'));assert m['stage']==191 and m['schema_version']==162
 assert hashlib.sha256((previous/'package-lock.json').read_bytes()).hexdigest()==m['backend_dependency_lock_sha256']
 assert set(z.namelist())=={r['path'] for r in m['files']}|{'manifest.json'}
 dest.mkdir()
 for row in m['files']:
  p=PurePosixPath(row['path']);assert not p.is_absolute() and '..' not in p.parts and p.parts[0]=='backend'
  data=z.read(row['path']);assert len(data)==row['bytes'] and hashlib.sha256(data).hexdigest()==row['sha256']
  f=dest/row['path'];f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(data);f.chmod(0o644)
 (dest/'manifest.json').write_bytes(z.read('manifest.json'))
backend=dest/'backend'
for source in previous.iterdir():
 if source.name in ['src','dist','migrations','contracts','scripts','.data']:continue
 target=backend/source.name
 if not target.exists():target.symlink_to(source.resolve(),target_is_directory=source.is_dir())
data=backend/'.data';data.mkdir()
for source in (previous/'.data').iterdir():
 if source.name in ['cloud-program-host-linux','cloud-browser-host-linux','native-qualification-191']:continue
 (data/source.name).symlink_to(source.resolve(),target_is_directory=source.is_dir())
host_source=backend/'src/cloud-linux-host.py';digest=hashlib.sha256(host_source.read_bytes()).hexdigest()
for kind in ['program','browser']:
 profile_file=backend/('contracts/cloud-'+kind+'-runtime.linux.json');profile_raw=profile_file.read_bytes();profile=json.loads(profile_raw)
 folder=data/('cloud-'+kind+'-host-linux');folder.mkdir()
 host=folder/'cloud-linux-host.py';host.write_bytes(host_source.read_bytes());host.chmod(0o755)
 manifest=dict(kind=kind,boundary=profile['boundary'],sha256=digest,source_sha256=digest,host_sha256=digest,host_source_sha256=digest,profile_sha256=hashlib.sha256(profile_raw).hexdigest(),bubblewrap_path=profile['bubblewrap_path'],bubblewrap_sha256=profile['bubblewrap_sha256'])
 (folder/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
owned=data/'native-qualification-191';owned.mkdir(mode=0o700)
subprocess.run(['chown','-R','--no-dereference','workmate:workmate',str(owned)],check=True)
print(json.dumps(dict(status='staged_only',overlay=str(backend),current_service_unchanged=True)))
WM_STAGE_191
