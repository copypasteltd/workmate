"""Restore four qualified LF working copies after proving the current Git blobs."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/quality/runtime-startup-line-endings-122.json'
INDEX = ROOT / 'docs/quality/runtime-startup-evidence-122/index.json'
NAMES = [
    'dev/copypaste-platform/scripts/qualify-dedicated-cloud-v1.mjs',
    'dev/copypaste-platform/src/server.ts',
    'dev/copypaste-web/src/cloud-computers.css',
    'dev/copypaste-web/src/cloud-computers.tsx',
]


def digest(body):
    return sha256(body).hexdigest()


def git(repo, *args):
    return subprocess.check_output(['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', *args],
                                   cwd=repo, stderr=subprocess.PIPE)


def main():
    assert not OUT.exists()
    index = json.loads(INDEX.read_text(encoding='utf-8'))
    planned = []
    for name in NAMES:
        path = ROOT / name
        repo = ROOT / Path(*Path(name).parts[:2])
        relative = path.relative_to(repo).as_posix()
        disk = path.read_bytes()
        blob = git(repo, 'show', 'HEAD:' + relative)
        expected = index['current_source_files'][name]
        attrs_raw = git(repo, 'check-attr', '-z', 'text', 'eol', 'filter', '--', relative).split(b'\0')
        attrs = {attrs_raw[i + 1].decode(): attrs_raw[i + 2].decode() for i in range(0, len(attrs_raw) - 1, 3)}
        assert attrs['text'] in ['set', 'auto'] and attrs['eol'] == 'lf' and attrs['filter'] == 'unspecified'
        assert b'\0' not in disk and b'\r\n' in disk
        assert blob == disk.replace(b'\r\n', b'\n') and digest(blob) == expected
        planned.append((path, blob, {'path': name, 'before_sha256': digest(disk),
                        'after_sha256': expected, 'committed_sha256': digest(blob),
                        'git_commit': git(repo, 'rev-parse', 'HEAD').decode().strip(),
                        'attributes': attrs, 'change': 'CRLF to LF only; no source logic change'}))
    for path, blob, row in planned:
        path.write_bytes(blob)
        assert digest(path.read_bytes()) == row['after_sha256']
    value = {'status': 'passed', 'at': datetime.now(timezone.utc).isoformat(),
             'initial_checkpoint_failure': 'Source-byte verification stopped before writing a checkpoint at qualify-dedicated-cloud-v1.mjs. No test result was changed.',
             'changes': [row for _, _, row in planned],
             'evidence_index_sha256': digest(INDEX.read_bytes()),
             'verifier_sha256': digest(Path(__file__).read_bytes())}
    with OUT.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    print(json.dumps({'status': 'passed', 'working_files_restored_to_qualified_git_bytes': len(planned)}))


if __name__ == '__main__':
    main()
