"""Additive candidate artifact; excludes credentials and local dependencies."""
from pathlib import Path
import hashlib,json,zipfile
root=Path(__file__).resolve().parents[3]
out=root/'dev/copypaste-delivery/.data/deployment-188';out.mkdir(parents=True,exist_ok=True)
archive=out/'workmate-real-services-188-v4.zip';rows=[]
repo=root/'dev/copypaste-platform'
with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for folder in ['src','dist','migrations']:
  for p in sorted((repo/folder).rglob('*')):
   if not p.is_file():continue
   name='backend/'+p.relative_to(repo).as_posix();raw=p.read_bytes();z.writestr(name,raw)
   rows.append({'path':name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
 m={'stage':188,'schema_version':161,'kernel':'codex','backend_dependency_lock_sha256':hashlib.sha256((repo/'package-lock.json').read_bytes()).hexdigest(),'files':rows}
 z.writestr('manifest.json',json.dumps(m,indent=2)+'\n')
digest=hashlib.sha256(archive.read_bytes()).hexdigest()
with archive.with_suffix('.zip.sha256').open('x',encoding='utf-8') as f:f.write(digest+'  '+archive.name+'\n')
print(json.dumps({'archive':str(archive),'sha256':digest,'files':len(rows),'bytes':archive.stat().st_size}))
