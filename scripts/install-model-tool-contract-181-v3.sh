#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path,PurePosixPath
from datetime import datetime,timezone
import hashlib,json,shutil,subprocess,time,urllib.request,zipfile
cfg=Path('/root/cfg/workmate');backup=cfg/'model-tool-contract-181-v3-backup'
dest=Path('/opt/workmate/overlays/model-tool-contract-181-v3')
previous=Path('/opt/workmate/overlays/model-tool-contract-181-v2/backend')
upload=Path('/home/carzygod/workmate-upload-179/workmate-model-tool-contract-181-v3.zip')
node='/opt/workmate/toolchains/node-v24.22.2-linux-x64/bin/node'
expected=Path(str(upload)+'.sha256').read_text().split()[0]
assert hashlib.sha256(upload.read_bytes()).hexdigest()==expected
assert not dest.exists() and not backup.exists(),'Existing deployment/backup preserved'
original=json.loads((cfg/'preservation-before.sanitized.json').read_bytes())
foreign={}
for row in original['cfg']:
 p=Path(row['path']);foreign[str(p)]=hashlib.sha256(p.read_bytes()).hexdigest()
services={}
for row in original['services']:
 services[row['unit']]=subprocess.check_output(['systemctl','show',row['unit'],'-p','ActiveState','-p','MainPID'],text=True)
backup.mkdir(mode=0o700)
for name in ['app.env','migration.env','credentials.txt','DEPLOYMENT-README.md']:
 shutil.copy2(cfg/name,backup/name)
proxy=Path('/opt/workmate/nginx/nginx.conf');old_proxy=proxy.read_text();shutil.copy2(proxy,backup/'nginx.conf')
dest.mkdir(mode=0o755)
with zipfile.ZipFile(upload) as z:
 m=json.loads(z.read('manifest.json'));assert m['stage']==181 and m['schema_version']==159
 assert hashlib.sha256((previous/'package-lock.json').read_bytes()).hexdigest()==m['backend_dependency_lock_sha256']
 assert set(z.namelist())==set([r['path'] for r in m['files']]+['manifest.json'])
 for row in m['files']:
  part=PurePosixPath(row['path']);assert not part.is_absolute() and '..' not in part.parts and part.parts[0] in ['backend','admin','web']
  raw=z.read(row['path']);assert len(raw)==row['bytes'] and hashlib.sha256(raw).hexdigest()==row['sha256']
  target=dest/row['path'];target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw);target.chmod(0o644)
 (dest/'manifest.json').write_bytes(z.read('manifest.json'))
for p in previous.iterdir():
 if p.name in ['src','dist','migrations']:continue
 target=dest/'backend'/p.name
 if not target.exists():target.symlink_to(p.resolve(),target_is_directory=p.is_dir())
check="import pg from 'pg';const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();try{const r=await c.query(\"SELECT (SELECT count(*)::int FROM tasks WHERE status IN ('queued','running','reconciling')) AS active,(SELECT count(*)::int FROM capability_validations WHERE state='running') AS validating,(SELECT max(version) FROM schema_migrations) AS schema\");console.log(JSON.stringify(r.rows[0]));}finally{await c.end();}"
state=json.loads(subprocess.check_output([node,'--env-file='+str(cfg/'app.env'),'--input-type=module','-e',check],cwd=dest/'backend',text=True))
assert state['active']==0 and state['validating']==0 and int(state['schema'])==158,'Active work or incompatible schema; no service switch performed'

# Only an additive migration is applied. A private migration-object snapshot and
# hash-only model/hold/violation preservation receipts precede the upgrade.
migrate="""import pg from 'pg';import {writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {runMigrations} from './dist/scripts/migration-runner.js';
const root='/root/cfg/workmate/model-tool-contract-181-v3-backup/';
const owner=new URL(process.env.OWNER_DATABASE_URL);const client=new pg.Client({connectionString:owner.href});const control=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});
await client.connect();await control.connect();
const hash=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const capture=async()=>{const r={};for(const [name,sql] of [['model_connections','SELECT * FROM capability_model_connections ORDER BY release_id'],['model_releases','SELECT * FROM capability_releases ORDER BY id'],['uncertain_holds',\"SELECT channel,id,state,cost_state,capacity_held,effective_numerator,operation_id,request_hash FROM current_ai_provider_requests WHERE capacity_held ORDER BY id\"],['historical_violations','SELECT * FROM ai_request_budget_violations ORDER BY id'],['historical_allocations',\"SELECT to_jsonb(a)-'input_bound_mode' AS original FROM ai_request_budget_allocations a ORDER BY id\"]])r[name]=hash((await control.query(sql)).rows);return r;};
try{
 const before=await capture();await writeFile(root+'preservation-before.json',JSON.stringify(before,null,2),{flag:'wx',mode:0o600});
 const originals={};
 for(const [name,sql] of [['functions',"SELECT oid::regprocedure::text AS signature,pg_get_functiondef(oid) AS definition FROM pg_proc WHERE proname IN ('allocate_ai_generation_budget','guard_ai_generation_budget') ORDER BY oid"],['allocations','SELECT * FROM ai_request_budget_allocations ORDER BY id'],['violations','SELECT * FROM ai_request_budget_violations ORDER BY id']])originals[name]=(await control.query(sql)).rows;
 await writeFile(root+'migration-originals.private.json',JSON.stringify(originals,null,2),{flag:'wx',mode:0o600});
 await runMigrations(client,'workmate181');const after=await capture();if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Historical model or accounting facts changed');
 await writeFile(root+'preservation-after.json',JSON.stringify(after,null,2),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({schema_version:159,model_and_hold_hashes_unchanged:true,private_migration_backup:true}));
}finally{await control.end();await client.end();}"""
migration_output=subprocess.check_output([node,'--env-file='+str(cfg/'app.env'),'--env-file='+str(cfg/'migration.env'),'--input-type=module','-e',migrate],cwd=dest/'backend',text=True)
print(migration_output)
# Validate the complete upgraded API startup before changing the running unit.
preflight="import {buildApp} from './dist/src/server.js';import {loadConfig} from './dist/src/config.js';const runtime=await buildApp(loadConfig({...process.env,WORKER_ENABLED:'false'}),{worker:false});await runtime.app.close();console.log('Schema159 API preflight passed');"
subprocess.run([node,'--env-file='+str(cfg/'app.env'),'--input-type=module','-e',preflight],cwd=dest/'backend',check=True)


