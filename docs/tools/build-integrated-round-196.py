"""Build bounded, source-linked public evidence without private session data."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, re

ROOT=Path(__file__).resolve().parents[2]; DEV=ROOT/'dev'; DELIVERY=DEV/'copypaste-delivery'; OUT=ROOT/'docs/quality/integrated-round-196'
OUT.mkdir(parents=True,exist_ok=True)
def load(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(name,v):(OUT/name).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def ref(p):return {'receipt':p.relative_to(DEV).as_posix(),'sha256':sha(p)}
def latest(kind,passed=True):
 items=[]
 for p in (DELIVERY/'.data/acceptance-196').glob(kind+'-*/receipt.json'):
  v=load(p)
  if not passed or v.get('status')=='passed':items.append((v.get('finished_at',''),p,v))
 assert items,'Missing journey '+kind
 return max(items,key=lambda t:t[0])[1:]
public_keys=['stage','status','at','finished_at','scope','automation_boundary','checks','screenshots','recordings','recording','screenshot','server_task','task','runtime','desktop_version','app_asar_sha256','javascript_errors','owned_browser_closed','owned_windows_closed']
def journey(kind):
 p,v=latest(kind);public={k:v[k] for k in public_keys if k in v};public['source']=ref(p)
 for media in [*v.get('screenshots',[]),*([v['screenshot']] if 'screenshot' in v else [])]:assert sha(DEV/media['path'])==media['sha256'],media['path']
 for recording in [*v.get('recordings',[]),*([v['recording']] if 'recording' in v else [])]:
  for media in recording.get('files',[]):assert sha(DEV/media['path'])==media['sha256'],media['path']
 return public

verification=load(DELIVERY/'.data/integrated-196-v4/verification.json');assert verification['state']=='passed' and len(verification['checks'])==13
test_rows=[]
for c in verification['checks']:
 log=DELIVERY/c['log'];assert sha(log)==c['sha256']
 if c['phase']!='test':continue
 text=log.read_text(encoding='utf-8');counts={k:sum(map(int,re.findall(r'^# '+k+r' (\d+)\s*$',text,re.M))) for k in ['tests','pass','fail','cancelled','skipped']}
 assert counts['tests']==counts['pass'] and counts['tests']>0 and not any(counts[k] for k in ['fail','cancelled','skipped'])
 test_rows.append({'component':c['component'],'counts':counts,'log_sha256':c['sha256']})
total=sum(r['counts']['pass'] for r in test_rows);assert total==476
old_log=DELIVERY/'.data/integrated-196-v3/copypaste-platform-test.log';new_log=DELIVERY/'.data/integrated-196-v4/copypaste-platform-test.log'
old_names=set(re.findall(r'^ok \d+ - (.+)$',old_log.read_text(encoding='utf-8'),re.M));new_names=set(re.findall(r'^ok \d+ - (.+)$',new_log.read_text(encoding='utf-8'),re.M));assert len(old_names-new_names)==63
put('verification.json',{'stage':196,'scope':'Six builds, complete Desktop main/renderer type checks and selected relevant regression. Not all historical backend suites. The final Web catalog build/check is recorded separately after real package hashes were known.','result':verification,'backend_selection':load(DELIVERY/'.data/integrated-196-v4/backend-test-selection.json'),'tests':test_rows,'total_tests':total,'retained_earlier_backend':{'receipt':'.data/integrated-196-v3/verification.json','log_sha256':sha(old_log),'passes':79,'failed':1,'unchanged_successes_not_repeated_in_final_batch':63,'unrepeated_names':sorted(old_names-new_names),'failure':'An existing HTTP201 review-creation assertion expected200; corrected in the versioned final suite without changing the product HTTP contract.'}})
put('implementation-batch.json',load(DELIVERY/'.data/workspace-196/implementation-batch-v1.json'))
put('release-metadata-validation.json',load(DELIVERY/'.data/deployment-196/release-metadata-validation.json'))

# The complete workspace script retained its final selector failure. All five
# functional workspace checks passed before it; the role guide is independently
# completed, without pretending the original script was green.
p,v=latest('workspace',False);assert len(v['checks'])==5 and v.get('original_bytes_restored_as_new_version') and not v['javascript_errors']
role=journey('role-guide');assert len(role['checks'])==1
workspace={'stage':196,'status':'passed_scoped_steps','scope':'Five actual workspace checks from the retained v3 attempt plus one separately completed actual role-guide check. The original full script ended with a New task exact-name selector timeout, and remains failed. No new paid cloud task was started.','checks':v['checks']+role['checks'],'screenshots':v['screenshots']+role['screenshots'],'recordings':v['recordings'],'javascript_errors':v['javascript_errors'],'original_bytes_restored_as_new_version':True,'owned_browser_closed':v['owned_browser_closed'] and role['owned_browser_closed'],'sources':[ref(p),role['source']]}
for item in workspace['screenshots']:assert sha(DEV/item['path'])==item['sha256']
put('workspace-journey.json',workspace)
put('real-desktop-journey.json',journey('real-desktop'));put('extension-journey.json',journey('extension'));put('final-smoke.json',journey('final-smoke'))
host=load(DELIVERY/'.data/deployment-196/host-final-v1.sanitized.json');assert host['deployment']['status']=='deployed' and host['deployment']['backend_root'].endswith('integrated-196-v1/backend');put('deployment.json',host)
downloads=load(DELIVERY/'.data/deployment-196/public-release-v2.sanitized.json');assert downloads['status']=='passed' and len(downloads['downloads'])==4;put('public-downloads.json',downloads)
initial_download=load(DELIVERY/'.data/deployment-196/public-release-v1.sanitized.json');put('public-downloads-v1.json',{k:initial_download[k] for k in ['stage','status','at','health','downloads','error','finished_at']})
reconciliation=load(DELIVERY/'.data/deployment-196/owned-startup-reconciliation-v2.sanitized.json');assert reconciliation['status']=='committed_pending_readback'
native=load(DELIVERY/'.data/deployment-196/owned-native-tasks-v3.sanitized.json');abandoned='79b3fe90-269a-4c23-b4cd-cfbbee18bdb4'
assert next(t for t in native['tasks'] if t['id']==abandoned)['status']=='failed' and next(r for r in native['reservations'] if r['task_id']==abandoned)['status']=='released'
put('owned-native-accounting.json',{'stage':196,'status':'read_back','operation':reconciliation,'readback':native,'boundary':'The abandoned startup remains a failed task; its zero-request reservation is released through the existing audited highest-admin operation. The successful separate native task retains its actual HK$0.057310 charge. No unknown provider usage is declared free.'})
failures=[]
for p in sorted((DELIVERY/'.data/acceptance-196').glob('*/receipt.json')):
 v=load(p)
 if v.get('status')=='failed':failures.append({**ref(p),'error':str(v.get('error','')).split('\n')[0][:250],'checks_passed_before_failure':len(v.get('checks',[]))})
missing=[p for p in (DELIVERY/'.data/acceptance-196').glob('workspace-*') if not (p/'receipt.json').exists()]
put('retained-attempts.json',{'stage':196,'scope':'Failures, crashed execution and superseded artifacts are retained locally. Later success does not rewrite their results. Private sessions, transport headers and raw screenshots are excluded from this public summary.','journey_failures':failures,'crashed_workspace_runs':[p.relative_to(DEV).as_posix() for p in missing],'verification_directories':['integrated-196-v1','integrated-196-v2','integrated-196-v3','integrated-196-v4'],'notes':['Initial Desktop bundle import/type failures were repaired as a complete batch before repeating integrated validation.','The backend review-creation fixture expected200 instead of the existing201; the versioned fixture was corrected.','Workspace v1 used an ambiguous selector for two existing check panels; v3 scoped the task workbench. Its final New task selector was completed separately against the actual sidebar control.','Workspace v2 encountered a browser automation transport crash. An owned QA browser session exposed in that exception was revoked and verified401; browser-native response interception and first-line-only errors replaced that path.','The first native run stopped on a read-side HTTPS timeout before any model request. Its zero-request reservation was reconciled and read back; the separate second actual native task passed.','The first package upload began before its checksum sidecar existed; partial upload was never staged or activated. A new versioned upload validated all inputs.','The initial SFTP manifest create mode rejected writing; a separate manifest was completed before activation.','The first full public download probe timed out after verifying Setup; browser-native download verification completed Portable, Extension and checksums, reusing only the same immutable Setup body receipt.','The first reconciliation sign-in navigation timed out before any mutation; the second attempt used bounded navigation retries and one immutable commit.']})

old=load(ROOT/'docs/quality/integrated-round-195/requirements-overlay.json')
updates={
 '08':('新增实际角色交付指引，专业验收开放','新工作读取当前项目模板、交付格式、依赖状态及明确选用示例；不把可用模板当作客户专业合格。'),
 '14':('本机执行和预览已实测，完整对标开放','0.7.6本机Codex、任务绑定命令记录、当前文件预览及撤权拒绝通过；完整任意应用/浏览器/离线矩阵继续开放。'),
 '15':('0.7.6已发布，安装兼容矩阵开放','安装/便携文件已完成实际完整下载散列核对；本轮运行发布包。受信签名按用户决定排除。'),
 '16':('当前侧栏兼容通过，完整矩阵开放','0.5.5包未改代码，重新验证真实原生右侧栏、PKCE及两份私人附件上传。'),
 '17':('本轮Web/Admin/原生登录通过，完整矩阵开放','测试收件箱新验证码、后台TOTP、Desktop/Extension浏览器授权均有本轮实际证据；不等于全部企业身份矩阵。'),
 '18':('新增不确定保存恢复已验证，完整恢复矩阵开放','已真实保存后故意丢失响应，原键原内容核对只产生一个文件版本；本机首次启动中断仍保留失败与对账轨迹。'),
 '19':('本轮人工编辑和原生费用已核对，完整财务矩阵开放','人工编辑无模型费用；本机实际HK$0.057310结算。首次零请求测试预留经现有审计流程释放；不改写旧未知费用。'),
 '20':('新增读写边界回归通过，全业务矩阵开放','对任务/文件/来源/历史版本重新授权，项目只读、私有任务、并发头版本、回放权限及原生撤权有对应回归。'),
 '22':('新增不可变文字版本及来源核验，生命周期矩阵开放','保留原字节、BOM/换行，当前新版本使旧审阅失效；被撤回/抹除/失效来源不得借历史比较继续读取。'),
 '23':('新安装包完整下载已核对，大文件矩阵开放','当前三个客户端包及校验清单的真实字节和SHA通过，不能等同于1GiB上传/网络/存储兼容矩阵。'),
 '25':('本轮观察到连接超时，长期稳定性开放','实际浏览器与Node/Electron传输有间歇连接超时；有界只读重试完成验收，不能证明默认公网长期SLA。'),
 '27':('六构建及476最终相关测试通过，全产品矩阵开放','另保留63项未变更后端回归成功；后端v3一项断言失败经v4修复，未重跑全部历史后端测试。'),
 '29':('32组/102条保留并更新196覆盖层','不重写原始状态，不伪造完成率，失败回执、独立实测和正式验收范围分别记录。'),
 '30':('统一七标签及文字审阅已交付，完整交互开放','成果/文件/变更/执行/网页/活动/费用；云端按类型分页，本机按真实任务事件绑定。完整设计编辑器、全部角色业务和网页/应用矩阵继续开放。'),
 '31':('新工作区键盘/主题/指定宽度通过，完整体验开放','实际375/768/1024/1440宽度无横向页溢出，七标签Home/End及暗色通过；旧详情仍有重复执行区块，纳入下一整批布局精简。'),
}
groups=[]
for g in old['groups']:
 g=dict(g);state,note=updates.get(g['id'],('沿用195状态和开放范围',g['round195_update']));g['round196_status']=state;g['round196_update']=note;groups.append(g)
requirements=[]
for item in old['requirements']:
 item=dict(item);item['round196_overlay']=[{'group':g['id'],'status':g['round196_status'],'update':g['round196_update']} for g in groups if item['id'] in g['requirements']];item['full_acceptance_reclassified_this_round']=False;requirements.append(item)
assert len(groups)==32 and len(requirements)==102
put('requirements-overlay.json',{'stage':196,'scope':'Preserve original102 requirements, all32 groups and195 evidence; bounded196 implementation/qualification does not close professional or production acceptance.','groups':groups,'requirements':requirements})
rows=['# 196 · 32组与102条需求追溯\n','保留194/195范围；本轮实现、实测和正式验收分开记录。\n','|编号|范围|本轮状态|变化与边界|','|---|---|---|---|']
for g in groups:rows.append('|'+g['id']+'|'+g['area']+'|'+g['round196_status']+'|'+g['round196_update']+'|')
rows+=['\n## 原始需求\n','|需求|模块|关联组|正式验收重分类|','|---|---|---|---|']
for item in requirements:rows.append('|'+item['id']+'|'+item['module']+'|'+', '.join(g['group'] for g in item['round196_overlay'])+'|不自动升级|')
(OUT/'requirements-102.md').write_text('\n'.join(rows)+'\n',encoding='utf-8')
table='\n'.join('|'+r['component']+'|'+str(r['counts']['pass'])+'|0|0|' for r in test_rows)
report=f'''# 196 · 审阅、文字新版本与真实执行工作区

本轮计划内代码包已整批完成并上线，之后统一六仓构建、类型检查、回归、汇总修复与实机联调。没有逐模块边开发边测试。服务器运行 integrated-196-v1；原 schema163、公司模型配置、凭证和测试邮箱保持。

|组件|当前版本|入口|
|---|---|---|
|Backend|0.5.3 / schema163|https://ai-api.copypaste.hk|
|Web|0.5.2|https://agent.copypaste.hk|
|Admin|0.5.1（兼容复验）|https://agent-dashboard.copypaste.hk|
|Desktop|0.7.6|[安装/便携下载](https://agent.copypaste.hk/downloads)|
|Extension|0.5.5（同包兼容复验）|[原生侧栏下载](https://agent.copypaste.hk/downloads)|
|Delivery|0.5.2|本轮统一验证与交付工具|

## 已交付

- 同一任务集中使用成果、文件、变更、执行、网页、活动、费用七个标签；云端程序与网页按记录类型在后端分页。键盘左右键及Home/End可切换标签。
- 查看当前交付与有权访问的早期版本差异、散列和格式变化；支持受权UTF-8文字保存新版本，原字节保留。任务/交付/资产版本及原散列共同检查，并发只允许匹配的版本提交。人工编辑不调用模型、不增加模型费用，新交付需重新审阅。
- 实际保存后丢失响应时，界面冻结原内容；明确核对复用相同请求键和正文，不重复新建版本。撤权、来源失效及身份切换不能利用旧回放读取内容。
- Desktop在本机运行Codex。当前任务展示真实绑定的命令/文件/工具事件，当前文件预览独立核验本机权限；撤权后拒绝预览。保持无边框、无Electron菜单及隐藏滚动条。
- 新工作读取当前项目的实际角色模板、交付范围、服务依赖和示例；明确选用示例仅填简报，不启动或收费。角色数量来自目录。
- Desktop0.7.6安装/便携包及当前ExtensionZIP均已挂在产品下载页，真实完整下载与SHA-256核对通过。后台与侧栏完成当前部署兼容实测。

## 验证与证据

六仓构建和Desktop主进程/渲染类型检查通过，最终相关测试**{total}项通过**，零失败、取消、跳过。另保留较早批次63项未变更后端成功用例，未重复计算成最终批次；该较早批次整体曾有1项HTTP状态断言失败，最终版本已修复。**这不是全部历史后端测试或全产品矩阵重跑。**

|组件|最终通过|失败|跳过|
|---|---:|---:|---:|
{table}

- [统一验证](verification.json) · [开发先于测试的整批回执](implementation-batch.json) · [实际包散列后的Web元数据复验](release-metadata-validation.json)。
- [Web工作区与角色指引](workspace-journey.json)：真实保存、故意丢失响应、原请求核对、实际旧/新版本比较、执行/网页视图、指定宽度和暗色。完整脚本最后的入口选择器失败保留，角色步骤另行通过；未伪装成原脚本全绿。原测试文件字节已恢复为新版本。
- [Desktop发布包实机](real-desktop-journey.json)：实际PKCE、明确完整本机权限、读取本机源文件、命令执行、输出核对、HK$0.057310真实结算、任务内执行记录与撤权后拒绝预览；未替换模型或网络结果。
- [原生Extension侧栏](extension-journey.json)：真实工具栏、原生右侧栏、浏览器授权及CSV/图片私人上传。粘贴/拖入使用携带真实字节的受控事件，不宣称所有系统剪贴板或硬件矩阵。
- [部署与原生Office](deployment.json)：非root API、2687运行文件散列、原服务/凭证与兼容回滚目录；Linux真实DOCX/XLSX/PPTX、中文和宏拒绝通过。
- [公开完整下载](public-downloads.json)：三个客户端包及校验清单实际字节/散列；Setup复用同一不可变URL的[先前成功完整下载](public-downloads-v1.json)，其余由浏览器原生下载后核对。
- [最终Web/Admin核对](final-smoke.json)：当前部署访问真实既有成果/费用、下载链接、后台新验证码/TOTP登录、就绪和原验收证据。
- [本轮两次本机测试费用](owned-native-accounting.json)：首次连接中断发生于模型调用前，服务器确认零请求，其HK$2预留经现有最高管理员审计对账流程释放，任务仍为失败；第二次实际模型任务正常结算。未修改旧未知费用。
- [保留失败](retained-attempts.json)：构建/断言/浏览器工具/上传/下载/首次本机尝试均保留。一次测试工具异常涉及的自有测试会话已撤销并确认401，公开证据不含认证字段。

真实录制保留墙钟响应时间，不插入假结果帧。已关闭本轮自建浏览器、侧栏和桌面实例；未使用本地Docker/WSL/虚拟化。源码、双语说明、实际截图与GIF/MP4按各端独立仓库交付，普通推送对应分支，受保护用户文件不变。

## 明确保留的后续范围

间歇公司公网连接超时仍有本轮观测；只读有界重试后成功不能证明长期可用性。原Web详情与新工作区仍有重复执行区块，下一整批应精简。它们继续进入统一待办，不用本轮成功案例掩盖。

真实视频/语音、Google/Meta及发布授权、至少12角色的实际客户专业评审、完整设计/字体/排版/特效交付、广告口径和SEO/GEO业务效果，以及安装/离线/休眠/大文件/权限/灾备/SLA全矩阵仍开放。测试邮箱按用户决定保留；受信Windows签名按用户决定排除。完整目标继续保持进行中，不宣称与WorkBuddy全面等价、全部需求已验收或全产品零错误。

[32组/102条追溯](requirements-102.md) · [机器覆盖层](requirements-overlay.json) · [需求](../../requirements/196-workspace-completion-round.md) · [实现](../../development/196-task-review-and-native-context.md)

English: The complete implementation batch precedes integrated validation. This release adds authorized immutable text revisions and exact-request recovery, pinned comparisons, task-bound cloud/native execution views and contextual specialist guidance. Six builds, Desktop types and476 final selected tests pass;63 unchanged earlier backend successes remain separately recorded. Real native execution, billing, Side Panel, downloads and Admin compatibility have independent evidence. Original failed attempts remain. Public-route reliability, professional role outcomes, external integrations and full production/compatibility acceptance remain open.
'''
(OUT/'README.md').write_text(report,encoding='utf-8')
print(json.dumps({'status':'generated','tests':total,'groups':len(groups),'requirements':len(requirements),'report':str(OUT/'README.md')},ensure_ascii=False))
