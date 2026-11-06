"""Package the exact backend-only correction against the immutable deployed manifest."""
from pathlib import Path
import hashlib,json,zipfile
delivery=Path(__file__).resolve().parents[1];backend=delivery.parent/'copypaste-platform';out=delivery/'.data/deployment-202-v2';out.mkdir(parents=True,exist_ok=True)
assert json.loads((delivery/'.data/integrated-202-v5/verification.json').read_text())['state']=='passed'
with zipfile.ZipFile(delivery/'.data/deployment-202-v1/integrated-202-v1.zip') as prior:manifest=json.loads(prior.read('manifest.json'))
rows={r['path']:r for r in manifest['files']};delta=['src/server.ts','dist/src/server.js','package.json','scripts/run-current-tests-owned-v15.mjs'];archive=out/'html-integrity-202-v1.zip'
with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED) as z:
 for rel in delta:
  p=backend/rel;assert p.is_file() and not p.is_symlink();data=p.read_bytes();name='backend/'+rel;z.writestr(name,data);rows[name]={'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
 manifest.update(files=sorted(rows.values(),key=lambda r:r['path']),correction='Application-only HTML download no-transform; original payload hashes/guards and server network settings preserved.',delta_files=['backend/'+p for p in delta]);z.writestr('manifest.json',json.dumps(manifest,indent=2)+'\n')
digest=hashlib.sha256(archive.read_bytes()).hexdigest();archive.with_suffix('.zip.sha256').write_text(digest+'  '+archive.name+'\n');print(json.dumps({'status':'packaged','delta_files':len(delta),'total_manifest_files':len(rows),'sha256':digest}))
