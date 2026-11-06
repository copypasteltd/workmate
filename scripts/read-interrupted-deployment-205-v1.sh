#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,subprocess,urllib.request
cfg=Path('/root/cfg/workmate');sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
baseline=json.loads((cfg/'integrated-202/network-baseline-v1.json').read_text())
report={'stage':205,'at':datetime.now(timezone.utc).isoformat(),'read_only':True,'network_files_equal':{p:sha(Path(p))==h for p,h in baseline['files'].items()},'services':{u:subprocess.check_output(['systemctl','show',u,'-p','ActiveState','-p','MainPID','-p','NRestarts','-p','WorkingDirectory'],text=True) for u in ['workmate-api.service','workmate-db.service','workmate-lan-proxy.service']},'receipts':{},'paths':{}}
for rel in ['downloads-v1/receipt.json','activation-v1/deployment.sanitized.json']:
 p=cfg/'integrated-205'/rel
 if p.is_file():report['receipts'][rel]=json.loads(p.read_text())
for text in ['/home/carzygod/workmate-downloads-205-v1','/opt/workmate/downloads/releases/20501','/home/carzygod/workmate-upload-205-v1','/opt/workmate/overlays/integrated-205-v1']:
 p=Path(text);report['paths'][text]={'exists':p.exists(),'files':[{ 'name':f.name,'bytes':f.stat().st_size,'sha256':sha(f)} for f in sorted(p.iterdir()) if f.is_file() and not f.is_symlink()] if p.is_dir() else []}
with urllib.request.urlopen('http://127.0.0.1:63073/health/ready',timeout=10) as r:report['health']={'status':r.status,'body':json.load(r)}
working=subprocess.check_output(['systemctl','show','workmate-api.service','-p','WorkingDirectory','--value'],text=True).strip()
node='/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node'
code="import pg from 'pg';const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();try{console.log(JSON.stringify({schema:(await c.query('SELECT count(*)::int count,max(version)::int version FROM schema_migrations')).rows[0],active_tasks:(await c.query(\"SELECT count(*)::int count FROM tasks WHERE status IN ('queued','running')\")).rows[0].count}));}finally{await c.end();}"
report['database_observation']=json.loads(subprocess.check_output([node,'--env-file='+str(cfg/'app.env'),'--input-type=module','-e',code],cwd=working,text=True))
assert all(report['network_files_equal'].values())
print(json.dumps(report))
PY
