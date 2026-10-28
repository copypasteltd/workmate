"""Record the bounded artifact-fixture change after preserved native diagnostics."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json

ROOT = Path(__file__).resolve().parents[2]
P = ROOT / 'dev/copypaste-platform'
L = ROOT / 'dev/copypaste-delivery'
output = L / 'evidence/integrated-recovery-preview-fixture-application-03.json'
assert not output.exists()
digest = lambda p: sha256(p.read_bytes()).hexdigest()
read = lambda p: json.loads(p.read_text('utf-8'))
references = []
for number in ('01', '02'):
    file = L / f'evidence/integrated-recovery-full-06-runs/files/cloud-program-tools--{number}.json'
    row = read(file)
    assert row['status'] == 'failed' and row['source_unchanged']
    assert row['counts']['tests'] == 5 and row['counts']['fail'] == 1
    raw = L / row['raw_report']['path']
    assert digest(raw) == row['raw_report']['sha256']
    assert 'assert.ok(failed.preview)' in raw.read_text('utf-8')
    references.append({'path': file.relative_to(L).as_posix(), 'sha256': digest(file)})
diagnostic = L / 'evidence/cloud-preview-diagnostic-01.json'
row = read(diagnostic)
assert row['status'] == 'passed' and row['source_unchanged'] and row['owned_database_shutdown']
assert row['scope'] == 'single_program_browser_diagnostic_no_qualification'
assert row['counts'] == {'tests': 5, 'pass': 5, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
file = P / 'tests/cloud-program-tools.test.ts'
before = digest(file)
assert before == row['source_files']['copypaste-platform/tests/cloud-program-tools.test.ts']
data = file.read_bytes()
old = b'      entry: "index.html",\r\n      actions: [{ action: "click", selector: "button" }],'
new = b'      entry: "index.html",\r\n      // This test qualifies artifacts, replay and withdrawal at the supported\r\n      // upper budget; shorter deadline behavior has its own native tests.\r\n      timeout_ms: 30000,\r\n      actions: [{ action: "click", selector: "button" }],'
assert data.count(old) == 1
data = data.replace(old, new)
old = b'    assert.ok(failed.preview);'
new = b'    assert.ok(failed.preview, JSON.stringify({ stop: failed.receipt.stop_reason, checks: failed.receipt.check_result }));'
assert data.count(old) == 1
file.write_bytes(data.replace(old, new))
result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'applied',
          'changes': [{'path': 'tests/cloud-program-tools.test.ts', 'before_sha256': before, 'after_sha256': digest(file)}],
          'prior_failed_attempts': references,
          'scoped_diagnostic': {'path': diagnostic.relative_to(L).as_posix(), 'sha256': digest(diagnostic)},
          'verifier_sha256': digest(Path(__file__)),
          'scope': 'Artifact/replay/withdrawal integration fixture explicitly requests the already supported 30-second budget and retains failure details. Production default remains 15 seconds; no production deadline, assertion, sandbox or cleanup boundary is weakened. Diagnostic success does not qualify the complete inventory; a new full source-bound run is required.'}
with output.open('x', encoding='utf-8', newline='\n') as stream:
    json.dump(result, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
print(json.dumps({'status': 'applied', 'files': 1}))
