#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,os,shutil,socket,subprocess,time,urllib.request
cfg=Path('/root/cfg/workmate');state=cfg/'integrated-205/activation-v1';state.mkdir(parents=True,mode=0o700)
root=Path('/opt/workmate/overlays/integrated-205-v1');dest=root/'backend';previous=Path('/opt/workmate/overlays/integrated-204-v2/backend')
rollback=root/'rollback-compatible-backend';assert not rollback.exists()
node='/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
show=lambda u,p:subprocess.check_output(['systemctl','show',u,'-p',p,'--value'],text=True).strip()
assert show('workmate-api.service','WorkingDirectory')==str(previous) and show('workmate-api.service','ActiveState')=='active'
baseline=json.loads((cfg/'integrated-202/network-baseline-v1.json').read_text());assert {p:sha(Path(p)) for p in baseline['files']}==baseline['files']
original={n:(cfg/n).read_bytes() for n in ['app.env','migration.env']}
before={u:subprocess.check_output(['systemctl','show',u,'-p','MainPID','-p','NRestarts','-p','ActiveState'],text=True) for u in ['workmate-db.service','workmate-lan-proxy.service']}
manifest=json.loads((root/'manifest.json').read_text());assert manifest['stage']==205 and manifest['schema_version']==166
for r in manifest['files']:assert (root/r['path']).stat().st_size==r['bytes'] and sha(root/r['path'])==r['sha256']
runtime=json.loads(Path('/opt/workmate/toolchains/postgresql-client-18-204-v2/runtime.sanitized.json').read_text());assert runtime['status']=='prepared'
for k in ['dump','restore']:assert sha(Path(runtime[k]))==runtime[k+'_sha256']
# The sole fallback change is its release schema constant for this additive table.
shutil.copytree(previous,rollback,symlinks=True)
schema=rollback/'dist/src/schema-compatibility.js';old=schema.read_bytes();assert old.count(b'requiredSchemaVersion = 165')==1
schema.write_bytes(old.replace(b'requiredSchemaVersion = 165',b'requiredSchemaVersion = 166',1))
(state/'fallback-schema-patch.json').write_text(json.dumps({'before_sha256':hashlib.sha256(old).hexdigest(),'after_sha256':sha(schema),'only_change':'requiredSchemaVersion165to166; application-only fallback; no task or charge rewrite'},indent=2)+'\n')
def js(code,owner=False):return subprocess.check_output([node,'--env-file='+str(cfg/('migration.env' if owner else 'app.env')),'--input-type=module','-e',code],cwd=dest,text=True)
def idle(expected):
 js("import pg from'pg';const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();try{if((await c.query(\"SELECT count(*)::int n FROM tasks WHERE status IN ('queued','running')\")).rows[0].n!==0)throw Error('Active work: defer cutover');const s=(await c.query('SELECT count(*)::int n,max(version)::int v FROM schema_migrations')).rows[0];if(s.n!=="+str(expected)+"||s.v!=="+str(expected)+")throw Error('Unexpected release schema');}finally{await c.end();}")
idle(165)
backup=state/'before-schema166.dump'
js("import{execFileSync}from'node:child_process';const u=new URL(process.env.OWNER_DATABASE_URL);if(u.pathname!=='/copypaste')throw Error('Wrong database');execFileSync("+json.dumps(runtime['dump'])+",['--format=custom','--file',"+json.dumps(str(backup))+"],{env:{...process.env,PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:'copypaste',LD_LIBRARY_PATH:"+json.dumps(runtime['library_directory'])+"},stdio:['ignore','ignore','pipe']});",True)
backup.chmod(0o600);listing=subprocess.check_output([runtime['restore'],'--list',str(backup)],env={**os.environ,'LD_LIBRARY_PATH':runtime['library_directory']});assert len(listing)>100
candidate_unit='workmate-candidate-integrated-205-v1.service';candidate=state/'candidate.env';candidate.write_bytes(original['app.env']+b'\nHOST=127.0.0.1\nPORT=63079\nWORKER_ENABLED=false\n');candidate.chmod(0o600)
with socket.socket() as s:assert s.connect_ex(('127.0.0.1',63079))!=0
drop=Path('/etc/systemd/system/workmate-api.service.d')/('z'*47+'-integrated-205-v1.conf');assert not drop.exists()
def service_text(base):return '[Service]\nDelegate=yes\nProtectControlGroups=no\nPrivateTmp=yes\nReadWritePaths=/sys/fs/cgroup/system.slice/workmate-api.service '+str(base/'.data/document-preview')+'\nWorkingDirectory='+str(base)+'\nExecStart=\nExecStart=/usr/bin/python3 '+str(base/'scripts/launch-linux-native-service.py')+' '+node+' '+str(base/'dist/src/server.js')+'\n'
def ready(port):
 for _ in range(80):
  try:
   with urllib.request.urlopen(f'http://127.0.0.1:{port}/health/ready',timeout=2) as r:d=json.load(r)
   if d.get('ok') and d.get('ai_ready') and d.get('data_mode')=='configured_services':return d
  except Exception:pass
  time.sleep(.5)
 raise RuntimeError('Application readiness failed')
