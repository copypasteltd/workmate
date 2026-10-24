"""Review one host-memory crash and qualify all unchanged, complete file batches.

This does not change or relabel the failed qualification. Every selected batch
retains its own plan, source fingerprint, complete TAP and cleanup receipt.
"""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

from record_desktop_browser import batch_cases

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
PREFIX = 'evidence/desktop-execution-control-28'
OUTPUT = DELIVERY / (PREFIX + '.json')
REVIEW = ROOT / 'docs/quality/generated-video-platform-requalification.json'


def read(file):
    return json.loads(file.read_text(encoding='utf-8'))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def ref(file):
    return {'path': file.relative_to(DELIVERY).as_posix(), 'sha256': digest(file)}


def bound(item):
    file = (DELIVERY / item['path']).resolve()
    assert file.is_relative_to(DELIVERY) and digest(file) == item['sha256'], item
    return file


def counts(raw, passing=True):
    result = {}
    for key in ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']:
        matches = re.findall(r'^# ' + key + r' (\d+)\r?$', raw, re.M)
        assert len(matches) == 1, (key, 'Exactly one terminal TAP summary')
        result[key] = int(matches[0])
    assert result['tests'] > 0
    if passing:
        assert result['tests'] == result['pass']
        assert all(result[key] == 0 for key in ['fail', 'cancelled', 'skipped', 'todo'])
    return result


