#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import hashlib,json,subprocess
from datetime import datetime,timezone
root=Path('/root/cfg/workmate/integrated-202');baseline=json.loads((root/'network-baseline-v1.json').read_text())
files={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in map(Path,baseline['files'])}
assert files==baseline['files'],'A network configuration fingerprint changed; do not alter it automatically'
commands={}
for name,cmd in [('routes',['ip','-j','route','show','table','all']),('rules',['ip','-j','rule','show']),('iptables',['iptables-save']),('ip6tables',['ip6tables-save'])]:
 try:r=subprocess.run(cmd,capture_output=True,check=True,timeout=15);commands[name]={'status':'read','sha256':hashlib.sha256(r.stdout).hexdigest()}
 except (FileNotFoundError,subprocess.SubprocessError):commands[name]={'status':'unavailable'}
assert commands==baseline['commands'],'A route/firewall snapshot changed; no automatic network modification is authorized'
report={'stage':202,'status':'passed','at':datetime.now(timezone.utc).isoformat(),'files':files,'commands':commands,'network_configuration_unchanged':True,'scope':'DNS/hosts/netplan/firewall/proxy file bytes and live route/rule/firewall snapshots equal the read-only baseline. No server network environment was modified.'}
p=root/'network-preserved-v1.json';assert not p.exists();p.write_text(json.dumps(report,indent=2)+'\n');p.chmod(0o600);print(json.dumps(report))
PY
