#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_STAGE_200'
from pathlib import Path,PurePosixPath
import hashlib,json,stat,subprocess,zipfile
previous=Path('/opt/workmate/overlays/integrated-200-v2/backend')
assert subprocess.check_output(['systemctl','show','workmate-api.service','-p','WorkingDirectory','--value'],text=True).strip()==str(previous)
dest=Path('/opt/workmate/overlays/integrated-201-v1');assert not dest.exists()
archive=Path('/home/carzygod/workmate-upload-201-v1/integrated-201-v1.zip')
assert hashlib.sha256(archive.read_bytes()).hexdigest()==Path(str(archive)+'.sha256').read_text().split()[0]
with zipfile.ZipFile(archive) as z:
 m=json.loads(z.read('manifest.json'));assert m['stage']==201 and m['schema_version']==163
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
 if source.name.startswith('native-qualification-'):continue
 (data/source.name).symlink_to(source.resolve(),target_is_directory=source.is_dir())
# This batch does not change Office conversion. Preserve its qualified native runtime.
for folder in ['src','dist/src','scripts']:
 for p in (previous/folder).glob('*'):
  if p.is_file() and any(word in p.name for word in ['document-preview','office','document-produce']):
   assert (backend/folder/p.name).is_file() and hashlib.sha256(p.read_bytes()).digest()==hashlib.sha256((backend/folder/p.name).read_bytes()).digest()
assert json.loads((data/'document-preview/qualification-195-v2.json').read_text())['status']=='passed'
print(json.dumps({'status':'staged','overlay':str(dest),'office_runtime':'unchanged, previous qualification retained','current_services_unchanged':True}))
WM_STAGE_200