def validate_sources(plan):
    inventory = []
    for component in ['platform', 'desktop', 'delivery']:
        repo = DEV / ('copypaste-' + component)
        result = subprocess.run(['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
            'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--',
            'src', 'renderer', 'renderer-source.json', 'vite.config.ts', 'tests', 'scripts', 'migrations',
            'catalog', 'contracts', 'skills', 'package.json', 'package-lock.json', 'tsconfig.json',
            'assets/browser-shell.html', 'assets/browser-shell.css', 'assets/browser-shell.js'],
            cwd=repo, capture_output=True, check=True)
        inventory.extend(repo.name + '/' + name for name in sorted(set(result.stdout.decode('utf-8').split('\0'))) if name)
    assert set(inventory) == set(plan['source_files']), 'Complete current inventory must match both executed plans'
    for name, checksum in plan['source_files'].items():
        file = (DEV / name).resolve()
        assert file.is_relative_to(DEV) and digest(file) == checksum, name
    fingerprint = sha256(json.dumps(plan['source_files'], ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
    assert fingerprint == plan['source_fingerprint']


def main():
    assert not OUTPUT.exists() and not REVIEW.exists(), 'Never replace a qualification or a reviewed failure'
    plan_files = {number: DELIVERY / f'evidence/desktop-execution-control-{number}-plan.json' for number in ['27', '28']}
    plans = {number: read(file) for number, file in plan_files.items()}
    plan = plans['28']
    for field in ['version', 'files', 'batch_size', 'batches', 'source_files', 'source_fingerprint', 'native_binary']:
        assert plans['27'][field] == plan[field], (field, 'No application, test or harness changes are allowed')
    actual_tests = sorted('tests/' + file.name for file in (DEV / 'copypaste-platform/tests').glob('*.test.ts'))
    assert plan['files'] == actual_tests and len(actual_tests) == 70
    expected_batches = [{'id': str(i // 4 + 1).zfill(2), 'files': actual_tests[i:i + 4]} for i in range(0, len(actual_tests), 4)]
    assert plan['batch_size'] == 4 and plan['batches'] == expected_batches and len(expected_batches) == 18
    validate_sources(plan)
    driver = DELIVERY / 'scripts/run-desktop-platform-resumable.mjs'
    for value in plans.values():
        assert digest(bound(value['verifier'])) == digest(driver)
    assert digest(Path(plan['native_binary']['path'])) == plan['native_binary']['sha256']

    failed_file = DELIVERY / 'evidence/desktop-execution-control-27-batch-14-attempt-01.json'
    failed = read(failed_file)
    assert failed['status'] == 'failed' and failed['batch'] == '14'
    assert failed['source_unchanged'] and failed['owned_database_shutdown']
    assert failed['source_fingerprint'] == plan['source_fingerprint']
    assert failed['plan_sha256'] == digest(plan_files['27'])
    assert failed['files'] == expected_batches[13]['files']
    failed_raw = bound(failed['raw_report']).read_text(encoding='utf-8')
    assert counts(failed_raw, False) == failed['counts'] == {
        'tests': 52, 'pass': 51, 'fail': 1, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    failed_lines = re.findall(r'^not ok .+\r?$', failed_raw, re.M)
    assert len(failed_lines) == 1 and re.fullmatch(r'not ok \d+ - tests\\\\schedules\.test\.ts', failed_lines[0])
    assert 'exitCode: 3765269347' in failed_raw and "code: 'ERR_TEST_FAILURE'" in failed_raw
    assert 'could not reattach to shared memory' in failed_raw and 'error code 1455' in failed_raw
    marker = re.findall(r'^# owned_fixture_cleanup (.+)\r?$', failed_raw, re.M)
    assert len(marker) == 1
    cleanup_marker = json.loads(marker[0])
    assert cleanup_marker['exit_code'] == 0
    cleanup_file = (DEV / 'copypaste-platform' / cleanup_marker['path']).resolve()
    assert cleanup_file.is_relative_to(DEV / 'copypaste-platform/.data/test-fixture-reclamation')
    assert cleanup_file.name == 'result.json' and digest(cleanup_file) == cleanup_marker['sha256']
    failed_cleanup = read(cleanup_file)
    assert failed_cleanup['status'] == 'passed' and failed_cleanup['workers_exited']
    assert all(row['reclaimed'] for row in failed_cleanup['results'])

    setup_file = DELIVERY / 'evidence/desktop-execution-control-28-setup-attempt-01.json'
    setup = read(setup_file)
    assert setup['status'] == 'passed' and setup['plan_sha256'] == digest(plan_files['28'])
    assert setup['source_unchanged'] and setup['source_fingerprint'] == plan['source_fingerprint']
    assert counts(bound(setup['raw_report']).read_text(encoding='utf-8')) == setup['counts']
    assert setup['counts']['tests'] == 6 and len(setup['checks']) == 2
    assert all(check['exit_code'] == 0 for check in setup['checks'])

    selected, totals = [], {key: 0 for key in ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']}
    for batch in expected_batches:
        number = '28' if batch['id'] == '14' else '27'
        candidates = list((DELIVERY / 'evidence').glob(f'desktop-execution-control-{number}-batch-{batch["id"]}-attempt-??.json'))
        assert len(candidates) == 1, (batch['id'], 'A batch must contribute one complete attempt')
        file = candidates[0]
        row = read(file)
        assert row['status'] == 'passed' and row['batch'] == batch['id'] and row['files'] == batch['files']
        assert row['plan_sha256'] == digest(plan_files[number])
        assert row['source_unchanged'] and row['source_fingerprint'] == plan['source_fingerprint']
        assert row['owned_database_shutdown'] and row['fixture_cleanup']['status'] == 'passed'
        raw = bound(row['raw_report']).read_text(encoding='utf-8')
        assert counts(raw) == row['counts']
        cleanup = read(bound(row['fixture_cleanup']))
        assert cleanup['status'] == 'passed' and cleanup['workers_exited']
        assert all(item['reclaimed'] for item in cleanup['results'])
        for key in totals:
            totals[key] += row['counts'][key]
        selected.append({**ref(file), 'batch': batch['id'], 'files': batch['files'], 'counts': row['counts'],
                         'qualification_plan': ref(plan_files[number])})
    assert totals['tests'] == totals['pass'] == 912
    assert all(totals[key] == 0 for key in ['fail', 'cancelled', 'skipped', 'todo'])
    index = {'plan': ref(plan_files['28']), 'setup': ref(setup_file), 'batches': selected,
             'qualification_plans': [ref(file) for file in plan_files.values()],
             'execution_strategy': 'reviewed_identical_source_batch_requalification',
             'note': 'The failed stage-27 batch is retained as failed and contributes no passing coverage. Its four complete files were freshly re-executed under stage-28. Seventeen earlier complete passing batches have exactly the same application, tests, harness, complete inventory and native binary. Each selected receipt keeps its own original plan hash. No TAP files are concatenated or rewritten.'}
    cases = batch_cases(index)
    assert sum(cases.values()) == totals['tests']
    required = ['all eighteen connected native roles', 'native workflow specialist exposes eight scoped tools',
        'explicitly published native SOPs retain workflow provenance', 'reused native workflows preserve original file lineage',
        'reusable native source snapshots outlive the creator task', 'native company tools recheck owner',
        'native designer generation and editing', 'native company namespace rejects altered schemas',
        'an unknown native company image result fences', 'real native Codex edits local files, uses company Image 2 and same-thread edits']
    assert all(any(name in case for case in cases) for name in required)
    assert cases['a completed provider request keeps its rolling-minute rate charge after freeing concurrency'] == 1
    validate_sources(plan)

    cleanup_copy = DELIVERY / (PREFIX + '-rejected-27-batch-14-fixture-cleanup.json')
    verifier_copy = DELIVERY / (PREFIX + '-review-verifier.py')
    index_file = DELIVERY / (PREFIX + '-index.json')
    for target, data in [(cleanup_copy, cleanup_file.read_bytes()), (verifier_copy, Path(__file__).read_bytes())]:
        with target.open('xb') as stream:
            stream.write(data)
    review = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'reviewed_exact_source_requalification',
              'failed_receipt': ref(failed_file), 'failed_raw_report': failed['raw_report'], 'failed_cleanup': ref(cleanup_copy),
              'observed_failure': 'Windows error 1455 prevented PostgreSQL shared-memory reattachment during schedules.test.ts; the Node child then exited with 0xE06D7363. No product assertion failure is substituted with a pass.',
              'reexecution': next(item for item in selected if item['batch'] == '14'),
              'unchanged_complete_source_fingerprint': plan['source_fingerprint'],
              'complete_files': 70, 'complete_batches': 18, 'passing_tests': 912,
              'failed_attempt_counted_as_passed': False, 'original_tap_or_plan_modified': False,
              'verifier': {'path': Path(__file__).relative_to(ROOT).as_posix(), 'sha256': digest(Path(__file__))},
              'verifier_dependencies': [{'path': 'docs/tools/record_desktop_browser.py', 'sha256': digest(ROOT / 'docs/tools/record_desktop_browser.py')}]}
    REVIEW.write_text(json.dumps(review, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    index['review'] = {'path': REVIEW.relative_to(ROOT).as_posix(), 'sha256': digest(REVIEW)}
    with index_file.open('x', encoding='utf-8', newline='\n') as stream:
        stream.write(json.dumps(index, ensure_ascii=False, indent=2) + '\n')
    report = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed',
        'execution_strategy': index['execution_strategy'],
        'scope': 'All platform test files with a reviewed, complete same-source re-execution of the host-memory-crashed batch; failed evidence remains failed.',
        'counts': totals, 'checks': setup['checks'], 'source_files': plan['source_files'], 'source_unchanged': True,
        'source_fingerprint': plan['source_fingerprint'], 'owned_database_shutdown': True,
        'native_binary_exercised': True, 'native_binary': plan['native_binary'], 'required_scenarios': required,
        'coverage': index, 'raw_report': ref(index_file), 'verifier': ref(verifier_copy),
        'qualification_state_test_counts': setup['counts'], 'reviewed_requalification': index['review'], 'error': None,
        'not_validated': ['live_model_and_image_quality', 'human_native_dialog_clicks', 'signed_installer', 'all_roles_and_tools', 'entire_product_acceptance']}
    with OUTPUT.open('x', encoding='utf-8', newline='\n') as stream:
        stream.write(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': 'passed', 'tests': 912, 'batches': 18, 'files': 70, 'failed_attempt_preserved': True}))


if __name__ == '__main__':
    main()
