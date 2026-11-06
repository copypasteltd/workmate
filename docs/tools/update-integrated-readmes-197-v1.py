from pathlib import Path
import json
root=Path(__file__).resolve().parents[2];dev=root/'dev';report='https://github.com/copypasteltd/workmate/blob/docs/docs/quality/integrated-round-197/README.md'
entries={
'platform':('0.5.4','服务端启动结算','Server startup settlement',[
'客户在 Web 或 Extension 选择企业、项目和角色后，由云端 Codex 执行；Desktop 的 Codex 始终在客户本机执行。管理员仍按模型分别设置上游接口、密钥、模型别名与费率。',
'原生启动失败／失联时，先关闭公司工具和推理网关并锁定原任务，再核对当前启动协议、fencing token、所有者及六类持久准入记录。只有未准入执行回合且费用和 token 明确为零，才自动释放原预留。',
'unknown 或暂未见费用不能证明已准入任务没有执行。此类任务仍待核账；伪报 completed 的未准入启动不能生成成功结果或交付文本，既有未知记录保持。',
'本轮提供预留释放、并发准入／完成、零费用工具准入与费用边界回归。schema163 不变；私有配置仍在服务器 /root/cfg/workmate/，不进入 Git。'],[
'Web and Extension run company-hosted Codex after organization, project and role selection. Desktop Codex runs on the customer computer. Admin still configures an upstream URL, key, alias and rates per model.',
'On startup failure or owner loss, close company tools and inference gateways, lock the original task, and verify the current startup protocol, fencing token, owner and six durable admission categories. Release the existing hold only before turn admission with proven zero cost and tokens.',
'An unknown result or temporarily empty ledger cannot prove an admitted turn did no work. Keep it in reconciliation. A fabricated completed pre-turn report cannot publish successful output; existing uncertain history is preserved.',
'Includes concurrent admission/finish and zero-cost tool admission regressions. Schema163 is unchanged. Private configuration remains in /root/cfg/workmate/ and is excluded from Git.']),
'web':('0.5.3','统一任务审阅','Consistent task review',[
'登录后选择企业和项目、专业角色及材料，提交云端 Codex 工作。任务工作台保留成果、文件、变更、执行、网页、活动和费用七个视图。',
'软件执行检查集中在执行标签内；旧详情页不再重复显示同一面板。文字手工编辑继续产生不可变版本，并保留原请求核对及历史比较。',
'无请求体的读取连接中断最多重试一次；收到服务响应即交由业务处理。写入结果未知时先查原记录，明确重试原操作，不自动重新派发工作。',
'实际 HTTPS 页面完成七标签键盘操作、375/768/1024/1440 宽度和暗色审阅检查。下载页包含本轮三个客户端包和实际校验值。'],[
'Sign in, choose an organization/project, specialist and materials, then submit cloud Codex work. The task workbench retains Results, Files, Changes, Execution, Browser, Activity and Usage.',
'Software checks appear once in Execution. Manual text editing still creates immutable versions with original-request recovery and historical comparison.',
'A failed body-free read retries at most once. Received HTTP responses are handled by the business flow. Uncertain writes require checking the original result and explicitly retrying that operation; work is never silently dispatched again.',
'Actual HTTPS checks cover keyboard navigation, 375/768/1024/1440 widths and dark review. Downloads contain this round’s three real client packages and checksums.']),
'admin':('0.5.2','管理与连接反馈','Administration and connection feedback',[
'管理员通过邮箱验证码及 TOTP 登录，管理企业、用户、模型、额度、VIP、内容、权限、审批与审计。最高管理员按现有策略直接执行并保留审计；其他角色按权限审批。',
'模型能力的每个模型分别配置 API 地址、API key、上游别名和费率，可编辑、验证和删除；列表及批量操作继续按权限和影响预览执行。',
'服务就绪页区分真实接通、测试邮箱与未配置服务。连接读取有限恢复；不确定的管理写入不能自动重复执行。',
'本轮使用新登录、真实就绪信息和角色验收记录完成实际后台复查。SMTP 仍按要求使用受保护测试收件箱，未声称真实投递已接通。'],[
'Admins use email verification and TOTP to manage organizations, users, models, funds, VIP, content, permissions, approvals and audit. Highest admins execute according to policy with audit; other roles follow their approval rules.',
'Each model has its own API URL, key, upstream alias and rates, with edit, validation and delete. Lists and batch operations continue to enforce permissions and impact previews.',
'Readiness distinguishes real connections, the test mailbox and unconfigured services. Reads recover within a bound; uncertain administrative writes are not automatically replayed.',
'This round checks fresh sign-in, real readiness and retained role evidence. The protected test mailbox remains as requested; real SMTP delivery is not claimed.']),
'desktop':('0.7.7','本机连接与执行审阅','Local connection and execution review',[
'安装 Windows Setup 或运行便携版，在系统浏览器完成授权；选择本机目录、专业角色和权限。完整本机权限需要客户原生确认，可撤销，退出登录即失效。应用无边框且无 Electron 菜单。',
'本机 Codex 读取文件、运行命令、操作获准应用／浏览器并写出结果；模型与计费走公司服务器。结果页按原公司任务 ID 读取真实本机事件，不重跑指令。',
'公司控制、登录、上传、下载、媒体和更新请求使用独立内存 Chromium Session，固定公司同源、禁止 Cookie 和跳转。Codex 自身推理连接仍走原公司网关，不由界面网络代替。',
'指令和输出默认折叠，退出码、失败和截断保持可见。当前文件预览重新验证本机权限及真实路径；撤权后不得继续读取。心跳只在最后确认的有效租期内有限恢复，不能重跑模型或工具。',
'本轮实际发布包完成 PKCE、公司文件真实上传／下载、本机 Codex 文件和命令任务、真实费用结算及撤权。单次成功不代表长期网络 SLA 或完整任意应用兼容。'],[
'Install Windows Setup or run Portable, authorize in the system browser, then choose a local folder, specialist and permission. Full local access requires explicit native consent, can be revoked and ends on sign-out. The app is frameless without Electron menus.',
'Local Codex reads files, runs commands, operates authorized apps/browser and writes results. Models and billing use company servers. Results use the original company task ID and actual native events without rerunning commands.',
'Company control, authentication, uploads, downloads, media and updates use a separate memory-only Chromium Session with a fixed company origin, no cookies and no redirects. Codex inference retains its original company gateway connection.',
'Commands/output start collapsed; exit status, failure and truncation stay visible. Current-file previews recheck local permission and canonical paths. Heartbeat recovery is bounded by the last confirmed live lease and cannot replay inference or tools.',
'The actual package completes PKCE, real company file transfer, native Codex file/command work, real billing and revocation. A single successful journey does not establish long-term network SLA or arbitrary-app compatibility.']),
'extension':('0.5.6','右侧工作栏','Browser side-panel workspace',[
'从下载页解压 ZIP，在 Chrome 扩展开发者模式加载目录，点击工具栏图标打开真正的右侧 Side Panel。保留 ChatGPT 式对话、输入和附件结构。',
'通过公司 Web 完成 PKCE 授权，选择企业与项目，明确选择／拖入文件或粘贴图片。仅获准材料上传至云端，Agent 在公司云端运行。',
'连接读取有限恢复，写入结果未知不自动重发；撤销会话及账号切换继续隔离私人附件与结果。',
'本轮实际工具栏、原生右侧栏、PKCE、两份私人附件上传及宽度检查通过；当前交付为解压加载包，未声称已在 Chrome 商店上架。'],[
'Unzip the download, load the directory in Chrome developer mode and click the toolbar action to open the real right Side Panel. It retains ChatGPT-style conversation, input and attachments.',
'Complete PKCE through company Web, choose an organization/project and explicitly select/drop files or paste images. Only authorized materials upload; the agent executes in the company cloud.',
'Reads recover within a bound; uncertain writes are not automatically replayed. Session withdrawal and account changes continue to isolate private attachments/results.',
'Actual toolbar, native panel, PKCE, two private uploads and dock width pass. Delivery is an unpacked extension ZIP; Chrome Web Store publication is not claimed.']),
'delivery':('0.5.3','整批验证与发布','Integrated validation and publication',[
'先完成所有本轮代码，再统一六端构建、类型检查、回归和实际客户端联调。本轮 519 项相关测试通过，后端选择与本轮风险相关的用例，没有将全部历史测试写成已重跑。',
'不可变 Windows 安装／便携包和 Extension ZIP 挂在公开下载页，所有实际完整下载检查字节数及 SHA-256。部署前核对活动任务、原配置与候选就绪，保留原版本回退路径。',
'实际截图、交互 GIF 和 MP4 来自本轮真实界面，保留原失败尝试和脚本版本。服务器凭证继续明文保存在用户要求的 /root/cfg/ 私有目录，不提交到仓库。',
'七个独立仓库按对应分支及 docs/main 普通推送，并回读远端；保留用户文件和无关分支。专业、外部与完整生产验收继续按 32 组／102 条追溯。'],[
'Complete the implementation batch before six-component builds, type checks, regression and actual client journeys. 519 relevant tests pass; selected backend checks are not mislabeled as the complete historical matrix.',
'Immutable Windows Setup/Portable and Extension ZIP downloads are linked publicly and checked by complete byte count and SHA-256. Deployment checks active work, existing configuration and candidate readiness, retaining the prior rollback path.',
'Actual screenshots, interaction GIFs and MP4s come from this round’s real interfaces. Original failures/scripts remain. Server credentials stay in the user-requested private /root/cfg/ directory and are excluded from Git.',
'Publish seven independent repositories to their component branches and docs/main using ordinary pushes with remote readback, preserving user files/unrelated refs. Professional, external and full production acceptance retain all 32 groups/102 requirements.'])}
media={'web':('197-v2-task-review.png','workmate-197-v2-task-review'),'desktop':('197-v2-native-execution.png','workmate-197-v2-local-workspace'),'admin':('197-service-readiness.png','workmate-197-v1-service-review'),'extension':('197-v2-side-panel.png','workmate-197-v2-side-panel')}
flow='''```mermaid
flowchart LR
  A[Sign in / 登入] --> B[Organization and project / 企業與項目]
  B --> C[Role and permission / 角色與授權]
  C --> D[Original task / 原工作]
  D --> E[Review result and usage / 審閱與費用]
  E --> F[Explicit next action / 明確下一步]
```
'''
for name,(version,zh_title,en_title,zh,en) in entries.items():
 repo=dev/('copypaste-'+name)
 for english in [False,True]:
  p=repo/('README.en.md' if english else 'README.md');old=p.read_text(encoding='utf8');assert '<!-- integrated-round-197 -->' not in old
  text=f'<!-- integrated-round-197 -->\n\n## 197 · {version} · '+(en_title if english else zh_title)+f'\n\n[Delivery and limits / 交付與範圍]({report}) · [Downloads / 下載](https://agent.copypaste.hk/downloads)\n\n'
  text+='\n'.join(f'{i}. {line}' for i,line in enumerate(en if english else zh,1))+'\n\n'+flow+'\n'
  if name in media:
   png,stem=media[name]
   for file in [png,stem+'.gif',stem+'.mp4']:assert (repo/'assets/screenshots'/file).is_file(),file
   text+=f'![Actual interface / 實際頁面](assets/screenshots/{png})\n\n![Actual interaction / 實際交互](assets/screenshots/{stem}.gif)\n\n[Actual recording / 實際錄影](assets/screenshots/{stem}.mp4)\n\n'
  text+=('Earlier sections are retained release history. Full external/professional/production acceptance remains open.\n\n' if english else '下方保留較早版本記錄。完整外部、專業與生產驗收仍開放。\n\n');p.write_text(text+old,encoding='utf8')
