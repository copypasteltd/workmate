"""Bind the recheck to actual sources, original receipts and bilingual handoff media."""
from pathlib import Path
from datetime import datetime,timezone
from hashlib import sha256
import json,re,subprocess

ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';D=DEV/'copypaste-delivery';P=D/'.data/acceptance-192'
Q=ROOT/'docs/quality/native-recheck-192';A=ROOT/'docs/assets/native-recheck-192';Q.mkdir(parents=True)
def load(p):return json.loads(p.read_bytes())
def digest(p):return sha256(p.read_bytes()).hexdigest()
def save(p,d):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
def write(p,s):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(s,encoding='utf8',newline='\n')
def rel(p):return p.relative_to(ROOT).as_posix()
def prepend(p,text):
 marker='<!-- native-recheck-192 -->';old=p.read_text(encoding='utf8');assert marker not in old;write(p,marker+'\n\n'+text.strip()+'\n\n'+old)

reg=P/'regression-12192ed5-ba9a-4436-80d0-c341e33af655/receipt.json';assert load(reg)['status']=='passed' and load(reg)['native_database_closed']
desktop=P/'real-desktop-632df115-dd68-40a1-91b8-8845743afda7/receipt.json';assert load(desktop)['status']=='passed'
post=P/'desktop-result-verification-fd669e61-6aa8-47d1-a461-b45dca238291/receipt.json';assert load(post)['status']=='passed' and load(post)['no_paid_replay']
cloud=P/'real-cloud-2151a1df-f43a-40e1-a235-a4d2d4129ca5/receipt.json';download=P/'cloud-download-354cfadc-0634-477d-b571-fd04c0647811/receipt.json'
assert load(cloud)['status']==load(download)['status']=='passed'
state=P/'server-evidence/final-state-v2.json';assert load(state)['status']=='passed' and load(state)['remaining_native_jobs']==[]
native=P/'server-evidence/linux-native.json';assert load(native)['status']=='passed' and len(load(native)['checks'])==8
direct=P/'direct-browser-8035f6ec-53ac-419b-8d7b-f8ef3ac97e6f/receipt.json';assert load(direct)['all_direct_reads_ok']
direct_ui=P/'direct-error-ui-7147a1f0-63f3-4ce4-8925-f0215cebd50e/receipt.json';assert load(direct_ui)['status']=='passed'
evidence=[]
def record(name,source,value=None):
 target=Q/name
 if value is None:target.write_bytes(source.read_bytes())
 else:save(target,value)
 evidence.append({'path':rel(target),'sha256':digest(target),'original_receipt_sha256':digest(source)})

for name,source in [
 ('backend-91.json',reg),('linux-native-8.json',native),('backend-deployment.json',P/'server-evidence/backend-deployment.json'),
 ('static-deployment.json',P/'server-evidence/static-deployment.json'),('final-state.json',state),('real-cloud.json',cloud),('cloud-download.json',download),
 ('native-error-before.json',P/'error-observation-a440971d-bfe3-46d9-aa11-0a66ef3c15b6/receipt.json'),
 ('native-error-after.json',P/'error-observation-e67fa2aa-d13e-40f0-b175-bee9207239db/receipt.json'),
 ('native-error-direct-ui.json',direct_ui),('direct-browser.json',direct),
 ('direct-python.json',P/'direct-public-19e7dc2e-354c-46c1-affa-32dda2a84008/receipt.json'),
 ('post-deployment-desktop-result.json',post),('actual-media.json',P/'media-receipt.json'),('owned-client-cleanup.json',P/'owned-client-cleanup.json')]:record(name,source)

def desktop_public(source):
 data=load(source);task=data.get('task',{})
 return {k:v for k,v in data.items() if k not in ['api_transport','task','backend_checkpoint']} | {
  'harness_template_checkpoint_label':data.get('backend_checkpoint'),
  'task':{k:task[k] for k in ['task_id','status','execution_location','charged_micros','error_code','client_error_code','result_origin'] if k in task},
  'transport_observation':{'requests':len(data.get('api_transport',{}).get('requests',[])),'scope':'Raw CONNECT transport preserves canonical TLS verification and application bytes; not evidence of long-term direct-route reliability.'}}
