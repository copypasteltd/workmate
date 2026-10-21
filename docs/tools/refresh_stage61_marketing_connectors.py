"""Admit actual connector executions while preserving all original acceptance."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from jsonschema import Draft202012Validator, FormatChecker
from refresh_stage52_capabilities import ROOT, DEV, PLATFORM, DELIVERY, OPENAPI_SHA, digest, git, read, receipt, verify_run


def named(path):
    return Counter(re.findall(r'^\s*(?:ok|not ok) \d+ - (.+?)\r?$', path.read_text(encoding='utf-8'), re.M))


def suite(name):
    p = DELIVERY/'evidence'/(name+'.json'); r = read(p)
    result = verify_run(name, expected_status=r['status'], verifier_snapshot=DELIVERY/r['verifier_snapshot'])
    c = r['fixture_cleanup']
    assert c['status']=='passed' and c['workers_exited'] and c['actual_filesystem_checked'] and all(x['reclaimed'] for x in c['results'])
    assert digest(DELIVERY/c['path'])==c['sha256']
    for component, data in read(DELIVERY/r['source_preimages']).items():
        for f in data['files']:
            assert digest(DELIVERY/f['path'])==f['sha256']==r['component_sources'][component][f['source']]
    if 'lineage_migration_snapshot' in r:
        assert digest(DELIVERY/r['lineage_migration_snapshot'])==r['lineage_migration_sha256']
    for f in r.get('forward_migrations',{}).values():
        assert digest(DELIVERY/f['path'])==f['sha256']
    return result


def main():
    parser=argparse.ArgumentParser()
    for name in ('core','full','ui','native','clients','upgrade','scan','startup'):
        parser.add_argument('--'+name,required=True)
    parser.add_argument('--documentation')
    parser.add_argument('--write',action='store_true'); a=parser.parse_args()
    assert all(re.fullmatch(r'\d{2}',getattr(a,n)) for n in ('core','full','ui','native','clients','upgrade','scan','startup'))
    original=git(ROOT,'show','cb86d15:docs/quality/requirements-alignment-progress.json')
    history=ROOT/'docs/quality/history/stage60-before-connectors/requirements-alignment-progress.json'
    assert history.read_bytes()==original
    baseline=json.loads(original)
    assert len(baseline['requirements'])==102 and baseline['fully_accepted_requirements']==baseline['qualified_live_roles']==0
    assert digest(ROOT/'docs/contracts/openapi.json')==OPENAPI_SHA
    core=suite('marketing-connectors-core-'+a.core); full=suite('marketing-connectors-regression-'+a.full)
    c=read(ROOT/core['path']); f=read(ROOT/full['path'])
    assert c['component_sources']==f['component_sources']
    assert core['counts']['tests']>=39 and full['counts']['tests']>=674
    for component,files in f['component_sources'].items():
        for name,expected in files.items():
            assert digest(DEV/('copypaste-'+component)/name)==expected,name
    prior=baseline['template_video_verification']['full_platform_regression']
    assert prior['counts']['tests']==638 and digest(ROOT/prior['raw_report']['path'])==prior['raw_report']['sha256']
    assert not (named(ROOT/prior['raw_report']['path'])-named(ROOT/full['raw_report']['path']))
    assert not (named(ROOT/core['raw_report']['path'])-named(ROOT/full['raw_report']['path']))
    api_path=ROOT/'docs/contracts/marketing-connector-openapi.json'; api=read(api_path)
    assert api_path.read_bytes()==(PLATFORM/'contracts/marketing-connector-openapi.json').read_bytes()
    assert api['x-normative-source-sha256']==OPENAPI_SHA
    assert api['x-model-source-sha256']==digest(PLATFORM/'src/connector-model.ts')
    assert api['x-route-source-sha256']==digest(PLATFORM/'src/connectors.ts')
    assert sum(len(v) for v in api['paths'].values())==19 and len(api['components']['schemas'])==24
    normative=read(ROOT/'docs/contracts/openapi.json')
    for name in ('Connection','ConnectionList','Snapshot','AdminOperation'):
        assert api['components']['schemas'][name]==normative['components']['schemas'][name]
    ui_receipts=[]
    for kind,number,minimum in (('ui',a.ui,10),('native',a.native,16)):
        p=DELIVERY/f'evidence/marketing-connector-{kind}-{number}.json'; r=read(p)
        assert r['status']=='passed' and r['source_unchanged'] and r['web_build_unchanged'] and r['owned_database_shutdown'] and r['owned_web_preview_closed']
        for key in ('journey','raw_report','verifier','journey_verifier'):
            assert digest(DELIVERY/r[key]['path'])==r[key]['sha256']
        j=read(DELIVERY/r['journey']['path'])
        assert j['status']=='passed' and len(j['checks'])>=minimum and not j['errors'] and j['browser_closed'] and j['owned_api_closed']
        for key,expected in r['source_files'].items():
            assert digest((ROOT if key.startswith('docs/') else DEV)/key)==expected,key
        for image in j['screenshots']:
            assert digest(DEV/image['path'])==image['sha256']
        if kind=='ui':
            assert r['admin_build_unchanged'] and r['owned_admin_preview_closed']
            defs=json.loads(json.dumps(api['components']['schemas']).replace('#/components/schemas/','#/$defs/'))
            for sample in j['samples']:
                Draft202012Validator({'$defs':defs,'$ref':'#/$defs/'+sample['schema']},format_checker=FormatChecker()).validate(sample['response'])
            assert len(j['samples'])>=16
        else:
            assert j['desktop_closed'] and j['extension_closed'] and j['artifacts_unchanged_after_run']
            assert j['inspection']['marketing']['download']['actual_native_save']
        ui_receipts.append({**receipt(p),'actual_checks':len(j['checks']),'actual_response_samples':len(j.get('samples',[]))})
    clients_path=DELIVERY/f'evidence/marketing-connector-clients-{a.clients}.json'; clients=read(clients_path)
    assert clients['status']=='passed' and clients['source_unchanged'] and len(clients['checks'])==13
    for check in clients['checks']:
        assert check['exit_code']==0 and digest(DELIVERY/check['raw_report'])==check['raw_sha256']
    for file,expected in clients['source_files'].items():
        repo,relative=file.split('/',1)
        assert digest(DEV/('copypaste-'+repo)/relative)==expected,file
    before_path=DELIVERY/f'evidence/marketing-connector-migrations-{a.upgrade}-before.json'
    after_path=DELIVERY/f'evidence/marketing-connector-migrations-{a.upgrade}.json'
    upgrade_path=DELIVERY/f'evidence/marketing-connector-upgrade-{a.upgrade}.json'
    before=read(before_path); after=read(after_path); upgrade=read(upgrade_path)
    assert upgrade['status']=='passed' and upgrade['owned_database_shutdown'] and after['status']=='passed'
    for d in after['databases']:
        old=next(x for x in before['databases'] if x['database']==d['database'])
        assert d['original']==old['original'] and len(d['original'])==157 and d['migrations'][:71]==old['migrations'] and len(d['migrations'])==77
        assert d['synthetic_history_added'] is False and len(d['controls'])==7
        assert all(x['rls']['relforcerowsecurity'] for x in d['controls'].values())
        assert d['controls']['connector_profiles']['count']==d['legacy_connection_count']
        assert all(x['count']==0 for name,x in d['controls'].items() if name!='connector_profiles')
    old_sql=git(PLATFORM,'ls-tree','-r','--name-only','c864ead','--','migrations').decode().splitlines()
    assert len(old_sql)==71
    for name in old_sql:
        assert (PLATFORM/name).read_bytes()==git(PLATFORM,'show','c864ead:'+name)
    for number,attempt in ((72,'01'),(73,'02'),(74,'03'),(75,'03'),(76,'04'),(77,'05')):
        p=next((PLATFORM/'migrations').glob(f'{number:03}-*.sql'))
        r=read(DELIVERY/f'evidence/marketing-connectors-core-{attempt}.json')
        expected=r['migration_sha256'] if number==72 else r['lineage_migration_sha256'] if number==73 else r['forward_migrations']['migrations/'+p.name]['sha256']
        assert digest(p)==expected
    artifacts_path=ROOT/'docs/quality/marketing-connector-artifacts.json'; artifacts=read(artifacts_path)
    assert artifacts_path.read_bytes()==(DELIVERY/'evidence/marketing-connector-artifacts.json').read_bytes()
    assert artifacts['status']=='passed' and artifacts['prior_client_packages_unchanged']
    for file in artifacts['artifacts']:
        assert digest(DEV/file['path'])==file['sha256']
    recheck_path=ROOT/'docs/quality/marketing-connector-client-recheck-01.json'; recheck=read(recheck_path)
    assert recheck['status']=='passed' and recheck['native_checks']==16 and not recheck['browsers_or_apps_started']
    assert recheck['manifest_sha256']==digest(artifacts_path)
    assert recheck['verifier_sha256']==digest(ROOT/'docs/tools/verify_marketing_connector_clients.mjs')
    startup_path=DELIVERY/f'evidence/marketing-connector-startup-{a.startup}.json'; startup=read(startup_path)
    assert startup['status']=='passed' and startup['source_unchanged'] and len(startup['checks'])==2
    assert all(x['status']=='passed' and x['actual_checkpointed_shutdown'] and x['owned_database_listener_closed'] for x in startup['checks'])
    for check in startup['checks']:
        assert digest(DELIVERY/check['raw_report'])==check['raw_sha256']
    for file,expected in startup['source_files'].items():
        assert digest(PLATFORM/file)==expected
    scan_path=ROOT/f'docs/quality/marketing-connector-credential-scan-{a.scan}.json'; scan=read(scan_path)
    assert scan['status']=='passed' and scan['configured_patterns']>0 and not scan['matches']
    assert scan['verifier_sha256']==digest(ROOT/'docs/tools/scan_marketing_connector_credentials.mjs')
    for file in scan['files']:
        assert digest(ROOT/file['path'])==file['sha256'],file['path']
    attempts=[suite(p.stem) for p in sorted((DELIVERY/'evidence').glob('marketing-connectors-core-??.json'))]
    failed_ui=[]
    for p in sorted((DELIVERY/'evidence').glob('marketing-connector-ui-??.json')):
        r=read(p)
        if r['status']=='passed': continue
        for key in ('raw_report','verifier','journey_verifier'):
            assert digest(DELIVERY/r[key]['path'])==r[key]['sha256']
        failed_ui.append({**receipt(p),'status':r['status'],'passing_checks':r['counts']['checks'],'qualified':False})
    interrupted=DELIVERY/'evidence/marketing-connector-ui-06-interruption-audit.json'
    assert read(interrupted)['status']=='interrupted_unqualified'
    recovery_path=DELIVERY/'evidence/marketing-connector-ui-07-recovery-audit.json'; recovery=read(recovery_path)
    assert recovery['native_pg_ctl_exit_code_observed']==0
    assert digest(DELIVERY/recovery['raw_shutdown_report']['path'])==recovery['raw_shutdown_report']['sha256']
    failed_client=DELIVERY/'evidence/marketing-connector-clients-01.json'; failed=read(failed_client)
    assert failed['status']=='failed_before_checks' and failed['failure']['code']=='ENOBUFS' and not failed['checks']
    assert digest(DELIVERY/failed['verifier']['path'])==failed['verifier']['sha256']
    documentation=None
    if a.documentation:
        assert re.fullmatch(r'[a-z0-9][a-z0-9-]{0,120}\.json',a.documentation)
        document_path=ROOT/'docs/quality'/a.documentation; document=read(document_path)
        assert document['status']=='passed' and document['checks_failed']==0 and document['counts']['requirements']==document['counts']['acceptance_cases']==102
        assert document['counts']['role_presets']==18 and document['counts']['planned_skill_packages']==29 and document['counts']['qualified_roles']==0
        assert document['verifier_sha256']==digest(ROOT/'docs/tools/validate_docs.py')
        documentation=receipt(document_path)
    checkpoint={'at':datetime.now(timezone.utc).isoformat(),'scope':'Four protocol-shaped synthetic marketing suppliers: OAuth/PKCE, discovered account/project scope, durable bounded pagination, unknown metrics and limits, immutable snapshots/CSV lineage, retry/cancel/revoke, current scoped Admin and actual Web/packaged frameless Desktop/native Side Panel. Live provider, installer and complete professional-role/system acceptance remain separate.',
        'documentation_verifier':receipt(Path(__file__).resolve()),'baseline_source_commit':'cb86d15','prior_progress':receipt(history),
        'original_scope':{'requirements':102,'fully_accepted_requirements':0,'qualified_live_roles':0,'all_TC_NFR_G01_G10_retained':True},
        'focused':core,'full_platform_regression':full,'client_checks':receipt(clients_path),'actual_web_admin':ui_receipts[0],'actual_native_clients':ui_receipts[1],
        'current_component_sources':f['component_sources'],'supplemental_contract':receipt(api_path),'contract_operations':19,'contract_schemas':24,
        'local_database_upgrade':{'execution':receipt(upgrade_path),'before':receipt(before_path),'after':receipt(after_path)},
        'immutable_migrations_001_071':{name:digest(PLATFORM/name) for name in old_sql},
        'forward_migrations':{p.name:receipt(p) for p in sorted((PLATFORM/'migrations').glob('07[2-7]-*.sql'))},
        'preserved_focused_executions':attempts,'preserved_failed_ui_executions':failed_ui,'interrupted_ui_unqualified':receipt(interrupted),
        'native_startup_shutdown':receipt(startup_path),'manual_recovery_cleanup':receipt(recovery_path),'preserved_failed_client_snapshot':receipt(failed_client),
        'client_artifacts':receipt(artifacts_path),'current_client_recheck':receipt(recheck_path),'configured_credential_scan':receipt(scan_path),
        'remaining':['Live supplier application scope approval and actual-account field/definition/freshness reconciliation','Complete marketing and professional role delegation including full independent business work','Signed installer execution, extension store and production systems; original complete TC/NFR/G01-G10']}
    updated=json.loads(original)
    repair={'cluster':'marketing_connectors','verified_subflow':'四个供应商的明确模拟授权、真实 HTTP/PKCE、授权账户目录/项目绑定、持久分页/限流恢复、快照/规范化分析源、未知值/口径限制、取消/撤销及独立后台权限；实际 Web、无边框 Desktop 和原生 Side Panel。','evidence':['marketing_connector_verification'],'implementation_docs':['technical/61-marketing-connector-synchronization.md']}
    selected={f'REQ-{n:03}' for n in (4,23,24,25,26,27,28,36,39,48,49,52,90,91)}
    promoted={f'REQ-{n:03}' for n in (4,25,26,27,28)}
    for row in updated['requirements']:
        if row['requirement_id'] in selected:
            row.setdefault('verified_repairs',[]).append(repair)
            row['acceptance_evidence']=list(dict.fromkeys([*row.get('acceptance_evidence',[]),'marketing_connector_verification']))
        if row['requirement_id'] in promoted:
            row['assessment']='partial_verified'
            row['finding']='已验证明确标记的合成供应商协议流程、授权账户/项目范围、持久分页与限制、当前权限、不可变快照及分析来源；正式供应商账户和完整业务验收仍待核对。'
            row['remaining_complete_acceptance_conditions']='保留原完整 TC：正式应用权限、实际账户字段/口径与截止时间对照、独立营销业务和完整角色委派、生产性能/恢复及综合验收。Meta 本轮仅广告读取，GA4/GSC 保留不可加和覆盖限制，不把合成数据标为正式接通。'
            row['acceptance_case_execution']='local_synthetic_connector_subflow_passed'
    for old,new in zip(baseline['requirements'],updated['requirements']):
        for key in ('requirement_id','priority','requirement','acceptance_case','acceptance_conditions','original_finding'):
            assert old[key]==new[key]
    assert updated['gates']==baseline['gates'] and updated['nfr_full_acceptance']==baseline['nfr_full_acceptance']
    updated['at']=checkpoint['at']; updated['summary']=dict(Counter(r['assessment'] for r in updated['requirements']))
    assert updated['summary']=={'partial_verified':80,'completion_not_proven':22}
    updated['marketing_connector_verification']=checkpoint; updated['evidence']['platform_regression']=full
    updated['contract_alignment']['inventory_currentness']='Historical method/path inventory; the current connector supplement and executed response samples are recorded under marketing_connector_verification. This inventory does not establish current whole-API conformance.'
    updated['evidence_currentness_policy']+=' Stage61: synthetic marketing connector, current Admin and actual frameless Desktop/native Side Panel executions bind current source bytes; earlier raw reports, source preimages and original complete acceptance retain their execution scope. Failed/interrupted runs are never promoted.'
    if documentation:
        checkpoint['documentation_contracts']=documentation; updated['evidence']['documentation_contracts_stage61']=documentation
    if a.write:
        for p,value in ((ROOT/'docs/quality/marketing-connector-checkpoint.json',checkpoint),(ROOT/'docs/quality/requirements-alignment-progress.json',updated)):
            p.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({'status':'passed','write':a.write,'focused':core['counts'],'full':full['counts'],'actual_web_admin':ui_receipts[0]['actual_checks'],'actual_native':ui_receipts[1]['actual_checks'],'summary':updated['summary'],'fully_accepted_requirements':0}))


if __name__=='__main__': main()