for english in [False,True]:
 p=root/'docs'/('README.en.md' if english else 'README.md');old=p.read_text(encoding='utf8');assert '<!-- integrated-round-197 -->' not in old
 p.write_text('<!-- integrated-round-197 -->\n\n'+('Round197: isolated company transport, bounded recovery, proven pre-turn settlement and compact native review. Six builds and 519 selected tests pass; full original acceptance remains open.' if english else '197 轮：公司连接隔离、有界恢复、持久零准入结算和本机结果审阅。六端构建及 519 项相关测试通过；完整原始验收仍开放。')+'\n\n[交付 / Delivery](quality/integrated-round-197/README.md) · [完整追溯 / Scope](quality/integrated-round-197/requirements-102.md) · [更新 / Changes](changes/197-connection-and-native-review.md)\n\n'+old,encoding='utf8')
(root/'docs/changes/197-connection-and-native-review.md').write_text('''# 197 · 公司连接恢复与本机结果审阅

先完成整批代码，再统一六端构建、Desktop 主进程／渲染类型检查及 519 项相关测试。Desktop0.7.7 使用隔离公司 Chromium Session、有限只读／心跳恢复、折叠指令和输出；Web0.5.3 移除重复执行面板。Backend0.5.4 仅在持久证明未准入回合且六类准入和费用／token 全为零时释放预留，不修改已准入或旧未知账务。

实际发布包验证登录、公司私人文件往返、本机 Codex 与费用、撤权和当前本机预览；Extension0.5.6 验证真正的浏览器右侧栏和附件上传。Admin0.5.2／Delivery0.5.3 配套更新。实际媒体、公开完整下载和服务器回读见本轮证据，不以单次网络成功推定长期稳定性或完整应用对标已验收。

[证据与边界](../quality/integrated-round-197/README.md) · [需求](../requirements/197-connection-and-native-review-round.md) · [开发](../development/197-connection-and-native-review.md)

English: Ships isolated company transport, bounded read/heartbeat recovery, durable pre-turn zero-admission settlement and compact native review after a complete implementation batch. Six builds and 519 selected tests pass. Original failures, uncertain history and complete external/professional/production acceptance remain visible.
''',encoding='utf8')
print(json.dumps({'status':'updated','bilingual_repository_readmes':12,'actual_media_repositories':4}))
