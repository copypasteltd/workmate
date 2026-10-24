"""Rebind migration/prepared-query checks after the exact test-harness repair."""
from datetime import datetime, timezone
from pathlib import Path
import json
from review_managed_video_upgrade import digest, read

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'docs/quality/managed-video-upgrade-review-02.json'


def main():
    assert not OUTPUT.exists()
    earlier_file = ROOT / 'docs/quality/managed-video-upgrade-review.json'
    earlier = read(earlier_file)
    assert earlier['status'] == 'passed'
    assert earlier['verifier_sha256'] == digest(ROOT / 'docs/tools/review_managed_video_upgrade.py')
    baseline_file = ROOT / earlier['baseline']['path']
    assert digest(baseline_file) == earlier['baseline']['sha256']
    baseline = read(baseline_file)
    migrations = {name: value for name, value in baseline['source_files'].items() if name.startswith('copypaste-platform/migrations/')}
    assert len(migrations) == 97
    for name, value in migrations.items():
        assert digest(ROOT / 'dev' / name) == value
    assertions = earlier['migration_test_assertions']
    assert digest(ROOT / assertions['path']) == assertions['after_sha256']
    assert digest(ROOT / assertions['archive']) == assertions['before_sha256']
    repair_file = ROOT / 'docs/quality/managed-video-fixture-repair-review.json'
    repair = read(repair_file)
    assert repair['status'] == 'verified_harness_only_repair' and repair['product_source_changes'] == 0
    core_file = ROOT / repair['current_harness_core']['path']
    assert digest(core_file) == repair['current_harness_core']['sha256']
    core = read(core_file)
    assert core['status'] == 'passed' and core['source_unchanged'] and core['owned_database_shutdown']
    assert core['counts']['tests'] == core['counts']['pass'] == 17
    for name in ['src/capability-video-verification.ts', 'migrations/098-managed-video-capabilities.sql', 'tests/capability-video-verification.test.ts']:
        assert digest(ROOT / 'dev/copypaste-platform' / name) == core['source_files']['copypaste-platform/' + name]
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'published_migrations_preserved': 97,
        'baseline': earlier['baseline'], 'migration_test_assertions': assertions,
        'earlier_review': {'path': earlier_file.relative_to(ROOT).as_posix(), 'sha256': digest(earlier_file)},
        'harness_repair': {'path': repair_file.relative_to(ROOT).as_posix(), 'sha256': digest(repair_file)},
        'prepared_query_upgrade': {'proof': core_file.relative_to(ROOT).as_posix(), 'sha256': digest(core_file),
            'scope': 'Current bounded test preserves original prepared-query and function-OID assertions through SQL098. Only its fixture port selection and arrival wait changed; no assertion was removed.'},
        'verifier_sha256': digest(Path(__file__))}
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print('97 immutable migrations and the two exact version assertions retained; current 17-case prepared-query upgrade passed.')


if __name__ == '__main__':
    main()
