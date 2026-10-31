#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import json,hashlib,shutil
from datetime import datetime,timezone
upload=Path('/home/carzygod/workmate-upload-177');downloads=Path('/opt/workmate/downloads')
manifest=json.loads((upload/'workmate-domain-clients-177.json').read_bytes())
assert manifest['stage']==177 and manifest['credentials_included']==False
assert manifest['native_qualification']['status']=='passed'
for row in manifest['files']:
 p=upload/row['file'];assert p.parent==upload and p.is_file()
 assert p.stat().st_size==row['bytes'] and hashlib.sha256(p.read_bytes()).hexdigest()==row['sha256']
for name in [r['file'] for r in manifest['files']]+['workmate-domain-clients-177.json','workmate-domain-clients-177.sha256']:
 target=downloads/name;assert not target.exists();shutil.copyfile(upload/name,target);target.chmod(0o644)
safe={'stage':177,'at':datetime.now(timezone.utc).isoformat(),'files':manifest['files'],'download_origin':'https://agent.copypaste.hk/downloads/','frozen_installers_preserved':True}
with Path('/root/cfg/workmate/domains-177-clients.sanitized.json').open('x') as f:json.dump(safe,f,indent=2)
print(json.dumps({'status':'installed','clients':len(manifest['files']),'frozen_installers_preserved':True}))
PY
