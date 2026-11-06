"""Publish bilingual current usage before the retained complete historical guide."""
from pathlib import Path
import json
R=Path(__file__).resolve().parents[2];D=R/'dev';Q=R/'docs/quality/integrated-round-205'
load=lambda p:json.loads(p.read_text('utf-8-sig'))
assert load(Q/'verification.json')['status']=='passed'
assert load(Q/'live-production-journey.json')['status']=='passed'
assert load(Q/'controlled-tool-feedback-ui.json')['status']=='passed'
summary=load(Q/'test-summary.json');total=summary['total_qualified_cases'];full=load(Q/'open-public-download-gate.json')['full_public_download_gate']
evidence='https://github.com/copypasteltd/workmate/blob/docs/docs/quality/integrated-round-205/README.md'
notes={
'platform':([
'云端唯一使用固定Codex及受信Skills，公司AI请求按绑定模型的上游地址和API Key转发。企业／项目／用户权限、原预算、付费输入检查点及实际费用继续强制执行。',
'每个失败调用保留独立参考号。同一工具的另一份输出成功，不解除原项；明确未执行且可修正时，Codex使用_workmate_repair_of关联精确原项，控制字段在原业务校验前移除。参考号错误只记录核对诊断；未知操作换参数也不能重做。',
'schema166保存受RLS控制的独立安全状态，后续回合、补充资料及活动清理均不抹掉未交付项；最终工作状态重新核对。音视频须确认完成、文件可用和确定用量，原费用和实际部分成果保留。',
'原63070／63071／63072入口保持。仅切换Workmate应用；真实库备份和兼容新schema的旧代码回退保留，尚不等于完整恢复演练。服务器网络配置及实时规则只读。'],[
'Cloud execution uses pinned Codex and trusted Skills. Company inference forwards through each bound model\'s upstream URL/API key. Enforce current tenant/project/user authority, original budget, paid checkpoints and measured usage.',
'Each failed call keeps a separate reference. Another output of the same tool does not resolve it. Codex links an explicitly not-performed correctable call using _workmate_repair_of; the bridge strips control metadata before business validation. Mistyped references record a diagnostic; unknown operations cannot be recreated with changed arguments.',
'Schema166 persists independent RLS-protected safe outcomes across input waits, later turns and activity pruning. Canonical completion rechecks them. Audio/video requires completed available files and confirmed usage; preserve actual costs and partial files.',
'Keep existing63070/63071/63072 entries. Switch only Workmate application paths, retain a real database backup and forward-schema compatible code fallback; full restoration remains a separate exercise. Server networking and live rules are read-only.']),
'web':([
'登录后选择企业与项目，再选择默认助手或预设专业角色；明确固定附件版本与预算后提交一次原请求，云端Codex执行，用户审阅实际文件及费用。',
'对话成果和任务页逐项显示尚未完成的交付及安全支援号。长回复、另一份成功输出、补充资料或活动清理不会冲掉原失败。只有精确对应的实际修正才解除该项。',
'保留中英双语、双主题、品牌色、窄屏可读和无横向溢出。下载页挂载Desktop0.7.18安装／便携包及原字节Extension0.5.7，并标明真实大小和SHA。'],[
'Sign in, select company/project, then choose the default assistant or preset specialist. Explicitly pin reference versions and budget, submit the original request once, run cloud Codex, and review actual files and usage.',
'Conversation results and task details show each outstanding delivery with safe support references. Long responses, independent successful outputs, input waits and activity pruning preserve unresolved calls; only the actual exact correction resolves its item.',
'Keep bilingual dual-theme branding, readable narrow layouts and no horizontal overflow. Downloads exposes Desktop0.7.18 setup/portable and identical Extension0.5.7 archive bytes with actual sizes/SHA.']),
'desktop':([
'安装或启动便携包，经浏览器S256授权登录，选择本机工作目录和本地角色。Codex在客户本机运行；客户可明确授予／撤销完整本机权限。窗口无边框、无Electron默认菜单。',
'公司音视频工具在原生主进程确认可用真实文件后才报告完成。原生认证、公司API桥接、加密存储及文件保存独立保留；未运行renderer:sync。',
'云端任务审阅共享逐项失败摘要与活动身份。最终0.7.18包核对固定Codex、全新原生S256、实际页面与Web同字节导出；本轮没有宣称全部本机工具已经具有新的通用持久恢复协议。'],[
'Install setup or start portable, authorize using browser S256, then choose a local workspace and specialist. Codex runs on the customer computer with explicitly granted/revocable full local permission. Keep frameless windows and no default Electron menu.',
'The native main process confirms actual available company audio/video deliverables before completion. Preserve native authentication, company API bridge, encrypted storage and save implementation; renderer:sync was not run.',
'Cloud-task review shares per-call summaries and activity identity. Qualify final0.7.18 pinned Codex, fresh native S256, actual pages and identical Web/native export bytes. Full general persistent recovery for every local tool remains within original acceptance scope.']),
'admin':([
'按模型配置独立的OpenAI兼容接口地址及API Key，管理用户／企业／消耗／额度与VIP、内容和权限、创建／删除及列表批量操作。最高管理员直接执行，其他角色按策略审批，全程保留审计。',
'本轮管理端业务与界面源码未改，沿用原样22项相关证据及198实际PNG／GIF／MP4，不冒充本轮重新全站验收。新schema166维持当前任务和租户授权，没有增加管理绕过。'],[
'Configure an independent OpenAI-compatible upstream URL/API key for every model. Manage users, companies, usage, credit/VIP, content, permissions, creation/deletion and list bulk actions. Highest administrators act directly; other roles follow policy with full audit records.',
'Admin business/UI source is unchanged. Retain22 related cases and198 actual PNG/GIF/MP4 against identical source; no new full-site acceptance claim. Schema166 preserves current task/tenant authority without administrator bypass.']),
'extension':([
'安装原字节0.5.7 ZIP解压包后，点击扩展打开Chrome原生右侧SidePanel，经公司授权进入对话。用户明确选取文件、读取并上传固定版本后，由公司云端Codex使用。',
'本轮扩展业务源码及发行ZIP不变，沿用93项相关证据与198实际交互素材。完整Chrome／设备／大文件矩阵及商店发行仍按原始范围验收。'],[
'Install the unpacked0.5.7 ZIP, click the extension to open Chrome\'s native right SidePanel, authorize and chat. Explicitly select/read/upload pinned local files for company cloud Codex.',
'Extension business source and release ZIP bytes are unchanged. Retain93 related cases and198 actual interaction media. Full Chrome/device/large-file qualification and store distribution remain within original acceptance scope.']),
'delivery':([
'本轮先完整盘点102条／32组及全部代码标记，再完成并冻结844份产品源码与166份迁移的整批实现，统一构建和回归。保留首轮23项失败、第二轮原生启动超时、受控页面加载超时及后续集中修正的精确证据。',
'当前测试入口按数字版本保留历史用例，三份原生集成文件分别绑定绝对Codex可执行文件及匹配版本；其余测试配置保持原约束。Windows目录回收只等待原属工作进程退出，并确认实际目录已释放，不结束其他进程。',
'沿已有端口切换自身应用，发布不可变20501包，核对真实备份、9份网络文件和实时规则、原凭证及DB／代理进程。暂停期间的中断文件另行完整保留，校验完整副本并落盘后原子发布；以恢复时的当前进程和启动身份为基线。普通原子推送8引用，保护27份原用户文件。'],[
'Inventory all102 requirements/32 groups and literal source markers, complete/freeze the844-source/166-migration implementation batch, then build and verify as a whole. Retain the initial23 failures, second-attempt native startup timeouts, controlled-page load timeout and measured integrated corrections.',
'Current test discovery selects numeric attempt versions while retaining history. Three native integration files explicitly pin the absolute Codex executable and matching version; other fixture authority remains intact. Windows cleanup waits for the exact owned worker to exit and verifies directory absence without killing other programs.',
'Switch only owned application paths through existing ports, publish immutable20501 downloads and verify backup, nine network files/live rules, credentials and DB/proxy processes. Preserve interrupted files from the pause, flush and verify complete copies before atomic publication, and compare current processes/boot identity against the resume baseline. Ordinary atomic eight-ref publication preserves27 original user files.'])}
flows={
'platform':'A[Current authorization and original budget] --> B[Pinned Codex and trusted Skills]\n B --> C[Per-call outcome]\n C --> D[Exact validated correction]\n C --> E[Durable outstanding output]\n D --> F[Actual files and measured usage]\n E --> F',
'web':'A[Sign in and pin sources] --> B[Submit once with original budget]\n B --> C[Cloud Codex]\n C --> D[Individual delivery status]\n D --> E[Review actual files and fees]',
'desktop':'A[Download and S256 login] --> B[Frameless local Codex]\n B --> C[Explicit revocable local permission]\n B --> D[Company tools and actual files]\n D --> E[Native review and save]',
'admin':'A[Administrator login] --> B[Current role and policy]\n B --> C[Direct highest admin or approval]\n C --> D[User content and cost control]\n D --> E[Audit]',
'extension':'A[Native right SidePanel] --> B[Explicit file consent]\n B --> C[Pinned upload]\n C --> D[Company cloud Codex]\n D --> E[Review delivery]',
'delivery':'A[Whole code batch] --> B[Unified checks and retained failures]\n B --> C[App-only switch and immutable packages]\n C --> D[Read-only network verification]\n D --> E[Atomic branch publication]'}
for component,(zh,en) in notes.items():
 folder=D/('copypaste-'+component);version=load(folder/'package.json')['version']
 for english in [False,True]:
  p=folder/('README.en.md' if english else 'README.md');old=p.read_text('utf-8');assert not old.startswith('<!-- integrated-round-205 -->')
  title='Exact per-call delivery and durable correction' if english else '逐项交付与精确修正'
  text=f'<!-- integrated-round-205 -->\n\n## 205 · {version} · {title}\n\n[Evidence and limits / 证据与边界]({evidence}) · [Downloads / 下载](https://agent.copypaste.hk/downloads)\n\n'
  text+='\n\n'.join(f'{i+1}. {v}' for i,v in enumerate(en if english else zh))+f'\n\n```mermaid\nflowchart LR\n {flows[component]}\n```\n\n'
  text+=(f'{total} qualified related cases, including {summary["round205_executed_cases"]} executed in this round and unchanged Admin/Extension evidence. ' if english else f'{total}项相关通过证据，其中本轮执行{summary["round205_executed_cases"]}项，其余为原样Admin／Extension沿用。')
  text+=('Four full public files passed exact size/SHA for the explicitly recorded QA path; default direct egress and DNS failover remain separate checks. ' if full and english else '四份公网文件在明确记录的QA路径通过完整字节／SHA；默认直接出口与正常DNS故障转移另行验收。' if full else 'Complete public installer downloading remains an unmet gate; inner full bytes passed. ' if english else '完整公网安装包下载仍为未通过项，内网完整字节通过。')
  text+=('The original102 requirements/32 groups, professional19-role/50-Skill sign-off, real external media/marketing/IdP services, device/concurrency/long-run/DR matrices and blind WorkBuddy comparison remain explicit. Server networking is read-only. Current exact-call rules supersede historical tool-name-only recovery descriptions below.\n\n' if english else '保留全部102条／32组、19角色／50Skills专业签收、真实外部媒体／营销／IdP、设备／并发／长稳／灾备矩阵及WorkBuddy同题盲测。服务器网络只读。本轮精确调用规则取代下方历史版本中仅按工具名称解除失败的说明。\n\n')
  for row in load(Q/'actual-media.json')['files']:
   if row['path'].startswith('copypaste-'+component+'/'):
    rel=row['path'].split('/',1)[1];text+=('[Recorded interaction / 实际录影]('+rel+')' if rel.endswith('.mp4') else '!['+row['label']+']('+rel+')')+'\n\n'
  text+=('The complete setup/usage guide and explicitly historical release notes follow.\n\n' if english else '以下保留完整安装／使用指南及明确的历史版本记录。\n\n')+old
  p.write_text(text,encoding='utf-8',newline='\n')
for english in [False,True]:
 p=R/'docs'/('README.en.md' if english else 'README.md');old=p.read_text('utf-8');assert not old.startswith('<!-- integrated-round-205 -->')
 p.write_text('<!-- integrated-round-205 -->\n\n'+('205: exact per-call delivery, durable correction state and actual media confirmation. Read-only server networking, measured release evidence and complete original scope.' if english else '205轮：逐项交付、持久修正状态和真实音视频完成判定；服务器网络只读，保留实际发版证据及完整原始范围。')+'\n\n[交付 / Evidence](quality/integrated-round-205/README.md) · [全部范围 / Scope](quality/integrated-round-205/requirements-102.md)\n\n'+old,encoding='utf-8',newline='\n')
print(json.dumps({'status':'updated','component_readmes':12,'docs_indexes':2,'related_qualified_cases':total,'full_public_download_gate':full}))
