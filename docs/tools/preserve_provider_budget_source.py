"""Retain exact changed source bytes for an executed provider-budget attempt."""
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
                candidates = EVIDENCE.glob('provider-*-' + source.replace('/', '__'))
                if any(hashlib.sha256(path.read_bytes()).hexdigest() == expected for path in candidates):
                    continue
                content = git('show', '0ed17e7:' + source)
                assert hashlib.sha256(content).hexdigest() == expected, 'Baseline bytes differ: ' + source
                target = EVIDENCE / ('provider-budget-baseline-' + source.replace('/', '__'))
                with target.open('xb') as stream:
                    stream.write(content)
                records[source] = {'source': source, 'path': target.relative_to(ROOT).as_posix(), 'sha256': expected}
        with (EVIDENCE / 'provider-budget-baseline-source-preimages.json').open('x', encoding='utf-8', newline='\n') as stream:
            json.dump({'source_commit':'0ed17e7','scope':'Exact committed baseline bytes still used by earlier executed suites',
                       'files':list(records.values())}, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
        print(json.dumps({'retained_baseline_sources':len(records)}))
        return
    assert re.fullmatch(r'provider-budget-(core|candidate|regression)-\d{2}', name)
    report = json.loads((EVIDENCE / (name + '.json')).read_text(encoding='utf-8'))
    changed = set(git('diff', '--name-only', '0ed17e7').decode().splitlines())
    changed.update(git('ls-files', '--others', '--exclude-standard').decode().splitlines())
    # Retain currently unchanged fixtures before an upcoming compatibility edit.
    changed.update(sys.argv[2:])
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
    document = {'scope': 'Changed provider source bytes against 0ed17e7, retained before subsequent edits',
                'execution': name, 'files': records}
    with manifest.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(document, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    print(json.dumps({'execution': name, 'retained_sources': len(records)}))


if __name__ == '__main__':
    main()
