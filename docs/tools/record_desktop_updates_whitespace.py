"""Check editable staged whitespace, preserving exact raw logs/source archives."""
from datetime import datetime,timezone
from hashlib import sha256
import argparse
import json
from pathlib import Path
import re
import subprocess

ROOT=Path(__file__).resolve().parents[2]
DEV=ROOT/'dev'
parser=argparse.ArgumentParser()
parser.add_argument('--report',default='desktop-updates-whitespace-01.json')
report_name=parser.parse_args().report
assert re.fullmatch(r'desktop-updates-whitespace-\d{2}\.json',report_name)
repositories={'docs':ROOT,**{name:DEV/('copypaste-'+name) for name in ['platform','web','admin','desktop','extension','delivery']}}
def git(repo,*args):
    return subprocess.run(['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false',*args],cwd=repo,capture_output=True)
archives={}
for report in (DEV/'copypaste-delivery/evidence').glob('desktop-browser-*.json'):
    data=json.loads(report.read_text(encoding='utf-8'))
    for name,value in data.get('source_files',{}).items():
        archives[report.with_suffix('').relative_to(DEV/'copypaste-delivery').as_posix()+'-sources/'+name]=value
for report in (DEV/'copypaste-delivery/evidence').glob('local-codex-native-*.json'):
    data=json.loads(report.read_text(encoding='utf-8'))
    archives.update({'evidence/'+report.stem+'-sources/'+name:value for name,value in data.get('source_files',{}).items()})
for report in [*(DEV/'copypaste-delivery/evidence').glob('solution-packages-native-*.json'), *(DEV/'copypaste-delivery/evidence').glob('native-methods-native-*.json'), *(DEV/'copypaste-delivery/evidence').glob('preset-specialists-native-*.json'), *(DEV/'copypaste-delivery/evidence').glob('cloud-program-core-*.json'), *(DEV/'copypaste-delivery/evidence').glob('cloud-development-core-*.json'), *(DEV/'copypaste-delivery/evidence').glob('cloud-browser-core-*.json'), *(DEV/'copypaste-delivery/evidence').glob('client-content-core-*.json'), *(DEV/'copypaste-delivery/evidence').glob('client-content-ui-*.json'), *(DEV/'copypaste-delivery/evidence').glob('admin-data-core-*.json'), *(DEV/'copypaste-delivery/evidence').glob('admin-data-ui-*.json'), *(DEV/'copypaste-delivery/evidence').glob('cloud-schedule-core-*.json'), *(DEV/'copypaste-delivery/evidence').glob('cloud-schedule-ui-*.json'), *(DEV/'copypaste-delivery/evidence').glob('private-view-ui-*.json'), *(DEV/'copypaste-delivery/evidence').glob('platform-full-*.json'), *(DEV/'copypaste-delivery/evidence').glob('platform-integration-*.json'), *(DEV/'copypaste-delivery/evidence').glob('workflow-view-ui-*.json'), *(DEV/'copypaste-delivery/evidence').glob('runtime-continuation-*.json'), *(DEV/'copypaste-delivery/evidence').glob('capability-inventory-*-??.json'), *(DEV/'copypaste-delivery/evidence').glob('managed-audio-audio-??.json'), *(DEV/'copypaste-delivery/evidence').glob('managed-audio-core-??.json'), *(DEV/'copypaste-delivery/evidence').glob('managed-audio-capability-ui-??.json'), *(DEV/'copypaste-delivery/evidence').glob('managed-audio-build-??.json'), *(DEV/'copypaste-delivery/evidence').glob('audio-accounting-focused-??.json'), *(DEV/'copypaste-delivery/evidence').glob('audio-accounting-core-??.json'), *(DEV/'copypaste-delivery/evidence').glob('audio-accounting-ui-??.json'), *(DEV/'copypaste-delivery/evidence').glob('audio-accounting-clients-??.json'), *(DEV/'copypaste-delivery/evidence').glob('audio-accounting-admin-??.json'), *(DEV/'copypaste-delivery/evidence').glob('audio-accounting-consent-??.json')]:
    data=json.loads(report.read_text(encoding='utf-8'))
    archives.update({'evidence/'+report.stem+'-sources/'+name:value for name,value in data.get('source_files',{}).items()})
for pattern in ['web-analytics-core-??.json','web-analytics-focused-??.json','web-analytics-native-??.json','web-analytics-ui-??.json','web-analytics-clients-??.json','desktop-geo-core-??.json','desktop-geo-focused-??.json','desktop-geo-native-??.json','desktop-geo-ui-??.json','desktop-geo-clients-??.json']:
    for report in (DEV/'copypaste-delivery/evidence').glob(pattern):
        data=json.loads(report.read_text(encoding='utf-8'))
        archives.update({'evidence/'+report.stem+'-sources/'+name:value for name,value in data.get('source_files',{}).items()})
for report in (DEV/'copypaste-delivery/evidence').glob('external-budget-*-??.json'):
    data=json.loads(report.read_text(encoding='utf-8'))
    archives.update({'evidence/'+report.stem+'-sources/'+name:value for name,value in data.get('source_files',{}).items()})
for report in (DEV/'copypaste-delivery/evidence').glob('native-recovery-*-??.json'):
    data=json.loads(report.read_text(encoding='utf-8'))
    archives.update({'evidence/'+report.stem+'-sources/'+name:value for name,value in data.get('source_files',{}).items()})
