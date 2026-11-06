"""Assemble current evidence without changing historical acceptance or secrets."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,re
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev';DEL=DEV/'copypaste-delivery';OUT=ROOT/'docs/quality/integrated-round-199'
def load(p):return json.loads(p.read_text('utf-8-sig'))
def put(name,d):(OUT/name).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n','utf-8')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
OUT.mkdir(parents=True,exist_ok=True)
verification=load(DEL/'.data/integrated-199-v6/verification.json');assert verification['state']=='passed';put('verification.json',verification)
selection=load(DEL/'.data/integrated-199-v6/backend-test-selection.json');put('backend-test-selection.json',selection)
counts={};logs=[]
for check in verification['checks']:
 p=DEL/check['log'];assert sha(p)==check['sha256'];logs.append({'path':p.relative_to(ROOT).as_posix(),'sha256':sha(p),'exit_code':check['exit_code']})
 if check['phase']=='test':
  text=p.read_text('utf-8',errors='replace');n=re.findall(r'^# tests (\d+)',text,re.M);assert n,check['component'];counts[check['component']]=int(n[-1]);assert re.findall(r'^# fail (\d+)',text,re.M)[-1]=='0'
put('test-summary.json',{'stage':199,'counts':counts,'total':sum(counts.values()),'scope':'All current client suites plus selected backend risk regressions. Not the complete historical backend, professional-role, arbitrary-app or production matrix.','logs':logs})
local=load(DEL/'.data/acceptance-199/design-ui-03a1547d-7425-477b-96e0-f0600c2f0809/receipt.json');assert local['status']=='passed';put('isolated-design-journey.json',local)
journeys=[(p,load(p)) for p in (DEL/'.data/acceptance-199').glob('live-design-*/receipt.json')];passed=[(p,r) for p,r in journeys if r['status']=='passed'];assert len(passed)==1
journey_path,live=passed[0];put('live-design-journey.json',live)
reviews=[load(p) for p in (DEL/'.data/acceptance-199').glob('native-review-*/receipt.json')];qualified=[r for r in reviews if r['status']=='passed'];assert len(qualified)==1;put('native-settled-review.json',qualified[0])
source=load(DEL/'.data/acceptance-199/live-source-v3/receipt.json');assert source['status']=='passed';put('actual-cloud-source.json',source)
public_attempt=load(DEL/'.data/deployment-199-v1/public-release-v4.sanitized.json');inner=load(DEL/'.data/deployment-199-v1/inner-downloads-v1.sanitized.json');assert inner['status']=='passed'
downloads={'stage':199,'status':'partial','scope':'All three packages and checksums pass full inner HTTP downloads. Public HTTPS Setup full bytes/hash pass; Portable stalled at zero bytes for more than180 seconds and was bounded by closing only the owned browser. No full public Portable or all-public-health pass is claimed.','catalog':load(DEL/'.data/deployment-199-v1/package-receipt.private.json')['catalog'],'complete_public_downloads':public_attempt['downloads'],'public_metadata':load(DEL/'.data/deployment-199-v1/public-metadata-v1.sanitized.json'),'inner_full_http':inner,'portable_public_full':'open','bounded_cancellation':load(DEL/'.data/acceptance-199/public-download-time-bound.json')}
put('public-downloads.json',downloads);put('inner-downloads.json',inner)
deployment=load(DEL/'.data/deployment-199-v1/deployment-collected.sanitized.json');assert deployment['deployment']['backend_root'].endswith('integrated-199-v1/backend');put('deployment.json',deployment)
put('packaging.json',load(DEV/'copypaste-desktop/.data/deployment-199-v1/packaging-receipt.json'))
attempts=[]
for version in range(1,7):
 p=DEL/f'.data/integrated-199-v{version}/verification.json';d=load(p);put(f'verification-attempt-{version}.json',d);attempts.append({'attempt':version,'state':d.get('state'),'failed_checks':[{'component':c['component'],'phase':c['phase'],'log':c['log']} for c in d['checks'] if c['exit_code']]})
for name,rel in [('source-attempt-1','live-source'),('source-attempt-2','live-source-reconciled-v2')]:put(name+'.json',load(DEL/f'.data/acceptance-199/{rel}/receipt.json'))
failed_ui=[]
for p in (DEL/'.data/acceptance-199').glob('design-ui-*/receipt.json'):
 d=load(p)
 if d['status']!='passed':failed_ui.append({'receipt':p.relative_to(ROOT).as_posix(),'status':d['status'],'error':d.get('error'),'error_details':d.get('error_details')})
put('retained-attempts.json',{'stage':199,'build_and_test_attempts':attempts,'isolated_ui_failures':failed_ui,'native_readonly_review_attempts':[load(p) for p in (DEL/'.data/acceptance-199').glob('native-review-*/receipt.json')],'driver_invocation_failure':load(DEL/'.data/acceptance-199/driver-invocation-failure.json'),'public_transport_attempts':[load(DEL/f'.data/deployment-199-v1/public-release-v{v}.sanitized.json') for v in [2,3,4]],'actual_ui_attempts':[{'receipt':p.relative_to(ROOT).as_posix(),'status':d['status'],'error':d.get('error')} for p,d in journeys],'explanation':'Initial compile corrections, fixture normalization, obsolete inventory selection, unadmitted task-control row-lock retries, same-workspace selection and lost source publication classification are retained. The completed native save was reconciled with a fresh company page after the driver incorrectly read a relative URL from its consumed localhost PKCE callback; no business write was repeated. Real task submission was not repeated; its original charge is reconciled.'})
implementation=load(OUT/'implementation-batch.json');implementation['final_reviewed_source_manifest']=[{**r,'sha256':sha(ROOT/r['path'])} for r in implementation['source_manifest']]
implementation['post_integration_correction_batch']=['JSX unknown guard, Desktop native crypto and narrow aspect ratio','Normalize controlled fixture defaults and use the current test inventory','Bounded exact-key retry only before task tool admission; production locking unchanged','Selecting the current tenant no longer empties the project list','Private design publication copies only byte-validated source kind/schema, retaining original provenance without private execution bindings']
implementation['original_prebuild_snapshot_retained']=True;put('implementation-batch.json',implementation)
media=[]
for name in ['web','desktop']:
 for p in sorted((DEV/('copypaste-'+name)/'assets/screenshots').glob('*199*')):
  if p.suffix in ['.png','.gif','.mp4']:media.append({'path':p.relative_to(DEV).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)})
put('actual-media.json',{'stage':199,'files':media,'labels':'199-v2 Web is an isolated explicitly simulated functional fixture. 199-v3 Web and199-v1 Desktop are actual production clients;199-v2 Desktop is a settled read-only version3 preview review and the original real cloud source. Existing198 Admin/Extension media remains explicitly historical.'})
overlay=load(ROOT/'docs/quality/integrated-round-198/requirements-overlay.json');overlay['stage']=199;overlay['scope']='Preserves all32 groups and102 original requirements, including external, professional and production acceptance. Direct editing and selected regressions do not close the full goal.'
notes={
'08':'真实品牌矢量角色完成一次云端Codex产出，HK$0.038898；不等于19角色／50Skills全部专业验收。',
'09':'Web与最终Desktop0.7.11可直接编辑真实云端来源：画布选择／拖动／缩放／微调／对齐／复制／撤销重做、不可变保存及实际ZIP交付；补齐私人来源发布类型丢失。完整专业设计业务仍开放。',
'10':'新增文字对齐／行高、图片适配和形状描边／圆角编辑，所有变换受几何约束。字体及图表来源继续授权；完整批量、视频／特效及专业质量验收保留。',
'14':'最终0.7.11完成真实PKCE、无边框无菜单、线上工程版本接续与画布保存；全部主进程／固定Codex运行时与已验收0.7.10逐字节相同。本轮不新增本机付费执行或任意应用兼容结论。',
'15':'Setup与Portable0.7.11在/releases/199/不可变发布，三包均完成内网完整HTTP／SHA校验；公开Setup完整校验通过，Portable公网零字节停滞未完成全文件验收；Extension原0.5.7字节保留。升级故障／广泛机器矩阵仍开放；受信签名按用户要求排除。',
'18':'草稿按账户／企业／项目／工程保存于当前分页会话，8小时、2MB、最多8份；明确恢复，核对原版本／来源，服务器版本变化需确认；旧结果与不明写入不自动重放。完整断网／进程恢复矩阵保留。',
'19':'服务器预览、编辑及本地功能夹具无模型调用／账务写入；真实云端任务原单次HK$0.038898费用已核对，没有为后续编辑重复调模型。全账务组合与生产验收保留。',
'20':'草稿预览每次核对项目／原版本／最新头／共享固定素材及来源；私人源只有明确发布后可被工程选择。发布只复制已验证类型，不转移私人任务会话绑定。完整业务隐私矩阵保留。',
'22':'原始定义复制到新工程，内嵌素材仍逐次检查；草稿隔离和退出清理，存储失败有提示。源撤回与全部生命周期生产验收继续保留。',
'24':'schema163不变，候选就绪后切换199覆盖目录，原凭证不变；开发机公网出口异常使用保留原域名与TLS的独立SSH验收通道，未改产品安全策略；不能把此视为开发机直连恢复。',
'25':'预览沿用每用户1／全局2并发及每用户4／全局16等待上限，最新匹配响应才显示；非长期容量或SLA验收。',
'26':'发布前检查活动任务0，原198-v2可回退且本轮无schema变更；不等于完整新轮生产灾备演练。',
'27':f'六端构建、Desktop类型检查及{sum(counts.values())}项相关回归通过，另有隔离并发／草稿恢复和真实跨端设计／下载旅程。未重跑全部历史后端／硬件／长期生产矩阵。',
'28':'真实设计来源的一次云端Codex及实际编辑导出有证据，完整客户专业样本／成功率盲测继续开放。',
'29':'全部失败尝试、32组／102条需求及外部缺口保留，没有因零TODO标记或本轮通过而缩小验收范围。',
'30':'Web／Desktop统一画布、服务器真实未保存预览、版本与交付接续；并发旧版本拒绝，恢复需明确确认。与WorkBuddy的完整交互同任务盲测尚未完成。',
'31':'新版画布键盘操作、浅深色及375／768／1024／1440宽度检查；保留品牌样式，无页面横向溢出。完整可访问性／操作系统／跨应用矩阵继续开放。'}
for g in overlay['groups']:
 g['round199_update']=notes.get(g['id'],'沿用198状态及原验收范围；本轮没有以无代码变更自动判定完成。');g['round199_full_acceptance_closed']=False
by_id={g['id']:g for g in overlay['groups']}
for req in overlay['requirements']:
 req['round199_overlay']=[{'group':g,'update':by_id[g]['round199_update'],'full_acceptance_closed':False} for g in req.get('current_group_references',[])];req['full_acceptance_reclassified_this_round']=False
assert len(overlay['groups'])==32 and len({r['id'] for r in overlay['requirements']})==len(overlay['requirements'])==102;put('requirements-overlay.json',overlay)
def cell(v):return str(v).replace('|','／').replace('\n',' ')
lines=['# 199 · 全部原始需求追溯','', '保留32组、102条全部原始要求。以下为本轮增量证据，原验收范围仍见JSON；没有改写历史结论或新增整体完成率。','', '| 编号 | 范围 | 本轮进展与边界 |','| --- | --- | --- |']
lines += ['| '+g['id']+' | '+cell(g['area'])+' | '+cell(g['round199_update'])+' |' for g in overlay['groups']]
lines += ['', '| 原始要求 | 模块 | 对应组 | 本轮完整验收关闭 |','| --- | --- | --- | --- |']
lines += ['| '+r['id']+' | '+cell(r['module'])+' | '+','.join(r.get('current_group_references',[]))+' | 否；保留原范围 |' for r in overlay['requirements']]
(OUT/'requirements-102.md').write_text('\n'.join(lines)+'\n','utf-8')
(ROOT/'docs/development/199-direct-design-editing.md').write_text('''# 199 · 直接设计编辑与交付协议

浏览器与Desktop渲染层共用同一交互模型；Desktop保持本机Codex和原生权限模型。选取已交付、明确发布的共享矢量／简报来源，创建工程后可选择、拖动、缩放、方向键微调、对齐、复制图层及撤销重做。文字、图片与形状编辑受既有几何、字体、品牌和证据约束，未保存输入由真实服务器渲染器预览。

POST /v1/tenants/:tenant/projects/:project/editable-projects/:id/draft-preview要求expected_version、source_version及input，page默认1。读取当前项目权限、当前头、可用原版本与固定共享素材，重新校验输入；返回最大960px PNG、字节数及SHA-256、输入哈希、工程与版本标识。Cache-Control:no-store；不产生工程版本、资产、幂等回执、模型调用或账务写入。沿用有界渲染队列，每用户1／全局2并发，每用户4／全局16等待。客户端防抖450ms，并用取消、序号与完整请求签名拒绝迟到预览；草稿变化后不显示旧图。

变换限制在画布和描边边界，图表保留最小360×230，矩形圆角受缩放约束。撤销最多30步并受2MB序列化上限约束。会话草稿按用户／企业／项目／工程存储，保留原版本与所见服务器头，8小时、2MB、最多8份；退出清理，存储拒绝和损坏安全处理。刷新或切换后明确恢复，版本变化时需先确认；恢复前服务端复查来源，保存仍使用原幂等／版本协议。结果不明的操作保留原请求，不自动创建新任务。交付只针对当前已保存版本。

真实云端链路揭示私人任务来源发布时丢失类型。本轮发布前验证实际JSON、schema、kind、data_mode和规范化输入哈希，只复制设计类型和schema到新共享版本；原出版来源链继续记录，私人任务／会话与执行绑定不复制。设计工具也会标记普通manifest，其实际schema不匹配时仍是普通文件。已有不完整发布版本保持不变，用户可从原文件重新明确发布；不偷偷改写旧版本或重新生成收费内容。

生产任务控制锁不变。受控测试运行器只对工具尚未获准执行的TASK_CONTROL_CHANGING/409使用同一参数及请求键进行最多7次25ms重试；暂停、结果未知及上游错误均不因此重试。

```mermaid
flowchart LR
 A[云端Codex交付] --> B[明确发布源文件]
 B --> C[选择共享来源创建工程]
 C --> D[画布与有界草稿]
 D --> E[当前权限与真实预览]
 E --> F[保存不可变版本]
 F --> G[生成并下载真实交付包]
 D --> H[刷新或并发变更]
 H --> I[核对来源并明确恢复]
 I --> D
```

[需求](../requirements/199-direct-design-editing-round.md) · [证据及边界](../quality/integrated-round-199/README.md)

English: Web and Desktop implement the same constrained direct-editing model, authorized deterministic unsaved previews, bounded account/scope-specific session drafts, explicit conflict recovery and immutable saved delivery. Publication preserves only validated source classification and original provenance, without transferring private execution bindings. The real cloud task is reconciled once; subsequent editing never invokes another model. Production locking and Desktop local Codex remain unchanged. Selected regression and transport-assisted journeys do not establish full professional or production acceptance.
''','utf-8')
(ROOT/'docs/changes/199-direct-design-editing.md').write_text(f'''# 199 · 直接画布、草稿恢复与真实来源交付

Web／Backend0.5.7、Desktop0.7.11、Delivery0.5.6。Admin0.5.2和Extension0.5.7保留版本与已有功能；Extension发布字节保持不变。

新增画布拖动／缩放／微调／对齐／复制／撤销重做，文字／图片／形状细节，真实未保存预览，范围隔离的有界草稿与并发恢复。修复重复选择当前企业清空项目列表、私人设计源文件发布后无法被画布识别。只有保存的当前版本能交付。

先完成完整代码包，再统一构建和回归；{sum(counts.values())}项相关检查通过。隔离功能旅程验证实际PNG、版本冲突、恢复及ZIP；真实云端Codex产生源文件，单次HK$0.038898，真实Web／最终Desktop完成接续及下载。公网验收使用保留原域名／TLS的独立SSH出口，不能据此认定开发机直连已恢复。所有原失败、32组／102条要求及未完成验收保留。

[交付](../quality/integrated-round-199/README.md) · [开发](../development/199-direct-design-editing.md) · [完整范围](../quality/integrated-round-199/requirements-102.md)

English: Ships constrained direct design editing, authorized unsaved previews, scoped draft recovery and immutable cross-client delivery. Fixes source publication classification and current-workspace re-selection. Six builds and{sum(counts.values())} selected regressions pass with isolated and real client evidence. External services, full specialist/production acceptance and direct development-machine network qualification remain open.
''','utf-8')
(OUT/'README.md').write_text(f'''# 199 · 直接设计编辑整批交付

本轮增加从真实Codex成果继续编辑的直接画布、服务器未保存预览、会话草稿恢复、版本冲突确认和实际交付包。私人源文件需要用户明确发布，发布过程中保留已验证类型，修复“已生成却无法选择继续编辑”的断点。Web与Desktop共用交互；Desktop仍在客户电脑本机运行Codex。

| 项目 | 本轮证据 |
| --- | --- |
| 构建与回归 | 六端构建、Desktop主进程／渲染类型检查、{sum(counts.values())}项相关测试；[汇总](test-summary.json)，后端为选定风险回归 |
| 本地功能旅程 | 原生PostgreSQL、实际服务器／构建Web及真实渲染／导出，夹具明确为模拟；覆盖拖动／缩放／撤销、刷新恢复、真实并发头冲突和版本4ZIP；[回执](isolated-design-journey.json) |
| 真实云端 | 原任务{source['task_id']}由实际云端Codex生成源文件，单次HK$0.038898，原任务与费用核对后未重复调模型；[回执](actual-cloud-source.json) |
| 真实Web／Desktop | 线上来源选择、实际保存／导出，最终0.7.11真实PKCE、无边框无菜单、同工程v2→v3及无横向／根滚动条；全部主进程／固定运行时与原已验收包相同；[回执](live-design-journey.json) |
| 部署与下载 | schema163，候选就绪及活动任务0后上线199；凭证不变，数据库／代理进程不变。三个包完成内网全文件HTTP／SHA校验，公开Setup全文件通过；Portable公网取件零字节停滞，保留未完成状态及其他公开元信息结果；[部署](deployment.json)、[下载与公网敞口](public-downloads.json) |
| 失败与范围 | [全部保留尝试](retained-attempts.json)、[102条与32组](requirements-102.md)，没有清除历史失败或按本轮通过关闭全部验收 |

浏览器公网验证使用独立SSH CONNECT出口，Electron使用本次隔离实例的原域名SNI透传；保留原HTTPS、证书及产品鉴权，不替换响应或模型，不修改公司服务／Cloudflare规则。开发机直接公网连接此前超时，服务器部分外网请求出现1010拒绝，原因尚未由转发／网络管理侧确定。本轮通过的通道不能被称为开发机直连恢复。

Web0.5.7／Backend0.5.7／Desktop0.7.11／Delivery0.5.6；Admin0.5.2和Extension0.5.7没有虚增版本。下载入口为[产品下载页](https://agent.copypaste.hk/downloads)，不可变文件位于/releases/199/；受信Windows签名按用户要求排除。

真实视频、语音、Google／GA4／Search Console／Meta等服务配置、全部专业角色样本、任意本机应用与机器矩阵、长期负载／灾备／生产验收、与WorkBuddy同任务盲测继续开放。测试邮箱按既有要求保留。本轮不是整体goal完成证明。

[需求](../../requirements/199-direct-design-editing-round.md) · [开发](../../development/199-direct-design-editing.md) · [更新](../../changes/199-direct-design-editing.md) · [全部JSON范围](requirements-overlay.json) · [实际素材哈希](actual-media.json)

English: This batch adds direct editing, authorized no-model draft previews, bounded scoped drafts, explicit conflict recovery and immutable delivery from an actual cloud Codex source. Six builds and{sum(counts.values())} selected checks pass. Isolated fixture evidence is clearly distinguished from deployed Web/final packaged Desktop journeys and full inner HTTP downloads plus verified public Setup bytes over owned original-TLS SSH egress; the public Portable download remains open. Failures, all102 original requirements and external/professional/production acceptance remain. Desktop Codex stays local; the overall goal is not marked complete.
''','utf-8')
print(json.dumps({'status':'documented','tests':sum(counts.values()),'groups':32,'requirements':102,'media':len(media),'actual_journey':str(journey_path)}))
