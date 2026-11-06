#!/usr/bin/env bash
set -euo pipefail
install -d -m 700 /root/cfg/workmate/integrated-195
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=l
apt-get update > /root/cfg/workmate/integrated-195/apt-update.log 2>&1
apt-get install -y --no-install-recommends libreoffice-writer libreoffice-calc libreoffice-impress fonts-noto-cjk > /root/cfg/workmate/integrated-195/apt-office.log 2>&1
python3 - <<'PY'
import json,subprocess,ctypes
from pathlib import Path
packages=['libreoffice-writer','libreoffice-calc','libreoffice-impress','fonts-noto-cjk']
versions=subprocess.check_output(['dpkg-query','-W','-f=${Package} ${Version}\n',*packages],text=True).splitlines()
abi=ctypes.CDLL(None,use_errno=True).syscall(444,0,0,1)
result={'prepared':True,'packages':versions,'landlock_abi':abi,'virtualization_used':False,
 'api_state':subprocess.check_output(['systemctl','is-active','workmate-api.service'],text=True).strip(),
 'db_state':subprocess.check_output(['systemctl','is-active','workmate-db.service'],text=True).strip()}
Path('/root/cfg/workmate/integrated-195/office-install.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
PY
