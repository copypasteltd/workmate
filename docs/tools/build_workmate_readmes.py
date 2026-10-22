"""Build branch-aware bilingual entrypoints from actual retained delivery evidence."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
BASE = "https://github.com/copypasteltd/workmate"
T = chr(96)
BRANCHES = {"platform": "backend", "web": "web", "admin": "admin", "desktop": "desktop", "extension": "extension", "delivery": "delivery"}
NAMES = {"platform": "Backend", "web": "Web", "admin": "Admin Dashboard", "desktop": "Desktop", "extension": "Chrome Extension", "delivery": "Delivery"}


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha(path):
    return sha256(path.read_bytes()).hexdigest()


def git(path, *args):
    return subprocess.check_output(["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", str(path), *args]).decode().strip()


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text.replace("§", T).strip() + "\n", encoding="utf-8", newline="\n")


def docs(file):
    return BASE + "/blob/docs/docs/" + file


DETAILS = {
    "platform": {
        "zh": """## 服务结构与执行逻辑

| 模块 | 代码位置 | 实际职责 |
| --- | --- | --- |
| 身份和企业 | §src/§ 身份、成员、会话模块 | 邮箱验证码、Admin MFA、PKCE、企业/项目范围和私有所有者 |
| Agent 执行 | §src/worker.ts§、Codex runtime、§catalog/§、§skills/§ | 固定 Codex/技能/模型版本、受控工具、租约、fencing、事件 |
| 任务续接 | §src/paid-task-inputs.ts§、§src/task-tool-reuse.ts§ | 完成且明确计量的回合等待资料，恢复原任务/线程，重查来源后复用完成结果 |
| 费用和权益 | billing、wallet、VIP、plan、approval 模块 | HKD 整数微单位、预留、累计结算、人工入账、礼赠、退款、VIP 与额度分离 |
| 创作和分析 | design、video、marketing、SEO 模块 | 图片接口、布局交付、FFmpeg 模板视频、CSV/XLSX、广告指标、连接同步、网站证据 |
| 内容和管理 | Admin、source、erasure 模块 | 分范围元数据/正文权限、隔离、保留期、审计、独立复核和受控擦除 |
| 持久化 | §migrations/§、PostgreSQL、pg-boss、storage | 强制 RLS、幂等事务、不可改写事实、队列、不可变文件版本 |

Web 会话使用 HttpOnly Cookie、Origin 和 CSRF；原生端经浏览器登录、PKCE 与轮换刷新令牌接入。Admin 身份与客户身份分开。所有后台读取和工具使用均重查当前企业、项目、私有范围与来源状态。

模型缺资料时只能描述需求，不能自选资源 ID。已完成且用量明确的回合保留原预算预留；用户明确选择当前获准版本后，新的执行尝试恢复原 Codex 线程。上限为八轮、三十二项依赖；取消结算已知用量，未知结果进入核对。

## 初始化和启动

§§§powershell
npm ci
npm run setup:local
npm run db:local
§§§

保留数据库终端，在另一个终端执行：

§§§powershell
npm run db:migrate
npm run dev
§§§

完整集成测试需按主文档检出同级 docs/合同及完整工作区；仅检出 backend 时先执行类型检查和编译。

API 为 §http://localhost:4310§，原生 PostgreSQL 为 §127.0.0.1:55432§。§setup:local§ 只在缺少配置时生成本地密码和持久 MASTER_KEY；保留原配置和数据库，不用示例文件覆盖。§db:migrate§ 准备开发与测试库。迁移使用 owner，应用/控制/队列使用分离身份。

管理员首次登记：§npm run admin:create -- admin@your-company.example super_admin§。将本地 enrolment 文件中的 TOTP 配置导入验证器，按运行说明清理该敏感文件；没有共享默认管理员密码。

## 公司 AI 网关

只在服务器配置 §AI_BASE_URL§、§AI_ALLOWED_HOSTS§、§AI_API_KEY§、§AI_MODEL§、实际 HKD 费率及验证开关。Codex 使用公司 OpenAI 兼容 Responses 接口；Image 2 使用内部 Images 生成/编辑接口。先执行 §npm run codex:probe§，再按文档验收真实工具回合、用量和错误。模拟响应不证明真实模型或费率已验收。

§.env.example§ 是无密钥参考。生产还需 HTTPS、SMTP、持久加密密钥、受限出网、存储与备份恢复；本地原生数据库启动器拒绝生产模式。

## 接口与数据

§contracts/implemented-routes.json§ 记录实现路由；§contracts/§、§catalog/§ 与主文档中的规范 API 各自保留范围。原规范 TaskDTO/任务创建接口仍有未完成内容，路由数量不能代替规范验收。SQL001–091 保持已应用字节；修复追加迁移。

代码工具可读取、按摘要编辑和打包获准代码；不会执行不受信任的客户代码，也不把未执行的测试显示为通过。设计交付包括编辑数据、SVG/PNG 和模板 MP4；AI 视频/语音、全角色独立业务验收另行跟踪。""",
        "en": """## Service structure and execution

| Module | Source | Implemented responsibility |
| --- | --- | --- |
| Identity and workspaces | Identity/member/session modules in §src/§ | Email codes, Admin MFA, native PKCE, tenant/project/private-owner scope |
| Agent execution | §src/worker.ts§, Codex runtime, §catalog/§, §skills/§ | Frozen Codex/skill/model versions, controlled tools, leases, fencing and events |
| Continuation | §src/paid-task-inputs.ts§, §src/task-tool-reuse.ts§ | Measured completed-turn input waits, same-task/thread recovery and authorized result reuse |
| Billing and access | Billing/wallet/VIP/plan/approval modules | Integer HKD micros, holds, cumulative settlement, manual postings, gifts, refunds and separate VIP/credit |
| Creative and analytics | Design/video/marketing/SEO modules | Internal Images, editable layouts, FFmpeg template videos, CSV/XLSX, ad metrics, synchronized connections and website evidence |
| Content and Admin | Admin/source/erasure modules | Scoped metadata/body rights, quarantine, retention, audit, independent review and controlled erasure |
| Persistence | §migrations/§, PostgreSQL, pg-boss, storage | FORCE RLS, idempotent transactions, immutable facts, queue and asset versions |

