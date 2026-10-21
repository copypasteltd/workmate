"""Preserve exact executed sources before the provider Admin control changes."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
PLATFORM = ROOT / 'dev/copypaste-platform'
ADMIN = ROOT / 'dev/copypaste-admin'
EVIDENCE = ROOT / 'dev/copypaste-delivery/evidence'
BASELINES = {'platform':'b32441b','admin':'b08a1fa'}


def git(repo, *args):
    return subprocess.check_output(['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false',*args],cwd=repo)


def main():
    name = sys.argv[1]
    if name == '--baseline':
        records = []
        for report in sorted(EVIDENCE.glob('provider-budget-*.json')):
            if not re.fullmatch(r'provider-budget-(?:core|candidate|regression)-\d{2}\.json',report.name):
                continue
            data = json.loads(report.read_text(encoding='utf-8'))
            for source, expected in data['source_files'].items():
                if any(hashlib.sha256(x.read_bytes()).hexdigest()==expected for x in EVIDENCE.glob('provider-*-' + source.replace('/','__'))):
                    continue
                content = git(PLATFORM,'show',BASELINES['platform']+':'+source)
                assert hashlib.sha256(content).hexdigest()==expected, 'Missing prior executed source: '+source
                target = EVIDENCE / ('provider-admin-baseline-'+source.replace('/','__'))
                if target.exists(): assert target.read_bytes()==content
                else: target.write_bytes(content)
                records.append({'source':source,'path':target.relative_to(ROOT).as_posix(),'sha256':expected})
        target = EVIDENCE / 'provider-admin-baseline-source-preimages.json'
        with target.open('x',encoding='utf-8',newline='\n') as stream:
            json.dump({'source_commits':BASELINES,'scope':'Exact sources used by prior budget executions; retained before Admin changes','files':records},stream,indent=2)
            stream.write('\n')
        print(json.dumps({'retained_sources':len(records)}))
        return
    assert re.fullmatch(r'provider-admin-(?:core|candidate|regression|ui|static)-\d{2}',name)
    report=json.loads((EVIDENCE/(name+'.json')).read_text(encoding='utf-8'))
    records=[]
    components=report.get('component_sources')
    if components is None:
        if '-ui-' in name:
            components={}
            for source,expected in report['source_files'].items():
                if source.startswith('docs/'):
                    components.setdefault('docs',{})[source[5:]]=expected
                else:
                    repo,relative=source.split('/',1)
                    components.setdefault(repo.removeprefix('copypaste-'),{})[relative]=expected
        else:
            components={'platform':report['source_files']}
    for component, sources in components.items():
        repo={'platform':PLATFORM,'admin':ADMIN,'delivery':ROOT/'dev/copypaste-delivery','docs':ROOT/'docs'}[component]
        for source, expected in sources.items():
            content=(repo/source).read_bytes()
            assert hashlib.sha256(content).hexdigest()==expected
            target=EVIDENCE/(name+'-'+component+'-'+source.replace('/','__'))
            if target.exists(): assert target.read_bytes()==content
            else: target.write_bytes(content)
            records.append({'component':component,'source':source,'path':target.relative_to(ROOT).as_posix(),'sha256':expected})
    with (EVIDENCE/(name+'-source-preimages.json')).open('x',encoding='utf-8',newline='\n') as stream:
        json.dump({'execution':name,'files':records},stream,indent=2);stream.write('\n')
    print(json.dumps({'execution':name,'retained_sources':len(records)}))


if __name__=='__main__': main()