swaps=[];stopped=False;upgraded=False;started=time.monotonic()
try:
 idle(165);subprocess.run(['systemctl','stop','workmate-api.service'],check=True);stopped=True;idle(165)
 js("import pg from'pg';import{runMigrations}from'./dist/scripts/migration-runner.js';const c=new pg.Client({connectionString:process.env.OWNER_DATABASE_URL});await c.connect();try{await runMigrations(c,'Round205 call-scoped outcome ledger');}finally{await c.end();}",True);upgraded=True;idle(166)
 subprocess.run(['systemd-run','--quiet','--collect','--unit='+candidate_unit,'--property=User=workmate','--property=Group=workmate','--property=WorkingDirectory='+str(dest),'--property=EnvironmentFile='+str(candidate),'--property=Delegate=yes','--property=NoNewPrivileges=yes','--property=ProtectSystem=strict','--property=PrivateTmp=yes','--property=ProtectControlGroups=no','--property=ReadWritePaths=/var/lib/workmate /var/log/workmate '+str(dest/'.data/document-preview')+' /sys/fs/cgroup/system.slice/'+candidate_unit,'/usr/bin/python3',str(dest/'scripts/launch-linux-native-service.py'),node,str(dest/'dist/src/server.js')],check=True)
 candidate_health=ready(63079);subprocess.run(['systemctl','stop',candidate_unit],check=True)
 drop.write_text(service_text(dest));subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','start','workmate-api.service'],check=True);health=ready(63073)
 live=Path('/opt/workmate/overlays/integrated-201-v1/web/dist');saved=live.with_name('dist.before-integrated-205-v1');link=live.with_name('.dist-integrated-205-v1')
 assert live.is_symlink() and live.resolve()==Path('/opt/workmate/overlays/integrated-204-v2/web/dist') and not saved.exists()
 link.symlink_to(root/'web/dist',target_is_directory=True);live.rename(saved);swaps.append((live,saved));link.rename(live)
 with urllib.request.urlopen('http://127.0.0.1:63070/',timeout=5) as r:assert r.read()==(root/'web/dist/index.html').read_bytes()
 assert {p:sha(Path(p)) for p in baseline['files']}==baseline['files'] and original=={n:(cfg/n).read_bytes() for n in original}
 assert before=={u:subprocess.check_output(['systemctl','show',u,'-p','MainPID','-p','NRestarts','-p','ActiveState'],text=True) for u in before}
 report={'stage':205,'status':'deployed','schema_version':166,'at':datetime.now(timezone.utc).isoformat(),'backend_root':str(dest),'web_root':str(root/'web/dist'),'health':health,'candidate_health':candidate_health,'backup':{'path':str(backup),'bytes':backup.stat().st_size,'sha256':sha(backup),'restore_list_sha256':hashlib.sha256(listing).hexdigest(),'full_restore_drill':False},'network_configuration_unchanged':True,'database_and_proxy_processes_unchanged':True,'credentials_unchanged':True,'fallback':str(rollback),'activation_seconds':round(time.monotonic()-started,2)}
 (state/'deployment.sanitized.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
except Exception:
 for live,saved in reversed(swaps):
  if live.is_symlink():live.unlink()
  saved.rename(live)
 if stopped:
  drop.write_text(service_text(rollback if upgraded else previous));subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','restart','workmate-api.service'],check=True);ready(63073)
 assert {p:sha(Path(p)) for p in baseline['files']}==baseline['files']
 raise
finally:subprocess.run(['systemctl','stop',candidate_unit],check=False,stderr=subprocess.DEVNULL)
PY
