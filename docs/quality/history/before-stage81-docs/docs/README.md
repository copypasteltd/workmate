# Workmate · CopyPaste Enterprise Agent

<!-- generated-video-stage80 -->
## 生成式影片、费用控制与紧凑桌面布局

主文档组织完整需求、三端使用与独立后台和后端。

### 本地启动

以下命令在已检出的对应仓库内执行。完整工作区将六个独立仓库并列放在 `dev/`，见[分支与检出布局](governance/04-git-branches-and-publication.md)。使用 Windows x64、Node.js >=22.14、npm/Git，以及文档约束的原生 PostgreSQL、FFmpeg/FFprobe 与固定 Codex 资源；保留已有本地配置和数据，不使用 Docker/WSL/虚拟机。

```powershell
Set-Location 'D:/dev/copypasted/自有agent/dev/copypaste-delivery'
npm ci
npm run bootstrap
npm run demo
```

Web 为 `http://localhost:4317`，Admin 为 `http://localhost:4318`；API 端口 4310、控制器 4319、原生 PostgreSQL 55432。结束时使用 `npm run stop`，仅关闭控制器自建进程并正常停止数据库。内置示范模拟文本/图片并可使用剪辑/模板影片；生成式影片须配置公司契约，当前生成验收使用明确的媒体夹具。本机 Desktop 另需独立固定的原生内核。

### 当前使用流程

1. 使用现有邮箱/验证码流程登录，选择企业/项目，创建「影片与动效」专家任务。新任务固定 R16 1.2.0 与 `video-generation` Skill；旧任务保留原角色和 Skill，使用生成式能力时需新建任务。
2. 在 Web 或 Desktop 选择「生成式影片」、时长（4/8/12/16/20 秒）及横向/纵向/正方形，填写需求并确认任务预算。模板/FFmpeg 合成是独立选项。Desktop 设置默认收起，展开后采用紧凑面板，留出会话和输入空间。Extension 在同一企业/项目的任务历史中打开已有云端影片任务，使用状态、播放和保存操作。
3. Codex 经公司内部服务调用。提交 HTTP 前持久保存原 operation 和报价，与推理/图片共用同一任务预算。输入计数、推理、图片与视频也共用准入限制；已完成调用释放并发后仍计入分钟速率，独立审核确认的终止事实参与并发计数，原请求记录保留。只显示服务回报的真实进度。用量未确认或结果不明时保留原预留，缺失 usage 不计为免费。
4. 「停止这次生成」只取消同一原作业，之后确认的用量仍可能产生费用。重试/恢复查原 operation，不重提生成。真实状态变化拒绝旧控制版本；后台续租和无变化的轮询不会使用户操作过期。
5. 完成状态须通过真实摘要、大小、格式、尺寸、时长及原生完整解码后才交付。可播放、保存真实 MP4；源文件隔离、成果撤回或授权失效后移除当前预览及下载，不用虚构文件冒充成功。内嵌预览限制 20 MB。
6. Admin 进入「调用管理 → 生成式影片作业」。元数据、费用和原作业重查按独立权限及企业/项目范围控制；重查需要近期 MFA、原因和审计，不发起新生成，也不获得提示词、参考图或视频正文。原任务费用结算保留独立审批与不可变用量事实。

升级前在后端执行 `npm run db:migrate` 应用新增 **SQL097**。已发布 SQL001–096 与两份原 OpenAPI 各自字节保持。配置公司 `AI_BASE_URL`、允许域名/密钥、精确 `AI_VIDEO_MODEL`、显式 `AI_VIDEO_VERIFIED`、正数秒费率 `AI_VIDEO_HKD_MICROS_PER_SECOND` 及可选回调签名密钥。公司能力未显式配置/核验时仅生成步骤不可用，凭据不进入渲染器或 Extension。公开 Sora 2/Videos API 已于 2026-09-24 停用，`company-video-jobs-v1` 是公司内部契约，不静默切换公开供应商。完整的管理后台视频能力验证/发布流程仍需补齐。

Desktop 无原生边框和 Electron 菜单，产品界面不出现可见纵向或横向滚动条。内容保持滚轮、Home/End、键盘聚焦、换行及最后操作可达；实际检查 800×600、1280×800、1440×980，英文/繁中及浅深主题。真实任务与视频进度保留。Codex 在客户本机执行，完整本机权限由客户主动授予并可撤销。Extension 保留原生右侧 Side Panel 和云端 Codex，不依赖 Desktop 或本地 Agent。

验证：平台 **912/912** 项，保留原 874 项；影片/网关专项 **60/60**；客户端单元 **69**；打包 Desktop **32**、Web/Admin **5**、原生侧栏 **9**；本机监督进程 **17/17**。各计数范围独立，不相加为产品验收。原生 Codex、身份、数据库、文件、媒体解码与账本是真实执行，模型推理/视频内容、客户数据与部分原生同意决定为明确夹具。自建浏览器/数据库均关闭，未使用 Docker/WSL/虚拟机。原 **102 REQ/102 TC 为 83 部分验证、19 未证明、0 完整验收**；真实公司媒体、完整 TC-019/TC-056、全部专业角色及 G01–G10 仍保留。

平台完整 70 文件、18 批采用已审查的同源码复核：一批遇到 Windows 1455 资源错误后，四个文件在新的自建数据库全部重跑通过；其余十七个完整通过批次的源码、测试、工具及内核字节完全相同。原失败尝试继续标记失败，不计入通过；每份选用回执保留原计划摘要，原始 TAP 不拼接、不改标。

[方案与协议](technical/80-generated-video-jobs.md) · [精确证据](quality/generated-video-checkpoint.json) · [增量接口](contracts/generated-video-openapi.json)

