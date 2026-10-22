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
    parser.add_argument('--scan', default='01')
    args = parser.parse_args()
    assert re.fullmatch(r'\d{2}', args.id)
    assert re.fullmatch(r'\d{2}', args.scan)
    scan = json.loads((ROOT / f'docs/quality/paid-input-credential-scan-{args.scan}.json').read_text(encoding='utf-8'))
    assert scan['status'] == 'passed'
    scanned = {entry['path']: entry['sha256'] for entry in scan['files']}
    results = []
    exceptions = []
    applied_sql = []
    for name in ('platform', 'web', 'admin', 'desktop', 'extension', 'delivery', 'root'):
        repo = ROOT if name == 'root' else ROOT / 'dev' / ('copypaste-' + name)
        result = git(repo, 'diff', '--cached', '--check')
        assert not result.stderr, result.stderr.decode('utf-8', errors='replace')
        assert result.returncode in (0, 1, 2), (name, result.returncode)
        allowed = {}
        if result.returncode and name == 'platform':
            files = {}
            for line in result.stdout.decode('utf-8').splitlines():
                match = re.fullmatch(r'(migrations/(08[2-5])-[^:\r\n]+\.sql):\d+: trailing whitespace\.', line)
                if match:
                    files[match[1]] = int(match[2])
                else:
                    assert line.startswith('+') and files, 'Unexpected source whitespace: ' + line
            assert len(files) == 4
            for file, version in sorted(files.items()):
                data = (repo / file).read_bytes()
                checksum = sha256(data).hexdigest()
                attempt = {82: '04', 83: '05', 84: '07', 85: '09'}[version]
                first = json.loads((ROOT / f'dev/copypaste-delivery/evidence/history-source-integration-{attempt}.json').read_text(encoding='utf-8'))
                assert checksum == first['source_files'][file]
                staged = git(repo, 'show', ':' + file)
                assert staged.returncode == 0 and staged.stdout == data
                assert data.count(b'\r\n') > 0 and b'\r' not in data.replace(b'\r\n', b'\n')
                assert all(not line.endswith((b' ', b'\t')) for line in data.replace(b'\r\n', b'\n').split(b'\n'))
                checked = git(repo, '-c', 'core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol',
                              'diff', '--cached', '--check', '--', file)
                assert checked.returncode == 0 and not checked.stdout and not checked.stderr
                applied_sql.append({'path': repo.relative_to(ROOT).as_posix() + '/' + file,
                                    'sha256': checksum, 'first_applied_execution': attempt,
                                    'crlf_lines_preserved': data.count(b'\r\n'),
                                    'real_trailing_space_lines': 0, 'staged_bytes_equal': True})
            remaining = git(repo, 'diff', '--cached', '--check', '--', '.',
                            *(':(exclude)' + file for file in sorted(files)))
            assert remaining.returncode == 0 and not remaining.stdout and not remaining.stderr
            results.append({'repository': repo.relative_to(ROOT).as_posix(), 'initial_exit_code': result.returncode,
                            'remaining_issues': 0, 'exact_raw_files_excluded': [],
                            'applied_sql_checked_with_cr_at_eol': sorted(files)})
            continue
        if result.returncode:
            assert name == 'delivery', 'Product or documentation whitespace failure: ' + name
            for line in result.stdout.decode('utf-8').splitlines():
                match = re.fullmatch(
                    r'(evidence/paid-input-[^:\r\n]+):(\d+): '
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
        'scope': 'Staged product/documentation whitespace. Any immutable applied-SQL CRLF exception must match its first execution and pass an individual CR-at-EOL check with no real trailing spaces; the actual exceptions are listed in preserved_applied_sql_crlf. Other source/verifiers receive normal checks. Only exact SHA-bound raw TAP/log evidence retains its original whitespace.',
        'verifier_sha256': sha256(Path(__file__).read_bytes()).hexdigest(),
        'repositories': results, 'preserved_raw_exceptions': exceptions, 'preserved_applied_sql_crlf': applied_sql,
    }
    target = ROOT / f'docs/quality/paid-input-whitespace-{args.id}.json'
    with target.open('x', encoding='utf-8', newline='\n') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    print(json.dumps({'status': 'passed', 'repositories': len(results),
                      'exact_raw_files_preserved': len(exceptions), 'applied_sql_crlf_files': len(applied_sql), 'remaining_issues': 0}))


if __name__ == '__main__':
    main()
