"""Publish only the four append-only status documents after the reviewed release.

This preserves the already qualified product commits, manifest, checkpoint and
existing proof bytes. The two documentation refs advance together, without
force; the six product refs must still equal the reviewed publication.
"""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
from uuid import uuid4
import json
import os
import subprocess
from audit_workmate_publication import configured_credentials

ROOT = Path(__file__).resolve().parents[2]
Q = ROOT / 'docs/quality'
EXPECTED = {
    'docs/quality/dedicated-cloud-published-121.json',
    'docs/quality/remaining-work-stage121-published.json',
    'docs/quality/remaining-work-stage121-published.md',
    'docs/changes/121-source-publication-review.md',
}
REMOTE = 'git@github.com:copypasteltd/workmate.git'


def read(file):
    return json.loads(file.read_text(encoding='utf-8-sig'))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def git(repo, *args):
    return subprocess.check_output(
        ['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', *args],
        cwd=repo, stderr=subprocess.PIPE,
        env={**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GIT_SSH_COMMAND': 'ssh -o BatchMode=yes'})


def remote_refs():
    return {name.removeprefix('refs/heads/'): commit for commit, name in
            (line.split() for line in git(ROOT, 'ls-remote', '--heads', 'origin').decode().splitlines())}


def main():
    directory = ROOT / 'dev/copypaste-delivery/.data/publication' / ('stage121-docs-status-' + str(uuid4()))
    directory.mkdir(parents=True, exist_ok=False)
    receipt = {'status': 'started', 'started_at': datetime.now(timezone.utc).isoformat(),
               'remote': REMOTE, 'scope': 'Four append-only documents; qualified product and existing proof bytes unchanged.'}
    try:
        published = read(Q / 'dedicated-cloud-published-121.json')
        review = read(Q / 'remaining-work-stage121-published.json')
        assert published['status'] == 'pushed_and_verified' and review['publication'] == published
        assert published['manifest_sha256'] == digest(Q / 'workmate-publication.json')
        assert review['checkpoint']['sha256'] == digest(ROOT / review['checkpoint']['path'])
        cp = read(ROOT / review['checkpoint']['path'])
        for name, expected in cp['source_files'].items():
            assert digest(ROOT / name) == expected, name
        assert git(ROOT, 'remote', 'get-url', 'origin').decode().strip() == REMOTE
        assert git(ROOT, 'branch', '--show-current').decode().strip() in ['codex/docs', 'docs']
        head = git(ROOT, 'rev-parse', 'HEAD').decode().strip()
        assert git(ROOT, 'rev-parse', 'HEAD^').decode().strip() == published['branches']['docs']
        names = {name.decode('utf-8') for name in git(ROOT, 'diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD').split(b'\0') if name}
        assert names == EXPECTED, names
        added = {name.decode('utf-8') for name in git(ROOT, 'diff-tree', '--no-commit-id', '--name-only', '--diff-filter=A', '-r', '-z', 'HEAD').split(b'\0') if name}
        assert added == EXPECTED
        credentials = configured_credentials()
        for name in sorted(EXPECTED):
            body = git(ROOT, 'show', 'HEAD:' + name)
            assert body == (ROOT / name).read_bytes(), name
            assert not any(secret in body for secret in credentials), (name, 'Configured credential in document')
        repos = {item['branch']: ROOT / item['directory'] for item in read(Q / 'workmate-publication.json')['components']}
        repos['docs'] = ROOT
        for branch, repo in repos.items():
            assert not git(repo, 'status', '--porcelain'), branch
            if branch != 'docs':
                assert git(repo, 'rev-parse', 'HEAD').decode().strip() == published['branches'][branch]
        before = remote_refs()
        assert all(before[key] == value for key, value in published['branches'].items())
        receipt.update(documentation_commit=head, remote_before={key: before[key] for key in published['branches']},
                       files={name: digest(ROOT / name) for name in sorted(EXPECTED)},
                       qualified_sources_rehashed=len(cp['source_files']),
                       configured_credentials_checked=True, credential_values_printed=False)
        receipt['push_porcelain'] = git(ROOT, 'push', '--atomic', '--porcelain', 'origin',
                                       head + ':refs/heads/docs', head + ':refs/heads/main').decode()
        after = remote_refs()
        expected = {**published['branches'], 'docs': head, 'main': head}
        assert all(after[key] == value for key, value in expected.items())
        receipt.update(status='pushed_and_verified', remote_after={key: after[key] for key in expected})
    except Exception:
        receipt.update(status='failed', failure='The append-only status or remote-ancestry check failed; retain this receipt and inspect locally without force-pushing.')
        raise
    finally:
        receipt['finished_at'] = datetime.now(timezone.utc).isoformat()
        with (directory / 'receipt.json').open('x', encoding='utf-8', newline='\n') as stream:
            json.dump(receipt, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
        print(json.dumps({'status': receipt['status'], 'receipt': (directory / 'receipt.json').relative_to(ROOT).as_posix()}))


if __name__ == '__main__':
    main()
