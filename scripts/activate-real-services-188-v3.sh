#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,shutil,subprocess,time,urllib.request,re
cfg=Path('/root/cfg/workmate');backup=cfg/'live-188-v3';dest=Path('/opt/workmate/overlays/real-services-188-v1/backend')
prepared=json.loads((backup/'model-preparation-98483795-8d06-4c87-80e1-94336c0f5dcf.sanitized.json').read_text())
assert prepared['status']=='prepared' and prepared['models']['text']['published'] and prepared['models']['text']['state']=='passed'
assert (backup/'database.before.dump').stat().st_size>100000
archive=Path('/home/carzygod/workmate-upload-179/workmate-real-services-188-v1.zip');expected=Path(str(archive)+'.sha256').read_text().split()[0];assert hashlib.sha256(archive.read_bytes()).hexdigest()==expected
original=(cfg/'app.env').read_bytes();mode=re.search(r'''(?m)^DEMO_MODE=(['"]?)true\1$''',original.decode());assert mode, 'Expected unchanged demo configuration before first cutover'
drop=Path('/etc/systemd/system/workmate-api.service.d/zzzzzzzz-real-services-188-v1.conf');assert not drop.exists()
switch=backup/'public-switch-v3';switch.mkdir(mode=0o700);shutil.copy2(cfg/'app.env',switch/'app.env.before')
node='/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node'
before={}
for unit in ['workmate-db.service','workmate-lan-proxy.service']:
 before[unit]=subprocess.check_output(['systemctl','show',unit,'-p','ActiveState','-p','MainPID'],text=True)
idle="import pg from 'pg';const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();try{console.log((await c.query(\"SELECT count(*)::int AS n FROM tasks WHERE status IN ('queued','running','reconciling')\")).rows[0].n);}finally{await c.end();}"
assert subprocess.check_output([node,'--env-file='+str(cfg/'app.env'),'--input-type=module','-e',idle],cwd=dest,text=True).strip()=='0','Keep existing customer work running; do not switch while active'
subprocess.run(['systemctl','stop','workmate-api.service'],check=True)
try:
 updated=re.sub(r'''(?m)^DEMO_MODE=(['"]?)true\1$''',lambda m:'DEMO_MODE='+m[1]+'false'+m[1],original.decode(),count=1);(cfg/'app.env').write_text(updated);(cfg/'app.env').chmod(0o600)
 drop.write_text('[Service]\nWorkingDirectory='+str(dest)+'\nExecStart=\nExecStart='+node+' '+str(dest/'dist/src/server.js')+'\n');drop.chmod(0o644)
 subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','start','workmate-api.service'],check=True)
 health=None
 for _ in range(60):
  try:
   with urllib.request.urlopen('http://127.0.0.1:63073/health/ready',timeout=2) as r:health=json.load(r)
   if health.get('ok') and health.get('ai_ready') and health.get('data_mode')=='configured_services':break
  except Exception:pass
  time.sleep(.5)
 assert health and health.get('ok') and health.get('ai_ready') and health.get('data_mode')=='configured_services'
 for unit,values in before.items():assert subprocess.check_output(['systemctl','show',unit,'-p','ActiveState','-p','MainPID'],text=True)==values
 assert str(dest/'dist/src/server.js') in subprocess.check_output(['systemctl','show','workmate-api.service','-p','ExecStart'],text=True)
 report={'stage':188,'at':datetime.now(timezone.utc).isoformat(),'status':'real_text_services_active','health':health,'archive_sha256':expected,'database_and_proxy_processes_unchanged':True,'backup_complete':True,'email_delivery':'existing protected test mailbox retained by owner preference','image_qualification':'HTTP403; not published','legacy_simulated_records_preserved':True,'overlay':str(dest)}
 with (cfg/'real-services-188-v1.sanitized.json').open('x') as f:json.dump(report,f,indent=2)
 with (cfg/'credentials.txt').open('a') as f:f.write('\n188 REAL-SERVICE ACTIVATION '+datetime.now(timezone.utc).isoformat()+'\nAPI data mode=configured_services; model=gpt-6-luna; reasoning=max\nExisting test user real workspace='+prepared['owner_workspace']['id']+'; credit limit=HKD100000 (no payment/balance fabricated).\nTest inbox remains enabled; image/video/advertising credentials are not qualified.\nFull pre-switch backup: '+str(backup)+'\n')
 (cfg/'credentials.txt').chmod(0o600)
 print(json.dumps(report))
except Exception:
 (cfg/'app.env').write_bytes(original);(cfg/'app.env').chmod(0o600)
 if drop.exists():drop.unlink()
 subprocess.run(['systemctl','daemon-reload'],check=False);subprocess.run(['systemctl','restart','workmate-api.service'],check=False)
 raise
PY
