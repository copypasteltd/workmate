"""Bind directory lifecycle delivery to actual native, deployed and UI evidence."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime,timezone
import json,re,shutil,subprocess

ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';D=DEV/'copypaste-delivery';P=D/'.data/deployment-184'
COMP={'backend':'platform','web':'web','admin':'admin','desktop':'desktop','extension':'extension','delivery':'delivery'}
def digest(p):return sha256(p.read_bytes()).hexdigest()
def git(repo,*args):
 p=subprocess.run(['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','gc.auto=0','-C',str(repo),*args],cwd=repo,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 assert p.returncode==0,'Git inspection failed'
 return p.stdout.decode('utf8').splitlines()
def changed(repo):
 return sorted(set(git(repo,'diff','--name-only'))|set(git(repo,'ls-files','--others','--exclude-standard','--','src','tests','migrations','contracts','catalog','assets','scripts')))

runtime=json.loads((P/'server-runtime.json').read_bytes());assert runtime['status']=='deployed' and runtime['schema_version']==161
assert all(runtime[k] for k in ['credentials_unchanged','foreign_configuration_unchanged','foreign_business_services_preexisting','model_and_hold_hashes_unchanged','private_migration_backup'])
production=json.loads((P/'production-verification.json').read_bytes());assert production['status']=='production_directory_lifecycle_verified'
assert production['fixtures_cleaned'] and production['deleted_user_count']==4 and production['deleted_workspace_count']==4
assert production['operation_count']==production['direct_audit_count']==18
assert all(j['state']=='completed_with_exceptions' and not j['exceptions'] for j in production['jobs'])
runs=[json.loads(p.read_bytes()) for p in sorted(P.glob('browser-*/receipt.json'))]
assert len(runs)==2 and all(r['status']=='passed' and r['browser_closed'] for r in runs)
final=next(r for r in runs if r.get('artifact_version')=='ui-v2');assert len(final['checks'])==10
media=json.loads((P/'media.sanitized.json').read_bytes())['files']
for row in media:assert digest(ROOT/row['path'])==row['sha256']

proof=ROOT/'docs/quality/admin-directory-lifecycle-184';proof.mkdir(exist_ok=False)
checks=[]
for name,total in [('focused-tests-v2.log',11),('focused-tests-v3.log',13)]:
 p=P/name;content=p.read_text(encoding='utf8');counts={k:int(re.findall(r'^# '+k+r' (\d+)$',content,re.M)[-1]) for k in ['tests','pass','fail']}
 assert counts=={'tests':total,'pass':total,'fail':0}
 shutil.copyfile(p,proof/name);checks.append({'path':(proof/name).relative_to(ROOT).as_posix(),'sha256':digest(p),**counts})
first=D/'.data/admin-directory-lifecycle-184/e24798c9-f0c9-4b8f-b8ef-ff9f84ed2852/native-tests.log'
assert '# fail 8' in first.read_text(encoding='utf8');shutil.copyfile(first,proof/'focused-tests-v1-failed.log')
for name in ['backend-build-v4.log','admin-build-v5.log','browser-v1.log','browser-v2.log']:
 p=P/name;assert p.is_file();shutil.copyfile(p,proof/name)
assert 'built in' in (proof/'admin-build-v5.log').read_text(encoding='utf8')
for name,value in [('server-runtime.json',runtime),('production-verification.json',production),('actual-browser-final.json',final)]:
 # No auth storage state or credentials are copied into public evidence.
 if name=='actual-browser-final.json':value={k:v for k,v in value.items() if k not in ['run','video']}
 (proof/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')

names={}
sources={}
for branch,component in COMP.items():
 repo=DEV/('copypaste-'+component);names[branch]=changed(repo)
 for n in names[branch]:
  assert not any(v in Path(n).parts for v in ['.data','dist','node_modules','release','.git'])
  sources[(repo/n).relative_to(ROOT).as_posix()]=digest(repo/n)
names['docs']=sorted(set(git(ROOT,'diff','--name-only','--','docs'))|{
 p.relative_to(ROOT).as_posix() for folder in ['docs/assets/admin-directory-lifecycle-184','docs/quality/admin-directory-lifecycle-184'] for p in (ROOT/folder).rglob('*') if p.is_file()
}|{
 'docs/requirements/184-admin-directory-lifecycle.md','docs/development/184-admin-directory-lifecycle.md','docs/changes/184-admin-directory-lifecycle.md',
 'docs/contracts/admin-directory-lifecycle-184.json','docs/tools/prepare-admin-directory-lifecycle-184-v1.py','docs/tools/publish-admin-directory-lifecycle-184-v1.py',
 'docs/quality/admin-directory-lifecycle-184.json'
})
for n in names['docs']:
 if n!='docs/quality/admin-directory-lifecycle-184.json':sources[n]=digest(ROOT/n)
report={'stage':184,'status':'deployed_and_qualified','at':datetime.now(timezone.utc).isoformat(),
 'scope':'Administrative user/workspace create, permanent account deletion, durable enterprise cleanup and explicitly selected bulk status/deletion; other product acceptance retains its own scope.',
 'schema_version':161,'native_checks':13,'actual_final_browser_checks':10,'production_operations':18,'production_direct_audit_facts':18,
 'owned_user_fixtures_cleaned':4,'owned_enterprise_fixtures_cleaned':4,'workspace_cleanup_completed':True,
 'cleanup_retention':'Financial/audit facts, backups needing replay and customer-local copies are retained. All four root jobs have empty operational exception arrays.',
 'original_attempts_preserved':{'native_v1':'Fixture audit table and user-facing tenant DTO version mistakes;8 failed/3 passed. Original bytes retained.',
  'native_v2':'11/11 passed after fixture corrections and response result implementation.',
  'native_v3':'13/13 passed, including multiple workspaces, legacy bypass guard, batch caps, expiry and revoked authority.',
  'deployment_postcheck':'Initial script reached live deployment then stopped on firmware daemon PID change. Follow-up verified preserved business services/configuration and recorded the observed firmware start.',
  'first_cleanup_read':'Read before the second asynchronous cleanup completed. Subsequent durable-state verification confirms all four roots completed.'},
 'browser_closed':True,'ssh_closed':True,'local_virtualization_used':False,'tests':checks,'sources':sources,'media':media}
(ROOT/'docs/quality/admin-directory-lifecycle-184.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
(P/'publication-paths.json').write_text(json.dumps(names,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
print(json.dumps({'status':report['status'],'source_files':len(sources),'publication_files':{k:len(v) for k,v in names.items()},'native_checks':13,'final_browser_checks':10}))
