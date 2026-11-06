"""Write current bilingual operation notes from measured 204 receipts only."""
from pathlib import Path
import json,re
R=Path(__file__).resolve().parents[2];D=R/'dev';Q=R/'docs/quality/integrated-round-204'
load=lambda p:json.loads(p.read_text('utf-8-sig'))
assert load(Q/'verification.json')['status']=='passed'
assert load(Q/'live-production-journey.json')['status']=='passed'
assert load(Q/'controlled-tool-feedback-ui.json')['status']=='passed'
sample=load(Q/'marketing-functional-sample.json');marketing_passed=sample['status']=='passed_controlled_functional_sample'
total=load(Q/'test-summary.json')['total_qualified_cases']
evidence='https://github.com/copypasteltd/workmate/blob/docs/docs/quality/integrated-round-204/README.md'
notes={
'platform':([
'云端 Codex 工具输入校验改为有界字段反馈；不返回参数值、原异常、上游内容、密钥或堆栈。仅明确发生在业务执行前的校验失败可以在原工作／原预算内修正。未知结果不可自动重放。',
'每次工具调用保存安全结果及参考号；未恢复的图表、图片、软件包等交付失败不能被模型最终文字覆盖成成功；补充资料后的新回合继承原失败，最终任务状态再次核对，只有真实同工具完成才清除。实际成果和真实用量仍是交付及结算依据。',
'schema165 将云端45秒续租存入独立的任务／尝试／fence记录，保留原工具事务权限锁、当前授权、取消／撤权及过期围栏。模型请求恢复、音视频、付费资料检查点和私有云工作流统一使用该时效；Desktop原生认证续租保持原规则。',
'应用沿原63070／63071／63072入口发布；备份和兼容schema165的代码回退保留。Nginx、DNS、hosts、路由、防火墙及系统代理只读，原数据库／代理进程和凭证保持。'],[
'Cloud Codex tools return bounded trusted-field feedback without argument values, raw exceptions, upstream replies, keys or stacks. Only validation proven to precede business execution may be corrected within the original task and budget; unknown operations are never automatically replayed.',
'Persist safe per-call outcomes and support references. Unrecovered chart/image/package delivery failures override final completion prose. New turns after input waits inherit durable failures and canonical completion checks them again; only actual same-tool completion clears each failure. Actual artifacts and measured usage remain the delivery and accounting evidence.',
'Schema 165 stores each cloud 45-second lease independently by task/attempt/fence, preserving transaction authority locks, current authorization, cancellation/revocation and expiry fencing. Provider recovery, media, paid checkpoints and private workflows read the same deadline. Authenticated native Desktop heartbeat rules remain intact.',
'Publish through existing63070/63071/63072 entry points, retaining a database backup and forward-schema compatible code fallback. Read-only Nginx/DNS/hosts/routes/firewall/system proxies; preserve DB/proxy processes and credentials.']),
'web':([
'登录 → 选择企业与项目 → 默认助手或专业角色 → 明确固定附件版本和预算 → 持久化原请求／幂等键 → 云端Codex执行 → 审阅实际成果及费用；原完整流程保留。',
'任务页和对话成果区显示未完成步骤、静态可操作说明和安全参考号；长文字流不会冲掉当前失败。真实同工具修正后解除提示，不制造成果或抹掉已发生用量。',
'完整任务页共用一个活动连接；成果区按游标接收后续活动。保留双语／双主题、品牌色系、窄屏和无横向溢出。新下载页发布Desktop0.7.17及原字节Extension0.5.7。'],[
'Sign in → select company/project → default assistant or specialist → explicitly pin attachments/budget → persist original request/key → cloud Codex → review actual deliverables and usage. The complete existing journey is preserved.',
'Task details and conversation results show outstanding steps, safe guidance and support references. Long responses retain current failures; a recorded successful correction clears feedback without inventing files or deleting usage.',
'Share one task-activity connection in task details and follow activity cursors. Preserve bilingual dual-theme branding, narrow layouts and no horizontal overflow. Publish Desktop0.7.17 and the identical Extension0.5.7 archive on Downloads.']),
'desktop':([
'下载后采用浏览器S256授权；Codex在客户电脑本地运行。客户可明确授予并撤销完整本机权限，窗口保持无边框、无Electron自带菜单。',
'选择云端工作的审阅页使用相同安全反馈和关键活动保留；本机认证、公司API桥接、加密存储及保存功能按原生实现保留，未执行renderer:sync。',
'最终0.7.17安装／便携包核对固定Codex字节、全新原生授权、实际页面及同字节保存。受控错误界面验证与真实正式Web／最终原生Desktop旅程分别标注。'],[
'Use browser S256 authorization after download. Codex runs locally on the customer computer with explicitly granted/revocable full local permission, a frameless window and no default Electron menu.',
'Cloud task review uses the shared safe feedback/current-activity behavior. Preserve native authentication, company API bridge, encrypted storage and save implementation; do not run renderer:sync.',
'Verify final 0.7.17 setup/portable packages, pinned Codex bytes, fresh native authorization, actual UI and identical-byte saves. Distinguish controlled error UI scenarios from actual deployed Web/final native Desktop journeys.']),
'admin':([
'模型能力继续按每个模型分别管理上游地址与API Key；管理员完整用户、企业、消耗、额度／VIP、权限、批量及内容控制流程保持。最高管理员直接执行，其他角色按策略审批，保留审计。',
'本轮后台界面和业务代码未改；既有22项相关证据以原样源码沿用，不冒充新增后台全站实测。schema165变更属于云端工作授权时效，未授予管理员新的绕过权限。'],[
'Keep per-model upstream URL/API-key configuration and existing complete user/company/usage/credit/VIP/permission/bulk/content administration. Highest administrators act directly; other roles follow policy with complete audit records.',
'Admin UI/business source is unchanged. Retain 22 related cases against identical source; do not claim a new complete admin test run. Schema 165 changes cloud task liveness without adding administrator bypass authority.']),
'extension':([
'继续使用Chrome原生右侧SidePanel：登录 → 明确选择文件 → 读取确认 → 上传固定版本 → 云端Codex处理 → 审阅；保留用户文件授权边界。',
'本轮插件代码和已发布0.5.7 ZIP字节未改；既有93项相关证据按原样源码沿用。完整Chrome版本、全机器和大文件矩阵不由本轮Web／Desktop复核替代。'],[
'Retain the native Chrome right SidePanel: sign in → explicitly select files → confirm access → upload pinned versions → cloud Codex → review, preserving customer file consent boundaries.',
'Extension code and released0.5.7 ZIP bytes are unchanged. Retain 93 related cases against identical source; Web/Desktop review does not replace full Chrome/device/large-file qualification.']),
'delivery':([
'先完成842份选定扩展名的产品源码、165份迁移、计划用例和操作脚本，再统一构建与相关验证；编译／故障情境的原失败和集中修正保留。',
'真实长事务续租／过期／撤权、固定原生Codex反馈、受控界面与真实正式客户端观察分别记录。版本、文件SHA、完整下载和客户费用是独立证据。',
'仅更新应用及20401下载；复制两份原生运行时为真实目录，保留备份与兼容回退。核对9份网络文件、实时规则、凭证及DB／代理进程，普通原子推送8引用，保护27份原用户文件。'],[
'Complete842 production-source files within listed extensions,165 migrations, planned tests and operational scripts before unified validation. Preserve compilation/fault-scenario failures and collected corrections.',
'Record real long-transaction lease/expiry/revocation checks, pinned native Codex feedback, controlled UI and actual deployed client observations separately. Version/file SHA, complete downloads and actual costs are independent evidence.',
'Update only owned application paths and20401 downloads; copy two native runtime folders as real directories, retain backup/compatible fallback. Verify nine network files/live rules, credentials and DB/proxy processes; ordinary atomic eight-ref publication protects27 original user files.'])}
flows={
'platform':'A[Current scope and original budget] --> B[Independent fenced cloud lease]\n B --> C[Codex and fixed Skills]\n C --> D[Trusted input validation]\n D --> E[Actual transactional output]\n D --> F[Safe bounded failure]\n E --> G[Customer review and actual usage]\n F --> G',
'web':'A[Sign in and pin sources] --> B[Submit once with original budget]\n B --> C[Cloud Codex]\n C --> D[Retained progress and truthful result]\n D --> E[Review files and actual fees]',
'desktop':'A[Download and S256 login] --> B[Frameless local Codex]\n B --> C[Explicit revocable local permission]\n B --> D[Cloud evidence review]\n D --> E[Safe result feedback and native save]',
'admin':'A[Authenticated administrator] --> B[Current role and policy]\n B --> C[Direct highest admin or approval]\n C --> D[Audit and current user content controls]',
'extension':'A[Native right SidePanel] --> B[Explicit file consent]\n B --> C[Pinned upload]\n C --> D[Company cloud Codex]\n D --> E[Review result]',
'delivery':'A[Whole implementation batch] --> B[Unified evidence and retained failures]\n B --> C[App-only deploy and immutable downloads]\n C --> D[Read-only network verification]\n D --> E[Eight ordinary branch updates]'}
for component,(zh,en) in notes.items():
 folder=D/('copypaste-'+component);version=load(folder/'package.json')['version']
 for english in [False,True]:
  p=folder/('README.en.md' if english else 'README.md');old=p.read_text('utf-8');assert not old.startswith('<!-- integrated-round-204 -->')
  title='Safe tool feedback and durable cloud ownership' if english else '安全工具反馈与云端执行时效'
  text=f'<!-- integrated-round-204 -->\n\n## 204 · {version} · {title}\n\n[Evidence and limits / 证据与边界]({evidence}) · [Downloads / 下载](https://agent.copypaste.hk/downloads)\n\n'
  text+='\n\n'.join(f'{i+1}. {v}' for i,v in enumerate(en if english else zh))+f'\n\n```mermaid\nflowchart LR\n {flows[component]}\n```\n\n'
  text+=(f'{total} qualified related cases distinguish current tests from identical-source retention. ' if english else f'{total}项相关通过证据区分本轮执行与原样源码沿用。')
  text+=('One linked marketing sample delivered actual files. ' if marketing_passed and english else '一项关联原失败的营销样例已交付实际文件。' if marketing_passed else 'The linked marketing sample is still open; see its exact retained outcome. ' if english else '关联原失败的营销样例仍开放，详见原始结果。')
  text+=('Original102 requirements/32 groups, professional19-role/50-Skill acceptance, external media/marketing/IdP setup, long-run/device/concurrency/DR qualification and blind WorkBuddy comparison remain explicit. Original generic failure/lease root causes, default public HTTP/2 and normal DNS-address failover remain unproven; QA alone selects another current public address without changing server networking; no full-product acceptance claim.\n\n' if english else '全部102条／32组、19角色／50Skills专业验收、外部媒体／营销／IdP配置、长稳／设备／并发／灾备及WorkBuddy盲测差距继续保留。原通用错误／租约历史根因、公网默认HTTP/2及正常DNS地址故障转移未因此证明；仅本机验证选用另一个当前公网地址，服务器网络保持不变；不声明完整产品验收通过。\n\n')
  media=load(Q/'actual-media.json')['files']
  for row in media:
   if row['path'].startswith('copypaste-'+component+'/'):
    rel=row['path'].split('/',1)[1]
    text+=('[Recorded interaction / 实际录影]('+rel+')' if rel.endswith('.mp4') else '!['+row['label']+']('+rel+')')+'\n\n'
  text+=('Historical release notes and the complete setup/usage guide follow.\n\n' if english else '以下历史版本说明及完整安装／使用指南继续保留。\n\n')+old
  p.write_text(text,encoding='utf-8',newline='\n')
for english in [False,True]:
 p=R/'docs'/('README.en.md' if english else 'README.md');old=p.read_text('utf-8');assert not old.startswith('<!-- integrated-round-204 -->')
 p.write_text('<!-- integrated-round-204 -->\n\n'+('204: safe tool feedback, truthful delivery and independent fenced cloud leases. Server networking is read-only; evidence and complete original scope remain explicit.' if english else '204轮：安全工具反馈、真实交付状态与独立云端续租；服务器网络只读，完整原始目标和验收边界继续保留。')+'\n\n[交付 / Evidence](quality/integrated-round-204/README.md) · [全部范围 / Scope](quality/integrated-round-204/requirements-102.md)\n\n'+old,encoding='utf-8',newline='\n')
print(json.dumps({'status':'updated','component_readmes':12,'docs_indexes':2,'related_qualified_cases':total,'marketing_sample_passed':marketing_passed}))
