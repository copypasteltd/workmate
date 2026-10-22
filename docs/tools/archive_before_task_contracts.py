"""Preserve pre-repair README/progress bytes before publishing their successors."""
from hashlib import sha256
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
archive = root / 'docs/quality/history/stage67-before-canonical-tasks'
manifest = archive / 'manifest.json'
assert not manifest.exists(), 'Archive already exists; preserve the first captured bytes'
files = [root / 'docs/README.md', root / 'docs/README.en.md',
         root / 'docs/quality/requirements-alignment-progress.json',
         root / 'docs/quality/09-implementation-alignment-audit.md',
         root / 'docs/quality/workmate-publication.json',
         root / 'dev/copypaste-platform/contracts/implemented-routes.json']
for component in ('platform', 'web', 'admin', 'desktop', 'extension', 'delivery'):
    files.extend(root / ('dev/copypaste-' + component) / name for name in ('README.md', 'README.en.md'))
entries = []
for source in files:
    relative = source.relative_to(root)
    target = archive / (relative.as_posix() + '.txt')
    target.parent.mkdir(parents=True, exist_ok=True)
    raw = source.read_bytes()
    # The actual inventory has already been refreshed. Capture its exact previous
    # Git blob instead of presenting the new 415-route export as a prior version.
    if relative.as_posix() == 'dev/copypaste-platform/contracts/implemented-routes.json':
        import subprocess
        raw = subprocess.run(['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', 'show', 'HEAD:contracts/implemented-routes.json'],
            cwd=source.parents[1], capture_output=True, check=True).stdout
    with target.open('xb') as out:
        out.write(raw)
    entries.append({'source': relative.as_posix(), 'archive': target.relative_to(root).as_posix(),
        'sha256': sha256(raw).hexdigest(), 'bytes': len(raw)})
with manifest.open('x', encoding='utf-8', newline='\n') as out:
    out.write(json.dumps({'scope': 'Exact pre-canonical-task README, progress and publication bytes; previous implementation inventory recovered from its unchanged Git HEAD.', 'files': entries}, ensure_ascii=False, indent=2) + '\n')
print(f'Archived {len(entries)} exact source byte streams')
