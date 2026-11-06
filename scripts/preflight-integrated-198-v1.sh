#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_PREFLIGHT_198'
from pathlib import Path
import hashlib,json,subprocess,urllib.request
root=Path('/opt/workmate/overlays/integrated-197-v2/backend');cfg=Path('/root/cfg/workmate')
active=subprocess.check_output(['systemctl','show','workmate-api.service','-p','WorkingDirectory','--value'],text=True).strip();assert active==str(root)
services={u:subprocess.check_output(['systemctl','show',u,'-p','MainPID','-p','ActiveState','-p','NRestarts'],text=True).strip() for u in ['workmate-api.service','workmate-db.service','workmate-lan-proxy.service']}
with urllib.request.urlopen('http://127.0.0.1:63073/health/ready',timeout=5) as r:health=json.load(r)
assert health['ok'] and health['ai_ready'] and health['data_mode']=='configured_services'
print(json.dumps({'stage':198,'status':'ready_for_candidate','active_backend':active,'services':services,'health':health,'existing_private_configuration_files':sorted(p.name for p in cfg.iterdir() if p.is_file()),'configuration_hashes':{n:hashlib.sha256((cfg/n).read_bytes()).hexdigest() for n in ['app.env','migration.env']},'proxy_sha256':hashlib.sha256(Path('/opt/workmate/nginx/nginx.conf').read_bytes()).hexdigest(),'secret_values':'not read into output'}))
WM_PREFLIGHT_198