record('desktop-full-workflow-before-deployment.json',desktop,desktop_public(desktop))
failed=P/'real-desktop-f62d3a5c-b76b-49e6-88cf-3a6772bb2ff6/receipt.json';record('desktop-post-deployment-wrapper-failure.json',failed,desktop_public(failed))
test_counts={}
for component,count,label in [('web',30,'recheck-192-test-v2.log'),('admin',22,'recheck-192-test-v2.log'),('extension',89,'recheck-192-test.log'),('desktop',74,'recheck-192-controller.log')]:
 p=DEV/('copypaste-'+component)/'.data'/label;raw=p.read_text(encoding='utf8');assert re.search(r'^# pass '+str(count)+r'$',raw,re.M) and re.search(r'^# fail 0$',raw,re.M)
 test_counts[component]={'passed':count,'failed':0,'log_sha256':digest(p)}
save(Q/'client-regressions.json',{'stage':192,'components':test_counts,'note':'Final corrected test runs; earlier Vite-only bootstrap failures remain in the private attempt logs.'});evidence.append({'path':rel(Q/'client-regressions.json'),'sha256':digest(Q/'client-regressions.json')})
attempts={'stage':192,'scope':'Failed observations remain failed; QA setup errors are separate from product defects.','attempts':[
 {'type':'wrong QA owner scope','result':'404 on the first read-only probe; corrected to the actual authorized owner; no authorization bypass'},
 {'type':'new render-test bootstrap','result':'Node imported Vite-only API initialization; presenter extracted from browser bootstrap; final Web30/Admin22 pass'},
 {'type':'backend deployment preparation','result':'Missing new private parent directory stopped activation before service changes; parent created with restricted permissions'},
 {'type':'static deployment verification','result':'Immediate read saw the old worker during graceful reload; automatic rollback retained original config; v2 waits for exact new HTML hashes and passed'},
 {'type':'recording runtime','result':'Existing packaged ffmpeg was not on Playwright search path; configured project-owned browser directory; no new paid task'},
 {'type':'post-deployment Desktop wrapper','result':'Actual task succeeded and charged HK$0.055477; verifier rejected PowerShell UTF-8 BOM. Independent read-only verification confirms exact original results and server settlement. Original failed wrapper receipt retained; no paid replay.'}
]};save(Q/'attempt-history.json',attempts);evidence.append({'path':rel(Q/'attempt-history.json'),'sha256':digest(Q/'attempt-history.json')})

(A/'192-desktop-local-result.png').write_bytes((desktop.parent/'02-real-local-result.png').read_bytes())
media=[{'path':rel(p),'sha256':digest(p)} for p in sorted(A.iterdir())]
details={
 'platform':('新增独立的 client_error_code 诊断投影，覆盖 Desktop 执行回执、任务详情/列表、后台执行列表及获准支援视图。严格限制错误码长度和空白，不返回原始报告正文；费用状态、预留与租户权限保持独立。','Adds a separate bounded client_error_code to native receipts, task reads, administrator execution lists and authorized support metadata. Rejects trailing whitespace, retains source restrictions and never exposes the whole native report. Settlement and reservations keep their original authority.'),
 'web':('待对账任务同时显示费用原因与本机回报原因。真实直连浏览器核验页面、原始错误和无横向溢出；云端程序、浏览器检查和交付下载使用实际结果验收。','Reconciliation details show the billing reason and the reported local cause together. Real direct-browser checks cover the visible cause and horizontal overflow; actual cloud execution, browser checks and downloads retain independent receipts.'),
 'admin':('执行列表在原有原因栏内显示本机错误，不增加横向表格列；获准支援视图同步诊断字段，继续执行原有企业、项目和正文权限。','The execution list shows the original local cause inside the existing reason cell. Authorized support views show the same bounded metadata while retaining workspace, project and body-access controls.'),
 'desktop':('继续使用已发布的 0.7.4 本机 Codex 安装包；此次没有替换安装包。完整本机流程及撤销权限实测通过，上线后的独立实际任务也完成并结算。其验收包装器的 BOM 读取失败单独保留，原文件和任务已做只读复核，没有重跑付费任务。','Keeps the published 0.7.4 local Codex binaries unchanged. The complete native workflow and revocation passed; a separate post-deployment native task also completed and settled. Its wrapper BOM parsing failure is retained and independently checked against the unchanged result file and real task without paid replay.'),
 'extension':('保持右侧 Side Panel 与授权文件上传到云端的职责；本轮 89 项回归及构建通过。新增任务诊断为可选响应字段；本轮未重新安装扩展进行真实文件上传验收。','Retains the right-side Side Panel and authorized file upload to the cloud agent. All89 current regression checks and the build passed. Task diagnostics are additive response fields; an installed-extension upload was not requalified this round.'),
 'delivery':('新增实际模型/本机/云端、直连浏览器、下载散列、BOM 原文件复核及代码/静态页面部署工具。历史失败作为诊断保留，不应当作正常部署步骤重放。','Adds actual model/native/cloud qualification, direct-browser probes, hash-checked downloads, read-only BOM result verification, and backend/static deployment tools. Historical failures remain diagnostic records and are not a deployment replay guide.')}
