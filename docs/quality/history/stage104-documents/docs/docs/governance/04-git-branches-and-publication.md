# Workmate 仓库、分支与同步规则 / Repository and publication policy


**阶段 103 / Stage 103：** 已实现持久后台账户批量任务、冻结目录／用量／费用／审计导出、逐项事务结果、取消、失败子任务重试、MFA／权限重查与过期密文清理。94 项后端检查、7 项真实后台流程、6 张截图和 2 组交互录制；明确假数据。SQL119 新增，SQL001–118 保留。原 102 REQ／102 TC 与 G01–G10 完整验收结论不变。见[方案与实际范围](../technical/103-persistent-admin-data-jobs.md)。



## 阶段 102 用户端内容发版 / Stage 102 client content releases

后台已接入三端公告、帮助与可选菜单的双语编辑、时间窗口、固定版本、身份前后预览、定向保底、发布和历史回滚。确认时复核全局权限、显式拒绝、有效会话及 MFA；失效预览不能覆盖新发版。Desktop 保留本机 Codex、无边框与无可见滚动条；Extension 保留原生右侧栏和获准上传。

Admin controls bilingual client guidance and optional menus through immutable drafts, recipient previews, targeted baselines, guarded publication and historical rollback. Confirmation rechecks global authority, explicit restrictions, the live session and MFA. Desktop remains local; Extension remains a native right Side Panel.

[Design / 方案](../technical/102-client-content-releases.md) · [Evidence / 证据](../quality/client-content-checkpoint.json). Original complete requirement, live role and G01–G10 acceptance decisions remain unchanged.



## 阶段 101 实际云端页面检查 / Stage 101 actual cloud browser checks

云端 Codex 新增实际 Chromium 页面交互、DOM 断言、原始截图及确切源码交付。固定原生运行时，在 Windows Job 内核对实际 renderer token，超时、取消及控制器异常退出后回收所属进程。页面使用独立来源 sandbox iframe、任务内资源和离线请求策略；不宣称 Chrome broker 具有操作系统级无网络权限。截图接口重新校验私有任务、来源与文件版本。新增四份 Skill 1.1.0 和六个软件角色 1.1.0，保留旧版本及权限边界。113 项相关测试和 4 项实际登录 Web 流程使用假模型与额度；Desktop 继续在客户本机运行 Codex，独立构建及打包。

Cloud Codex performs actual page interactions, assertions and PNG capture against exact task source. Native Jobs and measured renderer restrictions accompany cancellation/orphan cleanup. Private screenshot reads recheck task/source/version access. Four new Skill packages and six role versions preserve historical bindings and permissions. The 113 related checks and four Web checks use synthetic model responses and credit. Desktop remains customer-local and is built and packaged independently.

[Design / 设计](../technical/101-cloud-browser-preview.md) · [Evidence / 证据](../quality/cloud-browser-checkpoint.json). Static browser, API and SQLite checks remain independent; combined deployed applications, arbitrary packages, live role quality and full product acceptance require separate evidence. Original requirement and gate decisions remain unchanged.



## 阶段 100 云端 API 与数据库检查 / Stage 100 cloud API and database checks

云端 Codex 新增真实 HTTP 应用请求及原生 SQLite 数据和约束检查工具。请求经匿名管道传输，不涵盖外部 TCP/TLS；SQL 验证使用新建 SQLite，并在原生调用前拒绝 PRAGMA、ATTACH、DETACH、VACUUM。原生 AppContainer/单进程 Job 限制网络、文件和进程；超时、取消及宿主中断须实际清理。回执绑定确切源码，失败及旧版本不可冒充当前通过。Web 显示实际输出、版本状态和下载；Desktop 保持客户本机执行。96 项相关测试与 4 项登录 Web 流程使用假模型和额度，实际运行 Codex、原生程序及 PostgreSQL。

