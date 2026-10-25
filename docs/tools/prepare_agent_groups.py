"""Preserve the published stage92 inputs before implementing persistent teams."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / 'docs/quality/history/stage93-before-agent-groups'
assert not ARCHIVE.exists()
ARCHIVE.mkdir(parents=True)
files = [
    'dev/copypaste-platform/src/server.ts',
    'dev/copypaste-platform/src/business.ts',
    'dev/copypaste-platform/src/task-service.ts',
    'dev/copypaste-platform/src/task-business-tools.ts',
    'dev/copypaste-platform/src/demo-gateway.ts',
    'dev/copypaste-platform/src/admin-content.ts',
    'dev/copypaste-platform/src/erasure.ts',
    'dev/copypaste-web/src/main.tsx',
    'dev/copypaste-web/src/api.ts',
    'docs/quality/requirements-alignment-progress.json',
    'docs/quality/workmate-publication.json',
]
rows = []
digest = lambda p: sha256(p.read_bytes()).hexdigest()
for name in files:
    source = ROOT / name
    target = ARCHIVE / (name.replace('/', '__') + '.snapshot')
    target.write_bytes(source.read_bytes())
    rows.append({'path': name, 'archive': target.relative_to(ROOT).as_posix(), 'sha256': digest(target)})
repositories = {}
for label, folder in [('docs', ROOT)] + [(v, ROOT / 'dev' / ('copypaste-' + v)) for v in ['platform', 'web', 'admin', 'desktop', 'extension', 'delivery']]:
    command = ['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false']
    # New stage93 files are already present; every published tracked byte must
    # still match its recorded HEAD before these preimages are captured.
    assert not subprocess.check_output(command + ['status', '--porcelain', '--untracked-files=no'], cwd=folder)
    repositories[label] = subprocess.check_output(command + ['rev-parse', 'HEAD'], cwd=folder, text=True).strip()
preserved = {}
for folder in ['migrations', 'contracts', 'skills', 'catalog']:
    for file in (ROOT / 'dev/copypaste-platform' / folder).rglob('*'):
        if file.is_file(): preserved[file.relative_to(ROOT).as_posix()] = digest(file)
progress = json.loads((ROOT / 'docs/quality/requirements-alignment-progress.json').read_text(encoding='utf-8'))
assert len(progress['requirements']) == 102
receipt = {'at': datetime.now(timezone.utc).isoformat(), 'stage': 93, 'files': rows, 'repositories': repositories,
    'published_files': preserved, 'requirements': progress['requirements'],
    'protected_role_catalog_sha256': digest(ROOT / 'docs/contracts/role-preset-catalog-current.json')}
(ARCHIVE / 'receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'preserved_files': len(rows), 'published_integrity_files': len(preserved), 'repositories': len(repositories)}))
