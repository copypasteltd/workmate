#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,os,socket,subprocess,time,urllib.request
cfg=Path('/root/cfg/workmate');state=cfg/'integrated-204/activation-v3';state.mkdir(mode=0o700)
root=Path('/opt/workmate/overlays/integrated-204-v2');dest=root/'backend'
previous=Path('/opt/workmate/overlays/integrated-204-v1/rollback-compatible-backend-v2')
node='/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
show=lambda unit,prop:subprocess.check_output(['systemctl','show',unit,'-p',prop,'--value'],text=True).strip()
assert show('workmate-api.service','WorkingDirectory')==str(previous) and show('workmate-api.service','ActiveState')=='active'
assert json.loads((cfg/'integrated-204/downloads-v1/receipt.json').read_text())['status']=='published'
baseline=json.loads((cfg/'integrated-202/network-baseline-v1.json').read_text());assert {p:sha(Path(p)) for p in baseline['files']}==baseline['files']
original={n:(cfg/n).read_bytes() for n in ['app.env','migration.env']}
before={u:subprocess.check_output(['systemctl','show',u,'-p','MainPID','-p','NRestarts','-p','ActiveState'],text=True) for u in ['workmate-db.service','workmate-lan-proxy.service']}
manifest=json.loads((root/'manifest.json').read_text());assert len(manifest['static_runtime_imports'])>100
for row in manifest['files']:assert (root/row['path']).stat().st_size==row['bytes'] and sha(root/row['path'])==row['sha256']
runtime=json.loads(Path('/opt/workmate/toolchains/postgresql-client-18-204-v2/runtime.sanitized.json').read_text())
assert runtime['status']=='prepared' and all(sha(Path(runtime[k]))==runtime[k+'_sha256'] for k in ['dump','restore'])
def js(text,owner=False):return subprocess.check_output([node,'--env-file='+str(cfg/('migration.env' if owner else 'app.env')),'--input-type=module','-e',text],cwd=dest,text=True)
idle="import pg from'pg';const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();try{const r=await c.query(\"SELECT count(*)::int n FROM tasks WHERE status IN ('queued','running')\");if(r.rows[0].n!==0)throw Error('Active tasks; defer application switch');const s=await c.query('SELECT count(*)::int n,max(version)::int v FROM schema_migrations');if(s.rows[0].n!==165||s.rows[0].v!==165)throw Error('Expected existing complete schema165');}finally{await c.end();}"
js(idle)
candidate_unit='workmate-candidate-integrated-204-v3.service';candidate=state/'candidate.env';candidate.write_bytes(original['app.env']+b'\nHOST=127.0.0.1\nPORT=63079\nWORKER_ENABLED=false\n');candidate.chmod(0o600)
with socket.socket() as s:assert s.connect_ex(('127.0.0.1',63079))!=0
drop=Path('/etc/systemd/system/workmate-api.service.d')/('z'*46+'-integrated-204-v3.conf');assert not drop.exists()
def ready(port):
 for _ in range(80):
  try:
   with urllib.request.urlopen(f'http://127.0.0.1:{port}/health/ready',timeout=2) as r:data=json.load(r)
   if data.get('ok') and data.get('ai_ready') and data.get('data_mode')=='configured_services':return data
  except Exception:pass
  time.sleep(.5)
 raise RuntimeError('Application readiness failed')
