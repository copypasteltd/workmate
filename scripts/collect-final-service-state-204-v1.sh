#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,subprocess
root=Path('/opt/workmate/overlays/integrated-204-v2');cfg=Path('/root/cfg/workmate')
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
original=json.loads((cfg/'integrated-203/static-deployment-v1.json').read_text())
network=json.loads((cfg/'integrated-202/network-baseline-v1.json').read_text())['files']
assert len(network)==9 and all(sha(p)==h for p,h in network.items())
assert all(sha(p)==h for p,h in original['credential_hashes'].items())
services={u:subprocess.check_output(['systemctl','show',u,'-p','ActiveState','-p','MainPID','-p','NRestarts','-p','WorkingDirectory'],text=True) for u in ['workmate-api.service','workmate-db.service','workmate-lan-proxy.service']}
for unit in ['workmate-db.service','workmate-lan-proxy.service']:assert services[unit]==original['services_before'][unit]
assert 'ActiveState=active' in services['workmate-api.service'] and 'WorkingDirectory='+str(root/'backend') in services['workmate-api.service']
assert Path('/opt/workmate/overlays/integrated-201-v1/web/dist').resolve()==root/'web/dist'
manifest=json.loads((root/'manifest.json').read_text());assert manifest['schema_version']==165
assert all((root/r['path']).stat().st_size==r['bytes'] and sha(root/r['path'])==r['sha256'] for r in manifest['files'])
runtime=json.loads((root/'runtime-copy.json').read_text());assert len(runtime)==2
for row in runtime:
 folder=root/'backend/.data'/row['name'];assert folder.is_dir() and not folder.is_symlink()
 assert all((folder/r['path']).stat().st_size==r['bytes'] and sha(folder/r['path'])==r['sha256'] for r in row['files'])
report={'stage':204,'status':'passed','at':datetime.now(timezone.utc).isoformat(),'services':services,'network_configuration_files_equal':9,'credentials_preserved':True,'database_proxy_processes_and_restarts_preserved':True,'application_manifest_files_verified':len(manifest['files']),'native_runtime_real_directories':2,'server_network_writes':False,'scope':'Read-only final application/source/runtime and original network/credential/database/proxy checks. Workmate API changed to qualified204 only; no network service/configuration change.'}
target=cfg/'integrated-204/final-service-state-v1.json';assert not target.exists();target.write_text(json.dumps(report,indent=2)+'\n');target.chmod(0o600);print(json.dumps(report))
PY
