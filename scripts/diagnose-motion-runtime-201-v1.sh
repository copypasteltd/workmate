#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import json,os,shutil,subprocess
pid=int(subprocess.check_output(['systemctl','show','workmate-api.service','-p','MainPID','--value'],text=True))
env=dict(part.split(b'=',1) for part in Path(f'/proc/{pid}/environ').read_bytes().split(b'\0') if b'=' in part)
report={'stage':201,'status':'diagnosed','api_pid':pid,'working_directory':subprocess.check_output(['systemctl','show','workmate-api.service','-p','WorkingDirectory','--value'],text=True).strip(),'media_environment':{k:env.get(k.encode(),b'').decode() for k in ['FFMPEG_BIN','FFPROBE_BIN','PATH']},'binaries':[]}
for name in ['ffmpeg','ffprobe']:
 executable=env.get((name.upper()+'_BIN').encode(),name.encode()).decode()
 resolved=shutil.which(executable,path=env.get(b'PATH',b'').decode())
 row={'name':name,'configured':executable,'resolved':resolved,'exists':Path(executable).exists()}
 if resolved:
  p=subprocess.run(['runuser','-u','workmate','--',resolved,'-version'],capture_output=True,text=True,timeout=15)
  row.update(exit_code=p.returncode,version=p.stdout.splitlines()[:1],error=p.stderr[:300])
 report['binaries'].append(row)
print(json.dumps(report))
PY
