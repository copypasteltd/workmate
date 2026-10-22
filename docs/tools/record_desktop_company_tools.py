"""Bind the native company-tool increment to actual source, runs and media."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'


def read(file):
    return json.loads(file.read_text(encoding='utf-8'))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def exclusive(file, data):
    file.parent.mkdir(parents=True, exist_ok=True)
    with file.open('xb') as stream:
        stream.write(data)


def bound(item):
    file = (DELIVERY / item['path']).resolve()
    assert file.is_relative_to(DELIVERY.resolve()) and file.is_file()
    assert digest(file) == item['sha256'], item['path']
    return file


def tap_counts(text):
    result = {}
    for key in ('tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'):
        values = re.findall(r'^# ' + key + r' (\d+)\r?$', text, re.M)
        assert len(values) == 1, (key, 'Incomplete or concatenated TAP')
        result[key] = int(values[0])
    assert result['tests'] > 0 and result['pass'] == result['tests']
    assert all(result[key] == 0 for key in ('fail', 'cancelled', 'skipped', 'todo'))
    return result


def verify_complete_inventory(control, attempt):
    assert control['execution_strategy'] == 'resumable_complete_file_inventory'
    index = read(bound(control['raw_report']))
    assert index == control['coverage']
    plan = read(bound(index['plan']))
    assert plan['version'] == 1 and plan['execution_strategy'] == control['execution_strategy']
    actual = sorted('tests/' + file.name for file in (DEV / 'copypaste-platform/tests').glob('*.test.ts'))
    assert plan['files'] == actual and len(actual) == len(set(actual))
    assert all(re.fullmatch(r'tests/[a-z0-9-]+\.test\.ts', name) for name in actual)
    assert plan['batch_size'] == 4
    batches = [{'id': f'{number // 4 + 1:02}', 'files': actual[number:number + 4]} for number in range(0, len(actual), 4)]
    assert plan['batches'] == batches and plan['source_files'] == control['source_files']
    fingerprint = sha256(json.dumps(plan['source_files'], ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
    assert fingerprint == plan['source_fingerprint'] == control['source_fingerprint']
    assert plan['native_binary'] == control['native_binary']
    assert plan['native_binary']['sha256'] == digest(Path(plan['native_binary']['path']))
    assert plan['verifier'] == control['verifier']
    bound(plan['verifier'])
    setup = read(bound(index['setup']))
    assert setup['status'] == 'passed' and setup['source_unchanged']
    assert setup['plan_sha256'] == index['plan']['sha256'] and setup['source_fingerprint'] == fingerprint
    assert setup['counts'] == tap_counts(bound(setup['raw_report']).read_text(encoding='utf-8'))
    assert setup['counts']['tests'] == 6 and setup['counts'] == control['qualification_state_test_counts']
    assert len(setup['checks']) == 2 and all(item['exit_code'] == 0 for item in setup['checks'])
    assert setup['checks'] == control['checks']
    assert len(index['batches']) == len(batches)
    totals = dict.fromkeys(('tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'), 0)
    selected = set()
    raw_text = []
    for expected, item in zip(batches, index['batches'], strict=True):
        assert item['batch'] == expected['id'] and item['files'] == expected['files']
        receipt = read(bound(item))
        assert receipt['status'] == 'passed' and receipt['source_unchanged'] and receipt['owned_database_shutdown']
        assert receipt['batch'] == item['batch'] and receipt['files'] == item['files']
        assert receipt['plan_sha256'] == index['plan']['sha256'] and receipt['source_fingerprint'] == fingerprint
        assert len(receipt['checks']) == 1 and receipt['checks'][0]['exit_code'] == 0
        text = bound(receipt['raw_report']).read_text(encoding='utf-8')
        assert tap_counts(text) == receipt['counts'] == item['counts']
        cleanup = read(bound(receipt['fixture_cleanup']))
        assert cleanup['status'] == receipt['fixture_cleanup']['status'] == 'passed'
        assert cleanup['workers_exited'] and all(row['reclaimed'] for row in cleanup['results'])
        raw_text.append(text)
        selected.add(item['path'])
        for key in totals:
            totals[key] += receipt['counts'][key]
    assert totals == control['counts']
    required = ['all sixteen connected native roles', 'native company tools recheck owner', 'native designer generation and editing',
                'native company namespace rejects altered schemas', 'an unknown native company image result fences',
                'real native Codex edits local files, uses company Image 2 and same-thread edits']
    assert required == control['required_scenarios']
    passed = re.findall(r'^ok \d+ - (.*)$', '\n'.join(raw_text), re.M)
    assert all(any(name in line for line in passed) for name in required)
    # No failed or second passing attempt can be silently hidden by the index.
    for file in (DELIVERY / 'evidence').glob(f'desktop-execution-control-{attempt}-batch-??-attempt-??.json'):
        value = read(file)
        expected = next(row for row in batches if row['id'] == value['batch'])
        assert value['files'] == expected['files'] and value['plan_sha256'] == index['plan']['sha256']
        assert value['status'] in ('passed', 'interrupted')
        if value['status'] == 'passed':
            assert file.relative_to(DELIVERY).as_posix() in selected
    return {'strategy': control['execution_strategy'], 'test_files': len(actual), 'batches': len(batches),
            'plan': index['plan'], 'index': control['raw_report'], 'setup_unit_tests': setup['counts'], 'all_batch_tap_and_cleanup_hashes_verified': True}


def main():
    parser = argparse.ArgumentParser()
    for key in ('control', 'native', 'ui'):
        parser.add_argument('--' + key, required=True)
    args = parser.parse_args()
    assert all(re.fullmatch(r'\d{2}', value) for value in vars(args).values())
    assert int(args.ui) >= 9, 'Minimum-window proof must include ancestor clipping, receipt and artifact bounds'
    names = [f'desktop-execution-control-{args.control}.json', f'local-codex-native-{args.native}.json', f'desktop-local-ui-{args.ui}.json']
    control, native, ui = reports = [read(DELIVERY / 'evidence' / name) for name in names]
    assert all(report['status'] == 'passed' and report['source_unchanged'] for report in reports)
    assert control['native_binary_exercised'] and control['owned_database_shutdown']
    assert control['scope'] == 'all_platform_tests_including_cloud_business_tools_and_native_execution'
    assert control['counts']['tests'] >= 800 and control['counts']['pass'] == control['counts']['tests']
    coverage = verify_complete_inventory(control, args.control)
    assert native['counts'] == {'tests': 14, 'pass': 14, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    assert ui['owned_database_shutdown'] and ui['owned_preview_closed']
    assert len(ui['checks']) == 11 and all(check['exit_code'] == 0 for check in ui['checks'])
    assert ui['fixture_cleanup']['status'] == 'passed' and ui['fixture_cleanup']['exit_code'] == 0
    assert all(item['reclaimed'] for item in ui['fixture_cleanup']['results'])
    journey = read(DELIVERY / ui['journey']['path'])
    assert journey['status'] == 'passed' and journey['company_image_calls'] == 2
    assert len(journey['checks']) == 9 and len(journey['screenshots']) == 6
    assert all(journey[key] for key in ('electron_closed', 'browser_closed', 'api_closed', 'fixture_closed'))
    assert journey['media']['skipped_capture_errors'] == 0 and journey['media']['observed_frames'] >= 5 and journey['media']['distinct_frames'] >= 2
    for report in (control, ui):
        for key in ('raw_report', 'verifier') + (('journey', 'journey_verifier', 'fixture_cleanup') if report is ui else ()):
            item = report[key]
            assert digest(DELIVERY / item['path']) == item['sha256'], item['path']
    assert digest(DELIVERY / native['raw_report']) == native['raw_sha256']
    assert digest(DELIVERY / ('evidence/local-codex-native-' + args.native + '-verifier.mjs')) == native['verifier_sha256']
    sources = {}
    for report in reports:
        for file, expected in report['source_files'].items():
            relative = 'copypaste-desktop/' + file if report is native else file
            assert digest(DEV / relative) == expected, relative
            assert relative not in sources or sources[relative] == expected
            sources[relative] = expected
    log = (DELIVERY / ui['raw_report']['path']).read_text(encoding='utf-8')
    for key, expected in (('tests', 37), ('pass', 37), ('fail', 0), ('skipped', 0)):
        assert re.search(r'^# ' + key + ' ' + str(expected) + '$', log, re.M)
    for item in journey['screenshots'] + journey['media']['files']:
        assert digest(DEV / item['path']) == item['sha256'], item['path']
    for item in journey['media']['files']:
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-xerror', '-err_detect', 'explode', '-i', str(DEV / item['path']), '-f', 'null', '-'], capture_output=True, check=True)
    candidate = (DELIVERY / ui['packaged']['executable']).resolve()
    assert candidate.is_relative_to(DEV)
    assert digest(candidate.parent / 'resources/app.asar') == ui['packaged']['app_asar_sha256']
    original = read(ROOT / 'docs/quality/desktop-local-execution-checkpoint.json')
    assert original['selected'] == {'control': '08', 'native': '14', 'ui': '05'}
    migration_name = 'desktop-migration-upgrade-01.json'
    migration = read(DELIVERY / 'evidence' / migration_name)
    assert migration['status'] == 'passed' and migration['source_unchanged'] and migration['owned_database_shutdown']
    assert migration['counts'] == {'tests': 3, 'pass': 3, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    for item in (migration['raw_report'], migration['verifier']):
        assert digest(DELIVERY / item['path']) == item['sha256']
    for relative, expected in migration['source_files'].items():
        assert digest(DEV / 'copypaste-platform' / relative) == expected
        assert sources['copypaste-platform/' + relative] == expected
    archives = []
    archive = ROOT / 'docs/quality/history/desktop-company-tool-qualified-sources'
    # Check every destination before the first exclusive write.
    assert not archive.exists()
    for name in names + [f'desktop-local-ui-{args.ui}-journey.json', migration_name]:
        assert not (ROOT / 'docs/quality' / name).exists()
    assert not (ROOT / 'docs/quality/desktop-company-tools-checkpoint.json').exists()
    for item in journey['screenshots'] + journey['media']['files']:
        source = DEV / item['path']
        target = ROOT / 'docs/design/implementation/workmate' / ('desktop-native-' + args.ui + '-' + source.name.split('workmate-local-' + args.ui + '-', 1)[1])
        assert not target.exists()
    for relative, expected in sorted(sources.items()):
        if relative.startswith('copypaste-desktop/') or any(part in relative for part in ('desktop-', 'desktop-tool', 'task-business-tools', 'worker.ts', 'internal-ai-gateway', 'migrations.test.ts')):
            target = archive / (relative.replace('/', '__') + '.txt')
            exclusive(target, (DEV / relative).read_bytes())
            assert digest(target) == expected
            archives.append({'source': 'dev/' + relative, 'archive': target.relative_to(ROOT).as_posix(), 'sha256': expected})
    for name in names + [f'desktop-local-ui-{args.ui}-journey.json', migration_name]:
        exclusive(ROOT / 'docs/quality' / name, (DELIVERY / 'evidence' / name).read_bytes())
    documentation_media = []
    for item in journey['screenshots'] + journey['media']['files']:
        source = DEV / item['path']
        target = ROOT / 'docs/design/implementation/workmate' / ('desktop-native-' + args.ui + '-' + source.name.split('workmate-local-' + args.ui + '-', 1)[1])
        exclusive(target, source.read_bytes())
        assert digest(target) == item['sha256']
        documentation_media.append({'source': 'dev/' + item['path'], 'path': target.relative_to(ROOT).as_posix(), 'sha256': item['sha256']})
    attempts = []
    for prefix, start, end in [('desktop-execution-control', 9, int(args.control)), ('local-codex-native', 15, int(args.native)), ('desktop-local-ui', 6, int(args.ui))]:
        for number in range(start, end + 1):
            file = DELIVERY / 'evidence' / f'{prefix}-{number:02}.json'
            if file.exists():
                previous = read(file)
                attempts.append({'path': file.relative_to(ROOT).as_posix(), 'sha256': digest(file), 'status': previous['status'], 'counts': previous['counts'], 'scope': previous.get('scope', 'packaged_ui')})
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'verified_native_company_tool_subset', 'stage': 73,
              'requirements': 'CLIENT01 DESK-L01–L08; full professional acceptance remains open', 'selected': vars(args),
              'previous_checkpoint': {'path': 'docs/quality/desktop-local-execution-checkpoint.json', 'sha256': digest(ROOT / 'docs/quality/desktop-local-execution-checkpoint.json'), 'scope': 'Historical stage 72 source retained unchanged'},
              'source_files_verified': len(sources), 'source_archives': archives, 'platform_tests': control['counts'], 'platform_regression_coverage': coverage, 'native_tests': native['counts'], 'desktop_unit_tests': 37,
              'connected_native_roles': 16, 'role_count_is_professional_qualification': False, 'native_ui_checks': journey['checks'],
              'screenshots': journey['screenshots'], 'media': journey['media'], 'documentation_media': documentation_media, 'full_media_decode': 'passed', 'packaged': ui['packaged'], 'attempts': attempts,
              'migration_upgrade_recheck': {'path': 'dev/copypaste-delivery/evidence/' + migration_name, 'sha256': digest(DELIVERY / 'evidence' / migration_name), 'counts': migration['counts'], 'overlaps_full_platform': True},
              'historical_attempt_interpretation': {'control11': 'Full regression exposed two stale expected latest-migration values (91 rather than the already-published 92); SQL remained unchanged',
                                                   'control12': 'Interrupted after 242 observed passes; no final source/TAP/cleanup receipt. Partial output contributes no complete qualification.',
                                                   'control13': 'Independently launched process interrupted after 568 observed passes; no final source/TAP/cleanup receipt. A new fixed-inventory resumable run replaces this incomplete attempt without reusing its partial TAP.',
                                                   'ui06': 'Business assertions passed; screenshot review found the composer below the window, so the layout was repaired',
                                                   'ui07': 'Viewport assertions passed; screenshot review found ancestor-container clipping at 800x600, so the assertions and compact layout were repaired',
                                                   'ui08': 'Composer and receipt bounds passed; screenshot review then found vertical overflow in the compact artifact bar inherited from the shared button minimum height',
                                                   'selected_ui': 'Includes ancestor clipping, composer/budget/send/receipt/artifact bounds, horizontal-only artifact scrolling and at least 64px of messages at default and minimum native sizes'},
              'limits': ['Model and image responses, native chooser/consent/save decisions are explicit synthetic fixtures; Codex, Electron, auth, local file, sandbox, company API, artifact bytes and server ledger actually run',
                         '16 role registrations do not prove all professional workflows; video-motion and workflow-consultant native integration remains required',
                         'Native waiting-input UI and complete browser/application automation remain open parts of the Codex Desktop capability benchmark',
                         'Unsigned Windows x64 candidate; live model/image qualification, human native-dialog clicks, signing, installation and full OS/application matrix remain open',
                         'Original 18 roles/29 Skills, 102 REQ/102 TC/NFR/G01–G10 remain in scope; 81 partial, 21 unproven, zero fully accepted'],
              'verifier_sha256': digest(Path(__file__))}
    exclusive(ROOT / 'docs/quality/desktop-company-tools-checkpoint.json', (json.dumps(result, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
    print(json.dumps({'status': result['status'], 'source_files': len(sources), 'platform_tests': control['counts']['tests'], 'native_tests': 14, 'unit_tests': 37, 'ui_checks': 9}))


if __name__ == '__main__':
    main()
