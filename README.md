# CopyPaste 交付与集成

[English](README.en.md) · 原生开发控制器、验收与交付入口 · 0.5.0

本仓库与五个产品仓库分别使用独立 Git，不把它们合并成单一仓库。项目位于 `D:\dev\copypasted\自有agent\`；源码、依赖、产物位于 `dev/`，主需求/设计/质量文档位于 `docs/`。各仓库的 README、图与截图随仓库交付。

![四个客户端实际页面](assets/screenshots/product-surfaces.png)

## 无边框 Desktop 与原生侧栏预览

Desktop 当前使用无原生边框、无 Electron 默认菜单的自绘品牌标题栏；扩展按钮打开 Chrome 原生全局 Side Panel，默认位于右侧。窗口/原生侧栏 **10/10** 组以及扩展既有 **8/8** 组通过，真实打包 EXE 已验证窗口按钮、Alt、指针/键盘缩放的 800×600 下限、跨窗口 IPC 拒绝、PKCE、弹窗位置及主题语言。浏览器 action 验证使用 `Extensions.triggerAction` 和实际 `SIDE_PANEL` 上下文，不以单独 HTML 标签页替代。左右位置由 Chrome 用户偏好控制。

预览产物在同级 Desktop `release/frameless/`（Setup、Portable、win-unpacked）和扩展 `release/sidepanel/CopyPaste-0.5.0-sidepanel.zip`。均使用 localhost，Desktop 未签名，独立于历史完整 0.5.0 离线包。`evidence/native-surfaces-artifacts.json` 记录 SHA-256、源码提交及打包 ASAR 与当前构建的逐文件字节一致性。

```powershell
# 原生开发栈已启动；先分别构建 Desktop 与 extension
$env:CHROME_BIN='你的原生 Chromium 路径'
$env:COPYPASTE_DESKTOP_EXECUTABLE='同级 Desktop/release/frameless/win-unpacked/CopyPaste.exe 的绝对路径'
npm run qa:native-surfaces
# 各源码仓库提交、干净后，校验二进制并生成扩展 ZIP/产物清单
npm run package:surfaces
```

报告为 `evidence/native-surfaces.json`，全部自建窗口在 finally 关闭。截图位于 Desktop 的 18–20 和扩展的 09。首轮原生侧栏布局检查过早执行的失败报告独立保留；最终脚本等待文档/字体及侧栏尺寸就绪后检查实际溢出。完整签名更新、卸载、系统/DPI 和全部 102 条综合验收继续保留。

## 仓库清单

| 同级目录              | 职责                                                                      | 默认入口         |
| --------------------- | ------------------------------------------------------------------------- | ---------------- |
| `copypaste-platform`  | 身份、企业权限、API/Worker、Codex、费用/VIP、素材/数据/流程、Admin 控制面 | `localhost:4310` |
| `copypaste-web`       | 用户 Web 完整访问/登录/初始化/工作区                                      | `localhost:4317` |
| `copypaste-admin`     | 独立 MFA 后台与 16 个运营页面                                             | `localhost:4318` |
| `copypaste-extension` | Chrome MV3 侧栏、PKCE、主动文件/网页、原生桥接                            | 加载 `dist/`     |
| `copypaste-desktop`   | Windows 客户端、目录授权、签名命令、Chrome Host                           | Setup / Portable |
| `copypaste-delivery`  | 本仓库，启动、停止、验收、版本与证据                                      | 命令行           |

每个仓库有自己的 package.json、锁文件、main 分支、中英 README 和素材来源说明。Web/Admin/Desktop 构建不要求相邻源码。只有本集成仓库的启动/QA 需要明确放在上述同级布局；也可用 `COPYPASTE_DEV_ROOT` 指定启动/构建根目录。浏览器 QA 脚本当前依赖上述同级布局和默认本机端口。

## 已安装环境直接查看

```powershell
# 本仓库执行；控制器占用 4319 仅供本机关闭
npm start
```

打开 `http://localhost:4317` 或 `http://localhost:4318`。保留终端。关闭时在本仓库另一终端：

```powershell
npm run stop
```

控制器依次启动真实 PostgreSQL、平台、Web、Admin；等待真实就绪；关闭时通过仅本机随机令牌控制口，先停 API、再停界面与数据库。端口已有进程时直接失败并保留它，不杀用户已有程序。原生 pg_ctl 关闭会完成 checkpoint；已验证无崩溃恢复的持久重启及原有 5173/5174 服务进程保持。控制器令牌、进程状态及日志只在忽略的 `.data/`。

## 干净环境复现

原生 Windows x64、Node.js 22.14+、npm、Git、FFmpeg/FFprobe、固定 Codex `0.163.0-alpha.10.2`。不得调度 Docker、WSL 或虚拟化环境。锁文件含原生 PostgreSQL/Electron 依赖，首次安装可能下载对应平台二进制。保持六个仓库同级，先停止旧开发服务：

```powershell
npm ci
npm run bootstrap
npm start
```

控制器就绪后，在 platform 仓库的另一个终端准备隔离测试库和管理员：

```powershell
npm run db:migrate
npm run admin:create -- admin@your-company.example super_admin
```

把 platform `.data/enrolment/<id>.json` 的 TOTP URI 导入认证器并删除 enrolment 文件。用户可自己用工作邮箱注册，无默认账号；开发验证码在 platform `.data/mailbox/`，生产必须配置真实 SMTP。