Web sessions use HttpOnly cookies, Origin and CSRF checks. Native clients use browser authorization, PKCE and rotating refresh tokens. Administrator identities are separate from customer identities. Reads and tools recheck current tenant, project, private scope and source status.

A model describes missing inputs but cannot choose resource IDs. Completed fully measured turns retain the original budget hold. Human selection of an authorized current version allows a new execution attempt to resume the original Codex thread. Limits are eight rounds and thirty-two dependencies. Cancellation settles known usage; unknown effects remain in reconciliation.

## Initialize and run

§§§powershell
npm ci
npm run setup:local
npm run db:local
§§§

Keep the database terminal open. In another terminal:

§§§powershell
npm run db:migrate
npm run dev
§§§

Full integration tests require the documented sibling docs/contracts and complete workspace. A standalone backend checkout can run typechecking and compilation first.

API: §http://localhost:4310§. Native PostgreSQL: §127.0.0.1:55432§. §setup:local§ generates local passwords and a durable MASTER_KEY only when configuration is absent. Preserve existing configuration/data. §db:migrate§ prepares development and test databases. Owner migrations and application/control/queue identities remain separate.

Bootstrap an administrator with §npm run admin:create -- admin@your-company.example super_admin§. Import the local enrolment TOTP configuration into an authenticator and clear the sensitive file according to the runbook. There are no shared default Admin credentials.

## Internal AI gateway

Configure server-only §AI_BASE_URL§, §AI_ALLOWED_HOSTS§, §AI_API_KEY§, §AI_MODEL§, contracted HKD rates and qualification flags. Codex uses the company's OpenAI-compatible Responses interface; Image 2 uses internal Images generation/editing. Run §npm run codex:probe§, then qualify real tool turns, usage and failures. Synthetic responses do not qualify a live model or price.

§.env.example§ is a secret-free reference. Production requires HTTPS, SMTP, durable encryption keys, restricted egress, storage and rehearsed backup/restore. The native local database launcher refuses production.

## Interfaces and data

§contracts/implemented-routes.json§ inventories implemented routes. Runtime contracts/catalogs and the normative API retain distinct scopes. Canonical TaskDTO/task creation is incomplete; route counts are not contract acceptance. Applied SQL001–091 retain exact bytes; fixes require forward migrations.

Code tools read, hash-edit and package authorized code without running untrusted customer code or claiming unexecuted tests passed. Creative outputs include editable data, SVG/PNG and template MP4. AI video/speech and complete independent role qualification remain tracked.""",
    },
    "web": {
        "zh": """## 产品与使用逻辑

1. 访问工作台，通过邮箱验证码登录。首次验证可创建客户账户；正式邮件通过 SMTP，本地演示使用开发邮箱投递。
2. 建立或选择企业、项目，进入工作区。成员、项目权限、费用来源及私有会话所有者由服务端检查。
3. 选择默认助手、18 个角色预设，或建立自己的专员。固定角色、技能、品牌、模型和费率版本后提交工作。
4. 根据任务选择文件、品牌资料和营销连接。先检查方案/权限与预算，再原子预留费用并执行。
5. 查看任务状态、消息、产物、实际来源和用量。需要补资料时明确选择获准版本，沿用原任务继续；刷新保留尚未提交的选择。
6. 下载或明确发布交付副本；失效来源、撤权或当前读取失败会隐藏不可读取内容。通知、计划、会话和记忆保持各自范围。

## 页面与业务

工作区、专员目录、个人专员、项目方法/Skill、通知、私有会话、记忆、项目、文件/设备、成员、用量方案和账户设置共用企业/项目上下文。创作涵盖设计、品牌、广告、电商、社交、版式、演示、信息设计与模板视频；营销涵盖文件分析、广告连接和有范围的网站诊断/修改草稿/复查。

§src/main.tsx§ 负责入口和路由；独立领域组件承接会话、任务、资料、创作、连接与分析；§src/api.ts§ 和会话逻辑统一接入后台。React/TypeScript/Vite；字体与品牌素材随仓库提供，不要求运行时访问第三方字体 CDN。

## 启动

§§§powershell
npm ci
npm run dev
§§§

访问 §http://localhost:4317§，并先启动 backend 的 §http://localhost:4310§。配置参考 §.env.example§ 和 §vite.config.ts§。前端只配置公司服务地址，不接收模型 API 密钥。生产按部署文档发布静态构建、设置 HTTPS、Cookie/Origin/CSP 和后台访问。

## 交互约束

当前任务自动刷新保留输入选择；切换企业、项目、任务或读取失败清空原内容。任务状态、已记录用量和已结算费用分别显示。首次模型调用前缺资料，与已付费完成回合后缺资料有不同文案。公开副本和下载仍受当前来源、保留期与权限约束。""",
        "en": """## Product and usage flow

1. Visit the workspace and sign in with an email code. First verification can create a customer account. Production uses SMTP; local demonstrations use the development mailbox.
2. Create/select a workspace and project. The server checks membership, project rights, funding subject and private conversation ownership.
3. Select the default assistant, an installed preset among eighteen roles, or a personal specialist. Tasks freeze role, skills, brand, model and price versions.
4. Select files, brand materials and marketing connections. Access/plan/budget checks precede an atomic budget hold and execution.
5. Inspect state, messages, outputs, actual sources and usage. Explicitly select authorized versions for missing inputs and continue the original task. Refreshes retain unsubmitted choices.
6. Download or explicitly publish an independent deliverable copy. Revocation, invalid sources and denied current reads fence unavailable content. Notifications, plans, conversations and memory retain their own scopes.

