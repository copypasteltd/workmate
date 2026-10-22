"""Check staged source whitespace while retaining exact raw execution evidence."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def git(repo, *args):
    return subprocess.run(
        ['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
         '-C', str(repo), *args], capture_output=True, check=False,
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--id', required=True)
    args = parser.parse_args()
    assert re.fullmatch(r'\d{2}', args.id)
    scan = json.loads((ROOT / 'docs/quality/seo-change-credential-scan-01.json').read_text(encoding='utf-8'))
    assert scan['status'] == 'passed'
    scanned = {entry['path']: entry['sha256'] for entry in scan['files']}
    results = []
    exceptions = []
    for name in ('platform', 'web', 'admin', 'desktop', 'extension', 'delivery', 'root'):
        repo = ROOT if name == 'root' else ROOT / 'dev' / ('copypaste-' + name)
        result = git(repo, 'diff', '--cached', '--check')
        assert not result.stderr, result.stderr.decode('utf-8', errors='replace')
        assert result.returncode in (0, 1, 2), (name, result.returncode)
        allowed = {}
        if result.returncode:
            assert name == 'delivery', 'Product or documentation whitespace failure: ' + name
            for line in result.stdout.decode('utf-8').splitlines():
                match = re.fullmatch(
                    r'(evidence/seo-change-[^:\r\n]+):(\d+): '
                    r'(trailing whitespace\.|new blank line at EOF\.)', line,
                )
                if not match:
                    assert line.startswith('+') and allowed, 'Unexpected Git diagnostic: ' + line
                    continue
                file, number, diagnostic = match.groups()
                assert Path(file).suffix in ('.log', '.tap')
                relative = repo.relative_to(ROOT).as_posix() + '/' + file
                data = (repo / file).read_bytes()
                checksum = sha256(data).hexdigest()
                assert scanned[relative] == checksum
                staged = git(repo, 'show', ':' + file)
                assert staged.returncode == 0 and staged.stdout == data
                entry = allowed.setdefault(file, {'path': relative, 'sha256': checksum, 'diagnostics': []})
                entry['diagnostics'].append({'line': int(number), 'message': diagnostic})
            assert allowed
            remaining = git(repo, 'diff', '--cached', '--check', '--', '.',
                            *(':(exclude)' + file for file in sorted(allowed)))
            assert remaining.returncode == 0 and not remaining.stdout and not remaining.stderr
            exceptions.extend(allowed.values())
        else:
            assert not result.stdout
        results.append({'repository': repo.relative_to(ROOT).as_posix(),
                        'initial_exit_code': result.returncode, 'remaining_issues': 0,
                        'exact_raw_files_excluded': sorted(allowed)})
    report = {
        'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed',
        'scope': 'Staged product/documentation whitespace; only exact SHA-bound raw TAP/log files retain their original trailing whitespace and final blank lines. No source or verifier file is excluded.',
        'verifier_sha256': sha256(Path(__file__).read_bytes()).hexdigest(),
        'repositories': results, 'preserved_raw_exceptions': exceptions,
    }
    target = ROOT / f'docs/quality/seo-change-whitespace-{args.id}.json'
    with target.open('x', encoding='utf-8', newline='\n') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    print(json.dumps({'status': 'passed', 'repositories': len(results),
                      'exact_raw_files_preserved': len(exceptions), 'remaining_issues': 0}))


if __name__ == '__main__':
    main()
