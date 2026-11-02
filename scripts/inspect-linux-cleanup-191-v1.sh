#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_INSPECT_NATIVE_191'
from pathlib import Path
import json
base=Path('/opt/workmate/overlays/native-repair-191-v1/backend/.data/native-qualification-191')
for group in base.glob('*/cloud-browsers/*'):
 if not group.is_dir():continue
 facts={}
 for name in ['owner.json','host-owner.json','host-receipt.json']:
  if (group/name).exists():facts[name]=json.loads((group/name).read_text())
 print(json.dumps(dict(root=str(group),facts=facts)))
WM_INSPECT_NATIVE_191
