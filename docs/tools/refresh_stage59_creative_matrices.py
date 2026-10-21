"""Admit actual matrix executions while retaining all 102 original conditions."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from jsonschema import Draft202012Validator, FormatChecker
from refresh_stage52_capabilities import ROOT, DEV, PLATFORM, DELIVERY, OPENAPI_SHA, digest, git, read, receipt, source_snapshot, verify_run


def named(path):
    return Counter(re.findall(r'^\s*(?:ok|not ok) \d+ - (.+?)\r?$',path.read_text(encoding='utf-8'),re.M))


def suite(name):
    path=DELIVERY/'evidence'/(name+'.json');r=read(path)
    out=verify_run(name,expected_status=r['status'],verifier_snapshot=DELIVERY/r['verifier_snapshot'])
    c=r['fixture_cleanup'];assert c['status']=='passed' and c['workers_exited'] and c['actual_filesystem_checked'] and all(x['reclaimed'] for x in c['results'])
    assert digest(DELIVERY/c['path'])==c['sha256']
    pre=read(DELIVERY/r['source_preimages'])
    for component,data in pre.items():
        for f in data['files']:assert digest(DELIVERY/f['path'])==f['sha256']==r['component_sources'][component][f['source']]
    return out


def main():
    p=argparse.ArgumentParser()
    for name in ('core','full','ui','native','clients','scan'):p.add_argument('--'+name,required=True)
    p.add_argument('--write',action='store_true');a=p.parse_args()
    assert all(re.fullmatch(r'\d{2}',getattr(a,n)) for n in ('core','full','ui','native','clients','scan'))
    baseline_bytes=git(ROOT,'show','58d523b:docs/quality/requirements-alignment-progress.json');baseline=json.loads(baseline_bytes)
    assert (ROOT/'docs/quality/history/stage58-before-creative-matrices/requirements-alignment-progress.json').read_bytes()==baseline_bytes
    assert len(baseline['requirements'])==102 and baseline['fully_accepted_requirements']==0 and baseline['qualified_live_roles']==0
    assert digest(ROOT/'docs/contracts/openapi.json')==OPENAPI_SHA
    core=suite('creative-matrix-core-'+a.core);full=suite('creative-matrix-regression-'+a.full)
    c=read(ROOT/core['path']);f=read(ROOT/full['path']);assert c['component_sources']==f['component_sources']
    assert f['source_files']=={**source_snapshot(),'.env.example':digest(PLATFORM/'.env.example')}
    for component,files in f['component_sources'].items():
        for name,expected in files.items():assert digest(DEV/('copypaste-'+component)/name)==expected
    previous=baseline['provider_admin_verification']['full_platform_regression'];assert previous['counts']['tests']==588
    assert digest(ROOT/previous['raw_report']['path'])==previous['raw_report']['sha256']
    assert not (named(ROOT/previous['raw_report']['path'])-named(ROOT/full['raw_report']['path']))
    assert not (named(ROOT/core['raw_report']['path'])-named(ROOT/full['raw_report']['path']))
    assert core['counts']['tests']>=22 and full['counts']['tests']>=607
    static_path=DELIVERY/'evidence/creative-matrix-static-01.json';static=read(static_path)
    assert static['status']=='passed' and static['source_unchanged'] and static['source_files']==f['source_files']
    assert digest(DELIVERY/static['verifier_snapshot'])==static['verifier_sha256']
    for x in static['checks']:assert x['exit_code']==0 and digest(DELIVERY/x['raw_report'])==x['raw_sha256']
    api=read(ROOT/'docs/contracts/creative-matrix-openapi.json');assert (ROOT/'docs/contracts/creative-matrix-openapi.json').read_bytes()==(PLATFORM/'contracts/creative-matrix-openapi.json').read_bytes()
    assert api['x-normative-source-sha256']==OPENAPI_SHA and api['x-model-source-sha256']==digest(PLATFORM/'src/creative-matrix-model.ts') and api['x-route-source-sha256']==digest(PLATFORM/'src/creative-matrices.ts')
    assert sum(len(v) for v in api['paths'].values())==6 and len(api['components']['schemas'])==9
    ui_receipts=[]
    for kind,id,minimum in (('ui',a.ui,10),('native',a.native,13)):
        path=DELIVERY/f'evidence/creative-matrix-{kind}-{id}.json';r=read(path)
        assert r['status']=='passed' and r['source_unchanged'] and r['web_build_unchanged'] and r['owned_database_shutdown'] and r['owned_web_preview_closed']
        for k in ('journey','raw_report','verifier','journey_verifier'):assert digest(DELIVERY/r[k]['path'])==r[k]['sha256']
        j=read(DELIVERY/r['journey']['path']);assert j['status']=='passed' and len(j['checks'])>=minimum and not j['errors'] and j['browser_closed'] and j['owned_api_closed']
        for key,expected in r['source_files'].items():
            if key.startswith(('copypaste-platform/','copypaste-web/')):assert digest(DEV/key)==expected
        for image in j['screenshots']:assert digest(DEV/image['path'])==image['sha256']
        if kind=='ui':
            defs=api['components']['schemas']
            for sample in j['samples']:Draft202012Validator({'$defs':defs,'$ref':'#/$defs/'+sample['schema']},format_checker=FormatChecker()).validate(sample['response'])
            assert len(j['samples'])>=6
        else:assert j['desktop_closed'] and j['extension_closed'] and j['artifacts_unchanged_after_run']
        ui_receipts.append({**receipt(path),'actual_checks':len(j['checks']),'actual_response_samples':len(j.get('samples',[]))})
    clients_path=DELIVERY/f'evidence/creative-matrix-clients-{a.clients}.json';clients=read(clients_path);assert clients['status']=='passed' and clients['source_unchanged']
    assert len(clients['checks'])==9
    for check in clients['checks']:assert check['exit_code']==0 and digest(DELIVERY/check['raw_report'])==check['raw_sha256']
    for file,expected in clients['source_files'].items():
        repo,relative=file.split('/',1)
        if repo!='delivery':assert digest(DEV/('copypaste-'+repo)/relative)==expected
    upgrade_path=DELIVERY/'evidence/creative-matrix-upgrade.json';upgrade=read(upgrade_path);before_path=DELIVERY/'evidence/creative-matrix-migrations-before.json';after_path=DELIVERY/'evidence/creative-matrix-migrations.json';before=read(before_path);after=read(after_path)
    assert upgrade['status']=='passed' and upgrade['owned_database_shutdown'] and after['status']=='passed'
    for d in after['databases']:
        old=next(x for x in before['databases'] if x['database']==d['database']);assert d['original']==old['original'] and len(d['original'])==151
        assert len(d['migrations'])==69 and d['migrations'][:68]==old['migrations'] and d['synthetic_history_added'] is False
        assert len(d['controls'])==3 and all(x['count']==0 and x['rls']['relforcerowsecurity'] for x in d['controls'].values())
    old_sql=git(PLATFORM,'ls-tree','-r','--name-only','b79b3a5','--','migrations').decode().splitlines();assert len(old_sql)==68
    for name in old_sql:assert (PLATFORM/name).read_bytes()==git(PLATFORM,'show','b79b3a5:'+name)
    artifacts_path=ROOT/'docs/quality/creative-matrix-artifacts.json';artifacts=read(artifacts_path);assert artifacts['status']=='passed' and artifacts['prior_client_packages_unchanged']
    assert artifacts_path.read_bytes()==(DELIVERY/'evidence/creative-matrix-artifacts.json').read_bytes()
    for x in artifacts['artifacts']:assert digest(DEV/x['path'])==x['sha256']
    scan_path=ROOT/f'docs/quality/creative-matrix-credential-scan-{a.scan}.json';scan=read(scan_path);assert scan['status']=='passed' and scan['configured_patterns']>0 and not scan['matches']
    for x in scan['files']:assert digest(ROOT/x['path'])==x['sha256']
    assert scan['verifier_sha256']==digest(ROOT/'docs/tools/scan_creative_matrix_credentials.mjs')
    recovery=read(DELIVERY/'evidence/creative-matrix-source-recovery.json')
    for x in recovery['files']:assert digest(ROOT/x['path'])==x['sha256']
    recheck_path=ROOT/'docs/quality/creative-matrix-client-recheck-01.json';recheck=read(recheck_path)
    assert recheck['status']=='passed' and recheck['native_checks']==13 and recheck['embedded_files']==31 and recheck['extension_zip_entries']==20
    assert recheck['manifest_sha256']==digest(artifacts_path) and not recheck['browsers_or_apps_started']
    assert recheck['verifier_sha256']==digest(ROOT/'docs/tools/verify_creative_matrix_clients.mjs')
    history_path=ROOT/'docs/quality/creative-matrix-initial-scan-history.json';history=read(history_path)
    initial_path=ROOT/'docs/quality/creative-matrix-credential-scan-01.json';initial=read(initial_path)
    assert history['initial_scan_sha256']==digest(initial_path) and history['status']=='historical_superseded_scan'
    retained={x['source']:x for x in history['retained_inputs']}
    for x in initial['files']:
        if digest(ROOT/x['path'])!=x['sha256']:
            original=retained[x['path']];assert digest(ROOT/original['path'])==original['sha256']==x['sha256']
    attempts=[suite(path.stem) for path in sorted((DELIVERY/'evidence').glob('creative-matrix-core-??.json'))]
    checkpoint={'at':datetime.now(timezone.utc).isoformat(),'scope':'Deterministic design matrices with actual independent PNG/SVG/source output, local edits/retries, bounded durable execution, current authorization and source/derived erasure; authorized simulations, no AI calls in the layout flow',
        'documentation_verifier':receipt(Path(__file__).resolve()),'baseline_source_commit':'58d523b','original_scope':{'requirements':102,'fully_accepted_requirements':0,'qualified_live_roles':0,'all_TC_NFR_G01_G10_retained':True},
        'focused':core,'full_platform_regression':full,'platform_build_and_types':receipt(static_path),'actual_web':ui_receipts[0],'actual_native_clients':ui_receipts[1],'client_checks':receipt(clients_path),'executions':attempts,
        'current_component_sources':f['component_sources'],'supplemental_contract':receipt(ROOT/'docs/contracts/creative-matrix-openapi.json'),'contract_operations':6,'contract_schemas':9,
        'local_database_upgrade':{'execution':receipt(upgrade_path),'before':receipt(before_path),'after':receipt(after_path)},'immutable_migrations_001_068':{name:digest(PLATFORM/name) for name in old_sql},'migration_069':receipt(PLATFORM/'migrations/069-creative-production-matrices.sql'),
        'client_artifacts':receipt(artifacts_path),'current_client_recheck':receipt(recheck_path),'source_recovery':receipt(DELIVERY/'evidence/creative-matrix-source-recovery.json'),'configured_credential_scan':receipt(scan_path),'superseded_initial_scan_history':receipt(history_path),
        'remaining':['Codex delegation and complete professional/media delivery acceptance beyond local composition','Font sources/commercial authorization and custom font distribution','Original TC/NFR/G01–G10, production services, signed installation and store distribution']}
    updated=json.loads(baseline_bytes)
    repair={'cluster':'creative_production_matrices','verified_subflow':'3 创意 × 2 语言 × 3 尺寸独立单元、实际 60 格、单格失败/修改/重试、当前权限、取消与租约、真实 PNG/SVG/编辑文件、派生隔离和物理删除；排版本身不调用 AI。','evidence':['creative_matrix_verification'],'implementation_docs':['technical/59-creative-production-matrices.md']}
    for row in updated['requirements']:
        if row['requirement_id'] in {f'REQ-{n:03}' for n in (12,16,17,22,48,49,52)}:row.setdefault('verified_repairs',[]).append(repair)
        if row['requirement_id']=='REQ-017':
            row['assessment']='partial_verified';row['finding']='本地确定性排版矩阵与 TC-017 的 18 格、局部失败/修改/重试和 60 格边界已执行验证；尚未完成完整 Agent 委派及其他专业/多媒体交付资格。'
            row['remaining_complete_acceptance_conditions']='继续串联完整 Codex 委派与专业素材交付；本次本地排版未调用 AI，零费用不替代真实模型、字体、视频和综合发行资格。'
            row['acceptance_case_execution']='local_composition_subflow_passed';row['acceptance_evidence']=list(dict.fromkeys([*row.get('acceptance_evidence',[]),'creative_matrix_verification']))
    for old,new in zip(baseline['requirements'],updated['requirements']):
        for key in ('requirement_id','priority','requirement','acceptance_case','acceptance_conditions','original_finding'):assert old[key]==new[key]
    assert updated['gates']==baseline['gates'] and updated['nfr_full_acceptance']==baseline['nfr_full_acceptance']
    updated['at']=checkpoint['at'];updated['summary']=dict(Counter(r['assessment'] for r in updated['requirements']));updated['creative_matrix_verification']=checkpoint;updated['evidence']['platform_regression']=full
    updated['evidence_currentness_policy']+=' Stage59: matrix native database, actual built Web and newly packaged frameless Desktop/native Side Panel bind their own unchanged source and artifact bytes. Earlier stage receipts retain their original execution scope.'
    if a.write:
        (ROOT/'docs/quality/creative-matrix-checkpoint.json').write_text(json.dumps(checkpoint,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
        (ROOT/'docs/quality/requirements-alignment-progress.json').write_text(json.dumps(updated,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({'status':'passed','write':a.write,'focused':core['counts'],'full':full['counts'],'actual_web':ui_receipts[0]['actual_checks'],'actual_native':ui_receipts[1]['actual_checks'],'summary':updated['summary'],'fully_accepted_requirements':0}))


if __name__=='__main__':main()
