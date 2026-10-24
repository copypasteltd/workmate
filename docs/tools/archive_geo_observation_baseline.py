"""Retain the published stage-82 working bytes before GEO and responsive-shell work."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / 'docs/quality/history/stage83-before-geo-observations'


def git(repo, *args):
    return subprocess.check_output(['git', '-c', 'core.fsmonitor=false', '-c',
        'core.untrackedCache=false', *args], cwd=repo)


def main():
    assert not TARGET.exists(), 'Never overwrite pre-edit sources'
    records, heads = [], {}
    for component in ['docs', 'platform', 'web', 'admin', 'desktop', 'extension', 'delivery']:
        repo = ROOT if component == 'docs' else ROOT / 'dev' / ('copypaste-' + component)
        heads[component] = git(repo, 'rev-parse', 'HEAD').decode().strip()
        assert not git(repo, 'diff', '--name-only', 'HEAD'), component
        names = [n for n in git(repo, 'ls-files', '-z').decode().split('\0') if n]
        for name in names:
            selected = name in ['README.md', 'README.en.md', 'package.json', 'package-lock.json', 'renderer-source.json']
            selected |= component == 'docs' and (name in ['docs/README.md', 'docs/README.en.md', 'docs/quality/workmate-publication.json',
                'docs/quality/creative-feedback-checkpoint.json', 'docs/quality/creative-feedback-visual-review.md']
                or name.startswith(('docs/requirements/', 'docs/product/', 'docs/quality/requirements-alignment-')))
            selected |= component != 'docs' and name.startswith(('src/', 'renderer/src/', 'scripts/', 'tests/', 'migrations/', 'catalog/', 'contracts/', 'skills/'))
            if not selected:
                continue
            raw = (repo / name).read_bytes()
            target = TARGET / component / name
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as stream:
                stream.write(raw)
            records.append({'component': component, 'commit': heads[component], 'path': name,
                'archive': target.relative_to(ROOT).as_posix(), 'sha256': sha256(raw).hexdigest(),
                'byte_origin': 'Clean published tracked working file before this stage'})
    assert len([r for r in records if r['component'] == 'platform' and r['path'].startswith('migrations/')]) == 99
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'archived', 'stage': 83,
        'heads': heads, 'files': records, 'published_migrations': 99, 'original_requirements': 102,
        'original_complete_acceptance_changed': False, 'verifier_sha256': sha256(Path(__file__).read_bytes()).hexdigest()}
    (TARGET / 'receipt.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': 'archived', 'files': len(records), 'repositories': len(heads)}))


if __name__ == '__main__':
    main()
