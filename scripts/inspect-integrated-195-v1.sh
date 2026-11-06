#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_INSPECT_195'
from pathlib import Path
import json,subprocess
root=Path('/opt/workmate/overlays/integrated-195-v10')
p=root/'backend/.data/document-preview/qualification-195-v2.json'
print(json.dumps({'stage':195,'candidate_exists':root.is_dir(),'office':json.loads(p.read_text()) if p.exists() else None,'live_root':subprocess.check_output(['systemctl','show','workmate-api.service','-p','WorkingDirectory','--value'],text=True).strip()}))
WM_INSPECT_195