Bootstrap 不安装个人全局工具，也不覆盖现有 `.env`。数据库/API 保留本机已有试点数据，不能用 QA 数据替代真实企业资料。MASTER_KEY 丢失会影响加密凭证、签名及会话验证，应与数据库/对象文件一并备份。

## 四端和平台关系

```mermaid
flowchart TB
  W[Web 用户端] --> A[Platform API / 权限与账本]
  E[Chrome MV3] --> A
  D[Windows Desktop] --> A
  O[Admin MFA 控制台] --> A
  E --> N[Chrome Native Host / 显式目录 grant]
  N --> L[本地文件]
  D --> L
  A --> P[原生 PostgreSQL / RLS / outbox]
  A --> Q[pg-boss Worker / 租约与预算]
  Q --> C[固定版本 Codex / 28 Skills / 18 角色]
  C --> G[公司内部 OpenAI 兼容网关]
  Q --> F[受控代码、图像、设计、指标工具]
  F --> S[不可变资产 / 原生渲染]
```

AI key 只在服务端 `.env`，所有 AI 经内部网关。没有公司 Base URL、精确模型别名、密钥和实际费率时，界面正常访问、非 AI 业务可用，AI 任务明确不可用。

## 验证命令与证据

```powershell
npm run verify
npm run qa:web
npm run qa:persistent
npm run qa:admin-identities
npm run qa:schedules
npm run qa:extension
# 先在 Desktop 仓库执行 npm run package:dir 或 npm run package
npm run qa:desktop
npm run qa:packaged
python -X utf8 scripts/review-repositories.py
```

浏览器 QA 需要 Chromium。可通过 `CHROME_BIN` 指定现有原生可执行文件，或 `npx playwright install chromium` 安装 Playwright 自带版本；本次机器已安装。所有测试只创建并关闭自己的页面/上下文/进程，不关闭用户原有浏览器。

| 证据文件                          | 含义                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `evidence/verification.json`      | 六仓库类型检查/构建、平台 84 项测试、Desktop 3 项测试、实际路由导出                    |
| `evidence/web-admin.json`         | 真实邮件登录、初始化、PNG 素材/图层与媒体、数据/流程、16 页 Admin、费用/VIP            |
| `evidence/persistent-work.json`   | 专家/私密会话/记忆、移动/深色主题、Admin 正文隔离与删除的 8 项浏览器检查               |
| `evidence/admin-identities.json`  | 管理员邀请、邮箱与真实 MFA、更换验证器、受限权限、停用/恢复与重发邀请的 6 组浏览器检查 |
| `evidence/schedules.json`         | 真实时钟、关闭用户页后生成报告、暂停/恢复、时区编辑、Admin 和移动布局的 5 组检查       |
| `evidence/federation.json`        | 签名 OIDC、首次邮箱证明、真实打包 Desktop 与后台跨端撤销的 6 组检查                    |
| `evidence/extension.json`         | 实际 MV3、Chrome identity PKCE、上传、token 隔离、退出                                 |
| `evidence/desktop.json`           | 实际打包应用、PKCE、私密会话、云端计划、目录、签名命令及 Native Host 的 7 项检查       |
| `evidence/packaged-windows.json`  | 实际 Windows 包启动、isPackaged、版本和截图                                            |
| `evidence/native-controller.json` | 启动/关闭控制器与原有服务保留核查                                                      |
| `evidence/repository-review.json` | 仓库边界、双语 README/图/截图、真实本机密钥排除及来源哈希                              |
| `evidence/release-manifest.json`  | 最终 Git 提交、构建产物 SHA-256 与范围                                                 |

报告只代表实际运行过的检查。受控 Responses fixture 启动真实 Codex 并执行工具回合，但不等于公司真实模型业务准入。主文档的 102 项长期验收没有被批量标为通过。静态文档核查另外在根目录运行 `python -X utf8 docs/tools/validate_docs.py`。

## 数据库生命周期复核

`npm run qa:lifecycle` 要求先停止现有 CopyPaste 控制器。它自行启动、关闭、重启原生服务，核对 PostgreSQL checkpoint、当前版本就绪、专家/会话/记忆记录保留及既有服务 PID，最后停止自己的栈。之后用 `npm start` 恢复查看。此检查不启动虚拟化或浏览器。

0.1.0、0.2.0、0.3.0 与 0.4.0 原始验收副本保存在 `evidence/versions/`；当前 evidence 对应 0.5.0。长期需求继续由各仓库及主文档跟踪。

## 二进制与演示流程

所有检查通过且六仓库已提交、工作区干净后，在本仓库执行 `npm run release`。它验证证据，生成 `release/`：六个可离线克隆的 Git bundle、Web/Admin/Chrome 成品 ZIP、Windows Setup/Portable，以及包含精确提交和 SHA-256 的清单。`git clone <文件.bundle> <目录>` 可恢复独立仓库。发布产物和 `evidence/release-manifest.json` 均忽略入 Git，避免提交自引用；源码内保留生成脚本及已执行的验收报告。

