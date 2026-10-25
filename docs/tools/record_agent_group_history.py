"""Bind current chronological team history to native database and real browser evidence."""
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
    output = ROOT / 'docs/quality/agent-group-history-checkpoint.json'
    assert not output.exists()
    selected = {'core': f'evidence/agent-groups-core-{args.core}.json',
                'ui': f'evidence/agent-group-history-ui-{args.ui}.json'}
    reports = {key: read(DELIVERY / value) for key, value in selected.items()}
    sources, scopes = {}, []
    for key, report in reports.items():
        assert report['status'] == 'passed' and report['source_unchanged'] and report['owned_database_shutdown']
        for name, expected in report['source_files'].items():
            file = source(name)
            assert digest(file) == expected, (key, name)
            name = file.relative_to(ROOT).as_posix()
            assert name not in sources or sources[name] == expected
            sources[name] = expected
        scopes.append({'scope': key, 'report': selected[key], 'sha256': digest(DELIVERY / selected[key]),
                       'source_files': len(report['source_files']), 'all_recorded_sources_exact': True})
    core, ui = reports['core'], reports['ui']
    passing(core['counts'])
    assert core['scope'] == 'focused' and core['test_files'] == ['tests/agent-groups.test.ts']
    assert core['counts']['tests'] == 18
    assert digest(DELIVERY / core['raw_report']['path']) == core['raw_report']['sha256']
    raw = (DELIVERY / core['raw_report']['path']).read_text(encoding='utf-8')
    for name in ['private team history orders actual creation time', 'team history cursor anchors cannot disclose',
                 'project team and immutable version cursors traverse', 'scoped Admin content permissions',
                 'native retention scrubs only expired unused team reviews']:
        assert re.search(r'^ok \d+ - ' + re.escape(name), raw, re.M), name
    assert ui['compiled_unchanged'] and ui['owned_previews_closed']
    assert digest(DELIVERY / ui['raw_log']['path']) == ui['raw_log']['sha256']
    assert ui['fixture_cleanup']['status'] == 'passed' and all(r['reclaimed'] for r in ui['fixture_cleanup']['results'])
    journey = ui['journey']
    assert journey['status'] == 'passed' and not journey['errors'] and len(journey['checks']) == 11
    for prefix, count in [('TEAM', 7), ('HISTORY', 4)]:
        checks = [row for row in journey['checks'] if row.startswith(prefix + '-')]
        assert len(checks) == count
        assert all(row.startswith(f'{prefix}-{i:02} ') for i, row in enumerate(checks, 1))
    assert all(journey[key] for key in ['browser_closed', 'api_closed', 'fixture_closed'])
    assert journey['funding']['no_direct_wallet_mutation']
    history = journey['history']
    assert all(history[key] for key in ['draft_preserved', 'cursor_withdrawal_fenced', 'project_switch_fenced'])
    assert len(history['history_runs']) == 10 and len(history['created_teams']) > 102
    assert all(r['charged_micros'] == r['reserved_micros'] == 0 for r in history['history_runs'])
    assert history['saved_outside_page']['selected_after_refresh'] and history['current_version'] == 23
    assert history['newest_approved_run']['reserved_after_stop'] == history['newest_approved_run']['charged_micros'] == 0
    assert len(journey['executions']) == len(journey['output_files']) == 3
    for row in journey['executions']:
        assert row['native_codex'] and row['synthetic_model'] and row['reservation_count'] == 1
        assert int(row['charged_micros']) > 0 and {'group_results', 'deliver_text'}.issubset(row['observed_tools'])
    for row in journey['output_files']:
        assert int(row['bytes']) == row['actual_download_bytes'] > 0
        assert re.fullmatch(r'[a-f0-9]{64}', row['sha256'])
    assert len(journey['screenshots']) == 15 and len(journey['media']) == 3
    for row in journey['screenshots']:
        assert digest(DEV / row['path']) == row['sha256'] and row['edited'] is False
    for row in journey['media']:
        assert row['skipped_capture_errors'] == 0 and row['distinct_frames'] > 1
        for item in row['files']: assert digest(DEV / item['path']) == item['sha256']
    before = ROOT / 'docs/quality/history/stage94-before-team-history/receipt.json'
    baseline = read(before)
    assert len(baseline['published_files']) == 640
    for name, expected in baseline['published_files'].items(): assert digest(ROOT / name) == expected, name
    for row in baseline['files']: assert digest(ROOT / row['archive']) == row['sha256']
    assert digest(ROOT / 'docs/contracts/role-preset-catalog-current.json') == baseline['protected_role_catalog_sha256']
    assert digest(ROOT / baseline['stage93_publication']['path']) == baseline['stage93_publication']['sha256']
    progress = read(ROOT / 'docs/quality/requirements-alignment-progress.json')
    assert progress['requirements'] == baseline['requirements'] and progress['gates'] == baseline['gates']
    assert dict(Counter(row['assessment'] for row in progress['requirements'])) == {'partial_verified': 86, 'completion_not_proven': 16}
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    prior = []
    for pattern in ['agent-groups-core-*.json', 'agent-group-history-ui-*.json']:
        for file in sorted((DELIVERY / 'evidence').glob(pattern)):
            if re.fullmatch(r'(agent-groups-core|agent-group-history-ui)-\d{2}\.json', file.name):
                data = read(file)
                prior.append({**ref(file), 'status': data['status'], 'selected': file in [DELIVERY / value for value in selected.values()]})
    result = {'at': datetime.now(timezone.utc).isoformat(), 'stage': 94, 'status': 'verified_scoped_agent_group_history',
        'scope': 'Chronological private run history with exact PostgreSQL timestamp/ID cursors, independent directory/version/run pages, retained drafts, selected saved teams, source and project-switch fencing; original actual Codex handoff/accounting rerun with synthetic model/capacity',
        'selected': selected, 'source_files': sources, 'qualification_scopes': scopes,
        'core_tests': core['counts'], 'test_files': core['test_files'], 'ui_checks': 11,
        'history': history, 'executions': journey['executions'], 'screenshots': journey['screenshots'],
        'recordings': journey['media'], 'output_files': journey['output_files'],
        'new_migration': ref(DEV / 'copypaste-platform/migrations/109-agent-group-history-order.sql'),
        'preservation': {'receipt': ref(before), 'published_files': 640, 'published_migrations': 108,
                         'published_contract_files': 485, 'skill_packages': 39, 'catalog_files': 8,
                         'protected_catalog_unchanged': True, 'original_requirement_records_unchanged': 102},
        'raw_evidence': [ref(DELIVERY / (f'evidence/agent-groups-core-{args.core}' + tail)) for tail in ['.json', '.tap', '-verifier.mjs']]
            + [ref(DELIVERY / (f'evidence/agent-group-history-ui-{args.ui}' + tail)) for tail in ['.json', '.log', '-journey.json', '-verifier.mjs', '-journey-verifier.ts', '-history-verifier.ts', '-fixture-cleanup.json']],
        'all_attempts': prior, 'acceptance': {'requirements': 102, 'partial': 86, 'completion_not_proven': 16,
            'fully_accepted': 0, 'qualified_live_roles': 0, 'G01_G10': 'not_proven'},
        'not_validated': journey['not_validated'], 'verifier_sha256': digest(Path(__file__))}
    with output.open('x', encoding='utf-8', newline='\n') as stream: stream.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': result['status'], 'sources': len(sources), 'tests': core['counts']['tests'], 'ui_checks': 11}))


if __name__ == '__main__':
    main()
