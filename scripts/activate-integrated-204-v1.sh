#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,os,shutil,socket,subprocess,time,urllib.request
cfg=Path('/root/cfg/workmate');state=cfg/'integrated-204/activation-v1';state.mkdir(parents=True,mode=0o700)
assert not (state/'started').exists();(state/'started').write_text(datetime.now(timezone.utc).isoformat())
root=Path('/opt/workmate/overlays/integrated-204-v1');dest=root/'backend';previous=Path('/opt/workmate/overlays/integrated-202-v2/backend')
node='/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node'
assert subprocess.check_output(['systemctl','show','workmate-api.service','-p','WorkingDirectory','--value'],text=True).strip()==str(previous)
assert json.loads((cfg/'integrated-204/downloads-v1/receipt.json').read_text())['status']=='published'
baseline=json.loads((cfg/'integrated-202/network-baseline-v1.json').read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert {p:sha(Path(p)) for p in baseline['files']}==baseline['files']
original={n:(cfg/n).read_bytes() for n in ['app.env','migration.env']}
before={u:subprocess.check_output(['systemctl','show',u,'-p','MainPID','-p','NRestarts','-p','ActiveState'],text=True) for u in ['workmate-db.service','workmate-lan-proxy.service']}
for n,data in original.items():p=state/(n+'.before');p.write_bytes(data);p.chmod(0o600)
for r in json.loads((root/'manifest.json').read_text())['files']:assert (root/r['path']).stat().st_size==r['bytes'] and sha(root/r['path'])==r['sha256']
def js(text,owner=False):return subprocess.check_output([node,'--env-file='+str(cfg/('migration.env' if owner else 'app.env')),'--input-type=module','-e',text],cwd=dest,text=True)
idle="import pg from'pg';const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();try{const r=await c.query(\"SELECT count(*)::int n FROM tasks WHERE status IN ('queued','running')\");if(r.rows[0].n!==0)throw Error('Active tasks; application deployment deferred');}finally{await c.end();}"
js(idle)
# An app-only compatibility fallback accepts the forward schema and still
# renews through the preserved explicit legacy-column bridge. No down migration.
fallback=root/'rollback-compatible-backend';fallback.mkdir()
for p in previous.iterdir():
 target=fallback/p.name
 if p.name in ['src','dist']:shutil.copytree(p,target,symlinks=False)
 elif p.name=='.data':
  target.mkdir()
  for f in p.iterdir():
   if f.name in ['cloud-program-host-linux','cloud-browser-host-linux']:shutil.copytree(f,target/f.name,symlinks=False)
   elif '.before-' not in f.name and '.candidate-' not in f.name:(target/f.name).symlink_to(f.resolve(),target_is_directory=f.is_dir())
 else:target.symlink_to(p.resolve(),target_is_directory=p.is_dir())
for p in [fallback/'src/schema-compatibility.ts',fallback/'dist/src/schema-compatibility.js']:
 s=p.read_text();assert 'requiredSchemaVersion = 163' in s;p.write_text(s.replace('requiredSchemaVersion = 163','requiredSchemaVersion = 165'))
drop=Path('/etc/systemd/system/workmate-api.service.d')/('z'*44+'-integrated-204-v1.conf');assert not drop.exists()
candidate_unit='workmate-candidate-integrated-204-v1.service';candidate=state/'candidate.env';candidate.write_bytes(original['app.env']+b'\nHOST=127.0.0.1\nPORT=63079\nWORKER_ENABLED=false\n');candidate.chmod(0o600)
with socket.socket() as s:assert s.connect_ex(('127.0.0.1',63079))!=0
def ready(port):
 for _ in range(80):
  try:
   with urllib.request.urlopen(f'http://127.0.0.1:{port}/health/ready',timeout=2) as r:data=json.load(r)
   if data.get('ok') and data.get('ai_ready') and data.get('data_mode')=='configured_services':return data
  except Exception:pass
  time.sleep(.5)
 raise RuntimeError('Application readiness failed')
def service_text(base):return '[Service]\nDelegate=yes\nProtectControlGroups=no\nPrivateTmp=yes\nReadWritePaths=/sys/fs/cgroup/system.slice/workmate-api.service '+str(base/'.data/document-preview')+'\nWorkingDirectory='+str(base)+'\nExecStart=\nExecStart=/usr/bin/python3 '+str(base/'scripts/launch-linux-native-service.py')+' '+node+' '+str(base/'dist/src/server.js')+'\n'
swaps=[];migrated=False;stopped=False;migration_started=False;started=time.monotonic()
try:
 subprocess.run(['systemctl','stop','workmate-api.service'],check=True);stopped=True;js(idle)
 backup=state/'before-schema-165.dump'
 code="import {execFileSync} from'node:child_process';const u=new URL(process.env.OWNER_DATABASE_URL);if(u.pathname!=='/copypaste')throw Error('Unexpected application DB');const env={...process.env,PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:u.pathname.slice(1)};execFileSync('/usr/bin/pg_dump',['--format=custom','--file',"+json.dumps(str(backup))+"],{env,stdio:['ignore','ignore','pipe']});"
 js(code,True);backup.chmod(0o600);assert backup.stat().st_size>0
 migration="import pg from'pg';import{runMigrations}from'./dist/scripts/migration-runner.js';const u=new URL(process.env.OWNER_DATABASE_URL);if(u.pathname!=='/copypaste')throw Error('Unexpected application DB');const c=new pg.Client({connectionString:u.href});await c.connect();try{await runMigrations(c,'Workmate application');const r=await c.query('SELECT count(*)::int n,max(version)::int v FROM schema_migrations');if(r.rows[0].n!==165||r.rows[0].v!==165)throw Error('Schema incomplete');}finally{await c.end();}"
 migration_started=True;migration_output=js(migration,True);migrated=True;(state/'migration.log').write_text(migration_output)
 subprocess.run(['systemd-run','--quiet','--collect','--unit='+candidate_unit,'--property=User=workmate','--property=Group=workmate','--property=WorkingDirectory='+str(dest),'--property=EnvironmentFile='+str(candidate),'--property=Delegate=yes','--property=NoNewPrivileges=yes','--property=ProtectSystem=strict','--property=PrivateTmp=yes','--property=ProtectControlGroups=no','--property=ReadWritePaths=/var/lib/workmate /var/log/workmate '+str(dest/'.data/document-preview')+' /sys/fs/cgroup/system.slice/'+candidate_unit,'/usr/bin/python3',str(dest/'scripts/launch-linux-native-service.py'),node,str(dest/'dist/src/server.js')],check=True)
 candidate_health=ready(63079);subprocess.run(['systemctl','stop',candidate_unit],check=True)
 drop.write_text(service_text(dest));drop.chmod(0o644);subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','start','workmate-api.service'],check=True);health=ready(63073)
 live=Path('/opt/workmate/overlays/integrated-201-v1/web/dist');saved=live.with_name('dist.before-integrated-204-v1');link=live.with_name('.dist-integrated-204-v1')
 assert live.is_symlink() and live.resolve()==Path('/opt/workmate/overlays/integrated-203-v1/web/dist') and not saved.exists()
 link.symlink_to(root/'web/dist',target_is_directory=True);live.rename(saved);swaps.append((live,saved));link.rename(live)
 with urllib.request.urlopen('http://127.0.0.1:63070/',timeout=5) as r:assert r.read()==(root/'web/dist/index.html').read_bytes()
 assert {p:sha(Path(p)) for p in baseline['files']}==baseline['files']
 assert original=={n:(cfg/n).read_bytes() for n in original}
 assert before=={u:subprocess.check_output(['systemctl','show',u,'-p','MainPID','-p','NRestarts','-p','ActiveState'],text=True) for u in before}
 report={'stage':204,'status':'deployed','at':datetime.now(timezone.utc).isoformat(),'schema_version':165,'backend_root':str(dest),'web_root':str(root/'web/dist'),'candidate_health':candidate_health,'health':health,'backup':{'path':str(backup),'bytes':backup.stat().st_size,'sha256':sha(backup)},'network_configuration_unchanged':True,'credentials_unchanged':True,'database_and_proxy_processes_unchanged':True,'native_runtime_directories':2,'rollback_compatible_checkout':str(fallback),'rollback_tested':False,'activation_seconds':round(time.monotonic()-started,2)}
 (state/'deployment.sanitized.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
except Exception:
 # A migration may commit before its reporting process fails. Discover the
 # actual application schema before selecting a compatible code fallback.
 if migration_started:
  probe="import pg from'pg';const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();try{const r=await c.query('SELECT max(version)::int v FROM schema_migrations');console.log(r.rows[0].v);}finally{await c.end();}"
  actual=int(js(probe).strip());assert actual in [163,164,165]
  if actual==164:
   for p in [fallback/'src/schema-compatibility.ts',fallback/'dist/src/schema-compatibility.js']:
    p.write_text(p.read_text().replace('requiredSchemaVersion = 165','requiredSchemaVersion = 164'))
  migrated=actual>=164
 for live,saved in reversed(swaps):
  if live.is_symlink():live.unlink()
  saved.rename(live)
 if stopped:
  drop.write_text(service_text(fallback if migrated else previous));drop.chmod(0o644);subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','restart','workmate-api.service'],check=True);ready(63073)
 assert {p:sha(Path(p)) for p in baseline['files']}==baseline['files']
 raise
finally:subprocess.run(['systemctl','stop',candidate_unit],check=False,stderr=subprocess.DEVNULL)
PY
