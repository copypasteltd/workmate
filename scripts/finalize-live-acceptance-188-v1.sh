#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
from datetime import datetime,timezone
import urllib.request,json,subprocess,hashlib
units=['workmate-api.service','workmate-db.service','workmate-lan-proxy.service']
services={u:subprocess.check_output(['systemctl','show',u,'-p','ActiveState','-p','MainPID'],text=True).strip() for u in units}
assert all('ActiveState=active' in v for v in services.values())
ports={}
for label,port,route in [('web',63070,'/'),('admin',63071,'/'),('api_front',63072,'/health/ready'),('api_origin',63073,'/health/ready')]:
 with urllib.request.urlopen('http://127.0.0.1:'+str(port)+route,timeout=10) as r:
  body=r.read();ports[label]={'port':port,'http_status':r.status,'bytes':len(body)}
  if 'api' in label:
   h=json.loads(body);assert h['ok'] and h['ai_ready'] and h['data_mode']=='configured_services';ports[label]['health']=h
subprocess.run(['systemctl','stop','workmate-candidate-188-v7.service'],check=True)
assert subprocess.run(['systemctl','is-active','--quiet','workmate-candidate-188-v7.service']).returncode!=0
cfg=Path('/root/cfg/workmate');assert(cfg/'app.env').is_file() and(cfg/'migration.env').is_file()
folder=cfg/'live-acceptance-188';folder.mkdir(exist_ok=False);folder.chmod(0o700)
note='Stage188 online acceptance: Codex real text mode deployed to real-services-188-v7. Existing credentials remain in app.env, migration.env and encrypted per-model storage; no secrets duplicated into Git. Test mailbox remains enabled by user preference. Actual Web/Extension text and admin CRUD passed. Real image supplier403; missing video/audio/OAuth/SMTP; public edge intermittent; native supplier usage uncertainty retained. See project docs/development/188-live-acceptance.md. This is not a full-product acceptance certificate.\n'
(folder/'deployment-note.txt').write_text(note);(folder/'deployment-note.txt').chmod(0o600)
r={'stage':188,'status':'deployed_with_open_acceptance_gaps','at':datetime.now(timezone.utc).isoformat(),'overlay':'/opt/workmate/overlays/real-services-188-v7/backend','schema_version':161,'services':services,'origin_checks':ports,'candidate_stopped':True,'configuration_files_preserved':True,'plaintext_deployment_note':'/root/cfg/workmate/live-acceptance-188/deployment-note.txt','private_credentials_not_exported':True}
p=cfg/'live-acceptance-188-final-v1.sanitized.json'
with p.open('x')as f:json.dump(r,f,indent=2)
p.chmod(0o600);print(json.dumps(r))
PY
