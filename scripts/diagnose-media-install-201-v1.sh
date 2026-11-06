#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import json,re,subprocess
root=Path('/root/cfg/workmate/integrated-201/media-runtime-v1')
logs={p.name:re.sub(r'(https?://)[^\s/@]+:[^\s/@]+@',r'\1[redacted]@',p.read_text()[-6000:]) for p in root.glob('*.log')}
print(json.dumps({'stage':201,'logs':logs,'apt_policy':subprocess.check_output(['apt-cache','policy','ffmpeg'],text=True),'toolchain_dirs':[p.name for p in Path('/opt/workmate/toolchains').iterdir()]}))
PY
