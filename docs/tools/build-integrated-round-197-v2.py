"""Publish a bounded report from completed real receipts; never include secrets."""
from pathlib import Path
import json, hashlib, re
root=Path(__file__).resolve().parents[2]; dev=root/'dev'; delivery=dev/'copypaste-delivery'; out=root/'docs/quality/integrated-round-197'
out.mkdir(parents=True,exist_ok=True)
def load(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(n,v):(out/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
verification=load(delivery/'.data/integrated-197-v2/verification.json');assert verification['state']=='passed'
rows=[]
for c in verification['checks']:
 p=delivery/c['log'];assert sha(p)==c['sha256']
 if c['phase']=='test':
  counts={k:sum(map(int,re.findall(r'^# '+k+r' (\d+)\s*$',p.read_text(encoding='utf8'),re.M))) for k in ['tests','pass','fail','skipped','cancelled']}
  assert counts['tests']==counts['pass']>0 and not any(counts[k] for k in ['fail','skipped','cancelled']);rows.append({'component':c['component'],**counts})
assert sum(r['pass'] for r in rows)==528
put('verification.json',{'stage':197,'scope':'Six builds, Desktop main/renderer type checks and six relevant test batches; selected backend regression, not every historical test.','result':verification,'counts':rows,'total_tests':528,'backend_selection':load(delivery/'.data/integrated-197-v2/backend-test-selection.json')})
batch=load(delivery/'.data/integrated-197-v2/implementation-batch.json');assert all(sha(root/r['path'])==r['sha256'] for r in batch['source_files']);put('implementation-batch.json',batch)
allowed=['stage','status','scope','at','finished_at','checks','screenshots','screenshot','recording','recordings','server_task','task_id','runtime','desktop_version','app_asar_sha256','company_file_transfer','javascript_errors','owned_browser_closed','owned_windows_closed','unchanged_main_process','runtime_files','actual_elapsed_ms']
journeys={}
for prefix,name in [('real-desktop','real-desktop-journey'),('desktop-delta','desktop-delta-journey'),('extension','extension-journey'),('web-review','web-review-journey'),('final-smoke','final-smoke')]:
 attempts=[(p,load(p)) for p in (delivery/'.data/acceptance-197').glob(prefix+'-*/receipt.json')]
 passes=[(p,v) for p,v in attempts if v['status']=='passed'];assert passes,'Missing actual journey: '+prefix
 p,v=max(passes,key=lambda pair:pair[1].get('finished_at',''));public={k:v[k] for k in allowed if k in v}
 public['source']={'receipt':p.relative_to(dev).as_posix(),'sha256':sha(p)}
 if 'company_network' in v:
  network=v['company_network'];public['company_network']={'persistent':network['persistent'],'observed_requests':len(network['requests']),'all_cookie_free_redirect_denied':all(not r['cookie'] and r['credentials']=='omit' and r['redirect']=='error' and r['bypass'] for r in network['requests']),'errors':[{'path':r['path'],'error':r['error']} for r in network['requests'] if 'error' in r]}
 for media in [*v.get('screenshots',[]),*([v['screenshot']] if v.get('screenshot') else [])]:assert sha(dev/media['path'])==media['sha256']
 for record in [*v.get('recordings',[]),*([v['recording']] if v.get('recording') else [])]:
  for media in record.get('files',[]):assert sha(dev/media['path'])==media['sha256']
 put(name+'.json',public);journeys[name]=public
put('retained-attempts.json',{'stage':197,'scope':'Original failed attempts are retained, never relabeled.','packaging':load(dev/'copypaste-desktop/.data/deployment-197-v1/failure-receipt.json'),'journeys':[{'receipt':p.relative_to(dev).as_posix(),'sha256':sha(p),'status':load(p)['status'],'error':load(p).get('error')} for p in (delivery/'.data/acceptance-197').glob('*/receipt.json') if load(p)['status']!='passed']})
host=load(delivery/'.data/deployment-197-v2/host-final-v2.sanitized.json');assert host['deployment']['status']=='deployed';put('deployment.json',host)
downloads=load(delivery/'.data/deployment-197-v2/public-release-v1.sanitized.json');assert downloads['status']=='passed';put('public-downloads.json',downloads)
put('release-metadata-validation.json',load(delivery/'.data/deployment-197-v2/release-metadata-validation.json'))
assert journeys['real-desktop-journey']['desktop_version']=='0.7.7'
assert journeys['desktop-delta-journey']['desktop_version']=='0.7.8'
assert journeys['desktop-delta-journey']['unchanged_main_process']
assert any(v is not None and isinstance(v,int) and v>=0 for v in journeys['desktop-delta-journey']['actual_elapsed_ms'])
put('release-metadata-failure.json',load(delivery/'.data/deployment-197-v2/release-metadata-failure-v2.json'))
put('packaging.json',load(dev/'copypaste-desktop/.data/deployment-197-v3/packaging-receipt.json'))
put('owned-native-accounting.json',load(delivery/'.data/deployment-197/owned-native-tasks-v1.sanitized.json'))
put('visual-review-correction.json',{'stage':197,'discovery':'Visual inspection of the original197-v2 Web screenshot found NaNs although the first UI driver had passed. That original receipt and image remain.','qa_corrections':'Retain the timed-out public GET, the Desktop v1 Web-tab assumption and early Web loading-shell screenshots. Final drivers wait for actual execution rows before duration assertions and media capture.','cause':'Linux host receipts omit host.elapsed_ms. Use measured host time or canonical started_at/finished_at; otherwise null. All Web/Desktop duration displays reject invalid values.','validation':'Final integrated528 checks, final197-v5 loaded-record Web review and actual0.7.8 Desktop delta. No original receipt was relabeled.'})
old=load(root/'docs/quality/integrated-round-196/requirements-overlay.json');assert len(old['groups'])==32
updates={'14':'Desktop 0.7.8：隔离公司网络、本机文件真实往返、折叠执行记录及本机 Codex 实测；完整操作／应用矩阵保留。','18':'读取有限重试，写入不自动重放；有效租期心跳有限恢复；完整网络／恢复矩阵仍开放。','19':'未准入回合的零准入证明可自动释放预留；已准入和未知成本保留核账，不改写旧记录。','25':'默认公司 HTTPS 的本轮实际连接已验证；单次旅程不等于长期 SLA 或全部企业代理兼容。','27':'六端构建、主进程及渲染类型检查、528 项相关测试通过；不是全部历史用例或完整生产验收。','29':'保留全部 32 组／102 条原始要求，不以 TODO 标记为空推定目标已完成。','30':'本机指令和输出默认折叠，退出码／失败／截断明确；Web 执行面板只显示一次，完整设计编辑仍开放。','31':'指定宽度、主题与实际本机结果审阅有本轮证据；完整无障碍、应用及浏览器矩阵继续开放。'}
for group in old['groups']:group['round197_update']=updates.get(group['id'],'沿用 196 轮原状态与开放范围；本轮不以无相关代码变更自动判定完成。')
old.update(stage=197,scope='Preserve all 32 groups and 102 original requirements. Round197 evidence adds bounded connection/native-review improvements; external, professional and production acceptance remains open.');put('requirements-overlay.json',old)
trace=(root/'docs/quality/integrated-round-196/requirements-102.md').read_text(encoding='utf8')
(out/'requirements-102.md').write_text('# 197 · 完整需求追溯\n\n保留以下 196 轮的 32 组和 102 条原始记录，未改写原状态；本轮变化见 [197 覆盖层](requirements-overlay.json)。\n\n'+trace,encoding='utf8')
(out/'README.md').write_text('''# 197 · 公司连接恢复与本机结果审阅

整批代码完成后统一构建、测试，再生成实际安装包并完成真实客户端和线上验证。服务器使用 integrated-197-v2，保持 schema163。公司凭证及测试邮箱保留，未改动正在使用的数据库和代理主进程。

| 组件 | 版本 | 本轮变化 |
| --- | --- | --- |
| Backend | 0.5.5 | 未准入原生回合的持久零准入证明与预留释放 |
| Web | 0.5.4 | 统一连接错误处理，移除重复软件检查面板 |
| Admin | 0.5.2 | 统一读取恢复及不确定写入语义 |
| Desktop | 0.7.8 | 隔离 Chromium 公司连接、本机心跳与折叠记录 |
| Extension | 0.5.6 | 统一连接规则，原生右侧栏及附件实测 |
| Delivery | 0.5.3 | 统一回归、实际媒体、不可变下载和部署回读 |

[线上应用](https://agent.copypaste.hk) · [后台](https://agent-dashboard.copypaste.hk) · [客户端下载](https://agent.copypaste.hk/downloads)

六端构建和 Desktop 主进程／渲染类型检查通过；528 项相关测试通过，无失败、跳过或取消。后端选取原生启动、推理、公司工具、账务和工作区相关用例，不声称重跑全部历史矩阵。实际 Desktop 使用发布包、原公司 HTTPS、真实登录授权、私人文件上传／下载及本机 Codex；Extension 使用真正的原生右侧栏。

截图人工复核发现了 Linux 耗时缺失导致的 NaNs。197-07 整批修正后统一复验；服务端读取真实宿主耗时或原回执的规范起止时间，无法确认则返回 null，各端不显示非法耗时。原通过回执和有缺陷截图均保留。

最终 Desktop0.7.8 已用真实公司登录和现有任务完成显示差异验证；包内全部主进程 JavaScript 与原生运行时逐字节等同于本轮0.7.7真实本机闭环。0.7.7 的本机任务真实消费 HK$0.035904，原预留已结算。没有把差异验证写成0.7.8重新执行了一次付费任务。

本轮启动核账覆盖未准入回合的 unknown、失联、持久工具准入、伪报完成及并发完成／准入。只有服务端明确证明六类准入与费用／token 均为零才释放预留；已准入回合和旧未知记录保持核账。没有以自动重跑业务写入解决网络问题。

| 证据 | 文件 |
| --- | --- |
| 代码批次与检查 | [代码清单](implementation-batch.json) · [528 项检查](verification.json) |
| 实际客户端 | [Desktop 原生闭环0.7.7](real-desktop-journey.json) · [最终0.7.8及相同内核](desktop-delta-journey.json) · [Extension](extension-journey.json) · [Web 审阅](web-review-journey.json) · [Web/Admin](final-smoke.json) |
| 上线与下载 | [服务器回读](deployment.json) · [完整下载散列](public-downloads.json) · [最终元数据](release-metadata-validation.json) |
| 完整范围 | [32 组／102 条](requirements-102.md) · [本轮覆盖层](requirements-overlay.json) · [保留失败](retained-attempts.json) |

完整专业业务产出、视频／音频和广告平台外部接入、长期连接稳定性、完整兼容与生产验收继续开放。受信 Windows 代码签名按用户要求排除。不能据本轮成功宣称全部原始要求或 WorkBuddy 完整对标已验收。

English: Ships company-session transport, bounded read/heartbeat recovery, durable pre-turn zero-admission settlement and compact native review after a complete implementation batch. Six builds and 528 selected regressions pass. Actual packaged native Codex, cloud-file transfer and browser side-panel journeys are recorded. External services, professional outputs and complete production/compatibility acceptance remain open.
''',encoding='utf8')
print(json.dumps({'status':'generated','tests':528,'groups':32,'journeys':len(journeys)}))
