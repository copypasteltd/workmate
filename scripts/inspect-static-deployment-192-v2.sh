#!/usr/bin/env bash
set -euo pipefail
python3 - <<'WM_STATIC'
import json,re,subprocess
from pathlib import Path
unit='workmate-lan-proxy.service'
exec_start=subprocess.check_output(['systemctl','show',unit,'-p','ExecStart','--value'],text=True)
paths=re.findall(r'/[^\s;{}]+\.(?:mjs|js|py)',exec_start)
report={'proxy_python_paths':paths,'proxy_working_directory':subprocess.check_output(['systemctl','show',unit,'-p','WorkingDirectory','--value'],text=True).strip(),'static_links':[]}
for base in ['/opt/workmate/current','/opt/workmate/web','/opt/workmate/admin']:
 p=Path(base);report['static_links'].append({'path':base,'exists':p.exists(),'resolved':str(p.resolve())})
for name in paths:
 p=Path(name)
 if p.is_file():
  report.setdefault('proxy_relevant_source',[]).extend([line for line in p.read_text().splitlines() if any(k in line for k in ['63070','63071','root_dir','WEB_ROOT','ADMIN_ROOT','dist','release','current','directory=','self.directory','STATIC'])][:55])
print(json.dumps(report))
WM_STATIC