执行 `python -X utf8 scripts/verify-release.py` 可再次核查全部文件摘要、ZIP CRC/入口，实际离线克隆六仓库并比对提交、分支、tree、源码索引及干净状态。它只在本仓库 `.data/release-restore/` 建立临时 checkout，核查后删除自己创建的目录；结果写入忽略的 `evidence/release-restore.json`。

Desktop `npm run package` 输出 Windows x64 Setup、Portable 和 win-unpacked；当前为未签名、本机 origin 构建。Chrome 加载扩展 `dist/`；生产发布需改公开部署 origin、匹配扩展 ID，安装版经用户确认注册 Native Host。未自动安装应用、发布商店、创建线上收款或部署生产。

建议演示顺序：邮箱注册 → 创建企业/项目 → 专属专家/私密会话/记忆 → 品牌/素材 → 创意工程 SVG/PNG/MP4 → CSV 指标 → 工作流审批 → Admin 用户详情、确认入账、VIP → 扩展登录上传 → Desktop 登录、目录授权与云文件指令。实际 Agent 生成环节须公司网关联调后启用。

## 尚未完成的发布工作

公司 AI/SMTP/广告 OAuth/S3 需真实凭证及联调；Windows 签名证书、生产原生服务账号/ACL/网络隔离、备份恢复/SLO 需部署核查。SAML/SCIM、强制 SSO、事件触发、并行团队 Agent、协同编辑、完整 AI 视频/语音、在线收单、客户代码强隔离不在本次已实现范围。已安装 18 个角色/28 个 Skills 仍待真实角色任务验收，不能按可用资格数量宣传。

主需求和设计优先级未被删除；本仓库交付实际实现和证据，不用页面存在冒充全部产品验收。各端完整操作说明见各自中英 README；[第三方说明](THIRD_PARTY_NOTICES.md)记录工具和截图来源。

## 云端日历验收

`npm run qa:schedules` 通过真实邮箱登录、新企业、CSV 和已发布流程，在 UI 预览并确认每日计划；关闭用户页面后等待真实时钟，由原生 Worker 生成报告并校验 HKD/ROAS。随后验证用户暂停/恢复、每周/香港时区编辑、后台独立 MFA 控制和 390px 布局，共五组，报告为 `evidence/schedules.json`。测试不调用 AI，在 finally 关闭自建浏览器、退役计划并取消测试运行。

打包 Desktop 另外检查原生 bearer 日历创建、实际显示与退役；`qa:lifecycle` 核对日历配置/历史数据库侧摘要及重启持久性。当前 0.5.0 包含 84 项平台测试和 3 项 Desktop 单元测试；浏览器与打包旅程单独报告。

## 0.5.0 企业身份与统一登录

OIDC 使用 code + PKCE S256、签章、state/nonce 与固定回调。先有注册账号及有效企业成员资格，再绑定企业身份；首次绑定需要独立的 CopyPaste 工作邮箱确认码，不按网域自动开户。配置改变、停用或本人解除连接会撤销关联用户的全部 CopyPaste Web/native/refresh 会话和旧执行授权。管理员登录仍独立使用邮箱与 TOTP。

`npm run qa:federation` 使用原生签名 OIDC IdP，验证邮箱开户、后台配置/检查/启用、首次独立邮箱确认、真实打包 Desktop 的系统浏览器 SSO + loopback PKCE、390px 布局及后台跨端撤销。fixture、浏览器和 Electron 全在 finally 关闭；报告为 `evidence/federation.json`。它不是公司 IdP 或内部 AI 的生产准入。

```mermaid
flowchart LR
  Member[已有企业成员] --> IdP[签名 OIDC 与 PKCE]
  IdP --> Proof[首次独立邮箱确认]
  Proof --> Web[CopyPaste 会话]
  Web --> Native[明确原生授权与 PKCE]
  Revoke[停用或解除连接] --> All[浏览器与原生凭证撤销]
```

部署配置 `SSO_ALLOWED_ORIGINS` 为所需的精确 HTTPS origin。默认回调为 `WEB_ORIGIN/v1/auth/sso/callback` 经 Web API 代理；跨域 `VITE_API_BASE` 可配 `SSO_CALLBACK_ORIGIN=API_ORIGIN`。生产拒绝 `SSO_ALLOW_LOCALHOST=true`。只有原生 fixture 验收时，用此环境开关启动开发控制器，执行 `qa:federation` 后停止并不带该开关重启。

## 明确假数据的开发环境

`npm run demo` 原生启动数据库、真实 Codex Worker、模拟 AI 网关、Web 和 Admin；不会改现有平台 .env。模拟网关仅回环可用、不可在生产启用，页面和持久业务数据均有模式标记；企业 Owner 可一次性领取演示 gift。`npm run stop` 仅关闭控制器创建的进程，需等待原生数据库完成 checkpoint 后再启动。

`npm run qa:alignment` 验证邮箱初始化、删除清理、9 MiB 上传在断网和刷新后续传、真实 Codex 的模拟软件交付、SSE、四种屏宽/深色及独立 Admin MFA。报告在 evidence/alignment.json，脚本 finally 关闭创建的浏览器上下文和实例。新源码未重打包时，release/ 的 0.5.0 仍是历史交付。

## 本轮新增源码验证

