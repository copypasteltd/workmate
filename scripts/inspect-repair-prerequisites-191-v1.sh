#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_PREREQ_191'
import os,json,subprocess,platform
from pathlib import Path
def run(argv):
 p=subprocess.run(argv,capture_output=True,text=True,timeout=12)
 return {'code':p.returncode,'stdout':p.stdout.strip()[:16000]}
report={'stage':191,'kernel':platform.release(),'architecture':platform.machine()}
report['systemd']=run(['systemctl','show','workmate-api.service','--property=User,Group,WorkingDirectory,NoNewPrivileges,ProtectSystem,PrivateNetwork,RestrictNamespaces,RestrictAddressFamilies,KillMode,ControlGroup'])
report['commands']={name:run(['sh','-c','command -v "$1"','wm-probe',name]) for name in ['gcc','g++','cc','bwrap','chromium','chromium-browser','setpriv','setsid','unshare','nft','systemd-run','chroot','curl']}
report['kernel_settings']={}
for name in ['/proc/sys/kernel/unprivileged_userns_clone','/proc/sys/kernel/apparmor_restrict_unprivileged_userns','/proc/sys/user/max_user_namespaces','/sys/kernel/security/lsm']:
 try:report['kernel_settings'][name]=Path(name).read_text().strip()
 except OSError:report['kernel_settings'][name]=None
report['cfg_file_names']=[]
for base,dirs,files in os.walk('/root/cfg'):
 if len(Path(base).relative_to('/root/cfg').parts)>=2:dirs[:]=[]
 for name in files:
  p=Path(base)/name
  if p.is_file() and not p.is_symlink():report['cfg_file_names'].append(str(p.relative_to('/root/cfg')))
report['cfg_file_names']=sorted(report['cfg_file_names'])[:160]
report['toolchain_directory_names']=sorted(p.name for p in Path('/opt/workmate/toolchains').iterdir())
print(json.dumps(report))
WM_PREREQ_191
