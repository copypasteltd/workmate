#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_COLLECT_197'
from pathlib import Path
import hashlib,json,subprocess
cfg=Path('/root/cfg/workmate/integrated-197');root=Path('/opt/workmate/overlays/integrated-197-v2')
report={'stage':197,'deployment':json.loads((cfg/'activation-v2/deployment.sanitized.json').read_text()),'downloads':json.loads((cfg/'downloads-v2/receipt.json').read_text()),'office':json.loads((root/'backend/.data/document-preview/qualification-195-v2.json').read_text())}
report['services']={unit:subprocess.check_output(['systemctl','show',unit,'-p','ActiveState','-p','MainPID','-p','NRestarts','-p','WorkingDirectory','-p','User','-p','NoNewPrivileges'],text=True) for unit in ['workmate-api.service','workmate-db.service','workmate-lan-proxy.service']}
rows=json.loads((root/'manifest.json').read_text())['files'];assert all((root/r['path']).stat().st_size==r['bytes'] and hashlib.sha256((root/r['path']).read_bytes()).hexdigest()==r['sha256'] for r in rows)
report['verified_runtime_files']=len(rows);report['proxy_sha256']=hashlib.sha256(Path('/opt/workmate/nginx/nginx.conf').read_bytes()).hexdigest()
print(json.dumps(report))
WM_COLLECT_197
