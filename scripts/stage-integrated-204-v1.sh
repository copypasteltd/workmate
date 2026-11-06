#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path,PurePosixPath
import hashlib,json,shutil,stat,subprocess,zipfile
previous=Path('/opt/workmate/overlays/integrated-202-v2/backend')
assert subprocess.check_output(['systemctl','show','workmate-api.service','-p','WorkingDirectory','--value'],text=True).strip()==str(previous)
dest=Path('/opt/workmate/overlays/integrated-204-v1');assert not dest.exists()
archive=Path('/home/carzygod/workmate-upload-204-v1/integrated-204-v1.zip')
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(archive)==Path(str(archive)+'.sha256').read_text().split()[0]
with zipfile.ZipFile(archive) as z:
 m=json.loads(z.read('manifest.json'));assert m['stage']==204 and m['schema_version']==165
 assert len(z.namelist())==len(set(z.namelist())) and set(z.namelist())=={r['path'] for r in m['files']}|{'manifest.json'}
 dest.mkdir()
 for r in m['files']:
  p=PurePosixPath(r['path']);assert not p.is_absolute() and '..' not in p.parts and '\\' not in r['path'] and p.parts[0] in ['backend','web','admin']
  assert not stat.S_ISLNK(z.getinfo(r['path']).external_attr>>16)
  data=z.read(r['path']);assert len(data)==r['bytes'] and hashlib.sha256(data).hexdigest()==r['sha256']
  f=dest/r['path'];f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(data);f.chmod(0o644)
 (dest/'manifest.json').write_bytes(z.read('manifest.json'))
backend=dest/'backend'
old=json.loads((previous/'package-lock.json').read_text())['packages'];new=json.loads((backend/'package-lock.json').read_text())['packages']
assert {k:v for k,v in old.items() if k}=={k:v for k,v in new.items() if k},'Runtime dependency change requires separate qualification'
for p in previous.iterdir():
 if p.name in ['src','dist','migrations','scripts','contracts','.data','package.json','package-lock.json']:continue
 target=backend/p.name
 if not target.exists():target.symlink_to(p.resolve(),target_is_directory=p.is_dir())
data=backend/'.data';data.mkdir();runtime=[]
for p in (previous/'.data').iterdir():
 if p.name.startswith('native-qualification-') or '.before-' in p.name or '.candidate-' in p.name:continue
 target=data/p.name
 if p.name in ['cloud-program-host-linux','cloud-browser-host-linux']:
  assert p.is_dir() and not p.is_symlink()
  rows=[{'path':f.relative_to(p).as_posix(),'bytes':f.stat().st_size,'sha256':sha(f)} for f in p.rglob('*') if f.is_file()]
  assert rows and all(not f.is_symlink() for f in p.rglob('*'))
  shutil.copytree(p,target,copy_function=shutil.copy2)
  assert all((target/r['path']).stat().st_size==r['bytes'] and sha(target/r['path'])==r['sha256'] for r in rows)
  runtime.append({'name':p.name,'real_directory':True,'files':rows})
 else:target.symlink_to(p.resolve(),target_is_directory=p.is_dir())
assert len(runtime)==2
# Keep hashed assets from already-open pages; do not alter the new index or
# touch the established Nginx roots, mappings, configuration or process.
live=Path('/opt/workmate/overlays/integrated-201-v1/web/dist').resolve()
for folder in ['assets','fonts']:
 for p in (live/folder).rglob('*'):
  if p.is_file():
   target=dest/'web/dist'/p.relative_to(live)
   if not target.exists():target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,target)
(dest/'runtime-copy.json').write_text(json.dumps(runtime,indent=2)+'\n')
assert json.loads((data/'document-preview/qualification-195-v2.json').read_text())['status']=='passed'
print(json.dumps({'status':'staged','overlay':str(dest),'native_runtime_directories':2,'network_changes':False,'services_restarted':False}))
PY
