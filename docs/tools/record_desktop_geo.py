"""Record native GEO from immutable test, real Electron and client build receipts."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import json
import re
import shutil
import subprocess

ROOT=Path(__file__).resolve().parents[2]; DEV=ROOT/'dev'; DELIVERY=DEV/'copypaste-delivery'; QUALITY=ROOT/'docs/quality'
CP=QUALITY/'desktop-geo-checkpoint.json'; BASE=QUALITY/'audio-accounting-checkpoint.json'
COMPONENTS=['platform','web','admin','desktop','extension','delivery']
def read(p): return json.loads(p.read_text('utf-8'))
def digest(p): return sha256(p.read_bytes()).hexdigest()
def ref(p): return {'path':p.relative_to(ROOT).as_posix(),'sha256':digest(p)}
def write(p,v): p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
def git(repo,*args): return subprocess.check_output(['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false',*args],cwd=repo)
def checked(p):
    value=read(p);assert value['source_unchanged'],p
    for c in value.get('checks',[]):
        if not isinstance(c,dict) or 'raw_report' not in c: continue
        raw=DELIVERY/c['raw_report']['path'];assert digest(raw)==c['raw_report']['sha256']
        if 'counts' in c:
            actual={k:int(re.findall(r'^# '+k+r' (\d+)\r?$',raw.read_text('utf-8'),re.M)[0]) for k in ['tests','pass','fail','cancelled','skipped','todo']}
            assert actual==c['counts']
    return value
def record(core,ui,clients):
    paths=[DELIVERY/f'evidence/desktop-geo-core-{core}.json',DELIVERY/f'evidence/desktop-geo-ui-{ui}.json',DELIVERY/f'evidence/desktop-geo-clients-{clients}.json']
    backend,browser,builds=[checked(p) for p in paths]
    for v in [backend,browser,builds]: assert v['status']=='passed' and v['owned_database_shutdown']
    for v in [backend,builds]: assert all(c['exit_code']==0 for c in v['checks'])
    counted={c['name']:c['counts'] for c in backend['checks'] if 'counts' in c}
    assert set(counted)=={'backend','desktop-unit','native-codex'}
    assert counted['backend']['tests']>100 and counted['desktop-unit']['tests']>=46 and counted['native-codex']['tests']>15
    for c in counted.values(): assert c['tests']==c['pass'] and all(c[k]==0 for k in ['fail','cancelled','skipped','todo'])
    assert browser['packaged_unchanged'] and browser['owned_preview_closed']
    journey_path=DELIVERY/browser['journey']['path'];assert digest(journey_path)==browser['journey']['sha256'];journey=read(journey_path)
    assert journey['status']=='passed' and len(journey['checks'])==9 and len(journey['screenshots'])==5
    assert all(journey[k] for k in ['electron_closed','browser_closed','api_closed','fixture_closed','provider_closed'])
    assert journey['provider_calls']==4 and len(journey['native_tasks'])==8
    assert sum(t['status']=='succeeded' and t['charged_micros']=='30' for t in journey['native_tasks'])==4
    assert sum(t['status']=='cancelled' and t['charged_micros']=='0' for t in journey['native_tasks'])==3
    assert sum(t['status']=='failed' and t['charged_micros']=='0' for t in journey['native_tasks'])==1
    assert any(r['code']=='AI_REQUEST_BUDGET_EXHAUSTED' for r in journey['gateway_rejections'])
    assert len({t['client_report']['thread_id'] for t in journey['native_tasks'] if t['status']=='succeeded'})==4
    assert journey['media']['distinct_frames']>1 and journey['media']['skipped_capture_errors']==0
    assert len(builds['checks'])==11
    baseline=read(BASE);assert baseline['status']=='verified_audio_accounting'
    sources=dict(baseline['source_files']);corrections=[]
    for p,v in zip(paths,[backend,browser,builds]):
        for n,h in v['source_files'].items():
            path=DEV/n
            if digest(path)!=h:
                assert p==paths[0] and n in ['copypaste-desktop/renderer-source.json','copypaste-desktop/renderer/src/native-geo.tsx'],n
                assert browser['source_files'][n]==builds['source_files'][n]==digest(path),n
                before=DELIVERY/f'evidence/desktop-geo-core-{core}-sources'/n
                assert digest(before)==h
                if n.endswith('renderer-source.json'):
                    expected=read(before)
                    for name in read(path)['files']:expected['files'][name]=digest(path.parent/'renderer'/name)
                    assert expected==read(path)
                corrections.append({'path':'dev/'+n,'before':ref(before),'after_sha256':digest(path),'reason':'The final renderer adds customer guidance after a failed observation and refreshes its exact metadata; actual unsigned Electron insufficient-budget and success flows plus the final client builds qualify these files. Backend, controller and kernel sources retain the exact core-tested bytes.'})
                continue
            sources['dev/'+n]=h
    contract=ROOT/'docs/contracts/desktop-geo.openapi.json';mirror=DEV/'copypaste-platform/contracts/desktop-geo-schemas.json'
    assert read(contract)['x-historical-geo-contract']['sha256']==digest(ROOT/'docs/contracts/geo-observation-openapi.json')
    assert read(mirror)['normative_source_sha256']==digest(contract) and read(mirror)['schemas']==read(contract)['components']['schemas']
    sources[contract.relative_to(ROOT).as_posix()]=digest(contract)
    assert len([n for n in baseline['source_files'] if n.startswith('dev/copypaste-platform/migrations/')])==122
    for n,h in baseline['source_files'].items():
        if n.startswith('dev/copypaste-platform/migrations/'): assert sources[n]==h
    for n,h in sources.items(): assert digest(ROOT/n)==h,n
    for row in journey['screenshots']+journey['media']['files']: assert digest(DEV/row['path'])==row['sha256']
    progress=read(QUALITY/'requirements-alignment-progress.json');original=read(QUALITY/'history/stage96-before-solution-packages/receipt.json')
    assert progress['requirements']==original['requirements'] and progress['gates']==original['gates']
    assert progress['fully_accepted_requirements']==progress['qualified_live_roles']==0
    attempts=[]
    for pattern in ['desktop-geo-core-??.json','desktop-geo-focused-??.json','desktop-geo-native-??.json','desktop-geo-ui-??.json','desktop-geo-clients-??.json']:
        for p in sorted((DELIVERY/'evidence').glob(pattern)):
            v=checked(p);attempts.append({**ref(p),'status':v['status'],'error':v.get('error')})
    write(CP,{'at':datetime.now(timezone.utc).isoformat(),'stage':110,'status':'verified_desktop_native_geo',
        'scope':'Desktop-native fixed GEO questions, exact atomic holds, fresh local Codex threads and empty workspaces, company-only Responses with no OS/business tools, permission/source revocation, original-answer capture and fees. Synthetic accounts and model answers; affected functionality only.',
        'source_files':dict(sorted(sources.items())),'selected_core':ref(paths[0]),'selected_ui':ref(paths[1]),'client_builds':ref(paths[2]),'counts':counted,
        'journey':ref(journey_path),'actual_ui_checks':9,'screenshots':journey['screenshots'],'recordings':[journey['media']],
        'post_core_renderer_corrections':corrections,'attempts':attempts,'new_migrations':[ref(DEV/'copypaste-platform/migrations/123-desktop-native-geo.sql')],
        'new_routes':['GET /v1/tenants/:tenant/projects/:project/geo/experiments/:id/desktop-configuration','POST /v1/tenants/:tenant/projects/:project/geo/experiments/:id/desktop-runs'],
        'retained_stage109':ref(BASE),'retained_stage106':baseline['retained_stage106'],'original_requirements_modified':False,
        'fully_accepted_requirements':0,'qualified_live_roles':0,'verifier_sha256':digest(Path(__file__))})
    print(json.dumps({'status':'verified_desktop_native_geo','sources':len(sources),'counts':counted}))
def sync():
    cp=read(CP);assert cp['verifier_sha256']==digest(Path(__file__))
    changes=[];copies=[]
    for row in cp['screenshots']+[f for m in cp['recordings'] for f in m['files']]:
        src=DEV/row['path'];dst=ROOT/'docs/design/implementation'/('copypaste-desktop__'+src.name)
        assert not dst.exists();shutil.copyfile(src,dst);assert digest(dst)==row['sha256'];copies.append({'source':src.relative_to(ROOT).as_posix(),'target':dst.relative_to(ROOT).as_posix(),'sha256':digest(dst)})
    diagram='```mermaid\nflowchart LR\n  Review[Desktop review] --> Journal[Encrypted local journal]\n  Journal --> API[Company API: atomic holds]\n  API --> Local[Local Codex: fresh question thread]\n  Local --> Gateway[Company Responses and cost receipt]\n  Gateway --> Answer[Original answer and SHA-256]\n  Review --> Stop[Stop or recover original receipt]\n```\n'
    first=cp['screenshots'][0];movie=next(f for f in cp['recordings'][0]['files'] if f['path'].endswith('.gif'))
    for folder in [ROOT/'docs']+[DEV/('copypaste-'+c) for c in COMPONENTS]:
        for name in ['README.md','README.en.md']:
            p=folder/name;old=p.read_bytes();title,body=old.split(b'\n',1);en=name.endswith('.en.md')
            text='<!-- desktop-native-geo-stage110 -->\n'
            text+=('Desktop GEO now runs fixed questions with local Codex in independent empty sessions. Review the exact batch reservation, run or stop questions, recover original receipts, retain full answers and compare new immutable runs. All AI uses the company gateway; observed costs come from company receipts.\n\n' if en else 'Desktop GEO 已接通本机 Codex：独立空白会话、整批费用确认、逐题运行／停止、原回执恢复、原始回答留存与不可改写的重复观测比较。全部 AI 经公司接口，费用依据公司凭证。\n\n')
            text+=f'{cp["counts"]["backend"]["tests"]} backend checks · {cp["counts"]["desktop-unit"]["tests"]} Desktop unit checks · {cp["counts"]["native-codex"]["tests"]} actual native Codex checks · 9 actual Electron flows · 11 build/type checks. '
            text+=('Synthetic accounts and models; native answers are client reported. Live model quality, production signing and whole-product acceptance remain unproven.\n\n' if en else '明确使用假账号与假模型；本机回答标记为客户端报告。真实模型效果、生产签名与全产品验收尚未证明。\n\n')
            if folder==ROOT/'docs':
                text+='[方案 / Design](technical/110-desktop-native-geo.md) · [证据 / Evidence](quality/desktop-geo-checkpoint.json)\n\n'
                image='design/implementation/copypaste-desktop__'+Path(first['path']).name
                gif='design/implementation/copypaste-desktop__'+Path(movie['path']).name
            else:
                text+='[方案 / Design](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/110-desktop-native-geo.md) · [证据 / Evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-geo-checkpoint.json)\n\n'
                if folder.name=='copypaste-desktop': image=str(Path(first['path']).relative_to('copypaste-desktop')).replace('\\','/');gif=str(Path(movie['path']).relative_to('copypaste-desktop')).replace('\\','/')
                else:
                    image='https://raw.githubusercontent.com/copypasteltd/workmate/desktop/'+str(Path(first['path']).relative_to('copypaste-desktop')).replace('\\','/')
                    gif='https://raw.githubusercontent.com/copypasteltd/workmate/desktop/'+str(Path(movie['path']).relative_to('copypaste-desktop')).replace('\\','/')
            text+=diagram+f'\n![Actual local GEO / 实际本机观测]({image})\n\n![Actual interaction / 实际交互]({gif})\n\n'
            p.write_bytes(title+b'\n\n'+text.encode()+body)
            changes.append({'path':p.relative_to(ROOT).as_posix(),'before_sha256':sha256(old).hexdigest(),'after_sha256':digest(p)})
    p=QUALITY/'requirements-alignment-progress.json';progress=read(p);old=p.read_bytes()
    progress['desktop_native_geo']={'checkpoint':ref(CP),'counts':cp['counts'],'actual_electron_flows':9,'original_requirements_modified':False,'full_acceptance':'not_proven'}
    write(p,progress);changes.append({'path':p.relative_to(ROOT).as_posix(),'before_sha256':sha256(old).hexdigest(),'after_sha256':digest(p)})
    for en in [False,True]:
        p=ROOT/('docs/changes/2026-10-27-desktop-native-geo'+('.en' if en else '')+'.md');assert not p.exists()
        p.write_text(('# Desktop-native GEO\n\n' if en else '# Desktop 本机 GEO 观测\n\n')+'Fresh local Codex threads, atomic question holds, no OS/business tools, explicit cost review, original receipts and retained answers. / 独立本机 Codex 会话、原子整批预留、无系统与业务工具、费用确认、原回执与原始回答。\n\n'+f'{cp["counts"]["backend"]["tests"]} backend, {cp["counts"]["desktop-unit"]["tests"]} Desktop unit, {cp["counts"]["native-codex"]["tests"]} actual native Codex checks; 9 actual Electron flows and 11 build/type checks.\n\n'+'Failed attempts remain immutable. Synthetic accounts/model responses; no live quality or complete-product acceptance. / 失败记录保留；假账号与假模型；不宣称真实专业效果或全产品完成。\n\n[Design / 方案](../technical/110-desktop-native-geo.md) · [Evidence / 凭证](../quality/desktop-geo-checkpoint.json)\n',encoding='utf-8')
    write(QUALITY/'desktop-geo-documentation-refresh.json',{'checkpoint':ref(CP),'changes':changes,'media_copies':copies,'verifier_sha256':digest(Path(__file__))})
def audit():
    from markdown_it import MarkdownIt
    from urllib.parse import urlsplit,unquote
    cp=read(CP);refresh=read(QUALITY/'desktop-geo-documentation-refresh.json');assert cp['verifier_sha256']==refresh['verifier_sha256']==digest(Path(__file__))
    for n,h in cp['source_files'].items():assert digest(ROOT/n)==h,n
    for r in refresh['changes']:assert digest(ROOT/r['path'])==r['after_sha256']
    for r in refresh['media_copies']:assert digest(ROOT/r['source'])==digest(ROOT/r['target'])==r['sha256']
    parser=MarkdownIt();links=0
    for folder in [ROOT/'docs']+[DEV/('copypaste-'+c) for c in COMPONENTS]:
        for name in ['README.md','README.en.md']:
            p=folder/name;body=p.read_text('utf-8');assert '<!-- desktop-native-geo-stage110 -->' in body
            for token in parser.parse(body):
                for child in token.children or []:
                    value=child.attrGet('src') if child.type=='image' else child.attrGet('href') if child.type=='link_open' else None
                    if value and not urlsplit(value).scheme and not value.startswith('#'):assert (p.parent/unquote(urlsplit(value).path)).exists(),(p,value);links+=1
    decoded=[]
    for movie in cp['recordings']:
        for row in movie['files']:
            p=DEV/row['path'];probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=nb_read_frames:format=duration','-of','json',str(p)]))
            assert int(probe['streams'][0]['nb_read_frames'])>1 and abs(float(probe['format']['duration'])-movie['seconds'])<=.25
            run=subprocess.run(['ffmpeg','-v','error','-xerror','-err_detect','explode','-i',str(p),'-map','0:v:0','-f','null','-'],capture_output=True,check=True);assert not run.stderr.strip();decoded.append(row)
    original=read(QUALITY/'history/stage96-before-solution-packages/receipt.json');current=read(QUALITY/'requirements-alignment-progress.json')
    assert current['requirements']==original['requirements'] and current['gates']==original['gates']
    write(QUALITY/'desktop-geo-docs-audit-01.json',{'status':'passed','checkpoint':ref(CP),'bilingual_readmes':14,'local_readme_links':links,'decoded_recordings':decoded,'original_matrix_unchanged':True,'verifier_sha256':digest(Path(__file__))})
    print(json.dumps({'status':'passed','readmes':14,'links':links,'decoded':len(decoded)}))
parser=argparse.ArgumentParser();parser.add_argument('action',choices=['record','sync','audit']);parser.add_argument('--core',default='01');parser.add_argument('--ui',default='01');parser.add_argument('--clients',default='01');args=parser.parse_args()
if args.action=='record':record(args.core,args.ui,args.clients)
elif args.action=='sync':sync()
else:audit()
