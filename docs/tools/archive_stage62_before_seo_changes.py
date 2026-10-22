"""Preserve the exact stage 62 evidence and documentation before updating it."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / 'docs/quality/history/stage62-before-seo-changes'


def git(repo, *args):
    return subprocess.check_output(['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', str(repo), *args])


def main():
    TARGET.mkdir(parents=True, exist_ok=False)
    entries = []
    sources = [
        (ROOT, p) for p in [
            'docs/quality/requirements-alignment-progress.json',
            'docs/quality/validation-report.json',
            'docs/quality/scoped-seo-checkpoint.json',
            'docs/quality/scoped-seo-artifacts.json',
            'docs/README.md', 'docs/DELIVERY.md',
            'docs/modules/05-analytics-seo-geo.md',
            'docs/quality/02-requirements-traceability.md',
            'docs/technical/30-native-window-and-browser-sidepanel.md',
        ]
    ]
    for name in ['platform', 'web', 'admin', 'desktop', 'extension', 'delivery']:
        repo = ROOT / 'dev' / ('copypaste-' + name)
        sources.extend((repo, p) for p in ['README.md', 'README.en.md'])
    for repo, p in sources:
        source = repo / p
        head = git(repo, 'rev-parse', 'HEAD').decode().strip()
        data = source.read_bytes()
        assert data == git(repo, 'show', head + ':' + p), str(source)
        rel = source.relative_to(ROOT)
        archive_rel = rel.as_posix().replace('/', '__') + ('.snapshot' if source.suffix == '.md' else '')
        archive = TARGET / archive_rel
        with archive.open('xb') as handle:
            handle.write(data)
        entries.append({
            'path': rel.as_posix(), 'repository': repo.relative_to(ROOT).as_posix(),
            'baseline_commit': head, 'repository_path': p,
            'archive': archive.relative_to(ROOT).as_posix(),
            'sha256': sha256(data).hexdigest(), 'archive_kind': 'exact_source_bytes',
            'relative_links_base': rel.parent.as_posix() + '/',
        })
    manifest = {'at': datetime.now(timezone.utc).isoformat(), 'files': entries}
    with (TARGET / 'manifest.json').open('x', encoding='utf-8', newline='\n') as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    print(json.dumps({'archived_files': len(entries), 'exact_git_bytes': True}))


if __name__ == '__main__':
    main()
