#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import json,subprocess
show=lambda unit,prop:subprocess.check_output(['systemctl','show',unit,'-p',prop,'--value'],text=True).strip()
unit='workmate-db.service';group=show(unit,'ControlGroup');assert group.startswith('/system.slice/')
executables=[]
for value in (Path('/sys/fs/cgroup')/group.lstrip('/')/'cgroup.procs').read_text().split():
 try:
  exe=Path('/proc')/value/'exe';target=exe.resolve(strict=True)
  if target.name in ['postgres','postmaster']:
   dump=target.parent/'pg_dump';row={'pid':int(value),'server_binary':str(target),'dump_binary':str(dump),'dump_exists':dump.is_file()}
   if dump.is_file():row['dump_version']=subprocess.check_output([str(dump),'--version'],text=True).strip()
   executables.append(row)
 except FileNotFoundError:pass
print(json.dumps({'status':'read_only','database':{'pid':show(unit,'MainPID'),'restarts':show(unit,'NRestarts'),'active':show(unit,'ActiveState')},'api':{'active':show('workmate-api.service','ActiveState'),'root':show('workmate-api.service','WorkingDirectory')},'owned_database_executables':executables,'system_dump_version':subprocess.check_output(['/usr/bin/pg_dump','--version'],text=True).strip(),'network_changes':False}))
PY
