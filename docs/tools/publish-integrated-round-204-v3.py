"""Continue the reviewed atomic publication; preserve one immutable format defect."""
from pathlib import Path
from datetime import datetime,timezone
from uuid import uuid4
import hashlib,json,re,subprocess

R=Path(__file__).resolve().parents[2];D=R/'dev';L=D/'copypaste-delivery';Q=R/'docs/quality/integrated-round-204'
old_path=L/'.data/publication-204/abf283b1-b042-4404-992b-fce6a189c540/receipt.json'
load=lambda p:json.loads(p.read_text('utf-8-sig'))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
old=load(old_path);assert set(old['committed'])=={'backend','web','admin','desktop','extension'}
repos={'backend':D/'copypaste-platform','web':D/'copypaste-web','admin':D/'copypaste-admin','desktop':D/'copypaste-desktop','extension':D/'copypaste-extension','delivery':L,'docs':R}
def git(p,*args,timeout=180):return subprocess.check_output(['git','-c','core.fsmonitor=false','-c','gc.auto=0','-c','maintenance.auto=false',*args],cwd=p,text=True,encoding='utf-8',stderr=subprocess.PIPE,timeout=timeout).strip()
def refs():return {ref:oid for oid,ref in (line.split('\t',1) for line in git(R,'ls-remote','origin').splitlines()) if ref.startswith('refs/')}
protected=load(L/'.data/acceptance-204/baseline/receipt.json')['preserved_untracked']
def preserve():
 for path,digest in protected.items():assert sha(R/path)==digest,path
preserve();before=refs();assert before==old['remote_before'],'Remote changed; preserve its history and review before publication'
heads={n:git(p,'rev-parse','HEAD') for n,p in repos.items()}
assert heads=={n:old['committed'].get(n,old['heads_before'][n]) for n in repos}
for n,p in repos.items():
 assert git(p,'branch','--show-current')=='codex/'+n
 if n in old['committed']:assert not git(p,'diff','--name-only') and not git(p,'diff','--cached','--name-only')
assert set(git(L,'diff','--cached','--name-only').splitlines())==set(old['reviewed']['delivery'])
git(L,'diff','--exit-code','--',*old['reviewed']['delivery'])
assert not git(R,'diff','--cached','--name-only')
doc=load(Q/'documentation-check.json');pub=load(Q/'public-downloads.json');gate=load(Q/'open-public-download-gate.json')
assert doc['documentation_consistency_checks_passed'] and doc['full_original_goal_accepted'] is False
assert doc['full_public_download_gate']==pub['full_public_download_gate']==gate['full_public_download_gate']
assert doc['status']==('passed' if pub['full_public_download_gate'] else 'documented_with_open_checks')
assert pub['status']==('passed' if pub['full_public_download_gate'] else 'partial')
for name in ['verification','live-production-journey','controlled-tool-feedback-ui','inner-downloads','runtime-cleanup','network-preserved','final-service-state']:
 assert load(Q/(name+'.json'))['status']=='passed',name
for row in load(Q/'final-source-manifest.json')['production_source_files']+load(Q/'final-source-manifest.json')['migration_files']:assert sha(R/row['path'])==row['sha256']

