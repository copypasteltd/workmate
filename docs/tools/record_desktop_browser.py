"""Bind actual native browser/layout evidence without changing acceptance."""
import argparse
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[2]
DEV=ROOT/'dev'
DELIVERY=DEV/'copypaste-delivery'

def read(file):
    return json.loads(file.read_text(encoding='utf-8'))

def digest(file):
    return sha256(file.read_bytes()).hexdigest()

def bound(item):
    file=(DELIVERY/item['path']).resolve()
    assert file.is_relative_to(DELIVERY) and digest(file)==item['sha256'],item
    return file

def cases(file):
    return Counter(re.findall(r'^[ \t]*ok \d+ - (.+)\r?$',file.read_text(encoding='utf-8'),re.M))

def batch_cases(index):
    result=Counter()
    for item in index['batches']:
        batch=read(bound(item))
        assert batch['status']=='passed' and batch['source_unchanged'] and batch['owned_database_shutdown']
        cleanup=read(bound(batch['fixture_cleanup']))
        assert cleanup['status']=='passed' and all(row['reclaimed'] for row in cleanup['results'])
        result+=cases(bound(batch['raw_report']))
    return result

def main():
    parser=argparse.ArgumentParser()
    for key in ['control','native','ui','browser']:
        parser.add_argument('--'+key,required=True)
    selected=vars(parser.parse_args())
    assert all(re.fullmatch(r'\d{2}',value) for value in selected.values())
    files={'platform':f"evidence/desktop-execution-control-{selected['control']}.json",
        'native_supervisor':f"evidence/local-codex-native-{selected['native']}.json",
        'ui':f"evidence/desktop-local-ui-{selected['ui']}.json",
        'browser':f"evidence/desktop-browser-{selected['browser']}.json"}
    reports={key:read(DELIVERY/name) for key,name in files.items()}
    source,scopes={},[]
    for key,report in reports.items():
        assert report['status']=='passed' and report['source_unchanged'],key
        if 'owned_database_shutdown' in report:
            assert report['owned_database_shutdown'],key
        if 'counts' in report and 'tests' in report['counts']:
            counts=report['counts']
            assert counts['pass']==counts['tests']>0 and all(counts[name]==0 for name in ['fail','cancelled','skipped','todo'])
        for name in ['raw_report','verifier','journey_verifier']:
            if isinstance(report.get(name),dict):
                bound(report[name])
        if isinstance(report.get('raw_report'),str):
            assert digest(DELIVERY/report['raw_report'])==report['raw_sha256']
        if key=='browser':
            assert digest(DELIVERY/report['raw_log'])==report['raw_log_sha256']
        entries=report['source_files']
        if key=='native_supervisor':
            entries={'copypaste-desktop/'+name:value for name,value in entries.items()}
        for name,value in entries.items():
            assert digest(DEV/name)==value,(key,name,'Selected evidence must match final source exactly')
            assert name not in source or source[name]==value
            source[name]=value
        scopes.append({'scope':key,'report':files[key],'sha256':digest(DELIVERY/files[key]),'source_files':len(entries),'later_source_differences':[]})
    platform=reports['platform']
    index=read(bound(platform['raw_report']))
    plan=read(bound(index['plan']))
    current=batch_cases(index)
    previous=batch_cases(read(DELIVERY/'evidence/desktop-execution-control-18-index.json'))
    assert sum(previous.values())==848 and not previous-current
    assert sum(current.values())==platform['counts']['tests']
    assert len(plan['files'])==66 and len(plan['batches'])==17
    ui=reports['ui']
    journey=read(bound(ui['journey']))
    assert journey['status']=='passed' and len(journey['checks'])==25
    assert all(journey[key] for key in ['electron_closed','browser_closed','api_closed','fixture_closed','native_browser_fixture_closed'])
    assert journey['fixture_company_max_active_tasks']==32
    assert journey['fixture_isolated_capacity_policy']=={'agent_slots':32,'tenant_slots':32}
    assert journey['fixture_isolated_provider_policy']=={'version':2,'slots':32,'rpm':10000}
    assert 68 in [int(value) for value in re.findall(r'^# tests (\d+)\r?$',bound(ui['raw_report']).read_text(encoding='utf-8'),re.M)]
    assert reports['native_supervisor']['counts']['tests']==17
    browser=reports['browser']['journey']
    assert browser['status']=='passed' and len(browser['checks'])==10 and browser['owned_windows_closed'] and browser['http_server_closed']
    for media in [journey['media'],journey['native_browser_media'],browser['media']]:
        assert media['skipped_capture_errors']==0 and media['distinct_frames']>1
        for item in media['files']:
            assert digest(DEV/item['path'])==item['sha256']
    for item in journey['screenshots']:
        assert digest(DEV/item['path'])==item['sha256'] and item['edited'] is False
    baseline=ROOT/'docs/quality/history/before-desktop-browser-sources/copypaste-platform'
    migrations=sorted((baseline/'migrations').glob('*.sql'))
    assert len(migrations)==94
    for file in migrations:
        assert digest(file)==digest(DEV/'copypaste-platform/migrations'/file.name),file.name
    assert digest(baseline/'contracts/implemented-routes.json')==digest(DEV/'copypaste-platform/contracts/implemented-routes.json')
    assert len(read(DEV/'copypaste-platform/contracts/implemented-routes.json')['routes'])==428
    assert (DEV/'copypaste-desktop/src/browser-contract.ts').read_bytes()==(DEV/'copypaste-platform/src/browser-contract.ts').read_bytes()
    progress=read(ROOT/'docs/quality/requirements-alignment-progress.json')
    assert len(progress['requirements'])==102 and progress['fully_accepted_requirements']==0 and progress['summary']=={'partial_verified':81,'completion_not_proven':21}
    for tool in ['open','snapshot','interact','screenshot','wait','close']:
        assert any(item['tool']==tool and item['actual_output'] for item in journey['native_browser_tool_results'])
    result={'at':datetime.now(timezone.utc).isoformat(),'stage':77,'status':'verified_bounded_native_browser_and_desktop_layout','selected':selected,
        'scope':'Real customer-device Codex/browser, full local permission, company gateway/auth/usage, actual files/screenshots/downloads and Stop/revoke; frameless reflow without visible scrollbar rails, real wheel/Home/End/focus, bilingual themes and account pages. Explicit synthetic model/business/dialog decisions.',
        'platform_tests':platform['counts'],'native_supervisor_tests':reports['native_supervisor']['counts'],'client_unit_tests':68,'native_ui_checks':25,'browser_checks':10,
        'inventory':{'test_files':len(plan['files']),'batches':len(plan['batches']),'plan':index['plan'],'index':platform['raw_report'],'all_raw_tap_and_cleanup_hashes_verified':True},
        'original_regression':{'previous_tests_preserved':848,'new_tests':sum(current.values())-848,'all_nested_cases_retained':True},
        'source_files':source,'qualification_scopes':scopes,'packaged':ui['packaged'],'screenshots':journey['screenshots'],'media':journey['media'],'native_browser_media':journey['native_browser_media'],'browser_media':browser['media'],'documentation_media':[],
        'migration_integrity':{'published_sql_001_through_094':'94 exact original byte copies unchanged','new_migrations':0},'http_routes':428,
        'local_browser_tools':12,'native_role_admissions':18,'required_roles':18,'required_skills':29,
        'fixture_company_capacity':{'max_active_tasks':32,'isolated_agent_slots':32,'isolated_tenant_slots':32,'isolated_provider_policy':journey['fixture_isolated_provider_policy'],'scope':'Only the isolated UI database/tenant has configured extra allocations to retain all unknown cancellation holds; production defaults and capacity enforcement are unchanged. The bootstrap provider policy remains immutable; the fixture creates version 2.'},
        'original_acceptance':read(ROOT/'docs/quality/desktop-workflow-checkpoint.json')['original_acceptance'],
        'failed_attempts_retained':[f'desktop-browser-{n:02}' for n in range(1,14)]+[f'desktop-local-ui-{n:02}' for n in range(22,28)],
        'limits':['Role admission is not full professional delivery','Main-frame DOM observation; cross-origin frame DOM is not claimed','Not complete third-party application or Codex Desktop parity','Live internal models, payments, connectors and production acceptance remain pending','Native system-dialog decisions are explicit fixtures','Extension sources/verifiers compared separately; no new Extension UI run','Touchpad uses preserved native scrolling; this automated journey injects real wheel and keyboard events, not a physical touchpad'],
        'verifier_sha256':digest(Path(__file__))}
    output=ROOT/'docs/quality/desktop-browser-checkpoint.json'
    with output.open('x',encoding='utf-8') as stream:
        stream.write(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'status':result['status'],'tests':platform['counts']['tests'],'sources':len(source),'ui':25,'client':68}))

if __name__=='__main__':
    main()
