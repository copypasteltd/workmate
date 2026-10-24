"""Retain the failed qualification's bytes and update only two schema maxima."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
FILE = DEV / 'copypaste-platform/tests/migrations.test.ts'
ARCHIVE = ROOT / 'docs/quality/history/before-stage80-migration-count/migrations.test.ts'
RECEIPT = ROOT / 'docs/quality/generated-video-test-inventory-refresh.json'
BEFORE = b'"SELECT max(version) AS v FROM schema_migrations")).rows[0]\n        .v,\n      96,'
AFTER = BEFORE.replace(b'96,', b'97,')


def transform(data):
    # Preserve the existing file's exact line endings and every other assertion.
    old, new = (BEFORE, AFTER) if BEFORE in data else (BEFORE.replace(b'\n', b'\r\n'), AFTER.replace(b'\n', b'\r\n'))
    assert data.count(old) == 2
    return data.replace(old, new)


def main():
    assert not RECEIPT.exists() and not ARCHIVE.exists()
    original = FILE.read_bytes()
    plan = DEV / 'copypaste-delivery/evidence/desktop-execution-control-24-plan.json'
    frozen = json.loads(plan.read_text(encoding='utf-8'))
    name = FILE.relative_to(DEV).as_posix()
    before_sha256 = sha256(original).hexdigest()
    assert frozen['source_files'][name] == before_sha256
    updated = transform(original)
    ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
    ARCHIVE.write_bytes(original)
    FILE.write_bytes(updated)
    result = {
        'at': datetime.now(timezone.utc).isoformat(), 'path': name,
        'before_sha256': before_sha256, 'after_sha256': sha256(updated).hexdigest(),
        'archive': ARCHIVE.relative_to(ROOT).as_posix(),
        'previous_plan': plan.relative_to(ROOT).as_posix(),
        'transformation': 'Only the two final max(schema_migrations.version) assertions change from 96 to 97. All historical fixture, original migration digest and financial fact assertions retain their exact bytes.',
        'qualification': 'Fresh complete platform qualification is required. Earlier focused, native and UI journeys did not execute this platform migration-test file; their runtime and selected test sources are unchanged.',
        'verifier_sha256': sha256(Path(__file__).read_bytes()).hexdigest(),
    }
    RECEIPT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
