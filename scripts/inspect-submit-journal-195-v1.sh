#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_SUBMIT_195'
import subprocess,json
rows=[]
for line in subprocess.check_output(['journalctl','-u','workmate-api.service','--since','2026-11-06 00:40:28 UTC','--until','2026-11-06 00:40:39 UTC','-o','cat','--no-pager'],text=True).splitlines():
 try:v=json.loads(line)
 except Exception:continue
 if 'c553cee1-2afa-4a02-809e-8da0f3abaabf' in str(v.get('req',{})) or v.get('err'):
  rows.append({'reqId':v.get('reqId'),'method':v.get('req',{}).get('method'),'path':v.get('req',{}).get('url'),'status':v.get('res',{}).get('statusCode'),'error_type':v.get('err',{}).get('type'),'error_code':v.get('err',{}).get('code'),'message':str(v.get('msg',''))[:240]})
print(json.dumps(rows))
WM_SUBMIT_195