Cloud Codex can run actual HTTP application requests and native SQLite data and constraint checks inside a native AppContainer and single-process Job. Receipts bind exact source; failures and stale versions cannot become current passes. Web exposes output and authorized downloads. Desktop remains customer-local. The 96 related tests and four Web journey checks use synthetic model responses and credit with actual Codex, native execution and PostgreSQL.

[Design / 设计](../technical/100-cloud-development-checks.md) · [Evidence / 证据](../quality/cloud-development-checkpoint.json). Original requirement and gate decisions remain unchanged; cloud browser preview, production model quality and full professional acceptance remain unproven.



## 阶段 99 云端程序检查 / Stage 99 cloud program checks

云端 Codex 新增固定 Node 程序、内置测试及语法检查工具。原生 AppContainer/单进程 Job 限制网络、文件和进程；超时、取消及宿主中断须实际清理。回执绑定确切源码，失败及旧版本不可冒充当前通过。Web 显示实际输出、版本状态和下载；Desktop 保持客户本机执行。83 项相关测试与 4 项登录 Web 流程使用假模型和额度，实际运行 Codex、原生程序及 PostgreSQL。

Cloud Codex can run pinned Node programs, built-in tests and syntax checks inside a native AppContainer and single-process Job. Receipts bind exact source; failures and stale versions cannot become current passes. Web exposes output and authorized downloads. Desktop remains customer-local. The 83 related tests and four Web journey checks use synthetic model responses and credit with actual Codex, native execution and PostgreSQL.

[Design / 设计](../technical/99-cloud-program-execution.md) · [Evidence / 证据](../quality/cloud-program-checkpoint.json). Original requirement and gate decisions remain unchanged; the other three cloud development tools and full professional acceptance remain unproven.



## 阶段 98 固定专家与品牌 / Stage 98 saved specialists and brands

预设角色可绑定当前项目的确切品牌版本；分页只选择元数据。Desktop 的「我的专家」直接创建固定专家版本的本机会话，客户独立选择目录和权限，再按次批准预算。保存的工作要求、品牌资料与获准记忆进入真实本机 Codex；公司工具限于专家配置范围。数据库保护同会话的专家引用和任务上下文，断线恢复沿用原正文与幂等键。Web/Extension 保留云端执行。

Presets can pin an exact project brand revision. Desktop saved specialists create local sessions with a fixed specialist version; customers separately choose a folder, grant local permission and approve each turn budget. Saved instructions, brand guidance and authorized memories reach actual local Codex, and company tools respect the saved subset. Database guards preserve session references and task contexts; reconciliation reuses the original request and key. Web and Extension remain cloud agents.

[Implementation / 设计](../technical/98-preset-specialists-and-brand-versions.md) · [Current evidence / 当前证据](../quality/preset-specialists-checkpoint.json)

原始 102 项完整验收和 G01–G10 判定保留；测试使用授权的假模型与额度。Original full acceptance remains unchanged; synthetic models and credit support this scoped development verification.



## 阶段 97 本机方案 / Stage 97 native methods

Desktop 首次方案试运行、停止、恢复、逐项验收与发布接入客户本机 Codex。整批固定角色须有新的本机会话、客户目录和权限，批准总预算后原子预留，再逐项主动启动。未知回应用原正文与幂等键核对；既有会话的工具版本保持固定。Web/Extension 的 Agent 继续在云端执行。

Desktop method trials, cancellation, reconciliation, exact delivery acceptance and publication now use local Codex. Customers approve fresh native sessions, folders, permissions and the complete budget. Uncertain admissions reuse the original request; pre-upgrade conversations retain their tool version. Web and Extension remain cloud agents.

[Implementation / 设计](../technical/97-native-method-trials.md) · [Current evidence / 当前证据](../quality/native-methods-checkpoint.json)

历史条目保留其原始范围；本阶段不改变原始 102 项完整验收及 G01–G10 判定。Earlier evidence keeps its historical scope; original full acceptance and gates remain unchanged.



## 阶段 96 方案实现补充 / Stage 96 method implementation

