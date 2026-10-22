# Workmate · CopyPaste Delivery

[English](README.en.md) · [主文档](https://github.com/copypasteltd/workmate/blob/docs/docs/README.md)

[Backend](https://github.com/copypasteltd/workmate/tree/backend) · [Web](https://github.com/copypasteltd/workmate/tree/web) · [Admin Dashboard](https://github.com/copypasteltd/workmate/tree/admin) · [Desktop](https://github.com/copypasteltd/workmate/tree/desktop) · [Chrome Extension](https://github.com/copypasteltd/workmate/tree/extension) · [Delivery](https://github.com/copypasteltd/workmate/tree/delivery)

面向香港企业的云端 Agent 产品。当前仓库负责 **Delivery**；当前远程分支为 `delivery`.

<!-- client01-direction -->
## 当前客户端方向与实现差异

CLIENT01（2026-10-22）要求 **Desktop 在客户本机运行 Codex Agent**，提供客户可主动授予的 **完整本机权限**，操作能力对标 Codex Desktop。**Extension 在 Chrome 原生右侧栏采用 ChatGPT 式对话/附件结构**，获取、读取用户获选文件并上传，由云端 Codex 执行。全部产品 AI 请求仍走公司内部网关。

**当前实现：** Desktop 在本机运行 Codex，支持客户完整授权、文件/终端、同线程继续、停止及公司费用通道；本次新增公司图片/设计/资料工具和私有产物下载。37 项客户端测试、14 项真实原生测试、818 项平台完整回归及 9 项实际打包 Electron 旅程检查通过。16 个角色已接通本机工具协议，不等同完整专业验收；视频与流程顾问本机集成、全 18 角色/29 Skill、生产签名及全部客户端验收继续跟踪。模型/图片响应和系统对话框决定明确使用假数据夹具。Extension 保持原生右侧栏云端对话与获选文件上传。见 [方案与边界](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/73-desktop-native-company-tools.md)、[源码及媒体证据](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-company-tools-checkpoint.json)。

下方架构图表示已实现的云端/文件桥接基线，不是 Desktop 本机 Agent 的目标架构。

本机 supervisor 的实现及历史原生权限测试见 [技术说明](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/70-desktop-native-codex-supervisor.md)。

<!-- /client01-direction -->

本次原生侧栏会话复验：在保持 Platform `.env` 和原生运行资源已配置的前提下，执行 `node scripts/run-extension-chat.mjs NN`，使用尚未占用的两位编号。检查器先确认 4310、4317、55432 空闲，运行 32 项扩展测试、类型/构建，再启动自己的原生 PostgreSQL、Web 预览和浏览器；最终关闭本次实例并核验隔离数据清理。模型回合明确模拟，真实侧栏、上传、云端 Worker 与账本均实际执行。最新记录见 [Extension 检查点](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/extension-chat-checkpoint.json)。

## 架构与约束

仅使用 Codex，全部 AI 请求经公司内部 OpenAI 兼容服务器。Web、Desktop、扩展和 Admin 共用服务端身份、权限、来源与计费控制。设计沿用 CopyPaste 的品牌素材、色系、字体和中英界面。

```mermaid
flowchart LR
  Desktop[Frameless Desktop] --> Main[Trusted local permission and session control]
  Main --> Native[Customer-device Codex and local tools]
  Main --> Control[Company identity / role / budget control]
  Native --> Gateway[Company scoped AI gateway]
  Web[Web] --> Cloud[Cloud Codex and business tools]
  Extension[Native right Side Panel and selected-file uploads] --> Cloud
  Cloud --> Gateway
  Gateway --> Ledger[Server-observed usage and ledger]
```

## 职责与目录

本仓库统一启动原生开发服务、执行跨端验证、保留原始结果、检查安装包字节、录制实际交互，并按分支映射同步发布。它通过同级独立仓库运行产品，不包含另一套业务内核。

| 目录 | 用途 |
| --- | --- |
| `scripts/` | bootstrap、原生进程控制、数据库核对、客户端/API/权限/媒体验证、录制、发布 |
| `tests/` | 原生包与 Side Panel 验证器本身的完整性检查 |
| `evidence/` | 分次执行的原始 TAP、日志、源码绑定、清理和实际截图摘要 |
| `assets/screenshots/` | README 展示用实际截图、MP4、GIF |
| `.data/` | 忽略的自有进程状态、浏览器配置、原始录制和临时文件 |

## 工作区布局

将 docs 分支放在项目根目录，其余分支分别放在 `dev/copypaste-platform`、`copypaste-web`、`copypaste-admin`、`copypaste-desktop`、`copypaste-extension` 和本仓库 `copypaste-delivery`。不要把不同分支依次 checkout 到同一个工作目录来同时启动各端。

## 安装、启动与停止

```powershell
npm ci
npm run bootstrap
npm run demo
```

Web `4317`、Admin `4318`、API `4310`、控制器 `4319`、原生 PostgreSQL `55432`。`npm run stop` 仅关闭控制器启动的进程并请求数据库正常 checkpoint；端口被占用时保留原进程并报错。

`demo` 使用明确的本地模拟模式；生产和非 loopback 主机拒绝启用。AI/业务数据模拟授权不代表模型质量、真实费率或生产服务验收。原始错误和失败记录保留，不覆盖或改写为通过。

## 实际交互录制

```powershell
node scripts/run-paid-input-native.mjs NN --media
```

复录须选择新的两位编号，避免覆盖原始证据。该命令建立自有原生数据库、隔离夹具、Web/Admin 预览、真实 unpacked Desktop 和原生 Chrome Side Panel；结束后关闭全部自有浏览器/预览并回收隔离夹具。先按打包文档重建脚本指定的本地 Desktop/Extension 预览；源码分支不随附安装包或 dist。

将 `NN` 换成尚未使用的两位编号。`qa-workmate-media.ts` 使用真实 UI 操作钩子；`record-workmate-media.ts` 按真实捕获时间编码 MP4/GIF。侧栏从已确认的原生 SIDE_PANEL 文档直接捕获视口，不含浏览器工具栏；同次旅程独立验证右侧位置、主页面缩窄及没有 popup/额外标签页。保留模拟模型回合说明、源码/媒体摘要和退出回执。

## 分支发布

提交六个组件后，在主文档根目录执行 `python docs/tools/finalize_workmate_manifest.py --update` 明确刷新组件 SHA，再核对媒体编号、同步更新说明并提交主文档。发布器兼容本地 `codex/*` 工作分支及按 README 新检出的同名发布分支。所有仓库干净后运行：

```powershell
node scripts/publish-workmate.mjs --check
node scripts/publish-workmate.mjs --push
```

发布器只推送映射的八个分支，使用原子提交、远端祖先检查和推送后 SHA 核对；不强推、不删除其他分支。预检调用主文档中的历史对象、凭据、README 链接和媒体校验器。运行回执位于忽略的 `.data/publication/`，失败保留并报错。

当前清单生成器绑定保留的阶段 66/旅程 06 证据。产品源码变化后，须重新验证并更新相应报告选择；不能只改组件 SHA 复用旧源码的通过结论。

## 验证边界

`npm run typecheck`、`npm test` 检查本仓库。平台完整验证在 backend；跨端和原生脚本依据各自前置条件运行。已应用迁移原字节不可修改；升级前摘要、首次失败和后续只读修正分别保留。所有测试及录制禁止 Docker/WSL/虚拟化。

## 初次检出与环境

新工作副本可单独检出本分支；已有本地仓库直接更新，不重新初始化。

```powershell
git clone --single-branch --branch delivery git@github.com:copypasteltd/workmate.git copypaste-delivery
cd copypaste-delivery
```

Node.js ≥22.14、npm 和 Git；锁文件固定依赖。当前验收环境为 Windows x64。后端/完整交付还需要原生 PostgreSQL 启动资源、固定 Codex `0.163.0-alpha.10.2` 与 FFmpeg/FFprobe。禁止本地 Docker、WSL 和虚拟化。跨端运行使用多个独立工作目录；布局见 [workspace](https://github.com/copypasteltd/workmate/blob/docs/docs/governance/04-git-branches-and-publication.md).

## 检查与验证范围

```powershell
npm run typecheck
npm test
```

历史源码的平台完整 **802/802**、任务专项 **52/52**，六仓库 **13 项**类型/构建/既有客户端测试检查、真实打包程序和原生侧栏旅程 **32 项**通过。保留原 782 项命名回归测试。任务专项调用实际 PostgreSQL、身份、账本与 Worker；另有实际 Codex 子进程连接模拟内部网关的续接验证。UI 回合及业务数据按授权模拟。原 102 项需求仍为 81 项局部验证、21 项未证明完成、0 项完整验收。

完整规范 TaskDTO/任务创建、任意执行中暂停、未知外部结果恢复、全角色独立业务、GEO、真实供应商和生产/签名/商店验收仍继续跟踪。

本次同步补充统一任务接口和原任务输入事务。当前用户界面继续通过既有项目/会话接口使用同一执行域；下方重新录制的实际交互验证该流程的兼容性，并非声称界面已经切换到全部规范任务接口。接口边界、精确金额、幂等回执、来源撤销和未接入业务参数见 [方案细则](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/68-canonical-task-contracts-and-input-transactions.md)。

## 实际页面与交互

本服务没有独立用户页面；以下为连接本服务的实际 Desktop 界面，来源明确保留。

实际录制，保留原捕获时间；AI 回合与业务数据为明确模拟。Admin 演示表单不代表财务提交。

![实际页面](assets/screenshots/workmate-10-input-ready-en.png)

![实际页面](assets/screenshots/workmate-10-result-en.png)

![实际交互 GIF](assets/screenshots/workmate-10-interaction.gif)

[MP4](assets/screenshots/workmate-10-interaction.mp4) · [录制与源码回执](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/workmate-media-10.json)

## 方案细则与更新

- [Product](https://github.com/copypasteltd/workmate/blob/docs/docs/product/01-prd.md)
- [Architecture](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/01-architecture-and-stack.md)
- [Identity and permissions](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/07-security-and-permissions.md)
- [Task continuation](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/66-paid-native-input-checkpoints.md)
- [Admin](https://github.com/copypasteltd/workmate/blob/docs/docs/product/08-admin-dashboard.md)
- [Native clients](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/30-native-window-and-browser-sidepanel.md)
- [Canonical task update](https://github.com/copypasteltd/workmate/blob/docs/docs/changes/2026-10-22-canonical-task-repair.md)
- [Local Codex update](https://github.com/copypasteltd/workmate/blob/docs/docs/changes/2026-10-22-native-codex-supervisor.md)

后续修改需要同步中英 README、受影响的实际截图/GIF、更新说明和对应分支。提交后通过 Delivery 发布流程核对远程 SHA；不强推覆盖协作者。`.env`、数据库、会话、依赖和安装产物不进入 Git。历史 README 原字节见 [archive](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/history/stage66-before-workmate-readmes/manifest.json).

任务接口验证 / Canonical task verification:

```powershell
node scripts/run-canonical-task-checks.mjs NN
node scripts/run-canonical-task-checks.mjs NN --full
```

每次使用尚未存在的两位编号；保留原始失败，原生数据库及隔离资源均实际关闭后才通过。

本机内核验证：先设置任务专用 `COPYPASTE_LOCAL_CODEX_TEST_BIN` 为本机运行锁匹配的原生程序绝对路径，再运行 `node scripts/run-local-codex-checks.mjs NN`。该命令单独验证本机 supervisor，不启动云端任务、数据库或浏览器；真实终端仅处理自有隔离文件。历史云端/文件桥兼容 UI 验证 `node scripts/run-paid-input-native.mjs NN --media` 使用 Desktop 的 `release/client-direction-70-01/` 候选包，须先在 Desktop 执行 `npm run build` 与 `node scripts/package-client-direction.mjs`；保留旧包。该 UI 旅程当前仍测试云端/文件桥接兼容性，与本机完整 Agent 验收分开记录。

本次 Desktop 本机执行：[具体方案](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/73-desktop-native-company-tools.md) · [源码与真实旅程证据](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-company-tools-checkpoint.json)；既有媒体保持原始源码范围。

## 本机 Desktop 验证

明确设置与运行锁一致的 `COPYPASTE_LOCAL_CODEX_BIN`、`COPYPASTE_LOCAL_CODEX_TEST_BIN`，用未用过的两位编号运行 `node scripts/run-desktop-execution-checks.mjs NN`、`node scripts/run-local-codex-checks.mjs NN`、`node scripts/run-desktop-local-ui.mjs NN`。报告禁止覆盖，绑定前后源码摘要并保留失败。UI 启动器在 Desktop `.data/local-candidates/` 新建未签名候选，使用隔离原生 PostgreSQL、真实 Electron 和自有浏览器，关闭并核对夹具回收；不接管占用端口的服务。授权决定及供应商文本是夹具，本机工具和费用真实执行。

## 本机公司工具契约

Agent 循环保持在客户电脑。主进程为锁定的原生运行时注册可信 `copypaste` 动态工具，绑定任务、调用、线程及回合，在效果前及返回前重验公司权限。本机唯读拒绝公司写入；原生 schema 投影不替代原始业务参数验证。同一调用重试复用持久结果，已接受而未知的图片操作阻断后续调用并保留费用核对。私有产物按明确版本下载，保存目标由系统窗口选择。

当前公司工具检查点选择 `node scripts/run-desktop-execution-checks.mjs NN --full-platform` 的完整平台回归，以及原生与实际打包 UI 启动器。使用新的编号、明确锁定二进制和空闲自有端口；保留失败回执。绑定运行期间不得修改覆盖源码。

长运行可能被执行环境中断时，本次检查点使用可恢复启动器：`node scripts/run-desktop-platform-resumable.mjs NN --init`，逐批执行 `--next`，最后 `--finish`。启动前固定全部 63 个测试文件与源码摘要，先验证六项恢复规则，再分 16 批独立运行。每个文件都须通过，并证明源码未变、独立完整 TAP、夹具清理和数据库关闭。中断记录不贡献覆盖，仅重跑未完成批；实际失败须复查并使用新资格编号。最终按完整清单汇总，不拼造单次 TAP。

本次公司工具更新：[更新说明](https://github.com/copypasteltd/workmate/blob/docs/docs/changes/2026-10-23-desktop-company-tools.md) · [源码检查点](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/desktop-company-tools-checkpoint.json)；较早回执和媒体保持原始源码范围。