for component,(zh,en) in details.items():
 repo=DEV/('copypaste-'+component);folder=repo/'assets/screenshots';folder.mkdir(parents=True,exist_ok=True)
 cause='192-admin-local-cause.png' if component=='admin' else '192-web-local-cause.png'
 for name in [cause,'192-desktop-local-result.png','192-actual-cloud-download.gif']:(folder/name).write_bytes((A/name).read_bytes())
 links='[方案 / Implementation](https://github.com/copypasteltd/workmate/blob/docs/docs/development/192-native-error-observability.md) · [复查 / Recheck](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/192-native-recheck.md)'
 images=f'![本机原始原因 / Reported local cause](assets/screenshots/{cause})\n\n![实际桌面结果 / Actual Desktop result](assets/screenshots/192-desktop-local-result.png)\n\n![实际云端下载录像 / Actual cloud download recording](assets/screenshots/192-actual-cloud-download.gif)'
 for language,text in [('zh',zh),('en',en)]:
  p=repo/('README.md' if language=='zh' else 'README.en.md');title='再次复查与错误可见性 · 192' if language=='zh' else 'Recheck and native error visibility · 192'
  scope=('本轮常规回归：后端91、Web30、后台22、扩展89、桌面控制器74；Linux原生8项通过。普通浏览器直连三域名均200，Python脚本直连仍403；不能宣称全产品零错误。12已移出，视频/音频、Google/Meta、Linux Office及完整矩阵等未选范围保留。' if language=='zh' else 'Final regressions: backend91, Web30, Admin22, Extension89, Desktop controller74; native Linux8 passed. Ordinary direct-browser GETs returned200 on all three domains; direct Python GETs returned403. This does not certify a zero-defect complete product. Item12 is excluded; unselected video/audio, Google/Meta, Linux Office and full-matrix scope remains open.')
  prepend(p,'## '+title+'\n\n'+text+'\n\n'+scope+'\n\n'+links+'\n\n'+images)