## Pages and business modules

Workspace, specialist catalog, personal specialists, project methods/Skills, notifications, private conversations, memory, projects, files/devices, members, usage/plans and account settings share workspace/project context. Creative flows cover design, brand, advertising, ecommerce, social, typography, presentations, information design and template video. Marketing includes file analytics, ad connections and scoped website audit/change-draft/recheck flows.

§src/main.tsx§ contains entry/routing. Domain components implement conversations, tasks, inputs, creative work, connections and analytics. §src/api.ts§ and session code centralize Backend access. React/TypeScript/Vite, with repository-provided fonts and brand assets.

## Run

§§§powershell
npm ci
npm run dev
§§§

Open §http://localhost:4317§ after starting backend at §http://localhost:4310§. See §.env.example§ and §vite.config.ts§. The frontend contains company service origins and no model API secrets. Production static hosting requires the documented HTTPS, cookie/Origin/CSP and Backend configuration.

## Interaction rules

Refreshes of the same task retain selected inputs; workspace/project/task changes and failed reads clear prior content. State, recorded usage and settled charges are separate. Initial pre-model waits and waits after a measured paid turn use different copy. Published copies and downloads remain governed by current sources, retention and authorization.""",
    },
    "admin": {
        "zh": """## 管理范围与使用流程

1. 由受信任 CLI 登记或管理员邀请；使用独立管理员邮箱验证码和 TOTP 登录。客户会话不能直接进入管理后台。
2. 按当前授权范围筛选用户、企业、项目、账户状态、VIP 和扣费期间；查看实际发起者归属的消耗，预留和待核对款项分别处理。
3. 用户详情显示企业归属、方案、权益、费用来源和管理上下文；可根据明确权限管理账户、会话、成员、VIP 和费用。
4. 敏感写操作先预览目标、版本、参数和影响，再用幂等命令提交。超出策略的金额、期限或批次要求独立复核；MFA 时效和防自我授权规则持续生效。
5. 内容列表、正文读取、下载、隔离/恢复、公开分享撤销和擦除分别受权限约束，并进入审计。普通企业管理员不会自动获得他人的私有会话正文。

## 权限和控制面

8 个内置管理角色、68 个规范权限键覆盖全局/企业/项目范围、显式拒绝、金额/期限/批次限制和有界委派。财务、VIP、成员、用户身份、内容、方案、模型/费率配置、供应方请求、审批、导出与审计按独立领域执行。

VIP 与余额分离：开通权益不等于充值。费用支持人工确认入账、礼赠、来源约束的退款及核对；在线支付收单尚未接入。策略/方案版本不可变，前后版本检查和幂等保护避免重复操作。

## 代码结构

§src/main.tsx§ 提供导航和用户详情；§src/directory.tsx§ 提供目录/期间筛选；审批、费用、权益、内容与配置使用相应领域组件。后台 API 才是授权和账目事实来源；隐藏按钮不能替代服务端权限检查。

## 启动

§§§powershell
npm ci
npm run dev
§§§

访问 §http://localhost:4318§；先启动 backend 并完成管理身份登记。§npm run build§ 生成静态发布文件。生产需独立管理入口、HTTPS、邮件、MFA、权限指派、可用恢复管理员及审计保留策略。

## 演示范围

本次实际录制通过后台邮箱 OTP 与 TOTP 建立独立会话，展示目录筛选、用户消耗、VIP 和费用表单。演示没有把打开表单等同于完成财务入账。完整写入、审批、并发及权限验证见保留的数据库/API 与管理端记录。""",
        "en": """## Administration and operator flow

1. Enroll through trusted CLI or an administrator invitation. Sign in with a separate administrator email code and TOTP. Customer sessions cannot enter Admin directly.
2. Filter users, workspaces, projects, account state, VIP and charge periods within current scope. Usage is attributed to its actual initiator; holds and reconciliation remain separate.
3. User details expose workspace membership, plans, access, funding context and authorized management actions for accounts, sessions, membership, VIP and fees.
4. Sensitive writes first preview target, version, payload and impact, then commit idempotently. Policy thresholds require independent review. MFA freshness and anti-self-grant rules continue to apply.
5. Content metadata, private body access, downloads, quarantine/restore, share revocation and erasure have distinct permissions and audit. Ordinary workspace administration does not automatically grant another person's private conversation body.

## Permissions and control plane

Eight built-in administrative roles and sixty-eight normative permission keys support global/workspace/project scope, explicit denies, amount/duration/batch limits and bounded delegation. Finance, VIP, membership, identities, content, plans, model/rate configuration, provider requests, approvals, exports and audit use separate domain controls.

VIP and wallet credit are separate. Fees support manually confirmed postings, gifts, source-bound refunds and reconciliation; online payment acquiring is not integrated. Frozen policy/plan versions, target-version checks and idempotency prevent duplicate actions.

## Source structure

§src/main.tsx§ implements navigation and user details. §src/directory.tsx§ implements directory/period filters. Domain components implement approvals, fees, entitlements, content and configuration. Backend API authorization and ledger entries are authoritative; hidden UI buttons are not security boundaries.

## Run

§§§powershell
npm ci
npm run dev
§§§

Open §http://localhost:4318§ after starting backend and enrolling an administrator. §npm run build§ produces static deployment files. Production needs a dedicated Admin origin, HTTPS, email, MFA, assigned permissions, recovery administrators and audit retention.

## Demonstration scope

The actual recording establishes a separate session through Backend email OTP and TOTP, then shows directory filtering, customer usage and VIP/credit forms. Opening forms is not represented as a financial posting. Retained database/API and Admin evidence covers write, approval, concurrency and authorization behavior.""",
    },
    "desktop": {
        "zh": """## 原生窗口与结构

