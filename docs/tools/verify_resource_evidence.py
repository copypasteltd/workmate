"""Verify quota proof bytes without promoting bounded checks to full acceptance."""
from pathlib import Path
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
EVIDENCE = DEV / 'copypaste-delivery/evidence'
MIGRATIONS = DEV / 'copypaste-platform/migrations'


def load(file):
    return json.loads(file.read_bytes())


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def migration_receipt(report_name, version):
    report_path = EVIDENCE / report_name
    before_path = EVIDENCE / report_name.replace('.json', '-before.json')
    report, before = load(report_path), load(before_path)
    assert sha(ROOT / 'docs/quality' / report_path.name) == sha(report_path)
    assert sha(ROOT / 'docs/quality' / before_path.name) == sha(before_path)
    verifier = DEV / 'copypaste-delivery/scripts' / (
        'qa-resource-migrations.mjs' if version == 58 else 'qa-resource-erasure-migration.mjs')
    assert report['status'] == before['status'] == 'passed'
    assert report['verifier_sha256'] == before['verifier_sha256'] == sha(verifier)
    assert report['phase'] == f'after_{version:03d}_before_API_restart'
    assert before['phase'] == f'before_{version:03d}'
    assert {d['database'] for d in report['databases']} == {'copypaste', 'copypaste_test'}
    assert {d['database'] for d in before['databases']} == {'copypaste', 'copypaste_test'}
    for database in report['databases']:
        old = next(d for d in before['databases'] if d['database'] == database['database'])
        assert len(old['migrations']) == version - 1
        assert len(database['migrations']) == version
        assert database['migrations'][:-1] == old['migrations']
        assert database['original'] == old['original'] and len(database['original']) == 23
        assert database['original_facts_unchanged'] is True
        assert database['applied_checksums_unchanged'] is True
        assert database['complete_pre_upgrade_row_snapshot'] is True
        assert database['read_only'] is True
        assert database['privileges'] == {
            'app_can_read': False, 'control_can_read': True, 'app_can_check': True}
        assert len(database['guards']) == 7
        assert len(database['original_migration_bytes']) == version - 1
        for name, digest in database['original_migration_bytes'].items():
            assert sha(MIGRATIONS / name) == digest
            if int(name[:3]) <= 57:
                original = subprocess.check_output(
                    ['git', 'show', database['original_migration_source_commit'] + ':migrations/' + name],
                    cwd=DEV / 'copypaste-platform')
            else:
                assert name == '058-enterprise-seat-and-storage-quotas.sql'
                original = (EVIDENCE / 'resource-candidate-03-migration-058.sql').read_bytes()
            assert hashlib.sha256(original).hexdigest() == digest
        for migration in database['migrations']:
            index = migration['version']
            if index <= 15:
                assert migration['source_sha256'] is None
            else:
                assert sha(next(MIGRATIONS.glob(f'{index:03d}-*.sql'))) == migration['source_sha256']
    return {'path': report_path.relative_to(ROOT).as_posix(), 'sha256': sha(report_path),
            'before': before_path.relative_to(ROOT).as_posix(), 'before_sha256': sha(before_path),
            'verifier': verifier.relative_to(ROOT).as_posix(), 'verifier_sha256': sha(verifier),
            'databases': 2, 'unchanged_original_tables_per_database': 23}


