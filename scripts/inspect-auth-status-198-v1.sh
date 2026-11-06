#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_AUTH_STATUS_198'
import json,subprocess
rows={};out=[]
text=subprocess.check_output(['journalctl','-u','workmate-api.service','--since','2026-11-06 04:34:35 UTC','--until','2026-11-06 04:35:10 UTC','--output=cat','--no-pager'],text=True)
for line in text.splitlines():
 try:r=json.loads(line)
 except Exception:continue
 if r.get('req',{}).get('url')=='/v1/auth/challenges' and r.get('req',{}).get('method')=='POST':rows[r.get('reqId')]={'path':'/v1/auth/challenges','method':'POST'}
 if r.get('reqId') in rows and 'statusCode' in r.get('res',{}):out.append({**rows.pop(r['reqId']),'status':r['res']['statusCode']})
print(json.dumps({'stage':198,'scope':'Only request method/path/status; no mail bodies, codes, addresses, cookies or credentials','observed_challenge_statuses':out,'account_challenge_policy':'At most two challenge creations per email/audience/minute; unchanged'}))
WM_AUTH_STATUS_198