out=L/'.data/publication-204'/str(uuid4());out.mkdir(exist_ok=False)
report={'stage':204,'status':'continuing_reviewed_publication','at':datetime.now(timezone.utc).isoformat(),'prior_receipt':str(old_path.relative_to(R)),'prior_receipt_sha256':sha(old_path),'prior_stopped_before_push':True,'heads_before_continuation':heads.copy(),'committed':dict(old['committed']),'full_public_download_gate':pub['full_public_download_gate'],'full_original_goal_accepted':False,'publication_scope':'Application/source/docs progress synchronization with an explicit unmet public-download gate','steps':[]}
def save():(out/'receipt.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
save()
try:
 immutable='scripts/verify-integrated-round-204-v10.mjs';file=L/immutable;digest=sha(file)
 r=subprocess.run(['git','-c','core.fsmonitor=false','diff','--cached','--check'],cwd=L,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 lines=r.stdout.decode('utf-8').splitlines()
 assert r.returncode in [1,2] and len(lines)==2 and lines[0]==immutable+':26: trailing whitespace.' and lines[1].startswith('+ await Promise.all(') and lines[1].endswith(' ')
 git(L,'diff','--cached','--check','--','.',':(exclude)'+immutable)
 note={'stage':204,'status':'immutable_historical_format_exception','file':'dev/copypaste-delivery/'+immutable,'file_sha256':digest,'line':26,'exception':'One trailing ASCII space on an already executed failed204-v10 verifier. Its exact source is preserved; no product code or test assertion is changed. All other staged paths pass the ordinary format check.','format_output_sha256':hashlib.sha256(r.stdout).hexdigest(),'format_stderr_sha256':hashlib.sha256(r.stderr).hexdigest(),'original_failed_verification_receipt_sha256':sha(L/'.data/integrated-204-v10/verification.json'),'original_failed_publication_receipt_sha256':sha(old_path),'full_public_download_gate':False}
 note_path=Q/'publication-format-provenance.json'
 with note_path.open('x',encoding='utf-8') as f:json.dump(note,f,ensure_ascii=False,indent=2);f.write('\n')
 assert sha(file)==digest
 git(L,'commit','-m','fix: publish measured clients and preserve original validation evidence (204)')
 heads['delivery']=git(L,'rev-parse','HEAD');report['committed']['delivery']=heads['delivery'];report['steps'].append('delivery_committed_with_exact_historical_format_exception');save();print(json.dumps({'committed':'delivery','head':heads['delivery']}),flush=True)

 edits=git(R,'diff','--name-only').splitlines();assert set(edits)=={'docs/README.md','docs/README.en.md'}
 def allowed(path):return path.startswith('docs/quality/integrated-round-204/') or bool(re.fullmatch(r'docs/(?:requirements|development|changes)/204-[a-z0-9-]+\.md',path)) or bool(re.fullmatch(r'docs/tools/[a-z0-9-]+204(?:-v\d+)?\.py',path))
 new=git(R,'ls-files','--others','--exclude-standard','--','docs').splitlines()
 paths=edits+[p for p in new if allowed(p) and p not in protected]
 assert set(old['reviewed']['docs']).issubset(paths)
 assert all(not p.startswith(('.data/','.env','dev/')) for p in paths)
 git(R,'add','--',*paths);assert set(git(R,'diff','--cached','--name-only').splitlines())==set(paths)
 diff=git(R,'diff','--cached','--no-ext-diff','--no-textconv','--no-renames','--unified=0')
 assert not re.search(r'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|\bsk-[A-Za-z0-9_-]{25,}|cp_(?:admin_)?session=[A-Za-z0-9._-]{16,}',diff)
 git(R,'diff','--cached','--check');git(R,'commit','-m','docs: record deployed204 evidence and unmet public download acceptance')
 heads['docs']=git(R,'rev-parse','HEAD');report['committed']['docs']=heads['docs'];report['reviewed_docs_paths']=paths;save();print(json.dumps({'committed':'docs','head':heads['docs'],'files':len(paths)}),flush=True)
 for n,p in repos.items():
  if n!='docs':git(R,'fetch','--no-tags',str(p),heads[n],timeout=240)
 desired={'refs/heads/'+n:h for n,h in heads.items()};desired['refs/heads/main']=heads['docs'];now=refs();assert now==before
 for ref,h in desired.items():git(R,'merge-base','--is-ancestor',before[ref],h)
 preserve();report.update(status='ready_to_push',desired=desired);save()
 git(R,'push','--atomic','origin',*[h+':'+ref for ref,h in desired.items()],timeout=360)
 after=refs();assert all(after.get(ref)==h for ref,h in desired.items())
 assert {k:v for k,v in before.items() if k not in desired}=={k:v for k,v in after.items() if k not in desired}
 for n,p in repos.items():assert not git(p,'diff','--name-only') and not git(p,'diff','--cached','--name-only')
 preserve();assert sha(file)==digest
 report.update(status='published_and_read_back',completed_at=datetime.now(timezone.utc).isoformat(),verified_remote=desired,protected_files_preserved=len(protected),unrelated_refs_preserved=True);save()
 print(json.dumps({'status':report['status'],'refs':desired,'full_public_download_gate':pub['full_public_download_gate'],'receipt':str(out/'receipt.json')},ensure_ascii=False),flush=True)
except Exception:
 report['status']='failed_continuation_preserved';report['last_observed_local_heads']={n:git(p,'rev-parse','HEAD') for n,p in repos.items()};save();raise
