#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_PREFLIGHT'
from pathlib import Path
import json,subprocess,hashlib
root=Path('/opt/workmate/overlays/native-repair-191-v2')
assert root.is_dir()
m=json.loads((root/'manifest.json').read_text())
for r in m['files']:
 b=(root/r['path']).read_bytes();assert len(b)==r['bytes'] and hashlib.sha256(b).hexdigest()==r['sha256'],r['path']
print(json.dumps(dict(staged_final_files=len(m['files']),manifest_matches=True)))
print(subprocess.check_output(['systemctl','show','workmate-api.service','-p','WorkingDirectory','-p','User','-p','ProtectControlGroups','-p','Delegate','-p','PrivateTmp','-p','ReadWritePaths','-p','ProtectSystem'],text=True))
for line in Path('/root/cfg/workmate/app.env').read_text().splitlines():
 if line.startswith(('DATA_DIR=','WORKER_ENABLED=')):print(line)
print(subprocess.check_output(['systemctl','show','workmate-native-boundary.service','-p','ActiveState','-p','UnitFileState'],text=True))
WM_PREFLIGHT
