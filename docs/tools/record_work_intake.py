"""Bind current first-work UI and client evidence, preserving original full-product scope."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import re

from record_folder_work import ROOT, DEV, DELIVERY, read, digest, ref, source, passing
from audit_folder_work_docs import FIELDS


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ui', required=True)
    parser.add_argument('--clients', required=True)
    args = parser.parse_args()
    assert all(re.fullmatch(r'\d{2}', v) for v in vars(args).values())
    output = ROOT / 'docs/quality/work-intake-checkpoint.json'
    assert not output.exists(), 'Preserve all original qualification records'
    selected = {'ui': f'evidence/work-intake-ui-{args.ui}.json', 'clients': f'evidence/history-source-clients-{args.clients}.json'}
    reports = {key: read(DELIVERY / name) for key, name in selected.items()}
    sources, scopes = {}, []
    for key, report in reports.items():
        assert report['status'] == 'passed' and report['source_unchanged'], key
        for name, expected in report['source_files'].items():
            file = source(name)
            assert digest(file) == expected, (key, name)
            normalized = file.relative_to(ROOT).as_posix()
            assert normalized not in sources or sources[normalized] == expected
            sources[normalized] = expected
        scopes.append({'scope': key, 'report': selected[key], 'sha256': digest(DELIVERY / selected[key]), 'source_files': len(report['source_files']), 'all_recorded_sources_exact': True})
    ui = reports['ui']
    assert ui['compiled_unchanged'] and ui['owned_database_shutdown'] and ui['owned_previews_closed']
    assert ui['fixture_cleanup']['status'] == 'passed' and all(row['reclaimed'] for row in ui['fixture_cleanup']['results'])
    journey = ui['journey']
    assert journey['status'] == 'passed' and not journey['errors']
    assert len(journey['checks']) == 14 and all(name.startswith(f'INTAKE-{i:02} ') for i, name in enumerate(journey['checks'], 1))
    assert journey['browser_closed'] and journey['api_closed'] and journey['fixture_closed']
    assert journey['recovery']['exact_retry'] and journey['recovery']['task_count'] == journey['recovery']['reservation_count'] == 1
    assert journey['requests'][0] == journey['requests'][1] and len(journey['requests']) == 2
    assert journey['outputs']['runtime_calls'] == 1 and journey['outputs']['charged_micros'] == '30'
    assert journey['outputs']['controlled_runtime'] and journey['outputs']['native_codex_not_exercised_here']
    assert journey['late']['no_cross_project_navigation'] and journey['funding']['no_direct_wallet_mutation']
    for item in journey['screenshots']:
        assert digest(DEV / item['path']) == item['sha256'] and item['edited'] is False
    assert len(journey['screenshots']) == 12 and len(journey['media']) == 2
    for recording in journey['media']:
        assert recording['skipped_capture_errors'] == 0 and recording['distinct_frames'] > 1
        assert {Path(item['path']).suffix for item in recording['files']} == {'.gif', '.mp4'}
        for item in recording['files']: assert digest(DEV / item['path']) == item['sha256']
    units = 0
    for check in reports['clients']['checks']:
        assert check['exit_code'] == 0
        if check.get('counts'):
            passing(check['counts']); units += check['counts']['tests']
    assert units >= 195
    archive = ROOT / 'docs/quality/history/stage89-before-work-intake/receipt.json'
    for item in read(archive)['files']: assert digest(ROOT / item['archive']) == item['sha256']
    baseline = read(ROOT / 'docs/quality/history/stage87-before-folder-work/receipt.json')
    for field, count in [('published_migrations', 103), ('published_contracts', 532)]:
        assert len(baseline[field]) == count
        for name, expected in baseline[field].items(): assert digest(ROOT / name) == expected, name
    progress = read(ROOT / 'docs/quality/requirements-alignment-progress.json')
    assert [{key: row[key] for key in FIELDS} for row in progress['requirements']] == baseline['original_requirements']
    assert dict(Counter(row['assessment'] for row in progress['requirements'])) == {'partial_verified': 86, 'completion_not_proven': 16}
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    previous = ROOT / 'docs/quality/local-programs-checkpoint.json'
    prior = read(previous)
    retained = {name: expected for name, expected in prior['source_files'].items() if name.startswith('dev/copypaste-desktop/')}
    assert retained and all(digest(ROOT / name) == expected for name, expected in retained.items())
    result = {'at': datetime.now(timezone.utc).isoformat(), 'stage': 89, 'status': 'verified_scoped_web_intake_and_submission_recovery',
              'scope': 'Web first-work creation and tab-scoped recovery; actual native database, HTTP, Admin funding, Worker delivery and private file bytes with an explicit synthetic runtime',
              'selected': selected, 'source_files': sources, 'qualification_scopes': scopes,
              'ui_checks': 14, 'client_unit_tests': units, 'client_checks': reports['clients']['checks'],
              'recovery': journey['recovery'], 'late_response': journey['late'], 'funding': journey['funding'], 'output': journey['outputs'],
              'screenshots': journey['screenshots'], 'recordings': journey['media'],
              'raw_evidence': [ref(DELIVERY / (f'evidence/work-intake-ui-{args.ui}' + suffix)) for suffix in ['.json', '.log', '-journey.json', '-verifier.mjs', '-journey-verifier.ts', '-fixture-cleanup.json']]
                  + [ref(DELIVERY / f'evidence/history-source-clients-{args.clients}.json')],
              'preserved_baseline': ref(archive), 'retained_desktop_product_sources': {'checkpoint': ref(previous), 'unchanged_files': len(retained), 'scope': 'Historical stage88 native checks; Desktop product source unchanged, full cross-repository snapshot not reused as current'},
              'acceptance': {'original_requirement_records_unchanged': 102, 'partial': 86, 'completion_not_proven': 16, 'fully_accepted': 0, 'qualified_roles': 0, 'G01_G10': 'not_proven'},
              'limitations': ['other login, invitation, SSO and installed-client matrices', 'browser tab loss or cleared session storage and cross-browser recovery', 'full ongoing conversation and unknown external-tool recovery', 'all professional role and actual provider/customer quality', 'full Admin, releases, performance and disaster recovery', 'all original 102 complete cases and G01-G10'],
              'verifier_sha256': digest(Path(__file__))}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': result['status'], 'sources': len(sources), 'ui_checks': 14, 'client_tests': units, 'screenshots': 12, 'recordings': 2}))


if __name__ == '__main__': main()
