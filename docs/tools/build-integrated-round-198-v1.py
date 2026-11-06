"""Build bounded public evidence from real completed round198 receipts."""
from pathlib import Path
import hashlib,json,re,subprocess
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';DELIVERY=DEV/'copypaste-delivery';OUT=ROOT/'docs/quality/integrated-round-198'
OUT.mkdir(parents=True,exist_ok=True)
def load(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(n,v):(OUT/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
def git(p,*args):return subprocess.check_output(['git','-c','core.fsmonitor=false','-c','gc.auto=0','-c','maintenance.auto=false',*args],cwd=p,text=True,encoding='utf8',timeout=120).strip()
verification=load(DELIVERY/'.data/integrated-198-v3/verification.json');assert verification['state']=='passed'
counts=[]
for c in verification['checks']:
    p=DELIVERY/c['log'];assert sha(p)==c['sha256']
    if c['phase']=='test':
        v={k:sum(map(int,re.findall(r'^# '+k+r' (\d+)\s*$',p.read_text(encoding='utf8'),re.M))) for k in ['tests','pass','fail','skipped','cancelled','todo']}
        assert v['tests']==v['pass']>0 and not any(v[k] for k in ['fail','skipped','cancelled','todo'])
        counts.append({'component':c['component'],**v})
assert sum(c['pass'] for c in counts)==555
put('verification.json',{'stage':198,'scope':'Six builds, Desktop main and renderer types, and six relevant regression batches. Backend selection is not the complete historical matrix. Delivery TAP totals include both sections.','result':verification,'counts':counts,'total_tests':555,'backend_selection':load(DELIVERY/'.data/integrated-198-v3/backend-test-selection.json')})
batch=load(DELIVERY/'.data/integrated-198-v3/code-batch-complete.json')
sources=[]
for name in ['platform','web','admin','desktop','extension','delivery']:
    repo=DEV/('copypaste-'+name)
    for folder in ['src','renderer/src','contracts','tests']:
        base=repo/folder
        if not base.exists():continue
        for p in sorted(base.rglob('*')):
            if p.is_file() and p.suffix in ['.ts','.tsx','.css','.html','.json','.snapshot']:
                sources.append({'path':p.relative_to(ROOT).as_posix(),'sha256':sha(p)})
put('implementation-batch.json',{'stage':198,'batch_before_tests':batch,'final_reviewed_source_manifest':sources,'manifest_scope':'Current source hashes collected after validation; not represented as pre-build signed attestation. Product code was completed as a batch before unified checks. Corrected drivers do not replace product responses.'})
allowed=['stage','status','scope','at','finished_at','checks','screenshots','screenshot','recording','recordings','server_task','task_id','runtime','desktop_version','app_asar_sha256','company_file_transfer','javascript_errors','owned_browser_closed','owned_windows_closed','original_conversation']
journeys={}
for prefix,name in [('real-desktop','real-desktop-journey'),('extension','extension-journey'),('directory','web-directory-journey'),('final-smoke','final-smoke')]:
    attempts=[(p,load(p)) for p in (DELIVERY/'.data/acceptance-198').glob(prefix+'-*/receipt.json')]
    passing=[(p,v) for p,v in attempts if v['status']=='passed'];assert passing,prefix
    p,v=max(passing,key=lambda pair:pair[1].get('finished_at',''));public={k:v[k] for k in allowed if k in v}
    public['source']={'receipt':p.relative_to(DEV).as_posix(),'sha256':sha(p)}
    for media in [*v.get('screenshots',[]),*([v['screenshot']] if v.get('screenshot') else [])]:assert sha(DEV/media['path'])==media['sha256']
    for record in [*v.get('recordings',[]),*([v['recording']] if v.get('recording') else [])]:
        for media in record.get('files',[]):assert sha(DEV/media['path'])==media['sha256']
    if 'company_network' in v:
        network=v['company_network'];public['company_network']={'persistent':network['persistent'],'observed_requests':len(network['requests']),'all_cookie_free_redirect_denied':all(not r['cookie'] and r['credentials']=='omit' and r['redirect']=='error' and r['bypass'] for r in network['requests'])}
    put(name+'.json',public);journeys[name]=public
widths=[c for c in journeys['web-directory-journey']['checks'] if c['name'].startswith('Task directory fits ')]
assert [c['details']['width'] for c in widths]==[375,768,1024,1440]
assert journeys['real-desktop-journey']['desktop_version']=='0.7.9'
assert journeys['real-desktop-journey']['server_task']['charged_micros']=='32730'
put('retained-attempts.json',{'stage':198,'scope':'Executed originals remain immutable; failures and weak earlier evidence are not relabeled as passed.','journeys':[{'receipt':p.relative_to(DEV).as_posix(),'sha256':sha(p),'status':load(p)['status'],'error':load(p).get('error')} for p in (DELIVERY/'.data/acceptance-198').glob('*/receipt.json') if load(p)['status']!='passed'],'public_download_attempt1':load(DELIVERY/'.data/deployment-198-v1/public-release-v1.sanitized.json'),'prior_validation':[{'path':str(p.relative_to(DEV)).replace('\\','/'),'sha256':sha(p),'state':load(p).get('state')} for p in [DELIVERY/'.data/integrated-198-v1/verification.json',DELIVERY/'.data/integrated-198-v2/verification.json'] if p.exists()],'qa_corrections':['Initial backend fixture incorrectly created native task records without their actual native owner protocol. Corrected cloud-only pagination fixture respects that invariant; actual packaged native work supplies desktop coverage.','Initial route inventory omitted the additive directory contract. Original route inventory retained and current additive752+1 contract checked.','Web v1 used an inaccessible label; v2 used the actual Field label. Web v2 first responsive sample observed1440 before resize. Final v3 explicitly waits for and asserts375/768/1024/1440.','Desktop return screenshot captured the loading shell. It remains retained; published completed-execution screenshot is a separate actual loaded view from the same native journey.','The first final-smoke helper discarded the original sign-in error. Concurrent same-email OTP requests are consistent with the existing two-per-minute policy, but no retained response proves429. Final Web uses a still-valid owned QA session checked against live identity, and Admin uses fresh email plus TOTP.','Initial download GET timed out; final complete public browser downloads pass. A separate safe GET was interrupted by a Chromium error page. Bounded safe GET navigation recovery does not replay authentication, business writes or model calls. Long-term network stability remains open.']})
host=load(DELIVERY/'.data/deployment-198-v1/host-final-v1.sanitized.json');assert host['deployment']['backend_root'].endswith('integrated-198-v1/backend');assert host['deployment']['credentials_unchanged'] and host['deployment']['database_and_proxy_processes_unchanged'];put('deployment.json',host)
public=load(DELIVERY/'.data/deployment-198-v1/public-release-v2.sanitized.json');assert public['status']=='passed'
assert all(d['head']==200 and d['range']==206 and d['full']==200 for d in public['downloads']);put('public-downloads.json',public)
put('release-metadata-validation.json',load(DELIVERY/'.data/deployment-198-v1/release-metadata-validation.json'))
pack=load(DEV/'copypaste-desktop/.data/deployment-198-v1/packaging-receipt.json');assert pack['status']=='passed';put('packaging.json',pack)
accounting=load(DELIVERY/'.data/deployment-198-v1/owned-native-accounting.sanitized.json')
assert len(accounting['tasks'])==1 and accounting['tasks'][0]['charged_micros']=='32730'
assert accounting['reservations'][0]['status']=='settled'
assert all(r['capacity_released'] for r in accounting['requests'])
assert accounting['receipts'][0]['knownChargeMicros']==32730 and not accounting['receipts'][0]['uncertain'] and not accounting['receipts'][0]['violation']
put('owned-native-accounting.json',accounting)
media=[]
for name,filenames in {
 'desktop':['198-v1-local-workspace.png','198-v1-native-execution.png','workmate-198-v1-local-workspace.gif','workmate-198-v1-local-workspace.mp4'],
 'web':['198-v4-task-directory-light.png','198-v4-task-directory-dark.png','workmate-198-v4-work-directory.gif','workmate-198-v4-work-directory.mp4'],
 'extension':['198-v1-side-panel.png','workmate-198-v1-side-panel.gif','workmate-198-v1-side-panel.mp4'],
 'admin':['198-v3-service-readiness.png','workmate-198-v3-service-review.gif','workmate-198-v3-service-review.mp4']}.items():
    for filename in filenames:
        p=DEV/('copypaste-'+name)/'assets/screenshots'/filename;assert p.is_file();media.append({'path':p.relative_to(DEV).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)})
put('actual-media.json',{'stage':198,'scope':'Actual captured interfaces, not mockups. Native GIF shows folder reference and start; the separate completed-execution PNG and receipt prove the final result. The loading return PNG is retained but is not the completed-result illustration.','files':media,'visual_review':'Loaded Web light/dark directory, native completed execution, real right Side Panel and Admin readiness visually inspected; native return loading image retained as weak evidence. Full UI/a11y acceptance remains open.'})
overlay=load(ROOT/'docs/quality/integrated-round-197/requirements-overlay.json');assert len(overlay['groups'])==32 and len(overlay['requirements'])==102
updates={
 '14':'0.7.9真实包完成本机Codex、文件命令、HK$0.032730结算、完整权限与撤权；本机原会话／结果视图恢复有证据。任意应用、休眠及离线矩阵仍开放。',
 '16':'0.5.7真实右侧栏、两类附件及历史搜索／归档恢复通过；完整Chrome／操作系统／商店兼容仍开放。',
 '18':'新增任务目录、签名翻页、原会话精确任务、成果标签及范围切换保护；过期历史页不阻断当前回执。全业务状态与恢复矩阵仍开放。',
 '20':'新目录每次核对当前项目权限、私有RLS和源撤销；游标绑定用户／会话／范围／筛选；旧账户导航状态失效。完整跨业务隐私矩阵仍开放。',
 '25':'当前公开包完成真实完整下载；原导航超时及网络错误保留。单轮恢复成功不能证明长期连接SLA。',
 '27':'本轮六端构建、Desktop双类型检查及555项相关测试通过，包含选定69项后端回归；未声称完整历史或生产矩阵全通过。',
 '29':'完整保留32组及102条原始需求和历史状态；本轮完成不等于全部目标完成。',
 '30':'独立完整任务目录、超过100条后端分页、筛选返回、准确原会话和本机打开进一步完善统一工作区；完整专业设计／应用工作流继续开放。',
 '31':'真实Web375/768/1024/1440明确断言、浅深主题及键盘检查；原生桌面和插件无横向溢出有实测，完整无障碍和交互矩阵仍开放。'}
for group in overlay['groups']:
    group['round198_update']=updates.get(group['id'],'沿用197状态及开放验收范围；本轮无独立全量验收，不自动判定完成。')
for req in overlay['requirements']:
    req['round198_overlay']=[{'group':i,'update':updates[i],'full_acceptance_closed':False} for i in req['current_group_references'] if i in updates]
overlay.update(stage=198,scope='Preserves all32 groups and102 original requirements. Bounded directory/context/native improvements do not close external, professional or production acceptance.');put('requirements-overlay.json',overlay)
trace='# 198 · 102条原始需求完整追溯\n\n所有原始历史字段保留在[覆盖层](requirements-overlay.json)，未用代码标记扫描替代验收。\n\n| ID | 模块 | 历史验收 | 当前关联组 | 本轮范围 |\n| --- | --- | --- | --- | --- |\n'
for req in overlay['requirements']:
    detail='；'.join(x['update'] for x in req['round198_overlay']) or '沿用原状态及开放范围，本轮未独立重做完整验收。'
    cells=[req['id'],req['module'],req['historical_167_acceptance'],' / '.join(req['current_group_references']),detail]
    trace+='| '+' | '.join(str(c).replace('|','／').replace('\n',' ') for c in cells)+' |\n'
(OUT/'requirements-102.md').write_text(trace,encoding='utf8')
(OUT/'README.md').write_text('''# 198 · 完整任务目录与工作上下文

整批产品代码完成后统一构建、测试和客户端联调。当前线上为 integrated-198-v1，schema163不变。Web和Desktop新增完整任务目录、标题／状态／位置／模式筛选及签名分页；从成果、通知或会话进入工作时确认企业和项目，返回保留原任务和视图。Extension恢复历史搜索与归档筛选，不让失效历史页阻断当前会话。

[应用](https://agent.copypaste.hk) · [后台](https://agent-dashboard.copypaste.hk) · [客户端下载](https://agent.copypaste.hk/downloads)

| 组件 | 当前版本 | 本轮交付 |
| --- | --- | --- |
| Backend | 0.5.6 | 只读完整任务目录、当前授权、签名游标和来源隔离 |
| Web | 0.5.5 | 目录与筛选、精确原会话、范围门控、返回状态 |
| Admin | 0.5.2 | 当前部署兼容与真实就绪／验收记录复核 |
| Desktop | 0.7.9 | 同一任务目录、本机原会话与成果视图恢复、固定公司目标 |
| Extension | 0.5.7 | 原生右侧栏历史状态恢复及非阻断提示 |
| Delivery | 0.5.4 | 完整批次检查、真实媒体、不可变包与服务器回读 |

六端构建、Desktop主进程和渲染类型检查通过；555项相关测试通过：Backend69、Web42、Admin22、Desktop301、Extension93、Delivery28，无失败或跳过。后端为与本轮权限、分页、原生和账务风险相关的选定回归，不是全部历史用例。

实际Desktop0.7.9使用发布包、本机Codex和公司模型网关，读取文件、运行PowerShell并写出经过核对的result.json；真实费用HK$0.032730已结算。完整权限原生确认与撤权、本机原会话和结果返回通过。Extension0.5.7通过真正原生右侧栏、PKCE、两类私人附件上传及历史筛选恢复。Web复验原任务／会话和375／768／1024／1440实际宽度；Admin新邮箱验证码加TOTP登录检查真实服务就绪与保留记录。

公开Setup、Portable、Extension ZIP以及校验文本均完成真实浏览器完整下载、字节数和SHA-256核对。原导航超时、早期脚本错误和弱截图证据保留，没有通过替换响应或重放业务写入获得通过。Web最终复验复用仍有效且经线上身份核对的自有QA会话，未伪称再次执行新邮箱登录。测试收件箱按要求保留。

| 交付证据 | 文件 |
| --- | --- |
| 代码与验证 | [代码批次](implementation-batch.json) · [555项检查](verification.json) |
| 真实客户端 | [Desktop](real-desktop-journey.json) · [Extension](extension-journey.json) · [Web](web-directory-journey.json) · [Web/Admin](final-smoke.json) |
| 上线与包 | [服务器回读](deployment.json) · [完整下载](public-downloads.json) · [打包](packaging.json) · [实际媒体](actual-media.json) |
| 原始范围 | [全部102条](requirements-102.md) · [32组覆盖层](requirements-overlay.json) · [保留尝试与纠正](retained-attempts.json) |

视频／语音与Google／Meta等外部接入、客户专业业务产出验收、完整应用／浏览器兼容、长期负载与灾备仍开放。19个预设角色及50个skill的现有受控验证不等于全部专业场景已验收；受信Windows签名按用户决定排除。没有把本轮交付或TODO标记为空当作完整目标或WorkBuddy对标完成。

English: Ships a full authorized task directory, signed pagination, exact conversation/task navigation, scope gating and restored review/history context after one implementation batch. Six builds, Desktop type checks and555 relevant regressions pass. Actual0.7.9 native Codex execution bills HK$0.032730;0.5.7 Side Panel, live Web/Admin and complete public package downloads are verified. Original failures remain. External, professional and full production/compatibility acceptance stays open.
''',encoding='utf8')
p=ROOT/'docs/development/198-task-directory-and-context.md';s=p.read_text(encoding='utf8');old='当前为整批编码阶段。构建、测试、客户端媒体、上线及远端回读在整批编码结束后记录，不能预填通过。';assert old in s
s=s.replace(old,'整批编码和集中修复后，六端构建、Desktop主进程／渲染类型检查及555项相关测试通过；实际0.7.9本机Codex、0.5.7原生右侧栏、线上Web／Admin及公开包完整下载已复验。失败和弱证据保留，详见[本轮交付](../quality/integrated-round-198/README.md)。各仓库及docs/main按既有授权普通推送并回读；远端结果以实际发布回执为准。完整外部／专业／生产验收未关闭。');p.write_text(s,encoding='utf8')
print(json.dumps({'status':'generated','tests':555,'groups':32,'requirements':102,'journeys':len(journeys),'media':len(media)}))
