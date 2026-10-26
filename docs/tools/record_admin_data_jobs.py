"""Record stage 103, preserve historical evidence, synchronize and audit delivery docs."""
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
CP=QUALITY/'admin-data-jobs-checkpoint.json'
COMPONENTS=['platform','web','admin','desktop','extension','delivery']
SCOPE='Persistent Admin user-state batches and frozen directory/usage/ledger/audit exports: exact review, asynchronous atomic item outcomes, cancellation, bounded transient retries, reviewed failed-only child jobs, live MFA/permission/field checks, expiring encrypted snapshots and actual Admin UI. Synthetic accounts and zero model calls; financial/VIP approval workflows retain their existing scope. This does not establish complete product acceptance.'
def digest(p):return sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def ref(p):return {'path':p.relative_to(ROOT).as_posix(),'sha256':digest(p)}
def write(p,v):
    with p.open('x',encoding='utf-8',newline='\n') as f:json.dump(v,f,ensure_ascii=False,indent=2);f.write('\n')
def git(repo,*args):return subprocess.check_output(['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false',*args],cwd=repo)

def record(args):
    selected={kind:f'evidence/admin-data-{kind}-{getattr(args,kind)}.json' for kind in ['core','ui']}
    reports={k:read(DELIVERY/v) for k,v in selected.items()}
    core,ui=reports['core'],reports['ui']
    assert core['status']=='passed' and core['scope']=='full' and len(core['test_files'])==6
    assert core['counts']['tests']==core['counts']['pass']==94 and all(core['counts'][k]==0 for k in ['fail','cancelled','skipped','todo'])
    assert ui['status']=='passed' and ui['owned_database_shutdown'] and ui['owned_preview_closed']
    assert ui['fixture_cleanup']['status']=='passed' and all(v['reclaimed'] for v in ui['fixture_cleanup']['results'])
    journey=read(DELIVERY/ui['journey']['path'])
    assert journey['status']=='passed' and len(journey['checks'])==7 and journey['errors']==[] and journey['model_calls']==0
    assert all(journey[k] for k in ['browser_closed','api_closed','fixture_closed'])
    assert len(journey['screenshots'])==6 and len(journey['recordings'])==2
    previous=read(QUALITY/'client-content-checkpoint.json')
    sources=dict(previous['source_files']); qualified={}
    for kind,report in reports.items():
        assert report['source_unchanged'] and report['owned_database_shutdown']
        for name,expected in report['source_files'].items():
            assert digest(DEV/name)==expected,name
            key='dev/'+name
            assert key not in qualified or qualified[key]==expected,key
            qualified[key]=expected
        for key in ['raw_report','verifier','journey','journey_verifier']:
            if report.get(key):assert digest(DELIVERY/report[key]['path'])==report[key]['sha256'],key
    sources.update(qualified)
    for name,expected in sources.items():assert digest(ROOT/name)==expected,name
    for row in journey['screenshots']+[v for movie in journey['recordings'] for v in movie['files']]:assert digest(DEV/row['path'])==row['sha256']
    baseline=read(QUALITY/'history/stage96-before-solution-packages/receipt.json')
    for name,expected in baseline['published_files'].items():assert digest(ROOT/name)==expected,name
    from finalize_desktop_browser_manifest import committed_blobs
    oldsql=sorted(p for p in (DEV/'copypaste-platform/migrations').glob('*.sql') if int(p.name[:3])<119)
    blobs=committed_blobs(DEV/'copypaste-platform',[p.relative_to(DEV/'copypaste-platform').as_posix() for p in oldsql],{})
    assert len(oldsql)==118
    for p in oldsql:
        disk,blob=p.read_bytes(),blobs[p.relative_to(DEV/'copypaste-platform').as_posix()]
        assert disk==blob or disk.replace(b'\r\n',b'\n')==blob,p
    progress=read(QUALITY/'requirements-alignment-progress.json')
    assert progress['requirements']==baseline['requirements'] and progress['gates']==baseline['gates']
    assert dict(Counter(v['assessment'] for v in progress['requirements']))=={'partial_verified':86,'completion_not_proven':16}
    assert progress['fully_accepted_requirements']==progress['qualified_live_roles']==0
    attempts=[]
    for kind in ['core','ui']:
        for p in sorted((DELIVERY/'evidence').glob('admin-data-'+kind+'-??.json')):
            data=read(p);archive=p.with_name(p.stem+'-sources')
            assert archive.is_dir()
            for name,expected in data['source_files'].items():assert digest(archive/name)==expected,(p.name,name)
            attempts.append({**ref(p),'status':data['status'],'selected':p==DELIVERY/selected[kind],'source_files':len(data['source_files'])})
    write(CP,{'at':datetime.now(timezone.utc).isoformat(),'stage':103,'status':'verified_scoped_admin_data_jobs','scope':SCOPE,'selected':selected,'source_files':dict(sorted(sources.items())),'qualification_scopes':[{'kind':k,**ref(DELIVERY/v),'source_files':len(reports[k]['source_files'])} for k,v in selected.items()],'core_tests':core['counts'],'ui_checks':journey['checks'],'screenshots':journey['screenshots'],'recordings':journey['recordings'],'all_attempts':attempts,'new_migrations':[ref(DEV/'copypaste-platform/migrations/119-admin-data-jobs.sql')],'api_contract':ref(ROOT/'docs/contracts/admin-data-jobs-openapi.json'),'previous_client_checkpoint':ref(QUALITY/'client-content-checkpoint.json'),'preservation':{'baseline':ref(QUALITY/'history/stage96-before-solution-packages/receipt.json'),'published_files':len(baseline['published_files']),'prior_sql_files':118,'requirements':102,'cases':102,'original_requirement_and_gate_arrays_unchanged':True},'not_validated':['complete_product_acceptance','live_professional_model_quality','new_desktop_or_extension_behavior','new_financial_or_vip_bulk_mutations'],'verifier_sha256':digest(Path(__file__))})
    print(json.dumps({'status':'verified_scoped_admin_data_jobs','core_checks':94,'ui_checks':7,'sources':len(sources),'attempts':len(attempts)}))

