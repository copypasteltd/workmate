"""Package built product sources and public contracts only."""
from pathlib import Path
import hashlib,json,zipfile
delivery=Path(__file__).resolve().parents[1]
platform=delivery.parent/'copypaste-platform'
state=delivery/'.data/deployment-191';state.mkdir(parents=True,exist_ok=True)
archive=state/'workmate-native-repair-191-v1.zip'
rows=[]
with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for folder in ['src','dist','migrations','contracts']:
  for f in sorted((platform/folder).rglob('*')):
   if not f.is_file():continue
   name='backend/'+f.relative_to(platform).as_posix();raw=f.read_bytes()
   z.writestr(name,raw);rows.append(dict(path=name,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest()))
 manifest=dict(stage=191,schema_version=162,files=rows,backend_dependency_lock_sha256=hashlib.sha256((platform/'package-lock.json').read_bytes()).hexdigest())
 z.writestr('manifest.json',json.dumps(manifest,indent=2)+'\n')
sha=hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix('.zip.sha256').write_text(sha+'  '+archive.name+'\n',encoding='utf8')
print(json.dumps(dict(archive=str(archive),sha256=sha,files=len(rows))))
