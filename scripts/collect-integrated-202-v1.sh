#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import hashlib,json,subprocess
cfg=Path('/root/cfg/workmate/integrated-202');root=Path('/opt/workmate/overlays/integrated-202-v1')
report={'stage':202,'deployment':json.loads((cfg/'activation-v1/deployment.sanitized.json').read_text()),'downloads':json.loads((cfg/'downloads-v1/receipt.json').read_text()),'office':json.loads((root/'backend/.data/document-preview/qualification-195-v2.json').read_text()),'media_runtime':json.loads((Path('/root/cfg/workmate/integrated-201/media-runtime-v2/receipt.sanitized.json')).read_text())}
assert report['media_runtime']['status']=='passed'
report['services']={unit:subprocess.check_output(['systemctl','show',unit,'-p','ActiveState','-p','MainPID','-p','NRestarts','-p','WorkingDirectory','-p','User','-p','NoNewPrivileges'],text=True) for unit in ['workmate-api.service','workmate-db.service','workmate-lan-proxy.service']}
rows=json.loads((root/'manifest.json').read_text())['files'];assert all((root/r['path']).stat().st_size==r['bytes'] and hashlib.sha256((root/r['path']).read_bytes()).hexdigest()==r['sha256'] for r in rows)
report['verified_runtime_files']=len(rows);report['proxy_sha256']=hashlib.sha256(Path('/opt/workmate/nginx/nginx.conf').read_bytes()).hexdigest()
print(json.dumps(report))
PY
