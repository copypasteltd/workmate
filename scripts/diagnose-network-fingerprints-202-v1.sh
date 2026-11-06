#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,subprocess
root=Path('/root/cfg/workmate/integrated-202');baseline=json.loads((root/'network-baseline-v1.json').read_text());observed={}
for name,cmd in [('routes',['ip','-j','route','show','table','all']),('rules',['ip','-j','rule','show']),('iptables',['iptables-save']),('ip6tables',['ip6tables-save'])]:
 try:
  r=subprocess.run(cmd,capture_output=True,check=True,timeout=15);raw=r.stdout;observed[name]={'status':'read','sha256':hashlib.sha256(raw).hexdigest(),'equal':hashlib.sha256(raw).hexdigest()==baseline['commands'][name].get('sha256'),'comments':[s for s in raw.decode().splitlines() if s.startswith('#')],'raw_utf8':raw.decode()}
 except (FileNotFoundError,subprocess.SubprocessError):observed[name]={'status':'unavailable'}
report={'stage':202,'at':datetime.now(timezone.utc).isoformat(),'baseline_at':baseline['at'],'baseline_commands':baseline['commands'],'observed':observed,'file_fingerprints_unchanged':all(hashlib.sha256(Path(p).read_bytes()).hexdigest()==h for p,h in baseline['files'].items()),'network_modifications':False}
p=root/'network-diagnostic-v1.json';assert not p.exists();p.write_text(json.dumps(report,indent=2)+'\n');p.chmod(0o600)
print(json.dumps({**report,'observed':{k:{x:v for x,v in r.items() if x!='raw_utf8'} for k,r in observed.items()}}))
PY