阶段 96 补齐业务方案的不可变版本、免费依赖预览、私有付费试运行、逐项验收、发布和跨项目安装重绑定。122 项相关集成检查、45 项 Desktop 单元检查、2 项真实本机 Codex 检查及 8 项实际浏览器检查通过。模型与账号数据按当前要求使用假数据；文件、进程、授权、费用和审计走实际流程。

Stage 96 implements immutable business-method versions, free dependency previews, private paid trials, exact-delivery acceptance, publication and fresh cross-project rebinding. 122 related integration checks, 45 Desktop unit checks, two actual local Codex checks and eight actual browser checks pass. Model/account data remain explicitly synthetic; files, processes, authorization, accounting and audit execute normally.

[方案及约束 / Implementation](../technical/96-versioned-business-solutions.md) · [专项证据 / Scoped evidence](../quality/solution-packages-checkpoint.json)

SQL112 新增严格版本、实际试运行与来源控制，既有 OpenAPI、迁移、Skill 及原始需求、验收用例和 G01–G10 判定保持历史依据。发布使用 `finalize_solution_packages_manifest.py` 绑定各仓库实际提交，再运行现有 Delivery 发布器，普通推送并核对八个远端引用；既有授权持续有效。

以下保留原始规格与此前阶段的实现记录；最新源码范围以上方阶段 96 补充及检查点为准。原始完整验收判定未因本次增量改变。

Original specifications and earlier implementation records follow. The stage 96 supplement and checkpoint above define this increment; original complete acceptance is unchanged.

阶段 88 当前增量：客户本机批准的固定程序、结构化参数、原生进程树及停止/撤销、父进程退出清理、原费用回执；浏览器普通打开与弹窗统一每任务三页/每执行器两个活动上下文，实际销毁后释放、复用前清除存储；会话等待不锁住其他会话的新建和操作。68 项打包 Desktop、114 项 Desktop 单元、18 项原生 Codex、184 项客户端、91 项相关后端及 6 项严格声明检查通过。模型和部分原生对话框决定为明确假数据；完整产品、至少十二个合格角色及 G01–G10 仍未验收。 见[方案及边界](../technical/88-approved-local-programs.md)。当前源码和已发布版本分别以本阶段检查点、最终提交及远程回执为准；下文保留历史阶段原范围。


**阶段 87 历史范围：** Desktop 目录监听、稳定快照、持久批量队列、原轮次客户回答、实际应用重启后暂停、原线程/固定版本继续、独立费用和预算/撤销已有限定验证。57 项打包 Desktop、91 项 Desktop 单元、161 项客户端单元通过；原 50/69 项保留。紧凑摘要分行及页面 Home/End 修复已核对；输入框保留光标操作。全部 14 个运行素材/许可证保留，仓库媒体不进入运行 ASAR。本阶段不新增 API/SQL；沿用阶段 86 未变化后端/Web/Admin/Extension 的历史 1023/25/36/14 范围，不宣称完整套件重跑。REQ-040/042 更新部分，原 102 项为 86 部分／16 未证明完整／0 完整验收；至少十二个专业角色和 G01–G10 继续开放。见[当前方案与精确证据](../technical/87-desktop-folder-work.md)。

下文保留原规范和各阶段历史记录；历史「当前」及阶段专用命令仅解释其原始回执。新发布流程使用本阶段检查点、文档/媒体核对和提交清单。

**阶段 86 历史基线：** 共享配置草稿/精确预览/不可变发布、新工作固定版本、旧任务保留原版或原先无配置状态，已在实际 Web、原生侧栏及本机 Codex 核对。本机三次执行采用 v3/v3/v4，资料工具与本地原字节、各自费用结算均检查。侧栏聊天附件先建立本人私有会话，分片校验与精确恢复回执不回退共享；同项目另一编辑者不能列出、下载、读取版本或访问私有会话。独立 Admin 正文/费用权限与隔离/恢复/永久擦除继续生效。平台 1023（保留原 1001）、核心 25、兼容 36、客户端 139、实际 Web/Admin/侧栏 14、打包 Desktop 50 分别通过，选定源码精确相符。SQL103 增量保留 SQL001–102 和四份历史契约；487 配置路由加 1 条条件 demo 路由。REQ-065 更新为部分验证，原 102 项为 84 部分／18 未证明完整／0 完整验收，G01–G10 和其余全部差异保留。假模型证据不代表真实专业质量。见[当前方案与限定证据](../technical/86-shared-project-guidance-and-private-chat.md)。

