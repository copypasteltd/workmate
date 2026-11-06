"""Ordinary reviewed eight-ref atomic publication with remote readback."""
from pathlib import Path
from datetime import datetime,timezone
from uuid import uuid4
import hashlib,json,re,subprocess
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';DELIVERY=DEV/'copypaste-delivery'
OUT=DELIVERY/'.data/publication-198'/str(uuid4());OUT.mkdir(parents=True,exist_ok=False)
REPOS={'backend':DEV/'copypaste-platform','web':DEV/'copypaste-web','admin':DEV/'copypaste-admin','desktop':DEV/'copypaste-desktop','extension':DEV/'copypaste-extension','delivery':DELIVERY,'docs':ROOT}
EXPECTED={'backend':'e7a6d5bd93dfe920dd41235e6eec5436dd815195','web':'6fba5929e9ed5d9d4598726b3b37306ca8033e04','admin':'3675c0f5b0ad0b367ad0bf2f4ae8faf2644cef87','desktop':'337d654e496ce60fcbdb286e550aa29e950851ee','extension':'7d4cf657ab3afc78f2fa692bb08edd5e965fab81','delivery':'d85f89c165959df7b8ee8051ad48ac4198849d9a','docs':'d6cd8774b076fa39b0e94c965ffab149cf32670a'}

