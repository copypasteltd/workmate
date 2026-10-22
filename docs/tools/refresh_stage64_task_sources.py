"""Bind current source fences without relabelling historical native/UI proofs."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import re

from refresh_stage52_capabilities import ROOT, DEV, PLATFORM, DELIVERY, OPENAPI_SHA, digest, git, read, receipt
from refresh_stage62_scoped_seo import bound, cleanup, suite, names
from refresh_stage63_seo_changes import source_current


def main():
    parser = argparse.ArgumentParser()
    for key in ('integration', 'full', 'clients', 'upgrade', 'scan', 'recheck'):
        parser.add_argument('--' + key, required=True)
    parser.add_argument('--documentation')
    parser.add_argument('--write', action='store_true')
    a = parser.parse_args()
    assert all(re.fullmatch(r'\d{2}', getattr(a, key)) for key in ('integration', 'full', 'clients', 'upgrade', 'scan', 'recheck'))
    history = ROOT / 'docs/quality/history/stage63-before-task-sources'
    manifest = read(history / 'manifest.json')
    assert len(manifest['files']) == 22
    for entry in manifest['files']:
        archive = ROOT / entry['archive']
        assert digest(archive) == entry['sha256']
        assert archive.read_bytes() == git(ROOT / entry['repository'], 'show', entry['baseline_commit'] + ':' + entry['repository_path'])
    archive = lambda p: ROOT / next(e['archive'] for e in manifest['files'] if e['path'] == p)
    baseline = read(archive('docs/quality/requirements-alignment-progress.json'))
    assert len(baseline['requirements']) == 102
    assert baseline['fully_accepted_requirements'] == baseline['qualified_live_roles'] == 0
    assert digest(ROOT / 'docs/contracts/openapi.json') == OPENAPI_SHA
    # Prior supplemental contracts describe their original source snapshots.
    # A changed Backend must not silently rewrite those provenance claims.
    contract_paths = ('docs/contracts/openapi.json', 'docs/contracts/scoped-seo-openapi.json', 'docs/contracts/seo-change-tasks-openapi.json')
    root_head = next(e['baseline_commit'] for e in manifest['files'] if e['path'] == 'docs/README.md')
    for file in contract_paths:
        assert (ROOT / file).read_bytes() == git(ROOT, 'show', root_head + ':' + file)
    prior_path = DELIVERY / 'evidence/seo-change-regression-02.json'
    prior = read(prior_path)
    assert prior['counts']['tests'] == prior['counts']['pass'] == 734
    prior_raw = bound(DELIVERY, prior['raw_report'])
    full_path = DELIVERY / f'evidence/task-source-regression-{a.full}.json'
    focused_path = DELIVERY / f'evidence/task-source-integration-{a.integration}.json'
    full, focused = suite(full_path, True), suite(focused_path, True)
    assert full['counts']['tests'] >= 746 and focused['counts']['tests'] >= 12
    assert not names(prior_raw) - names(ROOT / full['raw_report']['path'])
    assert not names(ROOT / focused['raw_report']['path']) - names(ROOT / full['raw_report']['path'])
    preserved = [suite(p) for kind in ('integration', 'regression')
                 for p in sorted((DELIVERY / 'evidence').glob('task-source-' + kind + '-??.json'))]
    baseline_run = read(DELIVERY / 'evidence/task-source-integration-01.json')
    assert baseline_run['status'] == 'failed' and baseline_run['counts']['tests'] == baseline_run['counts']['fail'] == 7
    assert read(DELIVERY / 'evidence/task-source-integration-03.json')['status'] == 'failed'
    # Preserve every applied historical migration; SQL081 first succeeded in 02.
    prior_platform = 'b270ad7f0f11d8c91012a20edb78eb542f2774fa'
    sql_files = git(PLATFORM, 'ls-tree', '-r', '--name-only', prior_platform, '--', 'migrations').decode().splitlines()
    assert len(sql_files) == 80
    for file in sql_files:
        assert (PLATFORM / file).read_bytes() == git(PLATFORM, 'show', prior_platform + ':' + file)
    sql81 = next((PLATFORM / 'migrations').glob('081-*.sql'))
    first_sql81 = read(DELIVERY / 'evidence/task-source-integration-02.json')
    assert first_sql81['status'] == 'passed'
    assert digest(sql81) == first_sql81['source_files']['migrations/' + sql81.name]
    clients_path = DELIVERY / f'evidence/task-source-clients-{a.clients}.json'
    clients = read(clients_path)
    assert clients['status'] == 'passed' and clients['source_unchanged'] and len(clients['checks']) == 13
    bound(DELIVERY, clients['verifier'])
    for check in clients['checks']:
        assert check['exit_code'] == 0 and digest(DELIVERY / check['raw_report']) == check['raw_sha256']
        if check['counts']:
            assert check['counts']['tests'] == check['counts']['pass'] > 0
            assert not sum(check['counts'][k] for k in ('fail', 'cancelled', 'skipped', 'todo'))
    source_current(clients['source_files'], 'components')
    upgrade_path = DELIVERY / f'evidence/task-source-upgrade-{a.upgrade}.json'
    before_path = DELIVERY / f'evidence/task-source-migrations-{a.upgrade}-before.json'
    after_path = DELIVERY / f'evidence/task-source-migrations-{a.upgrade}.json'
    upgrade, before, after = read(upgrade_path), read(before_path), read(after_path)
    assert upgrade['status'] == after['status'] == 'passed' and upgrade['owned_database_shutdown']
    bound(DELIVERY, upgrade['verifier'])
    for entry in upgrade['inputs'] + upgrade['raw_reports']:
        bound(DELIVERY, entry)
    assert after['verifier_sha256'] == before['verifier_sha256'] == digest(DELIVERY / 'scripts/qa-task-source-migrations.mjs')
    assert len(after['databases']) == len(before['databases']) == 2
    for d in after['databases']:
        old = next(x for x in before['databases'] if x['database'] == d['database'])
        assert d['original'] == old['original'] and len(d['original']) == 168
        assert d['tables'] == old['tables'] and d['original_migration_bytes'] == old['original_migration_bytes']
        assert len(d['migrations']) == 81 and d['migrations'][:80] == old['migrations']
        assert d['synthetic_history_added'] is False and d['unchanged_table_definitions_and_rls'] is True
        assert set(d['function_definitions']) == set(old['function_definitions'])
        changed = [k for k, v in d['function_definitions'].items() if v != old['function_definitions'][k]]
        assert changed == d['changed_functions'] == ['analysis_report_available(uuid)', 'analysis_report_owned(uuid)']
        assert len(d['functions']) == 2 and all(f['owner'] == 'cp_control' and f['prosecdef'] and 'row_security=on' in f['proconfig'] and f['app_execute'] and not f['queue_execute'] and not f['public_execute'] for f in d['functions'])
        assert len(d['roles']) == 3 and all(not r['rolsuper'] and not r['rolbypassrls'] for r in d['roles'])
    artifacts_path = ROOT / 'docs/quality/seo-change-artifacts.json'
    assert artifacts_path.read_bytes() == archive('docs/quality/seo-change-artifacts.json').read_bytes()
    assert artifacts_path.read_bytes() == (DELIVERY / 'evidence/seo-change-artifacts.json').read_bytes()
    artifacts = read(artifacts_path)
    for entry in artifacts['artifacts']:
        assert digest(DEV / entry['path']) == entry['sha256']
    recheck_path = ROOT / f'docs/quality/task-source-client-recheck-{a.recheck}.json'
    recheck = read(recheck_path)
    assert recheck['status'] == 'passed' and recheck['historical_native_checks'] >= 23
    assert recheck['browsers_or_apps_started'] is recheck['current_backend_ui_qualification'] is False
    assert recheck['manifest_sha256'] == digest(artifacts_path)
    assert recheck['verifier_sha256'] == digest(ROOT / 'docs/tools/verify_task_source_clients.mjs')
    native_path = DELIVERY / recheck['original_native_journey']
    assert recheck['native_journey_sha256'] == digest(native_path)
    native = read(native_path)
    assert native['status'] == 'passed' and len(native['checks']) >= 23 and not native['errors']
    assert native['desktop_closed'] and native['extension_closed'] and native['browser_closed'] and native['owned_api_closed']
    scan_path = ROOT / f'docs/quality/task-source-credential-scan-{a.scan}.json'
    scan = read(scan_path)
    assert scan['status'] == 'passed' and scan['configured_patterns'] > 0 and not scan['matches']
    assert scan['verifier_sha256'] == digest(ROOT / 'docs/tools/scan_task_source_credentials.mjs')
    for entry in scan['files']:
        assert digest(ROOT / entry['path']) == entry['sha256']
    checkpoint = {
        'at': datetime.now(timezone.utc).isoformat(),
        'scope': 'Current analysis/SEO task detail, list, historical JSON and both actual HTTP SSE routes share current source and identity fences; open streams close without later model deltas. Dataset/original CSV/output/task retention is authoritative before cleanup or new budget reservation. Real locked Codex uses only the internal synthetic gateway. Historical native package bytes are rechecked read-only, with no new Backend UI qualification or full-product acceptance.',
        'verifier': receipt(Path(__file__).resolve()),
        'prior_progress': receipt(archive('docs/quality/requirements-alignment-progress.json')),
        'original_scope': {'requirements': 102, 'fully_accepted_requirements': 0, 'qualified_live_roles': 0, 'all_TC_NFR_G01_G10_retained': True},
        'focused': focused, 'full_platform_regression': full,
        'previous_734_named_tests_retained': True,
        'client_checks': receipt(clients_path),
        'local_database_upgrade': {'execution': receipt(upgrade_path), 'before': receipt(before_path), 'after': receipt(after_path)},
        'current_platform_sources': read(full_path)['source_files'],
        'preserved_suite_executions': preserved,
        'prior_client_artifacts': receipt(artifacts_path),
        'current_read_only_client_recheck': receipt(recheck_path),
        'current_backend_ui_qualification': False,
        'unchanged_contracts': [receipt(ROOT / f) for f in contract_paths],
        'configured_credential_scan': receipt(scan_path),
        'remaining': [
            'Complete canonical TaskDTO/POST /v1/tasks and every original acceptance condition',
            'Audit source lineage and retained messages of continuations and other original task categories separately',
            'REQ-030 frozen GEO observations, Search Console metrics inside scoped audits and full independent role workflows',
            'Separately authorized website/CMS implementation, live providers/websites and public DNS/TLS deployment',
            'New Backend browser/native journey, installer/signing/store/production qualification and original TC/NFR/G01-G10',
        ],
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
    repair = {'cluster': 'current_report_task_source_fences', 'verified_subflow': '原始分析/SEO 报告与通用详情、列表、JSON 历史消息及两种实际 HTTP SSE 共用当前来源限制；已开流复查来源和身份，失效后不再发送新增模型正文。原始 CSV、数据集、报告产物和分析任务的保留期在清理前生效，过期输入不能创建任务或预留预算。', 'evidence': ['task_source_verification'], 'implementation_docs': ['technical/64-task-source-visibility.md']}
    selected = {f'REQ-{n:03}' for n in (4, 8, 10, 12, 24, 29, 43, 90, 91, 94)}
    for row in updated['requirements']:
        if row['requirement_id'] in selected:
            row.setdefault('verified_repairs', []).append(repair)
            row['acceptance_evidence'] = list(dict.fromkeys([*row.get('acceptance_evidence', []), 'task_source_verification']))
    for old, new in zip(baseline['requirements'], updated['requirements']):
        for key in ('requirement_id', 'priority', 'requirement', 'acceptance_case', 'acceptance_conditions', 'original_finding'):
            assert old[key] == new[key]
    assert updated['gates'] == baseline['gates'] and updated['nfr_full_acceptance'] == baseline['nfr_full_acceptance']
    updated['at'] = checkpoint['at']
    updated['summary'] = dict(Counter(r['assessment'] for r in updated['requirements']))
    assert updated['summary'] == {'partial_verified': 81, 'completion_not_proven': 21}
    updated['task_source_verification'] = checkpoint
    updated['evidence']['platform_regression'] = full
    updated['evidence_currentness_policy'] += ' Stage64: current report/task source fences are bound to new HTTP/Worker/Codex and regression receipts. Stage63 UI/native and supplemental contract provenance retain their original Backend scope; current client/package verification is read-only. Original acceptance and all failed runs remain unchanged.'
    if a.write:
        for p, value in ((ROOT / 'docs/quality/task-source-checkpoint.json', checkpoint), (ROOT / 'docs/quality/requirements-alignment-progress.json', updated)):
            p.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': 'passed', 'write': a.write, 'full': full['counts'], 'focused': focused['counts'], 'new_backend_ui_qualification': False, 'summary': updated['summary'], 'fully_accepted_requirements': 0}))


if __name__ == '__main__':
    main()
