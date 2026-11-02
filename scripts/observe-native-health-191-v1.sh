#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_HEALTH'
from pathlib import Path
from datetime import datetime,timezone
import json,time,urllib.request
rows=[]
for _ in range(16):
 row={'at':datetime.now(timezone.utc).isoformat()};start=time.monotonic()
 try:
  with urllib.request.urlopen('http://127.0.0.1:63072/health/ready',timeout=2) as r:value=json.load(r)
  row.update(ok=value.get('ok') is True,data_mode=value.get('data_mode'))
 except Exception as e:row.update(ok=False,error=type(e).__name__)
 row['duration_ms']=round((time.monotonic()-start)*1000,3);rows.append(row);time.sleep(2)
out={'stage':191,'scope':'Read-only readiness observations during final actual Desktop workflow; no debugger, profiler, database mutation or response replacement','observations':rows,'all_ready':all(r['ok'] for r in rows),'maximum_ms':max(r['duration_ms'] for r in rows)}
target=Path('/root/cfg/workmate/native-191/health-final-v4.sanitized.json')
with target.open('x') as f:json.dump(out,f,indent=2);f.write('\n')
print(json.dumps(out))
WM_HEALTH
