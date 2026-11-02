"""Preserve already-executed source bytes in Git without changing those files."""
from pathlib import Path
from hashlib import sha1, sha256
from datetime import datetime, timezone
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / 'dev/copypaste-delivery/.data/deployment-188'
REPORT = ROOT / 'docs/quality/live-acceptance-188.json'
PATHS = PRIVATE / 'publication-paths.json'
REVIEW = ROOT / 'docs/quality/live-acceptance-188/publication-byte-review.json'
COMPONENTS = {'backend': 'platform', 'web': 'web', 'admin': 'admin',
              'desktop': 'desktop', 'extension': 'extension',
              'delivery': 'delivery', 'docs': None}


def digest(p):
    return sha256(p.read_bytes()).hexdigest()


def save(p, value):
    p.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n',
                 encoding='utf8', newline='\n')


def git(repo, *args, payload=None):
    return subprocess.run(['git', '-c', 'core.fsmonitor=false', '-C', str(repo),
                           *args], input=payload, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, check=True).stdout


assert not REVIEW.exists(), 'This byte preservation review has already run.'
report = json.loads(REPORT.read_bytes())
paths = json.loads(PATHS.read_bytes())
for name, expected in report['sources'].items():
    assert digest(ROOT / name) == expected, name
failed = json.loads((PRIVATE / 'publication-9661c851-a6dc-4f81-96c6-260ce10acc85/receipt.json').read_bytes())
assert failed['status'] == 'failed' and not failed['components']
assert 'Staged bytes differ:' in failed['failure']

repos = {b: ROOT if short is None else ROOT / 'dev' / ('copypaste-' + short)
         for b, short in COMPONENTS.items()}
for branch, repo in repos.items():
    staged = set(git(repo, 'diff', '--cached', '--name-only', '-z').decode().split('\0')) - {''}
    assert staged <= set(paths[branch]), 'Unrelated staged files; preserve the index.'
    if staged:
        # This only unstages the preceding, uncommitted publication attempt.
        git(repo, 'restore', '--staged', '--', *sorted(staged))

changed = {}
for branch, repo in repos.items():
    filtered = git(repo, 'hash-object', '--stdin-paths',
                   payload=('\n'.join(paths[branch]) + '\n').encode()).decode().splitlines()
    preserve = []
    for name, oid in zip(paths[branch], filtered, strict=True):
        raw = (repo / name).read_bytes()
        exact = sha1(('blob ' + str(len(raw)) + '\0').encode() + raw).hexdigest()
        if exact != oid:
            assert '\n' not in name and ' ' not in name
            preserve.append(name)
    if not preserve:
        continue
    assert branch != 'desktop', 'Frozen Desktop attributes must remain unchanged.'
    attributes = repo / '.gitattributes'
    original = attributes.read_bytes()
    with (PRIVATE / ('attributes-' + branch + '.before-byte-review-v1')).open('xb') as backup:
        backup.write(original)
    suffix = '\n# Stage188 receipts bind already-executed source bytes.\n'
    suffix += ''.join(name + ' -text whitespace=cr-at-eol\n' for name in preserve)
    attributes.write_bytes(original + suffix.encode())
    paths[branch] = sorted(set(paths[branch]) | {'.gitattributes'})
    report['sources'][attributes.relative_to(ROOT).as_posix()] = digest(attributes)
    changed[branch] = {'paths': preserve, 'previous_attributes_sha256': sha256(original).hexdigest(),
                       'attributes_sha256': digest(attributes)}

assert changed and set(changed) == {'backend', 'extension', 'delivery'}
save(REVIEW, {
    'stage': 188, 'at': datetime.now(timezone.utc).isoformat(),
    'changes': changed,
    'reason': 'Exact source bytes are already bound by executed acceptance receipts. '
              'Narrow repository attributes prevent automatic CRLF normalization '
              'from silently changing those bytes in fresh clones.',
    'executed_source_files_modified': False,
    'desktop_attributes_modified': False,
    'previous_failed_publication_preserved': True,
    'previous_publication_commits_or_pushes': 0,
    'deployment_archive_unchanged': True,
})
paths['docs'] = sorted(set(paths['docs']) | {
    REVIEW.relative_to(ROOT).as_posix(), Path(__file__).relative_to(ROOT).as_posix()})
for qualified in [REVIEW, Path(__file__)]:
    report['sources'][qualified.relative_to(ROOT).as_posix()] = digest(qualified)
report['publication_byte_review'] = REVIEW.relative_to(ROOT).as_posix()
save(REPORT, report)
save(PATHS, paths)
print(json.dumps({'status': 'exact_source_bytes_preserved',
                  'changed_attributes': list(changed),
                  'source_count': len(report['sources'])}))
