#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_CHECK'
import json,socket,subprocess,urllib.request
from pathlib import Path
out={'services':{}}
for unit in ['workmate-api.service','workmate-db.service','workmate-lan-proxy.service']:
 out['services'][unit]=subprocess.check_output(['systemctl','show',unit,'-p','ActiveState','-p','MainPID','-p','WorkingDirectory','-p','NRestarts'],text=True).strip().splitlines()
receipt=Path('/root/cfg/workmate/native-191/code-only-v4/deployment.sanitized.json')
out['v4_receipt']=json.loads(receipt.read_text()) if receipt.exists() else None
for port in [63072,63073]:
 try:
  with urllib.request.urlopen(f'http://127.0.0.1:{port}/health/ready',timeout=5) as r:out['health_'+str(port)]=json.load(r)
 except Exception as e:out['health_'+str(port)]={'error':type(e).__name__}
with socket.socket() as s:out['diagnostic_port_9229_closed']=s.connect_ex(('127.0.0.1',9229))!=0
print(json.dumps(out))
WM_CHECK
