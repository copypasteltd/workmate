"""Bind the bounded brand-production repair to actual unchanged execution evidence."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re

from record_business_quality import unchanged_published_contract
from record_desktop_browser import batch_cases

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
OUTPUT = ROOT / 'docs/quality/brand-production-checkpoint.json'


def read(file):
    return json.loads(file.read_text(encoding='utf-8'))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def bound(item):
    file = (DELIVERY / item['path']).resolve()
    assert file.is_relative_to(DELIVERY) and digest(file) == item['sha256'], item['path']
    return file


def inline_journey(report, prefix, runner, journey):
    assert read(DELIVERY / (prefix + '-journey.json')) == report['journey']
    assert digest(DELIVERY / (prefix + '-verifier.mjs')) == digest(DELIVERY / runner)
    assert digest(DELIVERY / (prefix + '-journey-verifier.ts')) == digest(DELIVERY / journey)
    assert report['compiled_unchanged'] and report['owned_previews_closed']
    assert all(report['journey'][name] for name in ['browser_closed', 'api_closed', 'fixture_closed'])
    return report['journey']


def main():
    parser = argparse.ArgumentParser()
    for name, default in [('control', '23'), ('desktop', '33'), ('brand', '02'),
                          ('quality', '08'), ('extension', '09'), ('native', '22')]:
        parser.add_argument('--' + name, default=default)
    args = vars(parser.parse_args())
    assert all(re.fullmatch(r'\d{2}', value) for value in args.values())
    assert not OUTPUT.exists(), 'Never replace an earlier checkpoint'
    files = {
        'platform': f"evidence/desktop-execution-control-{args['control']}.json",
        'desktop': f"evidence/desktop-local-ui-{args['desktop']}.json",
        'brand_web': f"evidence/brand-library-ui-{args['brand']}.json",
        'web_admin': f"evidence/quality-ui-{args['quality']}.json",
        'extension': f"evidence/extension-chat-{args['extension']}.json",
        'native_supervisor': f"evidence/local-codex-native-{args['native']}.json",
    }
    reports = {key: read(DELIVERY / file) for key, file in files.items()}
    refresh_path = ROOT / 'docs/quality/brand-production-extension-readiness-refresh.json'
    refresh = read(refresh_path)
    assert digest(ROOT / refresh['archive']) == refresh['before_sha256']
    assert digest(DEV / refresh['path']) == refresh['after_sha256']
    sources, scopes = {}, []
    for key, report in reports.items():
        assert report['status'] == 'passed' and report['source_unchanged'], key
        if 'owned_database_shutdown' in report:
            assert report['owned_database_shutdown'], key
        for field in ['raw_report', 'raw_log', 'verifier', 'journey_verifier']:
            if isinstance(report.get(field), dict):
                bound(report[field])
        if isinstance(report.get('raw_report'), str):
            assert digest(DELIVERY / report['raw_report']) == report['raw_sha256']
        entries = report['source_files']
        if key == 'native_supervisor':
            entries = {'copypaste-desktop/' + name: value for name, value in entries.items()}
        differences = []
        for name, checksum in entries.items():
            current = digest(DEV / name)
            if current != checksum:
                assert key in ['desktop', 'brand_web', 'web_admin'] and name == refresh['path'], (key, name)
                assert checksum == refresh['before_sha256'] and current == refresh['after_sha256']
                differences.append({'path': name, 'executed_sha256': checksum, 'current_sha256': current,
                                    'reason': 'Only the unrelated, unused extension journey harness changed after execution; application/UI and these journeys/verifiers are unchanged. Fresh extension execution and full current-source qualification use the updated harness.',
                                    'review': refresh_path.relative_to(ROOT).as_posix()})
            assert name not in sources or sources[name] == current
            sources[name] = current
        scopes.append({'scope': key, 'report': files[key], 'sha256': digest(DELIVERY / files[key]),
                       'source_files': len(entries), 'later_source_differences': differences,
                       'execution': 'retained native proof; all 57 bound sources unchanged' if key == 'native_supervisor'
                       else 'fresh stage-79 execution with one reviewed unrelated later test-harness change' if differences
                       else 'fresh stage-79 execution'})

    full = reports['platform']
    index = read(bound(full['raw_report']))
    plan = read(bound(index['plan']))
    prior = read(DELIVERY / 'evidence/desktop-execution-control-21.json')
    old_cases = batch_cases(read(bound(prior['raw_report'])))
    current_cases = batch_cases(index)
    assert sum(old_cases.values()) == 861 and not old_cases - current_cases
    assert sum(current_cases.values()) == full['counts']['tests'] == full['counts']['pass'] == 874
    assert all(full['counts'][name] == 0 for name in ['fail', 'cancelled', 'skipped', 'todo'])
    assert len(plan['files']) == 68 and len(plan['batches']) == 17
    assert 'tests/brand-production.test.ts' in plan['files']

    desktop = reports['desktop']
    native = read(bound(desktop['journey']))
    assert native['status'] == 'passed' and len(native['checks']) == 30
    assert sum('brand ' in check for check in native['checks']) >= 3
    assert all(native[name] for name in ['electron_closed', 'browser_closed', 'api_closed',
                                        'fixture_closed', 'native_browser_fixture_closed'])
    assert desktop['owned_preview_closed']
    assert 68 in [int(value) for value in re.findall(r'^# tests (\d+)\r?$',
                  bound(desktop['raw_report']).read_text(encoding='utf-8'), re.M)]
    packaged = desktop['packaged']
    candidate = (DELIVERY / packaged['executable']).resolve()
    assert candidate.is_relative_to(DEV / 'copypaste-desktop/.data/local-candidates') and candidate.is_file()
    assert digest(candidate.parent / 'resources/app.asar') == packaged['app_asar_sha256']
    assert digest(candidate.parent / 'resources/local-codex/codex.exe') == packaged['native_binary_sha256']

    brand = inline_journey(reports['brand_web'], files['brand_web'][:-5],
                           'scripts/run-brand-library-ui.mjs', 'scripts/qa-brand-library-ui.ts')
    quality = inline_journey(reports['web_admin'], files['web_admin'][:-5],
                             'scripts/run-quality-ui.mjs', 'scripts/qa-quality-ui.ts')
    extension = read(bound(reports['extension']['journey']))
    assert len(brand['checks']) == 4 and len(brand['media']) == 1 and not brand['errors']
    assert len(quality['checks']) == 4 and len(quality['media']) == 2 and not quality['errors']
    assert extension['status'] == 'passed' and len(extension['checks']) == 8 and not extension['errors']
    assert all(extension[name] for name in ['browser_closed', 'api_closed', 'fixture_closed'])
    assert reports['extension']['owned_preview_closed'] and reports['extension']['compiled_unchanged']
    assert len(reports['native_supervisor']['source_files']) == 57
    assert reports['native_supervisor']['counts']['tests'] == reports['native_supervisor']['counts']['pass'] == 17
    screenshots = native['screenshots'] + brand['screenshots'] + quality['screenshots'] + extension['screenshots']
    recordings = [native['media'], native['native_browser_media'], native['brand_library_media'],
                  *brand['media'], *quality['media'], extension['media']]
    copied = []
    for item in screenshots + [file for recording in recordings for file in recording['files']]:
        source = DEV / item['path']
        assert digest(source) == item['sha256']
        if item in screenshots:
            assert not item['edited']
        target = ROOT / 'docs/design/implementation' / (Path(item['path']).parts[0] + '__' + source.name)
        if target.exists():
            assert target.read_bytes() == source.read_bytes(), 'Do not overwrite previous media'
        else:
            target.write_bytes(source.read_bytes())
        copied.append({'source': item['path'], 'path': target.relative_to(ROOT).as_posix(),
                       'sha256': digest(target), 'edited': False})
    for recording in recordings:
        assert recording['skipped_capture_errors'] == 0 and recording['distinct_frames'] > 1

    prior_migrations = {name: checksum for name, checksum in prior['source_files'].items()
                        if name.startswith('copypaste-platform/migrations/') and name.endswith('.sql')}
    assert len(prior_migrations) == 95
    assert all(digest(DEV / name) == checksum for name, checksum in prior_migrations.items())
    original_contracts = {
        'authoritative': unchanged_published_contract(ROOT, 'docs/contracts/openapi.json'),
        'runtime_catalog': unchanged_published_contract(DEV / 'copypaste-platform', 'catalog/openapi.json'),
        'relationship': 'Each preserves its own earlier bytes; the pre-existing two files are not asserted equal.'}
    contract = ROOT / 'docs/contracts/brand-production-openapi.json'
    assert digest(contract) == digest(DEV / 'copypaste-platform/contracts/brand-production-openapi.json')
    assert sum(method in ['get', 'post', 'put', 'delete', 'patch']
               for item in read(contract)['paths'].values() for method in item) == 4
    inventory = read(DEV / 'copypaste-platform/contracts/implemented-routes.json')
    assert len(inventory['routes']) == 438 and len(inventory['conditional_routes']) == 1
    progress = read(ROOT / 'docs/quality/requirements-alignment-progress.json')
    original_progress = read(ROOT / 'docs/quality/history/before-stage79-docs/docs/quality/requirements-alignment-progress.json')
    assert len(progress['requirements']) == 102 and progress['fully_accepted_requirements'] == 0
    for before, after in zip(original_progress['requirements'], progress['requirements'], strict=True):
        for field in ['requirement_id', 'requirement', 'acceptance_case', 'acceptance_conditions']:
            assert before[field] == after[field], (before['requirement_id'], field, 'Original acceptance definition changed')
    assert progress['summary'] == {'partial_verified': 82, 'completion_not_proven': 20}
    assert all(item['full_acceptance'] == 'not_proven' for item in progress['gates'])
    result = {
        'at': datetime.now(timezone.utc).isoformat(), 'stage': 79,
        'status': 'verified_fixed_brand_production_subflow',
        'scope': 'Immutable brand versions, frozen specialist/cloud design task, actual font/price/scope/expiry checks, provenance fences and real Web/native Desktop brand interfaces. Explicit model and customer/business fixtures.',
        'selected': files, 'qualification_scopes': scopes, 'source_files': sources,
        'platform_tests': full['counts'], 'client_unit_tests': 68, 'packaged_desktop_checks': 30,
        'brand_web_checks': 4, 'web_admin_checks': 4, 'extension_checks': 8,
        'native_supervisor_tests': reports['native_supervisor']['counts'],
        'inventory': {'files': 68, 'batches': 17, 'index': full['raw_report'], 'plan': index['plan']},
        'original_regression': {'previous_cases_preserved': 861, 'new_cases': 13},
        'migration_integrity': {'001_through_095': 'All 95 exact working-byte hashes match stage-78 execution21',
                                'new': '096-versioned-brand-production.sql'},
        'original_contracts': original_contracts, 'additive_contract_sha256': digest(contract),
        'http_routes': {'configured_service': 438, 'demo_mode_only_additional': 1, 'new_brand_operations': 4},
        'packaged': packaged, 'screenshots': screenshots, 'recordings': recordings,
        'documentation_media': copied,
        'original_acceptance': {'requirements': 102, 'acceptance_cases': 102, 'partial': 82,
                                'unproven': 20, 'fully_accepted': 0, 'G01_G10': 'not_proven',
                                'all_original_definition_fields_unchanged': True},
        'visual_review': {'web': 'Actual brand fact editor reviewed; CopyPaste blue, clear tabs and responsive field groups.',
                          'desktop': 'Actual packaged candidate; compact brand dialogs retain focus/navigation and hide vertical/horizontal scrollbar rails.'},
        'visual_review_record': {'path': 'docs/quality/brand-production-visual-review.md',
                                 'sha256': digest(ROOT / 'docs/quality/brand-production-visual-review.md')},
        'unrelated_harness_refresh': {'path': refresh_path.relative_to(ROOT).as_posix(), 'sha256': digest(refresh_path),
                                      'note': refresh['scope']},
        'limits': ['REQ-013/TC-013 full acceptance remains unproven; only the bounded described production chain is verified',
                   'Font rights are customer declarations; standalone Unicode cmap4/12 coverage is not all OpenType shaping or legal verification',
                   'All creative formats, semantic claim extraction, complete history pagination and real customer brand acceptance are not established',
                   'TC-056 representative real tasks, manual baselines and blind review remain unrun',
                   '18 role admissions / 29 Skills, live providers, complete OS/Codex Desktop parity and production gates remain unproven',
                   'The Desktop brand form is tested; this phase does not prove every local role automatically enforces cloud brand-render bindings'],
        'verifier_sha256': digest(Path(__file__)),
    }
    with OUTPUT.open('x', encoding='utf-8', newline='\n') as stream:
        stream.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': result['status'], 'sources': len(sources), 'platform_tests': 874,
                      'screenshots': len(screenshots), 'recordings': len(recordings)}))


if __name__ == '__main__':
    main()
