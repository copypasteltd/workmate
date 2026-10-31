#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import json,hashlib,zipfile,shutil
from datetime import datetime,timezone
cfg=Path('/root/cfg/workmate');base=Path('/opt/workmate');upload=Path('/home/carzygod/workmate-upload-176/workmate-lan-deployment-176.zip')
assert json.loads((cfg/'deployment-owner.json').read_bytes())['stage']==176
expected=Path(str(upload)+'.sha256').read_text().split()[0];assert hashlib.sha256(upload.read_bytes()).hexdigest()==expected
dest=base/'sources/lan-deployment-176';assert not dest.exists();dest.mkdir(parents=True)
with zipfile.ZipFile(upload) as z:
 manifest=json.loads(z.read('manifest.json'));assert manifest['stage']==176 and manifest['credentials_included']==False
 for row in manifest['files']:
  p=dest/row['path'];assert p.resolve().is_relative_to(dest.resolve());raw=z.read(row['path'])
  assert len(raw)==row['bytes'] and hashlib.sha256(raw).hexdigest()==row['sha256'];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
 for name in ['manifest.json','HANDOFF.md']:(dest/name).write_bytes(z.read(name))
for src in [upload,Path(str(upload)+'.sha256')]:
 target=base/'downloads'/src.name;assert not target.exists();shutil.copyfile(src,target);target.chmod(0o644)
guide=dest/'docs/releases/lan-176.md';copy=cfg/'DEPLOYMENT-README.md';assert not copy.exists();shutil.copyfile(guide,copy);copy.chmod(0o600)
safe={'stage':176,'status':'handoff_installed','at':datetime.now(timezone.utc).isoformat(),'artifact':upload.name,'sha256':expected,'source_directory':str(dest),'operator_guide':str(copy),'download':'http://192.168.31.20:63070/downloads/'+upload.name}
with (cfg/'handoff.sanitized.json').open('x') as f:json.dump(safe,f,indent=2)
print(json.dumps(safe))
PY
