"""Bind actual source-lineage evidence while retaining the complete original scope."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

from refresh_stage52_capabilities import ROOT, DEV, PLATFORM, DELIVERY, OPENAPI_SHA, digest, git, read, receipt
from refresh_stage62_scoped_seo import bound, suite, names
from refresh_stage63_seo_changes import source_current


def main():
    parser = argparse.ArgumentParser()
    for key in ('integration', 'full', 'clients', 'upgrade', 'scan', 'recheck'):
        parser.add_argument('--' + key, required=True)
    parser.add_argument('--documentation')
    parser.add_argument('--write', action='store_true')
    a = parser.parse_args()
    assert all(re.fullmatch(r'\d{2}', getattr(a, key)) for key in ('integration', 'full', 'clients', 'upgrade', 'scan', 'recheck'))
    manifest = read(ROOT / 'docs/quality/history/stage64-before-history-sources/manifest.json')
    assert len(manifest['files']) == 24
    for entry in manifest['files']:
        archived = ROOT / entry['archive']
        assert digest(archived) == entry['sha256']
        assert archived.read_bytes() == git(ROOT / entry['repository'], 'show', entry['baseline_commit'] + ':' + entry['repository_path'])
    archive = lambda file: ROOT / next(e['archive'] for e in manifest['files'] if e['path'] == file)
    baseline = read(archive('docs/quality/requirements-alignment-progress.json'))
    assert len(baseline['requirements']) == 102
    assert baseline['fully_accepted_requirements'] == baseline['qualified_live_roles'] == 0
    assert digest(ROOT / 'docs/contracts/openapi.json') == OPENAPI_SHA
    root_head = next(e['baseline_commit'] for e in manifest['files'] if e['path'] == 'docs/README.md')
    contracts = ('docs/contracts/openapi.json', 'docs/contracts/scoped-seo-openapi.json', 'docs/contracts/seo-change-tasks-openapi.json')
    for file in contracts:
        assert (ROOT / file).read_bytes() == git(ROOT, 'show', root_head + ':' + file)
    full_path = DELIVERY / f'evidence/history-source-regression-{a.full}.json'
    focused_path = DELIVERY / f'evidence/history-source-integration-{a.integration}.json'
    full, focused = suite(full_path, True), suite(focused_path, True)
    assert full['counts']['tests'] >= 765 and focused['counts']['tests'] >= 51
    prior = read(DELIVERY / 'evidence/task-source-regression-01.json')
    assert prior['counts']['tests'] == prior['counts']['pass'] == 746
    prior_raw = bound(DELIVERY, prior['raw_report'])
    assert not names(prior_raw) - names(ROOT / full['raw_report']['path'])
    assert not names(ROOT / focused['raw_report']['path']) - names(ROOT / full['raw_report']['path'])
    preserved = [suite(p) for kind in ('integration', 'regression')
                 for p in sorted((DELIVERY / 'evidence').glob('history-source-' + kind + '-??.json'))]
    original_failure = read(DELIVERY / 'evidence/history-source-integration-02.json')
    assert original_failure['status'] == 'failed' and original_failure['counts']['fail'] == 6
    assert '"conversation_canary":true' in bound(DELIVERY, original_failure['raw_report']).read_text(encoding='utf-8')
    baseline_platform = '0e0cc8c1ba923b151e1e79ac8bd1db44acfa7d93'
    old_sql = git(PLATFORM, 'ls-tree', '-r', '--name-only', baseline_platform, '--', 'migrations').decode().splitlines()
    assert len(old_sql) == 81
    for file in old_sql:
        assert (PLATFORM / file).read_bytes() == git(PLATFORM, 'show', baseline_platform + ':' + file)
    for version, attempt in ((82, '04'), (83, '05'), (84, '07'), (85, '09'), (86, '11'), (87, '12')):
        file = next((PLATFORM / 'migrations').glob(f'{version:03}-*.sql'))
        first = read(DELIVERY / f'evidence/history-source-integration-{attempt}.json')
        assert digest(file) == first['source_files']['migrations/' + file.name]
        assert f'applied migration {version}' in bound(DELIVERY, first['raw_report']).read_text(encoding='utf-8')
    clients_path = DELIVERY / f'evidence/history-source-clients-{a.clients}.json'
    clients = read(clients_path)
    assert clients['status'] == 'passed' and clients['source_unchanged'] and len(clients['checks']) == 13
    bound(DELIVERY, clients['verifier'])
    for check in clients['checks']:
        assert check['exit_code'] == 0 and digest(DELIVERY / check['raw_report']) == check['raw_sha256']
        if check['counts']:
            assert check['counts']['tests'] == check['counts']['pass'] > 0
            assert not sum(check['counts'][k] for k in ('fail', 'cancelled', 'skipped', 'todo'))
    source_current(clients['source_files'], 'components')
    upgrade_path = DELIVERY / f'evidence/history-source-upgrade-{a.upgrade}.json'
    before_path = DELIVERY / f'evidence/history-source-migrations-{a.upgrade}-before.json'
    after_path = DELIVERY / f'evidence/history-source-migrations-{a.upgrade}.json'
    upgrade, before, after = read(upgrade_path), read(before_path), read(after_path)
    assert upgrade['status'] == after['status'] == 'passed' and upgrade['owned_database_shutdown']
    for field in ('verifier',):
        bound(DELIVERY, upgrade[field])
    for entry in upgrade['inputs'] + upgrade['raw_reports']:
        bound(DELIVERY, entry)
    assert after['verifier_sha256'] == before['verifier_sha256'] == digest(DELIVERY / 'scripts/qa-history-source-migrations.mjs')
    assert len(after['databases']) == len(before['databases']) == 2
    for d in after['databases']:
        old = next(x for x in before['databases'] if x['database'] == d['database'])
        assert d['original'] == old['original'] and len(d['original']) == 168
        assert len(d['tables']) == 169 and d['new_source_table_rows'] == 0
        assert len(d['migrations']) == 87 and d['migrations'][:81] == old['migrations']
        assert d['original_migration_bytes'] == old['original_migration_bytes']
        assert all(d['function_definitions'][k] == v for k, v in old['function_definitions'].items())
        assert d['changed_functions'] == [] and len(d['added_functions']) == len(d['functions']) == 10
        assert len(d['additional_policies']) == len(d['additional_triggers']) == 4
        assert d['synthetic_history_added'] is False and d['original_table_ownership_rls_flags_unchanged']
        assert all(f['owner'] == 'cp_control' and f['prosecdef'] and 'row_security=on' in f['proconfig']
                   and not f['queue_execute'] and not f['public_execute'] for f in d['functions'])
        assert all(not role['rolsuper'] and not role['rolbypassrls'] for role in d['roles'])
    artifacts_path = ROOT / 'docs/quality/seo-change-artifacts.json'
    assert artifacts_path.read_bytes() == archive('docs/quality/seo-change-artifacts.json').read_bytes()
    assert artifacts_path.read_bytes() == (DELIVERY / 'evidence/seo-change-artifacts.json').read_bytes()
    for entry in read(artifacts_path)['artifacts']:
        assert digest(DEV / entry['path']) == entry['sha256']
    recheck_path = ROOT / f'docs/quality/history-source-client-recheck-{a.recheck}.json'
    recheck = read(recheck_path)
    assert recheck['status'] == 'passed' and recheck['historical_native_checks'] >= 23
    assert recheck['browsers_or_apps_started'] is recheck['current_backend_ui_qualification'] is False
    assert recheck['manifest_sha256'] == digest(artifacts_path)
    assert recheck['verifier_sha256'] == digest(ROOT / 'docs/tools/verify_history_source_clients.mjs')
    assert recheck['native_journey_sha256'] == digest(DELIVERY / recheck['original_native_journey'])
    scan_path = ROOT / f'docs/quality/history-source-credential-scan-{a.scan}.json'
    scan = read(scan_path)
    assert scan['status'] == 'passed' and scan['configured_patterns'] > 0 and not scan['matches']
    assert scan['verifier_sha256'] == digest(ROOT / 'docs/tools/scan_history_source_credentials.mjs')
    for entry in scan['files']:
        assert digest(ROOT / entry['path']) == entry['sha256']
    normalization_path = ROOT / 'docs/quality/history/stage65-before-lf-tools/manifest.json'
    normalization = read(normalization_path)
    assert len(normalization['files']) == 5
    for entry in normalization['files']:
        original = (ROOT / entry['archive']).read_bytes()
        assert digest(ROOT / entry['archive']) == entry['original_sha256']
        assert hashlib.sha256(original.replace(b'\r\n', b'\n')).hexdigest() == entry['lf_sha256']
        if not entry['path'].endswith('verify_stage65_staged_whitespace.py'):
            assert digest(ROOT / entry['path']) == entry['lf_sha256']
    for filename, source in (
        ('history-source-credential-scan-01.json', 'docs/tools/scan_history_source_credentials.mjs'),
        ('history-source-client-recheck-01.json', 'docs/tools/verify_history_source_clients.mjs'),
    ):
        old = read(ROOT / 'docs/quality' / filename)
        archived = next(e for e in normalization['files'] if e['path'] == source)
        assert old['verifier_sha256'] == archived['original_sha256']
    archived_client = next(e for e in normalization['files'] if e['path'].startswith('dev/'))
    assert digest(DELIVERY / 'evidence/history-source-clients-02-verifier.mjs') == archived_client['original_sha256']
    checkpoint = {
        'at': datetime.now(timezone.utc).isoformat(), 'verifier': receipt(Path(__file__).resolve()),
        'scope': 'Actual file/cloud/dataset reads and fixed historical contexts constrain model input, tool replays, events, plans, results and generated files. Explicit publication freezes known input provenance into independent copies. Actual HTTP SSE closes on revocation; task detail/list state and cost metadata remain readable without revoked bodies. Controlled erasure clears provenance only for verified deleted targets; an unset erasure flag never authorizes an immutable binding change. Existing stale-plan/input-checkpoint errors remain intact. Synthetic AI/business data only; no new native UI or whole-product qualification.',
        'prior_progress': receipt(archive('docs/quality/requirements-alignment-progress.json')),
        'original_scope': {'requirements': 102, 'fully_accepted_requirements': 0, 'qualified_live_roles': 0, 'all_TC_NFR_G01_G10_retained': True},
        'focused': focused, 'full_platform_regression': full, 'previous_746_named_tests_retained': True,
        'client_checks': receipt(clients_path), 'current_platform_sources': read(full_path)['source_files'],
        'local_database_upgrade': {'execution': receipt(upgrade_path), 'before': receipt(before_path), 'after': receipt(after_path)},
        'preserved_suite_executions': preserved, 'prior_client_artifacts': receipt(artifacts_path),
        'current_read_only_client_recheck': receipt(recheck_path), 'current_backend_ui_qualification': False,
        'unchanged_contracts': [receipt(ROOT / file) for file in contracts], 'configured_credential_scan': receipt(scan_path),
        'verifier_line_endings': {'source_archive': receipt(normalization_path),
            'scope': 'LF verifier bytes are bound by the current client/native/credential receipts; exact former verifier bytes and prior execution reports remain preserved. Platform/runtime source qualification remains in the bound regression. The whitespace verifier also accepts an explicit credential scan id.'},
        'remaining': ['Complete canonical TaskDTO/POST /v1/tasks and every original acceptance condition',
                      'Business integration of paid-step native Codex continuation and source footprints not recorded in historical work',
                      'Independent role workflows, GEO, live providers, websites, billing and production deployment',
                      'Current Backend browser/native UI qualification, signed installation/store release and all original TC/NFR/G01-G10'],
    }
    if a.documentation:
        assert re.fullmatch(r'[a-z0-9-]+\.json', a.documentation)
        p = ROOT / 'docs/quality' / a.documentation
        d = read(p)
        assert d['status'] == 'passed' and d['checks_failed'] == 0
        assert d['counts']['requirements'] == d['counts']['acceptance_cases'] == 102
        assert d['verifier_sha256'] == digest(ROOT / 'docs/tools/validate_docs.py')
        checkpoint['documentation_contracts'] = receipt(p)
    updated = json.loads(json.dumps(baseline))
    repair = {'cluster': 'conversation_actual_read_source_lineage', 'verified_subflow': '实际文件、云引用和数据集读取，以及历史结果、固定记忆和计划来源持续受当前授权与保留期约束；独立发布冻结已确认输入来源，正文失效不隐藏任务结算元数据。', 'evidence': ['history_source_verification'], 'implementation_docs': ['technical/65-conversation-content-source-lineage.md']}
    selected = {f'REQ-{n:03}' for n in (6, 8, 10, 11, 12, 24, 43, 49, 61, 63, 68, 69, 90, 91, 92)}
    for row in updated['requirements']:
        if row['requirement_id'] in selected:
            row.setdefault('verified_repairs', []).append(repair)
            row['acceptance_evidence'] = list(dict.fromkeys([*row.get('acceptance_evidence', []), 'history_source_verification']))
    for old, new in zip(baseline['requirements'], updated['requirements']):
        for key in ('requirement_id', 'priority', 'requirement', 'acceptance_case', 'acceptance_conditions', 'original_finding'):
            assert old[key] == new[key]
    assert updated['gates'] == baseline['gates'] and updated['nfr_full_acceptance'] == baseline['nfr_full_acceptance']
    updated['at'] = checkpoint['at']
    updated['summary'] = dict(Counter(row['assessment'] for row in updated['requirements']))
    assert updated['summary'] == {'partial_verified': 81, 'completion_not_proven': 21}
    updated['history_source_verification'] = checkpoint
    updated['evidence']['platform_regression'] = full
    updated['evidence_currentness_policy'] += ' Stage65: actual-read and retained-content source lineage binds current Backend/regression evidence. Stage64 and earlier UI/native/contracts retain their historical Backend source snapshots. Native artifact verification is read-only; no historical reads, original acceptance or failed runs are rewritten.'
    if a.write:
        for p, value in ((ROOT / 'docs/quality/history-source-checkpoint.json', checkpoint), (ROOT / 'docs/quality/requirements-alignment-progress.json', updated)):
            p.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': 'passed', 'write': a.write, 'full': full['counts'], 'focused': focused['counts'], 'summary': updated['summary'], 'fully_accepted_requirements': 0}))


if __name__ == '__main__':
    main()
