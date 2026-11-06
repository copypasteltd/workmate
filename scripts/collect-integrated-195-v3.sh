#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_COLLECT_195'
from pathlib import Path
import json,subprocess,hashlib
cfg=Path('/root/cfg/workmate/integrated-195')
report={'stage':195,'deployment':json.loads((cfg/'activation-v5/deployment.sanitized.json').read_text()),'downloads':json.loads((cfg/'downloads-v2/receipt.json').read_text()),'office':json.loads(Path('/opt/workmate/overlays/integrated-195-v10/backend/.data/document-preview/qualification-195-v2.json').read_text())}
report['services']={u:subprocess.check_output(['systemctl','show',u,'-p','ActiveState','-p','MainPID','-p','NRestarts','-p','WorkingDirectory','-p','User','-p','NoNewPrivileges'],text=True) for u in ['workmate-api.service','workmate-db.service','workmate-lan-proxy.service']}
report['retained_failed_attempts']={'activation-v1':'Static reload was checked before the new Nginx workers were ready; rollback restored compatible old API and static roots.','downloads-v1':'HEAD verification raced the graceful reload; proxy configuration restored; immutable public files retained.'}
report['proxy_sha256']=hashlib.sha256(Path('/opt/workmate/nginx/nginx.conf').read_bytes()).hexdigest()
print(json.dumps(report))
WM_COLLECT_195
