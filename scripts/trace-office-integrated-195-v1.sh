#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_TRACE_195'
from pathlib import Path
import json,os,shutil,subprocess
root=Path('/opt/workmate/overlays/integrated-195-v3/backend');cfg=Path('/root/cfg/workmate/integrated-195');cfg.mkdir(exist_ok=True,mode=0o700)
if not shutil.which('strace'):
 with (cfg/'strace-install.log').open('wb') as log:
  subprocess.run(['apt-get','install','-y','--no-install-recommends','strace'],env={**os.environ,'DEBIAN_FRONTEND':'noninteractive','NEEDRESTART_MODE':'l'},stdout=log,stderr=subprocess.STDOUT,check=True)
source=root/'scripts/diagnose-office-195-v1.mjs';target=root/'scripts/diagnose-office-195-v2.mjs';assert not target.exists();target.write_text(source.read_text().replace('diagnostic-195-v1','diagnostic-195-v2'));target.chmod(0o644)
trace=cfg/'office-controlled-195-v1.strace'
subprocess.run(['strace','-f','-s','160','-e','trace=file,network','-o',str(trace),'runuser','-u','workmate','--','/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node',str(target)],cwd=root,check=True)
errors=[l for l in trace.read_text().splitlines() if 'EACCES' in l or 'EPERM' in l]
print(json.dumps({'denied_operations':errors[-35:],'diagnostic':'controlled artificial document only','trace':str(trace)}))
WM_TRACE_195
