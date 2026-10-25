"""Bind actual private cloud workflow checks and recordings to exact source bytes."""
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
    output = ROOT / 'docs/quality/cloud-workflows-checkpoint.json'
    assert not output.exists()
    selected = {'core': f'evidence/cloud-workflows-core-{args.core}.json', 'ui': f'evidence/cloud-workflow-ui-{args.ui}.json'}
    reports = {key: read(DELIVERY / name) for key, name in selected.items()}
    sources, scopes, requalifications = {}, [], []
    for key, report in reports.items():
        assert report['status'] == 'passed' and report['source_unchanged'] and report['owned_database_shutdown'], key
        for name, expected in report['source_files'].items():
            file = source(name)
            actual = digest(file)
            if actual != expected:
                assert key == 'core' and name == 'copypaste-delivery/scripts/qa-cloud-workflow-ui.ts', (key, name)
                old_verifier = DELIVERY / 'evidence/cloud-workflow-ui-03-journey-verifier.ts'
                assert digest(old_verifier) == expected
                assert reports['ui']['source_files'][name] == actual
                requalifications.append({'path': file.relative_to(ROOT).as_posix(), 'core_observed_sha256': expected,
                    'original_verifier': ref(old_verifier), 'current_sha256': actual,
                    'reason': 'Only the browser QA harness changed after backend regression: stop capture before resizing and assert actual visible bounds. The final UI report separately runs this exact current harness; backend/runtime sources remain exact.'})
            normalized = file.relative_to(ROOT).as_posix()
            assert normalized not in sources or sources[normalized] == actual
            sources[normalized] = actual
        scopes.append({'scope': key, 'report': selected[key], 'sha256': digest(DELIVERY / selected[key]), 'source_files': len(report['source_files']), 'backend_and_runtime_sources_exact': True, 'separately_requalified_browser_harnesses': len(requalifications) if key == 'core' else 0})
    core, ui = reports['core'], reports['ui']
    passing(core['counts'])
    assert core['counts']['tests'] == 55 and core['scope'] == 'full'
    assert len(core['test_files']) == 5
    assert digest(DELIVERY / core['raw_report']['path']) == core['raw_report']['sha256']
    raw = (DELIVERY / core['raw_report']['path']).read_text(encoding='utf-8')
    assert re.search(r'^ok \d+ - the pinned native Codex', raw, re.M), 'Require the real native consultant case'
    assert ui['compiled_unchanged'] and ui['owned_previews_closed']
    assert digest(DELIVERY / ui['raw_log']['path']) == ui['raw_log']['sha256']
    assert ui['fixture_cleanup']['status'] == 'passed' and all(row['reclaimed'] for row in ui['fixture_cleanup']['results'])
    journey = ui['journey']
    assert journey['status'] == 'passed' and not journey['errors']
    assert len(journey['checks']) == 8 and all(name.startswith(f'WORKFLOW-{i:02} ') for i, name in enumerate(journey['checks'], 1))
    assert journey['browser_closed'] and journey['api_closed'] and journey['fixture_closed']
    assert journey['funding']['no_direct_wallet_mutation']
    assert len(journey['executions']) == 3
    for task in journey['executions']:
        assert task['native_codex'] and task['synthetic_model'] and task['reservation_count'] == 1 and int(task['charged_micros']) > 0
    assert journey['executions'][0]['tools'] == ['analysis_sources', 'workflow_validate', 'workflow_save', 'workflow_publish', 'workflow_run']
    assert journey['executions'][1]['tools'] == ['deliver_text']
    assert journey['executions'][2]['tools'] == ['workflow_read', 'analysis_sources', 'workflow_validate', 'workflow_save', 'workflow_publish', 'workflow_run']
    assert len(journey['screenshots']) == 10 and len(journey['media']) == 2 and len(journey['output_files']) == 2
    for item in journey['screenshots']:
        assert digest(DEV / item['path']) == item['sha256'] and item['edited'] is False
    for recording in journey['media']:
        assert recording['skipped_capture_errors'] == 0 and recording['distinct_frames'] > 1
        assert {Path(item['path']).suffix for item in recording['files']} == {'.gif', '.mp4'}
        for item in recording['files']: assert digest(DEV / item['path']) == item['sha256']
    for item in journey['output_files']: assert digest(DELIVERY / item['file']) == item['sha256']
    baseline = read(ROOT / 'docs/quality/history/stage87-before-folder-work/receipt.json')
    for field, count in [('published_migrations', 103), ('published_contracts', 532)]:
        assert len(baseline[field]) == count
        for name, expected in baseline[field].items(): assert digest(ROOT / name) == expected, name
    stage90 = read(ROOT / 'docs/quality/analysis-roles-checkpoint.json')
    assert digest(ROOT / stage90['new_migration']['path']) == stage90['new_migration']['sha256']
    progress = read(ROOT / 'docs/quality/requirements-alignment-progress.json')
    assert [{key: row[key] for key in FIELDS} for row in progress['requirements']] == baseline['original_requirements']
    assert dict(Counter(row['assessment'] for row in progress['requirements'])) == {'partial_verified': 86, 'completion_not_proven': 16}
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    archive = ROOT / 'docs/quality/history/stage91-before-cloud-workflows'
    for item in read(archive / 'receipt.json')['items']: assert digest(archive / item['archive']) == item['sha256']
    old_packages = read(archive / 'dev__copypaste-platform__catalog__skill-packages.json.snapshot')
    assert len(old_packages) == 35
    for item in old_packages: assert digest(DEV / 'copypaste-platform' / item['path']) == item['sha256']
    role = next(row for row in read(DEV / 'copypaste-platform/catalog/role-preset-catalog.json')['roles'] if row['role_key'] == 'workflow-consultant')
    assert role['version'] == '1.1.0'
    result = {'at': datetime.now(timezone.utc).isoformat(), 'stage': 91, 'status': 'verified_scoped_private_cloud_workflows',
        'scope': 'Actual pinned native Codex private workflow preparation, explicit customer budget and human approval, immutable revisions, real private downloads, single child reservations, cancellation and source withdrawal; explicitly synthetic model/account data',
        'selected': selected, 'source_files': sources, 'qualification_scopes': scopes, 'separate_browser_harness_qualification': requalifications, 'core_tests': core['counts'], 'ui_checks': 8,
        'roles': [{'key': 'workflow-consultant', 'version': '1.1.0', 'professional_qualification': 'unverified'}],
        'old_skill_packages_preserved': len(old_packages), 'new_migration': ref(DEV / 'copypaste-platform/migrations/105-private-cloud-workflows.sql'),
        'executions': journey['executions'], 'screenshots': journey['screenshots'], 'recordings': journey['media'], 'output_files': journey['output_files'],
        'raw_evidence': [ref(DELIVERY / (f'evidence/cloud-workflow-ui-{args.ui}' + suffix)) for suffix in ['.json', '.log', '-journey.json', '-verifier.mjs', '-journey-verifier.ts', '-fixture-cleanup.json']]
            + [ref(DELIVERY / (f'evidence/cloud-workflows-core-{args.core}' + suffix)) for suffix in ['.json', '.tap', '-verifier.mjs']],
        'acceptance': {'original_requirement_records_unchanged': 102, 'partial': 86, 'completion_not_proven': 16, 'fully_accepted': 0, 'qualified_roles': 0, 'G01_G10': 'not_proven'},
        'not_validated': journey['not_validated'], 'verifier_sha256': digest(Path(__file__))}
    with output.open('x', encoding='utf-8', newline='\n') as stream: stream.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': result['status'], 'current_sources': len(sources), 'core_tests': core['counts']['tests'], 'ui_checks': 8}))


if __name__ == '__main__': main()
