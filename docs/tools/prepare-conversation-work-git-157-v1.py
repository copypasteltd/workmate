"""Preserve qualified source bytes in Git; no runtime source or frozen artifact changes."""
from pathlib import Path
from hashlib import sha256
import json,subprocess
ROOT=Path(r'D:\dev\copypasted\自有agent');DEV=ROOT/'dev'
def h(p):return sha256(p.read_bytes()).hexdigest()
def git(repo,*args):return subprocess.check_output(['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','gc.auto=0','-C',str(repo),*args],cwd=repo)
cp_path=ROOT/'docs/quality/conversation-work-checkpoint-157.json';cp=json.loads(cp_path.read_bytes())
assert cp['status']=='verified_conversation_work_increment'
for n,expected in cp['source_files'].items():assert h(DEV/n)==expected,n
receipt=json.loads((DEV/'copypaste-delivery/.data/conversation-work-157/publication-4f65d811-f7ab-4e43-9b10-a2a2b7fb8398/receipt.json').read_bytes());assert receipt['status']=='failed' and receipt['components']==[]
repo=DEV/'copypaste-platform';staged=git(repo,'diff','--cached','--name-only','-z').decode().split('\0');staged=[s for s in staged if s];assert staged
# The failed publisher established an initially empty index and staged only its
# exact stage157 allowlist. Restore just those owned index entries, not files.
allowed=set()
for row in receipt['commands']:
 args=row['args']
 if 'add' in args:
  i=args.index('add');assert args[i+1]=='--';allowed.update(args[i+2:])
assert set(staged)<=allowed
for i in range(0,len(staged),35):git(repo,'restore','--staged','--',*staged[i:i+35])
changes=[]
for repo,name,rules in [
 ('platform','.gitattributes','src/conversation-mutation.ts -text whitespace=cr-at-eol\ntests/*157* -text whitespace=cr-at-eol'),
 ('web','.gitattributes','src/conversation-attempt.ts -text whitespace=cr-at-eol'),
 ('desktop','renderer/.gitattributes','src/conversation-attempt.ts -text whitespace=cr-at-eol'),
 ('delivery','.gitattributes','scripts/*157* -text whitespace=cr-at-eol')]:
 p=DEV/('copypaste-'+repo)/name;before=p.read_bytes();after=before+b'\n# Stage157 retains qualified source bytes across Windows and fresh clones.\n'+rules.encode()+b'\n';p.write_bytes(after)
 changes.append({'path':p.relative_to(ROOT).as_posix(),'before':sha256(before).hexdigest(),'after':h(p),'kind':'git_attributes_only'})
delta={}
for n,expected in cp['source_files'].items():
 actual=h(DEV/n)
 if actual!=expected:delta[n]={'before':expected,'after':actual}
assert set(delta)=={'copypaste-desktop/renderer/.gitattributes'}
assert h(DEV/'copypaste-desktop/.gitattributes')==cp['baseline']['desktop_attributes_sha256']
report={'stage':157,'status':'qualified_runtime_bytes_preserved','original_checkpoint':{'path':cp_path.relative_to(ROOT).as_posix(),'sha256':h(cp_path)},'failed_publication_receipt_sha256':h(DEV/'copypaste-delivery/.data/conversation-work-157/publication-4f65d811-f7ab-4e43-9b10-a2a2b7fb8398/receipt.json'),'changes':changes,'qualified_source_metadata_delta':delta,'unchanged_qualified_runtime_and_fixture_files':len(cp['source_files'])-1,'runtime_source_changes':0,'tests_repeated':False,'reason':'Only Git attribute rules changed. Exact qualified source/fixture bytes remain identical; no runtime retest needed under the fast-release request. Preserve original evidence and failed publisher.'}
report_path=ROOT/'docs/quality/conversation-work-git-metadata-157.json'
with report_path.open('x',encoding='utf-8',newline='\n') as f:f.write(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
for n,a in delta.items():cp['source_files'][n]=a['after']
cp['git_metadata_supplement']={'path':report_path.relative_to(ROOT).as_posix(),'sha256':h(report_path),'original_checkpoint_sha256':h(cp_path)}
cp['checkpoint_scope']='Original runtime qualifications plus explicit Git-only metadata supplement; original source manifests/checkpoint remain unchanged.'
with (ROOT/'docs/quality/conversation-work-checkpoint-157-git.json').open('x',encoding='utf-8',newline='\n') as f:f.write(json.dumps(cp,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':report['status'],'runtime_source_changes':0,'metadata_files':len(changes),'original_evidence_preserved':True}))
