"""Ordinary reviewed eight-ref atomic publication with remote readback."""
from pathlib import Path
from datetime import datetime,timezone
from uuid import uuid4
import hashlib,json,re,subprocess
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';DELIVERY=DEV/'copypaste-delivery'
OUT=DELIVERY/'.data/publication-196'/str(uuid4());OUT.mkdir(parents=True,exist_ok=False)
REPOS={'backend':DEV/'copypaste-platform','web':DEV/'copypaste-web','admin':DEV/'copypaste-admin','desktop':DEV/'copypaste-desktop','extension':DEV/'copypaste-extension','delivery':DELIVERY,'docs':ROOT}
EXPECTED={'docs':'b401ca5a604059c17ab21f98f4e2524daf4d0a97','backend':'0008481e7911cb7244d8d98478243fb9b91e8c1f','web':'4b9050ec5ff2858776aec78b98ebfd2c1fcf470e','admin':'56f205fe233189882aa0e866791d78e496e7d3ee','desktop':'c5e5fb3d973dbc22e6b38a8fd5defd9a995e283b','extension':'27a3523b6cf25b3c95fbec11c35c73868615674a','delivery':'098873184bca53275ceaa239d007a8d7cb6176a4'}
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
assert load(DELIVERY/'.data/integrated-196-v4/verification.json')['state']=='passed'
assert load(ROOT/'docs/quality/integrated-round-196/documentation-check.json')['status']=='passed'
assert load(ROOT/'docs/quality/integrated-round-196/workspace-journey.json')['status']=='passed_scoped_steps'
for name in ['real-desktop-journey','extension-journey','final-smoke']:assert load(ROOT/'docs/quality/integrated-round-196'/f'{name}.json')['status']=='passed'
assert load(ROOT/'docs/quality/integrated-round-196/public-downloads.json')['status']=='passed'
assert load(ROOT/'docs/quality/integrated-round-196/owned-native-accounting.json')['status']=='read_back'
assert load(ROOT/'docs/quality/integrated-round-196/deployment.json')['deployment']['backend_root'].endswith('integrated-196-v1/backend')
common={'README.md','README.en.md','package.json','package-lock.json'}
tracked={
 'backend':{'src/cloud-program-routes.ts','src/server.ts','src/task-workspace.ts','tests/route-inventory-189-v2.ts'},
 'web':{'contracts/product-downloads.json','src/api.ts','src/main.tsx','src/new-work-task.css','src/new-work-task.tsx','src/role-templates.tsx','src/software-checks.tsx','src/task-workbench.css','src/task-workbench.tsx'},
 'admin':set(),
 'desktop':{'renderer/src/api.ts','renderer/src/local-agent.tsx','renderer/src/main.tsx','renderer/src/role-templates.tsx','renderer/src/software-checks.tsx','renderer/src/task-workbench.css','renderer/src/task-workbench.tsx','src/local-agent.ts','src/local-attachments.ts','src/local-codex.ts','src/main.ts'},
 'extension':set(),'delivery':set(),'docs':{'AGENTS.md','docs/README.md','docs/README.en.md'},
}
new={
 'backend':{'contracts/workspace-route-additions-196.json','src/task-workspace-edit.ts','src/workspace-text.ts','tests/history/route-inventory-189-v2.pre196.ts.snapshot'},
 'web':{'src/work-role-guide.tsx','src/workspace-edit-state.ts','src/workspace-edit.tsx'},
 'desktop':{'renderer/src/native-execution-state.ts','renderer/src/native-execution.tsx','renderer/src/work-role-guide.tsx','renderer/src/workspace-edit-state.ts','renderer/src/workspace-edit.tsx','src/local-file-types.ts'},
 'admin':set(),'extension':set(),'delivery':set(),'docs':set(),
}
def allowed_new(name,p):
 if p in new[name]:return True
 if name=='docs':return p in ['docs/requirements/196-workspace-completion-round.md','docs/development/196-task-review-and-native-context.md','docs/changes/196-task-review-and-native-context.md'] or p.startswith('docs/quality/integrated-round-196/') or bool(re.fullmatch(r'docs/tools/[a-z0-9-]+196(?:-v\d+)?\.py',p))
 if name=='delivery':return bool(re.fullmatch(r'(scripts|tests)/[a-z0-9-]+196(?:-v\d+)?\.(?:mjs|py|sh|ps1|test\.ts)',p))
 if re.fullmatch(r'assets/screenshots/(?:196-[a-z0-9-]+\.png|workmate-196-v\d+-[a-z-]+\.(?:gif|mp4))',p):return True
 return bool(re.fullmatch(r'tests/workspace-(?:completion|execution|native|edit)-196(?:-v\d+)?\.test\.ts',p))
def changed(folder):
 raw=git(folder,'diff-files','--name-only','--ignore-submodules=all').splitlines()
 return git(folder,'diff','--no-ext-diff','--no-textconv','--no-renames','--ignore-submodules=all','--name-only','--',*raw).splitlines() if raw else []
report={'stage':196,'status':'reviewing','at':datetime.now(timezone.utc).isoformat(),'heads_before':heads.copy(),'remote_before':baseline,'protected_files':len(protected),'reviewed':{},'committed':{}}
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
 git(folder,'diff','--cached','--check');git(folder,'commit','-m','feat: deliver task review, immutable text revisions and native context (196)')
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
