"""Bind the stage 53 backend checkpoint to actual current-source executions.

This does not accept any original end-to-end requirement or qualify a live role.
Historical receipts and source snapshots remain unchanged and separately scoped.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
import re

from refresh_stage52_capabilities import (
    ROOT, DEV, PLATFORM, DELIVERY, OPENAPI_SHA, digest, read, receipt,
    git, source_snapshot, verify_run,
)

BASELINE_COMMIT = '46e4700'
HISTORY = ROOT / 'docs/quality/history/stage52-before-capability-releases'
MIGRATION = PLATFORM / 'migrations/064-controlled-capability-releases.sql'


def named_tests(path):
    return Counter(re.findall(r'^\s*(?:ok|not ok) \d+ - (.+?)\r?$',
                              path.read_text(encoding='utf-8'), re.M))


def run(name, current=False, status='passed'):
    data = read(DELIVERY / 'evidence' / (name + '.json'))
    result = verify_run(name, expected_status=status,
                        verifier_snapshot=DELIVERY / data.get('verifier_snapshot', 'evidence/' + name + '-verifier.mjs'))
    if current:
        assert data['source_files'] == source_snapshot(), 'Current source bytes changed'
        assert data['migration_sha256'] == digest(MIGRATION)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--focused', required=True)
    parser.add_argument('--full', required=True)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    assert all(re.fullmatch(r'\d{2}', v) for v in (args.focused, args.full))
    baseline_bytes = git(ROOT, 'show', BASELINE_COMMIT + ':docs/quality/requirements-alignment-progress.json')
    baseline = json.loads(baseline_bytes)
    old_doc_bytes = git(ROOT, 'show', BASELINE_COMMIT + ':docs/quality/validation-report.json')
    assert len(baseline['requirements']) == 102
    assert digest(ROOT / 'docs/contracts/openapi.json') == OPENAPI_SHA
    focused = run('capability-release-candidate-' + args.focused, current=True)
    focused_data = read(ROOT / focused['path'])
    assert len(focused_data['test_files']) == 8
    assert focused['counts']['tests'] == 65
    full = run('capability-release-regression-' + args.full, current=True)
    assert full['counts']['tests'] == 454
    full_names = named_tests(ROOT / full['raw_report']['path'])
    assert not (named_tests(ROOT / focused['raw_report']['path']) - full_names)
    old_full = baseline['evidence']['platform_regression']
    assert digest(ROOT / old_full['raw_report']['path']) == old_full['raw_report']['sha256']
    assert not (named_tests(ROOT / old_full['raw_report']['path']) - full_names), 'An old named test disappeared'
    failures = [run('capability-release-candidate-' + str(n).zfill(2), status='failed')
                for n in range(1, int(args.focused))]
    upgrade_path = DELIVERY / 'evidence/capability-release-upgrade.json'
    upgrade = read(upgrade_path)
    assert upgrade['status'] == 'passed' and upgrade['source_unchanged']
    assert upgrade['owned_database_shutdown'] and upgrade['database_shutdown_exit_code'] == 0
    assert upgrade['candidate']['sha256'] == digest(ROOT / focused['path'])
    assert upgrade['regression']['sha256'] == digest(ROOT / full['path'])
    assert upgrade['verifier_sha256'] == digest(DELIVERY / 'scripts/upgrade-capability-releases-local.mjs')
    before_path = DELIVERY / 'evidence/capability-release-migrations-before.json'
    migration_path = DELIVERY / 'evidence/capability-release-migrations.json'
    before, migration = read(before_path), read(migration_path)
    assert migration['status'] == 'passed'
    assert migration['verifier_sha256'] == digest(DELIVERY / 'scripts/qa-capability-release-migrations.mjs')
    assert {d['database'] for d in migration['databases']} == {'copypaste', 'copypaste_test'}
    for row in migration['databases']:
        prior = next(d for d in before['databases'] if d['database'] == row['database'])
        assert len(row['original']) == 125 and row['original'] == prior['original']
        assert row['migrations'][:63] == prior['migrations'] and len(row['migrations']) == 64
        assert row['historical_publications_fabricated'] is False
        assert row['original_migration_bytes'] == prior['original_migration_bytes']
        for name, expected in row['original_migration_bytes'].items():
            assert digest(PLATFORM / 'migrations' / name) == expected
        for table in row['controls'].values():
            assert not any(table['privileges'].values())
            assert table['rls'] == {'relrowsecurity': True, 'relforcerowsecurity': True}
            assert table['new_rows'] == 0
    current = source_snapshot()
    checkpoint = {
        'at': datetime.now(timezone.utc).isoformat(),
        'scope': 'Controlled capability backend only; Admin/customer adoption UI and all original acceptance remain open',
        'original_scope': {'requirements': 102, 'fully_accepted': 0, 'qualified_live_roles': 0,
                           'normative_openapi_sha256': OPENAPI_SHA},
        'prior_checkpoint': {'path': (HISTORY / 'requirements-alignment-progress.json').relative_to(ROOT).as_posix(),
                             'sha256': sha256(baseline_bytes).hexdigest(), 'source_commit': BASELINE_COMMIT},
        'focused': focused, 'full_platform_regression': full,
        'preserved_failed_runs': failures,
        'cleanup_interruption': receipt(DELIVERY / 'evidence/capability-release-candidate-04-cleanup-interruption.json'),
        'native_upgrade': receipt(upgrade_path),
        'native_migration': {**receipt(migration_path), 'before': receipt(before_path),
                             'preserved_tables_per_database': 125},
        'current_platform_sources': len(current), 'migration_064_sha256': digest(MIGRATION),
        'remaining': ['Admin UI for typed documents, actual validation receipts, publication and rollback',
                      'Visible customer model/effort/rate diff and compare-and-swap adoption',
                      'Supplemental API contract and current browser/native business-flow validation',
                      'Per-request internal gateway authorization and limits',
                      'All original TC/NFR/G01-G10, live roles, signing and production acceptance'],
    }
    if args.write:
        HISTORY.mkdir(parents=True, exist_ok=True)
        for name, value in [('requirements-alignment-progress.json', baseline_bytes), ('validation-report.json', old_doc_bytes)]:
            target = HISTORY / name
            if target.exists():
                assert target.read_bytes() == value
            else:
                target.write_bytes(value)
        updated = json.loads(baseline_bytes)
        updated['at'] = checkpoint['at']
        updated['controlled_capability_verification'] = checkpoint
        updated['evidence_currentness_policy'] = 'Stage 53 executes current backend suites and native migration checks. Other browser/native/release receipts retain their historical source scope; none are represented as executions of changed backend code.'
        updated['evidence']['platform_regression_stage52'] = old_full
        updated['evidence']['platform_regression'] = full
        updated['evidence']['capability_release_candidates'] = focused
        updated['evidence']['capability_release_migrations'] = checkpoint['native_migration']
        repair = {
            'cluster': 'controlled_capability_backend',
            'verified_subflow': '受控文字/图片配置、实际固定 Codex 与内部假网关验证、独立审批发布/回滚、数据库当前版本、旧任务原价和撤销边界；用户采用页面及完整综合验收仍未完成。',
            'evidence': ['capability_release_candidates', 'platform_regression', 'capability_release_migrations'],
            'implementation_docs': ['technical/53-controlled-capability-releases.md'],
        }
        for item in updated['requirements']:
            if item['requirement_id'] in ('REQ-045', 'REQ-093', 'REQ-099'):
                item.setdefault('verified_repairs', []).append(repair)
                item['finding'] = '受控配置验证、独立审批发布/回滚及历史任务版本的后台子流程已验证；后台管理页面、用户可见比较与显式采用、完整能力资格仍待完成。'
        updated['summary'] = dict(Counter(i['assessment'] for i in updated['requirements']))
        assert updated['fully_accepted_requirements'] == baseline['fully_accepted_requirements'] == 0
        assert updated['qualified_live_roles'] == baseline['qualified_live_roles'] == 0
        for old, item in zip(baseline['requirements'], updated['requirements']):
            for field in ('requirement_id', 'requirement', 'acceptance_case', 'acceptance_conditions', 'original_finding'):
                assert item.get(field) == old.get(field)
        for repository in updated['repositories']:
            repo = DEV / repository['name']
            repository['head'] = git(repo, 'rev-parse', 'HEAD').decode().strip()
            repository['dirty'] = bool(git(repo, 'status', '--porcelain').strip())
            repository['source_hashes_scope'] = 'Historical snapshot; executed stage 53 backend source manifest is in controlled_capability_verification'
        for path, value in [('docs/quality/controlled-capability-checkpoint.json', checkpoint),
                            ('docs/quality/requirements-alignment-progress.json', updated)]:
            (ROOT / path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': 'passed', 'focused_tests': 65, 'platform_tests': 454,
                      'platform_sources': len(current), 'original_requirements': 102,
                      'fully_accepted': 0, 'written': args.write}))


if __name__ == '__main__':
    main()