- `npm run qa:cloud-files`：四组 Web 云目录流程、两次真实 Codex 模拟任务的持久源码与实际 ZIP；生成 evidence/cloud-files.json 和实际 HTTP 契约样本。
- `npm run qa:desktop-transfer`：八组源码 Electron 登录、幂等上传、29 MiB 传输、覆盖保护与原生桥云目录；生成 evidence/alignment-desktop.json。
- 平台当前全套回归 185/185，完整 TAP 与摘要在 evidence/alignment-platform.\*。

根目录运行 `python -X utf8 docs/tools/validate_runtime_contract_samples.py` 核对实际响应字段。所有上述运行使用明确标识的假数据依赖，内核仍是真实 Codex，不等于真实模型质量或全部 102 项综合验收完成。

## 技能生命周期核查

项目方法新增精确安装及专家/任务版本绑定。普通停用影响新工作；卸载和永久安全撤销阻止包括旧任务在内的后续调用。重装产生新身份，专家须保存新版本后采用。工具调用及结果落库前复查当前方案，实际消耗按原预留结算。

平台全套回归 **185/185**；delivery 的 `npm run qa:skills` 通过三组浏览器验收，31 份实际 HTTP 请求／响应样本通过严格设计 schema。自定义包审核/发布、完整真实角色资格仍待完成，历史 0.5.0 安装包未替换。

## 默认助手、通知与源码完整性

`npm run qa:default-assistant` 与 `npm run qa:notifications` 各验证四组 Web 流程；`qa:extension` 验证八组真实 MV3 流程；`qa:desktop-transfer` 现有八组，加入默认文字助手、通知定位、登录前后模拟提示和运行前资料选择。所有模型依赖为获准假数据，业务持久化和 Codex 真实执行，浏览器/应用在 finally 关闭。

`npm run qa:byte-integrity` 在自己创建的临时目录实际克隆 platform/Desktop/delivery，检查 SQL 原始摘要、两个现有数据库迁移账本、28 个 Skill、渲染快照和原始 TAP。它检验独立 Git 克隆的字节完整性，不代替灾难恢复演练；运行前须提交当前源码和 TAP。脚本只删除本次创建且已检查归属的目录。

当前源码平台 185/185、Desktop 四组单元测试通过；实际 HTTP 请求／响应样本 31 份。全 102 条综合验收和生产发布仍按主文档维护。

## 运行前资料验收 / Initial input-checkpoint QA

`npm run qa:task-dependencies` 五组 Web 检查验证无模型等待/原预算、私人分片上传、明确版本选择、同任务执行结算、权限错误、通知及四种宽度。Desktop 和 MV3 各八组旅程纳入对应检查；报告为 evidence/task-dependencies.json、alignment-desktop.json 和 extension.json。`python scripts/capture-platform-regression.py` 原样保存后端 TAP 字节和 SHA-256。

Five Web checks cover the initial input checkpoint, actual private upload, explicit version selection, same-task execution and settlement, authorization errors, notifications, widths, themes and languages. Native Desktop and MV3 each have eight verified journeys. Real Codex executes synthetic model responses; these checks do not establish live model quality, paid-step continuation or all 102 acceptance cases.

## 执行容量验收（当前源码）

`npm run qa:execution-capacity` 以明确模拟的私人占槽记录验证 Web 原任务排队、零模型调用、单预留、独立 MFA 的 Admin 可读原因、两主题/繁英/四宽度及槽位释放后的真实 Codex/模拟模型交付与一次结算。占槽数据仅限脚本自己创建的模拟企业，并在 finally 释放；不代表完整 NFR 压测。平台另有七组使用独立随机原生数据库的并发与真实 pg-boss 测试，测试后清理本次数据库和专用目录。

## Admin 大量记录与测试隔离验证

`npm run qa:admin-records` 使用独立企业、58 条可见及六条排除的清理账本测试记录，验证真实邮箱/MFA、范围总数、50 条默认分页、组合筛选/URL 保留、只读重试拒绝、四宽度、两主题/语言、慢轮询拒绝清空与实际授权到期。仅在本机模拟模式执行，不创建真实对象或删除真实文件；最终停用测试管理员、撤销会话并关闭自建浏览器。报告与实际响应样本位于 `evidence/admin-records*.json`。

平台完整回归现在按测试组隔离原生数据库和数据目录，保留生产执行容量约束。原始首次失败证据为 `evidence/admin-records-first-regression-failure.*`，当前通过结果仍由 `capture-platform-regression.py` 原样捕获。新增迁移 030 也应参与离线字节校验。历史安装包未因此自动重打。

## 模板与原生端验收

`npm run qa:agent-templates` 运行八组真实 Web/源码 Electron 流程：独立邮箱与工作区、目录筛选、缺失工具、无费用预检、编辑失效、接受响应丢失后幂等重试、技能恢复后新回执、四宽度/主题/语言、权限拒绝隐藏及原生 PKCE/企业头校验。模型与媒体保持模拟，业务持久化真实，所有自建浏览器和应用在 finally 关闭。

模板增量的六组专项检查使当时完整回归达到 145/145；后续 PDF 增量后为 147/147。四份模板实际响应加入后严格 schema 样本共 21 份。迁移 031 与新的 Desktop 渲染快照均须纳入字节验证。历史安装包和离线 bundle 保留原版本，全部 102 条需求及至少 12 个角色资格门槛继续保留。

## PDF 交付验收

