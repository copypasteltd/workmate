"""Remove trailing blank lines from the two newly generated stage100 notes."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[2]
rows = []
for name in ['2026-10-26-cloud-development.md', '2026-10-26-cloud-development.en.md']:
    path = ROOT / 'docs/changes' / name
    before = path.read_bytes()
    after = before.rstrip(b'\n') + b'\n'
    assert before.endswith(b'\n\n') and after != before
    assert before.rstrip(b'\n') == after.rstrip(b'\n')
    path.write_bytes(after)
    rows.append({'path': path.relative_to(ROOT).as_posix(),
                 'before_sha256': sha256(before).hexdigest(),
                 'after_sha256': sha256(after).hexdigest(),
                 'only_trailing_lf_removed': True})
output = ROOT / 'docs/quality/cloud-development-note-whitespace.json'
with output.open('x', encoding='utf-8', newline='\n') as stream:
    json.dump({'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed',
               'scope': 'Only two new unpublished change notes; visible content, links, sources, immutable archives and media are unchanged',
               'files': rows, 'verifier_sha256': sha256(Path(__file__).read_bytes()).hexdigest()}, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
print(json.dumps({'status': 'passed', 'notes_normalized': len(rows)}))