无边框 Electron 窗口，§frame:false§、§thickFrame:false§；清空应用菜单并禁用默认/Alt 菜单。40px 自绘标题栏提供拖动、最小化、最大化/还原和关闭。原生按钮状态已经在真实打包程序中验证。

§src/main.ts§ 管理生命周期、登录、文件保存和受限 IPC；§src/preload.cts§ 只暴露允许的桥；§src/window-controls.ts§ 约束窗口动作；§renderer/§ 是独立 React 界面快照。构建不依赖旁边的 Web 源码。

contextIsolation、sandbox 开启，nodeIntegration 关闭。渲染器不能任意调用 Admin、任意 URL 或访问系统文件。公司 API 和 Web Origin 在构建期固定；模型密钥保留在服务器。

## 使用流程

启动 → 打开固定公司登录网页 → 邮箱验证/PKCE 授权 → localhost 回调 → 选择企业和项目 → 使用与 Web 一致的任务、资料、会话和产物。登录与刷新族可撤销；请求附带当前范围。

用户选择文件/目录并授予有期限权限后，才执行获准操作。设备命令、签名、摘要、有效期和单次结果受后台及本地桥检查。文件下载通过当前租户的认证桥和原生保存窗口；取消不会产生一份虚假的成功文件。Codex 自动发起本地文件调度及强隔离客户代码执行仍有未完成部分。

## 开发和打包

§§§powershell
npm ci
npm run build
npm start
§§§

§§§powershell
npm run typecheck
npm test
npm run package
§§§

§COPYPASTE_API_ORIGIN§、§COPYPASTE_WEB_ORIGIN§、§COPYPASTE_EXTENSION_ID§ 或 §deployment.json§ 指定公司接入；由 §scripts/configure-deployment.mjs§ 编译。正式环境使用 HTTPS。当前 localhost 预览生成 NSIS Setup 和 Portable，位于本地忽略的 §release/§。

当前验收运行的是 §release/paid-input-66-03/win-unpacked/CopyPaste.exe§。Setup/Portable 已生成但未签名，实际安装、升级/卸载、证书和分发矩阵尚未验收。

## 本地文件与扩展协作

可按文档注册 Native Messaging companion；扩展 ID 必须匹配固定允许列表。权限不能由模型或普通网页自行扩大。本地安装客户端与浏览器侧栏共用公司身份及后台业务，不在客户端嵌入独立 AI 供应商密钥。""",
        "en": """## Native window and architecture

A frameless Electron window uses §frame:false§ and §thickFrame:false§, removes the application menu and disables default/Alt menus. A custom 40px title bar provides dragging, minimize, maximize/restore and close. Actual packaged-window state transitions are verified.

§src/main.ts§ owns lifecycle, authorization, native saves and restricted IPC. §src/preload.cts§ exposes only approved bridge functions; §src/window-controls.ts§ validates window actions. §renderer/§ is a self-contained React snapshot and builds without sibling Web sources.

contextIsolation and sandbox are enabled; nodeIntegration is disabled. The renderer cannot freely call Admin, arbitrary URLs or system files. Company API/Web origins are compiled; model credentials remain server-side.

## Usage flow

Launch → fixed company login page → email verification/PKCE authorization → localhost callback → workspace/project selection → tasks, inputs, conversations and deliverables. Sessions and refresh families are revocable; requests carry current scope.

Local work requires explicit file/folder selection and time-bounded grants. Device commands, signatures, hashes, expiry and single-use results are checked by Backend and the local bridge. Downloads use the current tenant's authenticated bridge and native save dialog; cancellation does not create a fake success file. Autonomous Codex local-file dispatch and strongly isolated customer-code execution remain incomplete.

## Develop and package

§§§powershell
npm ci
npm run build
npm start
§§§

§§§powershell
npm run typecheck
npm test
npm run package
§§§

§COPYPASTE_API_ORIGIN§, §COPYPASTE_WEB_ORIGIN§, §COPYPASTE_EXTENSION_ID§ or §deployment.json§ configure deployment. §scripts/configure-deployment.mjs§ compiles the configuration. Production uses HTTPS. Local NSIS Setup and Portable outputs are ignored under §release/§.

The qualified preview executes §release/paid-input-66-03/win-unpacked/CopyPaste.exe§. Setup/Portable are generated but unsigned; installation, upgrade/uninstall, signing and distribution matrices remain unqualified.

## Files and extension companion

Register the Native Messaging companion according to the runbook; the extension ID must match its fixed allowlist. Models and ordinary webpages cannot enlarge grants. Desktop and Side Panel share company identity and Backend business services without embedded independent AI-provider secrets.""",
    },
    "extension": {
        "zh": """## 原生侧栏形态

Chrome Manifest V3 使用 §side_panel.default_path§ 和 §chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true})§。点击工具栏打开真正的浏览器 Side Panel，再次点击可收起；没有 action popup 或模拟侧栏标签页。默认右侧，并遵循 Chrome 用户设置的侧栏位置。

§src/background.ts§ 处理生命周期、公司授权和侧栏行为；§src/panel.ts§ 管理企业/项目、任务、资料与结果；§public/sidepanel.html§、§public/panel.css§ 提供本地界面，§scripts/build.mjs§ 生成固定服务地址、CSP 和稳定扩展 ID。

## 使用流程

1. 构建并加载扩展，固定到浏览器工具栏。
2. 点击图标，浏览器右侧打开工作区。通过固定公司网页完成邮箱验证和 PKCE 授权。
3. 选择企业、项目和助手，提交工作或打开已有任务。可通过固定入口进入完整的创作、连接和网站工作台。
4. 需要资料时选择当前获准文件版本或连接。轮询保留选择；确认后继续原任务，查看结果和累计结算。
5. 切换范围或任务读取失败时清空旧内容。页面导航不销毁已有侧栏；关闭不用的页面释放内存。

