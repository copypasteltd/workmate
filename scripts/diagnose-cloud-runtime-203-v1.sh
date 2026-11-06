#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import json,os,subprocess
root=Path('/opt/workmate/overlays/integrated-202-v2/backend');rows=[]
for name in ['cloud-browser-host-linux','cloud-program-host-linux','runs']:
 p=root/'.data'/name;rows.append({'name':name,'exists':p.exists(),'symlink':p.is_symlink(),'resolved':str(p.resolve())})
units=subprocess.check_output(['systemctl','list-units','--all','--plain','--no-legend','workmate*'],text=True)
details=[]
for line in units.splitlines():
 unit=line.strip().split()[0]
 pid=subprocess.check_output(['systemctl','show',unit,'-p','MainPID','--value'],text=True).strip()
 if not pid.isdigit() or int(pid)==0:continue
 env=Path('/proc/'+pid+'/environ').read_bytes().split(b'\0');data=next((v.decode().split('=',1)[1] for v in env if v.startswith(b'DATA_DIR=')),None)
 details.append({'unit':unit,'pid':int(pid),'data_dir':data,'cwd':os.readlink('/proc/'+pid+'/cwd')})
print(json.dumps({'stage':203,'status':'read_only_runtime_inventory','native_paths':rows,'owned_services':details}))
PY
