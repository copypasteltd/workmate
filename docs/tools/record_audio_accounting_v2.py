"""Bind SQL122 accounting to frozen affected tests, actual Admin UI and client builds."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import json
import shutil
import difflib
import subprocess
from markdown_it import MarkdownIt
from urllib.parse import unquote, urlsplit
from record_platform_integration import ROOT, DEV, QUALITY, DELIVERY, COMPONENTS, read, digest, ref, write, git, checked_report

CP=QUALITY/'audio-accounting-checkpoint.json'
BASE=QUALITY/'managed-audio-checkpoint.json'
DESIGN='109-audio-evidence-accounting.md'
SCOPE='Immutable human audio evidence with separate independent cost and termination approval for customer jobs and platform verification; original observations/media stay unchanged, no POST replay, exact frozen tariffs, original-reservation settlement and scoped cost visibility. Synthetic accounts/models/evidence; actual HTTP interruption, native PostgreSQL, Codex, client builds and Admin interactions. No live audio-quality or full-product acceptance.'

def record(core,ui):
    baseline=read(BASE)
    assert baseline['status']=='verified_managed_audio'
    core_path=DELIVERY/f'evidence/audio-accounting-core-{core}.json'
    ui_path=DELIVERY/f'evidence/audio-accounting-ui-{ui}.json'
    client_path=DELIVERY/'evidence/audio-accounting-clients-01.json'
    admin_path=DELIVERY/'evidence/audio-accounting-admin-01.json'
    consent_path=DELIVERY/'evidence/audio-accounting-consent-02.json'
    backend,browser,clients,admin,consent=[checked_report(p) for p in [core_path,ui_path,client_path,admin_path,consent_path]]
    for r in [backend,browser,clients,admin,consent]:assert r['status']=='passed' and r['source_unchanged']
    assert consent['owned_database_shutdown'] and len(consent['test_files'])==4
    consent_tap=(DELIVERY/consent['raw_report']['path']).read_text(encoding='utf-8')
    assert 'ok 45 - audio waiting locks the task before authorization even with an access-only caller' in consent_tap
    assert consent['counts']['tests']==consent['counts']['pass']>60
    assert all(consent['counts'][k]==0 for k in ['fail','cancelled','skipped','todo'])
    runtime_repairs=['copypaste-platform/src/audio-authorizations.ts','copypaste-platform/tests/audio-production.test.ts']
    runtime_corrections=[]
    for n in runtime_repairs:
        old_path=DELIVERY/f'evidence/audio-accounting-core-{core}-sources'/n
        assert digest(old_path)==backend['source_files'][n]
        after=consent['source_files'][n]
        assert after==digest(DEV/n)==browser['source_files'][n] and after!=backend['source_files'][n]
        patch=''.join(difflib.unified_diff(old_path.read_text('utf-8').splitlines(True),(DEV/n).read_text('utf-8').splitlines(True),fromfile='core-02/'+n,tofile='consent-02/'+n))
        runtime_corrections.append({'path':'dev/'+n,'before':ref(old_path),'after_sha256':after,'exact_patch':patch})
    runtime_correction={'changes':runtime_corrections,'requalification':ref(consent_path),'counts':consent['counts'],
        'actual_browser_requalification':ref(ui_path),'test_files':consent['test_files'],
        'reason':'Actual customer confirmation exposed a task/authorization lock inversion when the access callback did not lock the task. The waiting service now locks the task first. A real PostgreSQL task blocker, waiter lock observation and authorization NOWAIT assertion deterministically exercise the former inversion before actual customer confirmation.',
        'qualification_scope':'Four affected audio accounting, production, authorization upgrade and capability audio suites; the earlier 253-case core run is retained with its original source bindings.'}

    assert admin['counts']=={'tests':9,'pass':9,'fail':0,'cancelled':0,'skipped':0,'todo':0}
    assert len(admin['checks'])==2 and all(c['exit_code']==0 for c in admin['checks'])
    repaired='copypaste-admin/src/audio-accounting.tsx'
    before_sha='c594e0a6b1d2042d6c85c7c64accbcbd2f90039e54a46f08cf84c2f02e65dee5'
    after_sha='96b570522f4f849a2a2009d8a97497da5a6b2e788c9189e6ca0d3be506358d45'
    original=DELIVERY/f'evidence/audio-accounting-core-{core}-sources'/repaired
    assert digest(original)==backend['source_files'][repaired]==before_sha
    old=original.read_bytes().decode('utf-8')
    assert old.count('revision, onDone, onCommand')==1 and old.count('setLocal(n => n + 1); onDone();')==1
    corrected=old.replace('revision, onDone, onCommand','revision, onCommand').replace('setLocal(n => n + 1); onDone();','setLocal(n => n + 1);').encode('utf-8')
    assert corrected==(DEV/repaired).read_bytes() and digest(DEV/repaired)==after_sha
    assert admin['source_files'][repaired]==browser['source_files'][repaired]==after_sha
    for r in [browser,clients,admin,consent]:
        differing=[n for n,h in r['source_files'].items() if n in backend['source_files'] and backend['source_files'][n]!=h]
        assert set(differing)<=set([repaired]+runtime_repairs),differing
    correction={'path':'dev/'+repaired,'before':ref(original),'before_sha256':before_sha,'after_sha256':after_sha,
        'exact_change':'Remove the unused parent onDone binding and parent list refresh only from immutable evidence save; refresh the open record locally.',
        'reason':'Actual UI02 exposed successful evidence POST collapsing the active record by unmounting its parent list. UI04 adds a required wait for the asynchronously loaded validation receipt; the later selected browser run also exercises the corrected task/authorization lock order.',
        'requalification':ref(admin_path),'actual_browser_requalification':ref(ui_path),
        'native_client_runtime_changed_after_core':False,'backend_runtime_separately_requalified':True}

    assert backend['owned_database_shutdown'] and browser['owned_database_shutdown'] and browser['owned_preview_closed']
    counts=backend['counts'];assert counts['tests']==counts['pass']>230 and all(counts[k]==0 for k in ['fail','cancelled','skipped','todo'])
    assert len(backend['test_files'])==14 and backend['native_codex']['explicit_bin_and_test_bin']
    assert backend['admin_unit']['counts']=={'tests':9,'pass':9,'fail':0,'cancelled':0,'skipped':0,'todo':0}
    assert len(clients['checks'])==7 and all(c['exit_code']==0 for c in clients['checks'])
    journey_path=DELIVERY/f'evidence/audio-accounting-ui-{ui}-journey.json'
    journey=read(journey_path);assert journey==browser['journey'] and journey['status']=='passed'
    assert len(journey['checks'])==8 and len(journey['media'])==3 and browser['compiled_unchanged']
    assert all(journey[k] for k in ['browser_closed','api_closed','fixture_closed','provider_closed'])
    sources=dict(baseline['source_files']);qualified={}
    for report in [backend,consent,browser,clients,admin]:
        for n,h in report['source_files'].items():
            name=n if n.startswith('docs/') else 'dev/'+n
            if name in qualified and qualified[name]!=h:
                allowed={**{'dev/'+n:(backend['source_files'][n],consent['source_files'][n]) for n in runtime_repairs},'dev/'+repaired:(before_sha,after_sha)}
                assert name in allowed and (qualified[name],h)==allowed[name],name
            qualified[name]=h
    for live,frozen in [('scripts/run-audio-accounting.mjs',f'evidence/audio-accounting-core-{core}-verifier.mjs'),
                        ('scripts/run-audio-accounting-v2.mjs','evidence/audio-accounting-consent-02-verifier.mjs'),
                        ('scripts/run-audio-accounting-ui-v7.mjs',f'evidence/audio-accounting-ui-{ui}-verifier.mjs'),
                        ('scripts/qa-audio-accounting-ui-v7.ts',f'evidence/audio-accounting-ui-{ui}-journey-verifier.ts'),
                        ('scripts/probe-audio-accounting-clients.mjs','evidence/audio-accounting-clients-01-verifier.mjs'),
                        ('scripts/check-audio-accounting-admin.mjs','evidence/audio-accounting-admin-01-verifier.mjs')]:
        assert (DELIVERY/live).read_bytes()==(DELIVERY/frozen).read_bytes()
        qualified['dev/copypaste-delivery/'+live]=digest(DELIVERY/live)
    sources.update(qualified)
    for n,h in sources.items():assert digest(ROOT/n)==h,n
    migrations={n:h for n,h in baseline['source_files'].items() if n.startswith('dev/copypaste-platform/migrations/')}
    assert len(migrations)==121 and all(sources[n]==h for n,h in migrations.items())
    current=ROOT/'docs/contracts/audio-accounting.openapi.json'
    assert read(current)['x-historical-audio-contract']['sha256']==digest(ROOT/'docs/contracts/managed-audio-capabilities.openapi.json')
    mirror=read(DEV/'copypaste-platform/contracts/audio-accounting-schemas.json');assert mirror['normative_source_sha256']==digest(current)
    assert mirror['schemas']==read(current)['components']['schemas']
    schemes=read(current)['components']['securitySchemes']
    for path,item in read(current)['paths'].items():
        for op in item.values():
            if isinstance(op,dict):
                for security in op.get('security',[]):assert set(security)<=set(schemes),(path,security)
    for row in journey['screenshots']+[f for m in journey['media'] for f in m['files']]:assert digest(DEV/row['path'])==row['sha256']
    attempts=[]
    for pattern in ['audio-accounting-focused-??.json','audio-accounting-core-??.json','audio-accounting-ui-??.json','audio-accounting-clients-??.json','audio-accounting-admin-??.json','audio-accounting-consent-??.json']:
        for p in sorted((DELIVERY/'evidence').glob(pattern)):
            v=checked_report(p);assert v['source_unchanged'];attempts.append({**ref(p),'status':v['status'],'counts':v.get('counts'),'test_exit':v.get('test_exit',v.get('journey_exit'))})
    progress=read(QUALITY/'requirements-alignment-progress.json');original=read(QUALITY/'history/stage96-before-solution-packages/receipt.json')
    assert progress['requirements']==original['requirements'] and progress['gates']==original['gates']
    assert progress['fully_accepted_requirements']==progress['qualified_live_roles']==0
    write(CP,{'at':datetime.now(timezone.utc).isoformat(),'stage':109,'status':'verified_audio_accounting','scope':SCOPE,
        'source_files':dict(sorted(sources.items())),'selected_positive':ref(core_path),'selected_ui':ref(ui_path),'client_builds':ref(client_path),
        'journey':ref(journey_path),'tests':counts['tests'],'counts':counts,'admin_tests':backend['admin_unit']['counts'],
        'post_core_runtime_correction':runtime_correction,'consent_requalification':ref(consent_path),
        'post_core_admin_ui_correction':correction,'admin_requalification':ref(admin_path),
        'test_files':backend['test_files'],'actual_ui_checks':len(journey['checks']),'attempts':attempts,'screenshots':journey['screenshots'],'recordings':journey['media'],
        'new_migrations':[ref(DEV/'copypaste-platform/migrations/122-audio-evidence-accounting.sql')],
        'new_routes':['GET /v1/admin/ai/audio-accounting','GET /v1/admin/ai/audio-accounting/:channel/:request_id',
          'POST /v1/admin/ai/audio-accounting/:channel/:request_id/evidence','GET /v1/admin/ai/audio-evidence/:evidence_id'],
        'retained_stage108':ref(BASE),'retained_stage106':baseline['retained_stage106'],'original_requirements_modified':False,
        'fully_accepted_requirements':0,'qualified_live_roles':0,'verifier_sha256':digest(Path(__file__))})
    print(json.dumps({'status':'verified_audio_accounting','tests':counts['tests'],'sources':len(sources)}))

def sync():
    cp=read(CP);assert cp['verifier_sha256']==digest(Path(__file__))
    archive=QUALITY/'history/stage109-documents';archive.mkdir();changes=[];copies=[]
    def change(path,body):
        component=next((c for c in COMPONENTS if path.is_relative_to(DEV/('copypaste-'+c))),None)
        repo=DEV/('copypaste-'+component) if component else ROOT
        name=path.relative_to(repo).as_posix();before=git(repo,'show','HEAD:'+name)
        assert path.read_bytes().replace(b'\r\n',b'\n')==before.replace(b'\r\n',b'\n')
        saved=archive/(component or 'docs')/name;saved.parent.mkdir(parents=True,exist_ok=True);saved.write_bytes(before)
        path.write_bytes(body);changes.append({'path':path.relative_to(ROOT).as_posix(),'archive':saved.relative_to(ROOT).as_posix(),'before_sha256':sha256(before).hexdigest(),'after_sha256':digest(path)})
    images=[next(r for r in cp['screenshots'] if r['path'].endswith(n)) for n in ['platform-immutable-evidence-form-en.png','original-verification-accounted-unqualified-en.png']]
    movie=next(m for m in cp['recordings'] if m['name']=='audio-evidence-and-cost-preview')
    for folder in [ROOT/'docs']+[DEV/('copypaste-'+c) for c in COMPONENTS]:
        media={}
        for row in images+movie['files']:
            source=DEV/row['path'];target=folder/'assets/verification/audio-accounting-109'/source.name
            assert not target.exists();target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
            assert digest(target)==row['sha256'];media[source.suffix if source.suffix in ['.gif','.mp4'] else 'evidence' if row==images[0] else 'resolved']=target.relative_to(folder).as_posix()
            copies.append({'source':source.relative_to(ROOT).as_posix(),'target':target.relative_to(ROOT).as_posix(),'sha256':row['sha256']})
        for name in ['README.md','README.en.md']:
            en=name.endswith('.en.md');design='technical/'+DESIGN if folder==ROOT/'docs' else 'https://github.com/copypasteltd/workmate/blob/docs/docs/technical/'+DESIGN
            text='<!-- audio-accounting-stage109 -->\n\n'
            text+=('Unknown customer audio and platform verification fees now accept immutable original-operation evidence, separate independent cost and termination approvals, scoped read controls and exact frozen tariffs. Cost confirmation does not debit the customer or release capacity. Task settlement remains independently approved, occurs once within its original hold and preserves business failure.\n\n' if en else '客户音讯及平台验证的未知费用已接通不可改写的原请求证据、分开的费用与终止独立审批、权限范围及冻结费率核对。费用确认不直接扣款或释放容量；任务仍经独立审批、在原预留内结算一次，并保留原业务失败。\n\n')
            text+=('Both confirmations permit an explicit new platform validation; the old POST, media result and verification receipt remain unchanged. Web, frameless Desktop and the native Chrome right Side Panel show human-evidence provenance. Existing Desktop local Codex/full permission and Extension cloud execution remain in force.\n\n' if en else '两项确认完成后可明确发起新平台验证，旧 POST、媒体结论和验证回执均保留。Web、无边框 Desktop 及 Chrome 原生右侧侧栏展示人工证据来源；Desktop 本地 Codex／完整权限与 Extension 云端执行约束继续执行。\n\n')
            text+=(f'{cp["tests"]} initial affected backend checks plus {cp["post_core_runtime_correction"]["counts"]["tests"]} follow-up audio/concurrency checks, nine Admin form/money checks, seven client compilation/build checks and eight actual Admin browser flows passed. Original failed runs are retained. Screenshots and GIF/MP4 below show actual Admin interactions with synthetic accounts/models/evidence. Native decoding is not live audio-quality qualification. Stage106 retains its unattributed full-run timeout and unchanged passing replay; this is not complete-product acceptance.\n\n' if en else f'本轮先通过 {cp["tests"]} 项相关后端检查，并在并发修复后通过 {cp["post_core_runtime_correction"]["counts"]["tests"]} 项音讯／授权回归；另通过 9 项后台表单／金额检查、7 项三端编译／构建检查及 8 项实际后台页面流程，原始失败记录保留。下方截图及 GIF／MP4 为实际后台交互，账号、模型和证据明确使用假数据；原生解码不代表真实音质验收。阶段 106 整批未归因超时及原文件重放通过记录保留，本轮不改写为整体产品验收。\n\n')
            text+=f'[Design / 方案]({design}) · [MP4]({media[".mp4"]})\n\n![Actual immutable evidence / 实际不可变证据]({media["evidence"]})\n\n![Original verification retained / 原验证保留]({media["resolved"]})\n\n![Actual evidence and preview / 实际证据及预览]({media[".gif"]})\n\n'
            if folder.name=='copypaste-delivery':text+='Reproduce / 重现：`node scripts/run-audio-accounting-v2.mjs <new-two-digit-attempt> core`；`node scripts/run-audio-accounting-v2.mjs <new-two-digit-attempt> consent`；`node scripts/run-audio-accounting-ui-v7.mjs <new-two-digit-attempt>`；`node scripts/probe-audio-accounting-clients.mjs <new-two-digit-attempt>`。\n\n'
            p=folder/name;title,body=p.read_bytes().split(b'\n',1);change(p,title+b'\n\n'+text.encode()+body)
    note=f'\n\n**阶段 109 / Stage 109：** 客户及平台音讯已接通不可变证据、分开的费用／终止独立审批和原预留内结算；{cp["tests"]} 项初次后端及 {cp["post_core_runtime_correction"]["counts"]["tests"]} 项修复后音讯授权回归、9 项后台单元、7 项客户端编译构建与 8 项实际页面流程通过，明确假模型及人工证据。见[方案](../technical/{DESIGN})。原失败记录、历史整批超时与整体验收边界保留。\n\n'
    for name in ['modules/04-marketing-production.md','modules/08-usage-billing-admin.md','quality/01-test-and-acceptance-plan.md','governance/04-git-branches-and-publication.md']:
        p=ROOT/'docs'/name;title,body=p.read_bytes().split(b'\n',1);change(p,title+b'\n'+note.encode()+body)
    p=QUALITY/'requirements-alignment-progress.json';progress=read(p);progress['at']=datetime.now(timezone.utc).isoformat()
    progress['audio_accounting']={'checkpoint':ref(CP),'backend_tests':cp['tests'],'follow_up_audio_tests':cp['post_core_runtime_correction']['counts']['tests'],'admin_unit':9,'client_build_checks':7,'actual_ui':8,'full_acceptance':'not_proven'}
    change(p,(json.dumps(progress,ensure_ascii=False,indent=2)+'\n').encode())
    for en in [False,True]:
        p=ROOT/('docs/changes/2026-10-27-audio-accounting'+('.en' if en else '')+'.md');assert not p.exists()
        body=('# Independent audio accounting\n\n' if en else '# 音讯费用与终止独立对账\n\n')
        body+='Immutable original-operation evidence, separate independent cost/termination approvals, exact frozen tariffs, scoped reads, no replay and original-reservation settlement. / 原请求不可变证据、费用与终止分开独立审批、冻结费率、范围读取、不重发与原预留内结算。\n\n'
        body+=f'{cp["tests"]} initial backend / 初次后端；{cp["post_core_runtime_correction"]["counts"]["tests"]} follow-up audio checks / 修复后音讯回归；9 Admin unit / 后台单元；7 client build checks / 三端编译构建；8 actual UI flows / 实际页面流程。\n\n'
        body+='Original failed evidence and the Stage106 unattributed timeout remain. Synthetic accounts/models/evidence; no live audio-quality or complete-product acceptance. / 原始失败证据和阶段 106 未归因超时保留。明确假账号、模型与人工证据，不据此宣称真实音质或整体产品验收。\n\n'
        body+=f'[Design / 方案](../technical/{DESIGN}) · [Evidence / 证据](../quality/audio-accounting-checkpoint.json)\n';p.write_text(body,encoding='utf-8',newline='\n')
    write(QUALITY/'audio-accounting-documentation-refresh.json',{'checkpoint':ref(CP),'changes':changes,'media_copies':copies,'verifier_sha256':digest(Path(__file__))})

def audit():
    cp=read(CP);refresh=read(QUALITY/'audio-accounting-documentation-refresh.json');assert cp['verifier_sha256']==refresh['verifier_sha256']==digest(Path(__file__))
    for n,h in cp['source_files'].items():assert digest(ROOT/n)==h,n
    for r in refresh['changes']:assert digest(ROOT/r['path'])==r['after_sha256'] and digest(ROOT/r['archive'])==r['before_sha256']
    for r in refresh['media_copies']:assert digest(ROOT/r['source'])==digest(ROOT/r['target'])==r['sha256']
    decoded=[]
    for movie in cp['recordings']:
        assert movie['distinct_frames']>1 and movie['skipped_capture_errors']==0
        for row in movie['files']:
            p=DEV/row['path'];assert digest(p)==row['sha256'] and p.stat().st_size==row['bytes']
            probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=nb_read_frames:format=duration','-of','json',str(p)]))
            assert int(probe['streams'][0]['nb_read_frames'])>1 and abs(float(probe['format']['duration'])-movie['seconds'])<=.25
            run=subprocess.run(['ffmpeg','-v','error','-xerror','-err_detect','explode','-i',str(p),'-map','0:v:0','-f','null','-'],capture_output=True,check=True);assert not run.stderr.strip();decoded.append(row)
    links=0;parser=MarkdownIt()
    for folder in [ROOT/'docs']+[DEV/('copypaste-'+c) for c in COMPONENTS]:
        for name in ['README.md','README.en.md']:
            p=folder/name;body=p.read_text('utf-8');assert '<!-- audio-accounting-stage109 -->' in body
            for token in parser.parse(body):
                for child in token.children or []:
                    value=child.attrGet('src') if child.type=='image' else child.attrGet('href') if child.type=='link_open' else None
                    if value and not urlsplit(value).scheme and not value.startswith('#'):assert (p.parent/unquote(urlsplit(value).path)).exists(),(p,value);links+=1
    write(QUALITY/'audio-accounting-docs-audit-01.json',{'status':'passed','checkpoint':ref(CP),'bilingual_readmes':14,'local_readme_links':links,'fully_decoded_recordings':decoded,'verifier_sha256':digest(Path(__file__))})
    print(json.dumps({'status':'passed','readmes':14,'links':links,'decoded':len(decoded)}))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('action',choices=['record','sync','audit']);p.add_argument('--core',default='02');p.add_argument('--ui',default='08');a=p.parse_args()
    {'record':lambda:record(a.core,a.ui),'sync':sync,'audit':audit}[a.action]()
