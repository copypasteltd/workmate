#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_STAGE_195'
from pathlib import Path,PurePosixPath
import hashlib,json,stat,subprocess,zipfile
previous=Path('/opt/workmate/overlays/integrated-195-v7/backend')
assert subprocess.check_output(['systemctl','show','workmate-api.service','-p','WorkingDirectory','--value'],text=True).strip()==str(previous)
dest=Path('/opt/workmate/overlays/integrated-195-v8');assert not dest.exists()
archive=Path('/home/carzygod/workmate-upload-195-v8/integrated-195-v8.zip')
assert hashlib.sha256(archive.read_bytes()).hexdigest()==Path(str(archive)+'.sha256').read_text().split()[0]
with zipfile.ZipFile(archive) as z:
 m=json.loads(z.read('manifest.json'));assert m['stage']==195 and m['schema_version']==163
 assert len(z.namelist())==len(set(z.namelist())) and set(z.namelist())=={r['path'] for r in m['files']}|{'manifest.json'}
 dest.mkdir()
 for r in m['files']:
  p=PurePosixPath(r['path']);assert not p.is_absolute() and '..' not in p.parts and '\\' not in r['path'] and p.parts[0] in ['backend','web','admin','tools']
  assert not stat.S_ISLNK(z.getinfo(r['path']).external_attr>>16)
  data=z.read(r['path']);assert len(data)==r['bytes'] and hashlib.sha256(data).hexdigest()==r['sha256']
  f=dest/r['path'];f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(data);f.chmod(0o644)
 (dest/'manifest.json').write_bytes(z.read('manifest.json'))
backend=dest/'backend'
old=json.loads((previous/'package-lock.json').read_text())['packages'];new=json.loads((backend/'package-lock.json').read_text())['packages']
assert {k:v for k,v in old.items() if k}!={}
assert {k:v for k,v in old.items() if k}=={k:v for k,v in new.items() if k},'Runtime dependencies changed'
for source in previous.iterdir():
 if source.name in ['src','dist','migrations','contracts','scripts','.data','package.json','package-lock.json']:continue
 target=backend/source.name
 if not target.exists():target.symlink_to(source.resolve(),target_is_directory=source.is_dir())
(dest/'tools/node_modules').symlink_to((backend/'node_modules').resolve(),target_is_directory=True)
data=backend/'.data';data.mkdir()
for source in (previous/'.data').iterdir():
 if source.name in ['document-preview'] or source.name.startswith('native-qualification-'):continue
 (data/source.name).symlink_to(source.resolve(),target_is_directory=source.is_dir())
# Office setup and qualification are native operations; no service is switched here.
node='/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node'
subprocess.run([node,'scripts/setup-document-preview-linux.mjs'],cwd=backend,check=True)
subprocess.run(['chown','-R','workmate:workmate',str(data/'document-preview')],check=True)
subprocess.run(['runuser','-u','workmate','--',node,str(dest/'tools/qualify-office-integrated-195-v2.mjs')],cwd=backend,check=True)
print(json.dumps({'status':'staged_and_office_verified','overlay':str(dest),'current_services_unchanged':True}))
WM_STAGE_195
