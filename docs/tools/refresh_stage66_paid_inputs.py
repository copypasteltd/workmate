"""Bind paid native input continuation to retained evidence and original scope."""
import argparse
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
PLATFORM = DEV / 'copypaste-platform'
DELIVERY = DEV / 'copypaste-delivery'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def receipt(path):
    return {'path': path.relative_to(ROOT).as_posix(), 'sha256': digest(path)}


def bound(base, entry):
    path = (base / entry['path']).resolve()
    assert path.is_relative_to(ROOT)
    assert digest(path) == entry['sha256'], path
    return path


def source_current(files, kind):
    for file, expected in files.items():
        if kind == 'platform':
            target = PLATFORM / file
        elif kind == 'components':
            repo, relative = file.split('/', 1)
            target = DEV / ('copypaste-' + repo) / relative
        else:
            target = (ROOT if file.startswith('docs/') else DEV) / file
        assert digest(target) == expected, file


def suite(kind, number, current=False):
    path = DELIVERY / f'evidence/paid-input-{kind}-{number}.json'
    result = read(path)
    raw = bound(DELIVERY, result['raw_report']).read_text(encoding='utf-8')
    for field in ('verifier', 'database_log'):
        bound(DELIVERY, result[field])
    for key in ('tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'):
        assert result['counts'][key] == int(re.search('^# ' + key + r' (\d+)$', raw, re.M)[1])
    cleanup = read(bound(DELIVERY, result['fixture_cleanup']))
    assert cleanup['status'] == 'passed' and cleanup['workers_exited'] and cleanup['actual_filesystem_checked']
    assert all(entry['reclaimed'] for entry in cleanup['results'])
    assert result['source_unchanged'] and result['owned_database_shutdown']
    images = read(DELIVERY / result['source_preimages'])
    for entry in images['files']:
        assert digest(DELIVERY / entry['path']) == entry['sha256'] == result['source_files'][entry['source']]
    if current:
        assert result['status'] == 'passed' and result['exit_code'] == 0
        assert result['counts']['tests'] == result['counts']['pass']
        assert not sum(result['counts'][key] for key in ('fail', 'cancelled', 'skipped', 'todo'))
        source_current(result['source_files'], 'platform')
    return {**receipt(path), 'status': result['status'], 'counts': result['counts']}, raw, result


def names(raw):
    return Counter(re.findall(r'^\s*(?:ok|not ok) \d+ - (.+?)\r?$', raw, re.M))


