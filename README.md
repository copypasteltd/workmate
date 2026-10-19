# CopyPaste 交付与集成

[English](README.en.md) · 原生开发控制器、验收与交付入口 · 0.5.0

本仓库与五个产品仓库分别使用独立 Git，不把它们合并成单一仓库。项目位于 `D:\dev\copypasted\自有agent\`；源码、依赖、产物位于 `dev/`，主需求/设计/质量文档位于 `docs/`。各仓库的 README、图与截图随仓库交付。

![四个客户端实际页面](assets/screenshots/product-surfaces.png)

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

| 证据文件                          | 含义                                                                        |
| --------------------------------- | --------------------------------------------------------------------------- |
| `evidence/verification.json`      | 六仓库类型检查/构建、平台 84 项测试、Desktop 3 项测试、实际路由导出         |
| `evidence/web-admin.json`         | 真实邮件登录、初始化、PNG 素材/图层与媒体、数据/流程、16 页 Admin、费用/VIP |
| `evidence/persistent-work.json`   | 专家/私密会话/记忆、移动/深色主题、Admin 正文隔离与删除的 8 项浏览器检查 |
| `evidence/admin-identities.json` | 管理员邀请、邮箱与真实 MFA、更换验证器、受限权限、停用/恢复与重发邀请的 6 组浏览器检查 |
| `evidence/schedules.json` | 真实时钟、关闭用户页后生成报告、暂停/恢复、时区编辑、Admin 和移动布局的 5 组检查 |
| `evidence/federation.json` | 签名 OIDC、首次邮箱证明、真实打包 Desktop 与后台跨端撤销的 6 组检查 |
| `evidence/extension.json`         | 实际 MV3、Chrome identity PKCE、上传、token 隔离、退出                      |
| `evidence/desktop.json`           | 实际打包应用、PKCE、私密会话、云端计划、目录、签名命令及 Native Host 的 7 项检查          |
| `evidence/packaged-windows.json`  | 实际 Windows 包启动、isPackaged、版本和截图                                 |
| `evidence/native-controller.json` | 启动/关闭控制器与原有服务保留核查                                           |
| `evidence/repository-review.json` | 仓库边界、双语 README/图/截图、真实本机密钥排除及来源哈希                   |
| `evidence/release-manifest.json`  | 最终 Git 提交、构建产物 SHA-256 与范围                                      |

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
- 平台当前全套回归 139/139，完整 TAP 与摘要在 evidence/alignment-platform.*。

根目录运行 `python -X utf8 docs/tools/validate_runtime_contract_samples.py` 核对实际响应字段。所有上述运行使用明确标识的假数据依赖，内核仍是真实 Codex，不等于真实模型质量或全部 102 项综合验收完成。

## 技能生命周期核查

项目方法新增精确安装及专家/任务版本绑定。普通停用影响新工作；卸载和永久安全撤销阻止包括旧任务在内的后续调用。重装产生新身份，专家须保存新版本后采用。工具调用及结果落库前复查当前方案，实际消耗按原预留结算。

平台全套回归 **139/139**；delivery 的 `npm run qa:skills` 通过三组浏览器验收，十七份实际 HTTP 响应通过严格设计 schema。自定义包审核/发布、完整真实角色资格仍待完成，历史 0.5.0 安装包未替换。

## 默认助手、通知与源码完整性

`npm run qa:default-assistant` 与 `npm run qa:notifications` 各验证四组 Web 流程；`qa:extension` 验证八组真实 MV3 流程；`qa:desktop-transfer` 现有八组，加入默认文字助手、通知定位、登录前后模拟提示和运行前资料选择。所有模型依赖为获准假数据，业务持久化和 Codex 真实执行，浏览器/应用在 finally 关闭。

`npm run qa:byte-integrity` 在自己创建的临时目录实际克隆 platform/Desktop/delivery，检查 SQL 原始摘要、两个现有数据库迁移账本、28 个 Skill、渲染快照和原始 TAP。它检验独立 Git 克隆的字节完整性，不代替灾难恢复演练；运行前须提交当前源码和 TAP。脚本只删除本次创建且已检查归属的目录。

当前源码平台 139/139、Desktop 四组单元测试通过；实际 HTTP 样本十七份。全 102 条综合验收和生产发布仍按主文档维护。

## 运行前资料验收 / Initial input-checkpoint QA

`npm run qa:task-dependencies` 五组 Web 检查验证无模型等待/原预算、私人分片上传、明确版本选择、同任务执行结算、权限错误、通知及四种宽度。Desktop 和 MV3 各八组旅程纳入对应检查；报告为 evidence/task-dependencies.json、alignment-desktop.json 和 extension.json。`python scripts/capture-platform-regression.py` 原样保存后端 TAP 字节和 SHA-256。

Five Web checks cover the initial input checkpoint, actual private upload, explicit version selection, same-task execution and settlement, authorization errors, notifications, widths, themes and languages. Native Desktop and MV3 each have eight verified journeys. Real Codex executes synthetic model responses; these checks do not establish live model quality, paid-step continuation or all 102 acceptance cases.

## 执行容量验收（当前源码）

`npm run qa:execution-capacity` 以明确模拟的私人占槽记录验证 Web 原任务排队、零模型调用、单预留、独立 MFA 的 Admin 可读原因、两主题/繁英/四宽度及槽位释放后的真实 Codex/模拟模型交付与一次结算。占槽数据仅限脚本自己创建的模拟企业，并在 finally 释放；不代表完整 NFR 压测。平台另有七组使用独立随机原生数据库的并发与真实 pg-boss 测试，测试后清理本次数据库和专用目录。

## Admin 大量记录与测试隔离验证

`npm run qa:admin-records` 使用独立企业、58 条可见及六条排除的清理账本测试记录，验证真实邮箱/MFA、范围总数、50 条默认分页、组合筛选/URL 保留、只读重试拒绝、四宽度、两主题/语言、慢轮询拒绝清空与实际授权到期。仅在本机模拟模式执行，不创建真实对象或删除真实文件；最终停用测试管理员、撤销会话并关闭自建浏览器。报告与实际响应样本位于 `evidence/admin-records*.json`。

平台完整回归现在按测试组隔离原生数据库和数据目录，保留生产执行容量约束。原始首次失败证据为 `evidence/admin-records-first-regression-failure.*`，当前通过结果仍由 `capture-platform-regression.py` 原样捕获。新增迁移 030 也应参与离线字节校验。历史安装包未因此自动重打。