def sync():
    cp=read(CP);assert cp['verifier_sha256']==digest(Path(__file__))
    archive=QUALITY/'history/stage103-documents';archive.mkdir()
    changes,copies=[],[]
    def change(file,content):
        component=next((c for c in COMPONENTS if file.is_relative_to(DEV/('copypaste-'+c))),None)
        repo=DEV/('copypaste-'+component) if component else ROOT
        name=file.relative_to(repo).as_posix();before=git(repo,'show','HEAD:'+name)
        assert file.read_bytes().replace(b'\r\n',b'\n')==before.replace(b'\r\n',b'\n'),file
        saved=archive/(component or 'docs')/name;saved.parent.mkdir(parents=True,exist_ok=True);saved.write_bytes(before)
        file.write_bytes(content);changes.append({'path':file.relative_to(ROOT).as_posix(),'archive':saved.relative_to(ROOT).as_posix(),'before_sha256':sha256(before).hexdigest(),'after_sha256':digest(file)})
    media=cp['screenshots']+[v for movie in cp['recordings'] for v in movie['files']]
    folders=[ROOT/'docs']+[DEV/('copypaste-'+c) for c in COMPONENTS]
    for folder in folders:
        for item in media:
            src=DEV/item['path'];dst=folder/'assets/screenshots'/('admin-'+src.name);dst.parent.mkdir(parents=True,exist_ok=True)
            assert not dst.exists();shutil.copyfile(src,dst);copies.append({'source':src.relative_to(ROOT).as_posix(),'target':dst.relative_to(ROOT).as_posix(),'sha256':digest(dst)})
    diagram='```mermaid\nflowchart LR\n A[Select accounts or export criteria] --> B[Freeze and review]\n B --> C[Confirm persistent job]\n C --> D[Atomic item outcomes]\n D --> E[Failed-only child preview]\n E --> B\n D --> F[Recheck permission and download]\n```\n\n'
    for folder in folders:
        component=folder.name.removeprefix('copypaste-') if folder!=ROOT/'docs' else 'docs'
        for name in ['README.md','README.en.md']:
            en=name.endswith('.en.md');file=folder/name
            design='technical/103-persistent-admin-data-jobs.md' if component=='docs' else 'https://github.com/copypasteltd/workmate/blob/docs/docs/technical/103-persistent-admin-data-jobs.md'
            evidence='quality/admin-data-jobs-checkpoint.json' if component=='docs' else 'https://github.com/copypasteltd/workmate/blob/docs/docs/quality/admin-data-jobs-checkpoint.json'
            text='<!-- admin-data-stage103 -->\n\n'
            text+=('Admin now processes persistent account batches and frozen directory, usage, billing and audit exports. Select targets/filters → review exact records, versions and projected fields → explicitly confirm → follow each item → retry only failed targets in a reviewed child or download authorized CSV/manifest. Cancellation preserves committed effects. Existing billing/VIP approval history remains available.\n\n' if en else '后台已接入持久批量任务，以及用户目录、用量、费用流水和审计资料快照导出。操作流程：选择对象／条件 → 核对精确记录、版本与字段 → 明确确认 → 查看逐项结果 → 对失败对象预览并建立重试子任务，或下载已授权的 CSV／清单。取消保留已完成操作；原费用与 VIP 审批历史仍可查询。\n\n')
            text+=('Limits: 100 accounts per batch, 10,000 export rows; oversize selections are rejected. Every item and download rechecks live permissions, explicit denies, recent MFA, versions and field visibility. Previews expire after 5 minutes; encrypted job payloads after 15. Three bounded automatic attempts apply only to transient DB errors.\n\n' if en else '限制：每批最多 100 位用户，导出最多 10,000 笔，超限明确拒绝。逐项执行和下载重新验证当前权限、显式限制、近期 MFA、版本与字段可见性。预览五分钟、任务密文十五分钟过期；只有数据库暂时性错误自动退避，最多三次。\n\n')
            text+=('Verified with native PostgreSQL and actual Admin email/TOTP: 94 checks across six backend suites, seven browser journeys, six unedited PNGs and two actual GIF/MP4 recordings. Synthetic accounts, zero model calls. Customer-local Codex Desktop and native right Chrome Side Panel retain their existing execution model; this increment does not newly qualify those clients or the whole product.\n\n' if en else '已核查：六个后端测试文件共 94 项，七项真实 Admin 浏览器流程，六张未修改 PNG 及两组真实 GIF／MP4。采用原生 PostgreSQL、实际电邮／TOTP 会话、假用户和零模型调用。Desktop 本机 Codex 与 Chrome 原生右侧栏的执行模型继续保留；本增量不扩大为三端或完整产品验收结论。\n\n')
            if component in ['platform','delivery']:
                text+=('From Delivery, run `node scripts/run-admin-data-checks.mjs <fresh-two-digit-attempt> full`, then `node scripts/run-admin-data-ui.mjs <fresh-two-digit-attempt>`. Each verifier creates exact source archives, preserves failures, owns its native database/browser and releases them. Apply SQL119 and enable worker maintenance in deployment. No Docker/WSL.\n\n' if en else '从 Delivery 原生运行 `node scripts/run-admin-data-checks.mjs <新的两位编号> full`，再运行 `node scripts/run-admin-data-ui.mjs <新的两位编号>`；逐次保存确切源码和失败记录，并关闭自有数据库及浏览器。部署需套用 SQL119、启用 Worker maintenance；不使用 Docker／WSL。\n\n')
            text+=f'[Design / 方案]({design}) · [Exact evidence / 确切证据]({evidence})\n\n'+diagram
            shot=next(v for v in cp['screenshots'] if 'export-ready-en' in v['path']);movie=cp['recordings'][0]
            text+=f'![Actual Admin export / 实际后台导出](assets/screenshots/admin-{Path(shot["path"]).name})\n\n'
            gif=next(v for v in movie['files'] if v['path'].endswith('.gif'));mp4=next(v for v in movie['files'] if v['path'].endswith('.mp4'))
            text+=f'![Actual batch and retry / 实际批量与重试](assets/screenshots/admin-{Path(gif["path"]).name})\n\n[Actual interaction MP4](assets/screenshots/admin-{Path(mp4["path"]).name})\n\n'
            title,body=file.read_bytes().split(b'\n',1);change(file,title+b'\n\n'+text.encode()+body)
    note='\n\n**阶段 103 / Stage 103：** 已实现持久后台账户批量任务、冻结目录／用量／费用／审计导出、逐项事务结果、取消、失败子任务重试、MFA／权限重查与过期密文清理。94 项后端检查、7 项真实后台流程、6 张截图和 2 组交互录制；明确假数据。SQL119 新增，SQL001–118 保留。原 102 REQ／102 TC 与 G01–G10 完整验收结论不变。见[方案与实际范围](../technical/103-persistent-admin-data-jobs.md)。\n\n'
    for name in ['requirements/01-srs.md','modules/08-usage-billing-admin.md','product/08-admin-dashboard.md','technical/11-admin-control-plane.md','quality/01-test-and-acceptance-plan.md','governance/04-git-branches-and-publication.md','technical/01-architecture-and-stack.md']:
        file=ROOT/'docs'/name;title,body=file.read_bytes().split(b'\n',1)
        localnote=note if not name.startswith('technical/') else note.replace('../technical/103-persistent-admin-data-jobs.md','103-persistent-admin-data-jobs.md')
        change(file,title+b'\n'+localnote.encode()+body)
    file=QUALITY/'requirements-alignment-progress.json';value=read(file);value['at']=datetime.now(timezone.utc).isoformat();value['admin_data_jobs']={'checkpoint':ref(CP),'core_checks':94,'ui_checks':7,'requirement_scope':'REQ097 scoped persistent account batches and frozen data exports','full_acceptance':'not_proven'};change(file,(json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode())
    for en in [False,True]:
        text=('# Persistent Admin batches and frozen data exports\n\n' if en else '# 后台持久批量任务与冻结资料导出\n\n')+('Implemented explicit previews, persistent item execution, immutable partial results, cancellation, reviewed failed-only child retries and expiring encrypted directory/usage/ledger/audit exports. Admin uses actual background job APIs and checks current authority again at download. Existing financial/VIP operation history remains available.\n\n94 backend checks and seven actual browser checks passed using synthetic accounts and zero model calls. Exact source, attempts, screenshots and two GIF/MP4 pairs are bound in the checkpoint. Original product acceptance remains unproven.\n\n' if en else '已实现明确预览、持久逐项执行、不可变部分结果、取消、失败对象子任务重试和有期限的加密目录／用量／费用／审计导出。实际后台页面已改用异步任务 API，下载重新核对授权，保留原费用及 VIP 操作历史。\n\n以假用户和零模型调用核查 94 项后端检查、七项真实浏览器流程；确切源码、历次尝试、截图与两组 GIF／MP4 均由 checkpoint 绑定。原产品完整验收仍未证明。\n\n')+'[Design / 方案](../technical/103-persistent-admin-data-jobs.md) · [Evidence / 证据](../quality/admin-data-jobs-checkpoint.json)\n'
        (ROOT/('docs/changes/2026-10-26-admin-data-jobs'+('.en' if en else '')+'.md')).write_text(text,encoding='utf-8',newline='\n')
    write(archive/'receipt.json',{'files':changes})
    write(QUALITY/'admin-data-documentation-refresh.json',{'at':datetime.now(timezone.utc).isoformat(),'status':'passed','checkpoint':ref(CP),'changes':changes,'media_copies':copies,'verifier_sha256':digest(Path(__file__))})
    print(json.dumps({'status':'passed','documents':len(changes),'copies':len(copies)}))

def audit():
    cp=read(CP);assert cp['verifier_sha256']==digest(Path(__file__))
    for name,expected in cp['source_files'].items():assert digest(ROOT/name)==expected,name
    refresh=read(QUALITY/'admin-data-documentation-refresh.json');assert refresh['checkpoint']['sha256']==digest(CP)
    for row in refresh['changes']:assert digest(ROOT/row['path'])==row['after_sha256'] and digest(ROOT/row['archive'])==row['before_sha256']
    for row in refresh['media_copies']:assert digest(ROOT/row['source'])==digest(ROOT/row['target'])==row['sha256']
    decoded=[]
    for movie in cp['recordings']:
        assert movie['distinct_frames']>1 and movie['observed_frames']>=5 and movie['skipped_capture_errors']==0
        for row in movie['files']:
            file=DEV/row['path'];probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames:format=duration','-of','json',str(file)]));assert int(probe['streams'][0]['nb_read_frames'])>1
            assert abs(float(probe['format']['duration'])-movie['seconds'])<=.25
            output=subprocess.run(['ffmpeg','-v','error','-xerror','-err_detect','explode','-i',str(file),'-map','0:v:0','-f','null','-'],capture_output=True,check=True);assert not output.stderr.strip()
            decoded.append({**row,'fully_decoded':True,'probe':probe})
    parser,links=MarkdownIt(),0
    for folder in [ROOT/'docs']+[DEV/('copypaste-'+c) for c in COMPONENTS]:
        for name in ['README.md','README.en.md']:
            file=folder/name;body=file.read_text(encoding='utf-8');assert '<!-- admin-data-stage103 -->' in body and '```mermaid' in body
            for token in parser.parse(body):
                for child in token.children or []:
                    value=child.attrGet('src') if child.type=='image' else child.attrGet('href') if child.type=='link_open' else None
                    if not value or urlsplit(value).scheme or value.startswith('#'):continue
                    assert (file.parent/unquote(urlsplit(value).path)).exists(),(file,value);links+=1
    write(QUALITY/'admin-data-docs-audit-01.json',{'at':datetime.now(timezone.utc).isoformat(),'status':'passed','checkpoint':ref(CP),'bilingual_readmes':14,'local_readme_links':links,'recordings':decoded,'screenshots':cp['screenshots'],'visual_review':{'performed':True,'observations':['CopyPaste blue/gray tokens and Manrope/Fraunces retained','Real target review, partial result and separate child job shown','Selected list uses latest detail state','Chinese dark layout fits 390 pixels without horizontal overflow']},'verifier_sha256':digest(Path(__file__))})
    print(json.dumps({'status':'passed','readmes':14,'links':links,'decoded':len(decoded)}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['record','sync','audit']);parser.add_argument('--core',default='03');parser.add_argument('--ui',default='03');args=parser.parse_args();{'record':lambda:record(args),'sync':sync,'audit':audit}[args.action]()