本阶段先完成当前检查点、媒体/文档及暂存核查，提交六组件后执行 `python -X utf8 docs/tools/finalize_shared_configuration_manifest.py`，再提交主文档。在 Delivery 执行 `node scripts/publish-workmate.mjs --push`，核对八个实际远程 SHA。旧阶段工具仅解释历史回执，常规同步沿用用户既有授权，禁止强推。

以下保留既有规范及历史记录；阶段专属命令仅解释当时回执，当前增量以前述方案、检查点和发布流程为准。 Existing specifications and historical records follow. Stage-specific commands explain their original receipts; the current increment uses the guidance, checkpoint and publication flow above.

**阶段 85 历史基线：** 原任务中的音频提案需原客户以当前登录会话独立确认精确内容和公司报价；默认不勾选，权利依据/用途为空。模型与 Admin 不能代签。拒绝、截止、停止及撤权阻断派发，撤回阻断交付但保留真实或未知费用。新增 SQL102，保留 SQL001–101、四份已发布契约及旧角色/Skill。平台 1001（全部原 988 用例保留）、核心 56、兼容 80、客户端 124、真实 Web/Admin/原生侧栏 13、打包 Desktop 41 分别通过；全部选定源码摘要精确相符。Desktop 保持客户本机 Codex、主动可撤销全权限、无边框/菜单，无可见纵横滚动条，保留滚轮/键盘/末项焦点及真实进度。原生右侧栏保持云端 Codex 和获准文件上传。真实声音/粤语质量、后台音频发行和未知 POST 外部证据结算仍保留；原 102 REQ/102 TC 为 83 部分／19 未证明／0 完整验收，G01–G10 不变。见[当前方案与限定证据](../technical/85-audio-rights-and-administration.md)。

本次先提交六个组件，再执行 python -X utf8 docs/tools/finalize_audio_authorizations_manifest.py，最后提交主文档。随后在 Delivery 执行 node scripts/publish-workmate.mjs --push，按发布回执核对 backend/web/admin/desktop/extension/delivery/docs/main 八个远程 SHA；docs 与 main 必须相同。历史工具/回执保持原阶段范围，常规同步沿用既有授权，禁止强推。

