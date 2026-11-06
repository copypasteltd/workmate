"""Review and publish this round's owned changes; ordinary atomic eight-ref push."""
from pathlib import Path
from datetime import datetime,timezone
from uuid import uuid4
import hashlib,json,re,subprocess
R=Path(__file__).resolve().parents[2];D=R/'dev';L=D/'copypaste-delivery';Q=R/'docs/quality/integrated-round-204';OUT=L/'.data/publication-204'/str(uuid4());OUT.mkdir(parents=True,exist_ok=False)
repos={'backend':D/'copypaste-platform','web':D/'copypaste-web','admin':D/'copypaste-admin','desktop':D/'copypaste-desktop','extension':D/'copypaste-extension','delivery':L,'docs':R}
def git(p,*args,timeout=180):return subprocess.check_output(['git','-c','core.fsmonitor=false','-c','gc.auto=0','-c','maintenance.auto=false',*args],cwd=p,text=True,encoding='utf-8',stderr=subprocess.PIPE,timeout=timeout).strip()
load=lambda p:json.loads(p.read_text('utf-8-sig'))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def save(v):(OUT/'receipt.json').write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def refs():return {ref:oid for oid,ref in (line.split('\t',1) for line in git(R,'ls-remote','origin').splitlines()) if ref.startswith('refs/')}
base=load(L/'.data/acceptance-204/baseline/receipt.json');protected=base['preserved_untracked']
def preserve():
 for p,digest in protected.items():assert sha(R/p)==digest,p
preserve();heads={n:git(p,'rev-parse','HEAD') for n,p in repos.items()};assert heads==base['heads'];remote=refs()
for n,h in heads.items():assert remote['refs/heads/'+n]==h
assert remote['refs/heads/main']==heads['docs']
for n,p in repos.items():assert git(p,'branch','--show-current')=='codex/'+n and not git(p,'diff','--cached','--name-only')
for name in ['verification.json','live-production-journey.json','controlled-tool-feedback-ui.json','inner-downloads.json','runtime-cleanup.json','network-preserved.json']:
 assert load(Q/name)['status']=='passed',name
assert load(Q/'network-preserved.json')['network_configuration_unchanged']
assert load(Q/'deployment.json')['status']=='deployed'
doc=load(Q/'documentation-check.json');pub=load(Q/'public-downloads.json');gate=load(Q/'open-public-download-gate.json')
assert doc['documentation_consistency_checks_passed'] and doc['full_original_goal_accepted'] is False
assert doc['full_public_download_gate']==pub['full_public_download_gate']==gate['full_public_download_gate']
assert doc['status']==('passed' if pub['full_public_download_gate'] else 'documented_with_open_checks')
assert pub['status']==('passed' if pub['full_public_download_gate'] else 'partial')
assert gate['status']==('passed' if pub['full_public_download_gate'] else 'not_passed')
common={'README.md','README.en.md','package.json','package-lock.json'}
tracked={
 'backend':{'src/server.ts','src/runtime.ts','src/task-business-tools.ts','src/task-events.ts','src/schema-compatibility.ts','src/worker.ts','src/provider-request-control.ts','src/audio-authorizations.ts','src/audio-production.ts','src/video-jobs.ts'},
 'web':{'src/main.tsx','src/task-events.ts','src/task-workbench.tsx','contracts/product-downloads.json'},
 'desktop':{'renderer/src/main.tsx','renderer/src/task-events.ts','renderer/src/task-workbench.tsx'},
 'admin':set(),'extension':set(),'delivery':set(),'docs':{'docs/README.md','docs/README.en.md'}}
new_specific={
 'backend':{'src/runtime-tool-feedback.ts','migrations/164-independent-cloud-task-leases.sql','migrations/165-native-transaction-lease-compatibility-v2.sql','tests/audio-authorization-upgrade-189-v2.test.ts','tests/audio-accounting-188-v2.test.ts'},
 'web':{'src/task-tool-state.ts','src/task-tool-feedback.tsx','src/task-tool-feedback.css'},
 'desktop':{'renderer/src/task-tool-state.ts','renderer/src/task-tool-feedback.tsx','renderer/src/task-tool-feedback.css'},
 'admin':set(),'extension':set(),'delivery':set(),'docs':set()}
