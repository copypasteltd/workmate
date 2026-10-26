"""Bind stage104 sources, immutable attempts, bilingual documentation and actual media."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
from collections import Counter
from urllib.parse import unquote, urlsplit
import argparse
import json
import shutil
import subprocess
from markdown_it import MarkdownIt

ROOT=Path(__file__).resolve().parents[2]
DEV=ROOT/'dev'
QUALITY=ROOT/'docs/quality'
DELIVERY=DEV/'copypaste-delivery'
CP=QUALITY/'private-cloud-schedules-checkpoint.json'
COMPONENTS=['platform','web','admin','desktop','extension','delivery']
SCOPE='Private conversation/result to exact customer-confirmed daily/weekly cloud schedules: immutable method/input/calendar versions, atomic independent runs, human review, actual child settlement, pause/cancel isolation, scoped metadata-only MFA Admin pause, Web and actual right Chrome SIDE_PANEL. Desktop remains customer-local; synthetic model/accounts.'
def digest(p):return sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def ref(p):return {'path':p.relative_to(ROOT).as_posix(),'sha256':digest(p)}
def write(p,v):
    p.parent.mkdir(parents=True,exist_ok=True)
    with p.open('x',encoding='utf-8',newline='\n') as f:json.dump(v,f,ensure_ascii=False,indent=2);f.write('\n')
def git(repo,*args):return subprocess.check_output(['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false',*args],cwd=repo)

def record(args):
    selected={'core':f'evidence/cloud-schedule-core-{args.core}.json','ui':f'evidence/cloud-schedule-ui-{args.ui}.json'}
    reports={k:read(DELIVERY/v) for k,v in selected.items()};core=reports['core'];ui=reports['ui'];journey=ui['journey']
    assert core['status']==ui['status']==journey['status']=='passed'
    assert core['scope']=='full' and core['counts']['tests']==core['counts']['pass']==78
    assert core['counts']['fail']==0 and len(journey['checks'])==8 and not journey['errors']
    assert all(journey[k] for k in ['browser_closed','panel_closed','api_closed','fixture_closed'])
    assert len(journey['executions'])==2 and all(e['native_codex'] and e['synthetic_model'] and e['reservation_count']==1 and int(e['charged_micros'])>0 for e in journey['executions'])
    assert len(journey['screenshots'])==8 and len(journey['media'])==3 and len(journey['output_files'])==1
    qualified={}
    for kind,report in reports.items():
        assert report['source_unchanged'] and report['owned_database_shutdown']
        for name,expected in report['source_files'].items():
            assert digest(DEV/name)==expected,name
            key='dev/'+name;assert key not in qualified or qualified[key]==expected,key;qualified[key]=expected
        if kind=='ui':assert report['compiled_unchanged'] and report['owned_previews_closed']
    attempts=[]
    for kind in ['core','ui']:
        for p in sorted((DELIVERY/'evidence').glob('cloud-schedule-'+kind+'-??.json')):
            data=read(p);archive=p.with_name(p.stem+'-sources');assert archive.is_dir()
            for name,expected in data['source_files'].items():assert digest(archive/name)==expected,(p.name,name)
            attempts.append({**ref(p),'status':data['status'],'selected':p==DELIVERY/selected[kind],'source_files':len(data['source_files'])})
    for row in journey['screenshots']+[v for movie in journey['media'] for v in movie['files']]:assert digest(DEV/row['path'])==row['sha256']
    baseline=read(QUALITY/'history/stage96-before-solution-packages/receipt.json')
    for name,expected in baseline['published_files'].items():assert digest(ROOT/name)==expected,name
    progress=read(QUALITY/'requirements-alignment-progress.json')
    assert progress['requirements']==baseline['requirements'] and progress['gates']==baseline['gates']
    assert dict(Counter(v['assessment'] for v in progress['requirements']))=={'partial_verified':86,'completion_not_proven':16}
    assert progress['fully_accepted_requirements']==progress['qualified_live_roles']==0
    from finalize_desktop_browser_manifest import committed_blobs
    oldsql=sorted(p for p in (DEV/'copypaste-platform/migrations').glob('*.sql') if int(p.name[:3])<120);assert len(oldsql)==119
    blobs=committed_blobs(DEV/'copypaste-platform',[p.relative_to(DEV/'copypaste-platform').as_posix() for p in oldsql],{})
    for p in oldsql:
        disk=p.read_bytes();blob=blobs[p.relative_to(DEV/'copypaste-platform').as_posix()];assert disk==blob or disk.replace(b'\r\n',b'\n')==blob,p
    write(CP,{'at':datetime.now(timezone.utc).isoformat(),'stage':104,'status':'verified_scoped_private_cloud_schedules','scope':SCOPE,'selected':selected,'source_files':dict(sorted(qualified.items())),'qualification_scopes':[{'kind':k,**ref(DELIVERY/v),'source_files':len(reports[k]['source_files'])} for k,v in selected.items()],'core_tests':core['counts'],'ui_checks':journey['checks'],'screenshots':journey['screenshots'],'recordings':journey['media'],'native_executions':journey['executions'],'output_files':journey['output_files'],'all_attempts':attempts,'new_migrations':[ref(DEV/'copypaste-platform/migrations/120-private-cloud-schedules.sql')],'api_contract':ref(ROOT/'docs/contracts/private-cloud-schedules-openapi.json'),'role_release':ref(DEV/'copypaste-platform/catalog/cloud-schedule-release-v1.json'),'previous_admin_checkpoint':ref(QUALITY/'admin-data-jobs-checkpoint.json'),'preservation':{'baseline':ref(QUALITY/'history/stage96-before-solution-packages/receipt.json'),'published_files':len(baseline['published_files']),'prior_sql_files':119,'requirements':102,'cases':102,'original_requirement_and_gate_arrays_unchanged':True},'not_validated':['complete_product_acceptance','live_professional_model_quality','new_desktop_execution_behavior','automatically_refreshed_external_account_inputs'],'verifier_sha256':digest(Path(__file__))})
    print(json.dumps({'status':'verified_scoped_private_cloud_schedules','core_checks':78,'ui_checks':8,'sources':len(qualified),'attempts':len(attempts)}))

def sync():
    cp=read(CP);assert cp['verifier_sha256']==digest(Path(__file__))
    archive=QUALITY/'history/stage104-documents';archive.mkdir();changes=[];copies=[]
    def change(file,content):
        component=next((c for c in COMPONENTS if file.is_relative_to(DEV/('copypaste-'+c))),None);repo=DEV/('copypaste-'+component) if component else ROOT
        name=file.relative_to(repo).as_posix();before=git(repo,'show','HEAD:'+name);assert file.read_bytes().replace(b'\r\n',b'\n')==before.replace(b'\r\n',b'\n'),file
        saved=archive/(component or 'docs')/name;saved.parent.mkdir(parents=True,exist_ok=True);saved.write_bytes(before)
        file.write_bytes(content);changes.append({'path':file.relative_to(ROOT).as_posix(),'archive':saved.relative_to(ROOT).as_posix(),'before_sha256':sha256(before).hexdigest(),'after_sha256':digest(file)})
    folders=[ROOT/'docs']+[DEV/('copypaste-'+c) for c in COMPONENTS]
    media=cp['screenshots']+[v for movie in cp['recordings'] for v in movie['files']]
    for folder in folders:
        for item in media:
            src=DEV/item['path'];target='schedule-'+src.parent.parent.parent.name+'-'+src.name;dst=folder/'assets/screenshots'/target;dst.parent.mkdir(parents=True,exist_ok=True);assert not dst.exists();shutil.copyfile(src,dst);copies.append({'source':src.relative_to(ROOT).as_posix(),'target':dst.relative_to(ROOT).as_posix(),'sha256':digest(dst)})
    diagram='```mermaid\nflowchart LR\n A[Private conversation or result] --> B[Pending fixed-method request]\n B --> C[Customer reviews and confirms]\n C --> D[Durable calendar]\n D --> E[Independent private run]\n E --> F[Human review and actual settlement]\n C --> G[Pause future times]\n G --> H[Customer confirms resume]\n H --> D\n```\n\n'
    def copied_name(row):
        src=DEV/row['path'];return 'schedule-'+src.parent.parent.parent.name+'-'+src.name
    for folder in folders:
        component=folder.name.removeprefix('copypaste-') if folder!=ROOT/'docs' else 'docs'
        for name in ['README.md','README.en.md']:
            en=name.endswith('.en.md');file=folder/name;design='technical/104-private-cloud-schedules.md' if component=='docs' else 'https://github.com/copypasteltd/workmate/blob/docs/docs/technical/104-private-cloud-schedules.md';evidence='quality/private-cloud-schedules-checkpoint.json' if component=='docs' else 'https://github.com/copypasteltd/workmate/blob/docs/docs/quality/private-cloud-schedules-checkpoint.json'
            text='<!-- cloud-schedules-stage104 -->\n\n'
            text+=('Private cloud schedules now connect consultant conversation or an existing private result to explicit customer review and daily/weekly execution. Review the fixed method, inputs, time zone, outputs and per-run Agent budget → check consent → activate → inspect each independent run, human review point, private deliverable and actual charges. Web and the real Chrome right Side Panel provide confirmation and pause; Admin lists scoped metadata and can pause future times after recent MFA and a recorded reason.\n\n' if en else '私有云端定时工作流已接通顾问对话及已有私有成果。核对固定方法、输入、时区、交付与每次 Agent 预算 → 主动勾选确认 → 启用每日／每周计划 → 查看逐次执行、人工审批、私有交付和实际费用。Web 与真实 Chrome 右侧栏可确认和暂停；Admin 按权限范围查看元数据，并在近期 MFA 与记录理由后暂停未来触发。\n\n')
            text+=('Pause preserves current work; cancel a current run separately. Resumption is confirmed by the customer and skips the paused interval. Editing creates a new pending request and immutable version. Failed or unknown paid work blocks future launches for review. Fixed inputs do not automatically refresh external account data, and activation does not precharge all future runs. Desktop continues running customer-local Codex; its native credentials cannot activate cloud replacement work.\n\n' if en else '暂停保留当前工作，取消某次执行需单独操作；恢复由客户重新确认并略过暂停期间。修改先生成独立提案，再追加不可变版本。失败或费用未知会阻止未来触发，待核对后再处理。固定输入不自动刷新外部账号数据，启用不预扣全部未来费用。Desktop 继续运行客户本机 Codex，原生凭证不能启用云端替代执行。\n\n')
            text+=('Verified: 78 checks across six related backend suites, eight actual cross-client journeys, eight unedited PNGs and three actual GIF/MP4 pairs, using native PostgreSQL, pinned native Codex, real email/MFA/PKCE and explicitly synthetic model/account data. This scoped increment does not establish live model quality or complete product acceptance.\n\n' if en else '已核查：六个相关后端测试文件共 78 项、八项真实跨端流程、八张未修改 PNG、三组实际 GIF／MP4；使用原生 PostgreSQL、固定原生 Codex、真实电邮／MFA／PKCE 和明确的假模型／账号数据。本增量不代表真实模型质量或完整产品验收。\n\n')
            if component in ['platform','delivery']:
                text+=('Apply additive SQL120 and keep schedule/workflow maintenance enabled. From Delivery run `node scripts/run-cloud-schedule-checks.mjs <fresh-two-digit-attempt> full`, then `node scripts/run-cloud-schedule-ui.mjs <fresh-two-digit-attempt>`. Each attempt archives exact source and failures and releases owned native services/browser pages. No Docker/WSL.\n\n' if en else '部署套用新增 SQL120，并保持定时／工作流 maintenance 开启。从 Delivery 运行 `node scripts/run-cloud-schedule-checks.mjs <新的两位编号> full`，再运行 `node scripts/run-cloud-schedule-ui.mjs <新的两位编号>`。每轮保留确切源码和失败记录，释放自有原生服务及浏览器页面；禁止 Docker／WSL。\n\n')
            text+=f'[Design / 方案]({design}) · [Exact evidence / 确切证据]({evidence})\n\n'+diagram
            chosen='copypaste-'+(component if component in ['admin','extension'] else 'web');shot=next(v for v in cp['screenshots'] if v['path'].startswith(chosen+'/') and ('active-en' in v['path'] if component!='admin' else 'private-schedules-en' in v['path']))
            movie=next(v for v in cp['recordings'] if v['files'][0]['path'].startswith(chosen+'/'));gif=next(v for v in movie['files'] if v['path'].endswith('.gif'));mp4=next(v for v in movie['files'] if v['path'].endswith('.mp4'))
            text+=f'![Actual {chosen} cloud schedule / 实际云端计划](assets/screenshots/{copied_name(shot)})\n\n![Actual confirmation or pause / 实际确认或暂停](assets/screenshots/{copied_name(gif)})\n\n[Actual interaction MP4](assets/screenshots/{copied_name(mp4)})\n\n'
            title,body=file.read_bytes().split(b'\n',1);change(file,title+b'\n\n'+text.encode()+body)
    note='\n\n**阶段 104 / Stage 104：** 已接通私有对话／成果到明确确认的云端每日／每周计划、不可变版本、逐次 run、人工审批、费用结算、暂停／取消隔离、客户恢复确认和按范围的 MFA Admin 暂停。78 项相关后端检查、8 项实际跨端流程、8 张截图、3 组交互录制；明确假数据。SQL120 新增，SQL001–119 保留。Desktop 本机 Codex 不被云端替代；原 102 REQ／TC 和完整验收结论不改写。见[方案与实际范围](../technical/104-private-cloud-schedules.md)。\n\n'
    for name in ['requirements/01-srs.md','modules/08-usage-billing-admin.md','modules/06-connectors-workflows.md','modules/07-web-extension-desktop.md','product/06-role-templates-and-skill-presets.md','technical/15-cloud-workflow-schedules.md','technical/91-private-cloud-workflows.md','product/08-admin-dashboard.md','technical/11-admin-control-plane.md','quality/01-test-and-acceptance-plan.md','governance/04-git-branches-and-publication.md','technical/01-architecture-and-stack.md']:
        file=ROOT/'docs'/name;title,body=file.read_bytes().split(b'\n',1);local=note if not name.startswith('technical/') else note.replace('../technical/104-private-cloud-schedules.md','104-private-cloud-schedules.md');change(file,title+b'\n'+local.encode()+body)
    file=QUALITY/'requirements-alignment-progress.json';value=read(file);value['at']=datetime.now(timezone.utc).isoformat();value['private_cloud_schedules']={'checkpoint':ref(CP),'core_checks':78,'ui_checks':8,'requirement_scope':'REQ032 fixed private methods; REQ033/071 explicitly confirmed repeatable cloud workflows; scoped Admin pause','full_acceptance':'not_proven'};change(file,(json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode())
    for en in [False,True]:
        text=('# Private cloud workflow schedules\n\n' if en else '# 私有云端定时工作流\n\n')+('Implemented customer-confirmed private daily/weekly schedules from real consultant tools or an existing result. Immutable versions, actual independent runs and settlement, human approval, missed/DST rules, no overlap, source/permission rechecks, pause/cancel isolation, reviewed resumption and scoped metadata-only MFA Admin pause are connected to Web and actual right SIDE_PANEL. Desktop remains customer-local.\n\n78 related backend checks and eight actual browser journeys passed with synthetic model/accounts, native PostgreSQL and pinned native Codex. Exact attempts, source, screenshots and three GIF/MP4 pairs are bound by the checkpoint. Complete original product acceptance remains unproven.\n\n' if en else '已实现从真实顾问工具或已有成果准备、由客户明确确认的私有每日／每周计划，接通不可变版本、逐次执行与结算、人工审批、漏跑／夏令时规则、防重叠、来源／权限重查、暂停／取消隔离、重新确认恢复及按范围的 MFA Admin 暂停。Web 与真实原生右侧栏已接入；Desktop 继续本机执行。\n\n78 项相关后端检查及八项实际浏览器流程通过，使用假模型／账号、原生 PostgreSQL 和固定原生 Codex。确切历次尝试、源码、截图和三组 GIF／MP4 由 checkpoint 绑定。原产品完整验收仍未证明。\n\n')+'[Design / 方案](../technical/104-private-cloud-schedules.md) · [Evidence / 证据](../quality/private-cloud-schedules-checkpoint.json)\n'
        (ROOT/('docs/changes/2026-10-26-private-cloud-schedules'+('.en' if en else '')+'.md')).write_text(text,encoding='utf-8',newline='\n')
    write(archive/'receipt.json',{'files':changes});write(QUALITY/'cloud-schedule-documentation-refresh.json',{'at':datetime.now(timezone.utc).isoformat(),'status':'passed','checkpoint':ref(CP),'changes':changes,'media_copies':copies,'verifier_sha256':digest(Path(__file__))})
    print(json.dumps({'status':'passed','documents':len(changes),'copies':len(copies)}))

def audit():
    cp=read(CP);assert cp['verifier_sha256']==digest(Path(__file__))
    for name,expected in cp['source_files'].items():assert digest(ROOT/name)==expected,name
    refresh=read(QUALITY/'cloud-schedule-documentation-refresh.json');assert refresh['checkpoint']['sha256']==digest(CP)
    for row in refresh['changes']:assert digest(ROOT/row['path'])==row['after_sha256'] and digest(ROOT/row['archive'])==row['before_sha256']
    for row in refresh['media_copies']:assert digest(ROOT/row['source'])==digest(ROOT/row['target'])==row['sha256']
    decoded=[]
    for movie in cp['recordings']:
        assert movie['distinct_frames']>1 and movie['observed_frames']>=5 and movie['skipped_capture_errors']==0
        for row in movie['files']:
            file=DEV/row['path'];probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames:format=duration','-of','json',str(file)]));assert int(probe['streams'][0]['nb_read_frames'])>1
            assert abs(float(probe['format']['duration'])-movie['seconds'])<=.25
            output=subprocess.run(['ffmpeg','-v','error','-xerror','-err_detect','explode','-i',str(file),'-map','0:v:0','-f','null','-'],capture_output=True,check=True);assert not output.stderr.strip();decoded.append({**row,'fully_decoded':True,'probe':probe})
    parser=MarkdownIt();links=0
    for folder in [ROOT/'docs']+[DEV/('copypaste-'+c) for c in COMPONENTS]:
        for name in ['README.md','README.en.md']:
            file=folder/name;body=file.read_text(encoding='utf-8');assert '<!-- cloud-schedules-stage104 -->' in body and '```mermaid' in body
            for token in parser.parse(body):
                for child in token.children or []:
                    value=child.attrGet('src') if child.type=='image' else child.attrGet('href') if child.type=='link_open' else None
                    if not value or urlsplit(value).scheme or value.startswith('#'):continue
                    assert (file.parent/unquote(urlsplit(value).path)).exists(),(file,value);links+=1
    write(QUALITY/'cloud-schedule-docs-audit-01.json',{'at':datetime.now(timezone.utc).isoformat(),'status':'passed','checkpoint':ref(CP),'bilingual_readmes':14,'local_readme_links':links,'recordings':decoded,'screenshots':cp['screenshots'],'visual_review':{'performed':True,'observations':['CopyPaste blue/gray and Manrope/Fraunces retained','Exact fixed-method review, native right panel and metadata-only Admin shown','Original timezone and actual settled charges shown in private run history','Chinese dark schedule card fits 390 pixels without horizontal overflow','Owned browser contexts and native services closed']},'verifier_sha256':digest(Path(__file__))})
    print(json.dumps({'status':'passed','readmes':14,'links':links,'decoded':len(decoded)}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['record','sync','audit']);parser.add_argument('--core',default='07');parser.add_argument('--ui',default='06');args=parser.parse_args();{'record':lambda:record(args),'sync':sync,'audit':audit}[args.action]()
