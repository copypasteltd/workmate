"""Ordinary reviewed eight-ref atomic publication with remote readback."""
from pathlib import Path
from datetime import datetime,timezone
from uuid import uuid4
import hashlib,json,re,subprocess
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';DELIVERY=DEV/'copypaste-delivery'
OUT=DELIVERY/'.data/publication-202'/str(uuid4());OUT.mkdir(parents=True,exist_ok=False)
REPOS={'backend':DEV/'copypaste-platform','web':DEV/'copypaste-web','admin':DEV/'copypaste-admin','desktop':DEV/'copypaste-desktop','extension':DEV/'copypaste-extension','delivery':DELIVERY,'docs':ROOT}
EXPECTED={'backend': 'b52d1031a30600379c588e707d669e1be5854f5e', 'web': 'b10da8864e302f383d4fad855238b4ac84a94b45', 'admin': '565f031c28eda69dd269af7ad1a1bdd769ed5348', 'desktop': '17a75452376b4f4e05c620e306f668fbab7d1982', 'extension': 'abdcf89a1ff11a8bf1df27bc3a05510fa149798a', 'delivery': 'b1c4539ee58a39a8cb796eb49ed986afaea6b1b3', 'docs': '3eb577b144aede02e08c85b87e430e8e93db29a3'}

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
assert load(DELIVERY/'.data/integrated-202-v5/verification.json')['state']=='passed'
assert load(ROOT/'docs/quality/integrated-round-202/network-preserved.json')['network_configuration_unchanged']
assert load(ROOT/'docs/quality/integrated-round-202/documentation-check.json')['status']=='passed'
assert load(ROOT/'docs/quality/integrated-round-202/live-production-journey.json')['status']=='passed'
assert load(ROOT/'docs/quality/integrated-round-202/isolated-production-journey.json')['status']=='passed'
assert load(ROOT/'docs/quality/integrated-round-202/public-downloads.json')['status']=='passed'
assert load(ROOT/'docs/quality/integrated-round-202/inner-downloads.json')['status']=='passed'
assert load(ROOT/'docs/quality/integrated-round-202/deployment.json')['deployment']['backend_root'].endswith('integrated-202-v2/backend')
common={'README.md','README.en.md','package.json','package-lock.json'}
tracked={
 'backend':{'src/analysis-reports.ts','src/analytics.ts','src/server.ts'},
 'web':{'contracts/product-downloads.json','src/api.ts','src/main.tsx','src/marketing-reports.tsx'},
 'admin':set(),'desktop':{'renderer/src/api.ts','renderer/src/main.tsx','renderer/src/marketing-reports.tsx','src/main.ts','src/download.ts','src/native-session.ts','src/preload.cts'},
 'extension':set(),'delivery':set(),'docs':{'AGENTS.md','docs/README.md','docs/README.en.md'},
}
shared={'analysis-history.tsx','analysis-request-state.ts','analysis-review-model.ts','analysis-review.css','analysis-review.tsx','review-download.ts'}
new={
 'backend':{'contracts/analysis-review-route-additions-202.json','src/analysis-review.ts','tests/analysis-review-202-v1.test.ts','tests/analysis-review-202-v2.test.ts','tests/analysis-review-202-v3.test.ts','tests/brand-production-189-v5.test.ts','tests/dedicated-cloud-189-v5.test.ts','tests/route-inventory-202-v1.ts','tests/workspace-completion-196-v5.test.ts','tests/seo-change-tasks-202-v1.test.ts','tests/current-test-discovery-189-v3.test.ts','tests/current-test-discovery-189-v4.test.ts','scripts/run-current-tests-owned-v15.mjs'},
 'web':{'src/'+p for p in shared}|{'tests/analysis-review-202.test.ts'},
 'desktop':{'renderer/src/'+p for p in shared}|{'src/analysis-download.ts','tests/analysis-review-202.test.ts','tests/analysis-download-202.test.ts'},
 'admin':set(),'extension':set(),'delivery':set(),'docs':set(),
}


def allowed_new(name,p):
 if p in new[name]:return True
 if name=='docs':return p in ['docs/governance/05-server-network-preservation.md','docs/requirements/202-marketing-review-round.md','docs/development/202-marketing-review.md','docs/changes/202-marketing-review.md'] or p.startswith('docs/quality/integrated-round-202/') or bool(re.fullmatch(r'docs/tools/[a-z0-9-]+202(?:-v\d+)?\.py',p))
 if name in ['delivery','desktop'] and re.fullmatch(r'scripts/[a-z0-9-]+202(?:-v\d+)?\.(?:mjs|py|sh|ps1)',p):return True
 return bool(re.fullmatch(r'assets/screenshots/(?:202-[a-z0-9-]+\.png|workmate-202-v\d+-[a-z-]+\.(?:gif|mp4))',p))

def changed(folder):
 raw=git(folder,'diff-files','--name-only','--ignore-submodules=all').splitlines()
 return git(folder,'diff','--no-ext-diff','--no-textconv','--no-renames','--ignore-submodules=all','--name-only','--',*raw).splitlines() if raw else []
report={'stage':202,'status':'reviewing','at':datetime.now(timezone.utc).isoformat(),'heads_before':heads.copy(),'remote_before':baseline,'protected_files':len(protected),'reviewed':{},'committed':{}}
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
 git(folder,'diff','--cached','--check');git(folder,'commit','-m','feat: deliver marketing evidence review and verified native exports (202)')
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
