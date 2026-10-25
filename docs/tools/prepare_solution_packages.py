"""Preserve published sources before adding versioned business solution packages."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / 'docs/quality/history/stage96-before-solution-packages'
assert not ARCHIVE.exists()
ARCHIVE.mkdir(parents=True)
repositories = {}
command = ['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false']
folders = [('docs', ROOT)] + [(name, ROOT / 'dev' / ('copypaste-' + name))
    for name in ['platform', 'web', 'admin', 'desktop', 'extension', 'delivery']]
for name, folder in folders:
    assert not subprocess.check_output(command + ['status', '--porcelain', '--untracked-files=no'], cwd=folder)
    repositories[name] = subprocess.check_output(command + ['rev-parse', 'HEAD'], cwd=folder, text=True).strip()
files = ['dev/copypaste-platform/src/agent-templates.ts',
    'dev/copypaste-platform/src/task-service.ts', 'dev/copypaste-platform/src/server.ts',
    'dev/copypaste-platform/src/admin.ts', 'dev/copypaste-web/src/main.tsx',
    'dev/copypaste-admin/src/main.tsx', 'docs/quality/workmate-publication.json',
    'docs/quality/requirements-alignment-progress.json',
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
publication = ROOT / 'dev/copypaste-delivery/.data/publication/c6906bbc-5d1f-4a82-b902-bfa3cf928889/receipt.json'
prior = json.loads(publication.read_text(encoding='utf-8'))
assert prior['status'] == 'pushed_and_verified'
published = ARCHIVE / 'stage95-publication-receipt.json'
with published.open('xb') as stream: stream.write(publication.read_bytes())
receipt = {'at': datetime.now(timezone.utc).isoformat(), 'stage': 96,
    'files': rows, 'repositories': repositories, 'published_files': preserved,
    'requirements': progress['requirements'], 'gates': progress['gates'],
    'protected_role_catalog_sha256': digest(ROOT / 'docs/contracts/role-preset-catalog-current.json'),
    'stage95_publication': {'path': published.relative_to(ROOT).as_posix(), 'sha256': digest(published)},
    'verifier_sha256': digest(Path(__file__))}
with (ARCHIVE / 'receipt.json').open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(receipt, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
print(json.dumps({'preserved_files': len(rows), 'published_integrity_files': len(preserved), 'repositories': len(repositories)}))
