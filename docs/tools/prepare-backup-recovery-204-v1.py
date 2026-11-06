"""Prepare an app-only compatible backup and activation continuation."""
from pathlib import Path
import ast,json
R=Path(__file__).resolve().parents[2];L=R/'dev/copypaste-delivery';S=L/'scripts'
def fresh(p,text):
 with p.open('x',encoding='utf-8',newline='\n') as f:f.write(text)
def edit(p,before,after):
 text=p.read_text('utf-8');assert before in text,p
 p.write_text(text.replace(before,after),encoding='utf-8',newline='\n')
provision=(S/'provision-backup-client-204-v1.sh').read_text('utf-8').replace('client-provision-v1','client-provision-v2').replace('postgresql-client-18-204-v1','postgresql-client-18-204-v2')
start=provision.index(' with urllib.request.urlopen(url,timeout=30) as r:');end=provision.index(' assert data and len(data)<16000000',start)
provision=provision[:start]+" data=(Path('/home/carzygod/workmate-backup-client-204-v1')/name).read_bytes()\n"+provision[end:]
ast.parse(provision.split("python3 - <<'PY'\n",1)[1].rsplit('\nPY',1)[0])
fresh(S/'provision-backup-client-204-v2.sh',provision)
activate=(S/'activate-integrated-204-v1.sh').read_text('utf-8')
for before,after in [('activation-v1','activation-v2'),('rollback-compatible-backend','rollback-compatible-backend-v2'),("'z'*44","'z'*45"),('-integrated-204-v1.conf','-integrated-204-v2.conf'),('candidate-integrated-204-v1.service','candidate-integrated-204-v2.service'),('dist.before-integrated-204-v1','dist.before-integrated-204-v2'),('.dist-integrated-204-v1','.dist-integrated-204-v2')]:
 assert before in activate,before;activate=activate.replace(before,after)
