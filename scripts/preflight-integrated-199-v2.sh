#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_PREFLIGHT_199'
import json,subprocess,urllib.request
from pathlib import Path
expected='/opt/workmate/overlays/integrated-198-v2/backend'
assert subprocess.check_output(['systemctl','show','workmate-api.service','-p','WorkingDirectory','--value'],text=True).strip()==expected
result={'stage':199,'current_backend':expected,'config_directory_exists':Path('/root/cfg/workmate').is_dir(),'services':{},'public':{}}
for unit in ['workmate-api.service','workmate-db.service','workmate-lan-proxy.service']:
 result['services'][unit]=subprocess.check_output(['systemctl','show',unit,'-p','ActiveState','-p','MainPID','-p','NRestarts'],text=True)
for host in ['agent.copypaste.hk','agent-dashboard.copypaste.hk','ai-api.copypaste.hk']:
 try:
  with urllib.request.urlopen('https://'+host+'/health/ready',timeout=15) as r:result['public'][host]={'status':r.status,'body':json.load(r)}
 except Exception as e:result['public'][host]={'error':type(e).__name__,'status':getattr(e,'code',None),'body':e.read(500).decode('utf-8','replace') if hasattr(e,'read') else ''}
print(json.dumps(result))
WM_PREFLIGHT_199
