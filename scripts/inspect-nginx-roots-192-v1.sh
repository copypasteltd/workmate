#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_NGINX'
import json,hashlib,re
from pathlib import Path
p=Path('/opt/workmate/nginx/nginx.conf');raw=p.read_bytes()
print(json.dumps({'config_path':str(p),'sha256':hashlib.sha256(raw).hexdigest(),'static_roots':re.findall(r'\broot\s+([^;]+);',raw.decode())}))
WM_NGINX
