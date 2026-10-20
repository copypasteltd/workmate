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
        cleanup = data['fixture_cleanup']
        assert cleanup['status'] == 'passed' and cleanup['workers_exited']
        assert cleanup['actual_filesystem_checked'] and all(r['reclaimed'] for r in cleanup['results'])
        assert digest(DELIVERY / cleanup['path']) == cleanup['sha256']
        result['fixture_cleanup'] = receipt(DELIVERY / cleanup['path'])
    return result


def supplemental_run(attempt):
    path = DELIVERY / 'evidence' / ('capability-release-contract-' + attempt + '.json')
    data = read(path)
    assert data['status'] == 'passed' and data['source_unchanged']
    assert len(data['checks']) == 6 and not data['errors']
    for name, expected in data['source_files'].items():
        assert digest(ROOT / name) == expected
    verifier = DELIVERY / 'evidence' / ('capability-release-contract-' + attempt + '-verifier.ts')
    assert verifier.read_bytes() == (DELIVERY / 'scripts/check-capability-release-contract.ts').read_bytes()
    return {**receipt(path), 'verifier': receipt(verifier), 'checks': len(data['checks'])}


def ui_run(attempt):
    path = DELIVERY / 'evidence' / ('capability-release-ui-' + attempt + '.json')
    data = read(path)
    assert data['status'] == 'passed' and data['exit_code'] == 0
    assert data['source_unchanged'] and data['admin_build_unchanged']
    assert data['owned_database_shutdown'] and data['owned_admin_preview_closed']
    assert data['database_shutdown_exit_code'] == data['cleanup_exit_code'] == 0
    assert data['counts']['checks'] >= 10 and data['counts']['errors'] == 0
    current = {}
    for repo in ('copypaste-platform', 'copypaste-admin', 'copypaste-delivery'):
        directory = DEV / repo
        names = git(directory, 'ls-files', '--cached', '--others', '--exclude-standard', '-z').decode().split('\0')
        for name in set(names):
            if re.match(r'^(src|scripts|tests|contracts|catalog|migrations|public)/', name) or re.fullmatch(r'(package(-lock)?|tsconfig|vite\.config)\.(json|ts)', name):
                current[repo + '/' + name] = digest(directory / name)
    current['docs/contracts/capability-releases.openapi.json'] = digest(ROOT / 'docs/contracts/capability-releases.openapi.json')
    assert current == data['source_files'], 'Current Admin/browser source bytes changed'
    for field, script in [('verifier', 'run-capability-release-ui.mjs'), ('journey_verifier', 'qa-capability-release-ui.ts')]:
        entry = data[field]
        assert digest(DELIVERY / entry['path']) == entry['sha256'] == digest(DELIVERY / 'scripts' / script)
    for field in ('journey', 'raw_report', 'fixture_cleanup'):
        entry = data[field]
        assert digest(DELIVERY / entry['path']) == entry['sha256']
    cleanup = data['fixture_cleanup']
    assert cleanup['status'] == 'passed' and cleanup['workers_exited'] and cleanup['actual_filesystem_checked']
    assert all(item['reclaimed'] for item in cleanup['results'])
    journey = read(DELIVERY / data['journey']['path'])
    assert journey['status'] == 'passed' and not journey['errors']
    assert journey['browser_closed'] and journey['owned_api_closed']
    assert journey['browser_runtime']['version']
    assert re.fullmatch(r'[a-f0-9]{64}', journey['browser_runtime']['sha256'])
    assert all(item['status'] == 'passed' for item in journey['checks'])
    assert journey['supplemental_contract_sha256'] == digest(ROOT / 'docs/contracts/capability-releases.openapi.json')
    assert len(journey['screenshots']) >= 10
    for screenshot in journey['screenshots']:
        assert not screenshot['edited']
        assert digest(DEV / screenshot['path']) == screenshot['sha256']
    for name, expected in data['admin_build']['dist_files'].items():
        assert digest(DEV / 'copypaste-admin/dist' / name) == expected
    return {**receipt(path), 'journey': receipt(DELIVERY / data['journey']['path']),
            'checks': len(journey['checks']), 'unedited_screenshots': len(journey['screenshots'])}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--focused', required=True)
    parser.add_argument('--full', required=True)
    parser.add_argument('--ui', required=True)
    parser.add_argument('--contract', required=True)
    parser.add_argument('--documentation', required=True)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    assert all(re.fullmatch(r'\d{2}', v) for v in (args.focused, args.full, args.ui, args.contract, args.documentation))
    baseline_bytes = git(ROOT, 'show', BASELINE_COMMIT + ':docs/quality/requirements-alignment-progress.json')
    baseline = json.loads(baseline_bytes)
    old_doc_bytes = git(ROOT, 'show', BASELINE_COMMIT + ':docs/quality/validation-report.json')
    assert len(baseline['requirements']) == 102
    assert digest(ROOT / 'docs/contracts/openapi.json') == OPENAPI_SHA
    focused = run('capability-release-candidate-' + args.focused, current=True)
    focused_data = read(ROOT / focused['path'])
    assert len(focused_data['test_files']) == 8
    assert focused['counts']['tests'] == 71
    full = run('capability-release-regression-' + args.full, current=True)
    assert full['counts']['tests'] == 462
    contract = supplemental_run(args.contract)
    ui = ui_run(args.ui)
    doc_path = ROOT / 'docs/quality' / ('capability-release-docs-' + args.documentation + '.json')
    doc_check = read(doc_path)
    assert doc_check['status'] == 'passed' and doc_check['checks_failed'] == 0
    assert doc_check['counts']['requirements'] == doc_check['counts']['acceptance_cases'] == 102
    assert doc_check['counts']['api_operations'] == 225 and doc_check['counts']['qualified_roles'] == 0
    assert doc_check['verifier_sha256'] == digest(ROOT / 'docs/tools/validate_docs.py')
    prior_docs = []
    for n in range(1, int(args.documentation)):
        path = ROOT / 'docs/quality' / ('capability-release-docs-' + str(n).zfill(2) + '.json')
        data = read(path)
        assert data['scope'] == 'documentation_contracts_and_recorded_design_evidence_only'
        assert data['status'] in ('passed', 'failed')
        prior_docs.append({**receipt(path), 'status': data['status'],
                           'checks_failed': data['checks_failed']})
    counterexample_path = DELIVERY / 'evidence/fetch-port-counterexample-01.json'
    counterexample = read(counterexample_path)
    assert counterexample['status'] == 'passed' and counterexample['owned_server_closed']
    assert counterexample['blocked_received_calls'] == 0 and counterexample['selected_received_calls'] == 1
    assert counterexample['blocked_reason'] == 'bad port'
    assert counterexample['helper_sha256'] == digest(PLATFORM / 'src/loopback-http.ts')
    prior_ui = []
    for n in range(1, int(args.ui)):
        path = DELIVERY / 'evidence' / ('capability-release-ui-' + str(n).zfill(2) + '.json')
        data = read(path)
        assert data['owned_database_shutdown'] and data['owned_admin_preview_closed']
        for field in ('raw_report', 'journey'):
            entry = data[field]
            assert digest(DELIVERY / entry['path']) == entry['sha256']
        prior_ui.append({**receipt(path), 'status': data['status']})
    full_names = named_tests(ROOT / full['raw_report']['path'])
    assert not (named_tests(ROOT / focused['raw_report']['path']) - full_names)
    old_full = baseline['evidence']['platform_regression']
    assert digest(ROOT / old_full['raw_report']['path']) == old_full['raw_report']['sha256']
    assert not (named_tests(ROOT / old_full['raw_report']['path']) - full_names), 'An old named test disappeared'
    prior_candidates = []
    for n in range(1, int(args.focused)):
        name = 'capability-release-candidate-' + str(n).zfill(2)
        prior_candidates.append(run(name, status=read(DELIVERY / 'evidence' / (name + '.json'))['status']))
    failures = [item for item in prior_candidates if item['status'] == 'failed']
    prior_full = []
    for n in range(1, int(args.full)):
        name = 'capability-release-regression-' + str(n).zfill(2)
        prior_full.append(run(name, status=read(DELIVERY / 'evidence' / (name + '.json'))['status']))
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
        assert len(row['controls']) == 6
        for table in row['controls'].values():
            assert not any(table['privileges'].values())
            assert table['rls'] == {'relrowsecurity': True, 'relforcerowsecurity': True}
            assert table['new_rows'] == 0
    current = source_snapshot()
    checkpoint = {
        'at': datetime.now(timezone.utc).isoformat(),
        'scope': 'Controlled capability backend and actual Admin publishing UI; customer adoption UI and all original acceptance remain open',
        'original_scope': {'requirements': 102, 'fully_accepted': 0, 'qualified_live_roles': 0,
                           'normative_openapi_sha256': OPENAPI_SHA},
        'prior_checkpoint': {'path': (HISTORY / 'requirements-alignment-progress.json').relative_to(ROOT).as_posix(),
                             'sha256': sha256(baseline_bytes).hexdigest(), 'source_commit': BASELINE_COMMIT},
        'focused': focused, 'full_platform_regression': full,
        'supplemental_contract': contract, 'admin_browser': ui,
        'documentation_contracts': receipt(doc_path), 'fetch_port_counterexample': receipt(counterexample_path),
        'preserved_prior_documentation_runs': prior_docs,
        'preserved_prior_admin_browser_runs': prior_ui,
        'preserved_failed_runs': failures,
        'preserved_prior_candidates': prior_candidates,
        'preserved_prior_full_runs': prior_full,
        'cleanup_interruption': receipt(DELIVERY / 'evidence/capability-release-candidate-04-cleanup-interruption.json'),
        'native_upgrade': receipt(upgrade_path),
        'native_migration': {**receipt(migration_path), 'before': receipt(before_path),
                             'preserved_tables_per_database': 125},
        'current_platform_sources': len(current), 'migration_064_sha256': digest(MIGRATION),
        'remaining': ['Visible customer model/effort/rate diff and compare-and-swap adoption',
                      'Current customer browser/native business-flow validation after backend changes',
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
        updated['evidence_currentness_policy'] = 'Stage 53 executes current backend suites, actual Admin capability publishing browser flow, supplemental contract and native migration checks. Other browser/native/release receipts retain their historical source scope; none are represented as executions of changed backend code.'
        updated['evidence']['platform_regression_stage52'] = old_full
        updated['evidence']['platform_regression'] = full
        updated['evidence']['capability_release_candidates'] = focused
        updated['evidence']['capability_release_migrations'] = checkpoint['native_migration']
        updated['evidence']['capability_release_admin_ui'] = ui
        updated['evidence']['capability_release_contract'] = contract
        updated['evidence']['documentation_contracts_stage53'] = receipt(doc_path)
        repair = {
            'cluster': 'controlled_capability_backend',
            'verified_subflow': '受控文字/图片配置、实际固定 Codex 与内部假网关验证、独立审批发布/回滚、数据库当前版本、旧任务原价和撤销边界，及真实后台配置、验证、比较、独立审批和回滚页面；用户采用页面及完整综合验收仍未完成。',
            'evidence': ['capability_release_candidates', 'platform_regression', 'capability_release_migrations', 'capability_release_admin_ui', 'capability_release_contract'],
            'implementation_docs': ['technical/53-controlled-capability-releases.md'],
        }
        for item in updated['requirements']:
            if item['requirement_id'] in ('REQ-045', 'REQ-093', 'REQ-099'):
                item.setdefault('verified_repairs', []).append(repair)
                item['finding'] = '受控配置验证、独立审批发布/回滚、历史任务版本及真实后台页面子流程已验证；用户可见比较与显式采用、完整能力资格仍待完成。'
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
    print(json.dumps({'status': 'passed', 'focused_tests': 71, 'platform_tests': 462,
                      'admin_ui_checks': ui['checks'], 'contract_checks': contract['checks'],
                      'platform_sources': len(current), 'original_requirements': 102,
                      'fully_accepted': 0, 'written': args.write}))


if __name__ == '__main__':
    main()
