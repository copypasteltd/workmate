"""Retain exact changed source bytes for an executed provider-control attempt."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
PLATFORM = ROOT / 'dev/copypaste-platform'
EVIDENCE = ROOT / 'dev/copypaste-delivery/evidence'


def git(*args):
    return subprocess.check_output(
        ['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', *args],
        cwd=PLATFORM, stderr=subprocess.DEVNULL,
    )


def main():
    name = sys.argv[1]
    if name == '--baseline':
        records = {}
        for report_path in sorted(EVIDENCE.glob('provider-control-*.json')):
            if not re.fullmatch(r'provider-control-(core|candidate|regression)-\d{2}\.json', report_path.name):
                continue
            report = json.loads(report_path.read_text(encoding='utf-8'))
            for source, expected in report['source_files'].items():
                if hashlib.sha256((PLATFORM / source).read_bytes()).hexdigest() == expected:
                    continue
                candidates = EVIDENCE.glob('provider-control-*-' + source.replace('/', '__'))
                if any(hashlib.sha256(path.read_bytes()).hexdigest() == expected for path in candidates):
                    continue
                content = git('show', 'c5b3f75:' + source)
                assert hashlib.sha256(content).hexdigest() == expected, 'Baseline bytes differ: ' + source
                target = EVIDENCE / ('provider-control-baseline-' + source.replace('/', '__'))
                with target.open('xb') as stream:
                    stream.write(content)
                records[source] = {'source': source, 'path': target.relative_to(ROOT).as_posix(), 'sha256': expected}
        with (EVIDENCE / 'provider-control-baseline-source-preimages.json').open('x', encoding='utf-8', newline='\n') as stream:
            json.dump({'source_commit':'c5b3f75','scope':'Exact committed baseline bytes still used by earlier executed suites',
                       'files':list(records.values())}, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
        print(json.dumps({'retained_baseline_sources':len(records)}))
        return
    assert re.fullmatch(r'provider-control-(core|candidate|regression)-\d{2}', name)
    report = json.loads((EVIDENCE / (name + '.json')).read_text(encoding='utf-8'))
    changed = set(git('diff', '--name-only', 'c5b3f75').decode().splitlines())
    changed.update(git('ls-files', '--others', '--exclude-standard').decode().splitlines())
    records = []
    for source in sorted(changed & report['source_files'].keys()):
        content = (PLATFORM / source).read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        assert digest == report['source_files'][source], 'Source already changed: ' + source
        target = EVIDENCE / (name + '-' + source.replace('/', '__'))
        if target.exists():
            assert target.read_bytes() == content
        else:
            with target.open('xb') as stream:
                stream.write(content)
        records.append({'source': source, 'path': target.relative_to(ROOT).as_posix(), 'sha256': digest})
    manifest = EVIDENCE / (name + '-source-preimages.json')
    document = {'scope': 'Changed provider source bytes against c5b3f75, retained before subsequent edits',
                'execution': name, 'files': records}
    with manifest.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(document, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    print(json.dumps({'execution': name, 'retained_sources': len(records)}))


if __name__ == '__main__':
    main()