anchor='js(idle)\n# An app-only compatibility fallback'
assert anchor in activate
preflight='''js(idle)
backup_runtime=json.loads(Path('/opt/workmate/toolchains/postgresql-client-18-204-v2/runtime.sanitized.json').read_text())
assert backup_runtime['status']=='prepared' and sha(Path(backup_runtime['dump']))==backup_runtime['dump_sha256']
assert sha(Path(backup_runtime['restore']))==backup_runtime['restore_sha256']
probe="import pg from'pg';const c=new pg.Client({connectionString:process.env.CONTROL_DATABASE_URL});await c.connect();try{const r=await c.query('SHOW server_version_num');console.log(r.rows[0].server_version_num);}finally{await c.end();}"
assert int(js(probe).strip())//10000==18,'Compatible backup major version is required before stopping the app'
# An app-only compatibility fallback'''
activate=activate.replace(anchor,preflight)
assert "execFileSync('/usr/bin/pg_dump'," in activate
activate=activate.replace("execFileSync('/usr/bin/pg_dump',",'execFileSync("+json.dumps(backup_runtime[\'dump\'])+",')
activate=activate.replace('PGDATABASE:u.pathname.slice(1)}','PGDATABASE:u.pathname.slice(1),LD_LIBRARY_PATH:"+json.dumps(backup_runtime[\'library_directory\'])+"}')
anchor='js(code,True);backup.chmod(0o600);assert backup.stat().st_size>0'
assert anchor in activate
activate=activate.replace(anchor,anchor+"\n listing=subprocess.check_output([backup_runtime['restore'],'--list',str(backup)],env={**os.environ,'LD_LIBRARY_PATH':backup_runtime['library_directory']});assert len(listing)>100")
activate=activate.replace("'sha256':sha(backup)},'network_configuration_unchanged'", "'sha256':sha(backup),'client_version':backup_runtime['versions']['pg_dump'],'restore_listing_verified':True,'restore_listing_sha256':hashlib.sha256(listing).hexdigest()},'network_configuration_unchanged'")
ast.parse(activate.split("python3 - <<'PY'\n",1)[1].rsplit('\nPY',1)[0]);fresh(S/'activate-integrated-204-v2.sh',activate)
read=(S/'read-deployment-204-v1.sh').read_text('utf-8').replace('activation-v1/','activation-v2/')
read=read.replace("'downloads':json.loads", "'backup_client':json.loads((cfg/'client-provision-v2/receipt.sanitized.json').read_text()),'downloads':json.loads")
ast.parse(read.split("python3 - <<'PY'\n",1)[1].rsplit('\nPY',1)[0]);fresh(S/'read-deployment-204-v2.sh',read)
continuation='''"""Continue the published candidate after compatible app-owned backup preparation."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,subprocess,sys
L=Path(__file__).resolve().parents[1];load=lambda p:json.loads(p.read_text('utf-8-sig'))
assert load(L/'.data/integrated-204-v11/verification.json')['status']=='passed'
old=load(L/'.data/deployment-204-v1/deploy-steps/receipt.json')
assert old['status']=='failed' and len(old['steps'])==8 and old['steps'][-1]['name']=='activate-application' and old['steps'][-1]['exit_code']==1
assert all(s['exit_code']==0 for s in old['steps'][:-1])
assert load(L/'.data/deployment-204-v1/postgres-client-download-v1/receipt.json')['status']=='downloaded_and_uploaded_awaiting_server_signature_verification'
out=L/'.data/deployment-204-v1/deploy-steps-v2';out.mkdir(exist_ok=False)
report={'stage':204,'status':'running','started_at':datetime.now(timezone.utc).isoformat(),'prior_attempt_preserved':True,'steps':[],'server_network_writes':False}
def save():(out/'receipt.json').write_text(json.dumps(report,indent=2)+'\\n','utf-8')
try:
 for name,file in [('prepare-backup-client','provision-backup-client-204-v2.sh'),('activate-application','activate-integrated-204-v2.sh'),('read-deployment','read-deployment-204-v2.sh')]:
  r=subprocess.run([sys.executable,'-B','-X','utf8','scripts/remote-command-189-v1.py','scripts/'+file],cwd=L,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  for kind,data in [('stdout',r.stdout),('stderr',r.stderr)]:
   with (out/(name+'.'+kind+'.log')).open('xb') as f:f.write(data)
  report['steps'].append({'name':name,'exit_code':r.returncode,'stdout_sha256':hashlib.sha256(r.stdout).hexdigest(),'stderr_sha256':hashlib.sha256(r.stderr).hexdigest()});save();print(json.dumps({'phase':name,'exit_code':r.returncode}),flush=True)
  assert r.returncode==0,'Application continuation stopped; inspect exact retained local logs'
 report['status']='deployed_awaiting_online_observations'
except Exception:report['status']='failed';raise
finally:report['finished_at']=datetime.now(timezone.utc).isoformat();save()
'''
ast.parse(continuation);fresh(S/'continue-deployment-204-v2.py',continuation)
doc=R/'docs/tools/document-integrated-round-204-v1.py'
edit(doc,'.data/deployment-204-v1/deploy-steps/read-deployment.stdout.log','.data/deployment-204-v1/deploy-steps-v2/read-deployment.stdout.log')
edit(doc,"put('deployment.json',deployment['deployment']);put('downloads-publication.json',deployment['downloads'])", "put('deployment.json',deployment['deployment']);put('downloads-publication.json',deployment['downloads'])\nput('backup-client-provenance.json',deployment['backup_client'])\nput('retained-deployment-attempts.json',{'initial':load(L/'.data/deployment-204-v1/deploy-steps/receipt.json'),'continuation':load(L/'.data/deployment-204-v1/deploy-steps-v2/receipt.json'),'initial_failure':'System pg_dump14 did not support the actual embedded PostgreSQL18 server. App returned to prior code; database/proxy preserved. Official signed client18 packages are extracted only in an application-owned toolchain; no apt source, system package, database service or network changes.'})")
print(json.dumps({'status':'app_only_backup_recovery_prepared','system_or_network_configuration_changes':False}))