```mermaid
flowchart LR
    SignIn[Sign in and select workspace] --> Client[Web / local Desktop / Side Panel]
    Client --> Codex[Cloud or customer-device Codex]
    Codex --> Intent[Original durable operation]
    Intent --> Budget[Shared task budget]
    Budget --> Company[Company internal video service]
    Company --> Observe[Query / signed observation / cancel]
    Observe --> Validate[Actual MP4 decode and immutable file]
    Observe --> Cost[Confirmed cost or retained unknown hold]
    Validate --> Review[Authorized playback and save]
```

![实际截图](design/implementation/copypaste-desktop__workmate-local-38-generated-form-1440-en.png)

[交互 GIF](design/implementation/copypaste-desktop__workmate-local-38-local-agent.gif) · [实际录制 MP4](design/implementation/copypaste-desktop__workmate-local-38-local-agent.mp4)

<details>
<summary>阶段 79 历史文档与完整安装参考；旧计数保留原验证范围</summary>

[English](README.en.md) · [GitHub](https://github.com/copypasteltd/workmate)

<!-- brand-production-stage79 -->

## 固定品牌版本与生产检查

主需求、产品架构、独立仓库及验收导航。

1. 登录并选企业/项目，在 Web 或 Desktop 打开「品牌资料」。设置名称、色彩、字体及使用声明、核准产品事实/价格、促销期限、渠道/语言和可选固定 Logo 文件。上传字体须共享至当前项目。
2. 发布不可变版本。以后编辑会产生新版；并发旧版编辑报冲突。已有专家和任务继续使用绑定版本，需要升级时显式采用新的专家版本。
3. 选历史版本检查文字或固定事实。缺字定位到 Unicode 码点，过期促销或字体声明阻止新生产；价格事实使用存储文字和金额，不静默换字体或价格。
4. 绑定品牌的云端设计任务必须携带匹配的品牌/版本和渠道/语言。文字使用固定声明字体配置，显式引用事实键时使用存储文字和价格。产物保留来源依赖和可编辑 JSON；SVG 文字转路径，PNG 和有限的单页 PDF 审阅稿是真实渲染。字体登记只记录客户声明，不证明版权。

启动依赖客户端前，在已配置后端使用 `npm run db:migrate` 应用 **SQL096**。已发布 SQL001–095 与两份原有 OpenAPI 各自的字节保留。新增品牌契约包含四项操作；配置服务共 438 项，`DEMO_MODE=true` 时另有一项演示额度操作。旧品牌在当前权限下保留可读，不补造历史版本或许可；固定字体生产前需明确发布 v2 资料并采用新的专家版本，旧任务不自动改绑。

Desktop 在客户本机运行 Codex，提供明确可撤销的完整本机权限，无原生边框/菜单；纵横滚动条外观隐藏，同时保留滚轮、键盘、焦点定位及 800×600、1280×800、1440×980 实际窗口访问。保留真实进度。Extension 是云端 Codex 的原生右侧栏。全部 AI 请求经公司网关；测试后关闭自建浏览器，禁止 Docker/WSL/虚拟机。

当前分别通过：**平台 874/874 项**（68 文件/17 批，保留此前 861 项并新增 13 项）、客户端 68 项、打包 Desktop 30 项、品牌 Web 四项、Web/Admin 品质四项及原生侧栏八项。保留原生内核 17 项的 57 份绑定源码均未变化。数据库、身份、文件、账本和本机 Codex 真实运行，模型/客户/业务数据为明确夹具。原 102 REQ/102 TC 为 82 部分验证、20 未证明、0 完整验收；G01–G10、TC-056 真实客户盲审继续未证明。Desktop 品牌表单证据不等于全部本机专业角色的品牌约束已验收。

Desktop33、品牌 Web02 和 Web/Admin08 保留实际收据；其后只有一个未被这些旅程执行的扩展测试文件补充加载等待和登录诊断，前后字节及无关范围已单独核对。它们的应用/界面和执行旅程/验证器未变；新扩展运行及平台23使用更新后的测试文件，精确边界见检查点。

```mermaid
flowchart LR
    Library[Brand library] --> Version[Immutable brand version]
    Version --> Task[Frozen specialist and cloud task]
    Task --> Check[Actual font, fact, expiry and scope checks]
    Check --> Output[Source document and rendered output]
    Output --> Review[Versioned customer review]
    Sources[Current source permissions] --> Check
    Sources --> Output
```

![实际 desktop 客户端；客户/模型为明确夹具，控件与 API 写入真实执行](design/implementation/copypaste-desktop__workmate-local-33-layout-1440-en.png)

![Actual interaction / 实际交互](design/implementation/copypaste-desktop__workmate-brand-33-brand-library.gif)

[MP4](design/implementation/copypaste-desktop__workmate-brand-33-brand-library.mp4) · [Design / 方案](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/79-versioned-brand-production.md) · [Contract / 契约](https://github.com/copypasteltd/workmate/blob/docs/docs/contracts/brand-production-openapi.json) · [Evidence / 证据](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/brand-production-checkpoint.json) · [Changes / 更新](https://github.com/copypasteltd/workmate/blob/docs/docs/changes/2026-10-24-versioned-brand-production.md)

<details>
<summary>阶段 78 交付及完整安装参考：旧计数保留原验证范围</summary>

<!-- business-quality-stage78 -->

## 当前交付审阅与使用流程

主需求、架构、独立仓库与验收导航。 新增接受、需修改、弃用的版本化交付审阅；人工基线、累计投入和修改次数独立填报。项目用量与后台交付品质面板分别显示技术成功、客户接受、实际读取复用及公司服务成本。

Desktop 保持客户本机 Codex、明确可撤销的完整本机权限及无边框/无 Electron 菜单。隐藏纵横滚动条外观，保留真实滚轮/键盘访问；内容重排，800×600 下聚焦输入框、聊天输入区和费用回执可见。此前进度条约束已撤销，保留真实进度。Extension 仍为独立原生右侧栏，聊天及获准文件上传至云端 Codex；所有 AI 请求走公司网关。

1. 登录并选择企业/项目，在正确执行位置创建任务。Desktop 另选本机目录并明确授权；Extension 不要求安装 Desktop。
2. 查看真实结果，打开 Desktop「审阅本次交付」或任务评价表单，保存接受、需修改或弃用及可选意见。任务或交付换版时需重新载入后审阅。
3. 按需填写累计人工数字。空值为未知，0 为明确没有投入；保存后保留展开的表单与输入访问。
4. 在项目用量或 Admin「交付品质」查看当前有权范围；未确认费用不冒充完整成本。服务成本不含退款抵减、外部服务及人工，不推断 ROI 或续费。

上线依赖接口/界面前先应用增量 SQL095；SQL001–094 与原任务 OpenAPI 保持原样。未固定交付版本的旧接受状态需客户重新审阅。保留原评价接口，当前表单强制任务版本、交付摘要及幂等键。写评价需要项目 approve 权限；Admin 的 `admin.usage.read` 仅查看授权范围汇总，不能代客户接受、从汇总读取意见正文或授予 OS 权限。

```mermaid
flowchart LR
    Web[Web and native Chrome Side Panel] --> Cloud[Company cloud Codex]
    Desktop[Frameless Desktop] --> Local[Customer-device Codex and local tools]
    Cloud --> AI[Company OpenAI-compatible AI gateway]
    Local --> AI
    Cloud --> Delivery[Output and fixed artifact versions]
    Local --> Delivery
    Delivery --> Review[Customer review and human-effort records]
    Review --> Metrics[Scoped quality and service costs]
    Admin[Admin usage permission and explicit denies] --> Metrics
```

当前源码验证：平台 861/861 项（67 文件/17 批）、客户端 68 项、实际打包 Desktop 26 项、Web/Admin 四项及原生侧栏 8 项分别通过，不相加。保留的 17 项原生内核证据中 57 份绑定源码均未变化。身份、数据库、文件、费用和本机 Codex 真实运行；模型/业务/客户输入与系统对话框决定明确为夹具。TC-056 真实任务基线/盲审、18 角色/29 Skill 的全专业交付、完整 OS/Codex Desktop 对齐及生产门槛继续未证明；原 102 REQ/102 TC 和 81 部分/21 未证明/0 完整验收保持。

Desktop31 与 Web/Admin07 保留原始执行记录；其后仅一份迁移测试中的两个版本期望值从 94 更新为 95，前后字节已归档并逐字核对，运行代码、界面和旅程脚本均未变化。平台21重新执行更新后的全套测试；该保留证据边界见检查点。

![Actual frameless Desktop at 1440 by 980](design/implementation/workmate-local-31-layout-1440-en.png)

![Actual desktop interface](design/implementation/workmate-local-31-delivery-review-compact-en.png)

![Actual desktop interaction](design/implementation/workmate-local-31-local-agent.gif)

[MP4](design/implementation/workmate-local-31-local-agent.mp4)

[Design](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/78-business-delivery-quality.md) · [Contract](https://github.com/copypasteltd/workmate/blob/docs/docs/contracts/business-quality-openapi.json) · [Exact source and media evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/business-quality-checkpoint.json) · [Changes](https://github.com/copypasteltd/workmate/blob/docs/docs/changes/2026-10-23-business-delivery-quality.md)

<details>
<summary>完整安装、架构与历史验证记录（较早计数和截图保留原时点范围）</summary>

面向香港企业的 Codex Agent 平台，首批面向现有客户的 marketing 团队。云端 Web、Chrome 原生侧栏、完整无边框 Desktop 共用公司身份、业务控制及内部 OpenAI 兼容网关；Admin 管理用户、内容、消耗、费用与 VIP。

<!-- client01-direction -->
## 当前客户端方向与实现差异

CLIENT01（2026-10-22）要求 **Desktop 在客户本机运行 Codex Agent**，提供客户可主动授予的 **完整本机权限**，操作能力对标 Codex Desktop。**Extension 在 Chrome 原生右侧栏采用 ChatGPT 式对话/附件结构**，获取、读取用户获选文件并上传，由云端 Codex 执行。全部产品 AI 请求仍走公司内部网关。

**阶段 77 历史实现：** Desktop 在客户本机运行 Codex，提供客户明确完整授权、本机文件/终端、同线程继续、原生追问、公司设计/视频工具与本机父子流程。新增十二项本机浏览器工具，可真实导航、操作、上传、截图和下载；停止/撤权回收任务页面。Desktop 隐藏可见滚动条，成果、代码和表格自动换行，保留纵向滚动与键盘访问；已撤销此前进度条约束，保留真实进度反馈。当前分别验证平台 851 项、客户端 68 项、原生内核 17 项、独立 Electron 浏览器 10 项和实际打包旅程 25 项，不相加。18 角色/29 Skill 的完整专业交付、全部 OS 应用与 Codex Desktop 全面能力对齐、真实模型及生产验收仍待证明。Extension 继续独立的 ChatGPT 式原生右侧栏、获准文件上传与云端 Codex，本轮未重跑其 UI。见 [方案](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/77-desktop-native-browser.md)、[界面约束](https://github.com/copypasteltd/workmate/blob/docs/docs/requirements/04-desktop-layout-and-scroll.md)及 [源码/媒体检查点](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-browser-checkpoint.json)。

本机 supervisor 的实现及历史原生权限测试见 [技术说明](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/70-desktop-native-codex-supervisor.md)。

<!-- /client01-direction -->

## 仓库和分支

每个端保留独立 Git 历史和仓库根目录。多端同时运行时分别检出到不同目录。主文档相同提交发布到 `main` 与 `docs`。

| Branch | Directory under `dev/` | Responsibility | README |
| --- | --- | --- | --- |
| [backend](https://github.com/copypasteltd/workmate/tree/backend) | `copypaste-platform` | Backend / API · Codex · 数据与计量 | [中文](https://github.com/copypasteltd/workmate/blob/backend/README.md) / [English](https://github.com/copypasteltd/workmate/blob/backend/README.en.md) |
| [web](https://github.com/copypasteltd/workmate/tree/web) | `copypaste-web` | Web · 云端用户工作台 | [中文](https://github.com/copypasteltd/workmate/blob/web/README.md) / [English](https://github.com/copypasteltd/workmate/blob/web/README.en.md) |
| [admin](https://github.com/copypasteltd/workmate/tree/admin) | `copypaste-admin` | Admin Dashboard · 管理与运营 | [中文](https://github.com/copypasteltd/workmate/blob/admin/README.md) / [English](https://github.com/copypasteltd/workmate/blob/admin/README.en.md) |
| [desktop](https://github.com/copypasteltd/workmate/tree/desktop) | `copypaste-desktop` | Desktop · 无边框原生客户端 | [中文](https://github.com/copypasteltd/workmate/blob/desktop/README.md) / [English](https://github.com/copypasteltd/workmate/blob/desktop/README.en.md) |
| [extension](https://github.com/copypasteltd/workmate/tree/extension) | `copypaste-extension` | Extension · Chrome 原生侧栏 | [中文](https://github.com/copypasteltd/workmate/blob/extension/README.md) / [English](https://github.com/copypasteltd/workmate/blob/extension/README.en.md) |
| [delivery](https://github.com/copypasteltd/workmate/tree/delivery) | `copypaste-delivery` | Delivery · 启动、验证、录制与发布 | [中文](https://github.com/copypasteltd/workmate/blob/delivery/README.md) / [English](https://github.com/copypasteltd/workmate/blob/delivery/README.en.md) |
| [docs / main](https://github.com/copypasteltd/workmate/tree/docs) | Project root · `docs/` | Requirements, architecture, delivery and release notes | [中文](README.md) / [English](README.en.md) |

## 架构与使用逻辑

下图为当前目标的执行分工；当前本机候选包的执行、权限与费用验证见本次检查点；旧包保持原范围。

```mermaid
flowchart TB
  User[Customer] --> Web[Cloud Web]
  User --> Side[Chrome native Side Panel]
  User --> Desktop[Frameless Desktop]
  Operator[Administrator + MFA] --> Admin[Admin Dashboard]
  Web & Side & Admin --> API[Company Backend]
  Desktop --> API
  Desktop --> LocalCodex[Customer-device Codex / native candidate]
  LocalCodex --> LocalTools[Local files / terminal / skills]
  LocalCodex --> Gateway[Internal OpenAI-compatible API]
  LocalCodex --> MainTools[Company tools via trusted Desktop main]
  MainTools --> API
  API --> Access[Identity / tenant / project / private ownership]
  Access --> Input[Explicit sources / role / skills / version]
  Input --> Budget[Plan / permission / budget hold]
  Budget -->|Web / Extension cloud tasks only| Codex[Cloud version-pinned Codex]
  Codex --> Gateway[Internal OpenAI-compatible API]
  Codex --> Tools[Authorized tools]
  Tools --> Results[Immutable outputs / usage / settlement]
  Results --> Clients[Governed client reads and downloads]
```

以下为平台通用流程；Desktop 的本机授权、持续线程及公司业务工具使用流程见阶段 73 方案和本次证据。

1. 邮箱验证码登录后选择企业和项目，确认当前权限与费用来源。Desktop/Extension 经公司网页和 PKCE 授权；Admin 使用独立邮箱 OTP/TOTP 身份。
2. Web/Extension 选择默认助手、18 个角色预设或私人专员；Desktop 当前选择 17 个已接通本机协议的预设。任务固定角色、Skill、模型和费率版本，明确选择文件、品牌资源和授权连接。
3. 确认有界预算后执行；Codex 调用公司接口及受控工具。已记录用量、预算预留、最终扣费分别展示。
4. Web/Extension 明确计量且已完成的回合需要资料时，选择当前获准版本，沿用原任务、线程与预留继续；限制八轮、三十二项依赖。Desktop 支持同一本机线程继续，并可在原任务/回合回答原生追问；两类任务的未知结果均进入核对。
5. 查看证据和产物，经认证下载或明确发布独立副本；当前来源治理继续生效。切换范围或读取失败会清空旧内容。
6. 管理员按范围筛选用户和消耗，管理内容、费用与 VIP/额度；敏感操作预览影响，采用幂等命令及必要的独立审批。

## 业务范围

营销创作覆盖生图、品牌版式、字体、广告/电商/社交素材、演示、可编辑交付及模板视频。分析覆盖 CSV/XLSX 导入、广告指标、Google/Meta 连接流程，以及有范围的网站诊断、证据、修改草稿和复查。企业流程涵盖助手、会话、记忆、计划、文件和通知。角色目录有 18 个预设；计划 Skill 与完整专业交付资格另行跟踪。

## 初次检出和本地运行

已有唯一工作区为 `D:\dev\copypasted\自有agent`，不要覆盖现有仓库。新设备在全新根目录检出 `docs`，再按上表在 `dev/` 检出各端分支。使用原生 Windows 工具，禁止 Docker、WSL 和虚拟化。

```powershell
git clone --single-branch --branch docs git@github.com:copypasteltd/workmate.git workmate
cd workmate
New-Item -ItemType Directory -Path dev
git clone --single-branch --branch backend git@github.com:copypasteltd/workmate.git dev/copypaste-platform
git clone --single-branch --branch web git@github.com:copypasteltd/workmate.git dev/copypaste-web
git clone --single-branch --branch admin git@github.com:copypasteltd/workmate.git dev/copypaste-admin
git clone --single-branch --branch desktop git@github.com:copypasteltd/workmate.git dev/copypaste-desktop
git clone --single-branch --branch extension git@github.com:copypasteltd/workmate.git dev/copypaste-extension
git clone --single-branch --branch delivery git@github.com:copypasteltd/workmate.git dev/copypaste-delivery
cd dev/copypaste-delivery
npm ci
npm run bootstrap
npm run demo
```

访问 Web `http://localhost:4317`、Admin `http://localhost:4318`；API `4310`、自有控制器 `4319`、原生 PostgreSQL `55432`。使用 `npm run stop` 关闭自有演示服务。独立启动、管理员登记、Desktop 打包和扩展加载见各端 README。需要 Node.js ≥22.14 与锁定依赖；原生验证另需固定 Codex 及 FFmpeg/FFprobe。

## 验证与边界

历史源码平台完整回归 **802/802**（后端已更新，此回执不作为新源码的完整回归）、统一任务专项 **52/52**，保留原 782 项命名测试；二者重叠，不相加。六仓库类型/构建/既有客户端测试 **13 项**、实际打包 Desktop/原生 Side Panel 旅程 **32 项**通过。阶段 72 的 10 项原生监督器和 7 项 Electron 检查保留原源码范围；阶段 73 的 818 项平台、14 项真实原生、37 项客户端及 9 项打包旅程保留原始源码范围，阶段 74 时后端源码未变；阶段 74 另验证当时 Desktop 的 47 项客户端、17 项真实原生及 12 项打包旅程。完整资格仍按新检查点跟踪。较早的四端媒体仍记录原云端/文件桥接源码范围；本次另有本机公司工具媒体，分别绑定捕获时间、摘要及清理结果。

[统一任务证据](quality/canonical-task-checkpoint.json) · [本机内核证据](quality/desktop-video-checkpoint.json) · [本机候选包字节](quality/desktop-video-checkpoint.json) · [媒体](quality/workmate-media-10.json) · [原需求进度](quality/requirements-alignment-progress.json)

UI 演示中的 AI 回合、供应商与业务事实按授权明确模拟；独立集成测试通过模拟内部网关运行真实 Codex 子进程。Admin 媒体展示受权限约束的 VIP/费用表单，不代表财务提交。SQL001–092 保持不可改写。全部 102 项需求、TC/NFR/G01–G10 及 81 局部验证/21 未证明完成/0 完整验收基线保留；统一任务的专用输入及历史身份迁移、任意执行中暂停、未知结果恢复、完整本机 Desktop 与扩展对话附件、全角色工作流、GEO、真实供应商、生产、签名与商店资格继续跟踪。

## 实际客户端展示

以下为实际运行页面及 GIF，模拟范围如上。扩展捕获的是已确认原生 Side Panel 的文档视口，不含浏览器工具栏。录制保留实际捕获时间。

### Web

![web](design/implementation/workmate/web-workmate-10-input-ready-en.png)

![web interaction](design/implementation/workmate/web-workmate-10-interaction.gif)

[MP4](design/implementation/workmate/web-workmate-10-interaction.mp4)

### Desktop

阶段 75：实际本机视频、版本修改、预览/原生保存、停止和撤权，以及既有本机追问、文件和公司图片流程；模型/图片及系统窗口决定为明确夹具。其他客户端媒体保留历史源码范围。

![desktop](design/implementation/workmate-local-19-full-access-en.png)

![Company design artifacts](design/implementation/workmate-local-19-company-artifacts-en.png)

![Minimum native window](design/implementation/workmate-local-19-compact-en.png)

![Native customer question](design/implementation/workmate-local-19-waiting-input-en.png)

![Explicit answer at minimum window size](design/implementation/workmate-local-19-input-compact-en.png)

![Actual private video playback](design/implementation/workmate-local-19-video-ready-en.png)

![Native video at 800x600](design/implementation/workmate-local-19-video-compact-en.png)

![Revoked native video](design/implementation/workmate-local-19-video-revoke-en.png)

![desktop interaction](design/implementation/workmate-local-19-local-agent.gif)

[MP4](design/implementation/workmate-local-19-local-agent.mp4)

### Extension

![extension](design/implementation/workmate/extension-workmate-10-sidepanel-native-en.png)

![extension interaction](design/implementation/workmate/extension-workmate-10-interaction.gif)

[MP4](design/implementation/workmate/extension-workmate-10-interaction.mp4)

### Admin

![admin](design/implementation/workmate/admin-workmate-10-user-usage-en.png)

![admin interaction](design/implementation/workmate/admin-workmate-10-interaction.gif)

[MP4](design/implementation/workmate/admin-workmate-10-interaction.mp4)

## 文档导航

[Reading order](00-document-map.md) · [PRD](product/01-prd.md) · [Roles/Skills](product/06-role-templates-and-skill-presets.md) · [Brand](product/07-brand-design-system.md) · [Admin](product/08-admin-dashboard.md) · [API contracts](contracts/README.md) · [Delivery](DELIVERY.md)

### Product

- [产品需求文档 PRD](product/01-prd.md)
- [用户旅程与业务流程](product/02-user-journeys.md)
- [信息架构、页面与交互规格](product/03-information-architecture-and-interactions.md)
- [发布路线与商业模型](product/04-release-and-commercial-model.md)
- [Web Agent 工作台需求](product/05-web-agent-workbench.md)
- [预设角色与 Skill 模板需求](product/06-role-templates-and-skill-presets.md)
- [CopyPaste 品牌与产品设计规范](product/07-brand-design-system.md)
- [Admin Dashboard 产品与交互规格](product/08-admin-dashboard.md)

### Modules

- [模块总览与职责边界](modules/00-catalog.md)
- [M01 企业、工作空间、身份与权限](modules/01-identity-workspaces-permissions.md)
- [M02/M03 持续 Agent、任务与记忆](modules/02-agents-tasks-memory.md)
- [M04 品牌、文件与交付资产](modules/03-brand-assets-and-deliverables.md)
- [M05 营销图片、视频、字体与特效](modules/04-marketing-production.md)
- [M06 广告、网站、SEO 与 GEO 分析](modules/05-analytics-seo-geo.md)
- [M07/M08 外部连接与企业流程](modules/06-connectors-workflows.md)
- [M09/M10 三端客户端、设备与执行](modules/07-web-extension-desktop.md)
- [M11/M12 内部 AI、费用、权益与运营](modules/08-usage-billing-admin.md)

### Technical

- [技术架构与技术栈](technical/01-architecture-and-stack.md)
- [Codex 内核与内部 AI 网关集成](technical/02-runtime-and-ai-gateway.md)
- [数据模型、约束与生命周期](technical/03-data-model-and-lifecycle.md)
- [产品 API、事件与错误契约](technical/04-api-and-event-contracts.md)
- [原生执行器、设备协议与浏览器生命周期](technical/05-local-executor-and-browser.md)
- [媒体、数据与分析管线开发设计](technical/06-media-and-data-pipelines.md)
- [权限、执行与数据边界设计](technical/07-security-and-permissions.md)
- [开发实施与交付指南](technical/08-development-and-delivery.md)
- [部署、发布与运维手册](technical/09-operations-runbooks.md)
- [前端品牌规范与设计系统集成](technical/10-frontend-design-system.md)
- [Admin 控制面、权限与账务实施设计](technical/11-admin-control-plane.md)
- [实际开发、独立仓库与交付](technical/12-implementation-and-repositories.md)
- [持续 Agent、会话与记忆的实现约束](technical/13-persistent-agents-conversations-memory.md)
- [管理员邀请、MFA 与账号生命周期](technical/14-admin-identity-lifecycle.md)
- [云端工作流程定时执行](technical/15-cloud-workflow-schedules.md)
- [企业身份联邦与原生端授权](technical/16-enterprise-federation-and-native-auth.md)
- [删除、文件传输、保留与实时事件的当前实现](technical/17-erasure-transfer-retention-events.md)
- [持久云文件、版本引用与 Codex 工作源码](technical/18-persistent-cloud-files.md)
- [项目技能安装、版本绑定与安全撤销](technical/19-project-skill-lifecycle.md)
- [站内通知、任务定位与当前权限](technical/20-in-app-notifications.md)
- [默认助手与首次委派](technical/21-default-assistant-and-first-delegation.md)
- [运行前资料补齐检查点](technical/22-pre-execution-input-checkpoint.md)
- [执行容量、企业公平调度与排队](technical/23-execution-capacity-and-fair-dispatch.md)
- [Admin 记录分页、撤权显示与原生测试隔离](technical/24-admin-record-pages-and-test-isolation.md)
- [持久角色模板、依赖预检与 Codex 版本绑定](technical/25-role-template-registry-and-runtime-binding.md)
- [设计 PDF 审阅稿与可编辑源文件](technical/26-design-pdf-review-delivery.md)
- [营销 CSV、冻结指标与证据交付](technical/27-marketing-import-metrics-and-evidence.md)
- [AnalysisSpec 报告任务与冻结证据](technical/28-analysis-report-tasks-and-evidence.md)
- [CSV／XLSX 文件版本导入与更正链](technical/29-file-imports-and-correction-lineage.md)
- [Desktop 无边框窗口与 Chrome 原生侧栏](technical/30-native-window-and-browser-sidepanel.md)
- [排队暂停、同任务恢复与 Codex 原生续聊](technical/31-task-controls-and-native-continuation.md)
- [跨端会话、设备撤销与退出竞争修复](technical/32-cross-client-sessions-and-revocation.md)
- [规范认证接口与未知响应恢复](technical/33-canonical-authentication-and-retry-recovery.md)
- [用户资料契约、工作区初始化与并发清理](technical/34-user-profile-context-and-orphan-scan-races.md)
- [邀请与成员权限闭环](technical/35-invitations-and-membership-authority.md)
- [Admin 成员控制与不可变策略快照](technical/36-admin-membership-control-and-policy-snapshots.md)
- [Admin 账户生命周期与在途任务控制](technical/37-admin-account-lifecycle-and-inflight-control.md)
- [后台规范目录、字段范围与确认扣费](technical/38-admin-canonical-directories-and-scoped-usage.md)
- [授信、资金批次与实际结算来源](technical/39-billing-credit-and-settlement-provenance.md)
- [个人、企业付款账户与真实账务事件](technical/40-billing-subjects-and-financial-event-provenance.md)
- [规范费用命令与独立审批](technical/41-canonical-fee-commands-and-independent-approvals.md)
- [当前成员页面与原生认证恢复复核](technical/42-current-membership-ui-and-native-auth-recovery.md)
- [后台统一审批请求与原始契约](technical/43-shared-admin-approval-requests.md)
- [付款凭据、独立核实与准确入账](technical/44-manual-payment-evidence-and-exact-posting.md)
- [原交易退款、资金来源补偿与独立付款核实](technical/45-source-bound-refunds-and-cash-reconciliation.md)
- [不可变方案版本、发佈审批与历史授权绑定](technical/46-immutable-plans-and-legacy-grant-bindings.md)
- [规范 VIP 授权与实时有效权益](technical/47-canonical-vip-lifecycle-and-effective-entitlements.md)
- [企业席位与存储的实际约束](technical/48-enterprise-seat-and-storage-enforcement.md)
- [VIP 与显式赠额的原子组合开通](technical/49-atomic-vip-and-explicit-credit.md)
- [费用变更的事务通知与三端账户视图](technical/50-durable-financial-notifications.md)
- [限时只读支持与用户授权](technical/51-controlled-read-only-support.md)
- [能力版本、模型选择与任务费率冻结](technical/52-capability-versions-and-frozen-task-pricing.md)
- [受控模型能力配置、验证与版本发布](technical/53-controlled-capability-releases.md)
- [用户明确采用专家、模型与费率版本](technical/54-explicit-agent-version-adoption.md)
- [内部 AI 请求的短期凭证与逐次鉴权](technical/55-scoped-internal-inference-requests.md)
- [持久供应商请求、容量与逐次预算](technical/56-durable-provider-request-control.md)
- [每次调用的预算与平台费用](technical/57-per-request-budget-enforcement.md)
- [调用策略、逐次请求与人工核对后台](technical/58-provider-admin-control-and-reconciliation.md)
- [营销设计批次与单元独立交付](technical/59-creative-production-matrices.md)
- [基础视频工程与原生成片](technical/60-template-video-production.md)
- [营销账户授权与持久同步](technical/61-marketing-connector-synchronization.md)
- [有范围约束的 SEO 诊断与复查](technical/62-scoped-seo-audits.md)
- [网站修改任务与来源治理](technical/63-source-governed-website-change-tasks.md)
- [任务详情、历史消息与来源访问边界](technical/64-task-source-visibility.md)
- [会话历史、实际读取与产物来源链](technical/65-conversation-content-source-lineage.md)
- [付费用量、补充资料与原任务续接](technical/66-paid-native-input-checkpoints.md)
- [仓库整理、实际交互媒体与分支交付](technical/67-repository-delivery-and-media.md)
- [统一任务接口与原任务输入事务](technical/68-canonical-task-contracts-and-input-transactions.md)
- [Desktop 本机 Codex 与 Extension 方向检查](technical/69-desktop-local-codex-and-extension-direction.md)
- [本机 Codex supervisor：原生实测与剩余接入](technical/70-desktop-native-codex-supervisor.md)

### Requirements

- [软件需求规格说明 SRS](requirements/01-srs.md)
- [非功能要求与服务指标](requirements/02-nonfunctional-and-service-levels.md)
- [CLIENT01：Desktop 本机执行及 Extension 对话附件](requirements/03-client-execution-amendment.md)

### Governance

- [决策、默认值与验证门槛](governance/01-decisions-assumptions-and-questions.md)
- [术语、权威定义与来源](governance/02-glossary-and-sources.md)
- [开发工作区与文档路径规范](governance/03-workspace-and-path-policy.md)
- [Workmate 仓库、分支与同步规则 / Repository and publication policy](governance/04-git-branches-and-publication.md)

## 更新与发布

本次更新：[统一任务修复](changes/2026-10-22-canonical-task-repair.md) · [CLIENT01 方向](changes/2026-10-22-client-execution-direction.md) · [本机 Codex 内核](changes/2026-10-22-native-codex-supervisor.md)。

[2026-10-22 release notes](changes/2026-10-22-workmate-publication.md) · [Branch and synchronization policy](governance/04-git-branches-and-publication.md) · [Exact prior README archive](quality/history/stage66-before-workmate-readmes/manifest.json)

后续改动同步中英 README、相关实际截图/交互、双语更新说明和对应远端分支。发布只推送明确引用，核对远程 SHA，不强推。凭据、会话、数据库、依赖及安装包不进入 Git；浏览器调用后关闭自建且不用的页面、上下文及实例。

本次扩展更新：[云端对话及消息附件](technical/71-extension-cloud-conversations.md) · [更新说明](changes/2026-10-22-extension-conversations.md)。

阶段 73 Desktop 本机执行：[具体方案](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/73-desktop-native-company-tools.md) · [源码与真实旅程证据](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-company-tools-checkpoint.json)；既有媒体保持原始源码范围。

阶段 73 公司工具历史更新：[更新说明](https://github.com/copypasteltd/workmate/blob/docs/docs/changes/2026-10-23-desktop-company-tools.md) · [源码检查点](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-company-tools-checkpoint.json)；较早回执和媒体保持原始源码范围。

阶段 74 本机追问更新：[更新说明](https://github.com/copypasteltd/workmate/blob/docs/docs/changes/2026-10-23-desktop-native-input.md) · [当前源码检查点](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-native-input-checkpoint.json)。较早报告及媒体保留原始源码范围。

阶段 74 历史记录：当时验收后刷新未打包的界面源码摘要索引；其他覆盖源码和实际程序包未变，见[独立元数据核对](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-native-input-renderer-manifest-01.json)，不增加原生/UI 测试计数。

阶段 75 私有视频更新：[更新说明](https://github.com/copypasteltd/workmate/blob/docs/docs/changes/2026-10-23-desktop-private-video.md) · [当前检查点](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-video-checkpoint.json)。旧报告保留原始源码范围，平台/本机主进程验证与后续界面验证明确记录。

<!-- desktop-native-browser-stage77 -->

## 本机浏览器与 Desktop 界面

新建本机会话，选择工作目录并明确授予「完整本机权限」，再描述浏览器工作。本机 Codex 使用版本化 `copypaste_browser` 命名空间的十二项工具：页面列表、打开、导航、历史、快照、截图、交互、隔离脚本、等待、对话框、下载及关闭。交互包含真实点击、填写/输入/选择、按键、滚动/拖动及明确本机文件上传。可信无边框地址栏与远程网页使用独立渲染器。完成的下载保留在所选目录的 browser-downloads；模型截图直接捕获真实网页，README 浏览器录制使用真实 OS 窗口捕获，不拼接页面。

当前本机授权、公司身份、项目权限、调用归属和预算逐次核验；网页不能授予 OS 权限或取得公司推理凭据。调用 ID 绑定具体操作，结果未知不自动重放。Stop、撤权、登出和退出关闭任务页面及未完成下载，保留已完成文件和客户原有窗口。旧线程保留原工具绑定；使用浏览器工具须新建会话。

此前进度条约束已撤销；真实上传、任务、流程和视频反馈继续显示。隐藏滚动条外观不禁用原生滚动。成果换行、代码与表格重排，重点滚动区可聚焦；800×600、1280×800、1440×980 实际窗口保留输入与费用操作。检查包含真实滚轮、Home/End、最后一个下载按钮焦点，及紧凑费用/设备/账户页面和英文/繁中浅深主题；自动化未宣称实测物理触控板或每种系统缩放。

当前完整清单为 66 个测试文件 / 17 批 / 851 项通过，保留此前全部 848 项。SQL001–094 和 428 条 HTTP 接口均未变。仅 UI 自有夹具的用户/平台/企业容量配置为 32，并新增不可变网关策略版本 2（32 槽位、每分钟 10,000 请求），以保留多次取消后的未知结果和费用预留；初始策略、生产默认及容量控制不变。模型响应、业务页面与系统对话框决定明确模拟。原 102 REQ/102 TC、NFR 和 G01–G10 仍为 81 部分 / 21 未证明 / 0 完整验收。Extension 产品和验证器字节未变，本轮没有新增其 UI 结论。

```mermaid
flowchart LR
    Customer --> Permission[Explicit local permission]
    Permission --> Native[Customer-device Codex]
    Native --> Gateway[Company identity, budget and AI gateway]
    Native --> Browser[Owned local browser and real websites]
    Browser --> Files[Actual uploads, screenshots and downloads]
    Stop[Stop, revoke, sign-out, exit] --> Cleanup[Close task-owned pages]
    Extension[Native Chrome right Side Panel and selected files] --> Cloud[Company cloud Codex]
```

![实际紧凑 Desktop](design/implementation/workmate-local-28-layout-800-en.png)

![实际本机浏览器](design/implementation/workmate-local-28-browser-saved-en.png)

![实际本机交互](design/implementation/workmate-local-28-local-agent.gif)

[MP4](design/implementation/workmate-local-28-local-agent.mp4) · [Browser GIF](design/implementation/workmate-local-28-native-browser.gif) · [Browser MP4](design/implementation/workmate-local-28-native-browser.mp4) · [繁中深色](design/implementation/workmate-local-28-layout-compact-zh-dark.png)

[Design](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/77-desktop-native-browser.md) · [Requirements](https://github.com/copypasteltd/workmate/blob/docs/docs/requirements/04-desktop-layout-and-scroll.md) · [Evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-browser-checkpoint.json) · [Changes](https://github.com/copypasteltd/workmate/blob/docs/docs/changes/2026-10-23-desktop-native-browser.md)

<details>
<summary>阶段 76 历史实现与截图（旧滚动条布局）</summary>

<!-- desktop-native-workflow-stage76 -->

## 本机流程与核查

选择「流程顾问」、本机目录并明确授予所需本机权限。描述要求并确认冻结的流程步骤；执行前另行查看每个子角色的预算和合计，批准具体版本后才预留费用、启动本机子 Codex。遇到人工审批步骤须再次明确批准，之后才运行下一角色。查看真实本机文件、私有 SOP/流程 JSON/恢复说明下载与公司用量记录；顾问对话及未完成步骤分别计费。Stop 或撤权会终止本机父子进程；已受理但结果未知的操作保留待对账状态，不会自动重放。

首个子集支持最多八步的顺序本机 Codex、人工审批及广告汇总。每个子角色使用独立的 Skills、公司工具和推理凭据，沿用客户当前明确授予的目录及本机权限。完整本机权限不扩大公司的客户数据、项目权限或预算；云端 Worker 与定时任务不能接管本机流程。每个流程版本从真实读取账本冻结外部来源，复用到新会话及派生 SOP 时仍保留；旧创建任务删除不会替代外部来源的有效性判断。来源停用同时约束首次读取、缓存、子任务启动和私有或明确发布的衍生成果；管理员继续遵守权限、MFA、原因及审计控制。关闭应用也会阻止仍等待日志落盘的请求稍后启动。

阶段 76 当时的平台清单为 65 个实际测试文件、17 个完整批次、848 项通过，保留阶段 75 全部 830 项回归。SQL001–093 未改写；SQL094 增加本机流程来源与不可变版本。实际 428 条接口清单保留此前全部 415 条。原 102 REQ/102 TC、NFR 和 G01–G10 维持 81 项部分验证 / 21 项未证明 / 0 项完整验收；旧证据及媒体仅证明其原始源码。

```mermaid
flowchart LR
    User[Customer] --> Consent[Desktop main: permission and fee consent]
    Consent --> Local[Local consultant Codex]
    Local --> API[Company identity, sources and usage]
    API --> Consent
    Consent --> Children[Local role Codex children]
    Children --> API
    Children --> Approval[Human step approval]
    Approval --> Consent
    Children --> Files[Real files and private deliveries]
    Extension[Chrome right Side Panel and files] --> Cloud[Company cloud Codex]
```

![本机流程费用确认](design/implementation/workmate-local-21-workflow-fees-en.png)

![本机流程完成](design/implementation/workmate-local-21-workflow-completed-zh.png)

![实际打包客户端交互](design/implementation/workmate-local-21-local-agent.gif)

[MP4](design/implementation/workmate-local-21-local-agent.mp4) · [800×600](design/implementation/workmate-local-21-workflow-compact-en.png)

[设计与生命周期](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/76-desktop-native-workflows.md) · [绑定证据](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-workflow-checkpoint.json) · [更新说明](https://github.com/copypasteltd/workmate/blob/docs/docs/changes/2026-10-23-desktop-native-workflows.md)

</details>

</details>


</details>

</details>