req='''# 192 · 本机失败原因与财务状态 / Native failure and financial status

本轮沿用190的02、03、04、05、07范围；12按用户要求移出。03补充验收要求：进入待对账后，本机原始失败不能被财务状态覆盖。用户任务详情、Desktop回执、后台执行列表和获准支援视图必须能取得独立的有界 `client_error_code`；`error_code` 继续说明结算/任务状态。

仅允许3至80位大写字母、数字和下划线，必须以字母开头，拒绝首尾空白和换行。仅从 failed/unknown/interrupted 本机报告读取；不得返回整个 client_report、补造历史原因、重放付费请求或将未知费用改为零。来源撤回时不返回该诊断，原租户/项目及支援正文权限继续生效。

The recheck retains02/03/04/05/07 and excludes12. A financial reconciliation reason must not obscure a saved native failure. Add a bounded client_error_code independently of error_code across authorized customer/native/admin/support reads. Never expose the whole receipt, invent old causes, replay paid work or resolve unknown costs by assumption.
'''
write(ROOT/'docs/requirements/192-native-error-observability.md',req)
dev='''# 192 · 独立本机诊断与上线方案 / Independent native diagnostics

实际旧任务 `dddcb494-42f4-4d29-80bd-9c4bd4141176` 的原始报告含 `LOCAL_CODEX_TURN_FAILED`，但用户与后台响应只有 `USAGE_RECONCILIATION_REQUIRED`。新增 `desktop-errors.ts` 统一边界验证与固定SQL投影；任务RLS和后台/支援权限仍决定可见范围。两种原因在原页面同时展示，React仅渲染受限字符串，支援视图不扩大正文权限。

```mermaid
flowchart LR
 A[Local Codex failure] --> B[Immutable native receipt]
 B --> C[Bounded client_error_code]
 D[Actual usage evidence] --> E[Task error_code and reconciliation]
 C --> F[Authorized task and administrator views]
 E --> F
 F --> G[Original cause plus financial state]
```

JS正则的美元锚点允许匹配尾换行之前的位置。上报和读取均增加精确空白/长度限制；SQL读取另拒绝所有空白。原报告、幂等散列、费用预留、原任务版本不改写。历史未上报错误保持null。

运行环境保持schema162、固定Codex和Linux原生隔离边界，无新增数据库迁移。Backend切换至 `/opt/workmate/overlays/native-recheck-192-v1/backend`；Web/Admin切换至同一目录的 `web/dist` 与 `admin/dist`。候选63079先验证，无运行客户任务时切API63073；63070/63071/63072和正式域名保持原入口。静态部署等待精确新HTML哈希生效，避免把优雅重载期间的旧工作进程误判为发布失败。

回滚：在无运行任务后移除192的API覆盖，恢复191-v4代码；从 `/root/cfg/workmate/native-192/static-v2/nginx.before.conf` 恢复本项目代理配置并校验/重载。两版均要求schema162；不恢复旧数据库、不回退账务、不改公司模型密钥。配置字节相同，数据库和代理主进程未重启。

Desktop0.7.4二进制和旧tag/release未替换。上线前完整Desktop流程通过；上线后任务630ce1e9-b6f2-4e3d-a386-3ad619bcccf9实际完成并结算HK$0.055477。验收包装器拒绝Windows PowerShell带BOM的JSON，原失败回执保留；独立只读复核对原始字节、源marker、100/40汇总、命令事件、API状态及实际金额核验通过，没有重新请求模型或执行命令。未来包装器192-v2只在读取时忽略起始UTF-8 BOM。v1回执中的backend_checkpoint沿用模板标签，192部署前后服务路径及新client_error_code响应独立证明实际上线版本。

The native cause is independent diagnostic metadata, not a financial decision. Deployment uses schema162-compatible code/static overlays, preserves credential bytes, and keeps original reservation and billing facts. Direct Chromium customer/admin views passed; Python direct public requests still received403, so public-client consistency remains a limitation.
'''
write(ROOT/'docs/development/192-native-error-observability.md',dev)
quality='''# 192 · 再次复查结果 / Recheck results

发现并修复两处遗漏：待对账遮住原始本机错误；错误码正则允许尾部换行。Backend、Web、Admin已上线。当前所选功能闭环取得下列证据；不是全产品零错误或完整业务矩阵验收。

|编号|复查范围|本轮结果|
|---|---|---|
|02|客户本机Codex、真实模型、文件/命令、实际结算|完整0.7.4流程通过；新后台上的独立本机任务成功，BOM输出经只读复核；不覆盖失败包装器回执|
|03|本机原始原因与待对账同时可见|实际旧任务修复前/后对照；用户与后台直连页面通过；未知费用状态保留|
|04|Linux程序、API、SQLite执行|实际原生检查和真实云任务通过|
|05|Linux Chromium交互、断言、截图、交付下载|8项原生检查、实际云任务及ZIP/源码/回执SHA-256核验通过|
|07|结束任务释放执行容量，保留未知费用|旧任务和请求仍待财务核对，但不占容量；同一企业新任务成功；结束后0本机残留执行组|
|12|Windows受信签名|按要求移出，0.7.4未签名手动安装包保持原样|

|最终常规检查|通过/总数|
|---|---|
|Backend针对性回归|91/91|
|Web|30/30|
|Admin|22/22|
|Extension|89/89|
|Desktop控制器|74/74|
|Linux原生运行检查|8/8|

真实云任务0106f3ed-cd7f-45ac-a3c9-417a08b7f42e费用HK$0.106047；上线前Desktop任务12a332c0-ecc3-4cf1-8f69-0ef902009566费用HK$0.040595；上线后Desktop任务630ce1e9-b6f2-4e3d-a386-3ad619bcccf9费用HK$0.055477。均为实际测试消耗，不是充值或虚构结算。实际Node与浏览器执行使用相同源码散列，下载包包含准确源码和两份原始检查回执。

普通Chromium不走QA代理直连三个正式域名均200，用户任务与后台错误页面也直连通过；同一网络Python直接GET三域名均403。两组证据均保留，不能据此宣称所有客户端或公网长期稳定。实际模型/云端/桌面付费流程使用记录中的原始CONNECT通道，TLS、模型内容和账务未替换。

未选范围继续保留：190的01公网长期一致性、06Linux Office、08视频、09音频、10Google、11Meta、13全部真实业务矩阵、14生产配置/测试邮箱边界。用户此前要求保留测试收件箱，当前仍是local_development，不宣称真实SMTP已接入。本轮未重新进行图片生成或安装版扩展上传，不用历史通过代替本轮实测。

原失败验证和部署检查见 [尝试历史](native-recheck-192/attempt-history.json)。本轮创建的浏览器/Electron、CONNECT监听和原生测试数据库均已关闭，服务器无残留执行组；未使用本地Docker/WSL/虚拟化。数据、旧费用和发布未覆盖。

The selected workflows are verified within this scope. Two additional diagnostic defects were repaired and deployed. The failed post-deployment wrapper stays failed; a separate read-only check validates the completed task and its original BOM-bearing file. Unselected integrations, the full business matrix, production mail and long-term public consistency are not accepted by this report.

[机器证据 / Machine evidence](192-native-recheck.json) · [实现 / Implementation](../development/192-native-error-observability.md)
'''
write(ROOT/'docs/quality/192-native-recheck.md',quality)
write(ROOT/'docs/changes/192-native-recheck.md','# 192 · 更新 / Changes\n\n新增独立本机失败诊断，补齐待对账场景的用户、后台和支援显示；错误码拒绝尾换行。保持财务和权限边界，部署代码/静态页面覆盖，补齐原生/真实任务、直接浏览器、实际下载、BOM原文件复核及双语README媒体证据。没有替换Desktop0.7.4包或旧冻结发布。\n\nAdds independent native diagnostics and strict error-code bounds, deploys backend/Web/Admin, and records source-bound rechecks with real media. Settlement facts, scope controls and published Desktop binaries remain independently authoritative.\n')
for name,en in [('README.md',False),('README.en.md',True)]:
 prepend(ROOT/'docs'/name,('再次复查已补齐本机原始错误显示与严格格式验证，Backend/Web/Admin补丁已上线。常规回归306项、Linux原生8项通过；实际模型任务/文件/命令/云端浏览器/下载有独立证据。原BOM包装器失败保留，原任务只读复核通过；不宣称整套产品零错误。' if not en else 'The recheck repairs native error visibility and strict validation; Backend/Web/Admin patches are deployed.306 final regressions and8 native Linux checks passed, with actual model/task/file/command/browser/download evidence. The BOM wrapper failure is retained and the original completed task independently verified; this is not zero-defect complete-product acceptance.')+'\n\n[复查 / Recheck](quality/192-native-recheck.md) · [实现 / Implementation](development/192-native-error-observability.md) · [证据 / Evidence](quality/192-native-recheck.json)')

