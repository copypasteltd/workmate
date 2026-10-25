"""Bind versioned business methods to exact source, native Codex and browser evidence."""
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import argparse
import json
import re

from record_folder_work import ROOT, DEV, DELIVERY, digest, read, ref, source, passing


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ['core', 'ui', 'native']:
        parser.add_argument('--' + key, required=True)
    args = parser.parse_args()
    assert all(re.fullmatch(r'\d{2}', v) for v in vars(args).values())
    output = ROOT / 'docs/quality/solution-packages-checkpoint.json'
    assert not output.exists()
    selected = {k: f'evidence/solution-packages-{k}-{v}.json' for k, v in vars(args).items()}
    reports = {k: read(DELIVERY / p) for k, p in selected.items()}
    sources, scopes = {}, []
    for k, report in reports.items():
        assert report['status'] == 'passed' and report['source_unchanged'], k
        for name, expected in report['source_files'].items():
            file = DEV / 'copypaste-desktop' / name if k == 'native' else source(name)
            assert digest(file) == expected, (k, name)
            name = file.relative_to(ROOT).as_posix()
            assert name not in sources or sources[name] == expected
            sources[name] = expected
        scopes.append({'scope': k, 'report': selected[k], 'sha256': digest(DELIVERY / selected[k]),
                       'source_files': len(report['source_files']), 'all_recorded_sources_exact': True})
    core, ui, native = reports['core'], reports['ui'], reports['native']
    passing(core['counts']); passing(native['counts']); passing(native['unit_counts'])
    assert core['scope'] == 'full' and len(core['test_files']) == 9
    core_raw = DELIVERY / core['raw_report']['path']
    assert digest(core_raw) == core['raw_report']['sha256']
    assert re.search(r'^ok \d+ - browsing file metadata cannot qualify a required input; the actual CSV reader can\r?$', core_raw.read_text(encoding='utf-8'), re.M)
    assert re.search(r'^ok \d+ - concurrent method and source-project changes fence target trial tools without granting new project access\r?$', core_raw.read_text(encoding='utf-8'), re.M)
    assert core['owned_database_shutdown'] and ui['owned_database_shutdown']
    assert ui['compiled_unchanged'] and ui['owned_previews_closed']
    assert ui['fixture_cleanup']['status'] == 'passed' and all(v['reclaimed'] for v in ui['fixture_cleanup']['results'])
    journey = ui['journey']
    assert journey['status'] == 'passed' and not journey['errors'] and len(journey['checks']) == 8
    assert all(v.startswith(f'SOLUTION-{i:02} ') for i, v in enumerate(journey['checks'], 1))
    assert all(journey[k] for k in ['browser_closed', 'api_closed', 'fixture_closed'])
    assert journey['funding']['no_direct_wallet_mutation']
    assert len(journey['executions']) == 2 and not journey['output_files']
    for v in journey['executions']:
        assert v['native_codex'] and v['synthetic_model'] and v['reservation_count'] == 1
        assert int(v['charged_micros']) > 0 and 'solution_source_read' in v['tools']
    assert len(journey['screenshots']) == 13 and len(journey['media']) == 2
    for v in journey['screenshots']:
        assert digest(DEV / v['path']) == v['sha256'] and v['edited'] is False
    for v in journey['media']:
        assert v['skipped_capture_errors'] == 0 and v['distinct_frames'] > 1
        for item in v['files']:
            assert digest(DEV / item['path']) == item['sha256']
    baseline_path = ROOT / 'docs/quality/history/stage96-before-solution-packages/receipt.json'
    baseline = read(baseline_path)
    assert len(baseline['published_files']) == 646
    for name, expected in baseline['published_files'].items():
        assert digest(ROOT / name) == expected, name
    for row in baseline['files']:
        assert digest(ROOT / row['archive']) == row['sha256']
    assert digest(ROOT / 'docs/contracts/role-preset-catalog-current.json') == baseline['protected_role_catalog_sha256']
    progress = read(ROOT / 'docs/quality/requirements-alignment-progress.json')
    assert progress['requirements'] == baseline['requirements'] and progress['gates'] == baseline['gates']
    assert dict(Counter(v['assessment'] for v in progress['requirements'])) == {'partial_verified': 86, 'completion_not_proven': 16}
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    attempts, raw = [], []
    for file in sorted((DELIVERY / 'evidence').glob('solution-packages-*')):
        if file.is_file():
            raw.append(ref(file))
            if re.fullmatch(r'solution-packages-(core|ui|native)-\d{2}\.json', file.name):
                attempts.append({**ref(file), 'status': read(file)['status'], 'selected': file in [DELIVERY / p for p in selected.values()]})
    result = {'at': datetime.now(timezone.utc).isoformat(), 'stage': 96, 'status': 'verified_scoped_solution_packages',
        'scope': 'Immutable method versions, private actual trials, exact-delivery acceptance, publication, fresh cross-project rebinding, scoped Admin control and read-only local method tools. Native Codex with synthetic model/account data; nine related suites, not complete product acceptance.',
        'selected': selected, 'source_files': sources, 'qualification_scopes': scopes,
        'core_tests': core['counts'], 'test_files': core['test_files'], 'native_tests': native['counts'], 'desktop_unit_tests': native['unit_counts'],
        'ui_checks': 8, 'executions': journey['executions'], 'screenshots': journey['screenshots'], 'recordings': journey['media'],
        'content_read_qualification': {'facts': 'solution_content_reads', 'metadata_is_not_content': True,
            'exact_version_and_hash': True, 'late_fabrication_rejected': True, 'database_review_and_publication_guards': True},
        'concurrent_method_sources': {'method_and_source_project_locked': True, 'busy_before_tool_access': True,
            'read_only_queries_use_shared_locks': True, 'new_source_project_access_granted': False},
        'output_files': [], 'new_migrations': [ref(DEV / 'copypaste-platform/migrations/112-versioned-solution-packages.sql')],
        'preservation': {'receipt': ref(baseline_path), 'published_files': 646, 'published_migrations': 111,
                         'original_requirements': 102, 'original_acceptance_cases': 102, 'fully_accepted': 0, 'qualified_live_roles': 0},
        'raw_evidence': raw, 'all_attempts': attempts, 'verifier_sha256': digest(Path(__file__)),
        'not_validated': ['live model or reporting quality', 'complete professional role qualification',
                          'new method-library UI inside a packaged native Desktop', 'all original end-to-end acceptance gates']}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': result['status'], 'sources': len(sources), 'tests': core['counts'], 'attempts': len(attempts)}))


if __name__ == '__main__':
    main()
