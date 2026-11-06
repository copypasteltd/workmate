#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,subprocess
cfg=Path('/root/cfg/workmate/integrated-203');static=json.loads((cfg/'static-deployment-v1.json').read_text())
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
network=json.loads(Path('/root/cfg/workmate/integrated-202/network-baseline-v1.json').read_text())['files']
assert len(network)==9 and all(sha(p)==h for p,h in network.items())
assert all(sha(p)==h for p,h in static['credential_hashes'].items())
services={u:subprocess.check_output(['systemctl','show',u,'-p','ActiveState','-p','MainPID','-p','NRestarts','-p','WorkingDirectory'],text=True) for u in ['workmate-api.service','workmate-db.service','workmate-lan-proxy.service']}
assert services==static['services_before']==static['services_after']
web=Path(static['static_root']);assert Path('/opt/workmate/overlays/integrated-201-v1/web/dist').resolve()==web
files=json.loads((web/'application-manifest-203.json').read_text())['files']
assert len(files)==42 and all((web/f['path']).stat().st_size==f['bytes'] and sha(web/f['path'])==f['sha256'] for f in files)
material=json.loads((cfg/'runtime-materialization-v1/receipt.json').read_text());backend=Path('/opt/workmate/overlays/integrated-202-v2/backend')
for item in material['items']:
 folder=backend/'.data'/item['name'];assert folder.is_dir() and not folder.is_symlink()
 assert all(sha(folder/f['path'])==f['sha256'] for f in item['files'])
print(json.dumps({'stage':203,'status':'passed','at':datetime.now(timezone.utc).isoformat(),'services':services,'network_configuration_files_equal':9,'credentials_preserved':True,'same_api_database_proxy_pids':True,'verified_web_files':42,'owned_native_runtime_real_directories':2,'server_network_writes':False,'scope':'Final read-only check after real role trials. Network files, original credential hashes and API/database/proxy PIDs/restarts remain identical; application files remain exact. Live rules retain their separately recorded publication check; no networking or service configuration changes were made.'}))
PY
