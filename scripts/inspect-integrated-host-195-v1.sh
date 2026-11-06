#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import json,subprocess,hashlib,shutil,os,re
units={}
for unit in ['workmate-api.service','workmate-db.service','workmate-lan-proxy.service']:
 raw=subprocess.check_output(['systemctl','show',unit,'-p','User','-p','MainPID','-p','ActiveState','-p','WorkingDirectory','-p','ExecStart','-p','EnvironmentFiles'],text=True)
 units[unit]=raw.splitlines()
pid=int(subprocess.check_output(['systemctl','show','workmate-api.service','-p','MainPID','--value'],text=True))
proc=Path('/proc')/str(pid)
identity=[line for line in (proc/'status').read_text().splitlines() if line.startswith(('Uid:','NoNewPrivs:'))]
cfg=Path('/root/cfg/workmate')
secrets={name:hashlib.sha256((cfg/name).read_bytes()).hexdigest() for name in ['app.env','migration.env']}
config=Path('/opt/workmate/nginx/nginx.conf');nginx=config.read_text()
print(json.dumps({'units':units,'api_executable':os.readlink(proc/'exe'),'api_cwd':os.readlink(proc/'cwd'),'api_identity':identity,
 'nginx_sha256':hashlib.sha256(config.read_bytes()).hexdigest(),'static_roots':re.findall(r'root\s+([^;]+);',nginx),
 'secret_hashes':secrets,'tools':{name:shutil.which(name) for name in ['cc','soffice','apt-get','node','sudo']},
 'office_candidates':[str(p) for p in [Path('/usr/lib/libreoffice/program/soffice.bin'),Path('/usr/bin/soffice')] if p.exists()],
 'system':subprocess.check_output(['uname','-sr'],text=True).strip(),'free_bytes':shutil.disk_usage('/opt/workmate').free}))
PY
