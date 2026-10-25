"""Preserve published sources before adding independently specified media effects."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / 'docs/quality/history/stage95-before-media-effects'
assert not ARCHIVE.exists()
ARCHIVE.mkdir(parents=True)
repositories = {}
command = ['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false']
folders = [('docs', ROOT)] + [(name, ROOT / 'dev' / ('copypaste-' + name))
    for name in ['platform', 'web', 'admin', 'desktop', 'extension', 'delivery']]
for name, folder in folders:
    assert not subprocess.check_output(command + ['status', '--porcelain', '--untracked-files=no'], cwd=folder)
    repositories[name] = subprocess.check_output(command + ['rev-parse', 'HEAD'], cwd=folder, text=True).strip()
files = ['dev/copypaste-platform/src/catalog.ts', 'dev/copypaste-platform/src/task-business-tools.ts',
    'dev/copypaste-platform/src/desktop-executions.ts', 'dev/copypaste-platform/src/demo-gateway.ts',
    'dev/copypaste-platform/src/server.ts', 'dev/copypaste-web/src/main.tsx',
    'docs/quality/workmate-publication.json', 'docs/quality/requirements-alignment-progress.json',
    'docs/governance/04-git-branches-and-publication.md']
for _, folder in folders:
    for name in ['README.md', 'README.en.md']:
        p = folder / name if folder != ROOT else ROOT / 'docs' / name
        files.append(p.relative_to(ROOT).as_posix())
digest = lambda p: sha256(p.read_bytes()).hexdigest()
rows = []
for name in files:
    source = ROOT / name
    target = ARCHIVE / (name.replace('/', '__') + '.snapshot')
    with target.open('xb') as stream:
        stream.write(source.read_bytes())
    rows.append({'path': name, 'archive': target.relative_to(ROOT).as_posix(), 'sha256': digest(target)})
preserved = {}
for folder in ['migrations', 'contracts', 'skills', 'catalog']:
    for p in (ROOT / 'dev/copypaste-platform' / folder).rglob('*'):
        if p.is_file(): preserved[p.relative_to(ROOT).as_posix()] = digest(p)
progress = json.loads((ROOT / 'docs/quality/requirements-alignment-progress.json').read_text(encoding='utf-8'))
publication = ROOT / 'dev/copypaste-delivery/.data/publication/d0a677d1-f67f-40f5-9cf7-bd8d1cd8ccc7/receipt.json'
prior = json.loads(publication.read_text(encoding='utf-8'))
assert prior['status'] == 'pushed_and_verified'
published = ARCHIVE / 'stage94-publication-receipt.json'
with published.open('xb') as stream: stream.write(publication.read_bytes())
receipt = {'at': datetime.now(timezone.utc).isoformat(), 'stage': 95,
    'files': rows, 'repositories': repositories, 'published_files': preserved,
    'requirements': progress['requirements'], 'gates': progress['gates'],
    'protected_role_catalog_sha256': digest(ROOT / 'docs/contracts/role-preset-catalog-current.json'),
    'stage94_publication': {'path': published.relative_to(ROOT).as_posix(), 'sha256': digest(published)},
    'verifier_sha256': digest(Path(__file__))}
with (ARCHIVE / 'receipt.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(receipt, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
print(json.dumps({'preserved_files': len(rows), 'published_integrity_files': len(preserved), 'repositories': len(repositories)}))
