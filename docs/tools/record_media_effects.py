"""Bind bounded native media effects to exact-source database and browser evidence."""
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
    output = ROOT / 'docs/quality/media-effects-checkpoint.json'
    assert not output.exists()
    selected = {'core': f'evidence/media-effects-core-{args.core}.json',
                'ui': f'evidence/media-effects-ui-{args.ui}.json'}
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
    assert core['scope'] == 'full' and len(core['test_files']) == 8 and core['counts']['tests'] > 21
    assert all(file in core['test_files'] for file in ['tests/media-effects-render.test.ts', 'tests/media-effects-tools.test.ts',
               'tests/desktop-executions.test.ts', 'tests/agent-groups.test.ts', 'tests/cloud-workflows.test.ts'])
    assert digest(DELIVERY / core['raw_report']['path']) == core['raw_report']['sha256']
    raw = (DELIVERY / core['raw_report']['path']).read_text(encoding='utf-8')
    for name in ['the Codex business tools enforce frozen approval', 'withdrawing an original source fences completed effect',
                 'a quarantined completed output cannot be silently regenerated', 'a model completion without the reviewed media operation',
                 'authenticated Admin publication controls the effects menu']:
        assert re.search(r'^ok \d+ - ' + re.escape(name), raw, re.M), name
    assert ui['compiled_unchanged'] and ui['owned_previews_closed']
    assert digest(DELIVERY / ui['raw_log']['path']) == ui['raw_log']['sha256']
    assert ui['fixture_cleanup']['status'] == 'passed' and all(r['reclaimed'] for r in ui['fixture_cleanup']['results'])
    journey = ui['journey']
    assert journey['status'] == 'passed' and not journey['errors'] and len(journey['checks']) == 8
    assert all(row.startswith(f'EFFECT-{i:02} ') for i, row in enumerate(journey['checks'], 1))
    assert all(journey[key] for key in ['browser_closed', 'api_closed', 'fixture_closed'])
    assert journey['funding']['no_direct_wallet_mutation']
    assert len(journey['executions']) == 2 and len(journey['output_files']) == 8
    for row in journey['executions']:
        assert row['native_codex'] and row['synthetic_model'] and row['reservation_count'] == 1
        assert int(row['charged_micros']) > 0 and row['tools'] == ['effects_catalog', 'effect_render']
    for row in journey['output_files']:
        file = DELIVERY / row['path']
        assert int(row['bytes']) == file.stat().st_size > 0
        assert digest(file) == row['sha256']
    assert len(journey['screenshots']) == 12 and len(journey['media']) == 2
    for row in journey['screenshots']:
        assert digest(DEV / row['path']) == row['sha256'] and row['edited'] is False
    for row in journey['media']:
        assert row['skipped_capture_errors'] == 0 and row['distinct_frames'] > 1
        for item in row['files']: assert digest(DEV / item['path']) == item['sha256']
    examples_file = DEV / 'copypaste-web/public/effects/1.0.0/examples.json'
    examples = read(examples_file)
    before = ROOT / 'docs/quality/history/stage95-before-media-effects/receipt.json'
    baseline = read(before)
    assert len(baseline['published_files']) == 641
    for name, expected in baseline['published_files'].items(): assert digest(ROOT / name) == expected, name
    for row in baseline['files']: assert digest(ROOT / row['archive']) == row['sha256']
    assert digest(ROOT / 'docs/contracts/role-preset-catalog-current.json') == baseline['protected_role_catalog_sha256']
    assert digest(ROOT / baseline['stage94_publication']['path']) == baseline['stage94_publication']['sha256']
    progress = read(ROOT / 'docs/quality/requirements-alignment-progress.json')
    assert progress['requirements'] == baseline['requirements'] and progress['gates'] == baseline['gates']
    assert dict(Counter(row['assessment'] for row in progress['requirements'])) == {'partial_verified': 86, 'completion_not_proven': 16}
    assert progress['fully_accepted_requirements'] == progress['qualified_live_roles'] == 0
    prior = []
    for file in sorted((DELIVERY / 'evidence').glob('media-effects-*.json')):
        if re.fullmatch(r'media-effects-(core|ui)-\d{2}\.json', file.name):
            data = read(file)
            prior.append({**ref(file), 'status': data['status'], 'selected': file in [DELIVERY / value for value in selected.values()]})
    result = {'at': datetime.now(timezone.utc).isoformat(), 'stage': 95, 'status': 'verified_scoped_media_effects',
        'scope': 'Ten versioned native effects, frozen reviewed inputs, actual private MP4/PNG/source/ZIP, same-request retries, withdrawal lineage, exact role permission, real native Codex and accounting with a synthetic model; eight related integration suites, not a complete platform acceptance',
        'selected': selected, 'source_files': sources, 'qualification_scopes': scopes,
        'core_tests': core['counts'], 'test_files': core['test_files'], 'ui_checks': 8,
        'executions': journey['executions'], 'screenshots': journey['screenshots'],
        'recordings': journey['media'], 'output_files': journey['output_files'],
        'examples': ref(examples_file), 'new_migrations': [ref(DEV / ('copypaste-platform/migrations/' + file)) for file in
            ['110-reviewed-media-effects.sql', '111-media-effect-tool-receipts.sql']],
        'preservation': {'receipt': ref(before), 'published_files': 641, 'published_migrations': 109,
                         'published_contract_files': 485, 'skill_packages': 39, 'catalog_files': 8,
                         'protected_catalog_unchanged': True, 'original_requirement_records_unchanged': 102},
        'raw_evidence': [ref(DELIVERY / (f'evidence/media-effects-core-{args.core}' + tail)) for tail in ['.json', '.tap', '-verifier.mjs']]
            + [ref(DELIVERY / (f'evidence/media-effects-ui-{args.ui}' + tail)) for tail in ['.json', '.log', '-journey.json', '-verifier.mjs', '-journey-verifier.ts', '-fixture-cleanup.json']],
        'all_attempts': prior, 'failed_attempt_diagnosis': ref(ROOT / 'docs/quality/media-effects-ui-02-intervention.json'),
        'acceptance': {'requirements': 102, 'partial': 86, 'completion_not_proven': 16,
            'fully_accepted': 0, 'qualified_live_roles': 0, 'G01_G10': 'not_proven'},
        'not_validated': journey['not_validated'], 'verifier_sha256': digest(Path(__file__))}
    with output.open('x', encoding='utf-8', newline='\n') as stream: stream.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': result['status'], 'sources': len(sources), 'tests': core['counts']['tests'], 'ui_checks': 8}))


if __name__ == '__main__':
    main()
