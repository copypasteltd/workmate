#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import json
p=Path('/root/cfg/workmate/integrated-204/public-download-host-v2')
r=json.loads((p/'receipt.sanitized.json').read_text())
print(json.dumps({'stage':204,'status':r['status'],'completed':[{'name':x['name'],'status':x['status'],'bytes':x['bytes'],'expected_bytes':x['expected_bytes'],'seconds':x['seconds']} for x in r['downloads']],'current_file_sizes':{f.name:f.stat().st_size for f in p.iterdir() if f.is_file() and f.suffix in ['.exe','.zip','.txt']},'finished_at':r.get('finished_at'),'read_only':True}))
PY
