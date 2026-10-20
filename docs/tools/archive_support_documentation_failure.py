"""Keep the original strict-ref failure and the exact document verifier."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'dev/copypaste-delivery/evidence/support-documentation-initial'
DEST.mkdir(exist_ok=False)
source = ROOT / 'docs/quality/validation-report.json'
report = json.loads(source.read_bytes())
assert report['status'] == 'failed' and report['checks_failed'] == 1
assert report['failures'] == ["ref:admin-support-schemas.json:#/components/schemas/AdminSupportSession:'components'"]
rows = []
for index, source in enumerate([source, ROOT / 'docs/tools/validate_docs.py'], 1):
    target = DEST / (str(index).zfill(4) + source.suffix)
    target.write_bytes(source.read_bytes())
    rows.append({'source': source.relative_to(ROOT).as_posix(), 'archived': target.relative_to(ROOT).as_posix(), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
(DEST / 'archive-map.json').write_text(json.dumps({'scope': 'Original source/source_sha256 fixture namespace was not recognized by the document verifier; strict schema content and original OpenAPI remain unchanged.', 'files': rows}, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'archived_files': len(rows)}))