浏览器扩展不能任意读取电脑所有路径。上传依赖用户选择；持续目录与设备任务需要明确授权及 Native Messaging companion。§nativeMessaging§ 是可选权限；模型不能授予本地权限。

## 构建与加载

§§§powershell
npm ci
npm run build
§§§

在 §chrome://extensions§ 开启开发者模式，选择“加载已解压的扩展程序”，选择当前仓库 §dist/§，然后固定并点击图标。需要 Chrome 120+；当前原生 Side Panel 旅程使用保留记录中的实际 Chromium。

§COPYPASTE_API_ORIGIN§ 和 §COPYPASTE_WEB_ORIGIN§ 在构建时设置，默认本地 4310/4317，生产要求公司 HTTPS Origin。保留 §manifest-key.txt§ 以维持扩展 ID；其内容是公开公钥，不是签名私钥。§extension-id.txt§ 用于服务端与 companion 注册。

源代码分支提供可复现构建；本地预览 ZIP 位于忽略的 §release/paid-input-66-03/§。商店提交、签名、跨浏览器/系统以及真实供应商接入另行验收。""",
        "en": """## Native Side Panel

Chrome Manifest V3 uses §side_panel.default_path§ and §chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true})§. The toolbar opens the real browser Side Panel and can close it again, without an action popup or simulated sidebar tab. It is right by default and respects Chrome's selected side.

§src/background.ts§ handles lifecycle, company authorization and panel behavior. §src/panel.ts§ owns workspace/project, tasks, inputs and results. §public/sidepanel.html§ and §public/panel.css§ provide the local UI. §scripts/build.mjs§ generates fixed origins, CSP and the stable extension ID.

## Usage flow

1. Build/load the extension and pin its toolbar icon.
2. Click the icon to open the native workspace. Complete email verification and PKCE authorization at the fixed company webpage.
3. Select workspace, project and assistant, then submit work or open a retained task. Fixed links open complete creative, connection and website workspaces.
4. Select an authorized file version or connection when inputs are missing. Polling retains the choice; confirmation continues the original task and exposes results/cumulative settlement.
5. Workspace changes or denied task reads clear prior content. Browser-page navigation preserves the panel; close unused owned tabs after work.

An extension cannot arbitrarily read every local path. Uploads require explicit selection; persistent folder/device work requires grants and a Native Messaging companion. §nativeMessaging§ is optional. Models cannot grant local permissions.

## Build and load

§§§powershell
npm ci
npm run build
§§§

Open §chrome://extensions§, enable developer mode, choose Load unpacked and select this repository's §dist/§. Pin and click the icon. Chrome 120+ is required; retained native evidence identifies the actual Chromium used.

Set §COPYPASTE_API_ORIGIN§ and §COPYPASTE_WEB_ORIGIN§ at build time. Defaults are localhost 4310/4317; production requires company HTTPS origins. Preserve §manifest-key.txt§ to retain the ID; it contains a public key, not a signing private key. §extension-id.txt§ is used for Backend/companion registration.

The branch contains reproducible source. The local preview ZIP is ignored under §release/paid-input-66-03/§. Store submission, signing, other browser/system matrices and live supplier integration require separate qualification.""",
    },
    "delivery": {
        "zh": """## 职责与目录

本仓库统一启动原生开发服务、执行跨端验证、保留原始结果、检查安装包字节、录制实际交互，并按分支映射同步发布。它通过同级独立仓库运行产品，不包含另一套业务内核。

| 目录 | 用途 |
| --- | --- |
| §scripts/§ | bootstrap、原生进程控制、数据库核对、客户端/API/权限/媒体验证、录制、发布 |
| §tests/§ | 原生包与 Side Panel 验证器本身的完整性检查 |
| §evidence/§ | 分次执行的原始 TAP、日志、源码绑定、清理和实际截图摘要 |
| §assets/screenshots/§ | README 展示用实际截图、MP4、GIF |
| §.data/§ | 忽略的自有进程状态、浏览器配置、原始录制和临时文件 |

## 工作区布局

将 docs 分支放在项目根目录，其余分支分别放在 §dev/copypaste-platform§、§copypaste-web§、§copypaste-admin§、§copypaste-desktop§、§copypaste-extension§ 和本仓库 §copypaste-delivery§。不要把不同分支依次 checkout 到同一个工作目录来同时启动各端。

## 安装、启动与停止

§§§powershell
npm ci
npm run bootstrap
npm run demo
§§§

Web §4317§、Admin §4318§、API §4310§、控制器 §4319§、原生 PostgreSQL §55432§。§npm run stop§ 仅关闭控制器启动的进程并请求数据库正常 checkpoint；端口被占用时保留原进程并报错。

§demo§ 使用明确的本地模拟模式；生产和非 loopback 主机拒绝启用。AI/业务数据模拟授权不代表模型质量、真实费率或生产服务验收。原始错误和失败记录保留，不覆盖或改写为通过。

## 实际交互录制

§§§powershell
node scripts/run-paid-input-native.mjs NN --media
§§§

复录须选择新的两位编号，避免覆盖原始证据。该命令建立自有原生数据库、隔离夹具、Web/Admin 预览、真实 unpacked Desktop 和原生 Chrome Side Panel；结束后关闭全部自有浏览器/预览并回收隔离夹具。先按打包文档重建脚本指定的本地 Desktop/Extension 预览；源码分支不随附安装包或 dist。

将 §NN§ 换成尚未使用的两位编号。§qa-workmate-media.ts§ 使用真实 UI 操作钩子；§record-workmate-media.ts§ 按真实捕获时间编码 MP4/GIF。侧栏从已确认的原生 SIDE_PANEL 文档直接捕获视口，不含浏览器工具栏；同次旅程独立验证右侧位置、主页面缩窄及没有 popup/额外标签页。保留模拟模型回合说明、源码/媒体摘要和退出回执。