media=load(Q/'actual-media.json');qualified_media={r['path'] for r in media['files']}
def allowed(n,p):
 if p in new_specific[n]:return True
 if n!='docs' and (repos[n]/p).relative_to(D).as_posix() in qualified_media:return True
 if n=='docs':return p.startswith('docs/quality/integrated-round-204/') or bool(re.fullmatch(r'docs/(?:requirements|development|changes)/204-[a-z0-9-]+\.md',p)) or bool(re.fullmatch(r'docs/tools/[a-z0-9-]+204(?:-v\d+)?\.py',p))
 if n in ['backend','web','desktop','delivery'] and re.fullmatch(r'(?:scripts|tests)/[a-z0-9-]+204-v\d+\.(?:test\.)?(?:mjs|py|sh|ps1|tsx|ts)',p):return True
 return False
def changed(p):
 names=git(p,'diff-files','--name-only','--ignore-submodules=all').splitlines()
 return git(p,'diff','--no-ext-diff','--no-textconv','--no-renames','--ignore-submodules=all','--name-only','--',*names).splitlines() if names else []
report={'stage':204,'status':'reviewing','publication_scope':'Deployed application update and truthful progress documents; not full product or public-download acceptance','full_public_download_gate':pub['full_public_download_gate'],'full_original_goal_accepted':False,'at':datetime.now(timezone.utc).isoformat(),'heads_before':heads.copy(),'remote_before':remote,'protected_files':len(protected),'reviewed':{},'committed':{}}
for n,p in repos.items():
 edits=changed(p);assert all(v in tracked[n] or n!='docs' and v in common for v in edits),{'repo':n,'unexpected':set(edits)-tracked[n]-common}
 roots=['docs'] if n=='docs' else ['src','renderer/src','scripts','tests','migrations','contracts','assets/screenshots']
 new=git(p,'ls-files','--others','--exclude-standard','--',*roots).splitlines();paths=edits+[v for v in new if allowed(n,v)]
 paths=[v for v in paths if (p/v).relative_to(R).as_posix() not in protected];assert paths,n
 assert all(not v.startswith(('.data/','.env','node_modules/','dist/')) for v in paths)
 report['reviewed'][n]=paths
save(report)
for n,p in repos.items():
 preserve();paths=report['reviewed'][n];git(p,'add','--',*paths);assert set(git(p,'diff','--cached','--name-only').splitlines())==set(paths)
 diff=git(p,'diff','--cached','--no-ext-diff','--no-textconv','--no-renames','--unified=0')
 assert not re.search(r'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|\bsk-[A-Za-z0-9_-]{25,}|cp_(?:admin_)?session=[A-Za-z0-9._-]{16,}',diff),'Credential-like staged content'
 git(p,'diff','--cached','--check')
 message={'backend':'fix: fence cloud leases independently and retain safe tool outcomes (204)','web':'feat: show truthful recoverable delivery feedback (204)','desktop':'feat: retain task delivery feedback in frameless client (204)','delivery':'fix: publish verified clients without server network changes (204)'}.get(n,'docs: record current delivery behavior and acceptance limits (204)')
 git(p,'commit','-m',message);heads[n]=git(p,'rev-parse','HEAD');report['committed'][n]=heads[n];save(report);print(json.dumps({'committed':n,'head':heads[n],'files':len(paths)}),flush=True)
for n,p in repos.items():
 if n!='docs':git(R,'fetch','--no-tags',str(p),heads[n],timeout=240)
desired={'refs/heads/'+n:h for n,h in heads.items()};desired['refs/heads/main']=heads['docs'];before=refs();assert all(before.get(ref)==remote.get(ref) for ref in desired)
for ref,h in desired.items():git(R,'merge-base','--is-ancestor',remote[ref],h)
report.update(status='ready_to_push',desired=desired);save(report);git(R,'push','--atomic','origin',*[h+':'+ref for ref,h in desired.items()],timeout=360)
after=refs();assert all(after.get(ref)==h for ref,h in desired.items())
for n,p in repos.items():assert not changed(p) and not git(p,'diff','--cached','--name-only')
preserve();report.update(status='published_and_read_back',completed_at=datetime.now(timezone.utc).isoformat(),verified_remote=desired,unrelated_refs_preserved={k:v for k,v in before.items() if k not in desired}=={k:v for k,v in after.items() if k not in desired});save(report);print(json.dumps({'status':report['status'],'refs':desired,'receipt':str(OUT/'receipt.json')},ensure_ascii=False),flush=True)
