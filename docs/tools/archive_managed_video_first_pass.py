"""Preserve first-pass source bytes before the reviewed video refinements."""
import json
from hashlib import sha256
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / 'docs/quality/history/stage81-before-video-refinement'
REPORT = ROOT / 'dev/copypaste-delivery/evidence/managed-video-capabilities-01.json'
FILES = [
    'dev/copypaste-platform/migrations/098-managed-video-capabilities.sql',
    'dev/copypaste-platform/src/capability-video-verification.ts',
    'dev/copypaste-platform/src/capability-releases.ts',
    'dev/copypaste-platform/tests/capability-video-verification.test.ts',
    'dev/copypaste-admin/src/capability-model.ts',
    'dev/copypaste-admin/src/capabilities.tsx',
    'dev/copypaste-delivery/scripts/run-managed-video-capabilities.mjs',
    'docs/contracts/capability-releases.openapi.json',
    'docs/tools/build_capability_release_contract.py',
]
data = json.loads(REPORT.read_text(encoding='utf-8'))
assert data['status'] == 'passed' and data['source_unchanged'] and data['owned_database_shutdown']
assert data['counts']['tests'] == data['counts']['pass'] == 12
assert not (TARGET / 'receipt.json').exists()
records = []
for file in FILES:
    content = (ROOT / file).read_bytes()
    digest = sha256(content).hexdigest()
    key = file.removeprefix('dev/')
    if key in data['source_files']:
        assert data['source_files'][key] == digest
    destination = TARGET / file
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open('xb') as output:
        output.write(content)
    records.append({'path': file, 'archive': destination.relative_to(ROOT).as_posix(), 'sha256': digest, 'bytes': len(content)})
(TARGET / 'receipt.json').write_text(json.dumps({'status': 'archived_before_refinement',
    'first_pass': {'path': REPORT.relative_to(ROOT).as_posix(), 'sha256': sha256(REPORT.read_bytes()).hexdigest()},
    'first_pass_is_current_qualification': False, 'files': records}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'status': 'archived', 'files': len(records)}))