`npm run qa:design-pdf` 的七组流程验证真实登录、画布、接受后响应丢失、幂等重试、源版本冲突、四宽度/主题/语言、设计师模板和原生 Electron 保存。PDF 由 pypdf 独立解析、Poppler 原生渲染并与同源 PNG 比较；报告 `evidence/design-pdf.json` 登记尺寸、摘要与清理结果。

需要原生 Chromium、`PDF_QA_PYTHON`（含 pypdf/Pillow）及 `PDFTOPPM_BIN`。这些仅用于 QA，不是产品运行依赖。当前全套平台回归 **185/185**；本轮源码未重打历史安装包，不等同完整 102 条验收。

![实际 PDF 导出](assets/screenshots/design-pdf-export.png)

## 营销 CSV、精确指标与来源（当前源码）

导入先预览并确认账户、币种、时区、实体层级、归因和转化定义；支持通用 CSV 及 Google/Meta 风格候选表头与手动映射。原始 UTF-8/BOM、SHA-256、映射和计算结果真实保存。相同项目内重复请求或成功回执丢失后的重试只返回原快照；被隔离的数据不能绕过限制重新上传。未知转化不计零，CTR/CPC/CPM/CVR/CPA/ROAS 用精确小数先加总再计算，历史结果冻结。

原始 CSV、标准化 CSV、带 11 项证据的 JSON 计算报告及实际 SVG 可下载。页面显示实际数据日期；上传时间不冒充平台取数截止时间。没有正式广告账户同步、跨平台转化去重、FX 或完整 AI 叙述验收；营销分析角色仍未合格。模型依赖继续使用获准假数据，数据库与文件逻辑真实执行。历史安装包未重打。

`npm run qa:marketing-analytics` 验证六组 Web/原生 Electron 流程：真实登录、映射预览、成功回执丢失后重试、实际 CSV/JSON/SVG 下载、行错误/未知值、两主题/繁英/四宽度、选中快照拒绝清空与原生保存。设置 `CHROME_BIN` 为本地原生 Chromium；报告为 evidence/marketing-analytics.json。新建浏览器、上下文及 Electron 均在 finally 关闭。平台当前全套回归 **185/185**，原始 TAP 保持字节及摘要一致。

```mermaid
flowchart LR
  Web[真实登录与导入表单] --> Files[下载 / 摘要 / 引用]
  Files --> Faults[回执丢失 / 坏行 / 拒绝]
  Faults --> Views[两主题 / 繁英 / 四宽度]
  Views --> Native[PKCE / IPC / 原生保存]
  Native --> Cleanup[关闭自建资源与证据记录]
```

![实际营销分析验收](assets/screenshots/marketing-analytics.png)

## AnalysisSpec 私人报告（当前源码）

在行销分析选择已有快照、业务问题、日期/比较区间、指标、维度和 HKD 最高预算。预览不调用模型或预留费用；明确确认后原子建立私人 Codex 任务、冻结计算/证据及单笔预留。来源、账户、币种、时区及归因独立；重复事实去重，冲突拒绝，比较零值/无数据保留原因。接受后丢失回执重试返回原报告。

真实 Codex 通过分页事实工具读取固定值，服务端检查证据占位符及数字字面量后发布固定 HTML 资产，JSON 保留完整计算。自然语言语义和专业业务质量仍待验收；当前模型为明确标识的假数据。来源隔离/删除和项目撤权阻止读取及下载。完整 102 条综合验收、正式连接、专业角色资格和生产发布仍未完成，历史安装包未更新。

先运行 `npm run demo`，再设 `CHROME_BIN` 为本地原生 Chromium 并执行 `npm run qa:analysis-reports`。六组实际 Web/源码 Electron 旅程覆盖真实开户、无费用预览、丢失回执重试、规范查询/真实下载、16 个尺寸/主题/语言组合、拒绝清空及原生相同字节保存。原始报告 `evidence/analysis-reports.json`；两个首次失败报告保留上下文限制和手机布局问题，最终报告独立记录修复后结果。

当前平台完整回归 **185/185**，严格实际 HTTP 样本 **31/31**。`capture-platform-regression.py` 原样保存 TAP 与摘要；不要格式化 TAP。事实索引的只读核对见 `evidence/analysis-index-backfill.json`，使用已保存指标，没有重算历史。所有自建浏览器、页面、上下文和 Electron 在 finally 关闭。

```mermaid
flowchart LR
  Login[Real sign-in / workspace] --> Preview[Multi-source preview / no reservation]
  Preview --> Retry[Accepted response loss / one report]
  Retry --> Verify[Canonical reads / 16 combinations / denied clearing]
  Verify --> Native[PKCE / native byte-identical save]
  Native --> Close[Close owned browser and Electron]
```

![AnalysisSpec report](assets/screenshots/analysis-reports.png)

## CSV／XLSX 文件导入与更正历史（当前源码）

营销输入现在先保存为项目共享文件的固定版本，再预览工作表、标题列、映射和账户口径。Google/Meta 经规范 `POST /v1/dataset-imports`，通用表格沿用兼容入口；预览不调用模型或预留费用。重复上传、接受回执丢失与重试不重复建立相同快照。原始 CSV/XLSX 下载校验实际字节及 SHA-256。

