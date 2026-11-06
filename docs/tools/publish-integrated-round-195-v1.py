"""Ordinary atomic publication of reviewed source, bilingual docs and real media."""
from pathlib import Path
from datetime import datetime,timezone
from uuid import uuid4
import hashlib,json,re,subprocess
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';DELIVERY=DEV/'copypaste-delivery'
OUT=DELIVERY/'.data/publication-195'/str(uuid4());OUT.mkdir(parents=True,exist_ok=False)
REPOS={'docs':ROOT,'backend':DEV/'copypaste-platform','web':DEV/'copypaste-web','admin':DEV/'copypaste-admin','desktop':DEV/'copypaste-desktop','extension':DEV/'copypaste-extension','delivery':DELIVERY}
def git(cwd,*args,timeout=120):return subprocess.check_output(['git','-c','core.fsmonitor=false','-c','gc.auto=0','-c','maintenance.auto=false',*args],cwd=cwd,text=True,encoding='utf-8',stderr=subprocess.PIPE,timeout=timeout).strip()
def put(name,v):(OUT/name).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def refs():return {r:o for o,r in (line.split('\t',1) for line in git(ROOT,'ls-remote','origin').splitlines()) if r.startswith('refs/')}
protected=json.loads((DELIVERY/'.data/acceptance-193/baseline/receipt.json').read_text(encoding='utf-8'))['preserved_untracked']
def preserve():
 for rel,expected in protected.items():
  p=ROOT/rel;assert p.is_file() and hashlib.sha256(p.read_bytes()).hexdigest()==expected,'Protected user file changed: '+rel
preserve()
baseline=refs();heads={k:git(p,'rev-parse','HEAD') for k,p in REPOS.items()};put('baseline.json',{'heads':heads,'remote':baseline,'protected_files':protected})
for name in ['backend','web','admin','desktop','extension','delivery']:assert baseline['refs/heads/'+name]==heads[name],name+' advanced remotely'
assert baseline['refs/heads/docs']==baseline['refs/heads/main']==heads['docs']
assert json.loads((DELIVERY/'.data/integrated-195-v8/verification.json').read_text())['state']=='passed'
assert (ROOT/'docs/quality/integrated-round-195/README.md').is_file()
common={'README.md','README.en.md','package.json','package-lock.json'}
tracked={
 'backend':{'src/agent-templates.ts','src/document-preview-host.cs','src/document-preview.ts','src/schema-compatibility.ts','src/server.ts','src/uploads.ts','src/persistent-work.ts','scripts/setup-document-preview.mjs'},
 'web':{'contracts/product-downloads.json','src/client-failure.ts','src/cloud-asset-picker.tsx','src/main.tsx','src/new-work-task.css','src/new-work-task.tsx','src/persistent-work.tsx','src/resumable-upload.tsx','src/ui.tsx','tests/product-downloads.test.ts'},
 'admin':{'src/client-failure.ts','src/main.tsx','src/ui.tsx'},
 'desktop':{'renderer/src/api.ts','renderer/src/client-failure.ts','renderer/src/local-agent.css','renderer/src/local-agent.tsx','renderer/src/ui.tsx','src/local-agent.ts','src/main.ts','src/preload.cts'},
 'extension':{'public/panel.css','src/chat-panel.ts','src/client-failure.ts'},
 'delivery':{'scripts/record-workmate-media.ts'},
 'docs':{'docs/README.md','docs/README.en.md'},
}
new={
 'backend':{'migrations/163-role-acceptance-evidence.sql','scripts/setup-document-preview-linux.mjs','scripts/diagnose-office-launch-195-v1.mjs','src/document-preview-host-linux.c','src/operational-readiness.ts','src/role-acceptance.ts','src/task-workspace.ts'},
 'web':{'src/task-workbench.css','src/task-workbench.tsx','src/work-composer.css','src/work-composer.tsx','tests/history/product-downloads-193.test.ts.snapshot'},
 'admin':{'src/operational-readiness.tsx','src/readiness.css','src/role-acceptance.tsx'},
 'desktop':{'renderer/src/task-workbench.css','renderer/src/task-workbench.tsx','src/local-attachments.ts'},'extension':set(),'delivery':set(),'docs':set(),
}
def allowed_new(name,p):
 if p in new[name]:return True
 if name=='docs':return p in ['docs/requirements/195-integrated-development-round.md','docs/development/195-integrated-workspaces-and-acceptance.md','docs/changes/195-integrated-workspaces.md'] or p.startswith('docs/quality/integrated-round-195/') or bool(re.fullmatch(r'docs/tools/[a-z0-9-]+195(?:-v\d+)?\.py',p))
 if name=='delivery':return bool(re.fullmatch(r'(scripts|tests)/[a-z0-9-]+195(?:-v\d+)?\.(?:mjs|py|sh|test\.ts)',p))
 if re.fullmatch(r'assets/screenshots/(?:195-[a-z0-9-]+\.png|workmate-195-v\d+-[a-z-]+\.(gif|mp4))',p):return True
 return bool(re.fullmatch(r'tests/(integrated-workspace|local-attachments)-195-v\d+\.test\.ts',p))
