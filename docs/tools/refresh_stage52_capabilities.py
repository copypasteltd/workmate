"""Verify stage 52 evidence; optionally append this checkpoint to the full audit.

Old UI/release receipts retain their original hashes and scopes. They are not
relabelled as executions of the changed platform. All original requirements,
acceptance conditions and gates remain in the audit.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
PLATFORM = DEV / 'copypaste-platform'
DELIVERY = DEV / 'copypaste-delivery'
BASELINE_COMMIT = 'aa5995f960257f537fb22d86dd0cbdc98cdd6836'
BASELINE_PATH = ROOT / 'docs/quality/history/stage51-before-capabilities/requirements-alignment-progress.json'
OPENAPI_SHA = '51dd90f26137798dd23c4e881b7f9f0b20f99ad4b9fee0cce98686e11873aab4'
OLD_TEST_NAME = 'a bound capability change cancels before a model call, and an active runtime revocation blocks the next tool and final publication'
NEW_TEST_NAME = 'frozen task capability survives default changes, and active runtime revocation blocks the next tool and final publication'


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def relative(path):
    return path.relative_to(ROOT).as_posix()


def receipt(path):
    return {'path': relative(path), 'sha256': digest(path)}


def git(repo, *args):
    return subprocess.check_output(['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', str(repo), *args])


def source_snapshot():
    files = git(PLATFORM, 'ls-files', '--cached', '--others', '--exclude-standard', '-z').decode('utf-8').split('\0')
    return {name: digest(PLATFORM / name) for name in sorted(set(files))
            if re.match(r'^(src|tests|migrations|catalog|contracts|scripts|skills)/', name)
            or re.match(r'^(package(-lock)?|tsconfig)\.json$', name)}


def verify_run(name, current=False, expected_status='passed', verifier_snapshot=None):
    path = DELIVERY / 'evidence' / (name + '.json')
    data = read(path)
    raw = DELIVERY / data['raw_report']
    assert digest(raw) == data['raw_sha256']
    assert data['source_unchanged'] and data['owned_database_shutdown']
    assert data['database_shutdown_exit_code'] == 0
    counts = {key: int(re.search(r'^# ' + key + r' (\d+)\r?$', raw.read_text(encoding='utf-8'), re.M).group(1))
              for key in ('tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo')}
    assert counts == data['counts']
    assert counts['pass'] + counts['fail'] == counts['tests']
    migration = DELIVERY / data['migration_snapshot']
    assert digest(migration) == data['migration_sha256']
    assert data['status'] == expected_status
    if expected_status == 'passed':
        assert data['exit_code'] == 0
        assert counts['tests'] > 0 and counts['pass'] == counts['tests']
        assert all(counts[key] == 0 for key in ('fail', 'cancelled', 'skipped', 'todo'))
    else:
        assert expected_status == 'failed' and data['exit_code'] != 0 and counts['fail'] > 0
    verifier = verifier_snapshot or DELIVERY / 'scripts' / ('run-capability-regression.mjs' if 'regression' in name else 'run-capability-candidate.mjs')
    assert digest(verifier) == data['verifier_sha256'], 'Executed verifier bytes must remain available'
    if current:
        assert data['source_files'] == source_snapshot(), 'Current platform bytes differ from the executed suite'
        assert digest(PLATFORM / 'migrations/063-frozen-task-capabilities.sql') == digest(migration)
    return {**receipt(path), 'raw_report': receipt(raw), 'migration_snapshot': receipt(migration),
            'verifier': receipt(verifier), 'counts': counts, 'status': data['status'], 'scope': data['scope']}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--focused', default='05')
    parser.add_argument('--full', default='02')
    args = parser.parse_args()
    baseline_bytes = git(ROOT, 'show', BASELINE_COMMIT + ':docs/quality/requirements-alignment-progress.json')
    if BASELINE_PATH.exists():
        assert BASELINE_PATH.read_bytes() == baseline_bytes
    baseline = json.loads(baseline_bytes)
    assert len(baseline['requirements']) == 102
    assert digest(ROOT / 'docs/contracts/openapi.json') == OPENAPI_SHA
    assert re.fullmatch(r'\d{2}', args.focused) and re.fullmatch(r'\d{2}', args.full)
    original_verifier = DELIVERY / 'evidence/capability-candidates-01-04-verifier.mjs'
    focused = verify_run('capability-candidate-' + args.focused, current=True)
    assert focused['counts']['tests'] > 28
    failures = [verify_run('capability-candidate-' + attempt, expected_status='failed', verifier_snapshot=original_verifier) for attempt in ('01', '02', '03')]
    failures.append(verify_run('capability-regression-01', expected_status='failed'))
    original_focused = verify_run('capability-candidate-04', verifier_snapshot=original_verifier)
    assert original_focused['counts']['tests'] == 28
    full = verify_run('capability-regression-' + args.full, current=True)
    assert full['counts']['tests'] == 435
    old_raw = ROOT / baseline['evidence']['platform_regression']['raw_report']['path']
    assert digest(old_raw) == baseline['evidence']['platform_regression']['raw_report']['sha256']
    names = lambda path: Counter(re.findall(r'^\s*(?:ok|not ok) \d+ - (.+?)\r?$', path.read_text(encoding='utf-8'), re.M))
    original_names = names(old_raw)
    current_names = names(ROOT / full['raw_report']['path'])
    assert not (names(ROOT / focused['raw_report']['path']) - current_names), 'A focused test is absent from the full suite'
    assert original_names[OLD_TEST_NAME] == current_names[NEW_TEST_NAME] == 1
    del original_names[OLD_TEST_NAME]
    original_names[NEW_TEST_NAME] += 1
    assert not (original_names - current_names), 'A previously executed named test disappeared'
    old_test = DELIVERY / 'evidence/capability-regression-01-original-agent-templates.test.ts'
    failed_full = read(DELIVERY / 'evidence/capability-regression-01.json')
    assert digest(old_test) == failed_full['source_files']['tests/agent-templates.test.ts']
    assert OLD_TEST_NAME in old_test.read_text(encoding='utf-8')
    assert NEW_TEST_NAME in (PLATFORM / 'tests/agent-templates.test.ts').read_text(encoding='utf-8')
    old_subflow = old_test.read_text(encoding='utf-8').split('test("' + OLD_TEST_NAME, 1)[1]
    new_subflow = (PLATFORM / 'tests/agent-templates.test.ts').read_text(encoding='utf-8').split('test("' + NEW_TEST_NAME, 1)[1]
    assert old_subflow.split('  const currentConversation =', 1)[1] == new_subflow.split('  const currentConversation =', 1)[1], 'Stale new delegation and active runtime revocation assertions changed'
    old_documentation = BASELINE_PATH.parent / 'validation-report.json'
    assert digest(old_documentation) == baseline['evidence']['documentation']['sha256']
    document_report = ROOT / 'docs/quality/validation-report.json'
    documentation = read(document_report)
    assert documentation['status'] == 'passed' and documentation['checks_failed'] == 0
    migration_path = DELIVERY / 'evidence/capability-migrations.json'
    migrations = read(migration_path)
    before_path = DELIVERY / 'evidence/capability-migrations-before.json'
    before = read(before_path)
    assert migrations['status'] == 'passed'
    assert {row['database'] for row in migrations['databases']} == {'copypaste', 'copypaste_test'}
    for row in migrations['databases']:
        old = next(item for item in before['databases'] if item['database'] == row['database'])
        assert len(row['original']) == 124 and row['original'] == old['original']
        assert row['migrations'][:62] == old['migrations'] and len(row['migrations']) == 63
        assert row['original_migration_bytes'] == old['original_migration_bytes']
        assert row['historical_bindings_fabricated'] is False
        for file, expected in row['original_migration_bytes'].items():
            assert digest(PLATFORM / 'migrations' / file) == expected
        assert row['lock']['prosecdef'] and row['lock']['no_public_execute']
        assert row['rls'] == {'relrowsecurity': True, 'relforcerowsecurity': True}
        assert row['privileges']['app_update'] is False and row['privileges']['app_capability_update'] is False
    current = source_snapshot()
    previous_platform = read(ROOT / baseline['evidence']['platform_regression']['path'])['source_files']
    changed = sorted(name for name in set(current) | set(previous_platform) if current.get(name) != previous_platform.get(name))
    checkpoint = {
        'at': datetime.now(timezone.utc).isoformat(),
        'scope': 'Frozen task model/effort/rate foundation; full original acceptance remains uncompleted',
        'original_scope': {'requirements': 102, 'fully_accepted': 0, 'qualified_live_roles': 0, 'normative_openapi_sha256': OPENAPI_SHA},
        'prior_checkpoint': {'path': relative(BASELINE_PATH), 'sha256': sha256(baseline_bytes).hexdigest(), 'source_commit': BASELINE_COMMIT},
        'focused': focused, 'full_platform_regression': full,
        'preserved_failed_runs': failures,
        'historical_focused_pass': original_focused,
        'explicit_test_semantic_change': {
            'old_name': OLD_TEST_NAME, 'new_name': NEW_TEST_NAME,
            'original_source': receipt(old_test),
            'reason': 'Only the first subflow changes from cancelling an existing task on startup-default changes to continuing with its frozen version. New stale delegations remain rejected; runtime revocation still stops the next tool and final publication.',
            'baseline_test_count': 424, 'current_test_count': 435,
        },
        'documentation': {**receipt(document_report), 'at': documentation['checked_at'], 'scope': documentation['scope']},
        'native_migration': {
            **receipt(migration_path), 'before': receipt(before_path),
            'databases': 2, 'preserved_tables_per_database': 124,
            'verifiers': [receipt(DELIVERY / 'scripts' / name) for name in ('qa-capability-migrations.mjs', 'upgrade-capabilities-local.mjs')],
            'logs': [receipt(DELIVERY / 'evidence' / name) for name in ('capability-upgrade-native-database.log', 'capability-live-migration-063.log')],
        },
        'current_platform_sources': len(current), 'changed_platform_sources_since_stage51': changed,
        'migration_063_sha256': digest(PLATFORM / 'migrations/063-frozen-task-capabilities.sql'),
        'remaining': ['Admin capability documents, validation, publication and rollback',
                      'Customer-visible model/effort/rate diff and explicit adoption',
                      'Per-request gateway authorization and capability limits',
                      'Current browser/native business-flow revalidation after platform changes',
                      'All original TC/NFR/G01-G10 and live qualifications'],
    }
    if args.write:
        BASELINE_PATH.parent.mkdir(parents=True, exist_ok=True)
        if not BASELINE_PATH.exists():
            BASELINE_PATH.write_bytes(baseline_bytes)
        updated = json.loads(baseline_bytes)
        updated['at'] = checkpoint['at']
        updated['capability_verification'] = checkpoint
        updated['evidence_currentness_policy'] = 'Stage 52 executes its new platform suites and migration checks. Other evidence retains its historical source scope and is not represented as a rerun of the changed platform.'
        for item in updated['evidence'].values():
            item['stage52_currentness'] = 'historical_scope_not_reexecuted_in_stage52'
        updated['evidence']['platform_regression_stage51'] = updated['evidence']['platform_regression']
        updated['evidence']['documentation_stage51'] = {**updated['evidence']['documentation'], 'path': relative(old_documentation)}
        updated['evidence']['documentation'] = checkpoint['documentation']
        updated['evidence']['platform_regression'] = full
        updated['evidence']['capability_candidates'] = focused
        updated['evidence']['capability_migrations'] = checkpoint['native_migration']
        repair = {
            'cluster': 'frozen_task_model_effort_and_pricing',
            'verified_subflow': '任务创建与预算预留原子绑定不可变能力版本；锁定 Codex 和实际图片请求保持原模型、强度及费率；重试继承，撤销阻止执行但保留原价结算，未知图片消费进入对账。',
            'evidence': ['capability_candidates', 'platform_regression', 'capability_migrations'],
            'implementation_docs': ['technical/52-capability-versions-and-frozen-task-pricing.md'],
        }
        for item in updated['requirements']:
            if item['requirement_id'] in ('REQ-045', 'REQ-099'):
                item['assessment'] = 'partial_verified'
                item.setdefault('verified_repairs', []).append(repair)
                item['finding'] = '任务模型、强度和原价绑定已验证；受控能力注册、验证、发布/回滚、用户可见的版本采用及完整能力资格仍待完成。'
                item['remaining_complete_acceptance_conditions'] = '继续完成原始验收中的注册/验证能力、不支持参数、过期、用户显式变更、受控发布/回滚及全部固定内核/内部网关约束；本次基础实现不等于完成 TC-045 或 TC-099。'
        updated['summary'] = dict(Counter(item['assessment'] for item in updated['requirements']))
        assert updated['fully_accepted_requirements'] == baseline['fully_accepted_requirements']
        assert updated['qualified_live_roles'] == baseline['qualified_live_roles']
        for original, item in zip(baseline['requirements'], updated['requirements']):
            for field in ('requirement_id', 'requirement', 'acceptance_case', 'acceptance_conditions', 'original_finding'):
                assert item.get(field) == original.get(field)
        for repo in updated['repositories']:
            root = DEV / repo['name']
            repo['head'] = git(root, 'rev-parse', 'HEAD').decode().strip()
            repo['dirty'] = bool(git(root, 'status', '--porcelain').strip())
            repo['source_hashes_scope'] = 'Historical stage 51 source snapshot; stage 52 executed source manifest is in capability_verification'
        (ROOT / 'docs/quality/capability-version-checkpoint.json').write_text(json.dumps(checkpoint, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        (ROOT / 'docs/quality/requirements-alignment-progress.json').write_text(json.dumps(updated, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': 'passed', 'focused_tests': focused['counts']['tests'], 'platform_tests': full['counts']['tests'], 'platform_sources': len(current), 'preserved_tables_per_database': 124, 'original_requirements': 102, 'fully_accepted': 0, 'written': args.write}))


if __name__ == '__main__':
    main()