XLSX 限 5,000,000 字节、50 张工作表、100 列和 10,000 数据行；多表须明确选择，标题列为 1–100。只读解析共享/内联字符串、XML 中文字符引用、精确数字及 1900/1904 日期；金额输入最多六位小数，冻结指标保留八位。拒绝公式（含缓存结果）、宏、外链、加密文件和数据区合并单元格。错误定位实际工作表单元格。预览失败仍保留已明确上传的项目原始文件，界面提前说明。

更正新建不可变快照并记录完整祖先链，保留旧指标和历史报告；AnalysisSpec 在建立任务/预算前拒绝同时汇总祖先及更正版。来源隔离或删除阻止依赖数据、报告和文件读取；删除恢复流程关闭尚未领取的任务并释放未用预留，已运行或费用不明的任务保留原对账规则。私人文件须先明确发布为共享副本。

```mermaid
flowchart LR
  File[CSV / XLSX] --> Version[固定共享文件版本]
  Version --> Preview[表 / 标题列 / 映射 / 免费预览]
  Preview --> Confirm[当前授权与明确确认]
  Confirm --> Snapshot[幂等快照与冻结指标]
  Snapshot --> Correction[新更正版 / 保留祖先]
  Version --> Lifecycle[隔离或删除依赖守卫]
```

平台完整回归 **185/185**，严格实际 HTTP 样本 **31/31**，文件导入四组及原有 CSV 六组 Web/源码 Electron 流程通过；原生类型检查和四项单元通过。模型/媒体依赖为获准假数据，数据库、Codex、文件与授权逻辑真实执行。完整 102 条综合验收、全部官方导出格式、正式连接器、专业业务资格和生产发布仍待完成，历史 0.5.0 安装包未重打。详细规则见主文档 `docs/technical/29-file-imports-and-correction-lineage.md`。

原生开发栈启动后执行 `npm run qa:file-imports`（设置 `CHROME_BIN`）。四组覆盖接受回执丢失、唯一上传资产、更正链、公式错误、16 种界面组合及真实 PKCE/原生保存；报告及五份请求／响应样本保存在 `evidence/file-imports*.json`。原生桥首次失败报告独立保留；修复后四组通过，所有自建浏览器和 Electron 在 finally 关闭。

![实际文件导入与更正](assets/screenshots/file-imports.png)

独立兼容核查：设置 `WORKBOOK_QA_PYTHON` 为含 openpyxl 的原生 Python，再执行 `npm run qa:workbook-interop`。openpyxl 3.1.5 生成的双日期系统、带样式/稀疏/隐藏行/中文的 XLSX、公式及七位金额拒绝四组通过；报告为 `evidence/workbook-interop.json`。首次中文字符引用缺陷及初始超精度 fixture 的记录单独保留；临时工作簿在 finally 清理。Python/openpyxl 仅为核查工具，不是产品运行依赖。

原生开发栈启动后执行 `npm run qa:task-controls`（设置 `CHROME_BIN`）。五组验证 Web、源码无边框 Desktop、真实 MV3/PKCE 的排队暂停/恢复/取消，以及释放本次测试占位后由真实 Codex/模拟模型生成文件并结算一次。原任务和预留不重建，自建浏览器、Electron 和扩展在 finally 关闭。报告为 `evidence/task-controls.json`；当前完整平台回归 185/185。此项是源码验证，先前无边框预览与历史完整离线包保持原清单；运行中/已付费步骤恢复及完整 102 条验收仍未完成。

## 跨端会话专项

`npm run qa:sessions` 启动自有隔离浏览器、源码无边框 Electron 与真实 MV3，使用新建合成账号、实际邮箱验证码/PKCE，验证会话目录、Web 远端撤销、原生过期访问退出、离线提示、跨标签退出与迟到响应。模型调用为零。仅调整本次用户的凭证过期时间；离线 revoke 与后台 GET gate 为显式故障注入。所有自建页面、上下文和应用在 finally 关闭，报告写入 `evidence/sessions.json`。本专项不重新生成历史安装包，也不关闭完整身份、102 条需求或生产门槛。

上一阶段会话专项七组通过，平台回归 191/191，Desktop 原生单元 15/15，扩展单元 10/10；当前认证增量和证据见下节。Windows 默认 GPU 路径的四次早期超时与对照报告已保留；本专项对自建 Chromium/Electron 使用 `--disable-gpu` 软件渲染，产品启动配置未变。正常计时/帧与点击对照见 `evidence/sessions-gpu-diagnostic.json`，最终模式写入会话报告；不据此声明硬件渲染兼容性通过。

## 规范认证交付检查 / Canonical authentication verification

`npm run qa:platform` 原样保存完整平台 TAP 字节及摘要，不再依靠 shell 文本重编码。`npm run qa:sessions` 使用真实 Web、源码无边框 Electron 与两个 MV3 面板，额外注入“首次交换/刷新已提交而响应丢失”以及“旧账号 401 延迟到新账号登录后”故障；只操作本次合成账号与自有本地存储，退出时撤销测试凭证并关闭全部自建实例。

The platform runner records unmodified TAP bytes and SHA-256. The sessions journey exercises canonical Web/PKCE consumers, bounded first-exchange recovery, persisted same-key refresh recovery, two-panel account replacement, revocation and late-response isolation. Controlled expiry, encrypted-vault/session-storage, response-loss and delayed-message fixtures are explicit; model calls remain zero. The initial Electron evaluation harness failure is retained as `evidence/auth-recovery-harness-import-failure.json` and is not counted as passing evidence.

