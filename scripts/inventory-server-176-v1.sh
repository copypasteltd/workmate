#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
import os,json,socket,subprocess,hashlib,stat,datetime
from pathlib import Path
def command(argv):
 p=subprocess.run(argv,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 return {'exit_code':p.returncode,'output':p.stdout[:24000]}
cfg=Path('/root/cfg'); files=[]
if cfg.exists():
 for p in sorted(cfg.rglob('*')):
  if len(p.relative_to(cfg).parts)>3 or p.is_symlink() or not p.is_file():continue
  st=p.stat(); row={'path':str(p),'mode':oct(stat.S_IMODE(st.st_mode)),'bytes':st.st_size}
  if st.st_size<=2000000:
   raw=p.read_bytes();row['sha256']=hashlib.sha256(raw).hexdigest()
   if p.suffix in ['.env','.conf','.cfg','.ini','.txt','.json','.yaml','.yml'] or 'key' in p.name.lower():
    import re
    row['setting_names']=sorted(set(re.findall(r'(?m)^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*[:=]',raw.decode('utf-8',errors='ignore'))))[:100]
  files.append(row)
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'uid':os.geteuid(),'hostname':socket.gethostname(),'existing_cfg_directory':cfg.exists(),'existing_cfg_files':files,
 'os':command(['cat','/etc/os-release']),'arch':command(['uname','-m']),
 'resources':command(['sh','-c','nproc; free -h; df -h / /opt /root']),
 'listeners':command(['ss','-lntup']),
 'services':command(['systemctl','--type=service','--state=running','--no-pager','--plain']),
 'tool_paths':command(['sh','-c','for x in node npm python3 psql postgres nginx caddy git curl tar unzip systemctl; do command -v "$x" || true; done']),
 'versions':command(['sh','-c','node --version 2>/dev/null || true; npm --version 2>/dev/null || true; psql --version 2>/dev/null || true']),
 'firewall':command(['sh','-c','if command -v ufw >/dev/null; then ufw status; fi']),
 'configuration_values_disclosed':False,'mutations':False}
print(json.dumps(result,ensure_ascii=False,indent=2))
PY
