"""Review only this round's owned changes; ordinary atomic8ref push/readback."""
from pathlib import Path
from datetime import datetime,timezone
from uuid import uuid4
import hashlib,json,re,subprocess
R=Path(__file__).resolve().parents[2];D=R/'dev';L=D/'copypaste-delivery';Q=R/'docs/quality/integrated-round-203';OUT=L/'.data/publication-203'/str(uuid4());OUT.mkdir(parents=True,exist_ok=False)
repos={'backend':D/'copypaste-platform','web':D/'copypaste-web','admin':D/'copypaste-admin','desktop':D/'copypaste-desktop','extension':D/'copypaste-extension','delivery':L,'docs':R}
def git(p,*a,timeout=180):return subprocess.check_output(['git','-c','core.fsmonitor=false','-c','gc.auto=0','-c','maintenance.auto=false',*a],cwd=p,text=True,encoding='utf-8',stderr=subprocess.PIPE,timeout=timeout).strip()
def load(p):return json.loads(p.read_text('utf-8-sig'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def save(v):(OUT/'receipt.json').write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n','utf-8')
def refs():return {ref:oid for oid,ref in (line.split('\t',1) for line in git(R,'ls-remote','origin').splitlines()) if ref.startswith('refs/')}
base=load(L/'.data/acceptance-203/baseline/receipt.json');protected=base['preserved_untracked']
def preserve():
 for p,digest in protected.items():assert sha(R/p)==digest,p
preserve();heads={n:git(p,'rev-parse','HEAD') for n,p in repos.items()};assert heads==base['heads'];remote=refs()
for n,h in heads.items():assert remote['refs/heads/'+n]==h
assert remote['refs/heads/main']==heads['docs']
for n,p in repos.items():assert git(p,'branch','--show-current')=='codex/'+n and not git(p,'diff','--cached','--name-only')
for name in ['verification.json','documentation-check.json','live-production-journey.json','isolated-production-journey.json','public-downloads.json','inner-downloads.json','runtime-cleanup.json','network-preserved.json']:
 assert load(Q/name)['status']=='passed',name
assert load(Q/'network-preserved.json')['network_configuration_unchanged']
assert load(Q/'deployment.json')['static']['api_restarted'] is False
common={'README.md','README.en.md','package.json','package-lock.json'}
tracked={
 'web':{'contracts/product-downloads.json','src/new-work-task.tsx','src/work-draft.ts','src/work-composer.tsx','src/cloud-asset-picker.tsx','src/ui.tsx','src/style.css','src/marketing-reports.tsx','src/analysis-review.css','src/new-work-task.css'},
 'desktop':{'renderer/src/ui.tsx','renderer/src/style.css','renderer/src/marketing-reports.tsx','renderer/src/analysis-review.css','renderer/src/cloud-asset-picker.tsx'},
 'backend':set(),'admin':set(),'extension':set(),'delivery':set(),'docs':{'docs/README.md','docs/README.en.md'}}
specific={'web':{'src/work-attachments.ts','tests/work-draft-203-v1.test.ts','tests/work-inputs-203-v1.test.ts','scripts/run-current-tests-203-v1.mjs'},'desktop':set(),'backend':set(),'admin':set(),'extension':set(),'delivery':set(),'docs':set()}
def allowed(n,p):
 if p in specific[n]:return True
 if n=='docs':return p in ['docs/requirements/203-specialist-intake-and-client-review.md','docs/development/203-specialist-intake-and-runtime.md','docs/changes/203-specialist-intake.md'] or p.startswith('docs/quality/integrated-round-203/') or bool(re.fullmatch(r'docs/tools/[a-z0-9-]+203(?:-v\d+)?\.py',p))
 if n in ['delivery','desktop'] and re.fullmatch(r'scripts/[a-z0-9-]+203(?:-v\d+)?\.(?:mjs|py|sh|ps1)',p):return True
 # Only final actual deployed media are published. Failed/intermediate media stay
 # intact locally, with their qualification and limitations documented separately.
 return bool(re.fullmatch(r'assets/screenshots/(?:203-v4-(?:marketing-review-live|specialist-intake-live)\.png|workmate-203-v4-(?:marketing-review-live|specialist-intake-live)\.(?:gif|mp4))',p))
def changed(p):
 names=git(p,'diff-files','--name-only','--ignore-submodules=all').splitlines()
 return git(p,'diff','--no-ext-diff','--no-textconv','--no-renames','--ignore-submodules=all','--name-only','--',*names).splitlines() if names else []
report={'stage':203,'status':'reviewing','at':datetime.now(timezone.utc).isoformat(),'heads_before':heads.copy(),'remote_before':remote,'protected_files':len(protected),'reviewed':{},'committed':{}}
for n,p in repos.items():
 edits=changed(p);assert all(v in tracked[n] or n!='docs' and v in common for v in edits),{'repo':n,'unexpected':set(edits)-tracked[n]-common}
 roots=['docs'] if n=='docs' else ['src','renderer/src','scripts','tests','contracts','assets/screenshots']
 new=git(p,'ls-files','--others','--exclude-standard','--',*roots).splitlines();paths=edits+[v for v in new if allowed(n,v)]
 paths=[v for v in paths if (p/v).relative_to(R).as_posix() not in protected];assert paths,n
 assert all(not v.startswith(('.data/','.env','node_modules/','dist/')) for v in paths)
 report['reviewed'][n]=paths
save(report)
for n,p in repos.items():
 preserve();paths=report['reviewed'][n];git(p,'add','--',*paths);staged=git(p,'diff','--cached','--name-only').splitlines();assert set(staged)==set(paths)
 diff=git(p,'diff','--cached','--no-ext-diff','--no-textconv','--no-renames','--unified=0');assert not re.search(r'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|\bsk-[A-Za-z0-9_-]{25,}|cp_(?:admin_)?session=[A-Za-z0-9._-]{16,}',diff),'Credential-like staged content'
 git(p,'diff','--cached','--check');message=('docs: record specialist delivery and preserved server networking (203)' if n in ['backend','admin','extension','docs'] else 'feat: deliver pinned specialist intake and native review (203)' if n in ['web','desktop'] else 'fix: preserve native runtime layout and publish verified clients (203)')
 git(p,'commit','-m',message);heads[n]=git(p,'rev-parse','HEAD');report['committed'][n]=heads[n];save(report);print(json.dumps({'committed':n,'head':heads[n],'files':len(staged)}),flush=True)
for n,p in repos.items():
 if n!='docs':git(R,'fetch','--no-tags',str(p),heads[n],timeout=240)
desired={'refs/heads/'+n:h for n,h in heads.items()};desired['refs/heads/main']=heads['docs'];before=refs();assert all(before.get(ref)==remote.get(ref) for ref in desired)
for ref,h in desired.items():git(R,'merge-base','--is-ancestor',remote[ref],h)
report.update(status='ready_to_push',desired=desired);save(report);git(R,'push','--atomic','origin',*[h+':'+ref for ref,h in desired.items()],timeout=360)
after=refs();assert all(after.get(ref)==h for ref,h in desired.items())
for n,p in repos.items():assert not changed(p) and not git(p,'diff','--cached','--name-only')
preserve();report.update(status='published_and_read_back',completed_at=datetime.now(timezone.utc).isoformat(),verified_remote=desired,unrelated_refs_preserved={k:v for k,v in before.items() if k not in desired}=={k:v for k,v in after.items() if k not in desired});save(report);print(json.dumps({'status':report['status'],'refs':desired,'receipt':str(OUT/'receipt.json')},ensure_ascii=False),flush=True)
