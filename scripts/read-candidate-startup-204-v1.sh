#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import hashlib,json,re,subprocess,urllib.request
cfg=Path('/root/cfg/workmate/integrated-204');state=cfg/'candidate-diagnostics-v1';state.mkdir(mode=0o700)
units=['workmate-api.service','workmate-candidate-integrated-204-v2.service','workmate-db.service','workmate-lan-proxy.service']
services={u:subprocess.check_output(['systemctl','show',u,'-p','ActiveState','-p','SubState','-p','MainPID','-p','NRestarts','-p','WorkingDirectory'],text=True) for u in units}
raw=subprocess.check_output(['journalctl','-u','workmate-candidate-integrated-204-v2.service','-n','80','--no-pager','-o','cat'],stderr=subprocess.STDOUT)
p=state/'candidate.private.log';p.write_bytes(raw);p.chmod(0o600)
text=raw.decode(errors='replace');safe=[]
for line in text.splitlines():
 if re.search(r'Error|ENOENT|EACCES|SCHEMA_|MODULE_|FST_|Cannot|failed|listening|permission|Read-only',line,re.I):
  line=re.sub(r'(?i)(password|api_?key|secret|authorization|cookie)(["\s:=]+)[^,\s}\"]+',r'\1\2<redacted>',line)
  line=re.sub(r'postgres(?:ql)?://[^\s"\']+','<database-url-redacted>',line)
  safe.append(line[:900])
backup=cfg/'activation-v2/before-schema-165.dump'
report={'status':'read_only','services':services,'backup_bytes':backup.stat().st_size if backup.exists() else None,'migration_completed_log':(cfg/'activation-v2/migration.log').exists(),'candidate_journal_sha256':hashlib.sha256(raw).hexdigest(),'candidate_messages':safe[-18:],'network_changes':False}
with urllib.request.urlopen('http://127.0.0.1:63073/health/ready',timeout=5) as r:report['current_health']=json.load(r)
print(json.dumps(report))
PY
