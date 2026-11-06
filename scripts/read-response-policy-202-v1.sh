#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import hashlib,json,re
p=Path('/opt/workmate/nginx/nginx.conf');raw=p.read_bytes();selected=[]
for n,line in enumerate(raw.decode().splitlines(),1):
 if re.search(r'cache.control|proxy_hide_header|proxy_pass_header|sub_filter|gzip|gunzip',line,re.I):selected.append({'line':n,'policy':line.strip()})
print(json.dumps({'stage':202,'scope':'Read-only cache/representation policy inspection; no proxy edit or reload.','sha256':hashlib.sha256(raw).hexdigest(),'selected_response_policy':selected}))
PY
