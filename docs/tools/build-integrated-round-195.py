"""Publish bounded round evidence; retain historical failures and acceptance scope."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,re,subprocess

ROOT=Path(__file__).resolve().parents[2]
DEV=ROOT/'dev';DELIVERY=DEV/'copypaste-delivery';OUT=ROOT/'docs/quality/integrated-round-195'
OUT.mkdir(parents=True,exist_ok=True)
def load(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def put(name,value):(OUT/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
verification=load(DELIVERY/'.data/integrated-195-v8/verification.json')
assert verification['state']=='passed' and len(verification['checks'])==12
receipts={}
for kind in ['ui','real-desktop','extension']:
 candidates=[]
 for p in (DELIVERY/'.data/acceptance-195').glob(kind+'-*/receipt.json'):
  v=load(p)
  if v['status']=='passed':candidates.append((v.get('finished_at',''),p,v))
 assert candidates,'Missing real journey: '+kind
 _,p,v=max(candidates)
 # Do not publish browser storage, mailbox messages, cookies or transport traces.
 receipts[kind]={k:v[k] for k in ['stage','status','resumed_from','at','finished_at','scope','automation_boundary','checks','screenshots','recordings','recording','screenshot','task','server_task','runtime','desktop_version','app_asar_sha256','javascript_errors','owned_browser_closed','owned_windows_closed','readiness'] if k in v}
 receipts[kind]['private_receipt_relative']=p.relative_to(DEV).as_posix();receipts[kind]['private_receipt_sha256']=sha(p)
 put(kind+'-journey.json',receipts[kind])
host=load(DELIVERY/'.data/deployment-195/host-final-v3.sanitized.json')
assert host['deployment']['status']=='deployed' and host['deployment']['backend_root'].endswith('integrated-195-v10/backend')
downloads=load(DELIVERY/'.data/deployment-195/public-release-v2.sanitized.json')
assert downloads['status']=='passed' and len(downloads['downloads'])==4
equivalence=load(DELIVERY/'.data/deployment-195/runtime-equivalence-v9-v10.sanitized.json')
assert equivalence['status']=='passed' and equivalence['compared_files']==683
put('runtime-equivalence.json',equivalence)
smokes=[]
for p in (DELIVERY/'.data/acceptance-195').glob('final-smoke-*/receipt.json'):
 v=load(p)
 if v['status']=='passed':smokes.append((v['finished_at'],p,v))
assert smokes,'Final deployed candidate needs a passing read-only smoke'
_,p,smoke=max(smokes)
smoke['private_receipt_relative']=p.relative_to(DEV).as_posix();smoke['private_receipt_sha256']=sha(p)
put('final-smoke.json',smoke)
runtime=load(DEV/'copypaste-platform/.data/document-preview/runtime.json');put('windows-office-runtime.json',{k:runtime[k] for k in ['version','msi_sha256','office_sha256','host_sha256','host_source_sha256']});
put('deployment.json',host);put('public-downloads.json',downloads)
test_rows=[]
for check in verification['checks']:
 if check['phase']!='test':continue
 log=DELIVERY/check['log'];assert sha(log)==check['sha256'];text=log.read_text(encoding='utf-8')
 counts={key:sum(map(int,re.findall(r'^# '+key+r' (\d+)\s*$',text,re.M))) for key in ['tests','pass','fail','cancelled','skipped']}
 assert counts['tests']==counts['pass'] and counts['tests']>0
 test_rows.append({'component':check['component'],'counts':counts,'log_sha256':check['sha256']})
put('verification.json',{'scope':'Six builds and selected changed backend boundaries plus current client/delivery suites; not every historical backend test','result':verification,'backend_selection':load(DELIVERY/'.data/integrated-195-v8/backend-test-selection.json'),'tests':test_rows,'total_tests':sum(r['counts']['tests'] for r in test_rows)})
failures=[]
for p in sorted((DELIVERY/'.data/acceptance-195').glob('*/receipt.json')):
 v=load(p)
 if v.get('status')=='failed':failures.append({'receipt':p.relative_to(DEV).as_posix(),'sha256':sha(p),'error':str(v.get('error','')).split('\n')[0][:400],'checks_passed_before_failure':len(v.get('checks',[]))})
put('retained-attempts.json',{'scope':'Original failed receipts remain locally; later success does not overwrite them','ui_failures':failures,'earlier_verification_directories':['integrated-195','integrated-195-v2','integrated-195-v3','integrated-195-v4','integrated-195-v5','integrated-195-v6','integrated-195-v7'],'notes':['First implementation build exposed type/API compatibility issues, fixed as a batch.','The source database was started natively and the local schema gate corrected.','Windows Office cold startup still failed in v6/v7. The final batch pins soffice.bin, permits one observed exit81 restart inside the same private profile/job/deadline, and corrects the actor-bound private fixture. Original failed receipts remain.','The Office upload MIME allowlist and conversation attachment wire contract were corrected after actual UI failures.','Side Panel readiness and bilingual consent were corrected in the QA automation; original failures are retained.','The first graceful Nginx reload checks raced worker activation; automatic rollback was exercised, then bounded readiness checks were added.']})
old=load(ROOT/'docs/quality/system-assessment-194/assessment.json')
updates={
 '07':('指定格式已实现并实测','Linux 原生 Office 已上线，Word/Excel/PowerPoint 与中文预览通过；仍不承诺所有第三方格式完全保真。'),
 '08':('已补验收管理，专业验收仍开放','Admin 可记录真实模板/任务/技能/费用/交付快照并批量撤回；受控测试记录不计入专业角色合格。'),
 '14':('本轮本机主流程已验证，完整矩阵开放','0.7.5 实际本机 Codex、原生权限、文件引用、命令、结果和结算通过；任意应用/离线/休眠矩阵未完成。'),
 '15':('新版已发布，安装矩阵开放','0.7.5 安装版、便携版已发布并逐文件校验；受信签名仍按用户决定排除。'),
 '16':('新增输入主流程已验证，完整矩阵开放','0.5.5 实际原生右 Side Panel、PKCE、拖入/粘贴真实上传通过；完整文件/浏览器矩阵未宣称完成。'),
 '21':('新增管理功能已验证，完整矩阵开放','运行就绪视图与不可重写的角色验收台账上线；新增/批量撤回、权限、幂等和审计有本轮证据。'),
 '24':('已补准确就绪视图，生产资格开放','真实服务、Office、模型和依赖状态可检查；测试邮箱和 development 配置继续明确显示 test_only。'),
 '26':('发布回滚路径已演练，完整灾备开放','本次静态检查失败实际回滚到兼容 schema163 的旧代码并恢复健康；未据此宣称 RPO/RTO 或完整生产数据恢复达标。'),
 '27':('本轮相关统一回归通过，全产品矩阵开放','六端最终构建与本轮相关测试通过，真实端到端旅程有回执；未重跑所有历史约两千项后端测试。'),
 '29':('本轮32组及102项追溯已更新','保留194原判断、所有失败和正式验收范围，新增195覆盖层，不计算虚假的全产品完成率。'),
 '30':('主要输入与成果工作区已补齐，全面对标开放','Web 拖入/粘贴/@固定文件、任务成果/文件/活动/费用；Desktop 本机引用及原生修改；浏览器与终端全面统一体验仍待更多实测。'),
 '31':('新增页面有实际验证，全面体验矩阵开放','弹层焦点、任务结果键盘、指定宽度和暗色实测；全部页面/双语/读屏/缩放/错误状态矩阵未完成。'),
 '32':('就绪可见性已增强，运营验收开放','后台准确暴露配置/依赖状态；持续告警、值班、故障升级与长期服务水平仍须运营验证。'),
}
groups=[]
for g in old['current_open_groups']:
 g=dict(g);state,note=updates.get(g['id'],('保留194开放范围','本轮不以已有代码替代真实外部接入、专业或生产验收。'))
 g['round195_status']=state;g['round195_update']=note;groups.append(g)
requirements=[]
for item in old['requirements']:
 item=dict(item);item['round195_overlay']=[{'group':g['id'],'status':g['round195_status'],'update':g['round195_update']} for g in groups if item['id'] in g['requirements']];item['full_acceptance_reclassified_this_round']=False;requirements.append(item)
assert len(groups)==32 and len(requirements)==102
put('requirements-overlay.json',{'stage':195,'scope':'Preserve all original 102 requirements and 32 assessment groups; bounded new evidence is not full professional/production acceptance','groups':groups,'requirements':requirements})
rows=['# 195 · 32组与102项需求追溯\n','保留194原始范围。下列是本轮覆盖层，不把“未全面验收”解释成“完全没有实现”，也不将代码量换算为完成率。\n','|编号|范围|本轮状态|本轮变化与边界|','|---|---|---|---|']
for g in groups:rows.append('|'+g['id']+'|'+g['area']+'|'+g['round195_status']+'|'+g['round195_update']+'|')
rows+=['\n## 原始需求\n','|需求|模块|关联组|本轮正式验收重分类|','|---|---|---|---|']
for item in requirements:rows.append('|'+item['id']+'|'+item['module']+'|'+', '.join(g['group'] for g in item['round195_overlay'])+'|保持开放范围，不自动升级|')
(OUT/'requirements-102.md').write_text('\n'.join(rows)+'\n',encoding='utf-8')
table='\n'.join('|'+r['component']+'|'+str(r['counts']['pass'])+'|0|0|' for r in test_rows)
total=sum(r['counts']['pass'] for r in test_rows)
report=f'''# 195 · 整轮开发、真实验证与上线交付

本轮已经完成统一输入、成果工作区、后台运行就绪、角色验收台账、Linux Office 与客户端输入能力的整批开发，并发布到正式域名。执行顺序为**整批开发 → 统一构建和测试 → 汇总问题修复 → 整轮复验 → 实际部署与旅程验证**。实际旅程发现的 Office 上传格式和会话附件协议遗漏均已修复，原始失败保留。

|组件|版本|访问/交付|
|---|---|---|
|Backend|0.5.2 / schema163|https://ai-api.copypaste.hk|
|Web|0.5.1|https://agent.copypaste.hk|
|Admin|0.5.1|https://agent-dashboard.copypaste.hk/readiness|
|Desktop|0.7.5|[安装/便携版](https://agent.copypaste.hk/downloads)|
|Extension|0.5.5|[原生侧栏 ZIP](https://agent.copypaste.hk/downloads)|
|Delivery|0.5.1|本轮可复现脚本及证据|

## 本轮实际变化

- Web 会话支持文件选择/拖入、剪贴板图片及 @ 素材引用，固定所选文件版本；原始文件先归当前私人会话。发送时后台验证描述、所有权、项目、固定版本及重复请求，原子创建任务和预算预留。无授权输入不会产生半条消息或半笔任务。
- 单个任务集中查看成果、文件、受权预览/下载、活动和实际费用。继续修改保持原执行位置。任务/身份切换会丢弃旧预览与回调，网络结果不明时保留原幂等请求。
- Desktop 在本机运行真实 Codex；文件选择、拖入及获准图片副本由主进程复核目录、权限版本和身份。保持无边框、无 Electron 菜单、滚动能力和隐藏滚动条。
- Extension 继续使用实际 Chrome 原生右 Side Panel、浏览器授权和云端 Codex，新增图片粘贴和拖入反馈。
- Admin 的 `/readiness` 展示真实模型、广告连接、测试邮箱、Office、原生执行、磁盘及环境状态。`/role-acceptance` 保存任务/角色/技能/费用/交付快照；可新增、分页筛选、批量撤回，保留不可重写证据与审计。逐模型 API/key 编辑仍在原模型能力管理。
- Word/Excel/PowerPoint 在线预览使用服务器原生受限进程；源文件/运行时散列复核、宏/外链预检、资源/时间边界、父进程退出终止、临时文件清理均保留。上传三种 OOXML MIME 且验证 ZIP 文件头；预览还有独立内容预检。

## 验证证据与范围

六个仓库构建通过。本轮最终相关测试共 **{total} 项通过**，没有失败、取消或跳过；Windows Office 另保留v6/v7冷启动失败，并在最终批次改为已固定二进制和同一配置内的一次81重启。后端按改动边界选取，**不是所有历史后端测试的新一轮全跑**。

|组件|通过|失败|跳过|
|---|---:|---:|---:|
{table}

- [统一验证回执](verification.json)：包含每个构建/测试日志散列及选择范围。
- [Web/Admin 实际旅程](ui-journey.json)：真实文件/图片/Word 上传、API 服务身份下的中文 Office 预览、付费云端 Codex、成果下载散列、活动/费用、主题/指定宽度、后台新增/批次撤回。
- [Desktop 实际旅程](real-desktop-journey.json)：发布包原生 PKCE、本机完整权限、真实本机 Codex 读取文件/执行命令/写出并核对结果、真实结算及撤权。
- [Extension 实际旅程](extension-journey.json)：实际工具栏、原生右侧栏、原生浏览器授权、两份真实私人附件上传，无弹窗替代或普通页伪装。
- [部署](deployment.json)：非 root API、schema163、Linux Word/Excel/PPTX、数据库与代理主进程不变、原有模型/邮件/数据库配置不改写；原配置/回滚文件保存在服务器 `/root/cfg/workmate/integrated-195/`。
- [公开下载](public-downloads.json)：三个安装/扩展包实际完整下载散列及校验清单；同一不可变 URL 的既有成功下载可追溯至原始回执，未用 HEAD 代替文件校验。
- [最终线上核对](final-smoke.json)：v10 上重新访问既有成功任务、交付/费用、下载页及后台就绪/已撤回证据，没有重复发起付费任务。
- [运行文件一致性](runtime-equivalence.json)：付费 Web/Admin 旅程运行于 v9，最终 v10 的683份后台运行 JS/映射及 Web/Admin 产物字节相同；另做最终只读核对。Desktop 实机旅程运行于本轮较早的 v7 服务器和同一最终客户端安装包，不宣称整套真实旅程都在 v10 重跑。
- [原始失败](retained-attempts.json)：不删失败来制造全绿。首轮代理重载检查过早，已实际自动回滚并补有界就绪等待；后续切换通过。

浏览器中的粘贴/拖入使用携带真实字节的受控事件；不把它说成全部操作系统剪贴板或硬件矩阵实测。真实录制保留实际墙钟响应时间，不插入伪造结果帧。只关闭本轮自建浏览器/应用，未使用本地 Docker、WSL 或虚拟化。

## 剩余边界

本轮源码中的 TODO/FIXME/HACK/XXX 标记扫描无命中；这不等于全部商业、外部和生产条件已经实现或验收。视频/语音/Google/Meta 仍缺真实公司配置或客户授权；至少12角色及完整设计、广告分析、SEO/GEO效果仍须实际客户专业评审；完整安装/浏览器/权限/大文件/灾备/可用性矩阵仍开放。测试邮箱按用户决定保留，受信 Windows 签名按用户决定排除。不能宣称与 WorkBuddy 全面等价或全产品零错误。

[32组与102条追溯](requirements-102.md) · [机器可读覆盖层](requirements-overlay.json) · [需求](../../requirements/195-integrated-development-round.md) · [开发方案](../../development/195-integrated-workspaces-and-acceptance.md) · [194原评估](../system-assessment-194/README.md)

English: The implementation batch, selected integrated regression, real cloud/native/Side Panel journeys and deployment are recorded separately. Pinned inputs remain private and idempotent; Desktop runs Codex locally. Readiness never returns secrets and role evidence never auto-certifies professional quality. External integrations, professional acceptance and the full production/compatibility matrix remain open.
'''
(OUT/'README.md').write_text(report,encoding='utf-8')
print(json.dumps({'status':'documentation_generated','tests':total,'groups':len(groups),'requirements':len(requirements),'report':str(OUT/'README.md')},ensure_ascii=False))
