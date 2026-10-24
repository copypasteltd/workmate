"""Verify preserved migrations, exact assertion changes and prepared-query proof."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'docs/quality/managed-video-upgrade-review.json'


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def read(file):
    return json.loads(file.read_text(encoding='utf-8'))


def main():
    assert not OUTPUT.exists()
    baseline_file = ROOT / 'docs/quality/generated-video-checkpoint.json'
    baseline = read(baseline_file)
    previous = {name: value for name, value in baseline['source_files'].items()
                if name.startswith('copypaste-platform/migrations/')}
    assert len(previous) == 97
    for name, value in previous.items():
        assert digest(ROOT / 'dev' / name) == value, name
    archived = read(ROOT / 'docs/quality/history/stage81-before-compatibility-inventory/receipt.json')
    row = next(item for item in archived['files'] if item['path'] == 'dev/copypaste-platform/tests/migrations.test.ts')
    original = ROOT / row['archive']
    assert digest(original) == row['sha256']
    old = original.read_bytes()
    pattern = rb'(SELECT max\(version\) AS v FROM schema_migrations[^;]+?\.v,\r?\n\s*)97(,\r?\n)'
    updated, count = re.subn(pattern, lambda match: match.group(1) + b'98' + match.group(2), old)
    actual = ROOT / row['path']
    assert count == 2 and updated == actual.read_bytes(), 'Only the two final version assertions may change'
    core_file = ROOT / 'dev/copypaste-delivery/evidence/managed-video-capabilities-03.json'
    core = read(core_file)
    assert core['status'] == 'passed' and core['source_unchanged'] and core['owned_database_shutdown']
    assert core['counts']['tests'] == core['counts']['pass'] == 17
    for name in ['src/capability-video-verification.ts', 'migrations/098-managed-video-capabilities.sql', 'tests/capability-video-verification.test.ts']:
        assert digest(ROOT / 'dev/copypaste-platform' / name) == core['source_files']['copypaste-platform/' + name]
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'published_migrations_preserved': 97,
        'baseline': {'path': baseline_file.relative_to(ROOT).as_posix(), 'sha256': digest(baseline_file)},
        'migration_test_assertions': {'path': row['path'], 'archive': row['archive'], 'before_sha256': digest(original),
            'after_sha256': digest(actual), 'only_final_version_assertions_changed': 2, 'other_test_bytes_changed': False},
        'prepared_query_upgrade': {'proof': core_file.relative_to(ROOT).as_posix(), 'sha256': digest(core_file),
            'scope': 'Original SQL097 named prepared statements and function OIDs are retained through SQL098 and observe new video holds and uncertainty; re-executed again in the complete current platform run.'},
        'verifier_sha256': digest(Path(__file__))}
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print('97 published migrations unchanged; exactly two final-version assertions updated; original prepared-query upgrade exercised.')


if __name__ == '__main__':
    main()
