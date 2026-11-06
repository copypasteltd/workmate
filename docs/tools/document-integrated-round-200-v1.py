"""Bind the complete round to actual evidence while preserving full original scope."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,re
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';DEL=DEV/'copypaste-delivery';OUT=ROOT/'docs/quality/integrated-round-200'
def load(p):return json.loads(p.read_text('utf-8-sig'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(name,value):(OUT/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n','utf-8')
OUT.mkdir(parents=True,exist_ok=True)
put('preflight.json',load(DEL/'.data/deployment-200-v2/preflight.sanitized.json'))
put('company-entry.json',load(DEL/'.data/deployment-200-v1/company-entry.sanitized.json'))
transport=load(DEL/'.data/acceptance-200/transport-v1/receipt.private.json');closed=load(DEL/'.data/acceptance-200/transport-v1/closed.json');assert closed['listeners_closed']
put('qa-transport.json',{'stage':200,'scope':'Only exact company destinations through pinned authenticated SSH; original TLS and certificates, no response/model replacement or server changes. Does not qualify development-machine direct connectivity.','hosts':transport['hosts'],'tls_termination':transport['tls_termination'],'response_replacement':transport['response_replacement'],'server_services_changed':transport['server_services_changed'],'owned_listeners_closed':closed['listeners_closed']})
v=load(DEL/'.data/integrated-200-v4/verification.json');assert v['state']=='passed';put('verification.json',v)
put('backend-test-selection.json',load(DEL/'.data/integrated-200-v4/backend-test-selection.json'))
counts={};logs=[]
for c in v['checks']:
 p=DEL/c['log'];assert sha(p)==c['sha256'];logs.append({'path':p.relative_to(ROOT).as_posix(),'sha256':sha(p),'exit_code':c['exit_code'],'reused_from_byte_unchanged_component':c.get('reused_from_unchanged_source',False)})
 if c['phase']=='test':
  s=p.read_text('utf-8',errors='replace');counts[c['component']]=int(re.findall(r'^# tests (\d+)',s,re.M)[-1]);assert re.findall(r'^# fail (\d+)',s,re.M)[-1]=='0'
put('test-summary.json',{'stage':200,'counts':counts,'total':sum(counts.values()),'scope':'Six final builds/types and changed Web49/Desktop308 cases are newly replayed after the complete status correction. Byte-unchanged backend143/Admin22/Extension93/Delivery16 assertions retain their original round200 execution and hashes. Original backend launcher exit1 and actual cleanup recovery remain. Not every historical backend, professional role, external integration or production test.','logs':logs})
local=load(DEL/'.data/acceptance-200/design-production-3ef678c9-1edc-4f50-aa1d-7c50bfd7064a/receipt.json');assert local['status']=='passed';put('isolated-production-journey.json',local)
journeys=[(p,load(p))for p in (DEL/'.data/acceptance-200').glob('live-production-*/receipt.json')];passed=[d for p,d in journeys if d['status']=='passed' and 'final packaged0.7.13' in d['scope']];assert len(passed)==1;live=passed[0];put('live-production-journey.json',live)
put('initial-deployment.json',load(DEL/'.data/deployment-200-v1/deployment-collected.sanitized.json'))
put('initial-inner-downloads.json',load(DEL/'.data/deployment-200-v1/inner-downloads-v1.sanitized.json'))
deployment=load(DEL/'.data/deployment-200-v2/deployment-collected.sanitized.json');assert deployment['deployment']['backend_root'].endswith('integrated-200-v2/backend');put('deployment.json',deployment)
package=load(DEV/'copypaste-desktop/.data/deployment-200-v2/packaging-receipt.json');assert package['status']=='passed';put('packaging.json',package)
put('release-metadata-validation.json',load(DEL/'.data/deployment-200-v2/release-metadata-validation.json'))
inner=load(DEL/'.data/deployment-200-v2/inner-downloads-v2.sanitized.json');assert inner['status']=='passed';put('inner-downloads.json',inner)
public=load(DEL/'.data/deployment-200-v2/public-release-v2.sanitized.json');assert public['status'] in ['passed','partial','failed'];catalog=load(DEL/'.data/deployment-200-v2/package-receipt.private.json')['catalog']
stream=load(DEL/'.data/deployment-200-v2/public-stream-v3.sanitized.json');assert stream['status'] in ['passed','partial','failed'] and stream['owned_browser_closed'];put('public-stream-bytes.json',stream)
observed_public={r['name']:(r['bytes'],r['sha256']) for r in public['downloads'] if r['status']=='passed' and r.get('full')==200}
observed_public.update({r['name']:(r['bytes'],r['sha256']) for r in stream['downloads'] if r['status']=='complete_verified' and r.get('http')==200})
expected_public={r['name']:(r['bytes'],r['sha256']) for r in load(DEL/'.data/deployment-200-v2/package-receipt.private.json')['public_files']}
public_bytes_passed=observed_public==expected_public
put('public-downloads.json',{'stage':200,'status':public['status'],'all_four_public_file_bytes_verified':public_bytes_passed,'catalog':catalog,'public_https':public,'independent_public_stream_bytes':stream,'inner_full_http':inner,'scope':'Actual whole-file inner HTTP downloads are independently qualified. Public original-TLS results retain each bounded health/metadata/full-file success or failure, including original link-click download-event timeouts. Independent full-body fetch checks public byte transport without upgrading the missing browser download UI event to acceptance. Direct development-machine connectivity remains outside this result.'})
attempts=[]
for n in [1,2]:
 d=load(DEL/f'.data/integrated-200-v{n}/verification.json');put(f'verification-attempt-{n}.json',d);attempts.append({'attempt':n,'state':d.get('state'),'failed_checks':[{'component':c['component'],'phase':c['phase'],'log':c['log']}for c in d['checks']if c['exit_code']]})
put('verification-reconciliation-3.json',load(DEL/'.data/integrated-200-v3/verification.json'))
put('owned-cleanup-recovery.json',load(DEL/'.data/integrated-200-v3/owned-cleanup-recovery.json'))
put('retained-attempts.json',{'stage':200,'build_test_attempts':attempts,'initial_backend_failures':{'native_database_still_recovering':45,'fixture_expected422_but_actual_validation_contract400':2},'final_cleanup_recovery':v['cleanup_recovery'],'isolated_ui_attempts':[{'path':p.relative_to(ROOT).as_posix(),**load(p)}for p in (DEL/'.data/acceptance-200').glob('design-production-*/receipt.json')],'live_ui_attempts':[{'path':p.relative_to(ROOT).as_posix(),**d}for p,d in journeys],'explanation':'All product source was complete before the first build. Initial native recovery failures and incorrect validation assertions were collected together; version2 adds actual SELECT1 readiness and checks the existing400/VALIDATION_ERROR contract. All143 backend assertions passed, but one recorded worker PID was observed present by the post-test reclaimer; the launcher correctly returned1. Its later absence does not prove whether the earlier observation was the original worker or a reused PID. New final qualification v3 preserves that exact exit/log/result, verifies all product source bytes unchanged, confirms original owners exited and checks every owned directory actually absent after bounded cleanup. It is not a claimed backend test rerun. The first UI driver matched equal spend and CPA values ambiguously; a new driver identifies the actual spend rows. Actual production review then found a misleading unsaved label after a successful save. A complete four-file Web/Desktop correction precedes all final builds and both renderer suite replays; unchanged component assertions retain their original runs and hashes. Executed original files and failed receipts remain.'})
original_implementation=load(OUT/'implementation-batch.json');implementation={'stage':200,'original_prebuild_manifest_sha256':sha(OUT/'implementation-batch.json'),'original_prebuild_snapshot_retained':True,'final_reviewed_source_manifest':[{**r,'bytes':(ROOT/r['path']).stat().st_size,'sha256':sha(ROOT/r['path'])}for r in original_implementation['production_source_files']],'post_integration_product_corrections':['Bind canvas status and image description to actual editor dirty state; the preview operation returning saved=false does not imply the project is unsaved. Complete four-file correction before unified rebuild and renderer replay.'],'verification_driver_corrections':['Query database readiness before the unified test batch','Use the established400 validation error contract without changing product behavior','Disambiguate identical spend/CPA values in the actual chart picker']};put('final-source-manifest.json',implementation)
media=[]
for name in ['web','desktop']:
 for p in sorted((DEV/('copypaste-'+name)/'assets/screenshots').glob('*200*')):
  if p.suffix in ['.png','.gif','.mp4']:media.append({'path':p.relative_to(DEV).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)})
put('actual-media.json',{'stage':200,'files':media,'labels':'Web200-v2 uses explicitly simulated isolated campaign data with real UI/rendering/downloads. Web200-v1/Desktop200-v1 are the initial actual0.5.8/0.7.12 deployment; Web200-v3/Desktop200-v2 are final0.5.9/0.7.13 actual clients; any retained failed attempt is identified by its receipt. Admin/Extension198 media remains historical, not a new200 operation.'})
overlay=load(ROOT/'docs/quality/integrated-round-199/requirements-overlay.json');overlay['stage']=200;overlay['scope']='All32 groups and102 original requirements remain. Current code/selected tests do not replace external, professional, production or whole-product acceptance.'
notes={
 '08':'19预设角色及50Skills原范围保持。本轮加入六种直接制作版面，不把版面数量当角色专业验收。',
 '09':'Web与Desktop补齐六种模板开工、共享PNG加入／替换、同口径图表证据选择、新增空白页、全部页面原子尺寸适配；真实版本／预览／交付协议接续。完整专业设计业务仍开放。',
 '10':'版面支持256–1920px整份适配，字体／描边／圆角及图表最小尺寸逐项约束，失败整次拒绝；不将现有文字／形状／页面排序重复计作新增。完整批量、字体、视频／特效业务继续验收。',
 '11':'实际分析源发布先核对计算摘要与字节，图表保留精确值／缺失原因和来源；无关负变化不阻断合法花费图，禁止跨指标／帐户／币种／时区／期间／归因混图。真实投放平台尚需原授权。',
 '14':'最终Desktop0.7.13完成真实PKCE、无边框／无菜单与Web工程v2→v3接续；主进程／固定Codex运行时对照0.7.12逐字节相同并保留此前原生验收链。未重复收费本机任务或关闭任意应用／机器矩阵。',
 '15':'新Setup／Portable0.7.13及原Extension0.5.7字节在/releases/20002/发布；三包与校验文件内网完整HTTP／SHA通过。公网整文件独立字节结果及原浏览器点击下载事件超时分别保留，不把文件校验当全部下载体验验收。受信签名仍按用户要求排除。',
 '18':'新增图层与全页适配沿用原30步撤销、2MB／8小时／8份会话草稿和明确恢复；原版本冲突、失权／撤回仍由服务器拒绝。完整离线／进程恢复矩阵保留。',
 '19':'模板／人工编辑／草稿预览／导出不产生模型费用；隔离完整旅程模型请求0、账务0。线上未新建模型任务，原真实云任务费用核对不变；全账务组合和生产验收继续。',
 '20':'素材列表只查当前项目／当前环境共用有效版本；详情按精确SHA重新查权，私人分析必须明确发布且只复制可验证分类，不转移私人执行绑定。完整后台权限／内容矩阵保留。',
 '22':'图片／证据仍引用固定版本，原来源撤回／隔离保护全部衍生；资源分页不把原始私人会话变成共享目录。完整生命周期生产验收保留。',
 '23':'实际隔离16MB可编辑ZIP与线上ZIP完整下载；新发布客户端三包及校验文件内网全文件SHA通过。公网字节与浏览器下载事件分别记录，大文件／全浏览器长期矩阵继续。',
 '24':'schema163不变，200候选就绪及活动客户任务0才切换；原app/migration凭证、数据库与代理进程保留。服务器普通网页探测外层403/1010保留，不当成产品就绪或公开浏览器结论。',
 '25':'素材每页20、证据每页64／最多12800，PNG10MiB／分析4MiB，沿用有界渲染；本轮不是压力／长期容量与SLA验收。',
 '26':'保留200-v1及199-v1可回退、旧下载及候选校验；本轮无schema迁移，不声称新增完整生产灾备演练。',
 '27':f'六端构建、Desktop类型、{sum(counts.values())}项相关回归，以及实际隔离与线上Web／最终Desktop旅程。不是全部历史后端、专业角色、硬件或长期生产矩阵。',
 '28':'实际可编辑版面、精确证据图与交付有功能证据；本轮不重复付费生成，不代表真实客户完整设计／营销成功率或WorkBuddy同任务盲测。',
 '29':'所有失败版本、32组／102条原始要求和未验证边界保留。源码没有TODO标记不作为全部应用已完成证明。',
 '30':'统一Web／Desktop的模板→素材→页面→草稿→不可变版本→实际交付，原本机Agent和云端执行位置保留。完整WorkBuddy体验差距仍按真实样本评估。',
 '31':'新模板和素材面板沿用品牌、浅深色及可折叠工具结构，375／768／1024／1440无页面横向溢出；完整可访问性与跨机器矩阵保留。'}
for g in overlay['groups']:g['round200_update']=notes.get(g['id'],'沿用原199记录及完整要求；没有本轮新证据的外部／专业／生产要求不自动关闭。');g['round200_full_acceptance_closed']=False
byid={g['id']:g for g in overlay['groups']}
for r in overlay['requirements']:r['round200_overlay']=[{'group':g,'update':byid[g]['round200_update'],'full_acceptance_closed':False}for g in r.get('current_group_references',[])];r['full_acceptance_reclassified_this_round']=False
assert len(overlay['groups'])==32 and len(overlay['requirements'])==len({r['id']for r in overlay['requirements']})==102;put('requirements-overlay.json',overlay)
def cell(v):return str(v).replace('|','／').replace('\n',' ')
lines=['# 200 · 全部原始需求追溯','','32组、102条原始要求全部保留。以下为本轮增量，不新增缺乏证据的整体完成率。','','| 编号 | 范围 | 本轮进展与验收边界 |','| --- | --- | --- |']
lines+=['| '+g['id']+' | '+cell(g['area'])+' | '+cell(g['round200_update'])+' |'for g in overlay['groups']]
lines+=['','| 原始要求 | 模块 | 对应组 | 本轮完整验收关闭 |','| --- | --- | --- | --- |']
lines+=['| '+r['id']+' | '+cell(r['module'])+' | '+','.join(r.get('current_group_references',[]))+' | 否；保留原范围 |'for r in overlay['requirements']]
(OUT/'requirements-102.md').write_text('\n'.join(lines)+'\n','utf-8')
public_status='全部本轮公开检查通过'if public['status']=='passed'else'公开实际链接下载事件仍有超时，逐项保留；三包与校验文件公网完整字节／SHA核对为'+str(public_bytes_passed)
readme=f'''# 200 · 完整设计制作与可核对交付

本轮按“完整代码批次→全端统一构建／回归→实际页面联调→整批调试复验→打包上线”交付。新增六种中英版面、固定共享图片加入／替换、精确数据图表选择、新空白页与全部页面尺寸原子适配，贯通原草稿、撤销、不可变版本和真实文件交付。Desktop保持客户本机Codex、原生权限、无边框及无Electron菜单。

| 内容 | 实际证据 |
| --- | --- |
| 统一构建／回归 | 六端最终构建、Desktop主进程／渲染类型、{sum(counts.values())}项相关断言；状态修正后重新执行Web49／Desktop308，未变组件按摘要沿用本轮原断言与回收证据；[汇总](test-summary.json)，不称全部再次执行 |
| 完整隔离旅程 | 原生PostgreSQL、真实Web／服务器／渲染／ZIP。明确模拟营销数据，实际图片与同口径12.34567800／7.00000000图表、新页、全页适配、版本2、16MBZIP；请求0／账务0；[回执](isolated-production-journey.json) |
| 实际线上／客户端 | 原域名真实HTTPS、新模板工程、版本2及实际ZIP，最终Desktop0.7.13新PKCE／无菜单／无边框、同工程版本3可回Web读取；主进程与固定Codex字节同原包；保存提示区分真实已保存版本／未保存草稿；[回执](live-production-journey.json) |
| 部署／下载 | schema163、候选就绪及活动任务0，原凭证及DB／代理进程不变；全部三包和校验文件内网完整HTTP／SHA通过；{public_status}；[部署](deployment.json)、[逐项下载结果](public-downloads.json)、[独立公网整文件](public-stream-bytes.json) |
| 保留失败 | 首次45项数据库启动恢复失败和2项状态码预期错误；查询就绪后统一复验。143项断言通过后回收器因一项进程存活检查返回1，原状态保留，V3核对进程结束及15份目录实际回收；不冒称再次执行143项。首次UI选择器混淆同值spend／CPA，新驱动明确指标；[原尝试](retained-attempts.json)、[实际回收](owned-cleanup-recovery.json) |
| 原始范围 | [32组／102条](requirements-102.md)、[完整JSON](requirements-overlay.json)；不以本轮通过或TODO0关闭全部应用验收 |

Backend0.5.8／Web0.5.9，Desktop0.7.13，Delivery0.5.7；Admin0.5.2及Extension0.5.7保持原产品版本。下载位于[产品下载页](https://agent.copypaste.hk/downloads)及不可变/releases/20002/，旧版本保留。Windows受信签名依用户要求排除；插件为可加载解压ZIP，未声称Chrome商店上架。

真实视频／语音、Google／GA4／Search Console／Meta等外部凭证，全部19角色／50Skills专业样本、完整机器／任意应用／长稳／生产／灾备矩阵和WorkBuddy同任务盲测继续开放。测试邮箱按用户要求保留。服务器普通HTTP客户端外网探测403/1010与真实浏览器结果分别记录，未改变防护或替换响应；本轮SSH原域名TLS验收不证明开发机直连恢复。本轮浏览器、Desktop、原生数据库与临时传输均已关闭；数据库完成checkpoint并保留数据，清理脚本因已消失的别名父目录返回1，后续只读核对实际进程／路径已回收，保留原失败于[runtime-cleanup.json](runtime-cleanup.json)。

[需求](../../requirements/200-design-production-round.md) · [开发](../../development/200-design-production.md) · [更新](../../changes/200-design-production.md) · [实际素材与哈希](actual-media.json)

English: The complete code batch precedes unified builds/tests and actual UI integration. Six layouts, fixed image/evidence resources, exact compatible charts, new pages and atomic whole-document resizing connect to deterministic previews, immutable versions and actual delivery. Six builds and{sum(counts.values())} relevant cases pass. Isolated explicitly simulated fixtures are distinct from actual deployed Web/final packaged Desktop and independently qualified inner/public downloads. Original failures and all102 requirements remain; local Desktop Codex, native permissions and external/professional/production acceptance are preserved.
'''
(OUT/'README.md').write_text(readme,'utf-8')
(ROOT/'docs/changes/200-design-production.md').write_text(f'''# 200 · 设计制作整轮更新

新增六款中英矢量／简报起步版面，共享PNG固定版本预览和明确加入／替换，同口径图表原值选择、来源审核与缺失原因，新建空白页及整份作品尺寸原子适配。分析源明确发布时核对字节／计算／环境，只保留验证分类；修复负变化值连带阻断合法图表复用。保存与预览的输入大小上限统一。

Web0.5.9、Backend0.5.8、Desktop0.7.13、Delivery0.5.7，Admin0.5.2／Extension0.5.7原版本和插件原ZIP字节保留。六端构建、Desktop类型及{sum(counts.values())}相关回归通过；模拟夹具完整制作／交付与真实线上Web／最终Desktop接续有独立证据。schema163不变，原凭证、数据库及代理进程不变，保留200-v1／199回退和旧下载。

首次数据库恢复／测试预期和选择器问题以新版本驱动统一修复复验，原失败保留。公开传输逐项结果、所有102条要求及外部／专业／生产敞口见[完整交付](../quality/integrated-round-200/README.md)。没有新增付费模型任务或关闭整体goal。

English: Six real editable starters, fixed shared images and exact compatible chart facts, new slides and atomic canvas adaptation connect the existing draft/version/delivery flow. Analysis publication retains byte-validated classification; unsupported signed changes no longer invalidate usable bars. All clients build, relevant checks and real deployed/final Desktop journeys qualify the defined increment. Original attempts, immutable packages, previous deployment, unchanged credentials and complete acceptance scope remain.
''','utf-8')
print(json.dumps({'status':'documented','tests':sum(counts.values()),'counts':counts,'requirements':102,'groups':32,'public':public['status']}))
