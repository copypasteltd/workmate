"""Bind actual deterministic-role, native Codex and browser evidence to current sources."""
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
    parser.add_argument('--core', required=True)
    parser.add_argument('--ui', required=True)
    args = parser.parse_args()
    assert all(re.fullmatch(r'\d{2}', v) for v in vars(args).values())
    output = ROOT / 'docs/quality/analysis-roles-checkpoint.json'
    assert not output.exists(), 'Preserve every original checkpoint'
    selected = {'core': f'evidence/analysis-roles-core-{args.core}.json', 'ui': f'evidence/analysis-role-ui-{args.ui}.json'}
    reports = {key: read(DELIVERY / name) for key, name in selected.items()}
    sources, scopes = {}, []
    for key, report in reports.items():
        assert report['status'] == 'passed' and report['source_unchanged'] and report['owned_database_shutdown'], key
        for name, expected in report['source_files'].items():
            file = source(name)
            assert digest(file) == expected, (key, name)
            normalized = file.relative_to(ROOT).as_posix()
            assert normalized not in sources or sources[normalized] == expected
            sources[normalized] = expected
        scopes.append({'scope': key, 'report': selected[key], 'sha256': digest(DELIVERY / selected[key]), 'source_files': len(report['source_files']), 'all_recorded_sources_exact': True})
    core, ui = reports['core'], reports['ui']
    passing(core['counts'])
    assert core['counts']['tests'] >= 68 and core['scope'] == 'full'
    assert digest(DELIVERY / core['raw_report']['path']) == core['raw_report']['sha256']
    raw = (DELIVERY / core['raw_report']['path']).read_text(encoding='utf-8')
    for role in ['marketing-analyst', 'information-design']:
        assert re.search(r'^ok \d+ - ' + role + ': the pinned native Codex process consumes actual source/calculation tools', raw, re.M)
    assert ui['compiled_unchanged'] and ui['owned_previews_closed']
    assert digest(DELIVERY / ui['raw_log']['path']) == ui['raw_log']['sha256']
    assert ui['fixture_cleanup']['status'] == 'passed' and all(row['reclaimed'] for row in ui['fixture_cleanup']['results'])
    journey = ui['journey']
    assert journey['status'] == 'passed' and not journey['errors']
    assert len(journey['checks']) == 11 and all(name.startswith(f'ANALYSIS-{i:02} ') for i, name in enumerate(journey['checks'], 1))
    assert journey['browser_closed'] and journey['api_closed'] and journey['fixture_closed']
    assert journey['funding']['no_direct_wallet_mutation']
    assert len(journey['executions']) == 2
    for task in journey['executions']:
        assert task['native_codex'] and task['synthetic_model'] and task['reservation_count'] == 1
        assert task['charged_micros'] == '600' and len(task['output']['files']) == 9 and task['output']['provider_calls'] == 0
    assert journey['executions'][0]['tools'] == ['analysis_sources', 'sheet_calculate', 'chart_render']
    assert journey['executions'][1]['tools'] == ['analysis_source_read', 'sheet_calculate', 'chart_render']
    assert len(journey['screenshots']) == 10 and len(journey['media']) == 2
    for item in journey['screenshots']:
        assert digest(DEV / item['path']) == item['sha256'] and item['edited'] is False
    for recording in journey['media']:
        assert recording['skipped_capture_errors'] == 0 and recording['distinct_frames'] > 1
        assert {Path(item['path']).suffix for item in recording['files']} == {'.gif', '.mp4'}
        for item in recording['files']: assert digest(DEV / item['path']) == item['sha256']
    for item in journey['output_files']: assert digest(DELIVERY / item['path']) == item['sha256']
    baseline = read(ROOT / 'docs/quality/history/stage87-before-folder-work/receipt.json')
    for field, count in [('published_migrations', 103), ('published_contracts', 532)]:
        assert len(baseline[field]) == count
        for name, expected in baseline[field].items(): assert digest(ROOT / name) == expected, name
    progress = read(ROOT / 'docs/quality/requirements-alignment-progress.json')
    assert [{key: row[key] for key in FIELDS} for row in progress['requirements']] == baseline['original_requirements']
    assert dict(Counter(row['assessment'] for row in progress['requirements'])) == {'partial_verified': 86, 'completion_not_proven': 16}
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    archive = ROOT / 'docs/quality/history/stage90-before-analysis-roles'
    for receipt in ['receipt.json', 'additional-receipt.json']:
        for item in read(archive / receipt)['files']: assert digest(ROOT / item['archive']) == item['sha256']
    old_packages = json.loads((archive / 'dev__copypaste-platform__catalog__skill-packages.json.snapshot').read_text(encoding='utf-8'))
    for item in old_packages: assert digest(DEV / 'copypaste-platform' / item['path']) == item['sha256']
    result = {'at': datetime.now(timezone.utc).isoformat(), 'stage': 90, 'status': 'verified_scoped_analysis_role_delivery',
        'scope': 'Versioned R15/R17 deterministic analysis and real nine-file delivery; actual pinned Codex/native PostgreSQL, private CSV/XLSX, source fences, revisions and actual Web downloads with an explicitly synthetic model',
        'selected': selected, 'source_files': sources, 'qualification_scopes': scopes, 'core_tests': core['counts'], 'ui_checks': 11,
        'roles': [{'key': key, 'version': '1.1.0', 'professional_qualification': 'unverified'} for key in ['information-design', 'marketing-analyst']],
        'old_skill_packages_preserved': len(old_packages), 'new_migration': ref(DEV / 'copypaste-platform/migrations/104-analysis-role-delivery-receipts.sql'),
        'executions': journey['executions'], 'screenshots': journey['screenshots'], 'recordings': journey['media'], 'output_files': journey['output_files'],
        'raw_evidence': [ref(DELIVERY / (f'evidence/analysis-role-ui-{args.ui}' + suffix)) for suffix in ['.json', '.log', '-journey.json', '-verifier.mjs', '-journey-verifier.ts', '-fixture-cleanup.json']]
            + [ref(DELIVERY / (f'evidence/analysis-roles-core-{args.core}' + suffix)) for suffix in ['.json', '.tap', '-verifier.mjs']],
        'acceptance': {'original_requirement_records_unchanged': 102, 'partial': 86, 'completion_not_proven': 16, 'fully_accepted': 0, 'qualified_roles': 0, 'G01_G10': 'not_proven'},
        'not_validated': journey['not_validated'], 'verifier_sha256': digest(Path(__file__))}
    with output.open('x', encoding='utf-8', newline='\n') as stream: stream.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': result['status'], 'current_sources': len(sources), 'core_tests': core['counts']['tests'], 'ui_checks': 11}))


if __name__ == '__main__': main()
