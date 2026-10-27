"""Bind signed-event source, database and real UI evidence; refresh all delivery guides."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import json
import re
import shutil
import subprocess

ROOT=Path(__file__).resolve().parents[2]
DEV=ROOT/'dev'
L=DEV/'copypaste-delivery'
Q=ROOT/'docs/quality'
CP=Q/'cloud-events-checkpoint.json'
COMPONENTS=['platform','web','admin','desktop','extension','delivery']
def read(p):return json.loads(p.read_text('utf-8-sig'))
def digest(p):return sha256(p.read_bytes()).hexdigest()
def ref(p):return {'path':p.relative_to(ROOT).as_posix(),'sha256':digest(p)}
def write(p,v):
    p.parent.mkdir(parents=True,exist_ok=True)
    with p.open('x',encoding='utf-8',newline='\n')as f:f.write(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def checked(p):
    v=read(p)
    assert v['source_unchanged'],p
    for c in v.get('checks',[]):
        if 'raw_report' not in c:continue
        raw=L/c['raw_report']['path'];assert digest(raw)==c['raw_report']['sha256']
        if 'counts' in c:
            counts={k:int(re.findall(r'^# '+k+r' (\d+)\r?$',raw.read_text('utf-8'),re.M)[0])for k in ['tests','pass','fail','cancelled','skipped','todo']}
            assert counts==c['counts']
    return v

def record(core,ui,clients):
    selected=[L/f'evidence/cloud-events-core-{core}.json',L/f'evidence/cloud-events-ui-{ui}.json',L/f'evidence/cloud-events-clients-{clients}.json']
    backend,browser,builds=[checked(p)for p in selected]
    for v in [backend,browser,builds]:
        assert v['status']=='passed' and v['owned_database_shutdown']
        assert all(c['exit_code']==0 for c in v['checks'])
    for v in [backend,builds]:assert v['verifier_sha256']==digest(L/'scripts/run-cloud-events-v1.mjs')
    assert browser['verifier_sha256']==digest(L/('scripts/run-cloud-events-ui-v'+ui_version+'.mjs'))
    assert browser['journey_verifier_sha256']==digest(L/('scripts/qa-cloud-events-ui-v'+ui_version+'.ts'))
    counts=next(c['counts']for c in backend['checks']if c['name']=='backend')
    assert counts['tests']==counts['pass']>=14 and all(counts[k]==0 for k in ['fail','cancelled','skipped','todo'])
    command=next(c['args']for c in backend['checks']if c['name']=='backend')
    assert {a for a in command if a.startswith('tests/')}=={'tests/'+n+'.test.ts'for n in ['cloud-events','cloud-schedules','cloud-workflows','task-history-sources','migrations','auth-contract','native-recovery']}
    backend_tap=(L/next(c['raw_report']['path']for c in backend['checks']if c['name']=='backend')).read_text('utf-8')
    assert re.search(r'^ok \d+ - native recovery retains authorized event facts, replays newer source erasure across all event tables and fences duplicate dispatch\r?$',backend_tap,re.M)
    assert len(builds['checks'])==13 and browser['owned_preview_closed']
    jp=L/browser['journey']['path'];assert digest(jp)==browser['journey']['sha256'];j=read(jp)
    assert j['status']=='passed' and len(j['checks'])==7 and len(j['screenshots'])==5 and len(j['recordings'])==3 and len(j['layouts'])==5
    assert all(j[k]for k in ['browser_closed','panel_closed','api_closed','fixture_closed'])
    assert len(j['executions'])==2 and all(e['native_codex'] and e['synthetic_model'] and e['reservation_count']==1 and int(e['charged_micros'])>0 for e in j['executions'])
    for layout in j['layouts']:
        assert not layout['overflow']
        if 'viewport_bounds' in layout:
            assert not layout['navigation_obscures_content']
            assert all(b['left']>=-2 and b['right']<=layout['width']+2 for b in layout['viewport_bounds'])
        else:assert layout['native']['context_type']=='SIDE_PANEL' and layout['native']['side']=='right' and not layout['local_agent']
    for movie in j['recordings']:assert movie['distinct_frames']>1 and movie['skipped_capture_errors']==0
    sources={}
    for v in [backend,browser,builds]:
        for name,expected in v['source_files'].items():
            assert digest(DEV/name)==expected,name
            assert sources.get('dev/'+name,expected)==expected
            sources['dev/'+name]=expected
    contract=ROOT/'docs/contracts/cloud-events.openapi.json';mirror=DEV/'copypaste-platform/contracts/cloud-events-schemas.json'
    assert read(contract)['x-runtime-schema-sha256']==digest(mirror) and read(contract)['components']['schemas']==read(mirror)['schemas']
    sources[contract.relative_to(ROOT).as_posix()]=digest(contract)
    previous=read(Q/'native-recovery-checkpoint.json')
    for name,h in previous['source_files'].items():
        if name.startswith('dev/copypaste-platform/migrations/'):assert sources[name]==h,name
    for row in j['screenshots']+[f for m in j['recordings']for f in m['files']]:assert digest(DEV/row['path'])==row['sha256']
    original=read(Q/'history/stage96-before-solution-packages/receipt.json');progress=read(Q/'requirements-alignment-progress.json')
    assert progress['requirements']==original['requirements'] and progress['gates']==original['gates']
    assert progress['fully_accepted_requirements']==progress['qualified_live_roles']==0
    attempts=[]
    for p in sorted((L/'evidence').glob('cloud-events-*-??.json')):
        v=checked(p);attempts.append({**ref(p),'status':v['status'],'error':v.get('error')})
    prior=Q/'history/stage115-previous-publication.json';assert not prior.exists();shutil.copyfile(Q/'workmate-publication.json',prior)
    prep=L/'.data/preparation/cloud-events-115/receipt.json';dest=Q/'history/stage115-before-cloud-events/receipt.json';dest.parent.mkdir(parents=True,exist_ok=True);assert not dest.exists();shutil.copyfile(prep,dest)
    write(CP,dict(at=datetime.now(timezone.utc).isoformat(),stage=115,status='verified_private_signed_cloud_events',
        scope='Private version-bound signed event workflows: explicit customer consent, one-time encrypted keys, durable raw-byte-authenticated inbox, deduplication, serialized runs, overlap/age/time-zone/day budget limits, failure review, source erasure including actual newer-ledger native restore replay, Web and native right SIDE_PANEL controls, scoped recent-MFA metadata-only Admin pause. Real native PostgreSQL, browsers and two pinned native Codex executions; synthetic model/accounts/sender. Affected functionality only, no provider-native webhook/live-model/full-product acceptance.',
        source_files=dict(sorted(sources.items())),selected_core=ref(selected[0]),selected_ui=ref(selected[1]),client_builds=ref(selected[2]),
        counts={'backend':counts},build_checks=13,journey=ref(jp),actual_ui_checks=7,screenshots=j['screenshots'],recordings=j['recordings'],layouts=j['layouts'],native_executions=j['executions'],attempts=attempts,
        new_migrations=['126-private-cloud-events.sql'],retained_stage114=ref(Q/'native-recovery-checkpoint.json'),previous_publication=ref(prior),baseline=ref(dest),
        api_contract=ref(contract),role_release=ref(DEV/'copypaste-platform/catalog/cloud-event-release-v1.json'),
        original_requirements_modified=False,fully_accepted_requirements=0,qualified_live_roles=0,live_provider_qualified=False,verifier_sha256=digest(Path(__file__))))
    print(json.dumps({'status':'verified_private_signed_cloud_events','tests':counts['tests'],'sources':len(sources),'ui':7}))

def sync():
    cp=read(CP);assert cp['verifier_sha256']==digest(Path(__file__))
    changes=[];copies=[]
    all_media=cp['screenshots']+[f for m in cp['recordings']for f in m['files']]
    for row in all_media:
        src=DEV/row['path'];dst=ROOT/'docs/design/implementation'/('cloud-events-'+Path(row['path']).parts[0]+'__'+src.name)
        assert not dst.exists();shutil.copyfile(src,dst);assert digest(dst)==row['sha256'];copies.append({'source':src.relative_to(ROOT).as_posix(),'target':dst.relative_to(ROOT).as_posix(),'sha256':digest(dst)})
    diagram='```mermaid\nflowchart LR\n  Customer[Customer reviews fixed method and budgets] --> Trigger[Private event rule]\n  Sender[Customer configured sender] --> Verify[Raw byte HMAC and current authority]\n  Trigger --> Verify\n  Verify --> Inbox[Durable deduplicated inbox]\n  Inbox --> Policy[Age overlap interval daily caps]\n  Policy --> Run[One independent private run]\n  Run --> Review[Human review]\n  Review --> Codex[Company cloud Codex child]\n  Codex --> Receipt[Actual delivery and settled usage]\n```\n'
    details={
      'platform':('Apply migration 126 without rewriting SQL001–125. POST a published private workflow and event options to `/cloud-workflow-events/requests`; only the customer decision endpoint can activate the exact hash and both budgets. Configure the trusted sender with the one-time key, exact original JSON bytes and documented Workmate HMAC headers. Inspect durable receipts and real runs. Application SQL cannot forge inbox inserts. Source deletion scrubs bodies, payloads, keys and cached responses.', '执行向前迁移 126，保留 SQL001–125。向 `/cloud-workflow-events/requests` 提交固定私有方法及事件规则，由客户确认接口核对摘要和两项预算后启用。客户配置可信发送端与一次性密钥，按 Workmate 格式签名原始 JSON 字节。查看持久回执及实际运行；应用 SQL 不能伪造 inbox。删除来源会清除正文、事件资料、密钥与缓存响应。'),
      'web':('Open Workflows, prepare event work from an existing run or your consultant conversation, review the exact method/inputs, time zone and per-run/daily limits, check consent and activate. Save the masked one-time key with your sender. Events and method shows stable history, fixed revisions and the actual run link. Pause preserves current runs; resume/revision requires fresh review. Rotation immediately revokes the old key.', '打开工作流程，从已有运行或顾问对话准备事件工作，核对方法、输入、时区、每次及每日费用上限后勾选启用。把默认遮住的一次性密钥保存到发端。事件与方法提供分页回执、固定版本及真实运行链接。暂停保留当前工作；恢复与修订重新确认，轮换即时撤销旧密钥。'),
      'extension':('Click the Chrome action to use the genuine right Side Panel. Select the consultant task, review its pending event proposal and explicitly authorize both budgets. The masked key is shown once. Review event pages, pause or stop in the panel; open the full Web workspace to edit or resume. Files still require customer selection/upload; Codex executes in the company cloud.', '点击 Chrome 按钮打开原生右侧 Side Panel，选择顾问任务并核对事件提案，明确授权每次和每日上限。默认遮住的密钥只返回一次。侧栏可查看分页回执、暂停和停止，完整方法编辑与恢复进入 Web 工作区。文件仍由客户选择和上传；Codex 在公司云端执行。'),
      'admin':('Open Execution → Event work with scoped `admin.execution.read` and MFA within ten minutes. Filter/paginate metadata and pause using `admin.execution.pause`, a reason and the current control version. Private names, event types, payloads, definitions, endpoints and secrets are absent. Admin cannot resume customer event fees or impersonate their confirmation.', '在执行管理的事件工作区域，使用范围内 `admin.execution.read` 及十分钟内 MFA 查看、筛选和分页运行资料。暂停须有 `admin.execution.pause`、原因和当前版本。接口不返回私有名称、类型、事件资料、方法、地址或密钥；后台不能代客户恢复事件费用或确认。'),
      'desktop':('Desktop continues to run Codex on the customer computer with the existing explicitly granted local permissions and local workflows. This cloud event increment does not replace Desktop execution or add a cloud activation UI. The updated consultant Skill explicitly preserves local execution; existing frameless presentation and hidden scrollbar rules remain.', 'Desktop 继续在客户本机运行 Codex，沿用客户明确授予的本机权限与本机流程。本项云端事件能力不替代 Desktop 执行，也不增加云端启用界面。新顾问 Skill 明确保留本机执行；无边框和隐藏滚动条约束继续有效。'),
      'delivery':('Reproduce scoped validation with `node scripts/run-cloud-events-v1.mjs NN core` / `clients` and the selected version of `run-cloud-events-ui-vN.mjs NN`. Each attempt owns a new native PostgreSQL cluster/ports and closes owned services, browser and native panel. Original failed attempts, raw logs and exact source archives are retained. Do not use Docker or WSL.', '使用 `node scripts/run-cloud-events-v1.mjs NN core`／`clients` 及选定的 `run-cloud-events-ui-vN.mjs NN` 复现。每次独占新的原生 PostgreSQL 和端口，结束关闭自建服务、浏览器与原生侧栏。保留失败尝试、原始日志及当时源代码。禁止 Docker／WSL。')}
    for folder in [ROOT/'docs']+[DEV/('copypaste-'+c)for c in COMPONENTS]:
        component=folder.name.removeprefix('copypaste-')
        selected_media=all_media if component in ['docs','delivery'] else [r for r in all_media if Path(r['path']).parts[0]=='copypaste-'+('web'if component=='platform'else component)]
        if component=='desktop':selected_media=[]
        if folder!=ROOT/'docs':
            for row in selected_media:
                src=DEV/row['path'];dst=folder/'media'/('cloud-events-'+Path(row['path']).parts[0]+'__'+src.name)
                if src.resolve()==dst.resolve():continue
                dst.parent.mkdir(parents=True,exist_ok=True);assert not dst.exists();shutil.copyfile(src,dst);assert digest(dst)==row['sha256'];copies.append({'source':src.relative_to(ROOT).as_posix(),'target':dst.relative_to(ROOT).as_posix(),'sha256':digest(dst)})
        for name in ['README.md','README.en.md']:
            p=folder/name;old=p.read_bytes();assert b'<!-- cloud-events-stage115 -->'not in old;title,body=old.split(b'\n',1);en=name.endswith('.en.md')
            text='<!-- cloud-events-stage115 -->\n'+('Private signed event work now connects customer confirmation, durable deduplicated receipts and independent cloud runs with scoped administration.\n\n'if en else '已接通私有签名事件工作：客户明确确认、持久去重回执、独立云端运行与范围化后台管理。\n\n')
            if component in details:text+=details[component][0 if en else 1]+'\n\n'
            text+=('Validation: 'if en else '验证：')+str(cp['counts']['backend']['tests'])+(' affected backend tests, 13 build/type checks, 7 actual Web/Admin/native Side Panel flows, 5 layouts and 2 pinned native Codex executions. Model/accounts/sender are synthetic. Provider-native webhook and full-product acceptance remain unproven.\n\n'if en else ' 项相关后端测试、13 项构建／类型检查、7 条真实 Web／Admin／原生侧栏流程、5 种布局与 2 次锁定版本原生 Codex 执行。模型、账户及发端使用假数据；第三方原生事件接入与完整产品验收仍未证明。\n\n')
            prefix=''if folder==ROOT/'docs'else'https://github.com/copypasteltd/workmate/blob/docs/docs/'
            text+='[Runbook / 方案]('+prefix+'technical/115-signed-cloud-events.md) · [Evidence / 证据]('+prefix+'quality/cloud-events-checkpoint.json)\n\n'+diagram+'\n'
            for row in selected_media:
                ext=Path(row['path']).suffix
                target=('design/implementation/'if folder==ROOT/'docs'else'media/')+'cloud-events-'+Path(row['path']).parts[0]+'__'+Path(row['path']).name
                if ext in ['.png','.gif']:text+='![Actual '+Path(row['path']).parts[0]+' event flow / 实际事件流程]('+target+')\n\n'
                elif ext=='.mp4':text+='[Actual interaction video / 实际交互视频]('+target+')\n\n'
            p.write_bytes(title+b'\n\n'+text.encode()+body);changes.append({'path':p.relative_to(ROOT).as_posix(),'before_sha256':sha256(old).hexdigest(),'after_sha256':digest(p)})
    progress_path=Q/'requirements-alignment-progress.json';old=progress_path.read_bytes();progress=read(progress_path)
    progress['private_signed_cloud_events']={'checkpoint':ref(CP),'counts':cp['counts'],'actual_ui_flows':7,'original_requirements_modified':False,'live_provider_qualified':False,'full_acceptance':'not_proven'}
    progress_path.write_text(json.dumps(progress,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n');changes.append({'path':progress_path.relative_to(ROOT).as_posix(),'before_sha256':sha256(old).hexdigest(),'after_sha256':digest(progress_path)})
    for en in [False,True]:
        p=ROOT/('docs/changes/2026-10-27-private-signed-events'+('.en'if en else'')+'.md');assert not p.exists()
        p.write_text(('# Private signed event work\n\n'if en else'# 私有签名事件工作\n\n')+('Implemented fixed-version proposals, exact customer consent, one-time keys, raw-byte HMAC, durable inbox/deduplication, bounded serialized dispatch, daily limits, failure review, source erasure, Web/native Side Panel controls and scoped MFA Admin metadata/pause. Desktop remains local.\n\n'if en else'实现固定版本提案、客户明确确认、一次性密钥、原始字节签名、持久收件与去重、有上限串行调度、每日额度、失败核对、来源删除、Web／原生侧栏操作及范围化 MFA 后台管理。Desktop 保持本机执行。\n\n')+str(cp['counts']['backend']['tests'])+' backend tests; 13 builds; 7 actual UI flows; 5 layouts; 2 native Codex executions. Synthetic model/accounts/sender; original full-product and live-provider gates remain unproven.\n\n[Runbook / 方案](../technical/115-signed-cloud-events.md) · [Evidence / 证据](../quality/cloud-events-checkpoint.json)\n',encoding='utf-8',newline='\n')
    write(Q/'cloud-events-documentation-refresh.json',{'checkpoint':ref(CP),'changes':changes,'media_copies':copies,'verifier_sha256':digest(Path(__file__))})

def audit():
    from markdown_it import MarkdownIt
    from urllib.parse import urlsplit,unquote
    cp,refresh=read(CP),read(Q/'cloud-events-documentation-refresh.json');assert cp['verifier_sha256']==refresh['verifier_sha256']==digest(Path(__file__))
    for n,h in cp['source_files'].items():assert digest(ROOT/n)==h,n
    for r in refresh['changes']:assert digest(ROOT/r['path'])==r['after_sha256']
    for r in refresh['media_copies']:assert digest(ROOT/r['source'])==digest(ROOT/r['target'])==r['sha256']
    links=0;parser=MarkdownIt()
    for folder in [ROOT/'docs']+[DEV/('copypaste-'+c)for c in COMPONENTS]:
        for name in ['README.md','README.en.md']:
            p=folder/name;body=p.read_text('utf-8');assert '<!-- cloud-events-stage115 -->'in body
            for token in parser.parse(body):
                for child in token.children or []:
                    v=child.attrGet('src')if child.type=='image'else child.attrGet('href')if child.type=='link_open'else None
                    if v and not urlsplit(v).scheme and not v.startswith('#'):
                        assert(p.parent/unquote(urlsplit(v).path)).exists(),(p,v);links+=1
    decoded=[]
    for movie in cp['recordings']:
        for row in movie['files']:
            p=DEV/row['path'];probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=nb_read_frames:format=duration','-of','json',str(p)]))
            assert int(probe['streams'][0]['nb_read_frames'])>1 and abs(float(probe['format']['duration'])-movie['seconds'])<=.25
            result=subprocess.run(['ffmpeg','-v','error','-xerror','-err_detect','explode','-i',str(p),'-map','0:v:0','-f','null','-'],capture_output=True,check=True);assert not result.stderr.strip();decoded.append(row)
    original=read(Q/'history/stage96-before-solution-packages/receipt.json');now=read(Q/'requirements-alignment-progress.json');assert now['requirements']==original['requirements']and now['gates']==original['gates']
    write(Q/'cloud-events-docs-audit-01.json',{'status':'passed','checkpoint':ref(CP),'bilingual_readmes':14,'local_readme_links':links,'decoded_recordings':decoded,'original_matrix_unchanged':True,'verifier_sha256':digest(Path(__file__))})
    print(json.dumps({'status':'passed','readmes':14,'links':links,'decoded':len(decoded)}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['record','sync','audit']);parser.add_argument('--core',default='04');parser.add_argument('--ui',default='04');parser.add_argument('--clients',default='02');parser.add_argument('--ui-version',default='4');args=parser.parse_args();ui_version=args.ui_version
    if args.action=='record':record(args.core,args.ui,args.clients)
    elif args.action=='sync':sync()
    else:audit()
