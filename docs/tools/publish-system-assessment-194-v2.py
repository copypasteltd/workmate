"""Resume the assessment publication after automatic Git maintenance timed out."""
from pathlib import Path
from datetime import datetime, timezone
from uuid import uuid4
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DELIVERY = ROOT / 'dev/copypaste-delivery'
OUT = DELIVERY / '.data/assessment-194' / ('publication-' + str(uuid4()))
OUT.mkdir(parents=True, exist_ok=False)
REPOS = {'docs':ROOT,'backend':ROOT/'dev/copypaste-platform','web':ROOT/'dev/copypaste-web','admin':ROOT/'dev/copypaste-admin','desktop':ROOT/'dev/copypaste-desktop','extension':ROOT/'dev/copypaste-extension','delivery':DELIVERY}

def git(cwd, *args, timeout=90):
    return subprocess.check_output(['git','-c','core.fsmonitor=false','-c','gc.auto=0','-c','maintenance.auto=false',*args],cwd=cwd,text=True,encoding='utf-8',errors='strict',stderr=subprocess.PIPE,timeout=timeout).strip()

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def refs():
    return {ref:oid for oid,ref in (line.split('\t',1) for line in git(ROOT,'ls-remote','origin').splitlines())}

def put(name,value):
    (OUT/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

report={'stage':194,'at':datetime.now(timezone.utc).isoformat(),'scope':'Assessment documentation and read-only diagnostic scripts only; no application release or deployment.','status':'preparing'}
put('receipt.json',report)
old = json.loads((DELIVERY/'.data/acceptance-193/baseline/receipt.json').read_text(encoding='utf-8'))
protected = old['preserved_untracked']
def preserve():
    for relative,expected in protected.items():
        target=(ROOT/relative).resolve()
        assert target.is_relative_to(ROOT) and target.is_file(),relative
        assert digest(target)==expected,'Protected user file changed: '+relative
preserve()

baseline=refs()
heads={name:git(folder,'rev-parse','HEAD') for name,folder in REPOS.items()}
previous=[p for p in (DELIVERY/'.data/assessment-194').glob('publication-*') if p!=OUT and (p/'baseline.json').is_file()]
assert len(previous)==1,'Expected one original publication attempt'
prior=json.loads((previous[0]/'baseline.json').read_text(encoding='utf-8'))
assert prior['remote']==baseline,'Remote changed since the original attempt'
report['previous_attempt']={'path':str(previous[0]),'outcome':'Delivery commit completed; parent command timed out during automatic Git maintenance. That maintenance was stopped; original source and receipt remain preserved.'}
for name,folder in REPOS.items():
    assert not git(folder,'diff','--cached','--name-only'),'Unexpected staged files: '+name
    if name not in ['docs','delivery']:
        assert not git(folder,'diff','--name-only'),'Unrelated tracked changes: '+name
for name in ['backend','web','admin','desktop','extension']:
    assert baseline['refs/heads/'+name]==heads[name],'Remote advanced: '+name
assert baseline['refs/heads/docs']==baseline['refs/heads/main']==heads['docs'],'Remote docs advanced'
put('baseline.json',{'remote':baseline,'heads':heads,'protected_user_files':protected})

doc_paths=['docs/README.md','docs/README.en.md','docs/changes/194-system-assessment.md','docs/tools/build-system-assessment-194.py','docs/tools/publish-system-assessment-194-v1.py','docs/tools/publish-system-assessment-194-v2.py','docs/quality/system-assessment-194']
delivery_paths=['README.md','README.en.md','scripts/inspect-system-assessment-194-v1.sh','scripts/inspect-system-assessment-194-v2.sh','scripts/probe-system-assessment-194-v1.mjs','scripts/probe-system-assessment-194-v2.mjs']
assert git(DELIVERY,'rev-list','--count',baseline['refs/heads/delivery']+'..HEAD')=='1'
assert git(DELIVERY,'log','-1','--format=%s')=='docs: record current product completeness and WorkBuddy gaps (194)'
assert set(git(DELIVERY,'diff','--name-only',baseline['refs/heads/delivery'],'HEAD').splitlines())==set(delivery_paths)
for name,paths in [('docs',doc_paths),('delivery',delivery_paths)]:
    changed=git(REPOS[name],'diff','--name-only').splitlines()
    assert all(any(p==allowed or p.startswith(allowed+'/') for allowed in paths) for p in changed),'Unexpected tracked change'

assessment=json.loads((ROOT/'docs/quality/system-assessment-194/assessment.json').read_text(encoding='utf-8'))
assert len(assessment['current_open_groups'])==32 and len(assessment['requirements'])==102
assert len(assessment['independent_reviews'])==9
for item in assessment['independent_reviews']:
    assert digest(ROOT/'docs/quality/system-assessment-194'/item['file'])==item['sha256']
for doc in (ROOT/'docs/quality/system-assessment-194').glob('*.md'):
    for target in re.findall(r'\]\(([^)]+)\)',doc.read_text(encoding='utf-8')):
        if re.match(r'https?://|#',target):
            continue
        assert (doc.parent/target.split('#')[0]).resolve().exists(),'Broken local link: '+target

report['protected_user_files_verified']=len(protected)
report['baseline_remote_ref_count']=len(baseline)
report['scope_validation']='32 groups, 102 requirement traces, 9 independent reports; local report links resolve'
for name,paths in [('delivery',delivery_paths),('docs',doc_paths)]:
    folder=REPOS[name]
    git(folder,'add','--',*paths)
    staged=git(folder,'diff','--cached','--name-only').splitlines()
    if name=='delivery':
        assert not staged,'Previously completed delivery commit must be preserved'
        report.setdefault('staged',{})[name]=[]
        continue
    assert staged and all(any(p==allowed or p.startswith(allowed+'/') for allowed in paths) for p in staged)
    diff=git(folder,'diff','--cached','--no-ext-diff','--unified=0')
    assert not re.search(r'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|\bsk-[A-Za-z0-9_-]{25,}',diff),'Credential-like staged content'
    report.setdefault('staged',{})[name]=staged
    git(folder,'diff','--cached','--check')
    git(folder,'commit','-m','docs: record current product completeness and WorkBuddy gaps (194)',timeout=120)
    heads[name]=git(folder,'rev-parse','HEAD')

git(ROOT,'fetch','--no-tags',str(DELIVERY),'codex/delivery',timeout=120)
desired={'refs/heads/'+name:heads[name] for name in ['backend','web','admin','desktop','extension','delivery']}
desired['refs/heads/docs']=desired['refs/heads/main']=heads['docs']
assert refs()==baseline,'Remote changed before publication; local commits preserved'
for ref,head in desired.items():
    git(ROOT,'cat-file','-e',head+'^{commit}')
    git(ROOT,'merge-base','--is-ancestor',baseline[ref],head)
report['desired']=desired
report['status']='ready_to_push'
put('receipt.json',report)
git(ROOT,'push','--atomic','origin',*[oid+':'+ref for ref,oid in desired.items()],timeout=180)
after=refs()
assert all(after.get(ref)==oid for ref,oid in desired.items())
assert {k:v for k,v in after.items() if k not in desired}=={k:v for k,v in baseline.items() if k not in desired},'Unrelated refs changed'
assert len(after)==len(baseline)
for name,folder in REPOS.items():
    assert not git(folder,'diff','--name-only') and not git(folder,'diff','--cached','--name-only')
    assert git(folder,'rev-parse','HEAD')==heads[name]
preserve()
report['status']='published_and_read_back'
report['remote_ref_count']=len(after)
report['verified_remote']=desired
report['unchanged_other_refs']=len(after)-len(desired)
report['at_completed']=datetime.now(timezone.utc).isoformat()
put('receipt.json',report)
print(json.dumps({'status':report['status'],'refs':desired,'protected_user_files':len(protected),'remote_refs':len(after),'receipt':str(OUT/'receipt.json')},ensure_ascii=False))
