"""Check current qualified bytes in actual Git indexes before component commits."""
from pathlib import Path
from hashlib import sha1, sha256
from datetime import datetime, timezone
import argparse
import contextlib
import io
import json
import subprocess

from audit_workmate_publication import MAP, ROOT, git
from finalize_cloud_schedules_manifest import attr_normalization
from finalize_desktop_browser_manifest import committed_blobs
import archive_dedicated_cloud_evidence_v3 as evidence

Q = ROOT / 'docs/quality'
OUTPUT = Q / 'dedicated-cloud-staged-review-01.json'


def read(file):
    return json.loads(file.read_text(encoding='utf-8-sig'))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def index(repo):
    result = {}
    for entry in git(repo, 'ls-files', '--stage', '-z').split(b'\0'):
        if not entry:
            continue
        metadata, _, name = entry.partition(b'\t')
        mode, oid, stage = metadata.split()
        assert stage == b'0' and mode in [b'100644', b'100755'], name
        result[name.decode('utf-8')] = oid.decode('ascii')
    return result


def staged(repo, names, entries):
    ids = list(dict.fromkeys(entries[name] for name in names))
    body = git(repo, 'cat-file', '--batch', data=('\n'.join(ids) + '\n').encode('ascii'))
    offset, blobs = 0, {}
    for oid in ids:
        end = body.index(b'\n', offset)
        actual, kind, size = body[offset:end].split()
        assert actual.decode() == oid and kind == b'blob'
        size = int(size)
        offset = end + 1
        value = body[offset:offset + size]
        assert len(value) == size and body[offset + size:offset + size + 1] == b'\n'
        algorithm = sha1 if len(oid) == 40 else sha256
        assert algorithm(b'blob ' + str(size).encode() + b'\0' + value).hexdigest() == oid
        blobs[oid] = value
        offset += size + 1
    assert offset == len(body)
    return {name: blobs[entries[name]] for name in names}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--credentials', required=True)
    args = parser.parse_args()
    assert not OUTPUT.exists()
    credential = Q / args.credentials
    assert credential.parent == Q and credential.name.startswith('desktop-browser-staged-credentials-')
    credentials = read(credential)
    assert credentials['status'] == 'passed'
    assert credentials['verifier_sha256'] == digest(ROOT / 'docs/tools/scan_desktop_browser_staged_credentials.py')
    cp = read(Q / 'dedicated-cloud-checkpoint.json')
    with contextlib.redirect_stdout(io.StringIO()):
        evidence.verify(True)
    repo_indexes = {branch: index(repo) for branch, repo in MAP.items()}
    groups, normalizations, checked = {}, [], 0
    for name, expected in cp['source_files'].items():
        file = ROOT / name
        assert digest(file) == expected, name
        branch = next((b for b, repo in MAP.items() if b != 'docs' and file.is_relative_to(repo)), 'docs')
        local = file.relative_to(MAP[branch]).as_posix()
        groups.setdefault(branch, {})[local] = expected
    for branch, wanted in groups.items():
        repo = MAP[branch]
        bodies = staged(repo, sorted(wanted), repo_indexes[branch])
        for name, expected in wanted.items():
            value = bodies[name]
            disk = (repo / name).read_bytes()
            assert sha256(disk).hexdigest() == expected
            if value != disk:
                attr_normalization(repo, name, value, disk)
                normalizations.append({'repository': branch, 'path': name,
                                       'working_sha256': expected, 'staged_sha256': sha256(value).hexdigest()})
            checked += 1
    # The opaque CAS and previous README history retain observed bytes, including
    # original whitespace. They are independently hash-checked, never rewritten.
    opaque = read(evidence.INDEX)
    opaque_files = {item['blob'] for item in opaque['entries'].values()}
    composed = read(Q / 'dedicated-cloud-readmes.json')
    opaque_files.update(composed['previous_readmes'])
    opaque_files.update('docs/quality/history/stage121-readmes-before/docs/' + name for name in ['README.md', 'README.en.md'])
    for name in sorted(opaque_files):
        value = (ROOT / name).read_bytes()
        oid = repo_indexes['docs'][name]
        algorithm = sha1 if len(oid) == 40 else sha256
        assert algorithm(b'blob ' + str(len(value)).encode() + b'\0' + value).hexdigest() == oid, name
    for branch, repo in MAP.items():
        exclusions = [':(exclude)evidence/**'] if branch == 'delivery' else []
        if branch == 'docs':
            exclusions = [':(exclude)docs/quality/history/**', ':(exclude)docs/quality/dedicated-cloud-evidence-121/blobs/**']
        check = subprocess.run(['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
                                'diff', '--cached', '--check', '--', '.', *exclusions],
                               cwd=repo, capture_output=True)
        assert check.returncode == 0 and not check.stdout and not check.stderr, (branch, check.stdout.decode('utf-8'))
    migrations = sorted(name for name in repo_indexes['backend'] if name.startswith('migrations/') and name.endswith('.sql'))
    historical = [name for name in migrations if not Path(name).name.startswith('129-')]
    assert len(historical) == 128 and len(migrations) == 129
    previous = committed_blobs(MAP['backend'], historical, {})
    current = staged(MAP['backend'], historical, repo_indexes['backend'])
    assert previous == current, 'Historical migration bytes changed'
    renderer = read(MAP['desktop'] / 'renderer-source.json')
    renderer_names = ['renderer/' + name for name in renderer['files']]
    renderer_staged = staged(MAP['desktop'], ['renderer-source.json', *renderer_names], repo_indexes['desktop'])
    assert json.loads(renderer_staged['renderer-source.json']) == renderer
    for name, expected in renderer['files'].items():
        assert digest(MAP['desktop'] / 'renderer' / name) == expected, name
        assert sha256(renderer_staged['renderer/' + name]).hexdigest() == expected, name
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed',
              'checkpoint': {'path': 'docs/quality/dedicated-cloud-checkpoint.json', 'sha256': digest(Q / 'dedicated-cloud-checkpoint.json')},
              'credential_review': {'path': credential.name, 'sha256': digest(credential)},
              'qualified_staged_sources': checked, 'declared_line_ending_normalizations': normalizations,
              'immutable_evidence_staged_exact': len(opaque_files), 'editable_whitespace_issues': 0,
              'historical_migrations_preserved': 128, 'renderer_files_rehashed': len(renderer['files']),
              'scope': 'Actual staged Git objects, current source binding, exact immutable CAS/history, editable whitespace and additive SQL129; bounded verification only.',
              'verifier_sha256': digest(Path(__file__))}
    with OUTPUT.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    print(json.dumps({'status': 'passed', 'staged_sources': checked, 'immutable_evidence': len(opaque_files), 'editable_issues': 0}))


if __name__ == '__main__':
    main()
