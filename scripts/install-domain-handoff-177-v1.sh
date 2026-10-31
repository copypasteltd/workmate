#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path,PurePosixPath
import json,hashlib,zipfile,shutil
from datetime import datetime,timezone
cfg=Path('/root/cfg/workmate');upload=Path('/home/carzygod/workmate-upload-177/workmate-domains-177.zip')
digest=Path(str(upload)+'.sha256').read_text().split()[0];assert hashlib.sha256(upload.read_bytes()).hexdigest()==digest
dest=Path('/opt/workmate/sources/domains-177');assert not dest.exists();dest.mkdir()
with zipfile.ZipFile(upload) as z:
 manifest=json.loads(z.read('manifest.json'));assert manifest['stage']==177 and manifest['credentials_included']==False
 for row in manifest['files']:
  part=PurePosixPath(row['path']);assert not part.is_absolute() and '..' not in part.parts
  raw=z.read(row['path']);assert len(raw)==row['bytes'] and hashlib.sha256(raw).hexdigest()==row['sha256']
  p=dest/row['path'];p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw);p.chmod(0o644)
 for name in ['manifest.json','HANDOFF.md']:(dest/name).write_bytes(z.read(name))
for p in [upload,Path(str(upload)+'.sha256')]:
 target=Path('/opt/workmate/downloads')/p.name;assert not target.exists();shutil.copyfile(p,target);target.chmod(0o644)
guide=cfg/'DEPLOYMENT-README.md';shutil.copy2(guide,cfg/'domains-177-backup/DEPLOYMENT-README-before-handoff.md')
shutil.copyfile(dest/'docs/releases/domains-177.md',guide);guide.chmod(0o600)
safe={'stage':177,'status':'handoff_installed','at':datetime.now(timezone.utc).isoformat(),'artifact':upload.name,'sha256':digest,'source_directory':str(dest),'operator_guide':str(guide),'download':'https://agent.copypaste.hk/downloads/'+upload.name}
with (cfg/'domains-177-handoff.sanitized.json').open('x') as f:json.dump(safe,f,indent=2)
print(json.dumps(safe))
PY