archives['evidence/native-recovery-ui-01-failure-body.txt'] = '4a11fbc75b42f26729a6a5dc9859665aea58aa0e2a93c94dfb42547eac8c2227'
archives['evidence/native-recovery-ui-02-failure-body.txt'] = '37cc2c873aedce6ab956b987721aa5374b3a19bbf6056507baaf04392df68a23'
# Exact, immutable browser body diagnostics from the failed UI runs.
# Whitespace belongs to the observed page and must not be rewritten.
archives.update({'evidence/web-analytics-ui-02-failure-body.txt': '5b7d6123aa82e64dd2bd5fba2aca360476ae77b4e7398bdba09dd33c6f675854', 'evidence/web-analytics-ui-03-failure-body.txt': '39a637ca49e245f3c2e591c3a65a64d7fe58d4fb18741b7e2faf118f6baa8503'})
archives.update({'evidence/external-budget-ui-01-failure-body.txt': 'a3b07a10de26f25ad8231919c7bdf3588fdb379c8a8bce35f2210361b674056f', 'evidence/external-budget-ui-02-failure-body.txt': 'd8b74f62f3689251bf0fbbee6f67f1143da7461e6fe2f5dea830ad04ff845049', 'evidence/external-budget-ui-03-failure-body.txt': '28438f77f3a007021b943e53f3198db116843f927ef9e6391442f18d3606a3e6', 'evidence/external-budget-ui-04-failure-body.txt': 'd2c2fb191d5c55f27f2c47eb22f638800f66b33ea60fe42ec82ed1698083ac15'})
for report in (DEV/'copypaste-delivery/evidence').glob('cloud-events-*-??.json'):
    data=json.loads(report.read_text(encoding='utf-8'))
    archives.update({'evidence/'+report.stem+'-sources/'+name:value for name,value in data.get('source_files',{}).items()})
# Retain the exact browser diagnostics from unsuccessful event qualification attempts.
archives.update({'evidence/cloud-events-ui-01-failure-web.txt': '7cb337d04a64014dcd89c7fbb0bc285512784dd71f46f40e029a6f1f0f46e324', 'evidence/cloud-events-ui-02-failure-web.txt': 'a3ee9faaa51e3750794b68fbfb7103e80464b62e1427e6699ea9acf676abefb9'})
for report in (DEV/'copypaste-delivery/evidence').glob('desktop-updates-*-??.json'):
    data=json.loads(report.read_text(encoding='utf-8'))
    archives.update({'evidence/'+report.stem+'-sources/'+name:value for name,value in data.get('source_files',{}).items()})
exceptions,raw_files=[],{}
for component,repo in repositories.items():
    live=git(repo,'diff','--cached','--check','--','.',':(exclude)evidence/**',':(exclude)docs/quality/history/**')
    assert live.returncode==0 and not live.stdout and not live.stderr,(component,live.stdout.decode('utf-8'))
    raw=git(repo,'diff','--cached','--check')
    assert raw.returncode in [0,2] and not raw.stderr
    last=None
    # Raw Windows logs can contain CRCRLF. Split Git diagnostics on LF only;
    # str.splitlines() would turn a source CR into a fictitious empty record.
    for line in raw.stdout.decode('utf-8').removesuffix('\n').split('\n'):
        line=line.removesuffix('\r')
        if not line and not raw.stdout:
            continue
        match=re.fullmatch(r'(.+):(\d+): (trailing whitespace|new blank line at EOF)\.',line)
        if not match:
            assert last and line.startswith('+'),component
            continue
        name,number,kind=match.groups()
        allowed=component=='docs' and name.startswith('docs/quality/history/')
        allowed=allowed or component=='delivery' and (re.fullmatch(r'evidence/[a-z0-9._-]+\.(?:tap|log)',name) or name in archives)
        assert allowed,(component,name,'Editable source is not exempt')
        key=component+'/'+name
        if key not in raw_files:
            data=(repo/name).read_bytes()
            if name in archives:
                assert sha256(data).hexdigest()==archives[name],name
            staged=git(repo,'show',':'+name)
            assert staged.returncode==0 and staged.stdout==data
            raw_files[key]={'repository':component,'path':name,'sha256':sha256(data).hexdigest(),'staged_bytes_equal_disk':True}
        last={'repository':component,'path':name,'line':int(number),'kind':kind}
        exceptions.append(last)
for row in raw_files.values():
    assert sha256((repositories[row['repository']]/row['path']).read_bytes()).hexdigest()==row['sha256'],row['path']
result={'at':datetime.now(timezone.utc).isoformat(),'status':'passed','repositories':list(repositories),'source_and_readme_whitespace_issues':0,'raw_log_exceptions':exceptions,'raw_files':list(raw_files.values()),'unique_staged_raw_files_checked':len(raw_files),'raw_bytes_rechecked_at_end':True,'raw_bytes_changed':False,'scope':'All seven staged repositories. Each immutable raw file is compared with its staged blob once and rehashed at the end; every diagnostic is still checked. Only retained raw TAP/logs and exact source/history archives keep their original diagnostics. Editable source and README are checked normally.','verifier_sha256':sha256(Path(__file__).read_bytes()).hexdigest()}
with (ROOT/'docs/quality'/report_name).open('x',encoding='utf-8') as stream:
    stream.write(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':'passed','repositories':7,'editable_issues':0,'raw_diagnostics':len(exceptions)}))
