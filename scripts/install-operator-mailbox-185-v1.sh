#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json,os,subprocess,base64,urllib.request

cfg=Path('/root/cfg/workmate')
nginx=Path('/opt/workmate/nginx')
source=Path('/home/carzygod/workmate-upload-179/operator-mailbox-185-v1.html')
expected=Path('/home/carzygod/workmate-upload-179/operator-mailbox-185-v1.sha256').read_text().strip()
raw=source.read_bytes()
assert sha256(raw).hexdigest()==expected,'Uploaded mailbox does not match its source digest'
assert b'timestamp(b) - timestamp(a)' in raw and b'setTimeout(load, 5000)' in raw
targets=[nginx/'operator.html',nginx/'mailbox/index.html']
assert all(p.is_file() and not p.is_symlink() for p in targets)
conf=(nginx/'nginx.conf').read_bytes()
assert b'alias /opt/workmate/nginx/mailbox/;' in conf
assert b'alias /var/lib/workmate/state/mailbox/;' in conf
protected=[cfg/'app.env',cfg/'migration.env',cfg/'credentials.txt',cfg/'operator-password.txt',nginx/'operator.htpasswd',nginx/'nginx.conf']
before={str(p):sha256(p.read_bytes()).hexdigest() for p in protected}
units=['workmate-api.service','workmate-db.service','workmate-lan-proxy.service']
def pid(unit):
 return subprocess.check_output(['systemctl','show','-p','MainPID','--value',unit],text=True).strip()
pids={u:pid(u) for u in units}
backup=cfg/'operator-mailbox-185-v1';backup.mkdir(mode=0o700)
for i,p in enumerate(targets):
 dest=backup/('before-'+str(i)+'.html');dest.write_bytes(p.read_bytes());dest.chmod(0o600)
operator=(cfg/'operator-password.txt').read_text().splitlines()
auth='Basic '+base64.b64encode((operator[0]+':'+operator[1]).encode()).decode()
def get(suffix,authenticated=True):
 headers={'Cache-Control':'no-cache'}
 if authenticated:headers['Authorization']=auth
 request=urllib.request.Request('http://127.0.0.1:63071/ops/mailbox/'+suffix,headers=headers)
 try:
  with urllib.request.urlopen(request,timeout=15) as response:return response.status,response.headers,response.read()
 except urllib.error.HTTPError as e:return e.code,e.headers,b''
status,_,_=get('',False);assert status==401,'Mailbox must retain independent access protection'
status,_,listing=get('data/');assert status==200
files=[f for f in json.loads(listing) if f['type']=='file' and f['name'].endswith('.json')]
lexical=sorted(files,key=lambda f:f['mtime'],reverse=True)
actual=sorted(files,key=lambda f:datetime.strptime(f['mtime'],'%a, %d %b %Y %H:%M:%S GMT'),reverse=True)
latest=actual[0] if actual else None
old_rank=next((i+1 for i,f in enumerate(lexical) if f['name']==latest['name']),None) if latest else None
try:
 for p in targets:
  temp=p.with_name(p.name+'.stage185.tmp')
  with temp.open('xb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
  temp.chmod(0o644);os.replace(temp,p)
 status,headers,served=get('')
 assert status==200 and sha256(served).hexdigest()==expected,'Served mailbox differs from the new source'
 assert headers.get('Cache-Control')=='no-store','Mailbox must not be cached'
 assert get('',False)[0]==401 and get('data/',False)[0]==401
 for p,h in before.items():assert sha256(Path(p).read_bytes()).hexdigest()==h
 assert all(pid(u)==pids[u] for u in units),'An owned service restarted unexpectedly'
except BaseException:
 for i,p in enumerate(targets):
  restore=p.with_name(p.name+'.stage185-restore.tmp');restore.write_bytes((backup/('before-'+str(i)+'.html')).read_bytes());restore.chmod(0o644);os.replace(restore,p)
 raise
report={'stage':185,'status':'mailbox_ui_deployed','at':datetime.now(timezone.utc).isoformat(),'source_sha256':expected,
 'prior_message_count':len(files),'prior_latest_rank':old_rank,'prior_latest_id':latest['name'] if latest else None,
 'before_latest_hidden':bool(old_rank and old_rank>30),'protected_configuration_hashes':before,
 'credentials_and_auth_unchanged':True,'nginx_configuration_unchanged':True,'owned_service_pids_unchanged':True,
 'services_restarted':[],'anonymous_ui_status':401,'anonymous_listing_status':401,'local_authenticated_ui_status':status,
 'mailbox_cache_control':headers.get('Cache-Control'),'rollback_directory':str(backup),'runtime_schema_unchanged':161}
with (cfg/'operator-mailbox-185-deployment.sanitized.json').open('x') as f:json.dump(report,f,indent=2)
print(json.dumps(report))
PY
