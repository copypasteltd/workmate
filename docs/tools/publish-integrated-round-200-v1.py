"""Ordinary reviewed eight-ref atomic publication with remote readback."""
from pathlib import Path
from datetime import datetime,timezone
from uuid import uuid4
import hashlib,json,re,subprocess
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';DELIVERY=DEV/'copypaste-delivery'
OUT=DELIVERY/'.data/publication-200'/str(uuid4());OUT.mkdir(parents=True,exist_ok=False)
REPOS={'backend':DEV/'copypaste-platform','web':DEV/'copypaste-web','admin':DEV/'copypaste-admin','desktop':DEV/'copypaste-desktop','extension':DEV/'copypaste-extension','delivery':DELIVERY,'docs':ROOT}
EXPECTED={'backend': '43c1b19e9a901ceb6fae8bbcadfa2eb13ded7e65', 'web': 'a436f26b00a589edcabac939ea3d95058e8eebfa', 'admin': 'fa095c7749f4e2dd3a840823180a8a91aaab9b9b', 'desktop': 'c5ebb783dfd63528c22b4ae696831ce6f118d492', 'extension': 'f6a83a2523911e001712ac59c97a5c7108cdeddf', 'delivery': '896d526acc9028d9083f0142580ec396d247ad5e', 'docs': '52de28e08b5290f6191fbd4db1d1757b55bfff0e'}

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
assert load(DELIVERY/'.data/integrated-200-v4/verification.json')['state']=='passed'
assert load(ROOT/'docs/quality/integrated-round-200/documentation-check.json')['status']=='passed'
assert load(ROOT/'docs/quality/integrated-round-200/live-production-journey.json')['status']=='passed'
assert load(ROOT/'docs/quality/integrated-round-200/isolated-production-journey.json')['status']=='passed'
assert load(ROOT/'docs/quality/integrated-round-200/public-downloads.json')['status'] in ['passed','partial','failed']
assert load(ROOT/'docs/quality/integrated-round-200/inner-downloads.json')['status']=='passed'
assert load(ROOT/'docs/quality/integrated-round-200/deployment.json')['deployment']['backend_root'].endswith('integrated-200-v2/backend')
common={'README.md','README.en.md','package.json','package-lock.json'}
tracked={
 'backend':{'src/analysis-role-tools.ts','src/assets.ts','src/editable-design-tools.ts','src/editable-project-source.ts','src/editable-projects.ts','src/portable-design-evidence.ts'},
 'web':{'contracts/product-downloads.json','src/editable-projects.tsx','src/editable-projects.css','src/design-canvas.tsx'},
 'admin':set(),'desktop':{'renderer/src/editable-projects.tsx','renderer/src/editable-projects.css','renderer/src/design-canvas.tsx'},
 'extension':set(),'delivery':set(),'docs':{'docs/README.md','docs/README.en.md'},
}
shared={'design-production-model.ts','design-resource-picker.tsx','design-template-start.tsx'}
new={
 'backend':{'contracts/design-production-route-additions-200.json','src/analysis-source.ts','src/design-evidence-source.ts','src/design-resources.ts','src/design-templates.ts','tests/brand-production-189-v3.test.ts','tests/dedicated-cloud-189-v3.test.ts','tests/design-production-200-v1.test.ts','tests/design-production-200-v2.test.ts','tests/route-inventory-200-v1.ts','tests/workspace-completion-196-v3.test.ts'},
 'web':{'src/'+p for p in shared}|{'tests/design-production-200.test.ts'},
 'desktop':{'renderer/src/'+p for p in shared}|{'tests/design-production-200.test.ts'},
 'admin':set(),'extension':set(),'delivery':set(),'docs':set(),
}

def allowed_new(name,p):
 if p in new[name]:return True
 if name=='docs':return p in ['docs/requirements/200-design-production-round.md','docs/development/200-design-production.md','docs/changes/200-design-production.md'] or p.startswith('docs/quality/integrated-round-200/') or bool(re.fullmatch(r'docs/tools/[a-z0-9-]+200(?:-v\d+)?\.py',p))
 if name in ['delivery','desktop'] and re.fullmatch(r'scripts/[a-z0-9-]+200(?:-v\d+)?\.(?:mjs|py|sh|ps1)',p):return True
 return bool(re.fullmatch(r'assets/screenshots/(?:200-[a-z0-9-]+\.png|workmate-200-v\d+-[a-z-]+\.(?:gif|mp4))',p))

def changed(folder):
 raw=git(folder,'diff-files','--name-only','--ignore-submodules=all').splitlines()
 return git(folder,'diff','--no-ext-diff','--no-textconv','--no-renames','--ignore-submodules=all','--name-only','--',*raw).splitlines() if raw else []
report={'stage':200,'status':'reviewing','at':datetime.now(timezone.utc).isoformat(),'heads_before':heads.copy(),'remote_before':baseline,'protected_files':len(protected),'reviewed':{},'committed':{}}
for name,folder in REPOS.items():
 assert not git(folder,'diff','--cached','--name-only'),'Unexpected existing staging: '+name
 edits=changed(folder);assert all(p in tracked[name] or name!='docs' and p in common for p in edits),{'component':name,'unexpected':set(edits)-tracked[name]-common}
 roots=['docs'] if name=='docs' else ['src','renderer/src','contracts','scripts','tests','assets/screenshots']
 others=git(folder,'ls-files','--others','--exclude-standard','--',*roots).splitlines();paths=edits+[p for p in others if allowed_new(name,p)]
 paths=[p for p in paths if (folder/p).relative_to(ROOT).as_posix() not in protected]
 assert paths,name+' has no reviewed changes'
 assert all(not p.startswith(('.data/','.env','node_modules/','dist/')) for p in paths)
 report['reviewed'][name]=paths
put('receipt.json',report)
for name,folder in REPOS.items():
 preserve();paths=report['reviewed'][name];git(folder,'add','--',*paths)
 staged=git(folder,'diff','--cached','--name-only').splitlines();assert set(staged)==set(paths),name
 diff=git(folder,'diff','--cached','--no-ext-diff','--no-textconv','--no-renames','--unified=0')
 assert not re.search(r'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|\bsk-[A-Za-z0-9_-]{25,}|cp_(?:admin_)?session=[A-Za-z0-9._-]{16,}',diff),'Credential-like staged value'
 git(folder,'diff','--cached','--check');git(folder,'commit','-m','feat: deliver layout-to-design production and exact shared evidence (200)')
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
