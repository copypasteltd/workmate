"""Admit source-bound native video evidence without changing original acceptance."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import re
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker
from refresh_stage52_capabilities import ROOT, DEV, PLATFORM, DELIVERY, OPENAPI_SHA, digest, git, read, receipt, verify_run


def named(path):
    return Counter(re.findall(r'^\s*(?:ok|not ok) \d+ - (.+?)\r?$', path.read_text(encoding='utf-8'), re.M))


def suite(name):
    path = DELIVERY/'evidence'/(name+'.json'); r = read(path)
    out = verify_run(name, expected_status=r['status'], verifier_snapshot=DELIVERY/r['verifier_snapshot'])
    c = r['fixture_cleanup']
    assert c['status']=='passed' and c['workers_exited'] and c['actual_filesystem_checked'] and all(x['reclaimed'] for x in c['results'])
    assert digest(DELIVERY/c['path']) == c['sha256']
    for component, data in read(DELIVERY/r['source_preimages']).items():
        for f in data['files']:
            assert digest(DELIVERY/f['path']) == f['sha256'] == r['component_sources'][component][f['source']]
    if 'retention_migration_snapshot' in r:
        assert digest(DELIVERY/r['retention_migration_snapshot']) == r['retention_migration_sha256']
    return out


def renderer_attempt(path):
    data = read(path)
    assert data['source_unchanged'] and data['passed'] + data['failed'] == 8
    for key in ('raw_report', 'preimages', 'verifier'):
        item = data[key]
        assert digest(DELIVERY/item['path']) == item['sha256']
    for item in read(DELIVERY/data['preimages']['path'])['files']:
        assert digest(DELIVERY/item['path']) == item['sha256']
    assert data['status'] == ('passed' if data['failed'] == 0 else 'failed')
    assert data['exit_code'] == (0 if data['failed'] == 0 else 1)
    return {**receipt(path), 'status':data['status'], 'passed':data['passed'], 'failed':data['failed']}


def main():
    parser = argparse.ArgumentParser()
    for name in ('core','full','ui','native','clients','scan'):
        parser.add_argument('--'+name, required=True)
    parser.add_argument('--documentation', help='Optional admitted documentation-only report filename')
    parser.add_argument('--write', action='store_true'); a = parser.parse_args()
    assert all(re.fullmatch(r'\d{2}', getattr(a,n)) for n in ('core','full','ui','native','clients','scan'))
    original = git(ROOT,'show','59728b4:docs/quality/requirements-alignment-progress.json')
    baseline = json.loads(original)
    history = ROOT/'docs/quality/history/stage59-before-template-video/requirements-alignment-progress.json'
    assert history.read_bytes() == original
    assert len(baseline['requirements']) == 102 and baseline['fully_accepted_requirements'] == baseline['qualified_live_roles'] == 0
    assert digest(ROOT/'docs/contracts/openapi.json') == OPENAPI_SHA
    core = suite('template-video-core-'+a.core); full = suite('template-video-regression-'+a.full)
    c = read(ROOT/core['path']); f = read(ROOT/full['path'])
    assert c['component_sources'] == f['component_sources']
    for component, files in f['component_sources'].items():
        for name, expected in files.items():
            assert digest(DEV/('copypaste-'+component)/name) == expected, name
    assert core['counts']['tests'] >= 34 and full['counts']['tests'] >= 638
    previous = baseline['creative_matrix_verification']['full_platform_regression']
    assert previous['counts']['tests'] == 607
    assert digest(ROOT/previous['raw_report']['path']) == previous['raw_report']['sha256']
    assert not (named(ROOT/previous['raw_report']['path'])-named(ROOT/full['raw_report']['path']))
    assert not (named(ROOT/core['raw_report']['path'])-named(ROOT/full['raw_report']['path']))
    static_path = DELIVERY/'evidence/template-video-static-02.json'; static = read(static_path)
    assert static['status']=='passed' and static['source_unchanged'] and static['source_files']==f['source_files']
    assert digest(DELIVERY/static['verifier_snapshot']) == static['verifier_sha256']
    assert digest(DELIVERY/static['compiled_runtime_verifier']['path']) == static['compiled_runtime_verifier']['sha256']
    for x in static['checks']:
        assert x['exit_code']==0 and digest(DELIVERY/x['raw_report'])==x['raw_sha256']
    api_path = ROOT/'docs/contracts/template-video-openapi.json'; api = read(api_path)
    assert api_path.read_bytes() == (PLATFORM/'contracts/template-video-openapi.json').read_bytes()
    assert api['x-normative-source-sha256']==OPENAPI_SHA
    assert api['x-model-source-sha256']==digest(PLATFORM/'src/video-project-model.ts') and api['x-route-source-sha256']==digest(PLATFORM/'src/video-projects.ts')
    assert sum(len(v) for v in api['paths'].values())==7 and len(api['components']['schemas'])==12
    ui_receipts=[]
    for kind, number, minimum in (('ui',a.ui,10),('native',a.native,17)):
        p=DELIVERY/f'evidence/template-video-{kind}-{number}.json';r=read(p)
        assert r['status']=='passed' and r['source_unchanged'] and r['web_build_unchanged'] and r['owned_database_shutdown'] and r['owned_web_preview_closed']
        for k in ('journey','raw_report','verifier','journey_verifier'):
            assert digest(DELIVERY/r[k]['path']) == r[k]['sha256']
        j=read(DELIVERY/r['journey']['path'])
        assert j['status']=='passed' and len(j['checks'])>=minimum and not j['errors'] and j['browser_closed'] and j['owned_api_closed']
        for key,expected in r['source_files'].items():
            if key.startswith(('copypaste-platform/','copypaste-web/')):
                assert digest(DEV/key)==expected,key
        for image in j['screenshots']:
            assert digest(DEV/image['path'])==image['sha256']
        if kind=='ui':
            defs=api['components']['schemas']
            for sample in j['samples']:
                Draft202012Validator({'$defs':defs,'$ref':'#/$defs/'+sample['schema']},format_checker=FormatChecker()).validate(sample['response'])
            assert len(j['samples']) >= 8
        else:
            assert j['desktop_closed'] and j['extension_closed'] and j['artifacts_unchanged_after_run']
            assert j['inspection']['video']['playback']['paused'] is False and j['inspection']['video']['project_download']['actual_native_save']
        ui_receipts.append({**receipt(p),'actual_checks':len(j['checks']),'actual_response_samples':len(j.get('samples',[]))})
    clients_path=DELIVERY/f'evidence/template-video-clients-{a.clients}.json'; clients=read(clients_path)
    assert clients['status']=='passed' and clients['source_unchanged'] and len(clients['checks'])==9
    for check in clients['checks']:
        assert check['exit_code']==0 and digest(DELIVERY/check['raw_report'])==check['raw_sha256']
    for file,expected in clients['source_files'].items():
        repo,relative=file.split('/',1)
        assert digest(DEV/('copypaste-'+repo)/relative)==expected,file
    before_path=DELIVERY/'evidence/template-video-migrations-before.json'; after_path=DELIVERY/'evidence/template-video-migrations.json'; upgrade_path=DELIVERY/'evidence/template-video-upgrade.json'
    before=read(before_path);after=read(after_path);upgrade=read(upgrade_path)
    assert upgrade['status']=='passed' and upgrade['owned_database_shutdown'] and after['status']=='passed'
    for d in after['databases']:
        old=next(x for x in before['databases'] if x['database']==d['database'])
        assert d['original']==old['original'] and len(d['original'])==154 and d['migrations'][:69]==old['migrations'] and len(d['migrations'])==71
        assert d['synthetic_history_added'] is False and len(d['controls'])==3
        assert all(x['count']==0 and x['rls']['relforcerowsecurity'] for x in d['controls'].values())
    old_sql=git(PLATFORM,'ls-tree','-r','--name-only','9ade763','--','migrations').decode().splitlines()
    assert len(old_sql)==69
    for name in old_sql:
        assert (PLATFORM/name).read_bytes()==git(PLATFORM,'show','9ade763:'+name)
    assert digest(PLATFORM/'migrations/070-template-video-projects.sql')==read(DELIVERY/'evidence/template-video-core-02.json')['migration_sha256']
    assert digest(PLATFORM/'migrations/071-video-retention-boundaries.sql')==read(DELIVERY/'evidence/template-video-core-05.json')['retention_migration_sha256']
    font_path=PLATFORM/'assets/fonts/noto-sans-tc/source.json';font=read(font_path)
    assert font['license']=='SIL Open Font License 1.1' and font['source_commit']=='3be1884c48c3e45b52ecc725676a08f87776373e'
    for file in font['files']:
        p=font_path.parent/file['file'];assert p.stat().st_size==file['bytes'] and digest(p)==file['sha256']
    catalogs=[read(p) for p in (ROOT/'docs/contracts/role-preset-catalog.json',PLATFORM/'catalog/role-preset-catalog.json')]
    assert catalogs[0]==catalogs[1]
    skill_path=DELIVERY/'evidence/template-video-skill-validation.json';skill=read(skill_path)
    assert skill['status']=='passed' and skill['original_packages_preserved']==28 and skill['current_packages']==29 and skill['roles']==18 and skill['qualified_live_roles']==0
    for key in ('new_skill_bytes','catalog','verifier'):
        item=skill[key];assert digest(ROOT/item['path'])==item['sha256']
    assert skill['validator']['exit_code']==0 and digest(Path(skill['validator']['path']))==skill['validator']['sha256']
    original_packages=json.loads(git(PLATFORM,'show','9ade763:catalog/skill-packages.json'))
    packages=read(PLATFORM/'catalog/skill-packages.json');indexed={p['key']:p for p in packages}
    assert len(original_packages)==28 and len(packages)==29
    for package in original_packages:
        assert indexed[package['key']]==package and digest(PLATFORM/package['path'])==package['sha256']
    assert indexed['template-video-composition']==skill['new_skill']
    artifacts_path=ROOT/'docs/quality/template-video-artifacts.json';artifacts=read(artifacts_path)
    assert artifacts_path.read_bytes()==(DELIVERY/'evidence/template-video-artifacts.json').read_bytes()
    assert artifacts['status']=='passed' and artifacts['prior_client_packages_unchanged']
    for file in artifacts['artifacts']:
        assert digest(DEV/file['path'])==file['sha256']
    recheck_path=ROOT/'docs/quality/template-video-client-recheck-01.json';recheck=read(recheck_path)
    assert recheck['status']=='passed' and recheck['native_checks']==17 and not recheck['browsers_or_apps_started']
    assert recheck['manifest_sha256']==digest(artifacts_path) and recheck['verifier_sha256']==digest(ROOT/'docs/tools/verify_template_video_clients.mjs')
    scan_path=ROOT/f'docs/quality/template-video-credential-scan-{a.scan}.json';scan=read(scan_path)
    assert scan['status']=='passed' and scan['configured_patterns']>0 and not scan['matches']
    for file in scan['files']:
        assert digest(ROOT/file['path'])==file['sha256'],file['path']
    assert scan['verifier_sha256']==digest(ROOT/'docs/tools/scan_template_video_credentials.mjs')
    attempts=[suite(p.stem) for p in sorted((DELIVERY/'evidence').glob('template-video-core-??.json'))]
    render_attempts=[renderer_attempt(p) for p in sorted((DELIVERY/'evidence').glob('template-video-render-??.json'))]
    assert len(render_attempts)==2 and render_attempts[-1]['passed']==8
    earlier_full=[suite(p.stem) for p in sorted((DELIVERY/'evidence').glob('template-video-regression-??.json')) if p.stem!='template-video-regression-'+a.full]
    documentation=None
    if a.documentation:
        assert re.fullmatch(r'[a-z0-9][a-z0-9-]{0,120}\.json',a.documentation)
        document_path=ROOT/'docs/quality'/a.documentation;document=read(document_path)
        assert document['status']=='passed' and document['checks_failed']==0 and document['counts']['requirements']==document['counts']['acceptance_cases']==102
        assert document['counts']['role_presets']==18 and document['counts']['planned_skill_packages']==29 and document['counts']['qualified_roles']==0
        assert document['verifier_sha256']==digest(ROOT/'docs/tools/validate_docs.py')
        documentation={**receipt(document_path),'scope':document['scope'],'at':document['checked_at']}
    checkpoints={'at':datetime.now(timezone.utc).isoformat(),'scope':'Template campaign video: frozen script, storyboard, supplied media/audio and captions; real rational-frame MP4, protected native playback/downloads, durable revisions/cancel/retry, scoped Admin governance, expiry/share fences and physical erasure. No generated video, speech synthesis or live model qualification.',
        'documentation_verifier':receipt(Path(__file__).resolve()),'baseline_source_commit':'59728b4','prior_progress':receipt(history),
        'original_scope':{'requirements':102,'fully_accepted_requirements':0,'qualified_live_roles':0,'all_TC_NFR_G01_G10_retained':True},
        'focused':core,'full_platform_regression':full,'platform_build_and_types':receipt(static_path),'actual_web':ui_receipts[0],'actual_native_clients':ui_receipts[1],'client_checks':receipt(clients_path),'executions':attempts,'preserved_renderer_attempts':render_attempts,'preserved_earlier_regressions':earlier_full,
        'current_component_sources':f['component_sources'],'supplemental_contract':receipt(api_path),'contract_operations':7,'contract_schemas':12,
        'local_database_upgrade':{'execution':receipt(upgrade_path),'before':receipt(before_path),'after':receipt(after_path)},
        'immutable_migrations_001_069':{name:digest(PLATFORM/name) for name in old_sql},'migration_070':receipt(PLATFORM/'migrations/070-template-video-projects.sql'),'migration_071':receipt(PLATFORM/'migrations/071-video-retention-boundaries.sql'),
        'font_provenance':receipt(font_path),'role_preset_catalog':receipt(ROOT/'docs/contracts/role-preset-catalog.json'),'bounded_product_skill_validation':receipt(skill_path),
        'client_artifacts':receipt(artifacts_path),'current_client_recheck':receipt(recheck_path),'configured_credential_scan':receipt(scan_path),'packaging_history':receipt(DELIVERY/'evidence/template-video-packaging-history.json'),
        'remaining':['Full professional role/campaign qualification and external service acceptance','Separate REQ019 generated video, REQ020 effects, REQ021 TTS/ASR','Custom font distribution beyond the pinned bundled font; signed installation/store, all TC/NFR/G01-G10']}
    updated=json.loads(original)
    repair={'cluster':'template_video_production','verified_subflow':'独立脚本/分镜/固定来源/字幕/授权音轨工程，真实 15 秒 9:16 成片与六项交付；版本/失败/重试/取消、当前权限、过期/分享访问、独立 Admin 正文权限及物理删除；实际 Web、无边框 Desktop 和原生侧栏入口。','evidence':['template_video_verification'],'implementation_docs':['technical/60-template-video-production.md']}
    for row in updated['requirements']:
        if row['requirement_id'] in {f'REQ-{n:03}' for n in (12,16,18,22,36,39,48,49,52)}:
            row.setdefault('verified_repairs',[]).append(repair)
        if row['requirement_id']=='REQ-018':
            row['assessment']='partial_verified'
            row['finding']='campaign-cuts-1 模板已验证独立工程、脚本/分镜、字幕/安全区、品牌元素、授权音轨、可播放 MP4、整数帧/有理帧率和六类真实文件；完整专业角色与综合发行验收仍独立跟踪。'
            row['remaining_complete_acceptance_conditions']='当前工程重做需要同项目固定来源与记录的渲染环境，不是嵌入所有源素材的离线自包含工程；编码器指纹记录版本输出，不保证跨环境逐字节相同。继续专业角色完整委派、独立业务与综合 TC/NFR/G01–G10；生成视频/特效/TTS/ASR 依各自要求验收。'
            row['acceptance_case_execution']='local_template_video_subflow_passed'
            row['acceptance_evidence']=list(dict.fromkeys([*row.get('acceptance_evidence',[]),'template_video_verification']))
    for old,new in zip(baseline['requirements'],updated['requirements']):
        for key in ('requirement_id','priority','requirement','acceptance_case','acceptance_conditions','original_finding'):
            assert old[key]==new[key]
    assert updated['gates']==baseline['gates'] and updated['nfr_full_acceptance']==baseline['nfr_full_acceptance']
    updated['at']=checkpoints['at'];updated['summary']=dict(Counter(r['assessment'] for r in updated['requirements']))
    assert updated['summary']=={'partial_verified':75,'completion_not_proven':27}
    updated['template_video_verification']=checkpoints;updated['evidence']['platform_regression']=full
    if documentation:
        checkpoints['documentation_contracts']=documentation
        updated['evidence']['documentation_contracts_stage60']=documentation
    updated['evidence_currentness_policy']+=' Stage60: native template-video, expiry/share fences and supplied media bind their own current source bytes, real Web/packaged frameless Desktop/native Side Panel and font/package hashes. Earlier executions retain their original scope.'
    if a.write:
        for p,value in ((ROOT/'docs/quality/template-video-checkpoint.json',checkpoints),(ROOT/'docs/quality/requirements-alignment-progress.json',updated)):
            p.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({'status':'passed','write':a.write,'focused':core['counts'],'full':full['counts'],'actual_web':ui_receipts[0]['actual_checks'],'actual_native':ui_receipts[1]['actual_checks'],'summary':updated['summary'],'fully_accepted_requirements':0}))


if __name__=='__main__':
    main()
