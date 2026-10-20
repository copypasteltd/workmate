# CopyPaste 0.5.0 代码交付入口

最新账务增量：按原消费来源补偿、原付款退款冻结、独立核实部分付款/剩余未付，以及未知或差额对账，见 [退款开发与验收](technical/45-source-bound-refunds-and-cash-reconciliation.md)。当前完整平台回归 324/324，费用及退款页面 8/8；两库 053–055 已实际应用。原始失败回执与之前交付字节保留。完整方案/VIP、真实支付机构及其余全部综合验收继续跟踪。

交付根目录：`D:\dev\copypasted\自有agent\`。实际代码、依赖及构建产物均在 `dev/`；需求、设计与质量记录均在 `docs/`。本版本是可运行的原生 Windows 本机试点交付，生产状态及未完成范围见下文。

正在执行全体系需求修复，未发布的改动见 [修复记录](quality/09-implementation-alignment-audit.md)。用户已授权暂用假数据，可在 delivery 运行 `npm run demo` 启动标识清晰的模拟环境，Codex 内核和业务逻辑仍真实执行。下列 0.5.0 安装包与归档不代表当前未发布源码。

当前源码新增 [AnalysisSpec 报告与证据](technical/28-analysis-report-tasks-and-evidence.md)：多来源/比较预览、真实私人 Codex 任务与预算、分页固定事实、数字引用检查、持久 HTML/JSON 文件及 Web/源码 Desktop 下载。最新平台回归 303/303，共享审批与原始目录/决定增量见 [统一后台审批](technical/43-shared-admin-approval-requests.md)；完整综合验收和真实角色资格继续保留，不使用旧安装包演示本轮新增功能。

## 本次无边框与侧栏客户端预览

最新 Desktop 使用品牌自绘标题栏，无原生边框及 Electron 默认菜单；扩展按钮打开 Chrome 原生全局侧栏，默认右侧并遵从浏览器用户位置偏好。真实打包 EXE 与侧栏综合验证 10/10，原有扩展业务回归 8/8；说明及实际截图见 [窗口与原生侧栏](technical/30-native-window-and-browser-sidepanel.md)。

- 安装器：`dev/copypaste-desktop/release/frameless/CopyPaste-0.5.0-x64-Setup.exe`。
- 便携版：`dev/copypaste-desktop/release/frameless/CopyPaste-0.5.0-x64-Portable.exe`。
- 扩展 ZIP：`dev/copypaste-extension/release/sidepanel/CopyPaste-0.5.0-sidepanel.zip`；解压后在 Chrome 开发者模式加载目录。
- [产物与 SHA-256 清单](quality/native-surfaces-artifacts.json)：源码提交、29 个嵌入构建文件一致性、三个预览包及真实打包验证报告摘要。产物路径相对 `dev/`，此清单逐字节镜像交付仓库原始报告。

这些是未签名、localhost 配置的客户端预览，未安装/发布，与下面历史完整离线包分开保存。启动当前后端后使用；模型和媒体继续按授权使用假数据，业务持久化及 Codex 为真实运行。CSV/XLSX 文件版本、更正链和来源生命周期见 [文件导入](technical/29-file-imports-and-correction-lineage.md)。

## 六个独立仓库

每个仓库都有独立 Git 历史、锁文件、中英 README、逻辑图、实际页面截图与素材/依赖说明。

| 仓库      | 中文 / English                                                                                    | 内容                                                            |
| --------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| platform  | [中文](../dev/copypaste-platform/README.md) / [English](../dev/copypaste-platform/README.en.md)   | API、PostgreSQL/RLS、Codex Worker、身份、账本、权限及业务工具   |
| web       | [中文](../dev/copypaste-web/README.md) / [English](../dev/copypaste-web/README.en.md)             | 访问、邮箱开户、企业初始化、角色、会话、素材、营销分析与流程    |
| admin     | [中文](../dev/copypaste-admin/README.md) / [English](../dev/copypaste-admin/README.en.md)         | 独立 MFA、16 页后台、用户/消耗/费用/VIP、68 权限与审计          |
| extension | [中文](../dev/copypaste-extension/README.md) / [English](../dev/copypaste-extension/README.en.md) | Chrome MV3、浏览器授权、主动文件/网页选择及 Native Messaging    |
| desktop   | [中文](../dev/copypaste-desktop/README.md) / [English](../dev/copypaste-desktop/README.en.md)     | Windows 工作区、浏览器 PKCE、目录授权、签名云命令与 Chrome Host |
| delivery  | [中文](../dev/copypaste-delivery/README.md) / [English](../dev/copypaste-delivery/README.en.md)   | 原生启动/停止、跨端验收、截图、发布及离线恢复核查               |

## 本机启动与首次访问

本机依赖已安装；停止旧 CopyPaste 控制器后执行：

```powershell
Set-Location -LiteralPath 'D:\dev\copypasted\自有agent\dev\copypaste-delivery'
npm start
```

等待 database/api/web/admin 全部 ready。访问 Web `http://localhost:4317`，以工作邮箱验证并创建企业及项目；已有成员按权限进入工作区。开发验证码在 platform `.data/mailbox/`，生产必须配置真实 SMTP。不存在共享默认用户密码。

