#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_STORAGE_193'
from pathlib import Path
import json
base=Path('/opt/workmate/downloads');items=[]
if base.exists():
 for p in sorted(base.rglob('*')):
  if p.is_file():items.append({'path':str(p.relative_to(base)),'bytes':p.stat().st_size})
  if len(items)>=60:break
print(json.dumps({'download_storage_exists':base.exists(),'existing_files_first_60':items}))
WM_STORAGE_193
