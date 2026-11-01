"""Source-bound additive deployment; contains no environment or credentials."""
from pathlib import Path
import hashlib,json,zipfile
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'dev/copypaste-delivery/.data/deployment-181';OUT.mkdir(parents=True,exist_ok=True)
archive=OUT/'workmate-model-tool-contract-181-v2.zip';rows=[]
with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for client,folders in [('platform',['dist','src','migrations']),('admin',['dist']),('web',['dist'])]:
  repo=ROOT/'dev'/('copypaste-'+client)
  for folder in folders:
   for p in sorted((repo/folder).rglob('*')):
    if not p.is_file():continue
    name=('backend' if client=='platform' else client)+'/'+p.relative_to(repo).as_posix()
    raw=p.read_bytes();z.writestr(name,raw)
    rows.append({'path':name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
 manifest={'stage':181,'schema_version':158,'base_release':'v0.1.3','previous_overlay':'model-tool-contract-181',
  'backend_dependency_lock_sha256':hashlib.sha256((ROOT/'dev/copypaste-platform/package-lock.json').read_bytes()).hexdigest(),
  'files':rows,'connection_scope':'immutable_model_configuration','kernel':'codex'}
 z.writestr('manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
sha=hashlib.sha256(archive.read_bytes()).hexdigest()
with archive.with_suffix('.zip.sha256').open('x',encoding='utf-8',newline='\n') as f:f.write(sha+'  '+archive.name+'\n')
receipt={'archive':archive.name,'bytes':archive.stat().st_size,'sha256':sha,'files':len(rows)}
with (OUT/'package-v2.json').open('x',encoding='utf-8',newline='\n') as f:f.write(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt))