## 分支发布

提交六个组件后，更新 docs 分支的 §docs/quality/workmate-publication.json§ 组件 SHA、媒体编号和更新说明，再提交主文档。所有仓库干净后运行：

§§§powershell
node scripts/publish-workmate.mjs --check
node scripts/publish-workmate.mjs --push
§§§

发布器只推送映射的八个分支，使用原子提交、远端祖先检查和推送后 SHA 核对；不强推、不删除其他分支。预检调用主文档中的历史对象、凭据、README 链接和媒体校验器。运行回执位于忽略的 §.data/publication/§，失败保留并报错。

## 验证边界

§npm run typecheck§、§npm test§ 检查本仓库。平台完整验证在 backend；跨端和原生脚本依据各自前置条件运行。已应用迁移原字节不可修改；升级前摘要、首次失败和后续只读修正分别保留。所有测试及录制禁止 Docker/WSL/虚拟化。""",
        "en": """## Responsibility and layout

This repository starts native development services, verifies cross-client behavior, preserves raw results, checks package bytes, captures actual interactions and synchronizes mapped branches. It coordinates sibling repositories rather than containing another business kernel.

| Directory | Responsibility |
| --- | --- |
| §scripts/§ | Bootstrap, native process control, migration checks, client/API/permission/media verification, recording and publishing |
| §tests/§ | Integrity checks for native-package and Side Panel verifiers |
| §evidence/§ | Per-execution raw TAP/logs, source bindings, cleanup and actual screenshot digests |
| §assets/screenshots/§ | Actual README screenshots, MP4 and GIF |
| §.data/§ | Ignored owned process state, browser profiles, raw recordings and temporary data |

## Workspace layout

Check out docs at the project root. Place component branches under §dev/copypaste-platform§, §copypaste-web§, §copypaste-admin§, §copypaste-desktop§, §copypaste-extension§ and this §copypaste-delivery§ repository. Use separate working directories when running components together.

## Install, start and stop

§§§powershell
npm ci
npm run bootstrap
npm run demo
§§§

Ports: Web §4317§, Admin §4318§, API §4310§, controller §4319§ and native PostgreSQL §55432§. §npm run stop§ only stops controller-owned processes and requests a normal database checkpoint. Occupied ports fail startup while preserving existing processes.

§demo§ explicitly enables local synthetic mode, which production and non-loopback hosts reject. Authorized synthetic data does not qualify live model quality, prices or production services. Original errors/failures remain intact.

## Actual interaction recording

§§§powershell
node scripts/run-paid-input-native.mjs NN --media
§§§

Use a fresh two-digit ID for a new recording. The command starts owned native PostgreSQL, isolated fixtures, Web/Admin previews, actual unpacked Desktop and a native Chrome Side Panel. All owned browsers/previews close and isolated fixtures are reclaimed afterward. First reproduce the local Desktop/Extension previews named by the script using the packaging runbook; source branches do not include installers or dist.

Replace §NN§ with a fresh two-digit ID. §qa-workmate-media.ts§ hooks actual UI operations. §record-workmate-media.ts§ encodes captured wall-clock intervals into MP4/GIF. Captures come directly from the confirmed native SIDE_PANEL document viewport and exclude the browser toolbar. The same journey independently asserts right-side layout, reduced main-page width and no popup/extra tab. Evidence binds synthetic-turn scope, source/media hashes and exit receipts.

## Branch publication

After committing the six components, update component SHAs, the media attempt and release notes in the docs branch's §docs/quality/workmate-publication.json§, then commit the documentation. With all repositories clean:

§§§powershell
node scripts/publish-workmate.mjs --check
node scripts/publish-workmate.mjs --push
§§§

The publisher updates only the eight mapped branches atomically, checks remote ancestry and verifies post-push SHAs. It never force-pushes or deletes other branches. Preflight calls the documentation audit for historical objects, credentials, README links and media. Ignored runtime receipts live in §.data/publication/§; failures remain available and stop publication.

## Verification boundaries

