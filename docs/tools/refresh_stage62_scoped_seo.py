"""Bind the executed SEO subflows without relaxing original product acceptance."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from jsonschema import Draft202012Validator, FormatChecker
from refresh_stage52_capabilities import ROOT, DEV, PLATFORM, DELIVERY, OPENAPI_SHA, digest, git, read, receipt


def bound(parent, entry):
    p = parent / entry['path']
    assert digest(p) == entry['sha256'], str(p)
    return p


def cleanup(data):
    proof = read(bound(DELIVERY, data))
    assert proof['status'] == 'passed' and proof['workers_exited'] and proof['actual_filesystem_checked']
    assert all(r['reclaimed'] for r in proof['results'])


def suite(path, current=False):
    r = read(path)
    raw = bound(DELIVERY, r['raw_report'])
    bound(DELIVERY, r['verifier'])
    counts = {key: int(re.search(r'^# '+key+r' (\d+)\r?$', raw.read_text(encoding='utf-8'), re.M).group(1))
              for key in ('tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo')}
    assert counts == r['counts'] and counts['tests'] == counts['pass'] + counts['fail']
    assert r['source_unchanged']
    if 'owned_database_shutdown' in r:
        assert r['owned_database_shutdown'] and r['database_shutdown_exit_code'] == 0
        cleanup(r['fixture_cleanup'])
        bound(DELIVERY, r['database_log'])
    manifest = DELIVERY / (r.get('source_preimages') or r['preimages']['path'])
    for f in read(manifest)['files']:
        assert digest(DELIVERY/f['path']) == f['sha256'] == r['source_files'][f['source']]
    if current:
        assert r['status'] == 'passed' and r['exit_code'] == 0
        assert counts['tests'] == counts['pass'] and not sum(counts[k] for k in ('fail', 'cancelled', 'skipped', 'todo'))
        for file, expected in r['source_files'].items():
            assert digest(PLATFORM/file) == expected, file
    return {**receipt(path), 'status': r['status'], 'counts': counts, 'raw_report': receipt(raw)}


def names(path):
    return Counter(re.findall(r'^\s*(?:ok|not ok) \d+ - (.+?)\r?$', path.read_text(encoding='utf-8'), re.M))


def main():
    parser = argparse.ArgumentParser()
    for key in ('integration', 'full', 'ui', 'native', 'clients', 'upgrade', 'scan'):
        parser.add_argument('--'+key, required=True)
    parser.add_argument('--documentation')
    parser.add_argument('--write', action='store_true')
    a = parser.parse_args()
    assert all(re.fullmatch(r'\d{2}', getattr(a, key)) for key in ('integration', 'full', 'ui', 'native', 'clients', 'upgrade', 'scan'))
    history = ROOT/'docs/quality/history/stage61-before-scoped-seo'
    for entry in read(history/'manifest.json')['files']:
        archive = ROOT/entry['archive']
        assert digest(archive) == entry['sha256']
        assert archive.read_bytes() == git(ROOT, 'show', '2821b9578debfa412fa1d59a80f5238265a35b19:'+entry['path'])
    baseline = read(history/'requirements-alignment-progress.json')
    assert len(baseline['requirements']) == 102 and baseline['fully_accepted_requirements'] == baseline['qualified_live_roles'] == 0
    assert digest(ROOT/'docs/contracts/openapi.json') == OPENAPI_SHA
    integration_path = DELIVERY/f'evidence/scoped-seo-integration-{a.integration}.json'
    full_path = DELIVERY/f'evidence/scoped-seo-regression-{a.full}.json'
    integration, full = suite(integration_path, True), suite(full_path, True)
    assert integration['counts']['tests'] >= 45 and full['counts']['tests'] >= 716
    old = read(DELIVERY/'evidence/marketing-connectors-regression-01.json')
    assert old['counts']['tests'] == 674 and digest(DELIVERY/old['raw_report']) == old['raw_sha256']
    assert not names(DELIVERY/old['raw_report']) - names(ROOT/full['raw_report']['path'])
    assert not names(ROOT/integration['raw_report']['path']) - names(ROOT/full['raw_report']['path'])
    preserved = []
    for kind in ('core', 'integration', 'regression'):
        for p in sorted((DELIVERY/'evidence').glob('scoped-seo-'+kind+'-??.json')):
            preserved.append(suite(p))
    api_path = ROOT/'docs/contracts/scoped-seo-openapi.json'
    api = read(api_path)
    assert api_path.read_bytes() == (PLATFORM/'contracts/scoped-seo-openapi.json').read_bytes()
    assert api['x-normative-source-sha256'] == OPENAPI_SHA
    assert api['x-model-source-sha256'] == digest(PLATFORM/'src/seo-model.ts')
    assert api['x-route-source-sha256'] == digest(PLATFORM/'src/seo-audits.ts')
    assert sum(len(v) for v in api['paths'].values()) == 8 and len(api['components']['schemas']) == 14
    runtime, failed_runtime = [], []
    for kind, number, minimum in (('ui', a.ui, 13), ('native', a.native, 20)):
        p = DELIVERY/f'evidence/scoped-seo-{kind}-{number}.json'
        r = read(p)
        assert r['status'] == 'passed' and r['source_unchanged'] and r['owned_database_shutdown']
        assert r['web_build_unchanged'] and r['owned_web_preview_closed']
        for key in ('journey', 'verifier', 'journey_verifier', 'raw_report'):
            bound(DELIVERY, r[key])
        j = read(DELIVERY/r['journey']['path'])
        assert j['status'] == 'passed' and len(j['checks']) >= minimum and not j['errors'] and j['browser_closed'] and j['owned_api_closed']
        cleanup(r['fixture_cleanup'])
        for file, expected in r['source_files'].items():
            assert digest((ROOT if file.startswith('docs/') else DEV)/file) == expected, file
        for image in j['screenshots']:
            assert digest(DEV/image['path']) == image['sha256'] and image['edited'] is False
        if kind == 'ui':
            assert r['admin_build_unchanged'] and r['owned_admin_preview_closed']
            assert j['supplemental_contract_sha256'] == digest(api_path)
            defs = json.loads(json.dumps(api['components']['schemas']).replace('#/components/schemas/', '#/$defs/'))
            assert len(j['samples']) >= 11
            for sample in j['samples']:
                Draft202012Validator({'$defs': defs, '$ref': '#/$defs/'+sample['schema']}, format_checker=FormatChecker()).validate(sample['response'])
        else:
            assert j['desktop_closed'] and j['extension_closed'] and j['artifacts_unchanged_after_run']
            assert j['inspection']['seo']['actual_native_save']
            assert j['inspection']['extension']['side'] == 'right' and j['inspection']['extension']['native_context_type'] == 'SIDE_PANEL'
        runtime.append({**receipt(p), 'actual_checks': len(j['checks']), 'actual_response_samples': len(j.get('samples', []))})
        for failed_path in sorted((DELIVERY/'evidence').glob('scoped-seo-'+kind+'-??.json')):
            failed = read(failed_path)
            if failed['status'] == 'passed':
                continue
            for key in ('verifier', 'journey_verifier', 'raw_report'):
                bound(DELIVERY, failed[key])
            failed_runtime.append({**receipt(failed_path), 'qualified': False, 'passing_checks': failed['counts']['checks']})
    clients_path = DELIVERY/f'evidence/scoped-seo-clients-{a.clients}.json'
    clients = read(clients_path)
    assert clients['status'] == 'passed' and clients['source_unchanged'] and len(clients['checks']) == 13
    bound(DELIVERY, clients['verifier'])
    for check in clients['checks']:
        assert check['exit_code'] == 0 and digest(DELIVERY/check['raw_report']) == check['raw_sha256']
    for file, expected in clients['source_files'].items():
        repo, relative = file.split('/', 1)
        assert digest(DEV/('copypaste-'+repo)/relative) == expected, file
    upgrade_path = DELIVERY/f'evidence/scoped-seo-upgrade-{a.upgrade}.json'
    before_path = DELIVERY/f'evidence/scoped-seo-migrations-{a.upgrade}-before.json'
    after_path = DELIVERY/f'evidence/scoped-seo-migrations-{a.upgrade}.json'
    upgrade, before, after = read(upgrade_path), read(before_path), read(after_path)
    assert upgrade['status'] == after['status'] == 'passed' and upgrade['owned_database_shutdown']
    bound(DELIVERY, upgrade['verifier'])
    for entry in upgrade['inputs'] + upgrade['raw_reports']:
        bound(DELIVERY, entry)
    assert len(after['databases']) == 2
    for d in after['databases']:
        old = next(x for x in before['databases'] if x['database'] == d['database'])
        assert d['original'] == old['original'] and len(d['original']) == 164
        assert len(d['migrations']) == 79 and d['migrations'][:77] == old['migrations']
        assert d['synthetic_history_added'] is False and len(d['controls']) == 3
        assert all(x['count'] == 0 and x['rls']['relforcerowsecurity'] for x in d['controls'].values())
    original_sql = git(PLATFORM, 'ls-tree', '-r', '--name-only', '794c9d371501df69db3ad4df23efc223c82489fb', '--', 'migrations').decode().splitlines()
    assert len(original_sql) == 77
    for file in original_sql:
        assert (PLATFORM/file).read_bytes() == git(PLATFORM, 'show', '794c9d371501df69db3ad4df23efc223c82489fb:'+file)
    for number, attempt in ((78, '01'), (79, '03')):
        file = next((PLATFORM/'migrations').glob(f'{number:03}-*.sql'))
        assert digest(file) == read(DELIVERY/f'evidence/scoped-seo-integration-{attempt}.json')['source_files']['migrations/'+file.name]
    artifacts_path = ROOT/'docs/quality/scoped-seo-artifacts.json'
    artifacts = read(artifacts_path)
    assert artifacts_path.read_bytes() == (DELIVERY/'evidence/scoped-seo-artifacts.json').read_bytes()
    assert artifacts['status'] == 'passed' and artifacts['prior_client_packages_unchanged']
    for file in artifacts['artifacts']:
        assert digest(DEV/file['path']) == file['sha256']
    recheck_path = ROOT/'docs/quality/scoped-seo-client-recheck-01.json'
    recheck = read(recheck_path)
    assert recheck['status'] == 'passed' and recheck['native_checks'] >= 20 and recheck['browsers_or_apps_started'] is False
    assert recheck['manifest_sha256'] == digest(artifacts_path)
    assert recheck['verifier_sha256'] == digest(ROOT/'docs/tools/verify_scoped_seo_clients.mjs')
    scan_path = ROOT/f'docs/quality/scoped-seo-credential-scan-{a.scan}.json'
    scan = read(scan_path)
    assert scan['status'] == 'passed' and scan['configured_patterns'] > 0 and not scan['matches']
    assert scan['verifier_sha256'] == digest(ROOT/'docs/tools/scan_scoped_seo_credentials.mjs')
    for file in scan['files']:
        assert digest(ROOT/file['path']) == file['sha256']
    checkpoint = {
        'at': datetime.now(timezone.utc).isoformat(),
        'scope': 'Confirmed bounded synthetic website crawling, URL findings and immutable source evidence, source-governed Codex interpretation through the internal synthetic gateway, same-scope recheck, current Web/Admin and actual unsigned frameless Desktop/native Side Panel. Complete TC-029, GEO, live websites, installers and whole-product acceptance remain open.',
        'verifier': receipt(Path(__file__).resolve()), 'prior_progress': receipt(history/'requirements-alignment-progress.json'),
        'original_scope': {'requirements': 102, 'fully_accepted_requirements': 0, 'qualified_live_roles': 0, 'all_TC_NFR_G01_G10_retained': True},
        'focused': integration, 'full_platform_regression': full, 'actual_web_admin': runtime[0], 'actual_native_clients': runtime[1],
        'client_checks': receipt(clients_path), 'supplemental_contract': receipt(api_path), 'contract_operations': 8, 'contract_schemas': 14,
        'local_database_upgrade': {'execution': receipt(upgrade_path), 'before': receipt(before_path), 'after': receipt(after_path)},
        'current_platform_sources': read(full_path)['source_files'], 'preserved_suite_executions': preserved, 'preserved_failed_runtime_executions': failed_runtime,
        'client_artifacts': receipt(artifacts_path), 'current_client_recheck': receipt(recheck_path), 'configured_credential_scan': receipt(scan_path),
        'remaining': ['A source-governed saved website change task and complete canonical TaskDTO/POST /v1/tasks contract', 'REQ-030 frozen GEO prompt/model/product/region/language/retrieval samples and comparable repeated observations', 'Search Console connection metrics within this audit; current public HTML route explicitly rejects connection_id', 'Public DNS/TLS transport deployment and live website qualification, full independent marketing/professional-role execution', 'Installer/signing/store/production systems and all original complete TC/NFR/G01-G10'],
    }
    updated = json.loads((history/'requirements-alignment-progress.json').read_text(encoding='utf-8'))
    repair = {'cluster': 'scoped_seo', 'verified_subflow': '明确模拟的受限网站真实 HTTP、robots、逐 URL 问题和原文、持久恢复/暂停取消、Codex 内部网关解读、不可变复查及来源隔离/删除；实际 Web/Admin、无边框 Desktop 和原生 Side Panel。', 'evidence': ['scoped_seo_verification'], 'implementation_docs': ['technical/62-scoped-seo-audits.md']}
    selected = {f'REQ-{n:03}' for n in (4, 8, 10, 12, 24, 29, 39, 43, 90, 91, 92, 93, 94, 95, 96)}
    for row in updated['requirements']:
        if row['requirement_id'] in selected:
            row.setdefault('verified_repairs', []).append(repair)
            row['acceptance_evidence'] = list(dict.fromkeys([*row.get('acceptance_evidence', []), 'scoped_seo_verification']))
        if row['requirement_id'] == 'REQ-029':
            row['assessment'] = 'partial_verified'
            row['finding'] = '已验证有明确范围与预算的合成网站真实 HTTP、robots、断链/重复标题、原文位置、持久恢复、Codex 解读、私有来源治理和不可变复查；保留完整 TC-029。'
            row['acceptance_case_execution'] = 'local_synthetic_scoped_seo_subflow_passed'
            row['remaining_complete_acceptance_conditions'] = '正式公开站点/DNS/TLS部署验收、保留来源治理的修改任务、规范 TaskDTO 与完整业务验收；Search Console 连接指标、全部 TC/NFR/G01–G10 继续独立跟踪。'
    for old, new in zip(baseline['requirements'], updated['requirements']):
        for key in ('requirement_id', 'priority', 'requirement', 'acceptance_case', 'acceptance_conditions', 'original_finding'):
            assert old[key] == new[key]
    assert updated['gates'] == baseline['gates'] and updated['nfr_full_acceptance'] == baseline['nfr_full_acceptance']
    updated['at'] = checkpoint['at']
    updated['summary'] = dict(Counter(r['assessment'] for r in updated['requirements']))
    assert updated['summary'] == {'partial_verified': 81, 'completion_not_proven': 21}
    updated['scoped_seo_verification'] = checkpoint
    updated['evidence']['platform_regression'] = full
    updated['evidence_currentness_policy'] += ' Stage62: current bounded synthetic SEO and actual Web/Admin/frameless Desktop/native Side Panel bind source and package bytes; failed executions and previous complete acceptance remain unchanged.'
    if a.documentation:
        assert re.fullmatch(r'[a-z0-9-]+\.json', a.documentation)
        p = ROOT/'docs/quality'/a.documentation; d = read(p)
        assert d['status'] == 'passed' and d['checks_failed'] == 0
        assert d['counts']['requirements'] == d['counts']['acceptance_cases'] == 102
        assert d['verifier_sha256'] == digest(ROOT/'docs/tools/validate_docs.py')
        checkpoint['documentation_contracts'] = receipt(p)
    if a.write:
        for p, value in ((ROOT/'docs/quality/scoped-seo-checkpoint.json', checkpoint), (ROOT/'docs/quality/requirements-alignment-progress.json', updated)):
            p.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': 'passed', 'write': a.write, 'focused': integration['counts'], 'full': full['counts'], 'actual_web_admin': runtime[0]['actual_checks'], 'actual_native': runtime[1]['actual_checks'], 'summary': updated['summary'], 'fully_accepted_requirements': 0}))


if __name__ == '__main__':
    main()
