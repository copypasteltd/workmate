"""Publish bounded evidence of actual acceptance, preserving every failed attempt."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json, re, shutil, subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
D = DEV / 'copypaste-delivery'
P = D / '.data/deployment-188'
A = D / '.data/acceptance-188'
PROOF = ROOT / 'docs/quality/live-acceptance-188'
MEDIA = ROOT / 'docs/assets/live-acceptance-188'
PROOF.mkdir(exist_ok=False)
MEDIA.mkdir(exist_ok=False)

def digest(p):
    return sha256(p.read_bytes()).hexdigest()

def save(p, value):
    p.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf8', newline='\n')

server = json.loads((D / '.data/deployment-179/live-acceptance-188-final-v2.sanitized.json').read_bytes())
deployment = json.loads((D / '.data/deployment-179/real-services-188-v8.sanitized.json').read_bytes())
assert server['candidate_stopped'] and server['status'] == 'deployed_with_open_acceptance_gaps'
archive = P / 'workmate-real-services-188-v8.zip'
assert digest(archive) == deployment['archive_sha256']
assert deployment['configuration_and_credentials_unchanged']
assert deployment['database_and_proxy_processes_unchanged']
for name in ['live-acceptance-188-final-v2', 'real-services-188-v8',
             'proxy-temporary-188-v1', 'public-edge-188-v2', 'native-final-188-v2']:
    source = D / '.data/deployment-179' / (name + '.sanitized.json')
    shutil.copyfile(source, PROOF / (name + '.json'))
shutil.copyfile(A / 'failure-inventory-188-v1.sanitized.json', PROOF / 'original-failures.json')

attempts = {
    'full-regression': 'regression-8064c5cc-46c2-445d-b2fd-94d092406c00',
    'admin-original': 'real-admin-5d55e6c1-b759-461a-b5e3-82b956068ca9',
    'admin-continuation': 'real-admin-7c668321-a2ce-4674-96f7-8591179478d0',
    'web-original': 'real-web-bbfc1cf5-3d1c-454b-968c-510fbe0624b9',
    'web-delivery-continuation': 'real-delivery-ledger-9086eaeb-e6ba-4732-9fc3-154a8fe1df39',
    'extension-continuation': 'real-extension-result-f490c02f-66ae-4e5f-b21c-ef90b1d3b141',
    'delegated-management': 'delegated-fixtures-b65017e2-be8e-46a5-a1b3-b650fc7200ff',
    'shared-configuration': 'native-cause-tests-7698a2df-5ac0-46f6-a399-87ae7250461d',
    'commercial-infrastructure-limited': 'native-cause-tests-b840581f-ea24-4105-9ee1-cb3d93e0bc56',
    'commercial-completed': 'regression-ea753a51-675d-4d9d-994d-95c917db72ad',
    'cloud-workflow-completed': 'regression-b26e7db6-9271-4d03-90fb-a3c4bee98be6',
    'native-protocol-and-company-bridge': 'native-code-mode-baba40d6-876d-4e9f-af37-08c69cc32f18',
    'desktop-final-public-attempt': 'real-desktop-4db87ebb-1fe8-4ad3-bb97-8a4ec03b64ac',
    'web-recording-with-later-admin-timeout': 'online-walkthrough-e39ee547-5c6e-4e8d-af82-48be73feb912',
}
evidence = []
for label, folder in attempts.items():
    source = A / folder / 'receipt.json'
    r = json.loads(source.read_bytes())
    # Original error stacks can contain private HTTP authorization headers.
    # Publish only explicit fields, never arbitrary exception/request/account data.
    safe = {k: r[k] for k in ['stage', 'status', 'at', 'finished_at', 'scope',
                             'counts', 'exit_code', 'log_sha256', 'runtime',
                             'owned_processes_closed', 'owned_browser_closed',
                             'owned_windows_closed', 'native_database_closed',
                             'new_paid_tasks', 'calls', 'company_calls', 'result_sha256'] if k in r}
    safe['checks'] = [{k: c[k] for k in ['name', 'status', 'component', 'label', 'exit_code', 'counts', 'log_sha256'] if k in c}
                      for c in r.get('checks', [])]
    safe['original_receipt_sha256'] = digest(source)
    safe['private_original'] = source.relative_to(D).as_posix()
    save(PROOF / (label + '.json'), safe)
    evidence.append({'label': label, 'status': r['status'], 'receipt': (PROOF / (label + '.json')).relative_to(ROOT).as_posix()})

logs = []
for name in ['code-mode-regression-188-v1.log', 'extension-final-188-v1.log',
             'build-final-188-v2.log', 'discovery-188-v2.log']:
    raw = A / name
    text = raw.read_text(encoding='utf8', errors='replace')
    counts = {k: int(n) for k, n in re.findall(r'^# (tests|pass|fail|cancelled|skipped) (\d+)$', text, re.M)}
    if counts:
        assert counts['tests'] == counts['pass'] and counts['fail'] == 0
    logs.append({'file': raw.relative_to(D).as_posix(), 'sha256': digest(raw), 'counts': counts,
                 'exit_code': 0, 'scope': 'Captured successful command in this task. Full private log retained.'})
save(PROOF / 'final-targeted-checks.json', logs)

recording = A / attempts['web-recording-with-later-admin-timeout']
r = json.loads((recording / 'receipt.json').read_bytes())
assert r['owned_browser_closed'] and r['checks'][0]['status'] == 'passed'
video = Path(r['video'])
gif = MEDIA / '188-actual-cloud-result.gif'
subprocess.run([shutil.which('ffmpeg'), '-hide_banner', '-loglevel', 'error', '-n',
                '-ss', '4.0', '-i', str(video), '-t', '2.2', '-filter_complex',
                'fps=10,scale=1008:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
                '-loop', '0', str(gif)], check=True)
sources = {
    '188-real-cloud-result.png': recording / '01-real-cloud-result.png',
    '188-real-cloud-delivery.png': recording / '02-real-cloud-delivery.png',
    '188-native-side-panel.png': A / attempts['extension-continuation'] / '01-native-right-panel.png',
    '188-extension-real-answer.png': A / attempts['extension-continuation'] / '03-real-cloud-answer.png',
    '188-desktop-full-access.png': A / 'real-desktop-ee418282-930b-413c-948e-3bdaf1a6cd3e/01-full-local-access.png',
}
for name, source in sources.items():
    shutil.copyfile(source, MEDIA / name)
media = []
for p in MEDIA.iterdir():
    media.append({'path': p.relative_to(ROOT).as_posix(), 'bytes': p.stat().st_size, 'sha256': digest(p)})
component_image = {'platform': '188-real-cloud-result.png', 'web': '188-real-cloud-result.png',
                   'admin': '188-real-cloud-result.png', 'desktop': '188-desktop-full-access.png',
                   'extension': '188-extension-real-answer.png', 'delivery': '188-real-cloud-result.png'}
for component, name in component_image.items():
    repo = DEV / ('copypaste-' + component)
    for source, subfolder in [(MEDIA / name, 'screenshots'), (gif, 'demos')]:
        target = repo / 'assets' / subfolder / source.name
        target.parent.mkdir(parents=True, exist_ok=True)
        assert not target.exists()
        shutil.copyfile(source, target)
        media.append({'path': target.relative_to(ROOT).as_posix(), 'bytes': target.stat().st_size, 'sha256': digest(target)})
save(PROOF / 'media.json', {'stage': 188, 'scope': 'Actual browser Web result scroll, native Extension and Desktop consent. GIF is a 2.2-second excerpt of a real read-only completed-task recording, not regenerated inference.',
                           'source_video_sha256': digest(video), 'gif_start_seconds': 4.0, 'gif_duration_seconds': 2.2,
                           'privacy': 'Owned synthetic QA documents only. Identity selectors masked/blurred. Admin loading screenshot and authorization-bearing errors excluded.', 'files': media})

guide = 'https://github.com/copypasteltd/workmate/blob/docs/docs/development/188-live-acceptance.md'
marker = '<!-- live-acceptance-188 -->'
zh = f'''{marker}

## 真实环境测试与上线 · 188

已部署真实文本服务：Web 与 Chrome 原生右侧 Side Panel 已完成“登录 → 上传获准文件 → 云端 Codex 分析 → 生成文件 → 下载 → 核对实际扣费”。后台完成真实用户／企业新建删除、批量状态管理、模型独立 API/Key 编辑删除、VIP 授予撤销及审计检查。操作与使用边界见[完整报告]({guide})。

Desktop 使用本机固定版本 Codex，客户主动选择目录并确认完整本机权限。已修复 GPT 模型的原生 exec 格式兼容，真实本机命令／文件／企业工具桥接通过协议测试；最终真实模型 Desktop 复验受公网连接不稳阻塞，尚不能判定端到端通过。全量后端原始回归为 1,936 项：1,834 通过、101 失败、1 跳过；后续针对修复与现行策略的检查分别记录，不能据此宣称全部通过。

配置和使用：管理员在“模型能力”逐模型填写上游 URL、API Key、模型别名与费率，验证并发布可用版本；用户验证邮箱后选择真实企业与项目，再发起有预算的工作。当前仍使用受保护的测试收件箱。生图实际返回403，视频／语音及 Google／Meta 授权缺失；这些服务尚未取得真实验收。

```mermaid
flowchart LR
 A[邮箱验证 / Email verification] --> B[企业与项目 / Workspace and project]
 B --> C[Web 与 Extension: 云端 Codex]
 B --> D[Desktop: 主动授予本机权限]
 D --> E[客户本机 Codex]
 C --> F[公司服务与逐模型连接]
 E --> F
 F --> G[文件交付、实际用量与审计]
```

IMAGE

下图为真实 Web 已完成任务的只读浏览与滚动录像节选；不代表所有端均已完成真实模型验收。

![实际 Web 结果交互](assets/demos/188-actual-cloud-result.gif)

'''
en = f'''{marker}

## Real-service acceptance and deployment · 188

Real text service is deployed. Web and the native Chrome right Side Panel completed email sign-in, authorized file upload, actual cloud Codex analysis, file delivery/download and measured billing. Actual admin checks cover user/workspace creation and deletion, atomic bulk changes, per-model API/key editing and deletion, VIP grants/revocation and audit records. See the [complete evidence and usage guide]({guide}).

Desktop runs pinned Codex on the customer's computer with explicit folder and full-access consent. Recognized GPT model exec compatibility is repaired; actual local command/file/company-tool operations passed a labelled protocol fixture. Final real-supplier Desktop acceptance remains blocked by intermittent public connectivity. The original full backend regression recorded 1,936 tests: 1,834 passed, 101 failed and one skipped. Subsequent targeted checks are separate evidence, not a replacement full-pass certificate.

To configure service, administrators enter each model's upstream URL, API key, alias and rates in Model capabilities, then qualify and publish its version. Users verify email, select a real workspace/project and submit bounded work. The protected test mailbox remains enabled. Actual image generation returned403; video/audio and Google/Meta credentials are absent and remain unqualified.

```mermaid
flowchart LR
 A[Email verification] --> B[Workspace and project]
 B --> C[Web and Extension: cloud Codex]
 B --> D[Desktop: explicit local permission]
 D --> E[Customer-local Codex]
 C --> F[Company service and per-model connection]
 E --> F
 F --> G[File delivery, measured usage and audit]
```

IMAGE

Actual read-only scrolling through the completed Web task, not new inference or a certificate for every client:

![Actual Web result interaction](assets/demos/188-actual-cloud-result.gif)

'''
for component, name in component_image.items():
    repo = DEV / ('copypaste-' + component)
    caption = '实际 Desktop 本机权限确认 / Actual Desktop local permission consent' if component == 'desktop' else '实际原生侧栏结果 / Actual native Side Panel result' if component == 'extension' else '实际 Web 云端交付 / Actual Web cloud delivery'
    image = f'![{caption}](assets/screenshots/{name})'
    for filename, prefix in [('README.md', zh), ('README.en.md', en)]:
        p = repo / filename
        old = p.read_bytes()
        assert marker.encode() not in old
        p.write_bytes(prefix.replace('IMAGE', image).encode() + old)

requirements = '''# 188 · 真实环境验收约束

本轮执行用户“全面自行测试线上应用并上线”的要求。Codex 是唯一内核；Desktop 必须在客户本机执行，Extension 使用原生右侧 Side Panel 并仅上传获准文件。所有 AI 请求经公司服务，逐模型保存上游 URL／Key 与计价配置。

验收使用独立 QA 记录及用户明确要求的测试账号；不得发布广告、联系外部客户、修改客户文档或把测试额度当成真实付款。真实供应商调用须保留预算、原请求、计量及不确定费用；不能通过改为模拟结果、降低权限检查或释放未知费用预留来制造通过。

保留原始失败结果、历史测试、既有冻结发布及用户文件。后续当前测试应覆盖现行最高管理员直接执行和普通角色策略审批两种路径。截图与 GIF 反映实际画面，明确与本机协议夹具的证据差别。不得使用本地 Docker／WSL／虚拟化；关闭自建浏览器和临时环境。

当前结论是“已部署修复，仍有验收缺口”，不是完整应用通过证明。详细结果与剩余依赖见[开发与验收报告](../development/188-live-acceptance.md)。
'''
(ROOT / 'docs/requirements/188-live-acceptance.md').write_text(requirements, encoding='utf8', newline='\n')

development = '''# 188 · 线上测试、修复与部署

2026-11-02，最终部署为 `real-services-188-v8`，数据库版本161。用户端为 <https://agent.copypaste.hk>，后台为 <https://agent-dashboard.copypaste.hk>，API 为 <https://ai-api.copypaste.hk>。这是已上线但仍有验收缺口的版本。

## 当前可确认的流程

|编号|范围|真实结果|证据边界|
|---|---|---|---|
|1|Web 登录、文件分析与交付|OTP、真实企业／项目、上传、云端 Codex 读取随机标记、计算100元和40次转化、生成与下载CSV、核对散列与实际扣费通过|原任务费用 HK$0.068230；后续下载未新建模型任务|
|2|Extension|真实工具栏点击打开浏览器原生右侧 Side Panel、真实 PKCE、文件上传、云端 Codex 生成结果与CSV下载通过|原任务费用 HK$0.068028；浏览器宽度1464→1078，侧栏360像素无横向溢出|
|3|后台|新建2名用户及2家企业、幂等重放、重复邮箱拒绝、批量冻结恢复、过期版本整批拒绝、唯一拥有人保护、模型新增编辑删除、独立Key替换与掩码、VIP授予撤销、测试数据删除通过|最高管理员操作保留直接执行审计；普通角色审批另有回归|
|4|Desktop 外壳与权限|真实安装版登录、无边框、无Electron菜单、目录选择、完整本机权限的警告确认通过|最终真实模型复验未通过，不以外壳通过代替本机任务闭环|
|5|Desktop 内核兼容|固定Codex 0.163.0-alpha.11在本机实际执行命令、读取输入、写入结果，并调用已注册的企业工具桥接通过|上游为明确标记的协议夹具，不是供应商真实模型验收|
|6|最终服务器状态|Web63070、后台63071、API入口63072与应用63073均返回200，真实模式健康；数据库与专用代理进程保留，候选服务停止|证明源站健康；公网仍存在间歇超时|

## 本轮修复

1. 服务切换到 `DEMO_MODE=false`，会话只返回当前真实模式的企业成员关系。保留原模拟历史与账务引用；原测试账号得到真实项目及 HK$100,000 测试信用额度，该额度不是付款或充值。
2. 网关先按任务固定模型解析其独立 URL／Key，取消对重复全局 Key 的错误前置依赖。密钥仍由既有加密连接存储管理，客户端不持有供应商Key。
3. 专用Nginx运行用户为workmate，临时目录却属于nobody且权限0700，大型原生Codex请求在到达API前失败。修正五个明确目录的属主并固定专用配置用户，验证配置与读写后重载；未改动无关Nginx服务。
4. 永久清理共用项目配置时，补上既有内容清除上下文，避免数据库历史保护触发500；重复新删除返回409，原幂等重放仍保留。
5. 固定Codex为对象映射补上空 `properties`。现使用与实际原生请求一致的可信结构投影，仍以完整业务结构验证效果，修复云端工作流被误判 `registered_schema`。
6. 对识别为GPT的模型，原生Codex在 `additional_tools` 中声明exec／wait。补上固定Lark格式检查、重复／外来声明拒绝和有声明才允许响应的绑定；去除无独立授权的协作／控制声明。企业工具仍走原任务及权限检查，本机操作仍由本机权限控制。原生工具命名 `copypaste.asset_text_read` 映射到 `tools.copypaste__asset_text_read`。
7. 保存有界的网关拒绝原因和未来生图HTTP原因；不保存Key、完整原始提示词或供应商错误正文。未知计费不冒充成功或零费用。

## 测试记录

|检查|结果|说明|
|---|---|---|
|原始全量后端|1936项：1834通过、101失败、1跳过|完整运行约117分钟；原日志与101项编号列表保留，未重写成通过|
|Web / Admin / Desktop 单元检查|28/28、20/20、263/263通过|各客户端构建通过；不是所有功能的真实供应商验收|
|Extension 当前单元检查|89/89通过|原始88/89失败也保留；修正与当前会话规则不一致的旧夹具|
|现行管理／审批／费用相关夹具|100/100通过|普通角色复制权限但不冒充最高管理员，最高管理员直接执行另有专门检查|
|共用项目配置清理|22/22通过|包含永久清理与重复删除冲突|
|视频验证／生成任务／通知／套餐当前夹具|71/71通过|测试供应商协议／业务逻辑，非真实视频服务能力|
|云端工作流／网关／项目配置|37/37通过|真实固定Codex进程配合明确协议夹具|
|最终exec网关／当前测试发现检查|43/43通过|包括未声明exec、异命名空间、改写语法、重绑定与权限边界；原始私有日志已绑定散列|
|实际本机命令／文件／企业工具桥接|通过|两次协议响应、一条实际企业工具调用；不是供应商实测|

这些检查有重叠，不能相加当作新的全量通过数。音频／能力管理的补充检查曾在原全量任务关闭其数据库时中断，原136项中68项通过、68项失败作为受环境中断限制的记录保留；其前63项连续通过，剩余商业夹具随后在独立生命周期数据库完成71项。没有再次运行全部1936项。原始失败还涉及原生文档转换、渲染环境、暂停／持久化语义、旧升级夹具及其他历史审批预期，完整编号见[原始失败列表](../quality/live-acceptance-188/original-failures.json)。

## 尚未通过的项目

|编号|缺口|当前处理|
|---|---|---|
|G01|真实生图403|资格保持未发布；原请求费用未知记录保留，未盲目重试或假报成功|
|G02|真实视频、语音生成与转写|没有可用凭据，未取得真实验收|
|G03|Google Ads／Analytics与Meta授权和外部发布|没有真实OAuth授权；CSV分析通过不等于平台拉取或发布通过|
|G04|正式邮件投递|按用户要求保留受保护的测试收件箱；未配置SMTP|
|G05|Desktop真实模型完整本机任务|三次修复前原请求仍为费用待核对；最终修复后复验因公网连接失败停在准备阶段；本机协议及权限通过不能替代真实模型闭环|
|G06|公网稳定性|从本机和服务器均观察到Cloudflare不同入口交替超时；某次Web的172入口正常而104超时，后续后台104正常而172超时，API两个入口也曾超时。源站保持健康，尚未定位／修复外层转发问题|
|G07|全量回归剩余失败|旧规则夹具已通过版本副本校正，若干真实环境及语义差异仍需继续修复与复核；没有全量通过证明|
|G08|生产环境运行配置|当前 `NODE_ENV=development`、`DEV_MAILBOX=true`，不能称为正式邮件与生产配置完整验收|

三个Desktop未知供应商请求保留其原请求、预留及审计，当前客户账务未确认扣费；这不等于供应商成本为零。图片请求另有一条未知计费记录。测试QA的一日Pro授予带到期时间且不自动续期，没有虚构付款。独立QA企业、文件与结果用于回查；临时管理目录测试的2名用户和2家企业已按正式接口删除。

## 部署与回滚

最终包 `workmate-real-services-188-v8.zip`，SHA-256为 `71c6a0614392b7df072c5b8e19bbfb680f6b763a25bd66f2a68014e085e1f6a5`。源站 `/opt/workmate/overlays/real-services-188-v8/backend`，主服务 `workmate-api.service`，最高优先级覆盖文件为14个z前缀的 `zzzzzzzzzzzzzz-real-services-188-v8.conf`。数据库161无新迁移，既有模型加密Key与配置保留。候选服务使用63079验证后已停止，公开端口不变。

原v8安装第一次因已停止并被systemd回收的v7候选服务不存在而中止，未切换线上API；随后恢复脚本验证已解包的每个文件散列并继续候选验证和切换，最终源站检查通过。不要直接重复执行一次性安装脚本。回滚时恢复已验证的上一服务覆盖文件并重载、重启本应用，再检查健康与模式；未知费用、用户数据、数据库和Key都不能随代码回滚删除。大请求临时目录修复应保留。

配置／部署说明按要求明文存于服务器 `/root/cfg/workmate/live-acceptance-188/deployment-note-v2.txt`；现有密码仍在受限的原配置文件中，未导入Git。备份、原始日志、录屏与私有会话文件留在本地受控`.data`及服务器cfg，公开证据仅保留安全字段、散列和测试记录。自建浏览器、SSH、CONNECT代理及临时原生PostgreSQL均已关闭，禁止本地虚拟化。

## 实际画面

![Web实际交付](../assets/live-acceptance-188/188-real-cloud-result.png)

![Extension原生右侧栏](../assets/live-acceptance-188/188-native-side-panel.png)

![Desktop主动授予本机权限](../assets/live-acceptance-188/188-desktop-full-access.png)

![实际已完成Web任务的只读滚动](../assets/live-acceptance-188/188-actual-cloud-result.gif)

GIF为真实已完成任务的2.2秒录像节选，不是新模型推理录像；本轮后台截图只捕捉到加载画面，因此没有将其冒充成功页面。既有后台截图在各端README历史184章节保留。

## English acceptance statement

Real text service, Web file delivery, the native Extension Side Panel and actual admin operations are verified. The backend fixes are deployed as188-v8 with source-bound receipts. Recognized GPT native exec/wait is now scoped and validated; pinned local Codex performs actual command/file and company-tool operations against an explicitly synthetic protocol fixture. Final real-supplier Desktop acceptance was blocked by public connectivity and remains unqualified. Image403, missing video/audio/OAuth/SMTP, development mailbox configuration and the original full-regression failures remain explicit gaps. Original failures, unknown-cost holds and immutable release history were preserved. This document is not a full-product acceptance certificate.
'''
(ROOT / 'docs/development/188-live-acceptance.md').write_text(development, encoding='utf8', newline='\n')
(ROOT / 'docs/changes/188-live-acceptance.md').write_text('''# 188 · 变更与交付记录

已上线真实模式与逐模型连接前置检查修复、专用代理大请求临时目录权限修复、项目配置永久清理修复、原生结构投影及Desktop exec兼容。数据库版本保持161，既有密码、用户数据与冻结发布保留。

原始后端全量1936项中101项失败，后续现行策略及修复分别通过针对性检查。真实Web／Extension交付和后台管理流程通过；Desktop供应商闭环、公网稳定性、图片403、其余外部服务凭据及全量剩余问题未取得完整验收。同步六端中英README、真实截图／录屏GIF、安全回执、原始失败清单与开发说明。

[使用、范围、证据与回滚](../development/188-live-acceptance.md) · [需求](../requirements/188-live-acceptance.md) · [机器可读记录](../quality/live-acceptance-188.json)
''', encoding='utf8', newline='\n')
for filename, text in [('README.md', '真实文本服务及本轮修复已上线；Web／Extension交付和后台操作通过实测，Desktop真实模型、公网稳定性及外部服务仍有明确验收缺口。'),
                       ('README.en.md', 'Real text service and acceptance fixes are deployed. Web/Extension delivery and admin operations passed actual checks; real-supplier Desktop, public reliability and external integrations retain explicit gaps.')]:
    p = ROOT / 'docs' / filename
    old = p.read_bytes()
    assert marker.encode() not in old
    p.write_bytes((marker + '\n\n' + text + '\n\n[需求 / Requirements](requirements/188-live-acceptance.md) · [报告 / Report](development/188-live-acceptance.md) · [变更 / Changes](changes/188-live-acceptance.md) · [证据 / Evidence](quality/live-acceptance-188.json)\n\n').encode() + old)

names = {b: [] for b in ['backend', 'web', 'admin', 'desktop', 'extension', 'delivery', 'docs']}
component = {'backend': 'platform', 'web': 'web', 'admin': 'admin', 'desktop': 'desktop', 'extension': 'extension', 'delivery': 'delivery'}
for branch, short in component.items():
    repo = DEV / ('copypaste-' + short)
    modified = subprocess.check_output(['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', str(repo), 'diff', '--name-only', '-z'], cwd=ROOT).decode().split('\0')
    paths = set(modified) - {''}
    paths.update(['README.md', 'README.en.md'])
    for folder in ['src', 'scripts', 'tests', 'contracts']:
        if (repo / folder).is_dir():
            paths.update(p.relative_to(repo).as_posix() for p in (repo / folder).glob('*188*') if p.is_file())
    paths.update(r['path'].removeprefix(repo.relative_to(ROOT).as_posix() + '/') for r in media if r['path'].startswith(repo.relative_to(ROOT).as_posix() + '/'))
    names[branch] = sorted(paths)
names['backend'].append('src/desktop-code-mode.ts')
names['backend'] = sorted(set(names['backend']))
names['docs'] = sorted(['docs/README.md', 'docs/README.en.md', 'docs/contracts/capability-management-188-schemas.json',
                        'docs/requirements/188-live-acceptance.md', 'docs/development/188-live-acceptance.md', 'docs/changes/188-live-acceptance.md',
                        'docs/tools/prepare-live-acceptance-188-v1.py', 'docs/tools/publish-live-acceptance-188-v1.py',
                        'docs/quality/live-acceptance-188.json', *(p.relative_to(ROOT).as_posix() for p in PROOF.iterdir()),
                        *(p.relative_to(ROOT).as_posix() for p in MEDIA.iterdir())])
sources = {}
for branch, paths in names.items():
    repo = ROOT if branch == 'docs' else DEV / ('copypaste-' + component[branch])
    for name in paths:
        if name != 'docs/quality/live-acceptance-188.json':
            sources[(repo / name).relative_to(ROOT).as_posix()] = digest(repo / name)
report = {'stage': 188, 'status': 'deployed_with_open_acceptance_gaps', 'at': datetime.now(timezone.utc).isoformat(),
          'full_product_accepted': False, 'backend_full_regression': {'tests': 1936, 'pass': 1834, 'fail': 101, 'skipped': 1},
          'final_overlay': server['overlay'], 'archive_sha256': deployment['archive_sha256'], 'schema_version': 161,
          'real_web_delivered': True, 'real_extension_delivered': True, 'real_admin_crud_qualified': True,
          'desktop_real_supplier_accepted': False, 'desktop_native_protocol_and_local_effects_passed': True,
          'real_image_accepted': False, 'image_http_status': 403,
          'missing_real_integrations': ['video', 'speech', 'transcription', 'Google/Meta OAuth', 'SMTP'],
          'native_unknown_cost_tasks': 3, 'historical_unknown_costs_preserved': True,
          'public_connectivity_intermittent': True, 'origin_healthy': True, 'test_mailbox_retained': True,
          'native_databases_closed': True, 'owned_browsers_closed': True, 'ssh_closed': True, 'qa_transport_closed': True,
          'local_virtualization_used': False, 'frozen_releases_preserved': True,
          'test_count_policy': 'Independent and overlapping runs are not summed; the failed original full run remains failed.',
          'evidence': evidence, 'sources': sources, 'media': media}
save(ROOT / 'docs/quality/live-acceptance-188.json', report)
save(P / 'publication-paths.json', names)
print(json.dumps({'status': report['status'], 'publication_files': {b: len(v) for b, v in names.items()}, 'media_files': len(media)}, ensure_ascii=False))
