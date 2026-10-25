"""Bind exact current sources to actual persistent-team regression and UI evidence."""
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import argparse
import json
import re

from record_folder_work import ROOT, DEV, DELIVERY, digest, read, ref, source, passing


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--core', required=True)
    parser.add_argument('--ui', required=True)
    args = parser.parse_args()
    assert all(re.fullmatch(r'\d{2}', value) for value in vars(args).values())
    output = ROOT / 'docs/quality/agent-groups-checkpoint.json'
    assert not output.exists(), 'Preserve every original checkpoint'
    selected = {'core': f'evidence/agent-groups-core-{args.core}.json',
                'ui': f'evidence/agent-groups-ui-{args.ui}.json'}
    reports = {name: read(DELIVERY / file) for name, file in selected.items()}
    sources, scopes = {}, []
    for name, report in reports.items():
        assert report['status'] == 'passed' and report['source_unchanged'] and report['owned_database_shutdown'], name
        for path, expected in report['source_files'].items():
            file = source(path)
            assert digest(file) == expected, (name, path)
            normalized = file.relative_to(ROOT).as_posix()
            assert normalized not in sources or sources[normalized] == expected
            sources[normalized] = expected
        scopes.append({'scope': name, 'report': selected[name], 'sha256': digest(DELIVERY / selected[name]),
                       'source_files': len(report['source_files']), 'all_recorded_sources_exact': True})
    core, ui = reports['core'], reports['ui']
    passing(core['counts'])
    assert core['scope'] == 'full'
    assert set(core['test_files']) == {'tests/agent-groups.test.ts', 'tests/cloud-workflows.test.ts',
        'tests/project-configuration.test.ts', 'tests/task-history-sources.test.ts',
        'tests/editable-design-tools.test.ts', 'tests/agent-templates.test.ts',
        'tests/desktop-executions.test.ts', 'tests/persistent-work.test.ts'}
    assert digest(DELIVERY / core['raw_report']['path']) == core['raw_report']['sha256']
    raw = (DELIVERY / core['raw_report']['path']).read_text(encoding='utf-8')
    for value in ['scoped Admin content permissions', 'native retention scrubs only expired unused team reviews']:
        assert re.search(r'^ok \d+ - ' + re.escape(value), raw, re.M), value
    assert ui['compiled_unchanged'] and ui['owned_previews_closed']
    assert digest(DELIVERY / ui['raw_log']['path']) == ui['raw_log']['sha256']
    assert ui['fixture_cleanup']['status'] == 'passed'
    assert all(row['reclaimed'] for row in ui['fixture_cleanup']['results'])
    journey = ui['journey']
    assert journey['status'] == 'passed' and not journey['errors'] and len(journey['checks']) == 7
    assert all(value.startswith(f'TEAM-{i:02} ') for i, value in enumerate(journey['checks'], 1))
    assert all(journey[key] for key in ['browser_closed', 'api_closed', 'fixture_closed'])
    assert journey['funding']['no_direct_wallet_mutation']
    assert len(journey['executions']) == 3 and len(journey['output_files']) == 3
    assert [row['step_key'] for row in journey['executions']] == ['step_1', 'step_2', 'coordinator']
    for row in journey['executions']:
        assert row['native_codex'] and row['synthetic_model'] and row['reservation_count'] == 1
        assert int(row['charged_micros']) > 0
        assert {'group_results', 'deliver_text'}.issubset(row['observed_tools'])
    for row in journey['output_files']:
        assert int(row['bytes']) == row['actual_download_bytes'] > 0
        assert re.fullmatch(r'[a-f0-9]{64}', row['sha256'])
    assert len(journey['screenshots']) == 9 and len(journey['media']) == 2
    for row in journey['screenshots']:
        assert digest(DEV / row['path']) == row['sha256'] and row['edited'] is False
    for row in journey['media']:
        assert row['skipped_capture_errors'] == 0 and row['distinct_frames'] > 1
        assert {Path(item['path']).suffix for item in row['files']} == {'.gif', '.mp4'}
        for item in row['files']:
            assert digest(DEV / item['path']) == item['sha256']
    before = ROOT / 'docs/quality/history/stage93-before-agent-groups/receipt.json'
    baseline = read(before)
    assert len(baseline['published_files']) == 638
    for path, expected in baseline['published_files'].items():
        assert digest(ROOT / path) == expected, path
    for row in baseline['files']:
        assert digest(ROOT / row['archive']) == row['sha256'], row['archive']
    assert digest(ROOT / 'docs/contracts/role-preset-catalog-current.json') == baseline['protected_role_catalog_sha256']
    progress = read(ROOT / 'docs/quality/requirements-alignment-progress.json')
    prior_progress = read(ROOT / next(row['archive'] for row in baseline['files'] if row['path'] == 'docs/quality/requirements-alignment-progress.json'))
    assert progress['requirements'] == baseline['requirements'] and len(progress['requirements']) == 102
    assert progress['gates'] == prior_progress['gates']
    assert dict(Counter(row['assessment'] for row in progress['requirements'])) == {'partial_verified': 86, 'completion_not_proven': 16}
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    prior = []
    for folder in [DELIVERY / 'evidence', DEV / 'copypaste-platform/evidence']:
        for pattern in ['agent-groups-core-*.json', 'agent-groups-ui-*.json']:
            for file in sorted(folder.glob(pattern)):
                if re.fullmatch(r'agent-groups-(?:core|ui)-\d{2}\.json', file.name):
                    data = read(file)
                    prior.append({**ref(file), 'status': data['status'],
                                  'selected': file in [DELIVERY / v for v in selected.values()]})
    assert any(row['path'].endswith('copypaste-platform/evidence/agent-groups-core-04.json') and row['status'] == 'failed' for row in prior)
    result = {'at': datetime.now(timezone.utc).isoformat(), 'stage': 93, 'status': 'verified_scoped_persistent_agent_groups',
        'scope': 'Versioned cloud teams, immutable customer-reviewed DAGs, bounded actual Codex execution, private predecessor files, task accounting, scoped Admin content actions, native retention and erasure; explicitly synthetic model/account capacity',
        'selected': selected, 'source_files': sources, 'qualification_scopes': scopes,
        'core_tests': core['counts'], 'test_files': core['test_files'], 'ui_checks': 7,
        'executions': journey['executions'], 'screenshots': journey['screenshots'],
        'recordings': journey['media'], 'output_files': journey['output_files'],
        'new_migration': ref(DEV / 'copypaste-platform/migrations/108-persistent-agent-groups.sql'),
        'new_contract': ref(DEV / 'copypaste-platform/contracts/agent-groups-openapi.json'),
        'preservation': {'receipt': ref(before), 'published_files': 638, 'published_migrations': 107,
                         'published_contract_files': 484, 'skill_packages': 39, 'catalog_files': 8,
                         'protected_catalog_unchanged': True, 'original_requirement_records_unchanged': 102},
        'raw_evidence': [ref(DELIVERY / (f'evidence/agent-groups-core-{args.core}' + tail)) for tail in ['.json', '.tap', '-verifier.mjs']]
            + [ref(DELIVERY / (f'evidence/agent-groups-ui-{args.ui}' + tail)) for tail in ['.json', '.log', '-journey.json', '-verifier.mjs', '-journey-verifier.ts', '-fixture-cleanup.json']],
        'all_attempts': prior, 'acceptance': {'requirements': 102, 'partial': 86, 'completion_not_proven': 16,
            'fully_accepted': 0, 'qualified_live_roles': 0, 'G01_G10': 'not_proven'},
        'not_validated': journey['not_validated'], 'verifier_sha256': digest(Path(__file__))}
    with output.open('x', encoding='utf-8', newline='\n') as stream:
        stream.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': result['status'], 'sources': len(sources), 'tests': core['counts']['tests'], 'ui_checks': 7}))


if __name__ == '__main__':
    main()