§npm run typecheck§ and §npm test§ check this repository. Backend runs full platform tests; cross-client/native scripts enforce their own prerequisites. Applied migration bytes are immutable. Pre-upgrade snapshots, first failures and later read-only corrections remain separate. Docker/WSL/virtualization are prohibited for all tests and captures.""",
    },
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--media", required=True)
    parser.add_argument("--clients", required=True)
    args = parser.parse_args()
    assert len(args.media) == 2 and args.media.isdigit()
    evidence = DEV / "copypaste-delivery/evidence"
    media = read(evidence / ("workmate-media-" + args.media + ".json"))
    native = read(evidence / ("paid-input-native-" + args.media + ".json"))
    full = read(evidence / "paid-input-regression-02.json")
    clients = read(evidence / ("paid-input-clients-" + args.clients + ".json"))
    assert all(v["status"] == "passed" for v in (media, native, full, clients))
    assert len(media["recordings"]) == 4 and len(native["counts"]) >= 2
    assert native["counts"]["checks"] >= 32 and native["source_unchanged"] and native["owned_database_shutdown"]
    assert full["counts"]["pass"] == full["counts"]["tests"] == 782
    assert clients["source_unchanged"] and len(clients["checks"]) == 13
    for file, expected in full["source_files"].items():
        assert sha(DEV / "copypaste-platform" / file) == expected
    for row in media["screenshots"]:
        assert sha(DEV / row["path"]) == row["sha256"]
    for row in media["recordings"]:
        assert row["observed_frames"] >= 5 and row["distinct_frames"] >= 2
        for file in row["files"]:
            assert sha(DEV / file["path"]) == file["sha256"]

    archive = ROOT / "docs/quality/history/stage66-before-workmate-readmes"
    manifest = archive / "manifest.json"
    if not manifest.exists():
        archive.mkdir(parents=True, exist_ok=True)
        entries = []
        for component in BRANCHES:
            directory = DEV / ("copypaste-" + component)
            for name in ("README.md", "README.en.md"):
                source = directory / name
                target = archive / (component + "-" + name + ".txt")
                target.write_bytes(source.read_bytes())
                entries.append({"repository": component, "commit": git(directory, "rev-parse", "HEAD"), "path": name, "archive": target.relative_to(ROOT).as_posix(), "sha256": sha(target)})
        for source in (ROOT / "docs/README.md",):
            target = archive / "docs-README.md.txt"
            target.write_bytes(source.read_bytes())
            entries.append({"repository": "docs", "commit": git(ROOT, "rev-parse", "HEAD"), "path": "docs/README.md", "archive": target.relative_to(ROOT).as_posix(), "sha256": sha(target)})
        write(manifest, json.dumps({"scope": "Exact pre-reorganization README bytes, retained as raw .md.txt to preserve original relative-link context", "files": entries}, ensure_ascii=False, indent=2))
    for entry in read(manifest)["files"]:
        assert sha(ROOT / entry["archive"]) == entry["sha256"]

    # Services have no independent customer UI; retain explicitly attributed
    # actual Web/Admin captures in their own branch for standalone rendering.
    copies = {"platform": "web", "delivery": "desktop"}
    for target, source in copies.items():
        out = DEV / ("copypaste-" + target) / "assets/screenshots"
        out.mkdir(parents=True, exist_ok=True)
        for file in (DEV / ("copypaste-" + source) / "assets/screenshots").glob("workmate-" + args.media + "-*"):
            shutil.copyfile(file, out / file.name)

    navigation = " · ".join("[" + NAMES[k] + "](" + BASE + "/tree/" + v + ")" for k, v in BRANCHES.items())
    diagram = """§§§mermaid
flowchart LR
  Web[Web workspace] --> API[Company Backend]
  Side[Chrome native Side Panel] --> API
  Desktop[Frameless Desktop] --> API
  Admin[Scoped Admin] --> API
  API --> Guard[Identity / sources / budget / queue]
  Guard --> Codex[Version-pinned Codex and Skills]
  Codex --> Gateway[Internal OpenAI-compatible gateway]
  Codex --> Tools[Authorized tools and immutable deliverables]
  Tools --> Ledger[Measured settlement / reconciliation]
