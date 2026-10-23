"""Check editable staged whitespace, preserving exact raw logs/source archives."""
from datetime import datetime,timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

ROOT=Path(__file__).resolve().parents[2]
DEV=ROOT/'dev'
repositories={'docs':ROOT,**{name:DEV/('copypaste-'+name) for name in ['platform','web','admin','desktop','extension','delivery']}}
def git(repo,*args):
    return subprocess.run(['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false',*args],cwd=repo,capture_output=True)
archives={}
for report in (DEV/'copypaste-delivery/evidence').glob('desktop-browser-*.json'):
    data=json.loads(report.read_text(encoding='utf-8'))
    for name,value in data.get('source_files',{}).items():
        archives[report.with_suffix('').relative_to(DEV/'copypaste-delivery').as_posix()+'-sources/'+name]=value
for report in (DEV/'copypaste-delivery/evidence').glob('local-codex-native-22.json'):
    data=json.loads(report.read_text(encoding='utf-8'))
    archives.update({'evidence/local-codex-native-22-sources/'+name:value for name,value in data['source_files'].items()})
exceptions,raw_files=[],{}
for component,repo in repositories.items():
    live=git(repo,'diff','--cached','--check','--','.',':(exclude)evidence/**',':(exclude)docs/quality/history/**')
    assert live.returncode==0 and not live.stdout and not live.stderr,(component,live.stdout.decode('utf-8'))
    raw=git(repo,'diff','--cached','--check')
    assert raw.returncode in [0,2] and not raw.stderr
    last=None
    for line in raw.stdout.decode('utf-8').splitlines():
        match=re.fullmatch(r'(.+):(\d+): (trailing whitespace|new blank line at EOF)\.',line)
        if not match:
            assert last and line.startswith('+'),component
            continue
        name,number,kind=match.groups()
        allowed=component=='docs' and name.startswith('docs/quality/history/')
        allowed=allowed or component=='delivery' and (re.fullmatch(r'evidence/[a-z0-9._-]+\.(?:tap|log)',name) or name in archives)
        assert allowed,(component,name,'Editable source is not exempt')
        data=(repo/name).read_bytes()
        if name in archives:
            assert sha256(data).hexdigest()==archives[name],name
        staged=git(repo,'show',':'+name)
        assert staged.returncode==0 and staged.stdout==data
        raw_files[component+'/'+name]={'repository':component,'path':name,'sha256':sha256(data).hexdigest(),'staged_bytes_equal_disk':True}
        last={'repository':component,'path':name,'line':int(number),'kind':kind}
        exceptions.append(last)
result={'at':datetime.now(timezone.utc).isoformat(),'status':'passed','repositories':list(repositories),'source_and_readme_whitespace_issues':0,'raw_log_exceptions':exceptions,'raw_files':list(raw_files.values()),'raw_bytes_changed':False,'scope':'All seven staged repositories. Only retained raw TAP/logs and exact source/history archives keep their original diagnostics. Editable source and README are checked normally.','verifier_sha256':sha256(Path(__file__).read_bytes()).hexdigest()}
with (ROOT/'docs/quality/desktop-browser-whitespace-01.json').open('x',encoding='utf-8') as stream:
    stream.write(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':'passed','repositories':7,'editable_issues':0,'raw_diagnostics':len(exceptions)}))
