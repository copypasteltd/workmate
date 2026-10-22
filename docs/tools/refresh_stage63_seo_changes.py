"""Bind saved change-task evidence without reducing the original product scope."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from jsonschema import Draft202012Validator, FormatChecker
from refresh_stage52_capabilities import ROOT, DEV, PLATFORM, DELIVERY, OPENAPI_SHA, digest, git, read, receipt
from refresh_stage62_scoped_seo import bound, cleanup, suite, names


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


def runtime(kind, number, minimum, schemas):
    p = DELIVERY / f'evidence/seo-change-{kind}-{number}.json'
    r = read(p)
    assert r['status'] == 'passed' and r['source_unchanged'] and r['owned_database_shutdown']
    assert r['web_build_unchanged'] and r['owned_web_preview_closed']
    for field in ('journey', 'verifier', 'journey_verifier', 'raw_report'):
        bound(DELIVERY, r[field])
    cleanup(r['fixture_cleanup'])
    j = read(DELIVERY / r['journey']['path'])
    assert j['status'] == 'passed' and len(j['checks']) >= minimum and not j['errors']
    assert j['browser_closed'] and j['owned_api_closed']
    source_current(r['source_files'], 'prefixed')
    for image in j['screenshots']:
        assert digest(DEV / image['path']) == image['sha256'] and image['edited'] is False
    if kind == 'ui':
        assert r['admin_build_unchanged'] and r['owned_admin_preview_closed']
        for sample in j['samples']:
            Draft202012Validator({'$defs': schemas, '$ref': '#/$defs/' + sample['schema']}, format_checker=FormatChecker()).validate(sample['response'])
        required = {'SeoChange', 'SeoChangeList', 'SeoChangeDetail', 'SeoChangeDraft'}
        assert required <= {s['schema'] for s in j['samples']}
    else:
        assert j['desktop_closed'] and j['extension_closed'] and j['artifacts_unchanged_after_run']
        assert j['inspection']['extension']['side'] == 'right'
        assert j['inspection']['extension']['native_context_type'] == 'SIDE_PANEL'
        change = j['inspection']['seo_change']
        assert change['website_modified'] is False
        assert {d['format'] for d in change['downloads']} == {'json', 'html'}
        assert all(d['actual_native_save'] for d in change['downloads'])
    return {**receipt(p), 'actual_checks': len(j['checks']), 'actual_response_samples': len(j.get('samples', []))}


def main():
    parser = argparse.ArgumentParser()
    for key in ('full', 'ui', 'native', 'clients', 'upgrade', 'scan'):
        parser.add_argument('--' + key, required=True)
    parser.add_argument('--documentation')
    parser.add_argument('--write', action='store_true')
    a = parser.parse_args()
    assert all(re.fullmatch(r'\d{2}', getattr(a, key)) for key in ('full', 'ui', 'native', 'clients', 'upgrade', 'scan'))
    history = ROOT / 'docs/quality/history/stage62-before-seo-changes'
    manifest = read(history / 'manifest.json')
    for entry in manifest['files']:
        data = (ROOT / entry['archive']).read_bytes()
        assert digest(ROOT / entry['archive']) == entry['sha256']
        assert data == git(ROOT / entry['repository'], 'show', entry['baseline_commit'] + ':' + entry['repository_path'])
    archive = lambda p: ROOT / next(e['archive'] for e in manifest['files'] if e['path'] == p)
    baseline = read(archive('docs/quality/requirements-alignment-progress.json'))
    assert len(baseline['requirements']) == 102 and baseline['fully_accepted_requirements'] == baseline['qualified_live_roles'] == 0
    assert digest(ROOT / 'docs/contracts/openapi.json') == OPENAPI_SHA
    full_path = DELIVERY / f'evidence/seo-change-regression-{a.full}.json'
    full = suite(full_path, True)
    assert full['counts']['tests'] >= 734
    original = read(DELIVERY / 'evidence/scoped-seo-regression-01.json')
    assert original['counts']['tests'] == 716
    bound(DELIVERY, original['raw_report'])
    assert not names(DELIVERY / original['raw_report']['path']) - names(DELIVERY / read(full_path)['raw_report']['path'])
    preserved = []
    for kind in ('integration', 'regression'):
        for p in sorted((DELIVERY / 'evidence').glob('seo-change-' + kind + '-??.json')):
            preserved.append(suite(p))
    api_path = ROOT / 'docs/contracts/seo-change-tasks-openapi.json'
    api, seo = read(api_path), read(ROOT / 'docs/contracts/scoped-seo-openapi.json')
    assert api['x-normative-source-sha256'] == OPENAPI_SHA
    assert api['x-scoped-seo-contract-sha256'] == digest(ROOT / 'docs/contracts/scoped-seo-openapi.json')
    source_current(api['x-platform-source-sha256'], 'platform')
    assert sum(len(v) for v in api['paths'].values()) == 4 and len(api['components']['schemas']) == 7
    assert api['components']['schemas']['SeoFinding'] == seo['components']['schemas']['SeoFinding']
    assert api['components']['schemas']['SeoCoverage'] == seo['components']['schemas']['SeoCoverage']
    schemas = json.loads(json.dumps({**seo['components']['schemas'], **api['components']['schemas']}).replace('#/components/schemas/', '#/$defs/'))
    for name in schemas:
        Draft202012Validator.check_schema({'$defs': schemas, '$ref': '#/$defs/' + name})
    actual_ui = runtime('ui', a.ui, 18, schemas)
    actual_native = runtime('native', a.native, 23, schemas)
    past_runtime = []
    for kind in ('ui', 'native'):
        for p in sorted((DELIVERY / 'evidence').glob('seo-change-' + kind + '-??.json')):
            r = read(p)
            for field in ('verifier', 'journey_verifier', 'raw_report'):
                bound(DELIVERY, r[field])
            if r.get('journey'):
                bound(DELIVERY, r['journey'])
            past_runtime.append({**receipt(p), 'status': r['status'], 'actual_checks': r['counts']['checks'], 'current_qualification': p.name in {f'seo-change-ui-{a.ui}.json', f'seo-change-native-{a.native}.json'}})
    clients_path = DELIVERY / f'evidence/seo-change-clients-{a.clients}.json'
    clients = read(clients_path)
    assert clients['status'] == 'passed' and clients['source_unchanged'] and len(clients['checks']) == 13
    bound(DELIVERY, clients['verifier'])
    for check in clients['checks']:
        assert check['exit_code'] == 0 and digest(DELIVERY / check['raw_report']) == check['raw_sha256']
    source_current(clients['source_files'], 'components')
    upgrade_path = DELIVERY / f'evidence/seo-change-upgrade-{a.upgrade}.json'
    before_path = DELIVERY / f'evidence/seo-change-migrations-{a.upgrade}-before.json'
    after_path = DELIVERY / f'evidence/seo-change-migrations-{a.upgrade}.json'
    upgrade, before, after = read(upgrade_path), read(before_path), read(after_path)
    assert upgrade['status'] == after['status'] == 'passed' and upgrade['owned_database_shutdown']
    bound(DELIVERY, upgrade['verifier'])
    for entry in upgrade['inputs'] + upgrade['raw_reports']:
        bound(DELIVERY, entry)
    assert len(after['databases']) == 2
    for d in after['databases']:
        previous = next(x for x in before['databases'] if x['database'] == d['database'])
        assert d['original'] == previous['original'] and len(d['original']) == 167
        assert len(d['migrations']) == 80 and d['migrations'][:79] == previous['migrations']
        assert d['synthetic_history_added'] is False and set(d['controls']) == {'seo_change_tasks'}
        assert all(x['count'] == 0 and x['rls']['relforcerowsecurity'] for x in d['controls'].values())
    sql_files = git(PLATFORM, 'ls-tree', '-r', '--name-only', '830ccfb20ed8beb1a5893dc8888ebe53ad6f4ec9', '--', 'migrations').decode().splitlines()
    assert len(sql_files) == 79
    for file in sql_files:
        assert (PLATFORM / file).read_bytes() == git(PLATFORM, 'show', '830ccfb20ed8beb1a5893dc8888ebe53ad6f4ec9:' + file)
    sql80 = next((PLATFORM / 'migrations').glob('080-*.sql'))
    assert digest(sql80) == read(DELIVERY / 'evidence/seo-change-integration-02.json')['source_files']['migrations/' + sql80.name]
    artifacts_path = ROOT / 'docs/quality/seo-change-artifacts.json'
    artifacts = read(artifacts_path)
    assert artifacts_path.read_bytes() == (DELIVERY / 'evidence/seo-change-artifacts.json').read_bytes()
    assert artifacts['status'] == 'passed' and artifacts['prior_client_packages_unchanged']
    for entry in artifacts['artifacts']:
        assert digest(DEV / entry['path']) == entry['sha256']
    recheck_path = ROOT / 'docs/quality/seo-change-client-recheck-01.json'
    recheck = read(recheck_path)
    assert recheck['status'] == 'passed' and recheck['native_checks'] >= 23 and recheck['browsers_or_apps_started'] is False
    assert recheck['manifest_sha256'] == digest(artifacts_path)
    assert recheck['verifier_sha256'] == digest(ROOT / 'docs/tools/verify_seo_change_clients.mjs')
    scan_path = ROOT / f'docs/quality/seo-change-credential-scan-{a.scan}.json'
    scan = read(scan_path)
    assert scan['status'] == 'passed' and scan['configured_patterns'] > 0 and not scan['matches']
    assert scan['verifier_sha256'] == digest(ROOT / 'docs/tools/scan_seo_change_credentials.mjs')
    for entry in scan['files']:
        assert digest(ROOT / entry['path']) == entry['sha256']
    checkpoint = {
        'at': datetime.now(timezone.utc).isoformat(),
        'scope': 'Saved original-finding website change tasks, separate frozen budget/skills/capabilities, actual Codex paginated facts via the internal synthetic gateway, immutable manual-review JSON/escaped HTML, current private-source lifecycle, ordinary task controls, actual Web/Admin and newly packaged frameless Desktop/right native Side Panel. No CMS write or production/full product qualification.',
        'verifier': receipt(Path(__file__).resolve()),
        'prior_progress': receipt(archive('docs/quality/requirements-alignment-progress.json')),
        'original_scope': {'requirements': 102, 'fully_accepted_requirements': 0, 'qualified_live_roles': 0, 'all_TC_NFR_G01_G10_retained': True},
        'full_platform_regression': full, 'previous_716_named_tests_retained': True,
        'actual_web_admin': actual_ui, 'actual_native_clients': actual_native,
        'client_checks': receipt(clients_path), 'supplemental_contract': receipt(api_path), 'contract_operations': 4, 'contract_schemas': 7,
        'local_database_upgrade': {'execution': receipt(upgrade_path), 'before': receipt(before_path), 'after': receipt(after_path)},
        'current_platform_sources': read(full_path)['source_files'],
        'preserved_suite_executions': preserved, 'preserved_runtime_executions': past_runtime,
        'client_artifacts': receipt(artifacts_path), 'current_client_recheck': receipt(recheck_path), 'configured_credential_scan': receipt(scan_path),
        'remaining': [
            'Complete canonical TaskDTO/POST /v1/tasks and every original acceptance condition',
            'Runtime-check historical model events of original audits and other report types after source quarantine/expiry; this stage explicitly fences the newly saved change tasks at generic task/event/SSE entry points',
            'Separately authorized website/CMS implementation, live website/public DNS/TLS deployment and complete TC-029',
            'Search Console connection metrics inside the scoped audit; current HTML collection still rejects connection_id',
            'REQ-030 frozen GEO observations and complete independent professional/marketing-role workflows',
            'Installer/signing/store/production systems and original TC/NFR/G01-G10',
        ],
    }
    updated = json.loads(json.dumps(baseline))
    repair = {'cluster': 'source_governed_website_change_tasks', 'verified_subflow': '从冻结问题保存独立私有修改任务，确认独立预算；Codex 分页读取已选事实，严格引用校验并生成不可变 JSON/转义 HTML；当前来源/缓存祖先/隔离/保留期/撤权和物理删除治理，实际 Web/Admin、无边框 Desktop 原生保存与右侧 Chrome Side Panel。网站未写回，复查须明确发起。', 'evidence': ['seo_change_verification'], 'implementation_docs': ['technical/63-source-governed-website-change-tasks.md']}
    selected = {f'REQ-{n:03}' for n in (4,8,10,12,24,29,39,43,90,91,92,93,94,95,96)}
    for row in updated['requirements']:
        if row['requirement_id'] in selected:
            row.setdefault('verified_repairs', []).append(repair)
            row['acceptance_evidence'] = list(dict.fromkeys([*row.get('acceptance_evidence', []), 'seo_change_verification']))
        if row['requirement_id'] == 'REQ-029':
            row['finding'] = '已验证范围诊断、逐 URL 原文、来源治理的修改任务、Codex 草稿和明确复查的模拟子流程；网站未自动修改，完整 TC-029 保留。'
            row['acceptance_case_execution'] = 'local_synthetic_scoped_seo_and_saved_change_subflows_passed'
            row['remaining_complete_acceptance_conditions'] = '正式站点、公网 DNS/TLS、单独授权的网站/CMS 写回、规范 TaskDTO、Search Console 连接指标及完整业务验收；全部原 TC/NFR/G01–G10 继续跟踪。'
    for old, new in zip(baseline['requirements'], updated['requirements']):
        for key in ('requirement_id','priority','requirement','acceptance_case','acceptance_conditions','original_finding'):
            assert old[key] == new[key]
    assert updated['gates'] == baseline['gates'] and updated['nfr_full_acceptance'] == baseline['nfr_full_acceptance']
    updated['at'] = checkpoint['at']
    updated['summary'] = dict(Counter(r['assessment'] for r in updated['requirements']))
    assert updated['summary'] == {'partial_verified':81,'completion_not_proven':21}
    updated['seo_change_verification'] = checkpoint
    updated['evidence']['platform_regression'] = full
    updated['evidence_currentness_policy'] += ' Stage63: source-governed saved change drafts and current Web/Admin/packaged native clients are bound separately; stage62 receipts retain their historical sources, all failures and original complete acceptance remain unchanged.'
    if a.documentation:
        assert re.fullmatch(r'[a-z0-9-]+\.json', a.documentation)
        p = ROOT / 'docs/quality' / a.documentation
        d = read(p)
        assert d['status'] == 'passed' and d['checks_failed'] == 0
        assert d['counts']['requirements'] == d['counts']['acceptance_cases'] == 102
        assert d['verifier_sha256'] == digest(ROOT / 'docs/tools/validate_docs.py')
        checkpoint['documentation_contracts'] = receipt(p)
    if a.write:
        for p, value in ((ROOT/'docs/quality/seo-change-checkpoint.json', checkpoint),(ROOT/'docs/quality/requirements-alignment-progress.json',updated)):
            p.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status':'passed','write':a.write,'full':full['counts'],'actual_web_admin':actual_ui['actual_checks'],'actual_native':actual_native['actual_checks'],'summary':updated['summary'],'fully_accepted_requirements':0}))


if __name__ == '__main__':
    main()
