"""Publish reviewed handbooks and seven immutable v0.1.0 tags atomically."""
from pathlib import Path
from hashlib import sha256, sha1
from datetime import datetime, timezone
from urllib.parse import unquote
import json
import os
import re
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
VERSION = 'v0.1.0'
COMPONENTS = {'backend': 'platform', 'web': 'web', 'admin': 'admin', 'desktop': 'desktop', 'extension': 'extension', 'delivery': 'delivery'}
BRANCHES = [*COMPONENTS, 'docs', 'main']


def digest(p):
    h = sha256()
    with p.open('rb') as f:
        for b in iter(lambda: f.read(4 * 1024 * 1024), b''):
            h.update(b)
    return h.hexdigest()


def main():
    cp_path = ROOT / 'docs/quality/release-freeze-checkpoint-167.json'
    cp = json.loads(cp_path.read_bytes())
    baseline = cp['baseline']
    out = DELIVERY / '.data/release-freeze-167' / ('publication-' + str(uuid.uuid4()))
    out.mkdir()
    result = {'started_at': datetime.now(timezone.utc).isoformat(), 'status': 'running', 'release': VERSION, 'report_sha256': digest(cp_path), 'components': {}, 'failure': None}
    log = (out / 'commands.log').open('xb')
    env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GIT_SSH_COMMAND': 'ssh -o BatchMode=yes'}

    def git(repo, *args):
        argv = ['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'gc.auto=0', '-c', 'gc.autoPackLimit=0', '-C', str(repo), *args]
        log.write((json.dumps({'repo': str(repo), 'args': args}) + '\n').encode()); log.flush()
        p = subprocess.run(argv, cwd=repo, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        log.write(p.stdout + p.stderr + b'\n'); log.flush()
        assert p.returncode == 0, 'Git failed; original commands.log retained'
        return p.stdout.decode('utf-8').strip()

    def refs():
        return {s.split()[1]: s.split()[0] for s in git(ROOT, 'ls-remote', 'origin', *['refs/heads/' + b for b in BRANCHES], 'refs/tags/v0.1.0*').splitlines()}

    def preserve():
        for n, h in baseline['preserved_user_files'].items():
            assert digest(ROOT / n) == h, n
        assert digest(DEV / 'copypaste-desktop/.gitattributes') == baseline['desktop_attributes_sha256']
        frozen = baseline['frozen_rc5']
        assert digest(Path(frozen['directory']) / 'release-manifest.json') == frozen['manifest_sha256']
        assert digest(Path(frozen['directory']) / 'SHA256SUMS') == frozen['sums_sha256']
        assert Path(frozen['complete_archive']['path']).stat().st_size == frozen['complete_archive']['bytes']
        for n, h in cp['qualified_sources'].items():
            assert digest(DEV / n) == h, n

    try:
        assert cp['status'] == 'qualified' and cp['release'] == VERSION
        assert len(cp['build_commands']) == 6 and all(x['exit_code'] == 0 for x in cp['build_commands'])
        assert cp['focused_qualification']['database_cases'] == 8 and cp['focused_qualification']['actual_ui_checks'] == 8
        assert cp['windows_distribution']['native_main_and_renderer_rebuilt_and_identical']
        before = refs()
        assert before == baseline['remote_refs'] and len(before) == 78
        preserve()
        repos = {b: DEV / ('copypaste-' + c) for b, c in COMPONENTS.items()}
        repos['docs'] = ROOT
        names = {b: ['README.md', 'README.en.md'] for b in COMPONENTS}
        names['delivery'] += ['scripts/package-frozen-release-167-v1.py', 'scripts/publish-github-release-167-v1.py']
        names['delivery'] += sorted(p.relative_to(DELIVERY).as_posix() for p in (DELIVERY / 'evidence/release-freeze-167').glob('*.json'))
        names['docs'] = ['docs/README.md', 'docs/README.en.md', 'docs/releases/v0.1.0.md', 'docs/development/167-final-release-freeze.md', 'docs/changes/167-final-release-freeze.md', 'docs/quality/release-freeze-checkpoint-167.json', 'docs/quality/remaining-work-stage167.json', 'docs/quality/remaining-work-stage167.md', 'docs/tools/prepare-final-freeze-167-v1.py', 'docs/tools/prepare-final-handbooks-167-v1.py', 'docs/tools/publish-final-freeze-167-v1.py', 'docs/tools/finalize-final-release-167-v1.py']
        for b, repo in repos.items():
            assert git(repo, 'rev-parse', 'HEAD') == baseline['heads']['docs' if b == 'docs' else COMPONENTS[b]]
            assert git(repo, 'branch', '--show-current') == 'codex/' + b
            assert git(repo, 'remote', 'get-url', 'origin') == 'git@github.com:copypasteltd/workmate.git'
            assert not git(repo, 'diff', '--cached', '--name-only')
            changed = set(git(repo, 'diff', 'HEAD', '--name-only', '-z').split('\0')) - {''}
            assert changed <= set(names[b]), 'Unrelated tracked change: ' + b
            if b != 'docs':
                for n in ['README.md', 'README.en.md']:
                    text = (repo / n).read_text(encoding='utf-8')
                    assert 'v0.1.0-' + b in text and '```mermaid' in text
                    for target in re.findall(r'!?\[[^\]]*\]\(([^\s)]+)\)', text):
                        if not target.startswith(('https://', 'http://', '#')):
                            assert (repo / unquote(target.split('#')[0])).is_file(), (b, n, target)
            git(repo, 'add', '--', *names[b])
            staged = set(git(repo, 'diff', '--cached', '--name-only', '-z').split('\0')) - {''}
            assert staged == set(names[b]), (b, staged ^ set(names[b]))
            for n in names[b]:
                raw = (repo / n).read_bytes()
                assert git(repo, 'ls-files', '-s', '--', n).split()[1] == sha1(('blob ' + str(len(raw)) + '\0').encode() + raw).hexdigest(), n
        heads = {}
        for b, repo in repos.items():
            git(repo, 'commit', '-m', 'Freeze Workmate v0.1.0 complete source and client delivery (stage167)')
            heads[b] = git(repo, 'rev-parse', 'HEAD')
            git(repo, 'merge-base', '--is-ancestor', baseline['heads']['docs' if b == 'docs' else COMPONENTS[b]], heads[b])
            result['components'][b] = {'commit': heads[b], 'files': len(names[b])}
            print(json.dumps({'phase': 'committed', 'component': b, 'commit': heads[b]}), flush=True)
        for b, repo in repos.items():
            if b != 'docs':
                git(ROOT, 'fetch', '--no-tags', '--no-write-fetch-head', str(repo), heads[b])
        assert refs() == before, 'Concurrent remote changes preserved'
        tags = {}
        for b in [*COMPONENTS, 'docs']:
            tag = VERSION + ('' if b == 'docs' else '-' + b)
            assert not git(ROOT, 'tag', '--list', tag), 'Existing local tag preserved'
            git(ROOT, 'tag', '-a', tag, heads[b], '-m', 'Workmate v0.1.0 initial frozen synthetic delivery; ' + b)
            tags[tag] = {'object': git(ROOT, 'rev-parse', 'refs/tags/' + tag), 'commit': heads[b]}
        preserve()
        git(ROOT, 'push', '--atomic', 'origin', *[heads[b] + ':refs/heads/' + b for b in COMPONENTS], heads['docs'] + ':refs/heads/docs', heads['docs'] + ':refs/heads/main', *['refs/tags/' + t + ':refs/tags/' + t for t in tags])
        expected = {**before, **{'refs/heads/' + b: heads['docs' if b == 'main' else b] for b in BRANCHES}}
        for tag, value in tags.items():
            expected['refs/tags/' + tag] = value['object']
            expected['refs/tags/' + tag + '^{}'] = value['commit']
        assert refs() == expected and len(expected) == 92
        preserve()
        result.update(status='published', verified_refs=expected, tags=tags, previous_frozen_tags_unchanged=True, frozen_bytes_unchanged=True, preserved_user_files=12)
    except Exception as e:
        result.update(status='failed', failure=type(e).__name__ + ': ' + str(e))
    finally:
        result['finished_at'] = datetime.now(timezone.utc).isoformat()
        result['publisher_sha256'] = digest(Path(__file__))
        with (out / 'receipt.json').open('x', encoding='utf-8', newline='\n') as f:
            f.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        log.close()
        print(json.dumps({'status': result['status'], 'receipt': str(out / 'receipt.json'), 'failure': result['failure']}, ensure_ascii=False), flush=True)
    assert result['status'] == 'published'


if __name__ == '__main__':
    main()