def history():
    tracked = set(subprocess.check_output(
        ['git', 'ls-files', '-z'], cwd=EVIDENCE.parent, text=True).split('\0'))
    archives = []
    for name, count in [
        ('stage47-before-resource-quotas', 493),
        ('resource-before-private-erasure-repair', 204),
        ('resource-admin-vip-locator-overlap', 10),
        ('resource-readme-checkout-line-endings', 14),
        ('resource-package-checkout-line-endings', 25),
    ]:
        manifest = EVIDENCE / name / 'archive-map.json'
        entries = load(manifest)['files']
        assert len(entries) == count
        for entry in entries:
            file = (ROOT / entry['archived']).resolve()
            assert file.is_relative_to(EVIDENCE.resolve())
            assert sha(file) == entry['sha256']
            assert file.relative_to(EVIDENCE.parent).as_posix() in tracked
        archives.append({'path': manifest.relative_to(ROOT).as_posix(),
                         'sha256': sha(manifest), 'verified_files': count})
    runs = []
    for number, expected in enumerate([(10, 8, 2), (17, 16, 1), (53, 53, 0), (29, 29, 0)], 1):
        tap = EVIDENCE / f'platform-resources-candidate-{number:02d}.tap'
        raw = tap.read_text(encoding='utf-8')
        counts = {k: int(re.search(r'^# ' + k + r' (\d+)$', raw, re.M)[1])
                  for k in ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']}
        assert tuple(counts[k] for k in ['tests', 'pass', 'fail']) == expected
        assert all(counts[k] == 0 for k in ['cancelled', 'skipped', 'todo'])
        runs.append({'path': tap.relative_to(ROOT).as_posix(), 'sha256': sha(tap),
                     'counts': counts, 'status': 'failed_original_retained' if counts['fail']
                     else 'passed_at_recorded_source_stage'})
    candidates = []
    for number, version in [(3, 58), (4, 59)]:
        candidate = EVIDENCE / f'resource-candidate-{number:02d}-migration-{version:03d}.sql'
        assert sha(candidate) == sha(next(MIGRATIONS.glob(f'{version:03d}-*.sql')))
        candidates.append({'path': candidate.relative_to(ROOT).as_posix(), 'sha256': sha(candidate)})
    failed_root = EVIDENCE / 'resource-before-private-erasure-repair/dev/copypaste-delivery/evidence'
    failed = load(failed_root / 'alignment-platform.json')
    assert failed['status'] == 'failed' and failed['source_unchanged'] is True
    assert failed['counts'] == {'tests': 374, 'pass': 373, 'fail': 1, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    assert sha(failed_root / failed['raw_report']) == failed['sha256']
    assert failed['sha256'] == 'dfb1634a93bf59d320d4f8a09398391632af5e722d84c11deed2a61f4b7b42b2'
    initial = load(EVIDENCE / 'resource-admin-vip-locator-overlap/dev/copypaste-delivery/evidence/admin-vip.json')
    assert initial['status'] == 'failed' and initial['source_unchanged'] is True
    assert len(initial['checks']) == 3 and initial['browser_closed'] is True
    checkout = load(EVIDENCE / 'resource-readme-checkout-line-endings/dev/copypaste-delivery/evidence/byte-integrity.json')
    assert checkout['owned_temporary_clones_removed'] is True
    assert len(checkout['checks']) == 4
    assert all(c['status'] == 'passed' for c in checkout['checks'][:3])
    assert checkout['checks'][3]['status'] == 'failed'
    assert 'Admin checkout bytes changed: README.en.md' in checkout['checks'][3]['detail']
    package_archive = EVIDENCE / 'resource-package-checkout-line-endings/dev/copypaste-delivery'
    for name, count in [('native-vip.json', 6), ('auth-recovery-current.json', 12),
                        ('admin-membership-ui.json', 6)]:
        old = load(package_archive / 'evidence' / name)
        assert old['status'] == 'passed' and old['source_unchanged'] is True
        assert len(old['checks']) == count and all(c['status'] == 'passed' for c in old['checks'])
        assert old['source_files']['copypaste-delivery/package.json'] == sha(package_archive / 'package.json')
    images_path = ROOT / 'docs/quality/resource-screenshot-provenance.json'
    images = load(images_path)
    assert len(images['files']) == 8
    assert sha(ROOT / images['report']) == images['report_sha256']
    for item in images['files']:
        assert sha(ROOT / item['source']) == sha(ROOT / item['documentation']) == item['sha256']
    return {'scope': 'Enterprise seats and logical asset bytes only; complete original acceptance stays open',
            'archives': archives, 'runs': runs, 'migration_candidates': candidates,
            'first_full_run': {'path': (failed_root / 'alignment-platform.json').relative_to(ROOT).as_posix(),
                               'sha256': sha(failed_root / 'alignment-platform.json'),
                               'counts': failed['counts'], 'raw_sha256': failed['sha256']},
            'migrations': [migration_receipt('resource-migrations.json', 58),
                           migration_receipt('resource-erasure-migrations.json', 59)],
            'screenshots': {'path': images_path.relative_to(ROOT).as_posix(),
                            'sha256': sha(images_path), 'verified_images': 8}}


if __name__ == '__main__':
    print(json.dumps(history(), ensure_ascii=True, indent=2))
