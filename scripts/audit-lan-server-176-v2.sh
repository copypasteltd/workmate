#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import os,json,hashlib,subprocess,urllib.request,stat
from datetime import datetime,timezone
cfg=Path('/root/cfg/workmate');before=json.loads((cfg/'preservation-before.sanitized.json').read_bytes())
files=[];services=[]
for row in before['cfg']:
 p=Path(row['path']);raw=p.read_bytes() if p.is_file() else b''
 mode=oct(stat.S_IMODE(p.stat().st_mode)) if p.exists() else None
 files.append({'path':str(p),'sha256_unchanged':p.is_file() and hashlib.sha256(raw).hexdigest()==row.get('sha256'),'mode_after':mode,'mode_before':row.get('mode')})
for row in before['services']:
 props=dict(x.split('=',1) for x in subprocess.check_output(['systemctl','show',row['unit'],'-p','ActiveState','-p','MainPID'],text=True).splitlines() if '=' in x)
 services.append({'unit':row['unit'],'active':props['ActiveState']=='active','pid_unchanged':props['MainPID']==row['MainPID'],'pid_before':row['MainPID'],'pid_after':props['MainPID']})
owned=[]
for unit in ['workmate-db.service','workmate-api.service','workmate-lan-proxy.service']:
 props=dict(x.split('=',1) for x in subprocess.check_output(['systemctl','show',unit,'-p','ActiveState','-p','MainPID'],text=True).splitlines() if '=' in x)
 enabled=subprocess.check_output(['systemctl','is-enabled',unit],text=True).strip()
 owned.append({'unit':unit,**props,'enabled':enabled});assert props['ActiveState']=='active' and enabled=='enabled'
credential_files=['credentials.json','credentials.txt','app.env','migration.env','operator-password.txt','admin-enrolment.json','qa-login-context.json']
credentials=[]
for name in credential_files:
 p=cfg/name;st=p.stat();assert stat.S_IMODE(st.st_mode)==0o600 and st.st_uid==0
 credentials.append({'file':name,'plaintext_present':st.st_size>0,'owner':'root','mode':'0600'})
health=[]
for port in [63070,63071,63072]:
 with urllib.request.urlopen('http://192.168.31.20:'+str(port)+'/health/ready',timeout=10) as r:
  body=json.load(r);assert r.status==200 and body['kernel']=='codex' and body['data_mode']=='simulated';health.append({'port':port,'status':r.status,**body})
listeners=subprocess.check_output(['ss','-ltnp'],text=True)
for port in [63073,63074]:
 lines=[s for s in listeners.splitlines() if ':'+str(port)+' ' in s];assert lines and all('127.0.0.1:'+str(port) in s for s in lines)
downloads=[]
for name in ['workmate-v0.1.3-complete.zip','workmate-lan-http-176-v2.zip','CopyPaste-0.7.1-x64-Portable.exe','CopyPaste-0.7.1-x64-Setup.exe']:
 req=urllib.request.Request('http://192.168.31.20:63070/downloads/'+name,method='HEAD')
 with urllib.request.urlopen(req,timeout=10) as r:assert r.status==200;downloads.append({'file':name,'status':r.status,'bytes':int(r.headers['Content-Length'])})
safe={'stage':176,'at':datetime.now(timezone.utc).isoformat(),'foreign_cfg':files,'foreign_services':services,'owned_services':owned,'credentials':credentials,'health':health,'downloads':downloads,'private_ports_loopback_only':True,'virtualization_invoked':False}
safe['foreign_cfg_unchanged']=all(x['sha256_unchanged'] for x in files)
safe['foreign_services_active']=all(x['active'] for x in services)
safe['foreign_services_pid_unchanged']=all(x['pid_unchanged'] for x in services)
dest=cfg/'audit-after-v2.sanitized.json'
with dest.open('x') as f:json.dump(safe,f,indent=2)
print(json.dumps({'phase':'post_deployment_audit','foreign_config_files':len(files),'foreign_cfg_unchanged':safe['foreign_cfg_unchanged'],'foreign_running_services':len(services),'foreign_services_active':safe['foreign_services_active'],'foreign_services_pid_unchanged':safe['foreign_services_pid_unchanged'],'owned_services':len(owned),'credentials_mode':'root 0600','private_ports_loopback_only':True}))
assert safe['foreign_cfg_unchanged'] and safe['foreign_services_active']
PY
