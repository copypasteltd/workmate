"""Preserve the exact stage-88 inputs before repairing first-work submission."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/quality/history/stage89-before-work-intake'
assert not OUT.exists(), 'Never replace an earlier archive'
FILES = [
    'dev/copypaste-web/src/main.tsx', 'dev/copypaste-web/src/api.ts',
    'dev/copypaste-web/src/context.tsx', 'dev/copypaste-web/src/video-brief.tsx',
    'dev/copypaste-web/README.md', 'dev/copypaste-web/README.en.md',
    'dev/copypaste-delivery/README.md', 'dev/copypaste-delivery/README.en.md',
    'docs/README.md', 'docs/README.en.md',
    'docs/quality/local-programs-checkpoint.json',
    'docs/quality/workmate-publication.json',
    'docs/quality/requirements-alignment-progress.json',
    'docs/quality/2026-10-25-goal-gap-summary.md',
    'docs/quality/2026-10-25-goal-gap-assessment.md',
]
OUT.mkdir(parents=True)
rows = []
for name in FILES:
    value = (ROOT / name).read_bytes()
    destination = OUT / (name.replace('/', '__') + '.snapshot')
    destination.write_bytes(value)
    rows.append({'source': name, 'archive': destination.relative_to(ROOT).as_posix(),
                 'sha256': sha256(value).hexdigest(), 'bytes': len(value)})
(OUT / 'receipt.json').write_text(json.dumps({
    'at': datetime.now(timezone.utc).isoformat(), 'purpose': 'original byte preservation',
    'files': rows,
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'status': 'preserved', 'files': len(rows)}))
