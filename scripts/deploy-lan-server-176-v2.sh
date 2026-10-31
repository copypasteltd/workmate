#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
import os,sys,json,hashlib,secrets,subprocess,urllib.request,tarfile,zipfile,shutil,time,pwd,grp,stat,crypt,re
from pathlib import Path
from datetime import datetime,timezone

BASE=Path('/opt/workmate'); CFG=Path('/root/cfg/workmate'); DATA=Path('/var/lib/workmate')
RELEASE=BASE/'releases/v0.1.3'; UPLOAD=Path('/home/carzygod/workmate-upload-176/workmate-v0.1.3-complete.zip')
ARCHIVE_SHA='cdb87da0ce9a74150ee6016d4263e1b0ce2b0c5f905effc21ce6a033c18b56e7'
NODE_VERSION='v24.22.2'; NODE_NAME='node-'+NODE_VERSION+'-linux-x64'
NODE_ROOT=BASE/'toolchains'/NODE_NAME; NODE=NODE_ROOT/'bin/node'
ORIGIN='http://192.168.31.20'; PORTS={'web':63070,'admin':63071,'api':63072,'backend_loopback':63073,'database_loopback':63074}
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(4*1024*1024),b''):h.update(b)
 return h.hexdigest()
def write(p,text,mode=0o600,existing_equal=True):
 p.parent.mkdir(parents=True,exist_ok=True)
 raw=text.encode() if isinstance(text,str) else text
 if p.exists():
  assert existing_equal and p.read_bytes()==raw,'Existing file preserved: '+str(p)
  return
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,mode)
 with os.fdopen(fd,'wb') as f:f.write(raw)
def jsonwrite(p,v,mode=0o600):write(p,json.dumps(v,ensure_ascii=False,indent=2)+'\n',mode)
def phase(s,**kw):print(json.dumps({'phase':s,**kw}),flush=True)
def command(args,env=None,cwd=None,user=None,timeout=1800,input=None):
 with (CFG/'installation.log').open('ab') as log:
  p=subprocess.run(args,env=env,cwd=cwd,user=user,group=user,stdout=log,stderr=log,timeout=timeout,input=input)
 if p.returncode:
  print(json.dumps({'phase':'failed','command':args[:3],'log':'/root/cfg/workmate/installation.log','exit_code':p.returncode}),flush=True)
  raise RuntimeError('Owned deployment command failed; original log retained')
 return p
