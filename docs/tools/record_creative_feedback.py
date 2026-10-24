"""Bind current feedback, native-layout and regression receipts without closing original gates."""
import argparse
from datetime import datetime, timezone
from pathlib import Path
from hashlib import sha256
import json
import re

from record_desktop_browser import batch_cases, bound

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'


def read(file):
    return json.loads(file.read_text(encoding='utf-8'))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    for key in ['core', 'compatibility', 'ui', 'desktop', 'clients', 'control']:
        parser.add_argument('--' + key, required=True)
    args = vars(parser.parse_args())
    assert all(re.fullmatch(r'\d{2}', value) for value in args.values())
    output = ROOT / 'docs/quality/creative-feedback-checkpoint.json'
    assert not output.exists()
    selected = {
        'core': f"evidence/creative-feedback-checks-{args['core']}.json",
        'compatibility': f"evidence/creative-feedback-checks-{args['compatibility']}.json",
        'web_ui': f"evidence/creative-feedback-ui-{args['ui']}.json",
        'desktop_ui': f"evidence/desktop-local-ui-{args['desktop']}.json",
        'clients': f"evidence/history-source-clients-{args['clients']}.json",
        'platform': f"evidence/desktop-execution-control-{args['control']}.json",
    }
    reports = {key: read(DELIVERY / value) for key, value in selected.items()}
    sources, scopes = {}, []
    route_file = ROOT / 'docs/quality/creative-feedback-route-inventory.json'
    routes = read(route_file)
    assert routes['status'] == 'passed' and routes['configured_routes'] == 454
    repair_file = ROOT / 'docs/quality/creative-feedback-capture-repair-review.json'
    repair = read(repair_file)
    assert repair['status'] == 'verified_native_presentation_and_ui_repairs' and repair['product_source_changes'] == 1
    assert repair['assertions_removed_or_changed'] == 0
    assert repair['verifier_sha256'] == digest(ROOT / 'docs/tools/review_creative_feedback_capture_repair.py')
    assert len(repair['changed_files']) == 10
    for key, report in reports.items():
        assert report['status'] == 'passed' and report['source_unchanged'], key
        if 'owned_database_shutdown' in report:
            assert report['owned_database_shutdown'], key
        if 'counts' in report and 'tests' in report['counts']:
            counts = report['counts']
            assert counts['tests'] == counts['pass'] > 0
            assert all(counts[name] == 0 for name in ['fail', 'cancelled', 'skipped', 'todo'])
        for name, value in report['source_files'].items():
            if key == 'clients':
                component, separator, relative = name.partition('/')
                assert separator and component in ['platform', 'web', 'admin', 'desktop', 'extension', 'delivery'], name
                file = DEV / ('copypaste-' + component) / relative
            else:
                file = ROOT / name if name.startswith(('docs/', 'dev/')) else DEV / name
            actual = digest(file)
            assert actual == value, (key, name)
            name = file.relative_to(ROOT).as_posix()
            assert name not in sources or sources[name] == actual
            sources[name] = actual
        for field in ['raw_report', 'raw_log', 'verifier', 'journey_verifier']:
            if isinstance(report.get(field), dict):
                bound(report[field])
        scopes.append({'scope': key, 'report': selected[key], 'sha256': digest(DELIVERY / selected[key]),
            'source_files': len(report['source_files']), 'current_source_exact': True})
    full = reports['platform']
    assert full['execution_strategy'] == 'resumable_complete_file_inventory'
    index = read(bound(full['raw_report']))
    plan = read(bound(index['plan']))
    actual = batch_cases(index)
    previous = batch_cases(read(bound(read(DELIVERY / 'evidence/desktop-execution-control-30.json')['raw_report'])))
    assert sum(previous.values()) == 929 and not previous - actual
    assert sum(actual.values()) == full['counts']['tests']
    assert len(plan['files']) == len(set(plan['files']))
    assert {'tests/creative-feedback.test.ts', 'tests/creative-feedback-calculation.test.ts'} <= set(plan['files'])
    assert reports['core']['phase'] == 'core' and reports['core']['counts']['tests'] >= 16
    assert reports['compatibility']['phase'] == 'compatibility'
    desktop = read(bound(reports['desktop_ui']['journey']))
    web = reports['web_ui']['journey']
    assert len(desktop['checks']) == 36 and len(web['checks']) == 4
    assert all(desktop[k] for k in ['electron_closed', 'browser_closed', 'api_closed', 'fixture_closed', 'native_browser_fixture_closed'])
    assert all(web[k] for k in ['browser_closed', 'api_closed', 'fixture_closed'])
    assert not desktop['errors'] and not web['errors']
    for key in ['desktop_ui', 'web_ui']:
        report = reports[key]
        assert report['owned_preview_closed'] if key == 'desktop_ui' else report['owned_previews_closed']
        cleanup = report['fixture_cleanup']
        assert cleanup['status'] == 'passed' and all(v['reclaimed'] for v in cleanup['results'])
        if key == 'desktop_ui':
            bound(cleanup)
        else:
            stem = Path(selected[key]).with_suffix('').as_posix()
            assert read(DELIVERY / (stem + '-journey.json')) == web
            assert read(DELIVERY / (stem + '-fixture-cleanup.json')) == {k: v for k, v in cleanup.items() if k != 'exit_code'}
            for suffix, source in [('-verifier.mjs', 'run-creative-feedback-ui.mjs'), ('-journey-verifier.ts', 'qa-creative-feedback-ui.ts')]:
                assert digest(DELIVERY / (stem + suffix)) == report['source_files']['copypaste-delivery/scripts/' + source]
    client_checks = reports['clients']['checks']
    assert all(v['exit_code'] == 0 for v in client_checks)
    client_cases = 0
    for item in client_checks:
        assert digest(DELIVERY / item['raw_report']) == item['raw_sha256']
        if item['counts']:
            c = item['counts']
            assert c['tests'] == c['pass'] > 0 and all(c[k] == 0 for k in ['fail', 'cancelled', 'skipped', 'todo'])
            client_cases += c['tests']
    recordings = [desktop['creative_feedback_media'], *web['media']]
    screenshots = [v for v in desktop['screenshots'] if 'feedback-' + args['desktop'] in v['path']] + web['screenshots']
    layout = [v for v in desktop['screenshots'] if '-layout-' in v['path']]
    progress = [v for v in desktop['screenshots'] if v['path'].endswith('-generated-progress-en.png')]
    assert len(screenshots) == 10 and len(recordings) == 2 and len(layout) >= 10
    assert len(progress) == 1
    documentation_media = []
    for item in screenshots + layout + progress + [f for media in recordings for f in media['files']]:
        file = DEV / item['path']
        assert digest(file) == item['sha256']
        target = ROOT / 'docs/design/implementation' / (Path(item['path']).parts[0] + '__' + file.name)
        if target.exists():
            assert digest(target) == item['sha256']
        else:
            target.write_bytes(file.read_bytes())
        documentation_media.append({'source': item['path'], 'path': target.relative_to(ROOT).as_posix(), 'sha256': item['sha256']})
    for media in recordings:
        assert media['skipped_capture_errors'] == 0 and media['distinct_frames'] > 1
    baseline = read(ROOT / 'docs/quality/managed-video-checkpoint.json')
    migrations = {name: value for name, value in baseline['source_files'].items() if '/migrations/' in name}
    assert len(migrations) == 98
    for name, value in migrations.items():
        assert digest(ROOT / name if name.startswith('dev/') else DEV / name) == value, name
    assert digest(ROOT / 'docs/contracts/openapi.json') == '51dd90f26137798dd23c4e881b7f9f0b20f99ad4b9fee0cce98686e11873aab4'
    assert digest(DEV / 'copypaste-platform/catalog/openapi.json') == '7ce0b4cb170cdebc07aa4ee8f8810f24dbf996d95128519da184d7b2eb62156b'
    assert digest(ROOT / 'docs/contracts/creative-feedback-openapi.json') == digest(DEV / 'copypaste-platform/contracts/creative-feedback-openapi.json')
    timing_sources = []
    timing_values = []
    for attempt, batch in [('30', '15'), (args['control'], '16')]:
        file = DELIVERY / f'evidence/desktop-execution-control-{attempt}-batch-{batch}-attempt-01.tap'
        values = dict(re.findall(r'^ok \d+ - ([^\n]+)\n\s*---\n\s*duration_ms: ([\d.]+)', file.read_text(encoding='utf-8'), re.M))
        timing_values.append(values)
        timing_sources.append({'path': file.relative_to(DELIVERY).as_posix(), 'sha256': digest(file)})
    timing_cases = [name for name in timing_values[0] if name.startswith('saved change rejects ')]
    assert len(timing_cases) == 6 and all(name in timing_values[1] for name in timing_cases)
    timing_observation = {'scope': 'Observed whole-test wall times for the same legacy case names; source revisions, data and host conditions differ. This is not a controlled benchmark or a causal attribution.',
        'sources': timing_sources, 'cases': [{'name': name, 'previous_ms': float(timing_values[0][name]), 'current_ms': float(timing_values[1][name])} for name in timing_cases],
        'read_only_observation': {'native_port': 55432, 'default_transaction_read_only': True,
            'scope': 'pg_stat_activity metadata and one pg_database_size call; no business or schema mutations',
            'database_size_statement_timeout_ms': 5000, 'database_size_result': 'statement_cancelled_by_own_timeout',
            'connections_closed': True, 'original_log_retained': True},
        'performance_and_capacity_acceptance': 'not_proven'}
    result = {'at': datetime.now(timezone.utc).isoformat(), 'stage': 82, 'status': 'verified_confirmed_creative_feedback_subflow',
        'scope': 'Explicit user-confirmed ad-level creative identity, exact independent feedback, retained and erased source lineage, and actual native presentation without visible scrollbar rails. Advertising facts/model content remain synthetic.',
        'selected': selected, 'source_files': dict(sorted(sources.items())), 'qualification_scopes': scopes,
        'platform_tests': full['counts'], 'previous_platform_cases_preserved': 929,
        'platform_files': len(plan['files']), 'platform_batches': len(plan['batches']),
        'core_tests': reports['core']['counts'], 'compatibility_tests': reports['compatibility']['counts'],
        'client_counts': client_cases, 'web_ui_checks': len(web['checks']), 'desktop_ui_checks': len(desktop['checks']),
        'screenshots': screenshots, 'layout_screenshots': layout, 'progress_screenshots': progress, 'recordings': recordings, 'documentation_media': documentation_media,
        'published_migrations_preserved': 98, 'route_inventory': {'path': route_file.relative_to(ROOT).as_posix(), 'sha256': digest(route_file)},
        'timing_observation': timing_observation,
        'capture_repair_review': {'path': repair_file.relative_to(ROOT).as_posix(), 'sha256': digest(repair_file)},
        'media_review': {'path': 'docs/quality/creative-feedback-media-review.json', 'sha256': digest(ROOT / 'docs/quality/creative-feedback-media-review.json')},
        'visual_review': {'path': 'docs/quality/creative-feedback-visual-review.md', 'sha256': digest(ROOT / 'docs/quality/creative-feedback-visual-review.md')},
        'original_acceptance': {'requirements': 102, 'cases': 102, 'partially_verified': 83, 'not_proven': 19, 'fully_accepted': 0, 'gates_G01_G10': 'not_proven'},
        'not_validated': ['provider_verified_creative_identity', 'campaign_to_creative_allocation', 'causal_uplift', 'all_professional_roles', 'signed_installer', 'complete_Codex_Desktop_parity', 'performance_and_capacity_acceptance', 'complete_original_acceptance', 'production_readiness'],
        'verifier_sha256': digest(Path(__file__))}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': result['status'], 'sources': len(sources), 'platform_tests': full['counts']['tests'], 'screenshots': len(screenshots), 'layout': len(layout)}))


if __name__ == '__main__':
    main()
