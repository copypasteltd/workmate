"""Review and atomically publish seven isolated repositories as eight ordinary refs."""
from pathlib import Path
from datetime import datetime,timezone
from uuid import uuid4
import json,hashlib,re,subprocess,os
R=Path(__file__).resolve().parents[2];D=R/'dev';L=D/'copypaste-delivery';Q=R/'docs/quality/integrated-round-205'
load=lambda p:json.loads(p.read_text('utf-8-sig'));sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
baseline=load(L/'.data/acceptance-205/baseline/receipt.json');protected=baseline['preserved_untracked']
repos={n:D/('copypaste-'+('platform' if n=='backend' else n)) for n in ['backend','web','admin','desktop','extension','delivery']};repos['docs']=R
def git(p,*args,timeout=240):
 return subprocess.check_output(['git','-c','core.fsmonitor=false','-c','gc.auto=0','-c','maintenance.auto=false',*args],cwd=p,text=True,encoding='utf-8',stderr=subprocess.PIPE,timeout=timeout).strip()
def refs():return {ref:oid for oid,ref in (line.split('\t',1) for line in git(R,'ls-remote','origin').splitlines()) if ref.startswith('refs/')}
def preserve():
 for p,h in protected.items():assert sha(R/p)==h,p
preserve();doc=load(Q/'documentation-check.json');assert doc['documentation_consistency_checks_passed'] and not doc['full_original_goal_accepted']
assert load(Q/'verification.json')['status']=='passed'
for name in ['live-production-journey','controlled-tool-feedback-ui','inner-downloads','network-preserved','final-service-state','runtime-cleanup']:assert load(Q/(name+'.json'))['status']=='passed',name
for row in load(Q/'final-source-manifest.json')['production_source_files']+load(Q/'final-source-manifest.json')['migration_files']:assert sha(R/row['path'])==row['sha256']
before=refs();heads={n:git(p,'rev-parse','HEAD') for n,p in repos.items()};assert heads==baseline['heads']
assert all(before['refs/heads/'+n]==h for n,h in heads.items()) and before['refs/heads/main']==heads['docs']
assert git(R,'remote','get-url','origin') in ['git@github.com:copypasteltd/workmate.git','https://github.com/copypasteltd/workmate.git']
out=L/'.data/publication-205'/str(uuid4());out.mkdir(parents=True,exist_ok=False)
report={'stage':205,'status':'reviewing','at':datetime.now(timezone.utc).isoformat(),'heads_before':heads.copy(),'remote_before':before,'reviewed':{},'committed':{},'full_public_download_gate':doc['full_public_download_gate'],'full_original_goal_accepted':False,'scope':'Measured application/source/bilingual documentation progress publication. Original open professional/external/operational/device checks remain explicit. No forced refs, credential publication, server networking changes or automatic full-goal claim.'}
def save():(out/'receipt.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf-8')
save()
try:
 for name,repo in repos.items():
  assert git(repo,'branch','--show-current')=='codex/'+name
  assert not git(repo,'diff','--cached','--name-only'),'Preserve pre-existing staged content'
  tracked=git(repo,'diff','--name-only').splitlines()
  def allowed(p):
   absolute=(repo/p).resolve();assert absolute.is_relative_to(repo.resolve())
   relative=absolute.relative_to(R).as_posix()
   if relative in protected:return False
   if name=='docs':return p in ['docs/README.md','docs/README.en.md'] or p.startswith('docs/quality/integrated-round-205/') or bool(re.fullmatch(r'docs/(?:requirements|development|changes)/205-[a-z0-9-]+\.md',p)) or bool(re.fullmatch(r'docs/tools/[a-z0-9-]*205-v[1-9][0-9]*\.py',p))
   return p in ['README.md','README.en.md','package.json','package-lock.json','contracts/product-downloads.json'] or p.startswith(('src/','renderer/src/','tests/','scripts/')) or (name=='backend' and p=='migrations/166-call-scoped-tool-outcomes.sql') or (p.startswith('assets/screenshots/') and '205-v' in p)
  assert all(allowed(p) for p in tracked),(name,tracked)
  # Enumerate only reviewed publication roots. Historical evidence directories
  # are immutable, large and outside this change; do not recursively scan them.
  known=set(git(repo,'ls-files').splitlines());candidates=[]
  folders=['docs/quality/integrated-round-205','docs/tools','docs/requirements','docs/development','docs/changes'] if name=='docs' else ['src','renderer/src','tests','scripts','assets/screenshots','migrations']
  for folder in folders:
   base=repo/folder
   if not base.is_dir():continue
   for parent,dirs,files in os.walk(base,followlinks=False):
    dirs[:]=[n for n in dirs if n not in ['.git','.data','node_modules','dist','release','test-results'] and not (Path(parent)/n).is_symlink()]
    for filename in files:
     absolute=Path(parent)/filename;relative=absolute.relative_to(repo).as_posix()
     if relative not in known and not absolute.is_symlink() and allowed(relative):candidates.append(relative)
  if candidates:
   check=subprocess.run(['git','-c','core.fsmonitor=false','-c','gc.auto=0','-c','maintenance.auto=false','check-ignore','--no-index','-z','--stdin'],cwd=repo,input=('\0'.join(candidates)+'\0').encode('utf-8'),capture_output=True,timeout=60)
   assert check.returncode in [0,1],check.stderr.decode('utf-8',errors='replace')
   ignored=set(check.stdout.decode('utf-8').rstrip('\0').split('\0')) if check.stdout else set()
   new=[p for p in candidates if p not in ignored]
  else:new=[]
  paths=tracked+[p for p in new if allowed(p)];assert paths and len(paths)==len(set(paths))
  assert all(not p.startswith(('.data/','.env','node_modules/','dist/','release/')) for p in paths)
  git(repo,'add','--',*paths);assert set(git(repo,'diff','--cached','--name-only').splitlines())==set(paths)
  diff=git(repo,'diff','--cached','--no-ext-diff','--no-textconv','--no-renames','--unified=0')
  assert not re.search(r'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|\bsk-[A-Za-z0-9_-]{25,}|Bearer\s+[A-Za-z0-9._-]{25,}|cp_(?:admin_)?session=[A-Za-z0-9._-]{16,}',diff),name
  git(repo,'diff','--cached','--check');report['reviewed'][name]=paths;save()
 for name,repo in repos.items():
  git(repo,'commit','-m',('docs: document measured205 delivery and retained full scope' if name=='docs' else 'fix: publish exact call delivery and measured205 client evidence'))
  heads[name]=git(repo,'rev-parse','HEAD');report['committed'][name]=heads[name];save();print(json.dumps({'committed':name,'files':len(report['reviewed'][name]),'head':heads[name]}),flush=True)
 for name,repo in repos.items():
  if name!='docs':git(R,'fetch','--no-tags',str(repo),heads[name],timeout=300)
 desired={'refs/heads/'+n:h for n,h in heads.items()};desired['refs/heads/main']=heads['docs'];assert refs()==before,'Remote moved; preserve external history'
 for ref,h in desired.items():git(R,'merge-base','--is-ancestor',before[ref],h)
 preserve();report.update(status='ready_to_push',desired=desired);save()
 git(R,'push','--atomic','origin',*[h+':'+ref for ref,h in desired.items()],timeout=420)
 after=refs();assert all(after.get(ref)==h for ref,h in desired.items())
 assert {k:v for k,v in before.items() if k not in desired}=={k:v for k,v in after.items() if k not in desired}
 for name,repo in repos.items():assert not git(repo,'diff','--name-only') and not git(repo,'diff','--cached','--name-only')
 preserve();report.update(status='published_and_read_back',completed_at=datetime.now(timezone.utc).isoformat(),verified_remote=desired,protected_files_preserved=len(protected),unrelated_refs_preserved=True);save()
 print(json.dumps({'status':report['status'],'refs':desired,'full_public_download_gate':doc['full_public_download_gate'],'receipt':str(out/'receipt.json')},ensure_ascii=False),flush=True)
except Exception:
 report.update(status='publication_stopped_preserving_state',last_local_heads={n:git(p,'rev-parse','HEAD') for n,p in repos.items()});save();raise
