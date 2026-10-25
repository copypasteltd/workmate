"""Bind actual editable vector/PPTX delivery to exact runtime and browser sources."""
import argparse
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import json
import re
from record_folder_work import ROOT, DEV, DELIVERY, read, digest, ref, source, passing
from audit_folder_work_docs import FIELDS


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--core', required=True)
    parser.add_argument('--ui', required=True)
    args = parser.parse_args()
    assert all(re.fullmatch(r'\d{2}', value) for value in vars(args).values())
    output = ROOT / 'docs/quality/editable-design-checkpoint.json'
    assert not output.exists()
    selected = {'core': f'evidence/editable-design-core-{args.core}.json', 'ui': f'evidence/editable-design-ui-{args.ui}.json'}
    reports = {key: read(DELIVERY / name) for key, name in selected.items()}
    sources, scopes, harness_updates = {}, [], []
    for key, report in reports.items():
        assert report['status'] == 'passed' and report['source_unchanged'] and report['owned_database_shutdown'], key
        for name, expected in report['source_files'].items():
            file = source(name); actual = digest(file)
            if expected != actual:
                assert key == 'core' and name == 'copypaste-delivery/scripts/qa-editable-design-ui.ts', name
                old = [p for p in (DELIVERY / 'evidence').glob('editable-design-ui-*-journey-verifier.ts') if digest(p) == expected]
                assert old and reports['ui']['source_files'][name] == actual
                harness_updates.append({'path': file.relative_to(ROOT).as_posix(), 'core_observed_sha256': expected, 'original_verifier': ref(old[0]), 'current_sha256': actual,
                    'reason': 'Only the browser verification harness changed after core checks. The final browser report separately exercises these exact bytes; all backend/runtime sources remain identical.'})
            normalized = file.relative_to(ROOT).as_posix()
            assert normalized not in sources or sources[normalized] == actual
            sources[normalized] = actual
        scopes.append({'scope': key, 'report': selected[key], 'sha256': digest(DELIVERY / selected[key]), 'source_files': len(report['source_files']), 'backend_and_runtime_sources_exact': True})
    core, ui = reports['core'], reports['ui']; passing(core['counts'])
    assert core['scope'] == 'full' and len(core['test_files']) == 8 and core['counts']['tests'] == 93
    assert digest(DELIVERY / core['raw_report']['path']) == core['raw_report']['sha256']
    raw = (DELIVERY / core['raw_report']['path']).read_text(encoding='utf-8')
    for role in ['brand-visual', 'presentation']:
        assert re.search(r'^ok \d+ - ' + role + r': pinned native Codex', raw, re.M)
        assert re.search(r'^ok \d+ - ' + role + r': native bridge delivers editable files', raw, re.M)
    assert ui['compiled_unchanged'] and ui['owned_previews_closed']
    assert digest(DELIVERY / ui['raw_log']['path']) == ui['raw_log']['sha256']
    assert ui['fixture_cleanup']['status'] == 'passed' and all(row['reclaimed'] for row in ui['fixture_cleanup']['results'])
    journey = ui['journey']
    assert journey['status'] == 'passed' and not journey['errors']
    assert len(journey['checks']) == 8 and all(value.startswith(f'DESIGN-{i:02} ') for i, value in enumerate(journey['checks'], 1))
    assert journey['browser_closed'] and journey['api_closed'] and journey['fixture_closed']
    assert journey['funding']['no_direct_wallet_mutation']
    assert len(journey['executions']) == 4
    expected_tools = [['vector_render'], ['slides_build', 'slides_render'], ['design_source_read', 'vector_render'], ['design_source_read', 'slides_build', 'slides_render']]
    for task, tools in zip(journey['executions'], expected_tools):
        assert task['native_codex'] and task['synthetic_model'] and task['reservation_count'] == 1 and int(task['charged_micros']) > 0
        assert task['tools'] == tools and task['output']['state'] == 'delivered' and task['output']['provider_calls'] == 0
    assert len(journey['screenshots']) == 16 and len(journey['media']) == 2 and len(journey['output_files']) == 11
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
    for checkpoint in ['analysis-roles-checkpoint.json', 'cloud-workflows-checkpoint.json']:
        item = read(ROOT / 'docs/quality' / checkpoint)['new_migration']; assert digest(ROOT / item['path']) == item['sha256']
    progress = read(ROOT / 'docs/quality/requirements-alignment-progress.json')
    assert [{key: row[key] for key in FIELDS} for row in progress['requirements']] == baseline['original_requirements']
    assert dict(Counter(row['assessment'] for row in progress['requirements'])) == {'partial_verified': 86, 'completion_not_proven': 16}
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    archive = ROOT / 'docs/quality/history/stage92-before-editable-design'
    for item in read(archive / 'receipt.json')['files']: assert digest(ROOT / item['archive']) == item['sha256']
    builder = read(archive / 'builder-preservation.json'); assert digest(ROOT / builder['archive']) == builder['sha256']
    old_packages = read(archive / 'dev__copypaste-platform__catalog__skill-packages.json.snapshot'); assert len(old_packages) == 37
    for item in old_packages: assert digest(DEV / 'copypaste-platform' / item['path']) == item['sha256']
    packages = read(DEV / 'copypaste-platform/catalog/skill-packages.json'); assert len(packages) == 39
    roles = [row for row in read(DEV / 'copypaste-platform/catalog/role-preset-catalog.json')['roles'] if row['role_key'] in ['brand-visual', 'presentation']]
    assert len(roles) == 2 and all(row['version'] == '1.1.0' for row in roles)
    result = {'at': datetime.now(timezone.utc).isoformat(), 'stage': 92, 'status': 'verified_scoped_editable_design',
        'scope': 'Actual editable SVG and native-object PPTX tools, fixed Skills, pinned native Codex, authenticated native Desktop tool bridge and session-scoped source revisions, private downloads, immutable revisions, deterministic chart evidence, exact replay and source withdrawal; explicitly synthetic model/content',
        'selected': selected, 'source_files': sources, 'qualification_scopes': scopes, 'separate_browser_harness_qualification': harness_updates,
        'core_tests': core['counts'], 'ui_checks': 8, 'roles': [{'key': row['role_key'], 'version': row['version'], 'professional_qualification': 'unverified'} for row in roles],
        'old_skill_packages_preserved': 37, 'installed_skill_packages': 39, 'old_migrations_preserved': 105, 'new_migration': ref(DEV / 'copypaste-platform/migrations/106-editable-design-tool-receipts.sql'),
        'new_source_migration': ref(DEV / 'copypaste-platform/migrations/107-editable-design-source-lineage.sql'),
        'executions': journey['executions'], 'screenshots': journey['screenshots'], 'recordings': journey['media'], 'output_files': journey['output_files'],
        'raw_evidence': [ref(DELIVERY / (f'evidence/editable-design-ui-{args.ui}' + suffix)) for suffix in ['.json', '.log', '-journey.json', '-verifier.mjs', '-journey-verifier.ts', '-fixture-cleanup.json']]
            + [ref(DELIVERY / (f'evidence/editable-design-core-{args.core}' + suffix)) for suffix in ['.json', '.tap', '-verifier.mjs']],
        'acceptance': {'original_requirement_records_unchanged': 102, 'partial': 86, 'completion_not_proven': 16, 'fully_accepted': 0, 'qualified_roles': 0, 'G01_G10': 'not_proven'},
        'not_validated': ['Actual target-editor PPTX font/layout fidelity; reviews are generated from the fixed source', *journey['not_validated']], 'verifier_sha256': digest(Path(__file__))}
    with output.open('x', encoding='utf-8', newline='\n') as stream: stream.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': result['status'], 'current_sources': len(sources), 'core_tests': 93, 'ui_checks': 8}))


if __name__ == '__main__': main()