def service_text(base):return '[Service]\nDelegate=yes\nProtectControlGroups=no\nPrivateTmp=yes\nReadWritePaths=/sys/fs/cgroup/system.slice/workmate-api.service '+str(base/'.data/document-preview')+'\nWorkingDirectory='+str(base)+'\nExecStart=\nExecStart=/usr/bin/python3 '+str(base/'scripts/launch-linux-native-service.py')+' '+node+' '+str(base/'dist/src/server.js')+'\n'
swaps=[];stopped=False;started=time.monotonic()
try:
 # Existing schema165 is already compatible. Prove the complete candidate
 # healthy alongside the current app before stopping the current app.
 subprocess.run(['systemd-run','--quiet','--collect','--unit='+candidate_unit,'--property=User=workmate','--property=Group=workmate','--property=WorkingDirectory='+str(dest),'--property=EnvironmentFile='+str(candidate),'--property=Delegate=yes','--property=NoNewPrivileges=yes','--property=ProtectSystem=strict','--property=PrivateTmp=yes','--property=ProtectControlGroups=no','--property=ReadWritePaths=/var/lib/workmate /var/log/workmate '+str(dest/'.data/document-preview')+' /sys/fs/cgroup/system.slice/'+candidate_unit,'/usr/bin/python3',str(dest/'scripts/launch-linux-native-service.py'),node,str(dest/'dist/src/server.js')],check=True)
 candidate_health=ready(63079);subprocess.run(['systemctl','stop',candidate_unit],check=True)
 backup=state/'before-activation-schema165.dump'
 code="import{execFileSync}from'node:child_process';const u=new URL(process.env.OWNER_DATABASE_URL);if(u.pathname!=='/copypaste')throw Error('Unexpected application DB');const env={...process.env,PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:u.pathname.slice(1),LD_LIBRARY_PATH:"+json.dumps(runtime['library_directory'])+"};execFileSync("+json.dumps(runtime['dump'])+",['--format=custom','--file',"+json.dumps(str(backup))+"],{env,stdio:['ignore','ignore','pipe']});"
 js(code,True);backup.chmod(0o600);assert backup.stat().st_size>0
 listing=subprocess.check_output([runtime['restore'],'--list',str(backup)],env={**os.environ,'LD_LIBRARY_PATH':runtime['library_directory']});assert len(listing)>100
 prior_backup=cfg/'integrated-204/activation-v2/before-schema-165.dump';assert prior_backup.stat().st_size>0
 js(idle);subprocess.run(['systemctl','stop','workmate-api.service'],check=True);stopped=True;js(idle)
 drop.write_text(service_text(dest));drop.chmod(0o644);subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','start','workmate-api.service'],check=True);health=ready(63073)
 live=Path('/opt/workmate/overlays/integrated-201-v1/web/dist');saved=live.with_name('dist.before-integrated-204-v3');link=live.with_name('.dist-integrated-204-v3')
 assert live.is_symlink() and live.resolve()==Path('/opt/workmate/overlays/integrated-203-v1/web/dist') and not saved.exists()
 link.symlink_to(root/'web/dist',target_is_directory=True);live.rename(saved);swaps.append((live,saved));link.rename(live)
 with urllib.request.urlopen('http://127.0.0.1:63070/',timeout=5) as r:assert r.read()==(root/'web/dist/index.html').read_bytes()
 assert {p:sha(Path(p)) for p in baseline['files']}==baseline['files'] and original=={n:(cfg/n).read_bytes() for n in original}
 assert before=={u:subprocess.check_output(['systemctl','show',u,'-p','MainPID','-p','NRestarts','-p','ActiveState'],text=True) for u in before}
 report={'stage':204,'status':'deployed','at':datetime.now(timezone.utc).isoformat(),'schema_version':165,'schema_applied_by_prior_attempt_v2':True,'backend_root':str(dest),'web_root':str(root/'web/dist'),'candidate_health':candidate_health,'candidate_healthy_before_cutover':True,'static_runtime_imports_verified':len(manifest['static_runtime_imports']),'health':health,'backup':{'path':str(backup),'bytes':backup.stat().st_size,'sha256':sha(backup),'schema_version':165,'client_version':runtime['versions']['pg_dump'],'restore_listing_verified':True,'restore_listing_sha256':hashlib.sha256(listing).hexdigest()},'pre_schema_upgrade_backup':{'path':str(prior_backup),'bytes':prior_backup.stat().st_size,'sha256':sha(prior_backup)},'network_configuration_unchanged':True,'credentials_unchanged':True,'database_and_proxy_processes_unchanged':True,'native_runtime_directories':2,'rollback_compatible_checkout':str(previous),'rollback_tested':False,'activation_seconds':round(time.monotonic()-started,2)}
 (state/'deployment.sanitized.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
except Exception:
 for live,saved in reversed(swaps):
  if live.is_symlink():live.unlink()
  saved.rename(live)
 if stopped:
  drop.write_text(service_text(previous));drop.chmod(0o644);subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','restart','workmate-api.service'],check=True);ready(63073)
 assert {p:sha(Path(p)) for p in baseline['files']}==baseline['files']
 raise
finally:subprocess.run(['systemctl','stop',candidate_unit],check=False,stderr=subprocess.DEVNULL)
PY
