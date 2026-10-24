"""Retain the old Skill test and assert the explicit additional package version."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
FILE = DEV / 'copypaste-platform/tests/skill-lifecycle.test.ts'
ARCHIVE = ROOT / 'docs/quality/history/before-stage80-skill-count/skill-lifecycle.test.ts'
RECEIPT = ROOT / 'docs/quality/generated-video-skill-inventory-refresh.json'
BEFORE = b'  assert.equal(f.versions.length, 29);'
AFTER = b'''  assert.equal(f.versions.length, 30);
  assert.equal(new Set(f.versions.map((v: any) => v.skill_key)).size, 29);
  assert.equal(new Set(f.versions.map((v: any) => v.id)).size, 30);
  assert.deepEqual(f.versions.filter((v: any) => v.skill_key === "video-generation").map((v: any) => v.package_version).sort(), ["1.0.0", "1.1.0"]);'''


def transform(data):
    assert data.count(BEFORE) == 1
    return data.replace(BEFORE, AFTER.replace(b'\n', b'\r\n') if b'\r\n' in data else AFTER)


def main():
    assert not RECEIPT.exists() and not ARCHIVE.exists()
    original = FILE.read_bytes()
    plan = DEV / 'copypaste-delivery/evidence/desktop-execution-control-26-plan.json'
    frozen = json.loads(plan.read_text(encoding='utf-8'))
    name = FILE.relative_to(DEV).as_posix()
    before = sha256(original).hexdigest()
    assert frozen['source_files'][name] == before
    updated = transform(original)
    ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
    ARCHIVE.write_bytes(original)
    FILE.write_bytes(updated)
    result = {'at': datetime.now(timezone.utc).isoformat(), 'path': name,
              'before_sha256': before, 'after_sha256': sha256(updated).hexdigest(),
              'archive': ARCHIVE.relative_to(ROOT).as_posix(),
              'previous_plan': plan.relative_to(ROOT).as_posix(),
              'transformation': '30 immutable package versions preserve 29 distinct logical Skills and 30 unique IDs. Both video-generation 1.0.0 and 1.1.0 must remain. All original installation, authorization, idempotency and version-binding assertions remain.',
              'qualification': 'The earlier focused video/gateway run did not execute this Skill lifecycle test. A fresh complete platform qualification executes the final inventory.',
              'verifier_sha256': sha256(Path(__file__).read_bytes()).hexdigest()}
    RECEIPT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': 'updated', 'package_versions': 30, 'logical_skills': 29}))


if __name__ == '__main__':
    main()