Admin 为 `http://localhost:4318`，身份与用户端分离。首次超管按 platform README 执行 `admin:create` 并开通认证器；后续管理员在后台通过本人邮箱验证与 TOTP 开通。企业 OIDC 的首次连接也需要独立 CopyPaste 邮箱证明，不因邮箱域名相同自动加入企业。

关闭开发栈在 delivery 的另一终端执行 `npm run stop`。控制器只关闭自己的进程并让 PostgreSQL 完成 checkpoint；不调度 Docker、WSL 或虚拟化。

Windows 安装版与便携版位于 `dev/copypaste-desktop/release/`，集中副本位于 `dev/copypaste-delivery/release/`。Chrome 通过开发者模式加载 extension 的 `dist/`；持续本地目录操作还需用户安装并明确连接 Desktop helper。目录授权默认只读且会到期。

## 实现与验收

唯一 Agent 内核为固定版本 Codex；所有模型及图像请求只走服务端公司内部 OpenAI 兼容网关。18 个角色、28 个 Skill 包已安装，任务执行前验证能力、权限、权益和预算。缺少已验证的公司模型配置时明确拒绝 AI 执行，不生成虚假成功结果。

本轮六仓库类型检查与构建、平台 84 项逻辑测试及 Desktop 3 项测试均通过。浏览器、扩展、真实打包客户端、原生重启与离线恢复的具体结果见 [当前验收](quality/08-enterprise-federation-acceptance.md) 和 [机器可读证据](quality/implementation-evidence.json)。这些检查不能替代全部 102 项长期综合验收。

集中 release 交付六个独立 Git bundle、Web/Admin/Chrome 三个 ZIP、两个 Windows EXE，共 11 项产物；manifest 记录精确提交、源码 tree、文件大小与 SHA-256。源码 bundle 不含本机 `.env`、客户数据库、依赖缓存或密钥。离线恢复源码可用 `git clone <文件.bundle> <新目录>`，并按对应 README 重新安装依赖及配置。核查步骤见 [实际开发与仓库](technical/12-implementation-and-repositories.md)。

## 生产接入和范围边界

公司已上线 AI API，但本工作区尚无其精确端点、模型别名、凭证与费率；公司 Image 2、真实企业 IdP、Google/Meta OAuth、SMTP/S3 仍需真实配置与准入。18 个角色的真实业务任务尚未取得准入资格，不能以安装数量代替业务验收。

当前设计工具可产生真实 PNG 和模板动效 MP4；完整 AI 视频/语音、并行专业 Agent、协同编辑、事件触发、SAML/SCIM、客户代码强隔离与在线支付收单尚未实现。Windows 包未签名且采用 localhost 试点 origin；生产需公司 HTTPS 配置、重新打包、代码签名、OS 服务身份/ACL/出站隔离及恢复/SLO 核查。完整已实现/未完成矩阵见 [实施清单](technical/12-implementation-and-repositories.md)。

## 当前源码验收增量

2026-10-19 当前源码平台 185/185、Desktop 原生单元 4 项通过；资料补齐 Web 5 组、Admin 3 组、源码 Desktop 与 Chrome MV3 各 8 组。新增模板 Web/Electron 八组与 PDF 交付七组通过。实际响应样本 31/31 通过严格 schema 检查。规范 225 个操作和常规实际 248 个 method/path 的数量不代表字段与全部验收已完成。上述记录独立于历史 0.5.0 包的 84 项测试和产物。

显式运行前资料选择保持原任务、私人会话和单笔预算，完整边界见 [运行前资料补齐](technical/22-pre-execution-input-checkpoint.md)。所有模型/媒体测试依赖暂用获准假数据，Codex 与业务持久化仍真实执行；没有替换历史安装包、ZIP 和 bundle。停止命令会等待自己控制的原生进程及数据库 checkpoint 实际结束，再返回完成。

新增企业/用户/能力原子执行容量、跨企业交错派发与原任务自动排队，细则及证据边界见 [容量与公平调度](technical/23-execution-capacity-and-fair-dispatch.md)。完整 NFR 规模、供应商逐请求限流及独立生成式视频队列仍待完成。

实际单页 PDF 审阅稿、源版本、重复请求和 Web/Desktop 下载见 [设计 PDF 交付](technical/26-design-pdf-review-delivery.md)。模型与媒体依赖继续模拟，PDF 文件与源工程实际保存；这不增加真实服务合格角色数量。

当前源码的营销导入与指标修复见 [营销数据与证据](technical/27-marketing-import-metrics-and-evidence.md)：原文摘要/映射预览、去重与未知处理、冻结精确结果、JSON/SVG/CSV 下载、后台治理及 Web/源码 Desktop。`qa:marketing-analytics` 六组通过，含真实 PKCE、原生保存、两主题/繁英/四宽度；未完成项与真实角色资格不因此关闭。主文档、源码与独立仓库 README 均已更新，0.5.0 安装包及离线 bundle 保持原历史版本。


本轮新增 [排队控制与 Codex 续聊原语](technical/31-task-controls-and-native-continuation.md)：三端初始排队暂停/同任务恢复、Admin 共用守卫、原生线程增量用量和回执故障处理；五组跨端流程通过。业务 Worker 的已付费步骤恢复仍未实现，上一轮安装包/ZIP 保留原清单。
