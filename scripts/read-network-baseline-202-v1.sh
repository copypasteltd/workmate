#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import hashlib,json,subprocess
from datetime import datetime,timezone
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
files=[Path(p) for p in ['/etc/hosts','/etc/resolv.conf','/etc/nsswitch.conf','/etc/network/interfaces','/etc/ufw/ufw.conf','/etc/ufw/user.rules','/etc/ufw/user6.rules','/etc/nftables.conf','/opt/workmate/nginx/nginx.conf']]
for folder in ['/etc/netplan','/etc/systemd/network','/etc/NetworkManager/system-connections']:
 p=Path(folder)
 if p.is_dir():files += [x for x in p.rglob('*') if x.is_file()]
commands={}
for name,cmd in [('routes',['ip','-j','route','show','table','all']),('rules',['ip','-j','rule','show']),('iptables',['iptables-save']),('ip6tables',['ip6tables-save'])]:
 try:
  r=subprocess.run(cmd,capture_output=True,check=True,timeout=15);commands[name]={'status':'read','sha256':hashlib.sha256(r.stdout).hexdigest()}
 except (FileNotFoundError,subprocess.SubprocessError):commands[name]={'status':'unavailable'}
proxy=Path('/opt/workmate/nginx/nginx.conf');text=proxy.read_text()
selected=[line.strip() for line in text.splitlines() if line.strip().startswith(('location ','root ','alias ','listen ','disable_symlinks '))]
out=Path('/root/cfg/workmate/integrated-202');out.mkdir(mode=0o700,exist_ok=True)
report={'stage':202,'at':datetime.now(timezone.utc).isoformat(),'scope':'Read-only network baseline. No DNS, route, firewall, proxy or tunnel configuration changed. Application deployment must retain these fingerprints.','files':{str(p):sha(p) for p in files if p.is_file()},'commands':commands,'workmate_static_mapping':selected}
p=out/'network-baseline-v1.json';assert not p.exists();p.write_text(json.dumps(report,indent=2)+'\n');p.chmod(0o600);print(json.dumps(report))
PY