These source checks do not rebuild historical installers/ZIPs or close all 102 acceptance cases. Existing package manifests and their original verification receipts remain unchanged.

最新限制：扩大首次交换恢复专项时，本机 Electron/普通 Chromium 启动复测阻塞；失败与已提交/当前 main 对照见 Delivery `evidence/auth-recovery-open-issue.json`。本轮完整十二组原生流程未计通过，`sessions.json` 保留原七组历史回执。实际 Web 规范导航三组及当前平台/原生单元检查分别记录。

Latest limitation: the expanded twelve-flow native journey is **not completed** because current startup attempts stall. Failed attempts and the committed/current-main comparison are preserved; the comparison shares current dependencies and does not exclude all source issues. Historical session receipts stay unchanged. Current Web navigation and platform/native unit results are recorded separately.

浏览器检查使用锁定 Playwright 对应的引擎；可在本仓库中设置以下原生 Windows 路径。Headless Shell 用于 Web 检查，完整 Chromium 供 MV3 使用。 / Use the locked Playwright engines: Headless Shell for Web and full Chromium for MV3.

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH='D:\dev\copypasted\自有agent\dev\copypaste-delivery\.data\browsers'
node node_modules/playwright/cli.js install chromium --no-progress --no-remove
$env:CHROME_BIN='D:\dev\copypasted\自有agent\dev\copypaste-delivery\.data\browsers\chromium-1248\chrome-win64\chrome.exe'
$env:WEB_CHROME_BIN='D:\dev\copypasted\自有agent\dev\copypaste-delivery\.data\browsers\chromium_headless_shell-1248\chrome-headless-shell-win64\chrome-headless-shell.exe'
npm run qa:auth-navigation
```

`qa:byte-integrity` 当前独立检出四组通过：36 SQL、28 固定摘要方法包、43 渲染来源摘要和 203 项原始 TAP。 / Fresh checkout integrity: four groups passed, covering 36 SQL files, 28 trusted packages, 43 renderer digests and the raw 203-test TAP.

## 用户资料契约与启动诊断 / Profile contract and startup diagnosis

用户端 QA 的工作区/CSRF 初始化改用 `GET /v1/session/context`；规范导航专项另外通过实际 HTTP 分别检查 Cookie 与 Bearer 的 `GET /v1/me` 原始 `User`，只保存合成账号的公开资料字段作为 schema 样本。后台 `/v1/admin/me` 及用户 `PATCH /v1/me` 不变。

`npm run qa:sessions` 的当前十二组流程报告改存 `evidence/auth-recovery.json`，保留原七组 `sessions.json`。显式 Electron 可执行路径同时加载当前固定 Playwright 的 ready-event bridge；退出超时只清理本次 ChildProcess 的进程树，并仍将验证记为失败。`npm run qa:electron-readiness` 是不加载产品模块的 CJS/ESM 原生诊断，不属于业务验收。两次本轮失败及清理证据保留，完整原生旅程仍未通过。

Client QA bootstrap uses `GET /v1/session/context`. Real HTTP profile checks validate canonical browser and native `User` responses and export only synthetic profile fields. Admin profile and user profile mutations keep their own routes. Current twelve-flow session QA writes `auth-recovery.json`, preserving the historical seven-flow receipt. The pinned Playwright ready-event bridge is explicit; bounded shutdown can kill only its owned process tree and still fails acceptance. Minimal Electron readiness is diagnostic evidence, not product acceptance. Expanded native journeys remain unproven.

本轮平台 **207/207**、Web 实际流程 **4/4**、严格实际 HTTP 样本 **33/33**；旧 203 项回归保存在 `evidence/stage33-platform/`，首次 204/205 失败保存在 `evidence/profile-platform-first-failure/`，初始化夹具失败单独保留。 / This increment passes **207/207** platform tests, **4/4** real Web journeys and **33/33** captured HTTP schemas, while preserving the original 203-test receipt and the first failed 205-test run. Expanded native journeys remain unproven.

本次提交后的独立 Git 检出四组通过：36 份不可改写 SQL 及两库摘要账本、28 个固定摘要 Skill、43 份 renderer 来源摘要、207 项原始 TAP 字节和记录 SHA-256；临时检出已移除。 / Four fresh-checkout integrity groups passed for 36 immutable SQL files and both migration ledgers, 28 exact-hash Skills, 43 renderer files and the original 207-test TAP bytes. Owned temporary checkouts were removed. This does not replace native application acceptance.

## 邀请与成员验收 / Invitation and member checks

`npm run qa:membership` 验证实际 Web 创建与投递、轮换重发、邮箱登录/加入、移除、撤销，以及真实退出后迟到响应拒绝：模型调用 0；早期成功报告被重跑覆盖，不作为可审计证据。最终源码的页面复核超时，拥有的浏览器已关闭，失败记录在 `evidence/membership-current-issue.json`。当前 `npm run qa:membership-wire` 真实 HTTP 五组通过并退出拥有的会话。四份实际响应加入原始 schema 校验，累计 37/37。首次 Vite 代理响应匹配失败保留在 `evidence/membership-first-navigation-failure/`。

The earlier successful `qa:membership` receipt was overwritten and is excluded from auditable acceptance evidence. Final-source page reruns timed out and are not accepted; all owned browsers closed. `qa:membership-wire` separately passes five current-source HTTP groups and closes both owned sessions. Four canonical HTTP response samples bring strict schema checks to 37/37. The first origin-matching fixture failure is preserved. Original 207-test evidence is archived byte-for-byte in `evidence/stage34-platform/`; the 218-test stage before exhausted-lease coverage is in `evidence/stage35-initial-platform/`. Latest platform and fresh-checkout results are separate raw evidence. Production SMTP, the complete Admin/native matrix and rebuilt release artifacts remain pending.

最新平台全套 **220/220**；严格实际 HTTP 样本 **37/37**；当前 HTTP 五组通过；当前页面复核失败独立保存，早期成功字节缺失不作通过证明。 / Latest platform **220/220**, strict captured HTTP schemas **37/37**, and five current-source HTTP groups passed; current page failures are retained and the overwritten earlier success is not accepted.

本轮独立检出四组通过：37 份不可改写 SQL 和两库摘要账本、28 个固定摘要 Skill、45 份 renderer 来源摘要、220 项原始 TAP 字节及记录摘要；临时检出已移除。检出基于实现提交，后续提交仅纠正证据说明和保存回执。 / Four fresh-checkout groups pass for 37 immutable SQL files and both migration ledgers, 28 trusted Skills, 45 renderer digests and raw 220-test TAP bytes. Owned temporary clones were removed. Subsequent commits only clarify evidence metadata and save the receipt.

## Admin 成员真实 HTTP 验证

运行 npm run qa:admin-membership-wire，使用独立合成用户和仅指定测试企业的临时管理员，验证成员授予、暂停/恢复、规范操作恢复、独立审批及撤权；模型调用为零。结束时退出自己的会话并停用自己的临时管理员。原始回执和实际响应样本保存到 evidence；这些检查不证明页面验收。

本轮最终稳定源码平台回归 **233/233**，新增 Admin 成员专项 **13/13**；当前真实后台成员 HTTP **5/5**，原规范捕获样本 **43/43**。完整原始回执位于 Delivery `evidence/`；页面验收与生产/完整原生门槛另行保留。


## 账户控制增量复核

`npm run qa:admin-account-wire` 使用当前本机原生服务、真实邮件与 TOTP 合成身份，验证六组规范资料、全局会话撤销、用户冻结、企业隔离、独立关闭及 MFA 重放守卫，捕获八个严格操作样本。`npm run qa:admin-account-ui` 单独复核新账户表单，使用自有软件渲染 Chromium 并在 finally 关闭，不操作用户浏览器。以对应 evidence JSON 的实际 checks/errors/closed 为准，不能将尝试或旧截图计为通过。

本阶段全套平台回归 245/245，原始 TAP 不经格式化；上一阶段 233 项 JSON/TAP 和检出回执归档 `evidence/stage36-platform/`。模型仍为获准模拟，完整原生、其余后台规范及历史包更新仍待完成。


本次新账户页面实测 **5/5**，完整平台 **245/245**，当前规范样本 **51/51**。页面实际修复待审批导航，截图随 Admin 中英 README；不取代原生/旧成员页面未完成项。若默认 Playwright 浏览器未安装，QA 使用环境变量 `CHROME_BIN` 指向已安装的 Chromium；本次为本机 `chromium-1243/chrome-win64/chrome.exe`。测试不下载浏览器，前次缺失路径与导航失败独立归档。


## 规范目录增量验证

`npm run qa:admin-directory-ui` 在本机 API/Vite Admin 与独立 Chromium 中运行七组检查：真实邮箱/TOTP、23 个合成用户的 20/3 游标分页、严格详情与现有账户/VIP目标入口、VIP/企业/状态筛选、规范企业账务 ID、响应式中英样式，以及 MFA/匿名拒绝。`CHROME_BIN` 可指向已有浏览器，本次使用缓存 chromium-1243；不下载浏览器。仅本次合成记录的实际响应写入 `evidence/admin-directory-contract-samples.json`，检查及关闭结果写入 `evidence/admin-directory-ui.json`。

十组服务端专项见 `evidence/admin-directory-final.tap`。旧 245 项平台回归及字节回执归档 `evidence/stage37-platform/`；失败夹具、拒绝项目零值投影和初次过早截图保留于 `evidence/stage38-initial/`。完整平台与独立检出以当前回执的真实计数和摘要为准，未经格式化的原始 TAP 保留。

当前页面验证使用源码 Vite 服务，生产构建另行检查；它不替代安装包或完整跨端验收。全部自建浏览器和上下文关闭、自有测试管理员/会话/用户停用，不操作用户浏览器。模型调用为零。资金/VIP写规范、完整消费钻取、旧成员页面和原生/发布仍有独立缺口。

本轮最终完整平台 **256/256**、七组目录实际页面/HTTP **7/7**、严格规范响应 **63/63**；新增目录/导出十一组包含在完整 TAP 中，独立旧调用专项为 **7/7**。原始 TAP SHA-256 为 `e0741c2315252c644229cfd51198c911c8272c66b365924f4a3e92fa396f5079`。首次 252/255 的旧调用回归失败及当时原文已归档 stage38-initial；没有降低原始规范或删除原安全断言。
