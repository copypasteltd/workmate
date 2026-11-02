#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_HB'
import subprocess,json
raw=subprocess.check_output(['journalctl','-u','workmate-api.service','--since','2026-11-02 18:47:00 UTC','--until','2026-11-02 18:49:15 UTC','-o','cat','--no-pager'],text=True)
selected={};out=[]
for line in raw.splitlines():
 try:r=json.loads(line)
 except:continue
 req=r.get('req',{});url=req.get('url','')
 if 'dddcb494-42f4-4d29-80bd-9c4bd4141176' in url or 'desktop-inference' in url:
  selected[r.get('reqId')]=url;out.append({'time':r.get('time'),'request_id':r.get('reqId'),'path':url,'method':req.get('method')})
 elif r.get('reqId') in selected and ('res' in r or 'err' in r):out.append({'time':r.get('time'),'path':selected[r['reqId']],'status':r.get('res',{}).get('statusCode'),'responseTime':r.get('responseTime'),'error_code':r.get('err',{}).get('code')})
print(json.dumps(out))
WM_HB
