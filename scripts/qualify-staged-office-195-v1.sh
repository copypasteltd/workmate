#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_OFFICE_195'
from pathlib import Path
import subprocess
root=Path('/opt/workmate/overlays/integrated-195-v3');backend=root/'backend'
link=root/'tools/node_modules'
assert not link.exists()
link.symlink_to((backend/'node_modules').resolve(),target_is_directory=True)
subprocess.run(['runuser','-u','workmate','--','/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node',str(root/'tools/qualify-office-integrated-195-v1.mjs')],cwd=backend,check=True)
WM_OFFICE_195