GitHub 目标为 [copypasteltd/workmate](https://github.com/copypasteltd/workmate)，SSH 地址为 `git@github.com:copypasteltd/workmate.git`。各端继续保留独立 Git 历史和独立构建入口，按下表发布到同一远程的不同分支。每次发布以最终远程分支 SHA 核对及本次发布回执为准。

| 本地目录 | 本地工作分支 | GitHub 分支 | 职责 |
| --- | --- | --- | --- |
| `dev/copypaste-platform` | `codex/backend` | `backend` | API、Codex、身份权限、业务、计量与数据库 |
| `dev/copypaste-web` | `codex/web` | `web` | 云端用户工作台 |
| `dev/copypaste-admin` | `codex/admin` | `admin` | 独立管理后台 |
| `dev/copypaste-desktop` | `codex/desktop` | `desktop` | 无边框 Electron、本机 Codex、客户授权/费用及独立可选文件桥 |
| `dev/copypaste-extension` | `codex/extension` | `extension` | Chrome MV3 原生右侧栏 |
| `dev/copypaste-delivery` | `codex/delivery` | `delivery` | 原生启动、验证、录制与发布工具 |
| 项目根目录 | `codex/docs` | `docs`、`main` | 主需求、架构、交付说明和跨分支导航 |

`main` 和 `docs` 发布相同的主文档提交。各分支根目录直接包含对应仓库内容，不把各端代码混放在一个分支中。`docs/README.md` 提供总导航；各端 `README.md` 为中文、`README.en.md` 为英文。GitHub 上的跨端和主文档链接使用明确分支 URL，避免依赖不存在的上级目录。

表中 `codex/*` 是当前工作分支。按 README 新检出的本地同名分支（例如 `backend`、`docs`）也可直接执行发布器，无须额外重命名；其他功能分支应先审阅并整合到对应工作分支。本次使用 `python docs/tools/finalize_audio_authorizations_manifest.py` 明确刷新已提交组件清单，再提交主文档；旧清单保留于 Git 历史。

## 每次更新必须同步

1. 在唯一 D 盘工作区的对应独立仓库修改代码；主文档和文档工具仍放在根目录 `docs/`。
2. 按实际改动完成类型、测试及必要的原生验证。模拟数据、实际 Codex 进程、生产接口、安装和商店资格分别说明，保持原 102 项需求与全部验收门槛。
3. 同步修改中英双语 README。改变界面或使用流程时，补录实际页面截图、交互视频及 GIF，并说明数据来源与演示范围。记录源码和媒体摘要。
4. 在 `docs/changes/` 维护中英双语更新说明，记录改动、使用影响、验证和剩余限制。历史 README 原始字节归档于 `docs/quality/history/`，不将历史阶段结论当成最新结论。
5. 检查待发布源码、历史对象大小和凭据；不提交 `.env`、本地账户/会话、数据库、运行状态、依赖或安装包。安装包保持本地忽略产物，源码附可复现构建命令。
6. 提交各端，再提交主文档中的组件版本清单。推送明确列出的目标分支，核对远程 SHA 与本地提交一致。正常更新不强制推送，不删除其他分支，不创建未经要求的定时任务。

用户已明确要求后续修改同步推送此远程；常规修复、文档和演示素材更新不重复询问发布授权。遇到真实远程分支冲突先取回并处理，不能用强推覆盖协作者的工作。

## English

Each component remains an independent local Git repository and publishes its root content to the branch shown above. The primary documentation repository publishes the same commit to `main` and `docs`. Every component has a complete Chinese `README.md` and English `README.en.md`, with architecture, setup, identity and usage flows, configuration, verification, screenshots and actual interaction media.

The table records current `codex/*` working branches. Fresh README checkouts using the published local branch names, such as `backend` and `docs`, can also run the publisher directly. Integrate reviewed feature work into the mapped branch first. Refresh this delivery's committed component versions explicitly with `python docs/tools/finalize_audio_authorizations_manifest.py`, then commit docs; Git history preserves the prior plan.

Every subsequent change must update the corresponding documentation and bilingual release notes, refresh relevant real captures when UI behavior changes, run checks appropriate to the change, commit, push the explicitly mapped branch and compare remote commit IDs. The user has authorized ongoing synchronization to this remote. Preserve collaborator history; do not force-push or delete unrelated branches. Keep credentials, local sessions, databases, dependencies and generated installers out of Git. Synthetic demonstrations and production qualification must remain clearly distinguished.

All work remains under `D:\dev\copypasted\自有agent\`; native processes only, with no Docker/WSL/virtualization. Close owned browser tabs and instances after capture while preserving the user's windows.

## 当前版本清单 / Current publication manifest

阶段 82 使用上方 `finalize_creative_feedback_manifest.py`：先完成当前检查点、文档核对及七仓库暂存检查，再提交六个组件，由此工具绑定已提交组件与当前证据，最后提交主文档并运行 Delivery 发布器。旧阶段工具保留用于解释各自历史回执，不能直接套用于新的源码。以后更新须使用与当次检查点匹配的清单工具，并保留其真实验证范围。

For stage 82, complete the current checkpoint, documentation audit and staged checks, commit the six components, run the manifest tool shown above, then commit documentation and invoke the Delivery publisher. Earlier tools explain their own historical receipts. Subsequent updates must bind their own current sources and qualification rather than reuse stale source assumptions.

阶段 82 历史发布使用 `finalize_creative_feedback_manifest.py` 绑定当时已提交组件、回执、双语文档及暂存核查；旧阶段工具和回执保留自身历史范围。Stage 82 bound its own receipts and committed components before non-force publication; earlier evidence is retained under its original scope.

阶段 83 使用 `finalize_geo_observation_manifest.py` 绑定已提交的六个组件、当前 GEO/原生布局回执、双语说明、实际媒体及暂存核查，再按既有授权非强制推送。旧阶段工具和回执仅保留其历史范围。Stage 83 binds exact committed components and current evidence before the authorized ordinary push.

阶段 84 使用 `finalize_audio_authorizations_manifest.py` 绑定已提交六组件、当前音频/字幕、原生布局、完整回归、实际媒体与双语文档。先完成实际检查和暂存核查，再提交六组件、刷新清单、提交主文档，最后运行 Delivery 发布器并核对八个远程分支 SHA；不复用旧阶段源码假设，不强推。

Stage 84 binds committed components to its current audio/native-layout, full-regression, media and bilingual documentation evidence with `finalize_audio_authorizations_manifest.py`. Complete checks and staged review, commit the six components, refresh the manifest, commit docs, then run the publisher and verify all eight remote refs without force.


## 阶段 93 当前发布 / Current stage 93 publication

使用 `finalize_agent_groups_manifest.py` 绑定实际已提交的六个组件、当前团队执行检查点、双语文档和媒体。先完成相关回归、实际浏览器检查、媒体解码和七仓库暂存核查，再提交组件，刷新主清单，提交主文档，最后在 Delivery 执行 `node scripts/publish-workmate.mjs --push`，核对八个远程分支 SHA，docs 与 main 相同。既有常规同步授权持续有效，禁止强推。

Stage 93 binds committed components with `finalize_agent_groups_manifest.py` after current scoped tests, browser evidence, complete media decoding and staged review. Commit components, refresh the manifest, commit docs, then run the Delivery publisher and verify all eight remote refs without force. Earlier stage tools retain historical scope. SQL108 is additive; original migrations, contracts, Skills and 102 requirement records remain unchanged.


## 阶段 94 当前发布 / Current stage 94 publication

先完成本次精确源码团队回归、实际翻页及原生 Codex 检查、媒体完整解码、双语文档和七仓库暂存核查，再提交各组件。使用 `finalize_agent_group_history_manifest.py` 绑定实际提交、检查点与证据，提交主文档后在 Delivery 执行 `node scripts/publish-workmate.mjs --push`，核对八个远端 SHA。SQL109 只新增索引；既有用户授权持续有效，禁止强推。

Stage 94 binds actual committed components with `finalize_agent_group_history_manifest.py` after current scoped regression, real browser/native Codex, full media decoding, bilingual documentation and staged review. Commit documentation and run the Delivery publisher to verify all eight remote refs. SQL109 adds only an index. Existing ordinary publication authorization persists; no force push. Earlier receipts retain historical scope.


## 阶段 95 当前发布 / Current stage 95 publication

先完成本次精确源码相关模块回归、实际特效交付及原生 Codex 检查、媒体完整解码、双语文档和七仓库暂存核查，再提交各组件。使用 `finalize_media_effects_manifest.py` 绑定实际提交、检查点与证据，提交主文档后在 Delivery 执行 `node scripts/publish-workmate.mjs --push`，核对八个远端 SHA。SQL110/111 增加审阅特效约束与回执；既有用户授权持续有效，禁止强推。

Stage 95 binds actual committed components with `finalize_media_effects_manifest.py` after current media-effect regression, real browser/native Codex, full media decoding, bilingual documentation and staged review. Commit documentation and run the Delivery publisher to verify all eight remote refs. SQL110/111 add reviewed effects and receipts. Existing ordinary publication authorization persists; no force push. Earlier receipts retain historical scope.