def main():
    parser = argparse.ArgumentParser()
    for key in ('integration', 'full', 'clients', 'native', 'upgrade', 'scan'):
        parser.add_argument('--' + key, required=True)
    parser.add_argument('--documentation')
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    assert all(re.fullmatch(r'\d{2}', getattr(args, key)) for key in ('integration', 'full', 'clients', 'native', 'upgrade', 'scan'))
    manifest_path = ROOT / 'docs/quality/history/stage65-before-paid-inputs/manifest.json'
    manifest = read(manifest_path)
    assert len(manifest['files']) == 4
    for entry in manifest['files']:
        archived = ROOT / entry['archive']
        assert digest(archived) == entry['sha256']
        original = subprocess.check_output(['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', str(ROOT), 'show', manifest['commit'] + ':' + entry['path']])
        assert archived.read_bytes() == original
    archive = lambda file: ROOT / next(entry['archive'] for entry in manifest['files'] if entry['path'] == file)
    baseline = read(archive('docs/quality/requirements-alignment-progress.json'))
    assert len(baseline['requirements']) == 102
    assert baseline['fully_accepted_requirements'] == baseline['qualified_live_roles'] == 0
    for file in ('docs/contracts/openapi.json', 'docs/contracts/scoped-seo-openapi.json', 'docs/contracts/seo-change-tasks-openapi.json'):
        assert (ROOT / file).read_bytes() == subprocess.check_output(['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', str(ROOT), 'show', manifest['commit'] + ':' + file])
    assert digest(ROOT / 'docs/contracts/openapi.json') == '51dd90f26137798dd23c4e881b7f9f0b20f99ad4b9fee0cce98686e11873aab4'
    focused, focused_raw, _ = suite('integration', args.integration, True)
    full, full_raw, full_result = suite('regression', args.full, True)
    assert focused['counts']['tests'] >= 30 and full['counts']['tests'] >= 778
    previous = read(DELIVERY / 'evidence/history-source-regression-02.json')
    assert previous['counts']['tests'] == previous['counts']['pass'] == 765
    previous_names = names(bound(DELIVERY, previous['raw_report']).read_text(encoding='utf-8'))
    assert not previous_names - names(full_raw)
    assert not names(focused_raw) - names(full_raw)
    retained = []
    for kind in ('integration', 'regression'):
        for path in sorted((DELIVERY / 'evidence').glob('paid-input-' + kind + '-??.json')):
            retained.append(suite(kind, path.stem[-2:])[0])
    first = read(DELIVERY / 'evidence/paid-input-integration-01.json')
    assert first['status'] == 'failed' and first['counts']['fail'] == 2
    for version, number in ((88, '02'), (89, '04'), (90, '05'), (91, '08')):
        path = next((PLATFORM / 'migrations').glob(f'{version:03}-*.sql'))
        initial = read(DELIVERY / f'evidence/paid-input-integration-{number}.json')
        assert digest(path) == initial['source_files']['migrations/' + path.name]
        assert f'applied migration {version}' in bound(DELIVERY, initial['raw_report']).read_text(encoding='utf-8')
    clients_path = DELIVERY / f'evidence/paid-input-clients-{args.clients}.json'
    clients = read(clients_path)
    assert clients['status'] == 'passed' and clients['source_unchanged'] and len(clients['checks']) == 13
    bound(DELIVERY, clients['verifier'])
    for check in clients['checks']:
        assert check['exit_code'] == 0 and digest(DELIVERY / check['raw_report']) == check['raw_sha256']
        if check['counts']:
            assert check['counts']['tests'] == check['counts']['pass'] > 0
            assert not sum(check['counts'][key] for key in ('fail', 'cancelled', 'skipped', 'todo'))
    source_current(clients['source_files'], 'components')
    upgrade_path = DELIVERY / f'evidence/paid-input-upgrade-{args.upgrade}.json'
    upgrade = read(upgrade_path)
    assert upgrade['status'] == 'passed' and upgrade['owned_database_shutdown']
    bound(DELIVERY, upgrade['verifier'])
    for entry in upgrade['inputs'] + upgrade['raw_reports']:
        bound(DELIVERY, entry)
    before_path = bound(DELIVERY, upgrade['baseline']) if 'baseline' in upgrade else DELIVERY / f'evidence/paid-input-migrations-{args.upgrade}-before.json'
    after_path = DELIVERY / f'evidence/paid-input-migrations-{args.upgrade}.json'
    before, after = read(before_path), read(after_path)
    if 'baseline' in upgrade:
        initial = read(bound(DELIVERY, upgrade['initial_upgrade']))
        assert initial['status'] == 'failed' and initial['owned_database_shutdown']
        for entry in initial['raw_reports']:
            bound(DELIVERY, entry)
        assert before['status'] == 'captured_before_upgrade'
        assert before['verifier_sha256'] == after['original_verifier_sha256'] == digest(bound(DELIVERY, upgrade['original_verifier']))
        assert after['verifier_sha256'] == digest(bound(DELIVERY, upgrade['migration_verifier']))
        assert bound(DELIVERY, after['baseline']) == before_path
    else:
        assert before['verifier_sha256'] == after['verifier_sha256'] == digest(DELIVERY / 'scripts/qa-paid-input-migrations.mjs')
    assert after['status'] == 'passed' and len(before['databases']) == len(after['databases']) == 2
    for database in after['databases']:
        old = next(row for row in before['databases'] if row['database'] == database['database'])
        assert database['original'] == old['original'] and len(database['original']) == 169
        assert len(database['tables']) == 171 and len(database['migrations']) == 91
        assert database['migrations'][:87] == old['migrations']
        assert database['new_checkpoint_rows'] == database['new_receipt_rows'] == 0
        assert database['original_dependency_checkpoint_ids_null']
        assert database['original_table_ownership_rls_flags_unchanged'] and not database['synthetic_history_added']
        assert database['changed_functions'] == ['claim_execution_capacity(uuid,text,integer,uuid)']
    native_path = DELIVERY / f'evidence/paid-input-native-{args.native}.json'
    native = read(native_path)
    assert native['status'] == 'passed' and native['source_unchanged'] and native['owned_database_shutdown']
    assert native['web_build_unchanged'] and native['owned_web_preview_closed']
    for field in ('journey', 'verifier', 'journey_verifier', 'raw_report'):
        bound(DELIVERY, native[field])
    journey_path = bound(DELIVERY, native['journey'])
    journey = read(journey_path)
    assert journey['status'] == 'passed' and len(journey['checks']) >= 32 and not journey['errors']
    assert all(journey[key] for key in ('desktop_closed', 'extension_closed', 'browser_closed', 'owned_api_closed', 'artifacts_unchanged_after_run'))
    assert journey['inspection']['extension']['native_context_type'] == 'SIDE_PANEL' and journey['inspection']['extension']['side'] == 'right'
    for kind in ('desktop_paid_input', 'web_paid_input', 'extension_paid_input'):
        facts = journey['inspection'][kind]
        assert all(facts[key] for key in ('same_task', 'same_thread', 'one_reservation', 'one_settlement', 'synthetic_ui_model_turn'))
        assert facts['selection_survived_task_refreshes'] >= 2 and facts['failed_read_clears_prior_content']
    for entry in journey['screenshots']:
        assert digest(DEV / entry['path']) == entry['sha256'] and entry['edited'] is False
    source_current(native['source_files'], 'prefixed')
    cleanup = read(bound(DELIVERY, native['fixture_cleanup']))
    assert cleanup['status'] == 'passed' and cleanup['workers_exited'] and cleanup['actual_filesystem_checked']
    assert all(row['reclaimed'] for row in cleanup['results'])
    retained_native = []
    for path in sorted((DELIVERY / 'evidence').glob('paid-input-native-??.json')):
        execution = read(path)
        assert execution['source_unchanged'] and execution['owned_database_shutdown']
        for field in ('journey', 'verifier', 'journey_verifier', 'raw_report'):
            bound(DELIVERY, execution[field])
        historical_journey = read(bound(DELIVERY, execution['journey']))
        assert historical_journey['status'] == execution['status']
        assert historical_journey['desktop_closed'] and historical_journey['browser_closed'] and historical_journey['owned_api_closed']
        if 'extension' in historical_journey['inspection']:
            assert historical_journey['extension_closed']
        reclaimed = read(bound(DELIVERY, execution['fixture_cleanup']))
        assert reclaimed['status'] == 'passed' and reclaimed['workers_exited'] and reclaimed['actual_filesystem_checked']
        assert all(row['reclaimed'] for row in reclaimed['results'])
        retained_native.append({**receipt(path), 'status': execution['status'], 'checks': execution['counts']['checks']})
    artifact_path = ROOT / 'docs/quality/paid-input-artifacts.json'
    assert artifact_path.read_bytes() == (DELIVERY / 'evidence/paid-input-artifacts.json').read_bytes()
    artifacts = read(artifact_path)
    assert artifacts['status'] == 'passed' and artifacts['tested_artifacts'] == journey['tested_artifacts']
    for artifact in artifacts['artifacts']:
        assert digest(DEV / artifact['path']) == artifact['sha256']
    for old_manifest in ('native-clients-recheck-20261021-02.json', 'creative-matrix-artifacts.json', 'template-video-artifacts.json', 'marketing-connector-artifacts.json', 'scoped-seo-artifacts.json', 'seo-change-artifacts.json'):
        old = read(ROOT / 'docs/quality' / old_manifest)
        for entry in old.get('artifacts', old.get('verified_artifacts', [])):
            assert digest(DEV / entry['path']) == entry['sha256']
    scan_path = ROOT / f'docs/quality/paid-input-credential-scan-{args.scan}.json'
    scan = read(scan_path)
    assert scan['status'] == 'passed' and not scan['matches'] and scan['configured_patterns'] > 0
    assert scan['verifier_sha256'] == digest(ROOT / 'docs/tools/scan_paid_input_credentials.mjs')
    for entry in scan['files']:
        assert digest(ROOT / entry['path']) == entry['sha256']
    checkpoint = {'at': datetime.now(timezone.utc).isoformat(), 'verifier': receipt(Path(__file__).resolve()),
                  'scope': 'Completed and measured paid Codex turns may request authorized human inputs and continue the same task/thread with one original reservation, bounded rounds, source-aware completed-tool reuse and cumulative settlement. Actual Codex processes are exercised against an authorized synthetic Responses gateway; native client input journeys use explicit synthetic model-turn fixtures. No arbitrary in-flight pause, unknown-effect replay, production role qualification or whole-product acceptance.',
                  'prior_progress': receipt(archive('docs/quality/requirements-alignment-progress.json')),
                  'original_scope': {'requirements': 102, 'fully_accepted_requirements': 0, 'qualified_live_roles': 0, 'all_TC_NFR_G01_G10_retained': True},
                  'focused': focused, 'full_platform_regression': full, 'previous_765_named_tests_retained': True,
                  'client_checks': receipt(clients_path), 'current_platform_sources': full_result['source_files'],
                  'local_database_upgrade': {'execution': receipt(upgrade_path), 'before': receipt(before_path), 'after': receipt(after_path)},
                  'native_client_journey': {**receipt(native_path), 'actual_checks': len(journey['checks'])}, 'current_native_artifacts': receipt(artifact_path),
                  'preserved_suite_executions': retained, 'preserved_native_executions': retained_native, 'configured_credential_scan': receipt(scan_path),
                  'current_backend_ui_qualification': 'bounded_local_simulated_flows_only',
                  'remaining': ['Complete canonical TaskDTO/POST /v1/tasks and every original acceptance condition', 'Arbitrary in-flight pause, unknown external effects, full multi-node native recovery and unrecorded historical source footprints', 'Independent complete role workflows, GEO, live providers, websites, billing, signed installation/store release, production and all original TC/NFR/G01-G10']}
    if args.documentation:
        assert re.fullmatch(r'[a-z0-9-]+\.json', args.documentation)
        path = ROOT / 'docs/quality' / args.documentation
        document = read(path)
        assert document['status'] == 'passed' and document['checks_failed'] == 0
        assert document['counts']['requirements'] == document['counts']['acceptance_cases'] == 102
        assert document['verifier_sha256'] == digest(ROOT / 'docs/tools/validate_docs.py')
        checkpoint['documentation_contracts'] = receipt(path)
    updated = json.loads(json.dumps(baseline))
    repair = {'cluster': 'paid_native_input_continuation', 'verified_subflow': '已完成且用量明确的 Codex 回合等待用户补资料，恢复原任务与线程，复用有效已完成操作并累计结算；原预算及当前权限持续约束。', 'evidence': ['paid_input_verification'], 'implementation_docs': ['technical/66-paid-native-input-checkpoints.md']}
    for row in updated['requirements']:
        if row['requirement_id'] in ('REQ-009', 'REQ-044', 'REQ-069'):
            row.setdefault('verified_repairs', []).append(repair)
            row['acceptance_evidence'] = list(dict.fromkeys([*row.get('acceptance_evidence', []), 'paid_input_verification']))
    for old, new in zip(baseline['requirements'], updated['requirements']):
        for key in ('requirement_id', 'priority', 'requirement', 'acceptance_case', 'acceptance_conditions', 'original_finding'):
            assert old[key] == new[key]
    assert updated['gates'] == baseline['gates'] and updated['nfr_full_acceptance'] == baseline['nfr_full_acceptance']
    updated['at'] = checkpoint['at']
    updated['summary'] = dict(Counter(row['assessment'] for row in updated['requirements']))
    assert updated['summary'] == {'partial_verified': 81, 'completion_not_proven': 21}
    updated['paid_input_verification'] = checkpoint
    updated['evidence']['platform_regression'] = full
    updated['evidence_currentness_policy'] += ' Stage66: paid native input checkpoints bind current Backend, full regression and bounded local client journeys. Native UI model turns are explicit synthetic fixtures; the separate actual Codex process test uses synthetic provider responses. Earlier source snapshots, contracts, failures and UI reports retain their original scope. No original acceptance finding or gate is rewritten.'
    if args.write:
        for path, value in ((ROOT / 'docs/quality/paid-input-checkpoint.json', checkpoint), (ROOT / 'docs/quality/requirements-alignment-progress.json', updated)):
            path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': 'passed', 'write': args.write, 'full': full['counts'], 'focused': focused['counts'], 'native_checks': len(journey['checks']), 'summary': updated['summary'], 'fully_accepted_requirements': 0}))


if __name__ == '__main__':
    main()
