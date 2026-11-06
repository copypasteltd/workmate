#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import json
cfg=Path('/root/cfg/workmate/integrated-204')
print(json.dumps({'deployment':json.loads((cfg/'activation-v2/deployment.sanitized.json').read_text()),'backup_client':json.loads((cfg/'client-provision-v2/receipt.sanitized.json').read_text()),'downloads':json.loads((cfg/'downloads-v1/receipt.json').read_text())}))
PY