drop=Path('/etc/systemd/system/workmate-api.service.d/zzzzz-model-tool-contract-181-v3.conf');assert not drop.exists()
drop.write_text('[Service]\nWorkingDirectory='+str(dest/'backend')+'\nExecStart=\nExecStart='+node+' '+str(dest/'backend/dist/src/server.js')+'\n');drop.chmod(0o644)
new=old_proxy
for client in ['web','admin']:
 old='/opt/workmate/overlays/model-tool-contract-181-v2/'+client+'/dist';assert new.count('root '+old+';')==1
 new=new.replace('root '+old+';','root '+str(dest/client/'dist')+';')
try:
 subprocess.run(['systemctl','daemon-reload'],check=True);subprocess.run(['systemctl','restart','workmate-api.service'],check=True)
 ready=None
 for _ in range(40):
  try:
   with urllib.request.urlopen('http://127.0.0.1:63073/health/ready',timeout=2) as r:ready=json.load(r)
   if ready.get('codex_tool_contract')=='scoped_code_mode_v1':break
  except Exception:pass
  time.sleep(1)
 assert ready and ready.get('codex_tool_contract')=='scoped_code_mode_v1'
 proxy.write_text(new);subprocess.run(['/usr/sbin/nginx','-t','-p','/opt/workmate/nginx/','-c',str(proxy)],check=True)
 subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=True)
except Exception:
 proxy.write_text(old_proxy)
 # Schema159 is forward-only: keep its matching API selected; never start the schema158 binary against it.
 subprocess.run(['systemctl','daemon-reload'],check=False);subprocess.run(['systemctl','restart','workmate-api.service'],check=False)
 subprocess.run(['systemctl','reload','workmate-lan-proxy.service'],check=False)
 raise
for name,h in foreign.items():assert hashlib.sha256(Path(name).read_bytes()).hexdigest()==h
for name,value in services.items():assert subprocess.check_output(['systemctl','show',name,'-p','ActiveState','-p','MainPID'],text=True)==value
for name in ['app.env','migration.env','credentials.txt']:assert (cfg/name).read_bytes()==(backup/name).read_bytes()
guide=cfg/'DEPLOYMENT-README.md'
guide.write_text('## Codex scoped code-mode tool contract · stage181\n\nCloud Codex supports flat function tools and pinned native additional_tools / functions.exec code mode, scoped to registered business tools. OS and delegation tools remain disabled. Rejected streams retain their real failure codes. Admin permits separately budgeted text verification retries and explains failures. Existing gpt-6-luna model settings, encrypted keys and earlier uncertain accounting records are preserved. Native and Admin validation are required after deployment. Schema159 adds conservative pre-funded native input ceilings; historical exact-count allocations and violations are preserved. Overlay: /opt/workmate/overlays/model-tool-contract-181-v3.\n\n'+guide.read_text())
receipt={'stage':181,'at':datetime.now(timezone.utc).isoformat(),'status':'deployed','schema_version':159,'overlay':str(dest),'archive_sha256':expected,'model_transport':'http_and_https','codex_tool_contract':'scoped_code_mode_v1','credentials_unchanged':True,'model_configuration_unchanged':True,'foreign_configuration_unchanged':True,'foreign_service_pids_unchanged':True,'model_and_hold_hashes_unchanged':True,'private_migration_backup':True,'virtualization_invoked':False}
with (cfg/'model-tool-contract-181-v3.sanitized.json').open('x') as f:json.dump(receipt,f,indent=2)
print(json.dumps(receipt))
PY
