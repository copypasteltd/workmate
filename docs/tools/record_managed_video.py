"""Bind bounded managed-video verification to actual current-source receipts."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re

from record_desktop_browser import batch_cases, bound

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
OUTPUT = ROOT / 'docs/quality/managed-video-checkpoint.json'


def read(file):
    return json.loads(file.read_text(encoding='utf-8'))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def current(name):
    return ROOT / name if name.startswith(('dev/', 'docs/')) else DEV / name


def main():
    parser = argparse.ArgumentParser()
    for name in ['control', 'compatibility', 'ui', 'contract']:
        parser.add_argument('--' + name, required=True)
    args = vars(parser.parse_args())
    assert all(re.fullmatch(r'\d{2}', value) for value in args.values())
    assert not OUTPUT.exists()
    selected = {'platform': f"evidence/desktop-execution-control-{args['control']}.json",
                'compatibility': f"evidence/managed-video-capabilities-{args['compatibility']}.json",
                'admin_ui': f"evidence/managed-video-capability-ui-{args['ui']}.json",
                'contract': f"evidence/capability-release-contract-{args['contract']}.json"}
    repair_file = ROOT / 'docs/quality/managed-video-fixture-repair-review.json'
    repair = read(repair_file)
    assert repair['status'] == 'verified_harness_only_repair' and repair['product_source_changes'] == 0
    assert repair['verifier_sha256'] == digest(ROOT / 'docs/tools/review_managed_video_fixture_repair.py')
    repaired = {item['path']: item for item in repair['changed_files']}
    assert len(repaired) == 2
    core = repair['current_harness_core']
    selected['harness_core'] = (ROOT / core['path']).relative_to(DELIVERY).as_posix()
    assert digest(DELIVERY / selected['harness_core']) == core['sha256']
    reports = {key: read(DELIVERY / name) for key, name in selected.items()}
    route_file = ROOT / 'docs/quality/managed-video-route-inventory.json'
    routes = read(route_file)
    assert routes['status'] == 'passed' and routes['configured_routes'] == 447
    sources, scopes = {}, []
    for key, report in reports.items():
        assert report['status'] == 'passed' and report['source_unchanged'], key
        if key != 'contract':
            assert report['owned_database_shutdown'], key
        differences = []
        for name, value in report['source_files'].items():
            file = current(name)
            actual = digest(file)
            if actual != value:
                if key == 'admin_ui' and name == 'copypaste-platform/contracts/implemented-routes.json':
                    assert routes['before_sha256'] == value and routes['after_sha256'] == actual
                    original = next(row for row in routes['records'] if row['path'] == 'dev/' + name)
                    assert digest(ROOT / original['archive']) == value
                    reason = 'Only the descriptive route inventory was refreshed from this passing actual app; product source and journey bytes did not change.'
                else:
                    assert key in ['compatibility', 'admin_ui'] and name in repaired, (key, name)
                    item = repaired[name]
                    assert value == item['before_sha256'] and actual == item['after_sha256']
                    assert digest(ROOT / item['archive']) == value
                    reason = 'Exact later harness-only safe-port selection and bounded arrival wait are independently reviewed and requalified by the current core and full platform runs. Executed product/UI verifier bytes remain unchanged.'
                differences.append({'path': name, 'executed_sha256': value, 'current_sha256': actual, 'reason': reason})
            normalized = file.relative_to(ROOT).as_posix()
            assert normalized not in sources or sources[normalized] == actual
            sources[normalized] = actual
        for field in ['raw_report', 'raw_log', 'verifier', 'journey_verifier']:
            if isinstance(report.get(field), dict):
                bound(report[field])
        scopes.append({'scope': key, 'report': selected[key], 'sha256': digest(DELIVERY / selected[key]),
                       'source_files': len(report['source_files']), 'later_reviewed_source_differences': differences})

    full = reports['platform']
    assert full['execution_strategy'] == 'resumable_complete_file_inventory'
    index = read(bound(full['raw_report']))
    plan = read(bound(index['plan']))
    actual = batch_cases(index)
    prior = read(DELIVERY / 'evidence/desktop-execution-control-28.json')
    previous = batch_cases(read(bound(prior['raw_report'])))
    assert sum(previous.values()) == 912 and not previous - actual
    assert sum(actual.values()) == full['counts']['tests'] == full['counts']['pass']
    assert all(full['counts'][name] == 0 for name in ['fail', 'cancelled', 'skipped', 'todo'])
    assert len(plan['files']) == 71 and len(plan['batches']) == 18
    assert 'tests/capability-video-verification.test.ts' in plan['files']
    assert len(plan['files']) == len(set(plan['files']))
    assert actual['worker shutdown before HTTP preserves a prepared operation for a later processor'] == 1
    assert actual['worker shutdown during media download retains confirmed cost and resumes the original content'] == 1
    compatibility = reports['compatibility']
    assert compatibility['phase'] == 'compatibility'
    assert compatibility['counts']['tests'] == compatibility['counts']['pass'] > 0
    assert reports['harness_core']['counts']['tests'] == reports['harness_core']['counts']['pass'] == 17
    assert reports['contract']['errors'] == [] and len(reports['contract']['checks']) == 7
    ui = reports['admin_ui']
    journey = ui['journey']
    assert ui['compiled_unchanged'] and ui['owned_preview_closed']
    assert journey['status'] == 'passed' and len(journey['checks']) == 7 and not journey['errors']
    assert all(journey[name] for name in ['browser_closed', 'api_closed', 'fixture_closed', 'provider_closed'])
    assert ui['fixture_cleanup']['status'] == 'passed' and all(row['reclaimed'] for row in ui['fixture_cleanup']['results'])
    assert len(journey['media']) == 3 and all(row['skipped_capture_errors'] == 0 for row in journey['media'])
    for suffix in ['-verifier.mjs', '-journey-verifier.ts', '-journey.json', '-fixture-cleanup.json']:
        file = DELIVERY / (Path(selected['admin_ui']).with_suffix('').as_posix() + suffix)
        assert file.is_file()
    baseline = read(ROOT / 'docs/quality/generated-video-checkpoint.json')
    preserved_migrations = {name: value for name, value in baseline['source_files'].items()
                            if name.startswith('copypaste-platform/migrations/')}
    assert len(preserved_migrations) == 97
    for name, value in preserved_migrations.items():
        assert digest(DEV / name) == value, name
    upgrade_file = ROOT / 'docs/quality/managed-video-upgrade-review-02.json'
    upgrade = read(upgrade_file)
    assert upgrade['status'] == 'passed' and upgrade['published_migrations_preserved'] == 97
    assert upgrade['migration_test_assertions']['only_final_version_assertions_changed'] == 2
    assert upgrade['migration_test_assertions']['other_test_bytes_changed'] is False
    assert upgrade['verifier_sha256'] == digest(ROOT / 'docs/tools/review_managed_video_upgrade_current.py')
    media_review_file = ROOT / 'docs/quality/managed-video-media-review.json'
    media_review = read(media_review_file)
    assert media_review['status'] == 'passed' and media_review['raw_media_modified'] is False
    assert media_review['source_sha256'] == digest(DELIVERY / selected['admin_ui'])
    assert media_review['verifier_sha256'] == digest(ROOT / 'docs/tools/inspect_managed_video_media.py')
    preserved_clients = []
    for component in ['web', 'desktop', 'extension']:
        files = {name: value for name, value in baseline['source_files'].items() if name.startswith('copypaste-' + component + '/')}
        assert files
        for name, value in files.items():
            assert digest(DEV / name) == value, name
        preserved_clients.append({'component': component, 'unchanged_bound_sources': len(files),
            'scope': 'Client source bytes retain the prior stage-80 qualification. Historical client UI captures are not relabeled as a new full-stack UI run.'})
    authoritative = ROOT / 'docs/contracts/openapi.json'
    runtime = DEV / 'copypaste-platform/catalog/openapi.json'
    assert digest(authoritative) == '51dd90f26137798dd23c4e881b7f9f0b20f99ad4b9fee0cce98686e11873aab4'
    assert digest(runtime) == '7ce0b4cb170cdebc07aa4ee8f8810f24dbf996d95128519da184d7b2eb62156b'
    media = journey['screenshots'] + [file for recording in journey['media'] for file in recording['files']]
    docs_media = []
    for item in media:
        source = DEV / item['path']
        assert source.resolve().is_relative_to(DEV / 'copypaste-admin/assets/screenshots') and digest(source) == item['sha256']
        target = ROOT / 'docs/design/implementation' / ('copypaste-admin__' + source.name)
        assert not target.exists()
        target.write_bytes(source.read_bytes())
        docs_media.append({'source': item['path'], 'path': target.relative_to(ROOT).as_posix(), 'sha256': item['sha256']})
    result = {'at': datetime.now(timezone.utc).isoformat(), 'stage': 81, 'status': 'verified_managed_video_subflow',
        'scope': 'Immutable video capability drafts, bounded platform-funded asynchronous verification, original-operation recovery, current costs, independent publication and rollback. Internal service and video content are explicit synthetic fixtures.',
        'selected': selected, 'qualification_scopes': scopes, 'source_files': dict(sorted(sources.items())),
        'platform_tests': full['counts'], 'previous_platform_cases_preserved': 912, 'platform_files': len(plan['files']), 'platform_batches': len(plan['batches']),
        'compatibility_tests': compatibility['counts'], 'contract_checks': len(reports['contract']['checks']), 'admin_ui_checks': len(journey['checks']),
        'screenshots': journey['screenshots'], 'recordings': journey['media'], 'documentation_media': docs_media,
        'preserved_published_migrations': {'count': 97, 'baseline': 'docs/quality/generated-video-checkpoint.json', 'baseline_sha256': digest(ROOT / 'docs/quality/generated-video-checkpoint.json')},
        'upgrade_review': {'path': upgrade_file.relative_to(ROOT).as_posix(), 'sha256': digest(upgrade_file)},
        'harness_repair_review': {'path': repair_file.relative_to(ROOT).as_posix(), 'sha256': digest(repair_file)},
        'media_review': {'path': media_review_file.relative_to(ROOT).as_posix(), 'sha256': digest(media_review_file)},
        'visual_review': {'path': 'docs/quality/managed-video-visual-review.md', 'sha256': digest(ROOT / 'docs/quality/managed-video-visual-review.md')},
        'preserved_client_sources': preserved_clients, 'route_inventory': {'path': route_file.relative_to(ROOT).as_posix(), 'sha256': digest(route_file)},
        'original_acceptance': {'requirements': 102, 'cases': 102, 'partially_verified': 83, 'not_proven': 19, 'fully_accepted': 0, 'gates_G01_G10': 'not_proven'},
        'not_validated': ['live_company_video_service', 'complete_original_video_and_marketing_requirement', 'all_professional_roles', 'signed_installers', 'complete_Codex_Desktop_parity', 'production_readiness'],
        'verifier_sha256': digest(Path(__file__))}
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': result['status'], 'sources': len(sources), 'platform_tests': full['counts']['tests'], 'screenshots': len(journey['screenshots']), 'recordings': len(journey['media'])}))


if __name__ == '__main__':
    main()
