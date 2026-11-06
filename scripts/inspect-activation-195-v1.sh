#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_STATUS_195'
import subprocess,json,urllib.request
from pathlib import Path
out={}
for u in ['workmate-api.service','workmate-db.service','workmate-lan-proxy.service']:
 out[u]=subprocess.check_output(['systemctl','show',u,'-p','WorkingDirectory','-p','ActiveState','-p','MainPID'],text=True)
for port in [63070,63071,63072]:
 with urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/health/ready',timeout=8) as r:out[str(port)]=json.load(r)
out['download_receipt']=Path('/root/cfg/workmate/integrated-195/downloads-v2/receipt.json').is_file()
print(json.dumps(out))
WM_STATUS_195
