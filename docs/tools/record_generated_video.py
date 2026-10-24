"""Qualify generated-video delivery from bounded, actual execution receipts."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

from record_business_quality import unchanged_published_contract
from record_desktop_browser import batch_cases
from refresh_generated_video_migration_assertions import transform as refresh_migration_assertions
from refresh_generated_video_skill_assertions import transform as refresh_skill_assertions

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
OUTPUT = ROOT / 'docs/quality/generated-video-checkpoint.json'


def read(file):
    return json.loads(file.read_text(encoding='utf-8'))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def bound(item):
    file = (DELIVERY / item['path']).resolve()
    assert file.is_relative_to(DELIVERY) and digest(file) == item['sha256'], item
    return file


def dependencies(names):
    """Conservatively retain every local import of the selected UI verifier."""
    found = set()
    pending = list(names)
    while pending:
        name = pending.pop()
        if name in found:
            continue
        file = (DELIVERY / name).resolve()
        assert file.is_relative_to(DELIVERY) and file.is_file(), name
        found.add(file.relative_to(DELIVERY).as_posix())
        for relative in re.findall(r'''(?:from\s*|import\s*\()?["'](\.[^"']+)["']''', file.read_text(encoding='utf-8')):
            target = file.parent / relative
            candidates = [target, target.with_suffix('.ts')] if target.suffix else [target.with_suffix(suffix) for suffix in ['.ts', '.tsx', '.mjs', '.js']]
            actual = next((item.resolve() for item in candidates if item.is_file()), None)
            if actual:
                assert actual.is_relative_to(DEV)
                if actual.is_relative_to(DELIVERY):
                    pending.append(actual.relative_to(DELIVERY).as_posix())
    return found


def main():
    parser = argparse.ArgumentParser()
    for name, default in [('control', '28'), ('desktop', '38'), ('ui', '08'), ('extension', '16'), ('native', '24'), ('focused', '11')]:
        parser.add_argument('--' + name, default=default)
    args = vars(parser.parse_args())
    assert all(re.fullmatch(r'\d{2}', value) for value in args.values())
    assert not OUTPUT.exists(), 'Do not replace an earlier checkpoint'
    selected = {
        'platform': f"evidence/desktop-execution-control-{args['control']}.json",
        'desktop': f"evidence/desktop-local-ui-{args['desktop']}.json",
        'web_admin': f"evidence/generated-video-ui-{args['ui']}.json",
        'extension': f"evidence/extension-chat-{args['extension']}.json",
        'native_supervisor': f"evidence/local-codex-native-{args['native']}.json",
        'focused': f"evidence/generated-video-{args['focused']}.json",
    }
    reports = {key: read(DELIVERY / name) for key, name in selected.items()}
    critical = {
        'desktop': dependencies(['scripts/run-desktop-local-ui.mjs', 'scripts/qa-desktop-local.ts']),
        'web_admin': dependencies(['scripts/run-generated-video-ui.mjs', 'scripts/qa-generated-video-ui.ts']),
        'extension': dependencies(['scripts/run-extension-chat.mjs', 'scripts/qa-extension-chat.ts']),
        'focused': dependencies(['scripts/run-generated-video-checks.mjs']),
        'platform': dependencies(['scripts/run-desktop-platform-resumable.mjs']),
    }
    sources, scopes = {}, []
    for key, report in reports.items():
        assert report['status'] == 'passed' and report['source_unchanged'], key
        if 'owned_database_shutdown' in report:
            assert report['owned_database_shutdown'], key
        for field in ['raw_report', 'raw_log', 'verifier', 'journey_verifier']:
            item = report.get(field)
            if isinstance(item, dict):
                bound(item)
        if isinstance(report.get('raw_report'), str):
            assert digest(DELIVERY / report['raw_report']) == report['raw_sha256']
        entries = report['source_files']
        if key == 'native_supervisor':
            entries = {'copypaste-desktop/' + name: value for name, value in entries.items()}
        differences = []
        for name, checksum in entries.items():
            current = digest(DEV / name)
            if current != checksum:
                assert key != 'platform', (key, name, 'Full current qualification cannot have later changes')
                if name.startswith('copypaste-delivery/scripts/'):
                    local = name.removeprefix('copypaste-delivery/')
                    assert local not in critical.get(key, set()), (key, name, 'Actual journey or imported verifier changed')
                    reason = 'Unrelated unused delivery harness changed later; this application, actual journey and all recursively imported local helpers retain their executed bytes. Full platform qualification covers the final shared inventory.'
                elif name == 'copypaste-platform/tests/skill-lifecycle.test.ts':
                    assert key == 'focused' and 'tests/skill-lifecycle.test.ts' not in report['files']
                    refresh = read(ROOT / 'docs/quality/generated-video-skill-inventory-refresh.json')
                    archived = ROOT / refresh['archive']
                    assert archived.resolve().is_relative_to(ROOT / 'docs/quality/history/before-stage80-skill-count')
                    assert digest(ROOT / 'docs/tools/refresh_generated_video_skill_assertions.py') == refresh['verifier_sha256']
                    assert refresh['path'] == name and refresh['before_sha256'] == checksum and refresh['after_sha256'] == current
                    assert digest(archived) == checksum and refresh_skill_assertions(archived.read_bytes()) == (DEV / name).read_bytes()
                    reason = 'The unused Skill lifecycle test now asserts 30 immutable versions, 29 logical Skills and preservation of both video versions. The focused video/gateway run did not execute this file; its application, selected tests and actual verifier retain their executed bytes. The fresh full platform run executes the final inventory.'
                elif name == 'copypaste-platform/tests/migrations.test.ts':
                    assert key in ['desktop', 'web_admin', 'extension', 'focused']
                    refresh = read(ROOT / 'docs/quality/generated-video-test-inventory-refresh.json')
                    assert digest(ROOT / 'docs/tools/refresh_generated_video_migration_assertions.py') == refresh['verifier_sha256']
                    archived = ROOT / refresh['archive']
                    assert archived.resolve().is_relative_to(ROOT / 'docs/quality/history/before-stage80-migration-count')
                    assert refresh['path'] == name and refresh['before_sha256'] == checksum and refresh['after_sha256'] == current
                    assert digest(archived) == checksum
                    assert refresh_migration_assertions(archived.read_bytes()) == (DEV / name).read_bytes()
                    reason = 'Only two final migration-version assertions in an unused platform test changed from 96 to 97. This journey does not execute that test; all of its runtime, selected tests and imported helpers retain their executed bytes. The fresh full platform qualification executes the corrected file with no later differences.'
                else:
                    assert name == 'copypaste-platform/contracts/implemented-routes.json'
                    inventory = read(ROOT / 'docs/quality/generated-video-route-inventory.json')
                    assert inventory['before_sha256'] == checksum and inventory['after_sha256'] == current
                    reason = 'Only the descriptive method/path inventory was refreshed from the actual passing configured-service app; executable source is unchanged.'
                differences.append({'path': name, 'executed_sha256': checksum, 'current_sha256': current, 'reason': reason})
            assert name not in sources or sources[name] == current
            sources[name] = current
        scopes.append({'scope': key, 'report': selected[key], 'sha256': digest(DELIVERY / selected[key]),
                       'source_files': len(entries), 'later_unrelated_differences': differences})

    full = reports['platform']
    index = read(bound(full['raw_report']))
    plan = read(bound(index['plan']))
    review_file = ROOT / 'docs/quality/generated-video-platform-requalification.json'
    review = read(review_file)
    assert full['execution_strategy'] == index['execution_strategy'] == 'reviewed_identical_source_batch_requalification'
    assert full['reviewed_requalification'] == index['review'] == {'path': review_file.relative_to(ROOT).as_posix(), 'sha256': digest(review_file)}
    assert review['status'] == 'reviewed_exact_source_requalification'
    assert not review['failed_attempt_counted_as_passed'] and not review['original_tap_or_plan_modified']
    assert review['unchanged_complete_source_fingerprint'] == full['source_fingerprint']
    assert digest(ROOT / review['verifier']['path']) == review['verifier']['sha256'] == digest(bound(full['verifier']))
    for dependency in review['verifier_dependencies']:
        assert digest(ROOT / dependency['path']) == dependency['sha256']
    failed = read(bound(review['failed_receipt']))
    assert failed['status'] == 'failed' and failed['counts']['fail'] == 1
    assert digest(bound(failed['raw_report'])) == review['failed_raw_report']['sha256']
    assert read(bound(review['failed_cleanup']))['status'] == 'passed'
    for selected_batch in index['batches']:
        row = read(bound(selected_batch))
        original_plan_file = bound(selected_batch['qualification_plan'])
        original_plan = read(original_plan_file)
        assert row['plan_sha256'] == digest(original_plan_file)
        assert original_plan['files'] == plan['files'] and original_plan['batches'] == plan['batches']
        assert original_plan['source_files'] == plan['source_files']
        assert original_plan['native_binary'] == plan['native_binary']
        assert original_plan['source_fingerprint'] == full['source_fingerprint']
    prior = read(DELIVERY / 'evidence/desktop-execution-control-23.json')
    original = batch_cases(read(bound(prior['raw_report'])))
    actual = batch_cases(index)
    assert sum(original.values()) == 874 and not original - actual
    assert actual['the built-in demo gateway withdraws inherited video verification without changing the source configuration'] == 1
    assert sum(actual.values()) == full['counts']['tests'] == full['counts']['pass']
    assert all(full['counts'][name] == 0 for name in ['fail', 'cancelled', 'skipped', 'todo'])
    assert {'tests/generated-video-jobs.test.ts', 'tests/video-job-protocol.test.ts'} <= set(plan['files'])
    assert reports['focused']['counts']['tests'] == reports['focused']['counts']['pass'] == 60
    assert reports['native_supervisor']['counts']['tests'] == reports['native_supervisor']['counts']['pass'] == 17
    native_verifier = DELIVERY / f"evidence/local-codex-native-{args['native']}-verifier.mjs"
    assert digest(native_verifier) == reports['native_supervisor']['verifier_sha256']
    assert digest(native_verifier) == digest(DELIVERY / 'scripts/run-local-codex-checks.mjs')

    desktop = read(bound(reports['desktop']['journey']))
    extension = read(bound(reports['extension']['journey']))
    ui = reports['web_admin']['journey']
    assert len(desktop['checks']) == 32 and len(extension['checks']) == 9 and len(ui['checks']) == 5
    desktop_raw = bound(reports['desktop']['raw_report']).read_text(encoding='utf-8')
    assert re.search(r'^# tests 69\r?$', desktop_raw, re.M)
    assert re.search(r'^# pass 69\r?$', desktop_raw, re.M)
    assert 'a completed workflow child stops its heartbeat before native shutdown and terminal settlement' in desktop_raw
    for journey in [desktop, extension, ui]:
        assert journey['status'] == 'passed' and not journey['errors']
        assert all(journey[name] for name in ['browser_closed', 'api_closed', 'fixture_closed'])
    assert desktop['electron_closed'] and desktop['generated_video_fixture_closed']
    assert ui['provider_closed'] and extension['generated_video_provider_closed']
    assert reports['desktop']['owned_preview_closed'] and reports['extension']['owned_preview_closed']
    assert reports['web_admin']['compiled_unchanged'] and reports['web_admin']['owned_previews_closed']
    assert reports['extension']['compiled_unchanged']
    assert {item['tool'] for item in desktop['native_generated_video_tool_results'] if item['actual_output']} >= {'generated_video_create', 'generated_video_status'}
    for key, runner, journey in [('desktop', 'run-desktop-local-ui.mjs', 'qa-desktop-local.ts'), ('extension', 'run-extension-chat.mjs', 'qa-extension-chat.ts')]:
        assert digest(bound(reports[key]['verifier'])) == digest(DELIVERY / 'scripts' / runner)
        assert digest(bound(reports[key]['journey_verifier'])) == digest(DELIVERY / 'scripts' / journey)
    ui_prefix = selected['web_admin'][:-5]
    assert read(DELIVERY / (ui_prefix + '-journey.json')) == ui
    assert digest(DELIVERY / (ui_prefix + '-verifier.mjs')) == digest(DELIVERY / 'scripts/run-generated-video-ui.mjs')
    assert digest(DELIVERY / (ui_prefix + '-journey-verifier.ts')) == digest(DELIVERY / 'scripts/qa-generated-video-ui.ts')

    packaged = reports['desktop']['packaged']
    candidate = (DELIVERY / packaged['executable']).resolve()
    assert candidate.is_relative_to(DEV / 'copypaste-desktop/.data/local-candidates') and candidate.is_file()
    assert digest(candidate.parent / 'resources/app.asar') == packaged['app_asar_sha256']
    assert digest(candidate.parent / 'resources/local-codex/codex.exe') == packaged['native_binary_sha256']
    screenshots = desktop['screenshots'] + ui['screenshots'] + extension['screenshots']
    recordings = [desktop['media'], desktop['native_browser_media'], desktop['brand_library_media'], *ui['media'], extension['media']]
    normalization_file = ROOT / 'docs/quality/generated-video-media-normalization.json'
    normalization = read(normalization_file)
    assert normalization['status'] == 'passed' and normalization['raw_evidence_modified'] is False
    assert digest(ROOT / normalization['verifier']['path']) == normalization['verifier']['sha256']
    assert normalization['source_journey'] == reports['desktop']['journey']
    for key in ['mp4', 'original_gif', 'derived_gif']:
        assert digest(DEV / normalization[key]['path']) == normalization[key]['sha256']
    recordings = json.loads(json.dumps(recordings))
    native_recording = next(item for item in recordings if item['component'] == 'desktop' and item['name'] == 'native-browser')
    assert normalization['original_gif']['path'] in {item['path'] for item in native_recording['files']}
    native_recording['files'] = [
        {key: normalization['derived_gif'][key] for key in ['path', 'bytes', 'sha256']}
        if item['path'] == normalization['original_gif']['path'] else item for item in native_recording['files']]
    native_recording['derived_gif_timing_receipt'] = {'path': normalization_file.relative_to(ROOT).as_posix(), 'sha256': digest(normalization_file)}
    copied = []
    for item in screenshots + [file for recording in recordings for file in recording['files']]:
        source = DEV / item['path']
        assert digest(source) == item['sha256']
        if item in screenshots:
            assert not item['edited']
        target = ROOT / 'docs/design/implementation' / (Path(item['path']).parts[0] + '__' + source.name)
        if target.exists():
            assert target.read_bytes() == source.read_bytes()
        else:
            target.write_bytes(source.read_bytes())
        copied.append({'source': item['path'], 'path': target.relative_to(ROOT).as_posix(), 'sha256': digest(target), 'edited': False})
    assert all(item['skipped_capture_errors'] == 0 and item['distinct_frames'] > 1 for item in recordings)
    media_probes = []
    for recording in recordings:
        for item in recording['files']:
            file = DEV / item['path']
            probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
                'format=duration:stream=codec_name,nb_frames', '-of', 'json', str(file)], timeout=45))
            assert len(probe['streams']) == 1
            stream = probe['streams'][0]
            assert stream['codec_name'] == ('gif' if file.suffix == '.gif' else 'h264')
            seconds = float(probe['format']['duration'])
            assert abs(seconds - recording['seconds']) < 0.35, item['path']
            assert int(stream['nb_frames']) > 1
            media_probes.append({'path': item['path'], 'sha256': item['sha256'], 'seconds': seconds,
                                 'codec': stream['codec_name'], 'frames': int(stream['nb_frames'])})
    migrations = {name: value for name, value in prior['source_files'].items() if name.startswith('copypaste-platform/migrations/') and name.endswith('.sql')}
    assert len(migrations) == 96 and all(digest(DEV / name) == value for name, value in migrations.items())
    contract = ROOT / 'docs/contracts/generated-video-openapi.json'
    assert digest(contract) == digest(DEV / 'copypaste-platform/contracts/generated-video-openapi.json')
    assert sum(method in ['get', 'post', 'put', 'delete', 'patch'] for item in read(contract)['paths'].values() for method in item) == 7
    inventory = read(DEV / 'copypaste-platform/contracts/implemented-routes.json')
    assert len(inventory['routes']) == 445 and len(inventory['conditional_routes']) == 1
    result = {
        'at': datetime.now(timezone.utc).isoformat(), 'stage': 80, 'status': 'verified_generated_video_subflow',
        'scope': 'Durable company-video-jobs-v1 operation, shared task budget, authenticated observations, cancellation/reconciliation, actual MP4 validation and Web/Admin/native Desktop/native Side Panel review. Model, media content and customer data are explicit fixtures.',
        'selected': selected, 'qualification_scopes': scopes, 'source_files': sources,
        'platform_tests': full['counts'], 'focused_tests': reports['focused']['counts'], 'native_supervisor_tests': reports['native_supervisor']['counts'],
        'client_unit_tests': 69, 'packaged_desktop_checks': 32, 'web_admin_checks': 5, 'extension_checks': 9,
        'recording_probes': media_probes,
        'recording_normalization': {'path': normalization_file.relative_to(ROOT).as_posix(), 'sha256': digest(normalization_file)},
        'inventory': {'files': len(plan['files']), 'batches': len(plan['batches']), 'index': full['raw_report'], 'plan': index['plan']},
        'reviewed_platform_requalification': {'path': review_file.relative_to(ROOT).as_posix(), 'sha256': digest(review_file)},
        'original_regression': {'previous_cases_preserved': 874, 'new_cases': sum(actual.values()) - 874},
        'migration_integrity': {'001_through_096': 'All 96 exact working-byte hashes match the published stage-79 qualification', 'new': '097-generated-video-jobs.sql'},
        'migration_test_inventory_refresh': {'path': 'docs/quality/generated-video-test-inventory-refresh.json', 'sha256': digest(ROOT / 'docs/quality/generated-video-test-inventory-refresh.json')},
        'skill_test_inventory_refresh': {'path': 'docs/quality/generated-video-skill-inventory-refresh.json', 'sha256': digest(ROOT / 'docs/quality/generated-video-skill-inventory-refresh.json')},
        'original_contracts': {'authoritative': unchanged_published_contract(ROOT, 'docs/contracts/openapi.json'), 'runtime_catalog': unchanged_published_contract(DEV / 'copypaste-platform', 'catalog/openapi.json'), 'relationship': 'Each original independently retains its own earlier bytes.'},
        'additive_contract_sha256': digest(contract), 'http_routes': {'configured_service': 445, 'demo_mode_only_additional': 1, 'new_generated_video_operations': 7},
        'packaged': packaged, 'screenshots': screenshots, 'recordings': recordings, 'documentation_media': copied,
        'original_acceptance': {'requirements': 102, 'acceptance_cases': 102, 'partial': 83, 'unproven': 19, 'fully_accepted': 0, 'G01_G10': 'not_proven'},
        'limits': ['The live company video provider and actual customer business delivery are not qualified.', 'The Web and Side Panel UI use an explicit reasoning substitute; this is not proof of a live cloud Codex run.', 'Actual native Codex is exercised in the native tool and packaged Desktop journeys; native consent decisions in the packaged fixture are explicit substitutes.', 'Full controlled video capability verification/publish administration and all video role/format acceptance remain unproven.', 'TC-019, TC-056, complete OS/Codex Desktop parity, production installation/signing and all original gates remain open.'],
        'visual_review_record': {'path': 'docs/quality/generated-video-visual-review.md', 'sha256': digest(ROOT / 'docs/quality/generated-video-visual-review.md')},
        'verifier_sha256': digest(Path(__file__)),
    }
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': result['status'], 'sources': len(sources), 'tests': full['counts']['tests'], 'screenshots': len(screenshots), 'recordings': len(recordings)}))


if __name__ == '__main__':
    main()
