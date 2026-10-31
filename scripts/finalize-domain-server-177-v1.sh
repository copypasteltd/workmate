#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import json,shutil,hashlib,subprocess,urllib.request,urllib.error,stat
from datetime import datetime,timezone
cfg=Path('/root/cfg/workmate');backup=cfg/'domains-177-backup';upload=Path('/home/carzygod/workmate-upload-177')
guide=upload/'domains-177-guide.md';assert guide.is_file()
old_guide=cfg/'DEPLOYMENT-README.md';shutil.copy2(old_guide,backup/'DEPLOYMENT-README.md')
shutil.copy2(cfg/'credentials.txt',backup/'credentials.txt')
text=(cfg/'credentials.txt').read_text()
for a,b in [('http://192.168.31.20:63070','https://agent.copypaste.hk'),('http://192.168.31.20:63071','https://agent-dashboard.copypaste.hk'),('http://192.168.31.20:63072','https://ai-api.copypaste.hk')]:text=text.replace(a,b)
text+='\n\n# Public domain deployment / 正式域名\nWeb: https://agent.copypaste.hk\nAdmin: https://agent-dashboard.copypaste.hk\nAPI: https://ai-api.copypaste.hk\nMailbox: https://agent-dashboard.copypaste.hk/ops/mailbox/\nZeroTier upstream: 192.168.196.204:63070 / 63071 / 63072\nAll existing credentials are unchanged. External providers remain synthetic.\n'
(cfg/'credentials.txt').write_text(text);(cfg/'credentials.txt').chmod(0o600)
shutil.copyfile(guide,old_guide);old_guide.chmod(0o600)
before=json.loads((backup/'preservation-before.sanitized.json').read_bytes())
for row in before['foreign_cfg']:assert hashlib.sha256(Path(row['path']).read_bytes()).hexdigest()==row['sha256']
for row in before['foreign_services']:
 props=dict(x.split('=',1) for x in subprocess.check_output(['systemctl','show',row['unit'],'-p','ActiveState','-p','MainPID'],text=True).splitlines() if '=' in x)
 assert props=={k:row[k] for k in props},'Unrelated service changed; investigate before claiming preservation'
for name in ['credentials.json','credentials.txt','app.env','migration.env','operator-password.txt','admin-enrolment.json','qa-login-context.json','DEPLOYMENT-README.md']:
 st=(cfg/name).stat();assert stat.S_IMODE(st.st_mode)==0o600 and st.st_uid==0
assert stat.S_IMODE(cfg.stat().st_mode)==0o700
assert (cfg/'credentials.json').read_bytes() and (cfg/'migration.env').read_bytes()
for unit in ['workmate-db.service','workmate-api.service','workmate-lan-proxy.service']:
 assert subprocess.check_output(['systemctl','is-active',unit],text=True).strip()=='active'
 assert subprocess.check_output(['systemctl','is-enabled',unit],text=True).strip()=='enabled'
UA={'User-Agent':'Mozilla/5.0','Cache-Control':'no-cache'}
checks=[]
for origin in ['https://agent.copypaste.hk','https://agent-dashboard.copypaste.hk','https://ai-api.copypaste.hk']:
 with urllib.request.urlopen(urllib.request.Request(origin+'/health/ready',headers=UA),timeout=30) as r:
  h=json.load(r);assert r.status==200 and h['data_mode']=='simulated' and h['kernel']=='codex'
 checks.append({'origin':origin,'status':200,'kernel':h['kernel'],'mode':h['data_mode']})
cors=[]
for origin in ['https://agent.copypaste.hk','https://agent-dashboard.copypaste.hk','chrome-extension://fffkcnmfdhahlnifgdilabheppkgnlok']:
 req=urllib.request.Request('https://ai-api.copypaste.hk/v1/auth/token',method='OPTIONS',headers={**UA,'Origin':origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'Content-Type,Authorization,Idempotency-Key'})
 with urllib.request.urlopen(req,timeout=30) as r:assert r.status==204 and r.headers['Access-Control-Allow-Origin']==origin
 cors.append({'origin':origin,'status':204})
try:
 urllib.request.urlopen(urllib.request.Request('https://ai-api.copypaste.hk/v1/auth/challenges',method='POST',data=b'{}',headers={**UA,'Origin':'https://unregistered.invalid','Content-Type':'application/json'}),timeout=30)
 raise AssertionError('Unregistered origin was accepted')
except urllib.error.HTTPError as e:assert e.code==403 and json.load(e)['error']['code']=='ORIGIN_DENIED'
client_manifest=json.loads((Path('/opt/workmate/downloads')/'workmate-domain-clients-177.json').read_bytes())
downloads=[]
for row in client_manifest['files']:
 with urllib.request.urlopen(urllib.request.Request('https://agent.copypaste.hk/downloads/'+row['file'],method='HEAD',headers=UA),timeout=30) as r:
  assert r.status==200 and int(r.headers['Content-Length'])==row['bytes'];downloads.append({'file':row['file'],'status':r.status,'bytes':row['bytes'],'sha256':row['sha256']})
listeners=subprocess.check_output(['ss','-ltnp'],text=True)
for port in [63073,63074]:
 lines=[s for s in listeners.splitlines() if ':'+str(port)+' ' in s];assert lines and all('127.0.0.1:'+str(port) in s for s in lines)
safe={'stage':177,'at':datetime.now(timezone.utc).isoformat(),'status':'deployed_and_qualified','health':checks,'cors':cors,'unregistered_origin_denied':True,'downloads':downloads,'foreign_config_count':len(before['foreign_cfg']),'foreign_service_count':len(before['foreign_services']),'foreign_configuration_bytes_unchanged':True,'foreign_service_pids_unchanged':True,'credentials_retained':True,'credentials_mode':'root 0600','private_ports_loopback_only':True,'virtualization_invoked':False,'operator_guide':str(old_guide)}
with (cfg/'domains-177-final.sanitized.json').open('x') as f:json.dump(safe,f,indent=2)
print(json.dumps({'stage':177,'status':safe['status'],'public_health_checks':len(checks),'registered_origin_checks':len(cors),'unregistered_origin_denied':True,'public_downloads':len(downloads),'foreign_configs_preserved':len(before['foreign_cfg']),'foreign_services_preserved':len(before['foreign_services'])}))
PY
