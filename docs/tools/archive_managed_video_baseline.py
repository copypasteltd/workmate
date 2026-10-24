"""Retain the published stage-80 Git blobs before stage-81 documentation sync.

These are Git-object bytes, not a reconstruction of old working-tree evidence.
Previously recorded raw test receipts, media and source hashes remain untouched.
"""
import json
import subprocess
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / 'docs/quality/history/before-stage81-managed-video'
HEADS = {
    '.': '30df1ed270a756b77fa82d923849deb020950965',
    'copypaste-platform': 'd83fabed490b55ead4396324e2da05f469371f40',
    'copypaste-web': '9a447c62e2ba734cba7849ddc6d5e4415dc38f04',
    'copypaste-admin': 'dcdf7f797ca8301d2f961649a272ad14e340f5da',
    'copypaste-desktop': '5b42b337a470e6428e197d231b9281b965d4ed7b',
    'copypaste-extension': 'b29fba6d8693fe0ff964061f77ad179fba3ac5ce',
    'copypaste-delivery': 'd1a7a4f4a1eab70d39fd3218ead6e0518ee41686',
}


def git(repo, *args):
    return subprocess.check_output(['git', '-c', 'core.fsmonitor=false', '-c',
        'core.untrackedCache=false', *args], cwd=repo)


def main():
    receipt = TARGET / 'baseline.json'
    assert not receipt.exists(), 'Do not overwrite a baseline receipt'
    records = []
    for name, commit in HEADS.items():
        repo = ROOT if name == '.' else ROOT / 'dev' / name
        assert git(repo, 'rev-parse', 'HEAD').decode().strip() == commit
        tracked = set(filter(None, git(repo, 'ls-files', '-z').decode().split('\0')))
        changed = set(filter(None, git(repo, 'diff', '--name-only', '-z', 'HEAD').decode().split('\0')))
        names = changed | {n for n in tracked if n.lower() in ('readme.md', 'readme.en.md', 'readme.zh-cn.md', 'readme.zh-hk.md', 'changelog.md')}
        if name == '.':
            names |= {n for n in tracked if n.startswith(('docs/product/', 'docs/technical/80-', 'docs/quality/generated-video-', 'docs/contracts/capability-releases.'))}
        for file in sorted(names & tracked):
            data = git(repo, 'show', commit + ':' + file)
            destination = TARGET / ('root' if name == '.' else name) / file
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open('xb') as output:
                output.write(data)
            records.append({'repo': name, 'commit': commit, 'path': file,
                'archive': destination.relative_to(ROOT).as_posix(), 'bytes': len(data),
                'sha256': sha256(data).hexdigest(), 'byte_origin': 'published_git_blob'})
    receipt.write_text(json.dumps({'at': datetime.now(timezone.utc).isoformat(),
        'status': 'published_baseline_archived', 'heads': HEADS, 'files': records,
        'original_raw_evidence_rewritten': False}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': 'archived', 'files': len(records), 'receipt': receipt.relative_to(ROOT).as_posix()}))


if __name__ == '__main__':
    main()
