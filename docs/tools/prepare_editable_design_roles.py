"""Keep published inputs before implementing actual vector and presentation tools."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/quality/history/stage92-before-editable-design'
assert not OUT.exists()
FILES = [
    'dev/copypaste-platform/package.json', 'dev/copypaste-platform/package-lock.json',
    'dev/copypaste-platform/src/task-business-tools.ts', 'dev/copypaste-platform/src/agent-templates.ts',
    'dev/copypaste-platform/src/demo-gateway.ts', 'dev/copypaste-platform/src/cloud-workflows.ts',
    'dev/copypaste-platform/catalog/role-preset-catalog.json', 'dev/copypaste-platform/catalog/role-preset-history.json',
    'dev/copypaste-platform/catalog/skill-packages.json',
    'docs/quality/workmate-publication.json', 'docs/quality/requirements-alignment-progress.json',
]
OUT.mkdir(parents=True)
rows = []
for name in FILES:
    value = (ROOT / name).read_bytes()
    saved = OUT / (name.replace('/', '__') + '.snapshot')
    with saved.open('xb') as f: f.write(value)
    rows.append({'source': name, 'archive': saved.relative_to(ROOT).as_posix(), 'sha256': sha256(value).hexdigest(), 'bytes': len(value)})
with (OUT / 'receipt.json').open('x', encoding='utf-8', newline='\n') as f:
    f.write(json.dumps({'at': datetime.now(timezone.utc).isoformat(), 'files': rows}, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'status': 'preserved', 'files': len(rows)}))