assert os.geteuid()==0
assert UPLOAD.is_file() and digest(UPLOAD)==ARCHIVE_SHA
CFG.mkdir(mode=0o700,parents=True,exist_ok=True)
marker=CFG/'deployment-owner.json'
identity={'product':'Workmate','stage':176,'root':str(BASE),'data':str(DATA),'release':'v0.1.3','archive_sha256':ARCHIVE_SHA}
if not marker.exists():
 assert not BASE.exists() and not DATA.exists(),'Existing Workmate path preserved; inspect before adopting'
 assert not subprocess.run(['id','workmate'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0,'Existing user preserved'
 import socket
 for port in PORTS.values():
  with socket.socket() as s:s.bind(('0.0.0.0',port))
 jsonwrite(marker,identity)
else:assert json.loads(marker.read_bytes())==identity

# Record foreign config bytes, services and listener owners before installing anything.
preservation=CFG/'preservation-before.sanitized.json'
if not preservation.exists():
 old=json.loads((CFG/'inventory-before.sanitized.json').read_bytes())
 units=[]
 names=subprocess.check_output(['systemctl','list-units','--type=service','--state=running','--no-legend','--plain'],text=True).splitlines()
 for line in names:
  name=line.split()[0]
  if name.startswith('workmate-'):continue
  props=subprocess.check_output(['systemctl','show',name,'-p','MainPID','-p','ActiveState'],text=True)
  units.append({'unit':name,**dict(x.split('=',1) for x in props.splitlines() if '=' in x)})
 jsonwrite(preservation,{'cfg':[r for r in old['existing_cfg_files'] if not r['path'].startswith(str(CFG)+'/')], 'services':units,'listeners':old['listeners']['output'],'at':datetime.now(timezone.utc).isoformat()})

if subprocess.run(['id','workmate'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:
 command(['useradd','--system','--user-group','--home-dir',str(DATA),'--shell','/usr/sbin/nologin','workmate'])
account=pwd.getpwnam('workmate'); assert account.pw_dir==str(DATA)
for p in [BASE,BASE/'toolchains',BASE/'downloads',RELEASE,DATA,DATA/'state',DATA/'run',Path('/var/log/workmate'),Path('/var/cache/workmate')]:
 p.mkdir(parents=True,exist_ok=True);os.chown(p,account.pw_uid,account.pw_gid)
phase('independent_paths_and_preservation_ready')

if not NODE.exists():
 sums=urllib.request.urlopen('https://nodejs.org/dist/'+NODE_VERSION+'/SHASUMS256.txt',timeout=40).read().decode()
 name=NODE_NAME+'.tar.xz'; expected=next(line.split()[0] for line in sums.splitlines() if line.split()[-1]==name)
 archive=BASE/'toolchains'/name
 if not archive.exists():urllib.request.urlretrieve('https://nodejs.org/dist/'+NODE_VERSION+'/'+name,archive)
 assert digest(archive)==expected
 with tarfile.open(archive) as z:
  for m in z.getmembers():assert (BASE/'toolchains'/m.name).resolve().is_relative_to((BASE/'toolchains').resolve())
  z.extractall(BASE/'toolchains')
 jsonwrite(CFG/'node-runtime.json',{'version':NODE_VERSION,'url':'https://nodejs.org/dist/'+NODE_VERSION+'/'+name,'sha256':expected})
assert subprocess.check_output([str(NODE),'--version'],text=True).strip()==NODE_VERSION
env={**os.environ,'PATH':str(NODE_ROOT/'bin')+':'+os.environ['PATH'],'HOME':str(DATA),'npm_config_cache':'/var/cache/workmate/npm'}
phase('private_node_ready',version=NODE_VERSION)

complete=BASE/'downloads/workmate-v0.1.3-complete.zip'
if not complete.exists():shutil.copyfile(UPLOAD,complete)
assert digest(complete)==ARCHIVE_SHA
os.chmod(complete,0o644)
write(complete.with_suffix('.zip.sha256'),ARCHIVE_SHA+'  '+complete.name+'\n',0o644)
outer_prefix='workmate-v0.1.3/'
with zipfile.ZipFile(complete) as outer:
 manifest=json.loads(outer.read(outer_prefix+'release-manifest.json'))
 assert manifest['release']=='v0.1.3' and manifest['schema_version']==156
 for suffix,target in [('backend',RELEASE/'backend'),('web',RELEASE/'web'),('admin',RELEASE/'admin'),('extension',RELEASE/'extension'),('buildable-sources',BASE/'sources')]:
  name='workmate-v0.1.3-'+suffix+'.zip'; saved=BASE/'downloads'/name
  if not saved.exists():
   with outer.open(outer_prefix+name) as src,saved.open('xb') as dest:shutil.copyfileobj(src,dest)
  assert digest(saved)==next(a['sha256'] for a in manifest['artifacts'] if a['file']==name)
  ready=target/('.archive-'+suffix+'.sha256')
  if not ready.exists():
   target.mkdir(parents=True,exist_ok=True)
   with zipfile.ZipFile(saved) as z:
    for item in z.infolist():
     dest=target/item.filename;assert dest.resolve().is_relative_to(target.resolve())
     if item.is_dir():dest.mkdir(parents=True,exist_ok=True);continue
     dest.parent.mkdir(parents=True,exist_ok=True)
     raw=z.read(item)
     if dest.exists():assert dest.read_bytes()==raw
     else:dest.write_bytes(raw)
   write(ready,digest(saved)+'\n',0o644)
  for path in [saved]:os.chmod(path,0o644)
 for suffix in ['Setup','Portable']:
  name='CopyPaste-0.7.1-x64-'+suffix+'.exe'; target=BASE/'downloads'/name
  if not target.exists():
   # Seekable temporary member retains the frozen original Windows archive.
   windows=RELEASE/'windows-distribution.zip'
   if not windows.exists():
    with outer.open(outer_prefix+'workmate-v0.1.3-windows-x64-unsigned.zip') as src,windows.open('xb') as dst:shutil.copyfileobj(src,dst)
   with zipfile.ZipFile(windows) as z:
    with z.open('installers/'+name) as src,target.open('xb') as dst:shutil.copyfileobj(src,dst)
   os.chmod(target,0o644)

APP=RELEASE/'backend/copypaste-platform'
command(['chown','-R','workmate:workmate',str(RELEASE),str(BASE/'sources'),str(DATA),'/var/log/workmate','/var/cache/workmate'])
state=APP/'.data'
if not state.exists():state.symlink_to(DATA/'state',target_is_directory=True)
assert state.resolve()==(DATA/'state').resolve()
current=BASE/'current'
if not current.exists():current.symlink_to(RELEASE,target_is_directory=True)
assert current.resolve()==RELEASE.resolve()
phase('frozen_server_and_full_sources_extracted')

if not (APP/'node_modules/.package-lock.json').exists():
 phase('installing_locked_backend_dependencies')
 command([str(NODE),str(NODE_ROOT/'lib/node_modules/npm/bin/npm-cli.js'),'ci','--omit=dev','--no-audit','--no-fund'],env=env,cwd=APP,user='workmate')
codex=BASE/'toolchains/codex'
codex.mkdir(exist_ok=True);os.chown(codex,account.pw_uid,account.pw_gid)
if not (codex/'node_modules/.bin/codex').exists():
 phase('installing_pinned_linux_codex')
 command([str(NODE),str(NODE_ROOT/'lib/node_modules/npm/bin/npm-cli.js'),'install','--prefix',str(codex),'--no-save','--no-audit','--no-fund','@openai/codex@0.163.0-alpha.11'],env=env,user='workmate')
CODEX=codex/'node_modules/.bin/codex'
assert subprocess.check_output([str(CODEX),'--version'],env=env,text=True).strip()=='codex-cli 0.163.0-alpha.11'
PG=APP/'node_modules/@embedded-postgres/linux-x64/native/bin'
assert (PG/'postgres').exists() and (PG/'initdb').exists()
lib=PG.parent/'lib';env['LD_LIBRARY_PATH']=str(lib)
phase('native_codex_and_postgres_ready')

credentials=CFG/'credentials.json'
if not credentials.exists():
 creds={'release':'v0.1.3','mode':'authorized_synthetic_lan_http','server':'192.168.31.20','ports':PORTS,'database':'copypaste',
  'database_users':{k:secrets.token_hex(24) for k in ['cp_owner','cp_app','cp_control','cp_queue']},'master_key':secrets.token_hex(32),
  'operator_username':'workmate-operator','operator_password':secrets.token_urlsafe(24),'admin_email':'admin@workmate.local',
  'login':'Email OTP from the protected test mailbox plus independent admin TOTP. No shared application password.'}
 jsonwrite(credentials,creds)
else:creds=json.loads(credentials.read_bytes())
assert creds['ports']==PORTS
common={'NODE_ENV':'development','HOST':'127.0.0.1','PORT':str(PORTS['backend_loopback']),'TRUSTED_PROXIES':'127.0.0.1,::1',
 'WEB_ORIGIN':ORIGIN+':63070','ADMIN_ORIGIN':ORIGIN+':63071','API_ORIGIN':ORIGIN+':63072','MASTER_KEY':creds['master_key'],
 'DATA_DIR':str(DATA/'state'),'DEV_MAILBOX':'true','DEMO_MODE':'true','CODEX_BIN':str(CODEX),'CODEX_VERSION':'0.163.0-alpha.11',
 'WORKER_ENABLED':'true','WORKER_CONCURRENCY':'2','EXTENSION_ID':'fffkcnmfdhahlnifgdilabheppkgnlok','HOME':str(DATA),'PATH':env['PATH']}
for key,role in [('DATABASE_URL','cp_app'),('CONTROL_DATABASE_URL','cp_control'),('QUEUE_DATABASE_URL','cp_queue')]:
 common[key]='postgresql://'+role+':'+creds['database_users'][role]+'@127.0.0.1:63074/copypaste'
owner_url='postgresql://cp_owner:'+creds['database_users']['cp_owner']+'@127.0.0.1:63074/copypaste'
def dotenv(values):return ''.join(k+'='+json.dumps(v)+'\n' for k,v in values.items())
write(CFG/'app.env',dotenv(common))
write(CFG/'migration.env',dotenv({'OWNER_DATABASE_URL':owner_url}))
write(CFG/'operator-password.txt',creds['operator_username']+'\n'+creds['operator_password']+'\n')
mailbox=DATA/'state/mailbox';mailbox.mkdir(exist_ok=True);os.chown(mailbox,account.pw_uid,account.pw_gid)
pgdata=DATA/'postgres'
if not (pgdata/'PG_VERSION').exists():
 password_file=DATA/'bootstrap-db-password';write(password_file,creds['database_users']['cp_owner']+'\n');os.chown(password_file,account.pw_uid,account.pw_gid)
 try:command([str(PG/'initdb'),'-D',str(pgdata),'--username=cp_owner','--pwfile='+str(password_file),'--auth-local=scram-sha-256','--auth-host=scram-sha-256','--locale=C','--encoding=UTF8'],env=env,user='workmate')
 finally:password_file.unlink()
 conf=pgdata/'postgresql.conf'
 with conf.open('a') as f:f.write("\n# Workmate isolated native cluster\nlisten_addresses='127.0.0.1'\nport=63074\nunix_socket_directories='/var/lib/workmate/run'\nmax_connections=80\nshared_buffers='128MB'\n")
unit='''[Unit]
Description=Workmate isolated native PostgreSQL
After=network.target
[Service]
Type=simple
User=workmate
Group=workmate
Environment=LD_LIBRARY_PATH={lib}
ExecStart={pg}/postgres -D /var/lib/workmate/postgres
ExecStop={pg}/pg_ctl -D /var/lib/workmate/postgres -m fast -w -t 180 stop
Restart=on-failure
RestartSec=5
TimeoutStopSec=190
KillSignal=SIGINT
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/workmate /var/log/workmate
MemoryMax=2G
CPUQuota=150%
[Install]
WantedBy=multi-user.target
'''.format(lib=lib,pg=PG)
write(Path('/etc/systemd/system/workmate-db.service'),unit,0o644)
command(['systemctl','daemon-reload']);command(['systemctl','enable','--now','workmate-db.service'])
for _ in range(60):
 if subprocess.run(['/usr/bin/pg_isready','-h','127.0.0.1','-p','63074'],env=env,stdout=subprocess.DEVNULL).returncode==0:break
 time.sleep(1)
else:raise RuntimeError('Owned database did not become ready')

bootstrap=APP/'.deployment/bootstrap-db.mjs'
bootstrap_code=r'''import pg from 'pg';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
const cfg=JSON.parse(await fs.readFile(process.env.WORKMATE_BOOTSTRAP_CREDENTIALS,'utf8'));
const url=new URL(process.env.OWNER_DATABASE_URL);url.pathname='/postgres';
const c=new pg.Client({connectionString:url.href});await c.connect();
for(const role of ['cp_app','cp_control','cp_queue']){
 const password=cfg.database_users[role];if(!/^[a-f0-9]{48}$/.test(password))throw Error('Invalid generated credential');
 if(!(await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount)
  await c.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
}
if(!(await c.query("SELECT 1 FROM pg_database WHERE datname='copypaste'")).rowCount)await c.query('CREATE DATABASE copypaste OWNER cp_owner');
await c.end();
const db=new pg.Client({connectionString:process.env.OWNER_DATABASE_URL});await db.connect();
await db.query('GRANT CONNECT,CREATE ON DATABASE copypaste TO cp_queue');
const {runMigrations}=await import(pathToFileURL(path.resolve('dist/scripts/migration-runner.js')).href);
await runMigrations(db,'copypaste');
const version=(await db.query('SELECT max(version) version FROM schema_migrations')).rows[0].version;
if(version!==156)throw Error('Unexpected schema version');await db.end();console.log('Workmate schema156 ready');
'''
write(bootstrap,bootstrap_code,0o644)
# The bootstrap process runs as root only to read the requested root-only credentials;
# database DDL remains restricted to the dedicated cluster and cp_owner identity.
bootenv={**env,**common,'OWNER_DATABASE_URL':owner_url,'WORKMATE_BOOTSTRAP_CREDENTIALS':str(credentials)}
command([str(NODE),str(bootstrap)],env=bootenv,cwd=APP)
phase('isolated_database_migrations_ready',schema=156)

apiunit='''[Unit]
Description=Workmate LAN API and Codex worker (synthetic services)
After=network-online.target workmate-db.service
Requires=workmate-db.service
[Service]
Type=simple
User=workmate
Group=workmate
WorkingDirectory={app}
EnvironmentFile=/root/cfg/workmate/app.env
ExecStart={node} dist/src/server.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=180
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/workmate /var/log/workmate
MemoryMax=6G
CPUQuota=200%
UMask=0077
[Install]
WantedBy=multi-user.target
'''.format(app=APP,node=NODE)
write(Path('/etc/systemd/system/workmate-api.service'),apiunit,0o644)
nginx=BASE/'nginx';nginx.mkdir(exist_ok=True)
passwd=nginx/'operator.htpasswd'
if not passwd.exists():write(passwd,creds['operator_username']+':'+crypt.crypt(creds['operator_password'],crypt.mksalt(crypt.METHOD_SHA512))+'\n')
os.chown(passwd,account.pw_uid,account.pw_gid)
operator_html='''<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Workmate 測試收件箱 / Test mailbox</title><style>body{font:16px system-ui;margin:40px auto;padding:0 24px;max-width:900px;background:#f5f5f3;color:#171717}h1{border-top:3px solid #3537ff;padding-top:24px}article{background:white;border:1px solid #ddd;padding:20px;margin:16px 0;border-radius:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{background:#3537ff;color:white;padding:12px 24px;border:0;border-radius:24px;cursor:pointer}</style><h1>測試收件箱 / Test mailbox</h1><p>本內網假數據版本使用本地郵件。此頁僅供持有獨立操作口令的人員查看登入驗證碼。Admin仍需獨立TOTP。Local test mail only; Admin still requires TOTP.</p><button id="refresh">重新整理 / Refresh</button><main id="mail"></main><script>async function load(){const r=await fetch('/ops/mailbox/data/',{cache:'no-store'});if(!r.ok)throw Error('Mailbox unavailable');const files=(await r.json()).filter(x=>x.type==='file'&&/^[A-Za-z0-9-]+\\.json$/.test(x.name)).sort((a,b)=>b.mtime.localeCompare(a.mtime)).slice(0,30);const box=document.getElementById('mail');box.replaceChildren();for(const f of files){const r=await fetch('/ops/mailbox/data/'+encodeURIComponent(f.name),{cache:'no-store'});if(!r.ok)continue;const m=await r.json(),a=document.createElement('article'),h=document.createElement('h3'),p=document.createElement('p'),pre=document.createElement('pre');h.textContent=m.to;p.textContent=(m.at||'')+' · '+(m.subject||'');pre.textContent=m.text||'';a.append(h,p,pre);box.append(a)}}document.getElementById('refresh').onclick=()=>load().catch(e=>alert(e.message));load().catch(e=>alert(e.message));</script></html>'''
write(nginx/'operator.html',operator_html,0o644)
proxy='''location /v1/ { proxy_pass http://127.0.0.1:63073; proxy_http_version 1.1; proxy_set_header Host $http_host; proxy_set_header X-Real-IP $remote_addr; proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header X-Forwarded-Proto http; proxy_buffering off; proxy_read_timeout 900s; }
location = /health { proxy_pass http://127.0.0.1:63073; }
'''
conf='''worker_processes 1;
pid /var/lib/workmate/run/nginx.pid;
error_log /var/log/workmate/nginx-error.log;
events { worker_connections 1024; }
http {
 include /etc/nginx/mime.types;
 default_type application/octet-stream;
 access_log /var/log/workmate/nginx-access.log;
 client_body_temp_path /var/lib/workmate/run/nginx-body;
 proxy_temp_path /var/lib/workmate/run/nginx-proxy;
 fastcgi_temp_path /var/lib/workmate/run/nginx-fastcgi;
 uwsgi_temp_path /var/lib/workmate/run/nginx-uwsgi;
 scgi_temp_path /var/lib/workmate/run/nginx-scgi;
 client_max_body_size 30m;
 sendfile on;
 server { listen 0.0.0.0:63070; server_name _; root '''+str(RELEASE/'web')+''';
'''+proxy+'''location /downloads/ { alias /opt/workmate/downloads/; autoindex off; }
location / { try_files $uri $uri/ /index.html; add_header Cache-Control "no-cache"; }
 }
 server { listen 0.0.0.0:63071; server_name _; root '''+str(RELEASE/'admin')+''';
'''+proxy+'''location = /ops/mailbox/ { alias /opt/workmate/nginx/operator.html; auth_basic "Workmate test operator"; auth_basic_user_file /opt/workmate/nginx/operator.htpasswd; add_header Cache-Control "no-store"; }
 location /ops/mailbox/data/ { alias /var/lib/workmate/state/mailbox/; autoindex on; autoindex_format json; auth_basic "Workmate test operator"; auth_basic_user_file /opt/workmate/nginx/operator.htpasswd; add_header Cache-Control "no-store"; limit_except GET { deny all; } }
 location / { try_files $uri $uri/ /index.html; add_header Cache-Control "no-cache"; }
 }
 server { listen 0.0.0.0:63072; server_name _; location / { proxy_pass http://127.0.0.1:63073; proxy_http_version 1.1; proxy_set_header Host $http_host; proxy_set_header X-Real-IP $remote_addr; proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header X-Forwarded-Proto http; proxy_buffering off; proxy_read_timeout 900s; } }
}
'''
write(nginx/'nginx.conf',conf,0o644)
nginxunit='''[Unit]
Description=Workmate independent high-port LAN proxy
After=network.target workmate-api.service
[Service]
Type=simple
User=workmate
Group=workmate
ExecStart=/usr/sbin/nginx -p /opt/workmate/nginx/ -c /opt/workmate/nginx/nginx.conf -g "daemon off;"
ExecReload=/bin/kill -HUP $MAINPID
KillSignal=SIGQUIT
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/workmate /var/log/workmate
MemoryMax=256M
CPUQuota=100%
[Install]
WantedBy=multi-user.target
'''
write(Path('/etc/systemd/system/workmate-lan-proxy.service'),nginxunit,0o644)
command(['/usr/sbin/nginx','-t','-p',str(nginx)+'/', '-c',str(nginx/'nginx.conf')],user='workmate')
command(['systemctl','daemon-reload']);command(['systemctl','enable','--now','workmate-api.service','workmate-lan-proxy.service'])
for _ in range(120):
 try:
  with urllib.request.urlopen('http://127.0.0.1:63073/health',timeout=2) as r:assert r.status==200
  break
 except Exception:time.sleep(1)
else:raise RuntimeError('Workmate API not ready; inspect only owned service logs')

# Bootstrap one independent admin; secrets stay under /root/cfg/ and private state.
enrol=CFG/'admin-enrolment.json'
if not enrol.exists():
 command([str(NODE),'dist/scripts/admin-create.js',creds['admin_email'],'super_admin'],env={**env,**common},cwd=APP,user='workmate')
 matches=[p for p in (DATA/'state/enrolment').glob('*.json') if json.loads(p.read_bytes())['email']==creds['admin_email']]
 assert len(matches)==1;write(enrol,matches[0].read_bytes())
admin=json.loads(enrol.read_bytes())
text='''Workmate v0.1.3 — LAN HTTP deployment / 內網部署
Web: http://192.168.31.20:63070
Admin: http://192.168.31.20:63071
API: http://192.168.31.20:63072
Protected test mailbox: http://192.168.31.20:63071/ops/mailbox/
All external AI/media/advertising/payment dependencies use authorized synthetic data.
Credentials below are intentionally plaintext per operator request. File mode0600.
'''+json.dumps({**creds,'admin_totp_secret':admin['secret'],'admin_totp_uri':admin['totp_uri']},ensure_ascii=False,indent=2)+'''\n
Login: enter your email on Web. For Admin use the admin_email above and TOTP.
Retrieve the email OTP from the protected test mailbox with operator_username/password.
No application password exists: email OTP and admin TOTP remain enforced.
Database listens only on127.0.0.1:63074; app/control/queue roles do not bypass RLS.
Services: workmate-db.service, workmate-api.service, workmate-lan-proxy.service.
Start/stop/restart ONLY these owned units; do not touch existing nginx/postgres services.
Full bundle: http://192.168.31.20:63070/downloads/workmate-v0.1.3-complete.zip
Official domains/HTTPS and real services follow later. Existing Desktop/Extension
release defaults remain localhost until a separate approved client deployment build.
Windows-only exact cloud program/browser execution profiles remain unavailable on
this Linux host; no execution boundary has been weakened or virtualization added.
'''
write(CFG/'credentials.txt',text)
safe={'stage':176,'release':'v0.1.3','status':'deployed','at':datetime.now(timezone.utc).isoformat(),
 'origins':{k:ORIGIN+':'+str(PORTS[k]) for k in ['web','admin','api']},'ports':PORTS,'node':NODE_VERSION,'codex':'0.163.0-alpha.11','schema':156,
 'credentials_path':str(CFG/'credentials.txt'),'services':['workmate-db.service','workmate-api.service','workmate-lan-proxy.service'],
 'mode':'authorized_synthetic_lan_http','system_node_preserved':True,'global_nginx_not_reloaded':True,'virtualization_invoked':False,
 'source_archive_sha256':ARCHIVE_SHA,'pending':['official domain/HTTPS','real provider/SMTP configuration','native client endpoint build','Windows-only exact cloud execution profiles on Linux']}
jsonwrite(CFG/'deployment.sanitized.json',safe)
phase('deployed',web=safe['origins']['web'],admin=safe['origins']['admin'],api=safe['origins']['api'],credentials=str(CFG/'credentials.txt'))
PY
