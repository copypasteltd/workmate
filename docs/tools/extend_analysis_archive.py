"""Retain additional original sources before extending the synthetic Codex journey."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/quality/history/stage90-before-analysis-roles'
FILES = ['dev/copypaste-platform/src/demo-gateway.ts']
rows = []
for name in FILES:
    value = (ROOT / name).read_bytes()
    target = OUT / (name.replace('/', '__') + '.snapshot')
    with target.open('xb') as stream:
        stream.write(value)
    rows.append({'source': name, 'archive': target.relative_to(ROOT).as_posix(),
                 'sha256': sha256(value).hexdigest(), 'bytes': len(value)})
with (OUT / 'additional-receipt.json').open('x', encoding='utf-8') as stream:
    json.dump({'at': datetime.now(timezone.utc).isoformat(), 'files': rows}, stream,
              ensure_ascii=False, indent=2)
    stream.write('\n')
print(json.dumps({'status': 'preserved', 'files': len(rows)}))
