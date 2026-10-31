"""Ordinary atomic component publication; frozen tags and unrelated files retained."""
from pathlib import Path
from hashlib import sha256, sha1
from datetime import datetime, timezone
import json
import os
import re
import subprocess
import uuid
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
BRANCHES = ['backend', 'web', 'admin', 'desktop', 'extension', 'delivery', 'docs', 'main']
REPOS = {'docs': ROOT, 'backend': DEV / 'copypaste-platform', **{k: DEV / ('copypaste-' + k) for k in ['web', 'admin', 'desktop', 'extension', 'delivery']}}
def digest(p): return sha256(p.read_bytes()).hexdigest()
def write(p, value):
    with p.open('x', encoding='utf-8', newline='\n') as f: f.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

out = DELIVERY / '.data/admin-user-resources-166' / ('publication-' + str(uuid.uuid4()))
out.mkdir()
log = (out / 'commands.log').open('xb')
result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'running', 'failure': None}
env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GIT_SSH_COMMAND': 'ssh -o BatchMode=yes'}
def git(repo, *args):
    argv = ['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'gc.auto=0', '-c', 'gc.autoPackLimit=0', '-C', str(repo), *args]
    log.write((json.dumps({'repo': str(repo), 'args': args}) + '\n').encode()); log.flush()
    p = subprocess.run(argv, cwd=repo, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    log.write(p.stdout + p.stderr + b'\n'); log.flush()
    assert p.returncode == 0, 'Git failed; original commands.log retained'
    return p.stdout.decode('utf-8').strip()
def refs():
    return {s.split()[1]: s.split()[0] for s in git(ROOT, 'ls-remote', 'origin', *['refs/heads/' + b for b in BRANCHES], 'refs/tags/v0.1.0-rc.*').splitlines()}
def staged(repo, names):
    assert not git(repo, 'diff', '--cached', '--name-only')
    changed = set(git(repo, 'diff', '--name-only', '-z').split('\0')) - {''}
    assert changed <= set(names), 'Unrelated tracked changes preserved: ' + str(changed - set(names))
    git(repo, 'add', '--', *names)
    assert set(git(repo, 'diff', '--cached', '--name-only', '-z').split('\0')) - {''} == set(names)
    for n in names:
        raw = (repo / n).read_bytes()
        assert git(repo, 'ls-files', '-s', '--', n).split()[1] == sha1(('blob ' + str(len(raw)) + '\0').encode() + raw).hexdigest(), n
def preserve(baseline):
    for n, h in baseline['preserved_user_files'].items(): assert digest(ROOT / n) == h
    assert digest(DEV / 'copypaste-desktop/.gitattributes') == baseline['desktop_attributes_sha256']
    frozen = baseline['frozen_rc5']
    directory = DELIVERY / 'release/workmate-v0.1.0-rc.5'
    assert digest(directory / 'release-manifest.json') == frozen['manifest_sha256']
    assert digest(directory / 'SHA256SUMS') == frozen['sums_sha256']
    assert Path(frozen['complete_archive']['path']).stat().st_size == frozen['complete_archive']['bytes']

try:
    baseline = json.loads((DELIVERY / '.data/admin-user-resources-166/baseline.json').read_bytes())
    report = json.loads((ROOT / 'docs/quality/admin-user-resources-166.json').read_bytes())
    assert report['status'] == 'qualified' and report['owned_browser_and_services_closed']
    for name, h in report['sources'].items(): assert digest(DEV / name) == h
    for key in ['qualification', 'actual_ui', 'retained_first_attempt']:
        assert digest(ROOT / report[key]['path']) == report[key]['sha256']
    for row in report['media']['copies']: assert digest(ROOT / row['path']) == row['sha256']
    preserve(baseline)
    before = refs(); assert before == baseline['verified_refs'] and len(before) == 78
    expected_heads = {**baseline['heads'], 'backend': baseline['heads']['platform']}
    for key, repo in REPOS.items(): assert git(repo, 'rev-parse', 'HEAD') == expected_heads[key], key
    handbooks = ['README.md', 'README.en.md']
    media = lambda repo: sorted(p.relative_to(repo).as_posix() for p in (repo / 'assets/screenshots').glob('*admin-user-resources-166-*'))
    names = {
        'backend': handbooks + ['src/admin.ts', 'src/admin-content.ts', 'src/assets.ts', 'tests/admin-user-resources-fixture-166-v1.ts', 'tests/admin-user-resources-166-v1.test.ts', 'scripts/serve-admin-user-resources-166-v1.ts'] + media(REPOS['backend']),
        'admin': handbooks + ['src/main.tsx', 'src/user-resources.ts'] + media(REPOS['admin']),
        'delivery': handbooks + ['scripts/qualify-admin-user-resources-166-v1.mjs', 'scripts/qualify-admin-user-resources-166-v2.mjs', 'scripts/qa-admin-user-resources-166-v1.ts', 'scripts/qa-admin-user-resources-166-v2.ts'] + sorted(p.relative_to(DELIVERY).as_posix() for p in (DELIVERY / 'evidence/admin-user-resources-166').glob('*.json')) + media(DELIVERY),
        'docs': ['docs/README.md', 'docs/README.en.md', 'docs/requirements/27-admin-user-resource-context.md', 'docs/development/166-admin-user-resource-context.md', 'docs/changes/166-admin-user-resources.md', 'docs/quality/admin-user-resources-166.json', 'docs/quality/remaining-work-stage166.json', 'docs/quality/remaining-work-stage166.md', 'docs/tools/prepare-admin-user-resources-166-v1.py', 'docs/tools/publish-admin-user-resources-166-v1.py'] + sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / 'docs/assets/admin-user-resources-166').iterdir()),
    }
    for key in ['backend', 'admin', 'delivery']:
        repo = REPOS[key]
        for n in handbooks:
            text = (repo / n).read_text(encoding='utf-8')
            for target in re.findall(r'!?\[[^\]]*\]\(([^\s)]+)\)', text):
                if not target.startswith(('https://', 'http://', '#')):
                    assert (repo / unquote(target.split('#')[0])).is_file(), (key, n, target)
    commits = {}
    for key in ['backend', 'admin', 'delivery', 'docs']:
        repo = REPOS[key]; staged(repo, names[key])
        git(repo, 'commit', '-m', 'Complete creator-scoped Admin user tasks/content and source handoff (stage166)')
        commits[key] = git(repo, 'rev-parse', 'HEAD')
        git(repo, 'merge-base', '--is-ancestor', expected_heads[key], commits[key])
        print(json.dumps({'phase': 'committed', 'component': key, 'files': len(names[key]), 'commit': commits[key]}), flush=True)
    for key in ['backend', 'admin', 'delivery']:
        git(ROOT, 'fetch', '--no-tags', '--no-write-fetch-head', str(REPOS[key]), commits[key])
    assert refs() == before, 'Concurrent remote change preserved'
    targets = {branch: commits.get(branch, expected_heads.get(branch, commits['docs'])) for branch in BRANCHES}
    targets['main'] = commits['docs']
    git(ROOT, 'push', '--atomic', 'origin', *[targets[b] + ':refs/heads/' + b for b in BRANCHES])
    expected = {**before, **{'refs/heads/' + b: targets[b] for b in BRANCHES}}
    assert refs() == expected
    public = {'stage': 166, 'at': datetime.now(timezone.utc).isoformat(), 'status': 'published', 'source_commits': {k: {'commit': targets[k], 'url': 'https://github.com/copypasteltd/workmate/tree/' + targets[k]} for k in BRANCHES}, 'verified_source_publication_refs': expected, 'frozen_tags_unchanged': True, 'release_assets_modified': False, 'qualification_path': 'docs/quality/admin-user-resources-166.json', 'qualification_sha256': digest(ROOT / 'docs/quality/admin-user-resources-166.json'), 'user_owned_files_preserved': 12, 'desktop_attributes_unchanged': True, 'new_whole_requirement_closures': 0, 'whole_scope_note': 'Current source increment; frozen rc.5 remains unchanged. Production services/signing and all original whole-acceptance scopes remain.', 'publisher_sha256': digest(Path(__file__))}
    public_name = 'docs/quality/admin-user-resources-publication-166.json'
    write(ROOT / public_name, public)
    for name in ['docs/README.md', 'docs/README.en.md']:
        p = ROOT / name
        p.write_text(p.read_text(encoding='utf-8').replace('[本轮更新 / Changes]', '[Git发布回执 / Publication](quality/admin-user-resources-publication-166.json) · [本轮更新 / Changes]', 1), encoding='utf-8', newline='\n')
    staged(ROOT, ['docs/README.md', 'docs/README.en.md', public_name])
    git(ROOT, 'commit', '-m', 'Record verified stage166 source publication and preserved frozen release')
    head = git(ROOT, 'rev-parse', 'HEAD')
    assert refs() == expected
    git(ROOT, 'push', '--atomic', 'origin', head + ':refs/heads/docs', head + ':refs/heads/main')
    expected.update({'refs/heads/docs': head, 'refs/heads/main': head})
    assert refs() == expected
    preserve(baseline)
    for name, h in report['sources'].items(): assert digest(DEV / name) == h
    result.update(status='published', verified_refs=expected, source_commits=commits, final_docs_commit=head, frozen_tags_unchanged=True, release_assets_modified=False, preserved_user_files=12)
except Exception as e:
    result.update(status='failed', failure=type(e).__name__ + ': ' + str(e))
finally:
    result['finished_at'] = datetime.now(timezone.utc).isoformat()
    write(out / 'receipt.json', result); log.close()
    print(json.dumps({'status': result['status'], 'receipt': str(out / 'receipt.json'), 'failure': result['failure']}, ensure_ascii=False), flush=True)
assert result['status'] == 'published'
