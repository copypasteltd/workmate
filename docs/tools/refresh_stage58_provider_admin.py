"""Bind additive Admin controls to exact executions; retain all original acceptance."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from jsonschema import Draft202012Validator, FormatChecker

from refresh_stage52_capabilities import ROOT, PLATFORM, DELIVERY, OPENAPI_SHA, digest, git, read, receipt, source_snapshot, verify_run

ADMIN = ROOT / 'dev/copypaste-admin'
BASELINE = '5888ddc'
PLATFORM_BASELINE = 'b32441b'


def names(path):
    return Counter(re.findall(r'^\s*(?:ok|not ok) \d+ - (.+?)\r?$', path.read_text(encoding='utf-8'), re.M))


def suite(name):
    path = DELIVERY / 'evidence' / (name + '.json')
    data = read(path)
    result = verify_run(name, expected_status=data['status'], verifier_snapshot=DELIVERY / data['verifier_snapshot'])
    c = data['fixture_cleanup']
    assert c['status'] == 'passed' and c['workers_exited'] and c['actual_filesystem_checked']
    assert all(x['reclaimed'] for x in c['results'])
    assert digest(DELIVERY / c['path']) == c['sha256']
    return result


def main():
    p = argparse.ArgumentParser()
    for flag in ('focused', 'full', 'static', 'ui', 'credential-scan'):
        p.add_argument('--' + flag, required=True)
    p.add_argument('--write', action='store_true')
    a = p.parse_args()
    assert all(re.fullmatch(r'\d{2}', x) for x in (a.focused, a.full, a.static, a.ui, a.credential_scan))
    baseline_bytes = git(ROOT, 'show', BASELINE + ':docs/quality/requirements-alignment-progress.json')
    baseline = json.loads(baseline_bytes)
    assert len(baseline['requirements']) == 102
    assert baseline['fully_accepted_requirements'] == baseline['qualified_live_roles'] == 0
    assert digest(ROOT / 'docs/contracts/openapi.json') == OPENAPI_SHA
    focused = suite('provider-admin-candidate-' + a.focused)
    full = suite('provider-admin-regression-' + a.full)
    focus_data, full_data = read(ROOT / focused['path']), read(ROOT / full['path'])
    current = {**source_snapshot(), '.env.example':digest(PLATFORM / '.env.example')}
    assert focus_data['source_files'] == full_data['source_files'] == current
    assert focus_data['component_sources'] == full_data['component_sources']
    previous = baseline['provider_budget_verification']['full_platform_regression']
    assert digest(ROOT / previous['raw_report']['path']) == previous['raw_report']['sha256']
    assert not (names(ROOT / previous['raw_report']['path']) - names(ROOT / full['raw_report']['path']))
    assert not (names(ROOT / focused['raw_report']['path']) - names(ROOT / full['raw_report']['path']))
    assert previous['counts']['tests'] == 559 and full['counts']['tests'] > 559
    static_path = DELIVERY / f'evidence/provider-admin-static-{a.static}.json'
    static = read(static_path)
    assert static['status'] == 'passed' and static['source_unchanged'] and static['source_files'] == current
    assert digest(DELIVERY / static['verifier_snapshot']) == static['verifier_sha256'] == digest(DELIVERY / 'scripts/run-provider-admin-static-checks.mjs')
    assert [x['name'] for x in static['checks']] == ['typecheck','build']
    for x in static['checks']:
        assert x['exit_code'] == 0 and digest(DELIVERY / x['raw_report']) == x['raw_sha256']
    ui_path = DELIVERY / f'evidence/provider-admin-ui-{a.ui}.json'
    ui = read(ui_path)
    assert ui['status'] == 'passed' and ui['source_unchanged'] and ui['admin_build_unchanged']
    assert ui['owned_database_shutdown'] and ui['owned_admin_preview_closed'] and ui['database_shutdown_exit_code'] == 0
    for key in ('journey','raw_report','verifier','journey_verifier'):
        assert digest(DELIVERY / ui[key]['path']) == ui[key]['sha256']
    journey = read(DELIVERY / ui['journey']['path'])
    assert journey['status'] == 'passed' and len(journey['checks']) >= 10 and not journey['errors']
    assert journey['browser_closed'] and journey['owned_api_closed'] and journey['isolated_database_dropped_or_deferred_fixture_queued']
    for file,expected in ui['source_files'].items():
        path = ROOT / file if file.startswith('docs/') else ROOT / 'dev' / file
        assert digest(path) == expected, 'UI source changed: '+file
    for component,sources in full_data['component_sources'].items():
        for name,expected in sources.items():
            key = 'copypaste-'+component+'/'+name
            if key in ui['source_files']: assert ui['source_files'][key] == expected
    for x in journey['screenshots']:
        assert digest(ROOT / 'dev' / x['path']) == x['sha256'] and x['edited'] is False
    assert journey['supplemental_contract_sha256'] == digest(ROOT / 'docs/contracts/provider-admin-openapi.json')
    api=read(ROOT / 'docs/contracts/provider-admin-openapi.json')
    defs=json.loads(json.dumps(api['components']['schemas']).replace('#/components/schemas/','#/$defs/'))
    for x in journey['samples']:
        Draft202012Validator({'$defs':defs,'$ref':'#/$defs/'+x['schema']},format_checker=FormatChecker()).validate(x['response'])
    for name in ('provider-admin-openapi.json','provider-admin-schemas.json'):
        assert (ROOT / 'docs/contracts' / name).read_bytes() == (PLATFORM / 'contracts' / name).read_bytes()
    assert (ROOT / 'docs/contracts/provider-admin-permissions.json').read_bytes() == (PLATFORM / 'catalog/provider-admin-permissions.json').read_bytes()
    originals = git(PLATFORM,'ls-tree','-r','--name-only',PLATFORM_BASELINE,'--','migrations').decode().splitlines()
    assert len(originals) == 67
    for name in originals:
        assert (PLATFORM / name).read_bytes() == git(PLATFORM,'show',PLATFORM_BASELINE+':'+name)
    assert len(list((PLATFORM / 'migrations').glob('*.sql'))) == 68
    upgrade_path = DELIVERY / 'evidence/provider-admin-upgrade.json'
    upgrade = read(upgrade_path)
    assert upgrade['status'] == 'passed' and upgrade['source_unchanged'] and upgrade['owned_database_shutdown']
    assert upgrade['candidate']['sha256'] == focused['sha256'] and upgrade['regression']['sha256'] == full['sha256']
    before_path,after_path = (DELIVERY / 'evidence' / n for n in ('provider-admin-migrations-before.json','provider-admin-migrations.json'))
    before,after = read(before_path),read(after_path)
    assert before['status'] == 'captured_before_upgrade' and after['status'] == 'passed'
    assert {x['database'] for x in after['databases']} == {'copypaste','copypaste_test'}
    for row in after['databases']:
        old = next(x for x in before['databases'] if x['database'] == row['database'])
        assert row['original'] == old['original'] and len(row['original']) == 144
        assert row['migrations'][:67] == old['migrations'] and len(row['migrations']) == 68
        assert len(row['controls']) == 7 and all(n == 0 for n in row['empty_new_tables'].values())
        assert row['historical_spend_fabricated'] is False
    assert after['verifier_sha256'] == digest(DELIVERY / 'scripts/qa-provider-admin-migrations.mjs')
    assert upgrade['verifier_sha256'] == digest(DELIVERY / 'scripts/upgrade-provider-admin-local.mjs')
    scan_path = ROOT / f'docs/quality/provider-admin-credential-scan-{a.credential_scan}.json'
    scan = read(scan_path)
    assert scan['status'] == 'passed' and scan['configured_patterns'] > 0 and not scan['matches']
    assert scan['verifier_sha256'] == digest(ROOT / 'docs/tools/scan_provider_admin_credentials.mjs')
    expected_files = {x.relative_to(ROOT).as_posix() for x in (DELIVERY / 'evidence').iterdir() if x.is_file() and x.name.startswith('provider-admin-')}
    assert {x['path'] for x in scan['files']} == expected_files
    for x in scan['files']: assert digest(ROOT / x['path']) == x['sha256']
    preimages = {x['sha256']:ROOT / x['path'] for manifest in (DELIVERY / 'evidence').glob('provider-admin-*-source-preimages.json') for x in read(manifest)['files']}
    attempts=[]
    for path in sorted((DELIVERY / 'evidence').glob('provider-admin-*.json')):
        if not re.fullmatch(r'provider-admin-(?:core|candidate|regression)-\d{2}\.json',path.name): continue
        attempts.append(suite(path.stem))
        for component,sources in read(path)['component_sources'].items():
            repo = PLATFORM if component=='platform' else ADMIN
            for name,expected in sources.items():
                if digest(repo / name) != expected:
                    assert expected in preimages and digest(preimages[expected]) == expected, 'Missing executed source: '+path.stem+':'+name
    browser_attempts=[]
    for path in sorted((DELIVERY / 'evidence').glob('provider-admin-ui-??.json')):
        data=read(path)
        assert data['source_unchanged'] and data['owned_database_shutdown'] and data['owned_admin_preview_closed']
        j=read(DELIVERY / data['journey']['path'])
        assert j['owned_api_closed'] and j['isolated_database_dropped_or_deferred_fixture_queued']
        assert j['browser_runtime'] is None or j['browser_closed']
        for key in ('journey','raw_report','verifier','journey_verifier'):
            assert digest(DELIVERY / data[key]['path']) == data[key]['sha256']
        browser_attempts.append({**receipt(path),'status':data['status'],'checks':len(j['checks'])})
    checkpoint = {
        'at':datetime.now(timezone.utc).isoformat(),'scope':'Scoped provider Admin policy, request directory, immutable human evidence, independent cost/capacity confirmation and single original task settlement; authorized simulations only',
        'documentation_verifier':receipt(Path(__file__).resolve()),'prior_checkpoint':{**receipt(ROOT / 'docs/quality/provider-budget-checkpoint.json'),'source_commit':BASELINE},
        'original_scope':{'requirements':102,'summary':baseline['summary'],'fully_accepted_requirements':0,'qualified_live_roles':0,'all_TC_NFR_G01_G10_retained':True},
        'focused':focused,'full_platform_regression':full,'platform_build_and_types':receipt(static_path),'admin_browser':receipt(ui_path),
        'actual_browser_checks':len(journey['checks']),'actual_contract_response_samples':len(journey['samples']),
        'all_prior_named_tests_retained':dict(names(ROOT / previous['raw_report']['path'])),
        'executions':attempts,'browser_executions':browser_attempts,'browser_preflight_failure':receipt(DELIVERY/'evidence/provider-admin-ui-04-preflight.json'),
        'current_component_sources':full_data['component_sources'],
        'immutable_migrations_001_067':{n:digest(PLATFORM/n) for n in originals},'additive_migration_068':receipt(PLATFORM/'migrations/068-provider-admin-control.sql'),
        'local_database_upgrade':{'execution':receipt(upgrade_path),'before':receipt(before_path),'after':receipt(after_path)},
        'normative_openapi_sha256':OPENAPI_SHA,'configured_credential_scan':{**receipt(scan_path),'files':len(scan['files']),'matches':0},
        'remaining':['Authenticated company gateway evidence integration; current confirmation explicitly uses human source statements',
                     'Production network enforcement, original TC/NFR/G01-G10, complete business acceptance, live-role qualification and client distribution'],
    }
    updated=json.loads(baseline_bytes)
    repair={'cluster':'provider_admin_controls','verified_subflow':'逐请求与额外费用权限、不可变策略发布、人工来源证据、费用/容量独立审批及原任务唯一结算；模拟数据不构成真实模型资格。',
            'evidence':['provider_admin_verification'],'implementation_docs':['technical/58-provider-admin-control-and-reconciliation.md']}
    for item in updated['requirements']:
        if item['requirement_id'] in {f'REQ-{n:03}' for n in (1,43,44,45,46,52,79,83,96,99,102)}: item.setdefault('verified_repairs',[]).append(repair)
    for old,new in zip(baseline['requirements'],updated['requirements']):
        assert all(old[k] == new[k] for k in old if k != 'verified_repairs')
        assert new.get('verified_repairs',[])[:len(old.get('verified_repairs',[]))] == old.get('verified_repairs',[])
    updated['at']=checkpoint['at'];updated['provider_admin_verification']=checkpoint;updated['evidence']['platform_regression']=full
    updated['evidence_currentness_policy'] += ' Stage58: new provider Admin native suites and built Admin browser receipts bind their exact source maps; other receipts retain their historical scope.'
    if a.write:
        history=ROOT/'docs/quality/history/stage57-before-provider-admin';history.mkdir(parents=True,exist_ok=True)
        h=history/'requirements-alignment-progress.json'
        if h.exists(): assert h.read_bytes() == baseline_bytes
        else: h.write_bytes(baseline_bytes)
        for path,data in ((ROOT/'docs/quality/provider-admin-checkpoint.json',checkpoint),(ROOT/'docs/quality/requirements-alignment-progress.json',updated)):
            path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({'status':'passed','write':a.write,'focused':focused['counts'],'full':full['counts'],'ui_checks':len(journey['checks']),'requirements':102,'fully_accepted_requirements':0}))


if __name__ == '__main__': main()