report={'stage':195,'status':'preparing','at':datetime.now(timezone.utc).isoformat(),'protected_file_count':len(protected),'staged':{}}
for name,folder in REPOS.items():
 assert not git(folder,'diff','--cached','--name-only'),'Unexpected existing staging: '+name
 changed=git(folder,'diff','--name-only').splitlines();assert all(p in tracked[name] or name!='docs' and p in common for p in changed),{'unexpected':set(changed)-tracked[name]-common}
 others=git(folder,'ls-files','--others','--exclude-standard').splitlines();paths=changed+[p for p in others if allowed_new(name,p)]
 assert paths,name+' has no reviewed changes'
 assert all(not p.startswith(('.data/','.env','node_modules/','dist/')) for p in paths)
 git(folder,'add','--',*paths)
 staged=git(folder,'diff','--cached','--name-only').splitlines();assert set(staged)==set(paths)
 diff=git(folder,'diff','--cached','--no-ext-diff','--unified=0')
 assert not re.search(r'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|\bsk-[A-Za-z0-9_-]{25,}',diff),'Credential-like staged content'
 git(folder,'diff','--cached','--check');report['staged'][name]=staged;put('receipt.json',report)
 git(folder,'commit','-m','feat: ship integrated inputs, results, readiness and role evidence (195)')
 heads[name]=git(folder,'rev-parse','HEAD');print(json.dumps({'committed':name,'head':heads[name],'files':len(staged)}),flush=True)
for name in ['backend','web','admin','desktop','extension','delivery']:
 git(ROOT,'fetch','--no-tags',str(REPOS[name]),heads[name],timeout=180)
desired={'refs/heads/'+name:heads[name] for name in ['backend','web','admin','desktop','extension','delivery']};desired['refs/heads/docs']=desired['refs/heads/main']=heads['docs']
assert refs()==baseline,'Remote changed; preserve local commits and reconcile before publication'
for ref,head in desired.items():git(ROOT,'merge-base','--is-ancestor',baseline[ref],head)
report['status']='ready_to_push';report['desired']=desired;put('receipt.json',report)
git(ROOT,'push','--atomic','origin',*[oid+':'+ref for ref,oid in desired.items()],timeout=300)
after=refs();assert all(after.get(ref)==oid for ref,oid in desired.items())
assert {k:v for k,v in after.items() if k not in desired}=={k:v for k,v in baseline.items() if k not in desired}
for name,folder in REPOS.items():assert not git(folder,'diff','--name-only') and not git(folder,'diff','--cached','--name-only')
preserve();report.update(status='published_and_read_back',completed_at=datetime.now(timezone.utc).isoformat(),verified_remote=desired,unchanged_other_refs=len(after)-len(desired));put('receipt.json',report)
print(json.dumps({'status':report['status'],'refs':desired,'receipt':str(OUT/'receipt.json')},ensure_ascii=False))
