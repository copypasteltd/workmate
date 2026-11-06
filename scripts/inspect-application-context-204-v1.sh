#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import json,shutil,subprocess
service=lambda name:{p:subprocess.check_output(['systemctl','show',name,'-p',p,'--value'],text=True).strip() for p in ['WorkingDirectory','MainPID','NRestarts','ActiveState']}
root=Path(subprocess.check_output(['systemctl','show','workmate-api.service','-p','WorkingDirectory','--value'],text=True).strip())
data={p.name:{'link':p.is_symlink(),'resolved':str(p.resolve())} for p in (root/'.data').iterdir() if p.name in ['cloud-program-host','cloud-browser','native-cloud-programs','document-preview']}
print(json.dumps({'services':{n:service(n) for n in ['workmate-api.service','workmate-db.service','workmate-lan-proxy.service']},'runtime_paths':data,'pg_dump':shutil.which('pg_dump'),'pg_dump_candidates':[str(p) for p in Path('/usr/lib/postgresql').glob('*/bin/pg_dump')],'web_static':str(Path('/opt/workmate/overlays/integrated-201-v1/web/dist').resolve())}))
PY
