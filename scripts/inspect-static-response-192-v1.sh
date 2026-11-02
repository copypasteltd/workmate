#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_HTML_192'
import json,re,hashlib,urllib.request,difflib
from pathlib import Path
proxy=Path('/opt/workmate/nginx/nginx.conf').read_text()
report={'static_roots':re.findall(r'\broot\s+([^;]+);',proxy),'filters':re.findall(r'\bsub_filter\s+[^;]+;',proxy),'origins':[]}
for name,port in [('web',63070),('admin',63071)]:
 with urllib.request.urlopen(f'http://127.0.0.1:{port}/',timeout=10) as r:raw=r.read()
 expected=(Path('/opt/workmate/overlays/native-recheck-192-v1')/name/'dist/index.html').read_bytes()
 report['origins'].append({'component':name,'actual_sha256':hashlib.sha256(raw).hexdigest(),'expected_sha256':hashlib.sha256(expected).hexdigest(),'html_difference':list(difflib.unified_diff(expected.decode().splitlines(),raw.decode().splitlines()))[:18]})
print(json.dumps(report))
WM_HTML_192
