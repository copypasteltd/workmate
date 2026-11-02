# 190 · 当前线上体系复测 / Current system recheck

复测日期：2026-11-03（Asia/Taipei）。结论：仍有实际运行问题、功能缺口及未完成验收，不能判定整套应用完全符合需求或零错误。本轮没有修改产品、重启服务、调整费用或发起新的付费模型任务。

## 编号问题清单

P1 表示影响核心使用或需要优先处理；P2 表示业务接入、交付或正式验收缺口。列表按问题范围分组，不将每项都称为代码缺陷。

|编号|优先级|模块|类别|当前证据与影响|
|---|---|---|---|---|
|01|P1|公网访问|已复现故障|首次本机访问用户端及后台超时，后续三域名均200；服务器对两公网IPv4的12次请求中10次超时；浏览器后台健康检查亦超时。四个源站入口均200。公网稳定性未解决，尚未定位到唯一责任节点。|
|02|P1|Desktop真实本机Agent|真实闭环未通过|最近真实供应商任务出现流连接中断或本机请求失败；本机Codex、无边框窗口、PKCE及主动完整权限已验证，但“真实模型→本机操作→结果→结算”未取得完整通过。本轮只重新核对既有失败任务，不声称重新执行了本机业务任务。|
|03|P1|Desktop错误回传|已确认实现缺陷|既有真实失败任务仍为failed，但服务端error_code及client_error为空；上报结构没有错误码字段，结算更新也没有写入错误码。用户和管理员无法可靠获知失败原因。|
|04|P1|云端程序执行|线上功能不可用|服务器为Linux/Node24，批准配置绑定Windows/Node22；实际cloudProgramAvailable()为false。不能把生成源码当作云端可运行、可执行验证的软件开发闭环。|
|05|P1|云端浏览器执行|线上功能不可用|批准浏览器运行器绑定Windows；实际cloudBrowserAvailable()为false。云端网页交互及浏览器预览/验证尚不可用。|
|06|P2|Office文档预览|线上平台限制|Office渲染路径显式限定win32；Linux源站无法使用该Office渲染器。此项不表示PDF预览或原文件下载都不可用。|
|07|P1|待对账任务与容量|未结运营事项|测试企业仍有两条Desktop reconciling任务，正好占满该企业tenant_slots=2；所检查的自有QA范围另有3条unknown供应商请求未释放容量。后续任务存在排队阻塞；不能以删记录或假定零费用释放财务预留。|
|08|P2|生成式视频|真实接入未完成|公共配置services.video=false，且没有已发布真实视频能力。模板视频/FFmpeg能力不等同于已接通生成式视频模型。|
|09|P2|语音与转写|真实接入未完成|services.speech和services.transcription均为false，没有对应真实模型发布，不能完成真实配音/转写验收。|
|10|P2|Google Ads / GA4 / Search Console|真实接入未完成|Google OAuth和Ads developer token均未配置，尚无正式账户同步与数据对照证明；CSV广告分析通过不代表Google接口联通。|
|11|P2|Meta广告与社交发布|真实接入未完成|Meta应用及发布应用凭据未配置，正式账户读写和发布闭环尚未验收。|
|12|P2|Desktop正式分发与更新|交付缺口|0.7.3只有开发构建/目录包，没有新的已签名安装器与正式更新渠道发布。既有冻结v0.1.3安装包保留，不能当作包含全部当前修改的新安装包。|
|13|P2|最终版本完整验收|验证缺口|最近完整后端运行1950项，1949通过、1失败；该超时问题之后14/14定向通过，但最终修改后未再跑全量。完整权限、恢复、大文件及专业交付矩阵也未全部关闭，不能用定向通过替代完整验收。|
|14|P2|正式运行配置与邮件|配置边界，部分按约定保留|线上NODE_ENV=development、DEV_MAILBOX=true，尚未切换正式运行配置；SMTP没有配置。测试收件箱按用户要求保留，且本轮新验证码收取和登录均成功，所以不再列为“测试邮件收不到”故障。|

## 本轮实际通过及范围

- 服务器Web63070、Admin63071、API入口63072及应用63073均HTTP200，kernel=codex、data_mode=configured_services；DEMO_MODE=false。
- 19项新增浏览器检查18通过、1次后台健康读取超时；管理员新的邮箱OTP+TOTP及用户新的邮箱OTP均完成，关键读取接口和六个实际页面通过，没有捕获到页面脚本异常。浏览器经自有SSH CONNECT访问真实域名，保留正常证书验证；此路径不能替代普通公网可用性。
- 两个当前发布模型为gpt-6-luna和gpt-image-2，各自有Key配置，最近真实验证均passed。既有真实图片任务仍succeeded，实际公司扣费HK$0.039961未变化。本轮读取既有交付状态，没有再次生成或下载图片。
- 角色目录有19个预设，满足数量要求；目录available并不是所有专业业务、外部服务和操作系统能力都已验收的证明。
- 最近Web28/28、Admin20/20、Extension89/89、Desktop269/269及构建结果沿用189原始范围。复测时核对250个来源摘要全部相同；随后仅更新了其中4份README说明，其余246个来源摘要保持一致，产品源码未改，没有重跑这些套件。Web云文字、Extension右侧栏获准文件上传/云端分析/下载，以及后台CRUD、批量操作、逐模型API/Key管理和VIP操作沿用188/189真实证据，不称为本轮再次执行写操作。
- 没有在本轮执行新的供应商Desktop任务或全量后端回归；最近失败与其后定向修复记录原样保留。此报告不构成所有潜在错误均已找到的保证。

本轮浏览器、上下文及自有CONNECT进程已关闭；没有使用Docker、WSL或其他本地虚拟化。公司API Key、OTP、TOTP及会话未写入公开证据。

首次记录工具v1在README更新后校验旧版说明摘要，触发预条件失败，尚未复制证据或修改线上数据。保留原工具，v2只允许明确列出的4份本轮README说明变化并记录其余246项一致；该整理失败不算产品故障。

[机器记录](190-system-recheck.json) · [上轮真实图片及回归](../development/189-real-image-and-acceptance.md) · [原完整验收范围](remaining-work-stage165.md)

## English

Fresh checks confirm intermittent public timeouts despite healthy origins, unavailable Linux cloud program/browser runtimes, an unresolved supplier-backed Desktop workflow, missing Desktop error codes, and pending QA reconciliation/capacity. Video/audio and Google/Meta integrations, current signed Desktop delivery, production configuration and complete final acceptance remain open. The requested protected test mailbox received fresh codes successfully. Eighteen of nineteen fresh browser checks passed; the failed readiness request is retained. Prior source-bound test evidence is reused explicitly, not rerun or relabelled. No product deployment, new paid task or financial changes occurred.
