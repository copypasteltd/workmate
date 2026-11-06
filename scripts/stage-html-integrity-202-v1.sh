#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path,PurePosixPath
import hashlib,json,shutil,stat,subprocess,zipfile
previous=Path('/opt/workmate/overlays/integrated-202-v1');dest=Path('/opt/workmate/overlays/integrated-202-v2');assert not dest.exists()
assert subprocess.check_output(['systemctl','show','workmate-api.service','-p','WorkingDirectory','--value'],text=True).strip()==str(previous/'backend')
archive=Path('/home/carzygod/workmate-html-integrity-202-v1/html-integrity-202-v1.zip');assert hashlib.sha256(archive.read_bytes()).hexdigest()==Path(str(archive)+'.sha256').read_text().split()[0]
old=json.loads((previous/'manifest.json').read_text());assert all(hashlib.sha256((previous/r['path']).read_bytes()).hexdigest()==r['sha256'] for r in old['files'])
with zipfile.ZipFile(archive) as z:
 m=json.loads(z.read('manifest.json'));assert m['stage']==202 and m['schema_version']==163
 assert set(m['delta_files'])=={'backend/src/server.ts','backend/dist/src/server.js','backend/package.json','backend/scripts/run-current-tests-owned-v15.mjs'}
 assert set(z.namelist())==set(m['delta_files'])|{'manifest.json'} and len(z.namelist())==len(set(z.namelist()))
 dest.mkdir();backend=dest/'backend';backend.mkdir()
 for folder in ['src','dist','migrations','contracts','scripts']:shutil.copytree(previous/'backend'/folder,backend/folder,symlinks=True)
 for p in (previous/'backend').iterdir():
  if p.name in ['src','dist','migrations','contracts','scripts','.data']:continue
  if p.name in ['package.json','package-lock.json']:shutil.copyfile(p,backend/p.name)
  else:(backend/p.name).symlink_to(p.resolve(),target_is_directory=p.is_dir())
 data=backend/'.data';data.mkdir()
 for p in (previous/'backend/.data').iterdir():(data/p.name).symlink_to(p.resolve(),target_is_directory=p.is_dir())
 for name in ['web','admin','tools']:(dest/name).symlink_to(previous/name,target_is_directory=True)
 byname={r['path']:r for r in m['files']}
 for name in m['delta_files']:
  p=PurePosixPath(name);assert not p.is_absolute() and '..' not in p.parts and p.parts[0]=='backend'
  assert not stat.S_ISLNK(z.getinfo(name).external_attr>>16);payload=z.read(name);row=byname[name];assert len(payload)==row['bytes'] and hashlib.sha256(payload).hexdigest()==row['sha256'];target=dest/name;assert not target.is_symlink();target.write_bytes(payload);target.chmod(0o644)
 (dest/'manifest.json').write_bytes(z.read('manifest.json'))
 assert all((dest/r['path']).stat().st_size==r['bytes'] and hashlib.sha256((dest/r['path']).read_bytes()).hexdigest()==r['sha256'] for r in m['files'])
assert json.loads((backend/'.data/document-preview/qualification-195-v2.json').read_text())['status']=='passed'
print(json.dumps({'status':'staged','overlay':str(dest),'source_backend_unchanged':True,'static_paths_and_server_network_unchanged':True,'manifest_files':len(m['files'])}))
PY