def git(cwd,*args,timeout=120):return subprocess.check_output(['git','-c','core.fsmonitor=false','-c','gc.auto=0','-c','maintenance.auto=false',*args],cwd=cwd,text=True,encoding='utf8',stderr=subprocess.PIPE,timeout=timeout).strip()
def put(name,v):(OUT/name).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
def load(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def refs():return {r:o for o,r in (line.split('\t',1) for line in git(ROOT,'ls-remote','origin').splitlines()) if r.startswith('refs/')}
protected=load(DELIVERY/'.data/acceptance-193/baseline/receipt.json')['preserved_untracked']
def preserve():
 for rel,digest in protected.items():assert (ROOT/rel).is_file() and sha(ROOT/rel)==digest,'Protected user file changed: '+rel
preserve();baseline=refs();heads={k:git(p,'rev-parse','HEAD') for k,p in REPOS.items()};assert heads==EXPECTED,'Review local/remote advancement before publication'
for name in REPOS:assert baseline['refs/heads/'+name]==heads[name]
assert baseline['refs/heads/main']==heads['docs']
for name,folder in REPOS.items():assert git(folder,'branch','--show-current')=='codex/'+name
assert load(DELIVERY/'.data/integrated-198-v3/verification.json')['state']=='passed'
assert load(ROOT/'docs/quality/integrated-round-198/documentation-check.json')['status']=='passed'
assert load(DELIVERY/'.data/integrated-198-v4/verification.json')['state']=='passed'
assert load(ROOT/'docs/quality/integrated-round-198/desktop-delta-journey.json')['desktop_version']=='0.7.10'
assert load(ROOT/'docs/quality/integrated-round-198/web-directory-journey.json')['status']=='passed'
for name in ['real-desktop-journey','desktop-delta-journey','extension-journey','final-smoke']:assert load(ROOT/'docs/quality/integrated-round-198'/f'{name}.json')['status']=='passed'
assert load(ROOT/'docs/quality/integrated-round-198/public-downloads.json')['status']=='passed'
assert load(ROOT/'docs/quality/integrated-round-198/deployment.json')['deployment']['backend_root'].endswith('integrated-198-v2/backend')
common={'README.md','README.en.md','package.json','package-lock.json'}
tracked={
 'backend':{'src/server.ts','tests/route-inventory-189-v2.ts'},
 'web':{'contracts/product-downloads.json','src/api.ts','src/context.tsx','src/main.tsx','src/notifications.tsx','src/persistent-work.tsx','src/task-workbench.tsx'},
 'admin':set(),
 'desktop':{'src/main.ts','src/preload.cts','renderer/src/api.ts','renderer/src/context.tsx','renderer/src/local-agent.tsx','renderer/src/main.tsx','renderer/src/notifications.tsx','renderer/src/persistent-work.tsx','renderer/src/task-workbench.tsx'},
 'extension':{'public/sidepanel.html','src/chat-panel.ts','src/conversation.ts'},
 'delivery':set(),'docs':{'docs/README.md','docs/README.en.md','docs/development/198-task-directory-and-context.md'},
}
shared={'work-navigation-state.ts','work-navigation.tsx','task-directory.tsx','task-directory.css'}
new={
 'backend':{'src/task-directory.ts','contracts/task-directory-v1.schema.json','contracts/task-directory-route-additions-198.json','tests/task-directory-198-v1.test.ts','tests/task-directory-198-v2.test.ts','tests/history/route-inventory-189-v2.pre198.ts.snapshot'},
 'web':{'src/'+p for p in shared}|{'tests/work-navigation-198.test.ts'},
 'desktop':{'renderer/src/'+p for p in shared}|{'src/cloud-work-destination.ts','tests/work-navigation-198.test.ts','tests/cloud-work-destination-198.test.ts'},
 'extension':{'src/history-view.ts','tests/history-restore-198.test.ts'},'admin':set(),'delivery':set(),'docs':set(),
}

def allowed_new(name,p):
 if p in new[name]:return True
 if name=='docs':return p in ['docs/requirements/198-task-directory-and-context-round.md','docs/development/198-task-directory-and-context.md','docs/changes/198-task-directory-and-context.md'] or p.startswith('docs/quality/integrated-round-198/') or bool(re.fullmatch(r'docs/tools/[a-z0-9-]+198(?:-v\d+)?\.py',p))
 if name in ['delivery','desktop'] and re.fullmatch(r'scripts/[a-z0-9-]+198(?:-v\d+)?\.(?:mjs|py|sh|ps1)',p):return True
 return bool(re.fullmatch(r'assets/screenshots/(?:198-[a-z0-9-]+\.png|workmate-198-v\d+-[a-z-]+\.(?:gif|mp4))',p))

def changed(folder):
 raw=git(folder,'diff-files','--name-only','--ignore-submodules=all').splitlines()
 return git(folder,'diff','--no-ext-diff','--no-textconv','--no-renames','--ignore-submodules=all','--name-only','--',*raw).splitlines() if raw else []
report={'stage':198,'status':'reviewing','at':datetime.now(timezone.utc).isoformat(),'heads_before':heads.copy(),'remote_before':baseline,'protected_files':len(protected),'reviewed':{},'committed':{}}
for name,folder in REPOS.items():
 assert not git(folder,'diff','--cached','--name-only'),'Unexpected existing staging: '+name
 edits=changed(folder);assert all(p in tracked[name] or name!='docs' and p in common for p in edits),{'component':name,'unexpected':set(edits)-tracked[name]-common}
 roots=['docs'] if name=='docs' else ['src','renderer/src','contracts','scripts','tests','assets/screenshots']
 others=git(folder,'ls-files','--others','--exclude-standard','--',*roots).splitlines();paths=edits+[p for p in others if allowed_new(name,p)]
 assert paths,name+' has no reviewed changes'
 assert all(not p.startswith(('.data/','.env','node_modules/','dist/')) for p in paths)
 report['reviewed'][name]=paths
put('receipt.json',report)
for name,folder in REPOS.items():
 preserve();paths=report['reviewed'][name];git(folder,'add','--',*paths)
 staged=git(folder,'diff','--cached','--name-only').splitlines();assert set(staged)==set(paths),name
 diff=git(folder,'diff','--cached','--no-ext-diff','--no-textconv','--no-renames','--unified=0')
 assert not re.search(r'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|\bsk-[A-Za-z0-9_-]{25,}|cp_(?:admin_)?session=[A-Za-z0-9._-]{16,}',diff),'Credential-like staged value'
 git(folder,'diff','--cached','--check');git(folder,'commit','-m','feat: complete task discovery and scoped work continuity (198)')
 heads[name]=git(folder,'rev-parse','HEAD');report['committed'][name]=heads[name];put('receipt.json',report);print(json.dumps({'committed':name,'head':heads[name],'files':len(staged)}),flush=True)
for name in REPOS:
 if name!='docs':git(ROOT,'fetch','--no-tags',str(REPOS[name]),heads[name],timeout=180)
desired={'refs/heads/'+name:head for name,head in heads.items()};desired['refs/heads/main']=heads['docs']
before_push=refs();assert all(before_push.get(ref)==baseline.get(ref) for ref in desired),'Target ref changed; preserve commits and reconcile'
for ref,head in desired.items():git(ROOT,'merge-base','--is-ancestor',baseline[ref],head)
report.update(status='ready_to_push',desired=desired);put('receipt.json',report)
git(ROOT,'push','--atomic','origin',*[oid+':'+ref for ref,oid in desired.items()],timeout=300)
after=refs();assert all(after.get(ref)==oid for ref,oid in desired.items())
for name,folder in REPOS.items():assert not changed(folder) and not git(folder,'diff','--cached','--name-only')
preserve();report.update(status='published_and_read_back',completed_at=datetime.now(timezone.utc).isoformat(),verified_remote=desired,unrelated_refs_preserved={k:v for k,v in before_push.items() if k not in desired}=={k:v for k,v in after.items() if k not in desired});put('receipt.json',report)
print(json.dumps({'status':report['status'],'refs':desired,'receipt':str(OUT/'receipt.json')},ensure_ascii=False),flush=True)
