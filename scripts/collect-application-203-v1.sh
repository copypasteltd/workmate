#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import hashlib,json,subprocess
cfg=Path('/root/cfg/workmate/integrated-203');root=Path('/opt/workmate/overlays/integrated-202-v2/backend');web=Path('/opt/workmate/overlays/integrated-203-v1/web/dist')
report={'stage':203,'status':'collected_actual_application','static':json.loads((cfg/'static-deployment-v1.json').read_text()),'runtime_materialization':json.loads((cfg/'runtime-materialization-v1/receipt.json').read_text()),'downloads':json.loads((cfg/'downloads-v1/receipt.json').read_text())}
rows=json.loads((web/'application-manifest-203.json').read_text())['files'];assert all((web/r['path']).stat().st_size==r['bytes'] and hashlib.sha256((web/r['path']).read_bytes()).hexdigest()==r['sha256'] for r in rows)
report['verified_web_files']=len(rows);report['services']={u:subprocess.check_output(['systemctl','show',u,'-p','ActiveState','-p','MainPID','-p','NRestarts','-p','WorkingDirectory'],text=True) for u in ['workmate-api.service','workmate-db.service','workmate-lan-proxy.service']};assert report['services']==report['static']['services_after']
assert (Path('/opt/workmate/overlays/integrated-201-v1/web/dist')).resolve()==web
report['unchanged_backend_root']=str(root);report['web_static_only_switch']=True;print(json.dumps(report))
PY