§§§"""
    setup = {
        "platform": "npm run typecheck\nnpm run build\nnpm test",
        "web": "npm run typecheck\nnpm test\nnpm run build",
        "admin": "npm run typecheck\nnpm test\nnpm run build",
        "desktop": "npm run typecheck\nnpm test\nnpm run build",
        "extension": "npm run typecheck\nnpm test\nnpm run build",
        "delivery": "npm run typecheck\nnpm test",
    }
    for component, branch in BRANCHES.items():
        directory = DEV / ("copypaste-" + component)
        image_component = copies.get(component, component)
        pngs = sorted(p.name for p in (directory / "assets/screenshots").glob("workmate-" + args.media + "-*.png"))
        assert pngs
        gif = "workmate-" + args.media + "-interaction.gif"
        mp4 = "workmate-" + args.media + "-interaction.mp4"
        assert (directory / "assets/screenshots" / gif).is_file()
        if component == "admin":
            ordered = [n for label in ("users-en", "user-usage-en", "vip-en", "credit-en") for n in pngs if label + ".png" in n]
        elif component == "extension":
            ordered = [n for label in ("sidepanel-native-en", "sidepanel-result-en") for n in pngs if label + ".png" in n]
        else:
            ordered = [n for label in ("input-ready-en", "result-en") for n in pngs if label + ".png" in n]
        assert len(ordered) >= 2, component
        for lang in ("zh", "en"):
            zh = lang == "zh"
            top = "# Workmate · CopyPaste " + NAMES[component] + "\n\n"
            top += ("[English](README.en.md) · [主文档](" if zh else "[中文](README.md) · [Documentation](") + docs("README.md" if zh else "README.en.md") + ")\n\n" + navigation + "\n\n"
            top += ("面向香港企业的云端 Agent 产品。当前仓库负责 **" if zh else "A cloud Agent product for Hong Kong enterprises. This repository owns **") + NAMES[component] + ("**；当前远程分支为 §" if zh else "** and publishes to §") + branch + "§.\n\n"
            top += ("## 架构与约束\n\n" if zh else "## Architecture and constraints\n\n")
            top += ("仅使用 Codex，全部 AI 请求经公司内部 OpenAI 兼容服务器。Web、Desktop、扩展和 Admin 共用服务端身份、权限、来源与计费控制。设计沿用 CopyPaste 的品牌素材、色系、字体和中英界面。\n\n" if zh else "Codex is the only Agent kernel. All AI calls use the company's internal OpenAI-compatible server. Web, Desktop, extension and Admin share server identity, permissions, sources and billing controls. UI follows CopyPaste brand assets, colors, typography and bilingual patterns.\n\n")
            top += diagram + "\n\n" + DETAILS[component][lang] + "\n\n"
            top += ("## 初次检出与环境\n\n" if zh else "## Checkout and prerequisites\n\n")
            top += ("新工作副本可单独检出本分支；已有本地仓库直接更新，不重新初始化。\n\n" if zh else "Clone this branch into a fresh working directory; update an existing repository without reinitializing it.\n\n")
            top += "§§§powershell\ngit clone --single-branch --branch " + branch + " git@github.com:copypasteltd/workmate.git copypaste-" + component + "\ncd copypaste-" + component + "\n§§§\n\n"
            top += ("Node.js ≥22.14、npm 和 Git；锁文件固定依赖。当前验收环境为 Windows x64。后端/完整交付还需要原生 PostgreSQL 启动资源、固定 Codex §0.163.0-alpha.10.2§ 与 FFmpeg/FFprobe。禁止本地 Docker、WSL 和虚拟化。跨端运行使用多个独立工作目录；布局见 " if zh else "Use Node.js ≥22.14, npm and Git with pinned lockfiles. The qualified local environment is Windows x64. Backend/full delivery also needs native PostgreSQL launcher resources, pinned Codex §0.163.0-alpha.10.2§ and FFmpeg/FFprobe. No local Docker, WSL or virtualization. Run components in separate directories; see ") + "[workspace](" + docs("governance/04-git-branches-and-publication.md") + ").\n\n"
            top += ("## 检查与验证范围\n\n" if zh else "## Checks and evidence scope\n\n")
            top += "§§§powershell\n" + setup[component] + "\n§§§\n\n"
            top += ("平台完整 **782/782**、专项 **34/34**，六仓库 **13 项**类型/构建/现有客户端测试检查通过；真实打包程序和原生侧栏旅程 **" if zh else "**782/782** Platform and **34/34** focused tests, plus **13 checks** across six repositories for types/build/existing client suites. The actual packaged Desktop and native Side Panel journey passes **") + str(native["counts"]["checks"]) + (" 项**。保留所有原 765 项命名测试。实际 Codex 子进程的工具/线程/用量通过模拟内部 API 验证；本次 UI 回合和业务数据按授权模拟。原 102 项需求仍为 81 项局部验证、21 项未证明完成、0 项完整验收，不能把本次截图或测试数量认作完整产品验收。\n\n" if zh else "** checks, retaining every prior named test among 765. Actual Codex child-process tool/thread/usage behavior is tested through a synthetic internal API. UI turns/business data in these demonstrations are synthetic as authorized. All 102 original requirements remain: 81 partially verified, 21 without proven completion and zero fully accepted. Screenshots and test counts do not establish whole-product acceptance.\n\n")
            top += ("完整规范 TaskDTO/任务创建、任意执行中暂停、未知外部结果恢复、全角色独立业务、GEO、真实供应商和生产/签名/商店验收仍继续跟踪。\n\n" if zh else "Canonical TaskDTO/task creation, arbitrary in-flight pause, unknown-effect recovery, independent complete role workflows, GEO, live suppliers and production/signing/store qualification remain tracked.\n\n")
            top += ("## 实际页面与交互\n\n" if zh else "## Actual screens and interactions\n\n")
            if component in copies:
                top += ("本服务没有独立用户页面；以下为连接本服务的实际 " if zh else "This service has no independent customer page. The following captures show the actual ") + NAMES[image_component] + (" 界面，来源明确保留。\n\n" if zh else " client connected to the service.\n\n")
            top += ("实际录制，保留原捕获时间；AI 回合与业务数据为明确模拟。Admin 演示表单不代表财务提交。\n\n" if zh else "Actual recordings preserve capture timing. AI turns/business data are explicitly synthetic. Admin form demonstrations do not claim a financial commit.\n\n")
            top += "\n\n".join("![" + ("实际页面" if zh else "Actual product capture") + "](assets/screenshots/" + name + ")" for name in ordered)
            top += "\n\n![" + ("实际交互 GIF" if zh else "Actual interaction GIF") + "](assets/screenshots/" + gif + ")\n\n"
            top += "[MP4](assets/screenshots/" + mp4 + ") · [" + ("录制与源码回执" if zh else "Capture/source evidence") + "](" + docs("quality/workmate-media-" + args.media + ".json") + ")\n\n"
            top += ("## 方案细则与更新\n\n" if zh else "## Detailed design and updates\n\n")
            top += "- [Product](" + docs("product/01-prd.md") + ")\n- [Architecture](" + docs("technical/01-architecture-and-stack.md") + ")\n- [Identity and permissions](" + docs("technical/07-security-and-permissions.md") + ")\n- [Task continuation](" + docs("technical/66-paid-native-input-checkpoints.md") + ")\n- [Admin](" + docs("product/08-admin-dashboard.md") + ")\n- [Native clients](" + docs("technical/30-native-window-and-browser-sidepanel.md") + ")\n- [Release notes](" + docs("changes/2026-10-22-workmate-publication.md" if zh else "changes/2026-10-22-workmate-publication.en.md") + ")\n\n"
            top += ("后续修改需要同步中英 README、受影响的实际截图/GIF、更新说明和对应分支。提交后通过 Delivery 发布流程核对远程 SHA；不强推覆盖协作者。§.env§、数据库、会话、依赖和安装产物不进入 Git。历史 README 原字节见 " if zh else "Every later change updates both READMEs, affected actual captures/GIFs, release notes and its mapped branch. Verify remote SHAs through Delivery publishing; do not force-push collaborator history. Keep environment secrets, databases, sessions, dependencies and installers out of Git. Exact historical README bytes are retained in ") + "[archive](" + docs("quality/history/stage66-before-workmate-readmes/manifest.json") + ").\n"
            write(directory / ("README.md" if zh else "README.en.md"), top)

    # Copy exact capture bytes into the main docs tree, keeping all main
    # documentation links inside docs and component READMEs self-contained.
    master_media = ROOT / "docs/design/implementation/workmate"
    master_media.mkdir(parents=True, exist_ok=True)
    for component in ("web", "admin", "desktop", "extension"):
        for file in (DEV / ("copypaste-" + component) / "assets/screenshots").glob("workmate-" + args.media + "-*"):
            shutil.copyfile(file, master_media / (component + "-" + file.name))
    shutil.copyfile(evidence / ("workmate-media-" + args.media + ".json"), ROOT / ("docs/quality/workmate-media-" + args.media + ".json"))
    print(json.dumps({"status": "passed", "component_readmes": 12, "media": args.media, "archived_readmes": len(read(manifest)["files"])}))


if __name__ == "__main__":
    main()