paths={}
for branch,component in {'backend':'platform','web':'web','admin':'admin','desktop':'desktop','extension':'extension','delivery':'delivery'}.items():
 repo=DEV/('copypaste-'+component);changed=subprocess.check_output(['git','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-C',str(repo),'diff','--name-only','-z']).decode().split('\0');names={n for n in changed if n}
 names.update(p.relative_to(repo).as_posix() for p in (repo/'assets/screenshots').glob('192-*'))
 if component=='platform':names.update(['src/desktop-errors.ts','tests/desktop-errors.test.ts'])
 if component in ['web','admin']:names.update(['src/native-task-notice.tsx','src/native-task-notice-view.tsx','tests/native-task-notice.test.ts'])
 if component=='delivery':names.update(p.relative_to(repo).as_posix() for p in (repo/'scripts').glob('*192*') if p.is_file())
 paths[branch]=sorted(names)
paths['docs']=sorted(['docs/README.md','docs/README.en.md','docs/quality/192-native-recheck.json','docs/quality/192-native-recheck.md','docs/requirements/192-native-error-observability.md','docs/development/192-native-error-observability.md','docs/changes/192-native-recheck.md',*[rel(p) for p in Q.iterdir()],*[rel(p) for p in A.iterdir()],*[rel(p) for p in (ROOT/'docs/tools').glob('*192*.py')]])
sources={rel(DEV/('copypaste-'+{'backend':'platform'}.get(branch,branch))/name):digest(DEV/('copypaste-'+{'backend':'platform'}.get(branch,branch))/name) for branch,names in paths.items() if branch!='docs' for name in names}
report={'stage':192,'at':datetime.now(timezone.utc).isoformat(),'status':'selected_recheck_verified','selected_items':[2,3,4,5,7],'excluded_items':[12],'full_product_accepted':False,'product_defects_fixed':['native original failure missing from reconciling task/admin/support reads','trailing-newline error code accepted by JavaScript end-anchor'],'backend_overlay':'/opt/workmate/overlays/native-recheck-192-v1/backend','schema_version':162,'desktop_version':'0.7.4','desktop_binaries_changed':False,'final_regression_tests':306,'native_linux_checks':8,'post_deployment_desktop_wrapper_passed':False,'post_deployment_desktop_result_independently_verified':True,'unselected_open_items':[1,6,8,9,10,11,13,14],'sources':sources,'evidence':evidence,'media':media,'local_virtualization_used':False}
save(ROOT/'docs/quality/192-native-recheck.json',report);save(P/'publication-paths.json',paths)
print(json.dumps({'status':report['status'],'source_files':len(sources),'evidence_files':len(evidence),'media_files':len(media),'publication_files':{k:len(v) for k,v in paths.items()}}))
