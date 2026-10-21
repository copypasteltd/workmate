"""Check staged blobs against the actual tested and documented file bytes."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def git(repo, *args, data=None):
    return subprocess.check_output(['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
                                    '-C', str(repo), *args], input=data)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--id', required=True)
    parser.add_argument('--include-root', action='store_true')
    args = parser.parse_args()
    assert args.id.isdigit()
    target = ROOT / f'docs/quality/creative-matrix-staged-verification-{args.id}.json'
    assert not target.exists()
    repositories = [ROOT / 'dev' / ('copypaste-' + name)
                    for name in ('platform', 'web', 'admin', 'desktop', 'extension', 'delivery')]
    if args.include_root:
        repositories.append(ROOT)
    results = []
    for repo in repositories:
        files = [name.decode('utf-8') for name in git(repo, 'diff', '--cached', '--name-only', '-z').split(b'\0') if name]
        assert all('\n' not in name and '\r' not in name for name in files)
        output = git(repo, 'cat-file', '--batch', data=''.join(':' + name + '\n' for name in files).encode('utf-8')) if files else b''
        offset, entries = 0, []
        for name in files:
            end = output.index(b'\n', offset)
            header = output[offset:end].split()
            assert len(header) == 3 and header[1] == b'blob', (repo.name, name, header)
            size = int(header[2]);start = end + 1
            blob = output[start:start + size]
            assert output[start + size:start + size + 1] == b'\n'
            disk = (repo / name).read_bytes()
            assert blob == disk, 'Staged bytes changed: ' + repo.name + '/' + name
            entries.append({'path': name, 'bytes': len(blob), 'sha256': sha256(blob).hexdigest()})
            offset = start + size + 1
        assert offset == len(output)
        results.append({'repository': repo.relative_to(ROOT).as_posix(),
                        'parent_head': git(repo, 'rev-parse', 'HEAD').decode().strip(), 'files': entries})
    report = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed',
              'scope': 'Staged blobs equal current file bytes; runtime qualification remains in the separate bound execution reports',
              'verifier_sha256': sha256(Path(__file__).read_bytes()).hexdigest(), 'repositories': results}
    with target.open('x', encoding='utf-8', newline='\n') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2);handle.write('\n')
    print(json.dumps({'status': 'passed', 'repositories': len(results), 'staged_files': sum(len(r['files']) for r in results)}))


if __name__ == '__main__':
    main()
