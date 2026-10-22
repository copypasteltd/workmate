"""Record the current repair without changing the original acceptance baseline."""
import argparse
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def digest(path):
    return sha256(path.read_bytes()).hexdigest()

def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')

def main():
    parser = argparse.ArgumentParser()
    for name in ('regression', 'focused', 'clients', 'native', 'media'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    assert all(re.fullmatch(r'\d{2}', v) for v in vars(args).values())
    names = [f'canonical-task-regression-{args.regression}.json', f'canonical-task-integration-{args.focused}.json',
        f'paid-input-clients-{args.clients}.json', f'paid-input-native-{args.native}.json', f'workmate-media-{args.media}.json']
    reports = [read(DELIVERY / 'evidence' / name) for name in names]
    assert all(p['status'] == 'passed' for p in reports)
    full, focused, clients, native, media = reports
    for report in (full, focused):
        assert report['source_unchanged'] and report['owned_database_shutdown'] and report['fixture_cleanup']
        assert report['counts']['pass'] == report['counts']['tests']
        assert digest(DELIVERY / report['raw_report']['path']) == report['raw_report']['sha256']
    old_tap = (DELIVERY / 'evidence/paid-input-regression-02.tap').read_text(encoding='utf-8')
    new_tap = (DELIVERY / full['raw_report']['path']).read_text(encoding='utf-8')
    tests = lambda text: re.findall(r'^\s*# Subtest: (.+)$', text, re.M)
    old_names, new_names = tests(old_tap), tests(new_tap)
    assert len(old_names) == 782 and len(new_names) == full['counts']['tests']
    assert not (Counter(old_names) - Counter(new_names))
    source_checks = {}
    for label, report, resolve in (
        ('full_platform', full, lambda p: DEV / 'copypaste-platform' / p),
        ('focused_platform', focused, lambda p: DEV / 'copypaste-platform' / p),
        ('client_checks', clients, lambda p: DEV / ('copypaste-' + p.split('/', 1)[0]) / p.split('/', 1)[1]),
        ('native_journey', native, lambda p: ROOT / p if p.startswith('docs/') else DEV / p),
    ):
        assert report['source_unchanged']
        for file, expected in report['source_files'].items():
            assert digest(resolve(file)) == expected, 'Source changed: ' + file
        source_checks[label] = len(report['source_files'])
    for name in names + [f'paid-input-native-{args.native}-journey.json']:
        target = ROOT / 'docs/quality' / name
        source = DELIVERY / 'evidence' / name
        if target.exists():
            assert target.read_bytes() == source.read_bytes()
        else:
            shutil.copyfile(source, target)
    checkpoint = {
        'at': datetime.now(timezone.utc).isoformat(), 'status': 'local_increment_passed',
        'scope': 'Canonical specialist delegations, public Task DTOs, exact budgets, current visibility, idempotent controls and atomic original-task prerequisite selection. Current native/media checks verify existing UI compatibility. Does not establish complete product, live roles or production qualification.',
        'full_platform_regression': {'path': names[0], 'counts': full['counts'], 'sha256': digest(ROOT / 'docs/quality' / names[0])},
        'focused': {'path': names[1], 'counts': focused['counts'], 'sha256': digest(ROOT / 'docs/quality' / names[1])},
        'previous_782_named_tests_retained': True, 'source_bindings_checked': source_checks,
        'client_checks': {'path': names[2], 'checks': len(clients['checks'])},
        'native_client_journey': {'path': names[3], 'counts': native['counts']},
        'media': {'path': names[4], 'recordings': len(media['recordings']), 'screenshots': len(media['screenshots'])},
        'preserved_failures': ['canonical-task-integration-01.json', 'canonical-task-integration-02.json',
            'paid-input-native-07.json', 'paid-input-native-08.json', 'workmate-media-07.json', 'workmate-media-08.json'],
        'remaining': ['Dedicated TaskCreate business inputs and optional contexts', 'Historical tasks without retained specialist identity',
            'Arbitrary in-flight pause and full same-task retry', 'Recovery after uncertain external operations',
            'Remaining original role/business/client/NFR/G01-G10 acceptance conditions'],
        'baseline': {'requirements': 102, 'acceptance_cases': 102, 'partial_verified': 81, 'completion_not_proven': 21, 'fully_accepted': 0},
        'verifier_sha256': digest(Path(__file__)),
    }
    write(ROOT / 'docs/quality/canonical-task-checkpoint.json', checkpoint)
    path = ROOT / 'docs/quality/requirements-alignment-progress.json'
    progress = read(path)
    original = [(r['requirement_id'], r['requirement'], r['acceptance_case'], r['acceptance_conditions'], r['assessment']) for r in progress['requirements']]
    assert len(original) == 102 and progress['summary'] == {'partial_verified': 81, 'completion_not_proven': 21}
    progress['canonical_task_verification'] = checkpoint
    progress['current_source_qualification'] = {
        'stage': 68, 'checkpoint': 'canonical-task-checkpoint.json',
        'note': 'Earlier stage receipts retain their original source scope. Only these new full/client/native receipts describe the current changed backend; no old result is relabeled as current.'}
    repair = {'cluster': 'canonical_task_contracts',
        'verified_subflow': '原合同任务委派、精确 HKD、真实专家/Skill/预算绑定、并发幂等、白名单 Task、当前权限及来源复查、签名分页、版本控制和原任务输入批次事务；专用业务、历史无身份任务及完整运行恢复未完成。',
        'evidence': ['canonical_task_verification'], 'implementation_docs': ['technical/68-canonical-task-contracts-and-input-transactions.md']}
    for r in progress['requirements']:
        if r['requirement_id'] in ('REQ-009', 'REQ-044', 'REQ-069'):
            assert all(v['cluster'] != repair['cluster'] for v in r.get('verified_repairs', []))
            r.setdefault('verified_repairs', []).append(repair)
            r.setdefault('acceptance_evidence', []).append('canonical_task_verification')
            r['current_task_contract_note'] = '本轮为局部修复。完整专用输入、历史身份迁移、运行中暂停、未知动作核对恢复及原 TC 全部条件仍保留，未完成整项验收。'
    actual = read(DEV / 'copypaste-platform/contracts/implemented-routes.json')
    normalize = lambda p: re.sub(r'\{[^}]+\}|:[^/]+', '{}', p)
    pairs = {(r['method'], normalize(r['path'])) for r in actual['routes']}
    alignment = progress['contract_alignment']
    assert len(alignment['operations']) == alignment['contract_operations'] == 225
    for operation in alignment['operations']:
        operation['method_path_matches'] = (operation['method'], normalize(operation['path'])) in pairs
        assert operation['full_conformance'] == 'not_proven'
    alignment['implemented_operations'] = len(actual['routes'])
    alignment['unmatched_contract_method_paths'] = sum(not r['method_path_matches'] for r in alignment['operations'])
    alignment['inventory_currentness'] = {'path': 'dev/copypaste-platform/contracts/implemented-routes.json', 'sha256': digest(DEV / 'copypaste-platform/contracts/implemented-routes.json'),
        'limit': 'Actual isolated-app method/path inventory, not full schema, semantics or whole-operation acceptance.'}
    progress['at'] = checkpoint['at']
    assert original == [(r['requirement_id'], r['requirement'], r['acceptance_case'], r['acceptance_conditions'], r['assessment']) for r in progress['requirements']]
    write(path, progress)
    print(json.dumps({'full_tests': len(new_names), 'retained_tests': len(old_names), 'actual_routes': len(actual['routes']),
        'unmatched_normative_method_paths': alignment['unmatched_contract_method_paths'], 'source_checks': source_checks}))

if __name__ == '__main__':
    main()
