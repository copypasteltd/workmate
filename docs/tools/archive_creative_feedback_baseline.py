"""Retain the published baseline and exact source bytes before feedback work."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / 'docs/quality/history/stage82-before-creative-feedback'


def git(repo, *args):
    return subprocess.check_output(['git', '-c', 'core.fsmonitor=false', '-c',
        'core.untrackedCache=false', *args], cwd=repo)


def main():
    assert not TARGET.exists(), 'Never overwrite source preimages'
    records, heads = [], {}
    for component in ['docs', 'platform', 'web', 'admin', 'desktop', 'extension', 'delivery']:
        repo = ROOT if component == 'docs' else ROOT / 'dev' / ('copypaste-' + component)
        head = git(repo, 'rev-parse', 'HEAD').decode().strip()
        heads[component] = head
        assert not git(repo, 'diff', '--name-only', 'HEAD'), component
        names = git(repo, 'ls-files', '-z').decode().split('\0')
        selected = [n for n in names if n and (n in ['README.md', 'README.en.md'] or
            (component == 'docs' and n.startswith(('docs/requirements/', 'docs/product/', 'docs/quality/requirements-alignment-', 'docs/quality/workmate-publication.json'))) or
            (component == 'platform' and (n.startswith(('src/', 'migrations/', 'contracts/')) or n == 'tests/migrations.test.ts')) or
            (component in ['web', 'desktop', 'extension'] and n.endswith(('main.tsx', 'renderer-source.json', 'background.ts', 'panel.ts', 'panel.html'))))]
        for name in selected:
            raw = (repo / name).read_bytes()
            destination = TARGET / component / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open('xb') as stream:
                stream.write(raw)
            records.append({'component': component, 'commit': head, 'path': name,
                'archive': destination.relative_to(ROOT).as_posix(), 'sha256': sha256(raw).hexdigest(),
                'byte_origin': 'pre-edit working file; Git tracked and clean'})
    receipt = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'archived',
        'heads': heads, 'files': records, 'published_migrations': 98,
        'original_requirements': 102, 'original_complete_acceptance_changed': False}
    (TARGET / 'receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': 'archived', 'files': len(records), 'heads': heads}))


if __name__ == '__main__':
    main()
