"""Preserve the stage-89 inputs before the professional analysis-tool upgrade."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/quality/history/stage90-before-analysis-roles'
assert not OUT.exists(), 'Never replace an earlier archive'
FILES = [
    'dev/copypaste-platform/src/analysis-reports.ts',
    'dev/copypaste-platform/src/task-business-tools.ts',
    'dev/copypaste-platform/src/agent-templates.ts',
    'dev/copypaste-platform/scripts/build-skills.ts',
    'dev/copypaste-platform/catalog/role-preset-catalog.json',
    'dev/copypaste-platform/catalog/role-preset-history.json',
    'dev/copypaste-platform/catalog/skill-packages.json',
    'dev/copypaste-platform/README.md', 'dev/copypaste-platform/README.en.md',
    'dev/copypaste-delivery/README.md', 'dev/copypaste-delivery/README.en.md',
    'docs/README.md', 'docs/README.en.md',
    'docs/contracts/role-preset-catalog-current.json',
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
    'at': datetime.now(timezone.utc).isoformat(),
    'purpose': 'Original byte preservation; no acceptance or historical test status changes',
    'files': rows,
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'status': 'preserved', 'files': len(rows)}))
