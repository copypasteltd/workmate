"""Apply source-bound native-browser I/O and deadline fixes after full03 closes."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import json
import re
import shutil
import subprocess

ROOT=Path(__file__).resolve().parents[2]
DEV=ROOT/'dev'
P=DEV/'copypaste-platform'
L=DEV/'copypaste-delivery'
CANDIDATE=DEV/'copypaste-platform-recovery-120'
OUTPUT=L/'evidence/integrated-recovery-native-browser-application-02.json'
parser=argparse.ArgumentParser()
parser.add_argument('--native-attempt',required=True)
attempt=parser.parse_args().native_attempt
assert re.fullmatch(r'\d{2}',attempt) and int(attempt)>=5
assert not OUTPUT.exists()
digest=lambda p:sha256(p.read_bytes()).hexdigest()
read=lambda p:json.loads(p.read_text(encoding='utf-8'))
full_path=L/'evidence/integrated-recovery-full-03.json'
full=read(full_path)
assert full['status']=='failed' and full['source_unchanged'] and full['owned_database_shutdown']
raw=L/full['raw_report']['path']
assert digest(raw)==full['raw_report']['sha256']
failures=re.findall(r'^not ok \d+ - (.*?)\r?$',raw.read_text('utf-8'),re.M)
expected={
    'native preview preserves actual failed assertions and script exceptions even when the browser exits zero',
    'external HTTP, WebSocket, RTC, filesystem and browser features cannot reach owned canaries or read controller secrets',
    'each preview has fresh browser storage; local navigation and cookie state exist only inside that invocation',
    'customer frames cannot read their controller, navigate the top document or launch external application protocols',
    'asynchronous DOM state is polled and cancellation of one preview leaves a simultaneous owned preview intact',
}
assert set(failures)==expected and len(failures)==full['counts']['fail']==5,failures
prior_path=L/'evidence/integrated-recovery-native-browser-application-01.json'
prior=read(prior_path)
assert prior['status']=='applied' and prior['verifier_sha256']==digest(ROOT/'docs/tools/apply_integrated_browser_recovery.py')
selected=['src/cloud-browser-host.cs','src/cloud-browser-reclamation.ts','src/cloud-browser-preview.ts','tests/cloud-browser-preview.test.ts']
qualified=read(CANDIDATE/f'.data/dedicated-cloud-121/browser-reclamation-{attempt}.json')
assert qualified['status']=='passed' and qualified['source_unchanged']
assert qualified['counts']=={'tests':11,'pass':11,'fail':0,'cancelled':0,'skipped':0,'todo':0}
changes=[]
for name in selected:
    before=digest(P/name)
    assert before==full['source_files']['copypaste-platform/'+name],name
    assert digest(CANDIDATE/name)==qualified['source_files'][name],name
    changes.append({'path':name,'before_sha256':before,'after_sha256':digest(CANDIDATE/name)})
for row in prior['changes']:
    assert digest(P/row['path'])==row['after_sha256'],row['path']
evidence=list(prior['qualified_native_browser_attempts'])
for number in range(3,int(attempt)+1):
    label=f'{number:02}'
    prefix=CANDIDATE/f'.data/dedicated-cloud-121/browser-reclamation-{label}'
    original=read(prefix.with_suffix('.json'))
    assert original['source_unchanged']
    target=L/f'evidence/native-browser-recovery-{label}'
    assert not target.exists()
    target.mkdir()
    for suffix,name in [('.json','report.json'),('.tap','raw.tap'),('-verifier.mjs','verifier.mjs')]:
        shutil.copyfile(Path(str(prefix)+suffix),target/name)
    assert digest(target/'raw.tap')==original['raw_sha256']
    for name,expected_hash in original['source_files'].items():
        source=Path(str(prefix)+'-sources')/name
        assert digest(source)==expected_hash,name
        output=target/'sources'/name
        output.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(source,output)
    evidence.append({'path':(target/'report.json').relative_to(L).as_posix(),'sha256':digest(target/'report.json'),
                     'raw_sha256':digest(target/'raw.tap'),'verifier_sha256':digest(target/'verifier.mjs'),
                     'counts':original['counts'],'status':original['status']})
for name in selected:
    shutil.copyfile(CANDIDATE/name,P/name)
subprocess.run(['node','scripts/setup-cloud-browser.mjs'],cwd=P,check=True)
manifest=P/'.data/cloud-browser-host/manifest.json'
assert read(manifest)['host_source_sha256']==digest(P/'src/cloud-browser-host.cs')
result={'at':datetime.now(timezone.utc).isoformat(),'status':'applied','changes':changes,
        'previous_application':{'path':prior_path.relative_to(L).as_posix(),'sha256':digest(prior_path)},
        'prior_complete_run':{'path':full_path.relative_to(L).as_posix(),'sha256':digest(full_path)},
        'qualified_native_browser_attempts':evidence,'selected_native_attempt':attempt,
        'runtime_manifest_sha256':digest(manifest),'verifier_sha256':digest(Path(__file__)),
        'scope':'Four browser files only. Durable ownership is retained; telemetry writes are coalesced while cancellation stays responsive. Navigation and sandbox attestation use the remaining caller budget, including a real finite page loading beyond five seconds. The six-second cleanup window and the native final deadline are separate from page execution; actual exit code and independently empty job remain required. The crash test removes mutable telemetry only after its actual writer exits. Candidate archives contain unrelated unfinished SQL129 code, which this browser run does not qualify. A complete delivered-source regression and final client/UI checks are still mandatory.'}
with OUTPUT.open('x',encoding='utf-8',newline='\n') as stream:
    json.dump(result,stream,ensure_ascii=False,indent=2);stream.write('\n')
print(json.dumps({'status':'applied','files':len(changes),'native_browser_counts':qualified['counts']}))
