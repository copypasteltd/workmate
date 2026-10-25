# 当前产品与完整目标的差异评估 / Goal gap assessment

评估日期：2026-10-25，Asia/Taipei；本次为同日第五次工作区复核。已发布产品基线为阶段 85；本次读取后续未提交源码及分别执行的最新专项、实际 Web/Admin/侧栏通过回执、打包 Desktop 失败回执，并核对八个实际远程分支。历史基线、当前限定通过和仍未通过的流程分别记录。评估操作没有重新运行产品测试或修改产品代码。

当前产品已有可运行的多端实现和大量局部验证，但尚未达到「全部业务模块完整可用、至少十二个专业角色合格、三端完整交付并通过业务验收」的目标。主要差距包括功能缺口、已有功能未贯通的完整流程，以及业务与正式发布验收。

本评估继续遵守「暂时先用假数据」的用户指令。内部 API 密钥和真实客户账号未提供，不作为当前代码开发的阻塞条件；真实服务质量、正式平台授权和客户接受另列为后续验收，不把模拟接口通过写成已经正式接通。

## 第五次工作区复核：当前状态

此前发现的 **Extension 聊天附件被放入项目共享范围** 已有修复及实际重跑通过证据，不能继续列为仍在复现的故障。当前代码先创建私有会话，再按该会话进行可恢复分片上传，保存精确请求/文件摘要回执。实际原生侧栏检查确认：上传者下载得到原始字节，同项目另一位已登录编辑者不能列出文件，下载、版本和所属会话接口均返回 404。此结论仅覆盖回执中的实际范围；完整大文件、休眠、撤权和站点授权矩阵仍需补齐。

当前新增的明确未通过项在 **打包 Desktop 的共享配置流程**：隔离资料后，预期的来源失效提示在 20 秒内未显示，实际流程整体失败。此前完成的 38 个观察保留，但不能当成整段通过；新增本机 Codex 的 v3/v3/v4 版本固定、续做及工具读取检查没有进入，仍未验证。本次评估没有定位该失败属于渲染还是检查路径，不擅自把它归为纯测试问题。

| 复核编号 | 当前证据 | 对完成状态的影响 |
| --- | --- | --- |
| REVIEW5-01 | 最新核心专项 `project-configuration-checks-05.json` 为 24/24，通过原生 PostgreSQL、HTTP、精确资料字节及八个新增接口的成功请求/响应契约检查 | 旧任务原先无共享配置时续做仍保持无配置的回归已有通过证据；不等于全平台回归或全业务验收 |
| REVIEW5-02 | 实际 Web/Admin/原生 Side Panel 的 `project-configuration-ui-06.json` 共 12 项通过，包含私有附件跨用户隔离、旧/新配置、独立正文权限和隔离/恢复/永久删除 | 修复第四次复核中的附件范围故障，并补足共享配置的限定跨端与后台治理证据；模型内容使用已授权假数据 |
| REVIEW5-03 | Extension 单元原始日志为 47/47，包含并发附件、丢失创建/分片/完成响应、替换 worker、同一文件重选、撤权和错误范围响应 | 这些是单元级恢复证据，不替代真实休眠/大目录/站点权限或完整六端资格回执 |
| REVIEW5-04 | `desktop-local-ui-55.json` 为 failed；完成 38 个观察后，等待隔离来源提示超时，新增本机配置场景未进入 | Desktop 的新增共享配置流程仍须修复或定位后重跑；阶段 85 的本机 Codex 和 41 项历史通过不因此消失，也不能代替当前增量通过 |
| REVIEW5-05 | 重算核心专项 1493、实际跨端 1460、Desktop 失败回执 1404 个选定源码，分别全部匹配当前字节；阶段 85 的 1494 项中 1471 一致、23 变化 | 当前通过和失败均可绑定各自选定源码；新增文件另计，当前完整兼容与全平台回归仍未完成 |
| REVIEW5-06 | 实际窄侧栏截图中，展开的配置摘要及工作区/项目选择占用高度，输入与发送区没有完整出现在画面内 | 功能检查通过不能代替视觉和末项触达验收；需补齐视口布局与发送操作可达性，不能将全端视觉标为完成 |
| REVIEW5-07 | 六组件均有未提交开发，已提交 HEAD 与实际远程一致，docs/main 输入为 738d9f2c67f560823cee2d942668aa3a1ab33c0d；实际流程记录拥有的浏览器、API、夹具、预览及数据库已关闭 | 候选代码尚未随正式组件交付；本次只同步评估文档，不混入未提交产品增量，不启动虚拟化环境 |

完整摘要、原始回执摘要、源码重算及权限观察见[第五次复核记录](2026-10-25-goal-gap-review-05.json)。前四次记录和全部失败回执保留。26 个差异组、102 项原需求、83 部分/19 未证明完整/0 正式完整验收及 G01–G10 保持；这些数值不能换算为开发完成百分比。下方历史复核的「当前」与数值仅描述各自原时间，最新判断以本节及更新后的编号差异表为准。

## 第四次工作区复核：历史状态

当前最明确的新增问题是 **Extension 聊天附件没有按私有会话隔离**。最新实际原生侧栏流程中，附件经项目 `/assets` 接口上传，客户端没有传入私有会话绑定，后端该接口也没有按聊天会话保存；实际数据库中的 `private_owner` 为 NULL，而非当前用户。检查因此失败。这说明文件被放入项目共享范围，需要优先修复；不据此推断存在跨企业泄露。该缺陷列入 GAP-03 与 GAP-20，不能仅列作「尚待补测试」。

| 复核编号 | 当前证据 | 对完成状态的影响 |
| --- | --- | --- |
| REVIEW4-01 | 最新实际界面回执 `project-configuration-ui-05.json` 总体为 failed；完成 7 个限定检查后，在附件私有归属断言失败 | 已观察到产品隐私缺陷；整段侧栏/后台流程没有通过，不以中途断言数代替完整验收 |
| REVIEW4-02 | 失败前已核对实际 Admin OTP/TOTP、费用预览、HKD10 人工赠额与幂等重放；Web 配置保存/发布、旧任务固定版本、历史复制、来源隔离及窄屏双语共五项；真实 Chrome 右侧栏与 OTP/PKCE 只读摘要一项 | 这些是保留的局部进展；尚未证明全部后台治理、侧栏发送/恢复、角色专业成果或实时模型质量 |
| REVIEW4-03 | 历史专项 22/22 保留；当前重算其 1489 个选定源码为 1476 一致、13 变化、0 缺失 | 22/22 属于当时源码，不能标成当前候选版本通过。发布前旧任务续做时错误采用后来共享配置的代码已调整并新增回归用例，仍需新的运行回执 |
| REVIEW4-04 | 最新失败界面回执中的 1457 个选定源码均与当前字节匹配；阶段 85 的 1494 个条目为 1473 一致、21 变化；新文件另计 | 当前失败可绑定其选定候选源码；已发布基线通过不能替代变更后的完整回归。新 Desktop 本机 Codex 配置场景仍是待执行脚本 |
| REVIEW4-05 | 六组件均有未提交开发；六个已提交组件 HEAD 与实际远程对应分支一致，docs/main 输入均为 3ab1800a4011d4dd18d22a9d05277128e031e82c | 现有提交已同步，当前开发增量尚未交付。此次仅发布评估文档，不混入六组件未提交代码 |
| REVIEW4-06 | 失败回执记录自建浏览器、API、夹具、预览与数据库均关闭；本次评估没有新建浏览器或数据库 | 保留资源清理证据；没有启动 Docker/WSL 或其他虚拟化环境 |

完整记录见[第四次复核记录](2026-10-25-goal-gap-review-04.json)。前三次记录及失败/通过原始回执原样保留。下文 26 个差异组仍覆盖全部 102 项原需求；83 部分、19 未证明完整、0 完整验收及 G01–G10 保持原登记，不给出无法据此推导的完成百分比。

## 第三次工作区复核：历史开发状态

首次评估发布后，项目共享配置继续开发。当前 backend 已有草稿、预览、发布、精确版本、来源门控与 Admin 治理代码；Web/Desktop 已接入编辑器、历史版本及继承摘要，Extension 已接入只读摘要和项目隔离，Admin 内容入口也已调整。共享文件选择已补搜索与分页，失效来源的旧发布正文在替换预览中隐藏。这六个组件仓库都有未提交增量，尚未随已发布版本交付。GAP-13 当前为「专项 22/22 通过，多端实际界面、兼容及完整回归待验」；存在客户端代码，也仍有待完成的流程与正式交付。

| 复核编号 | 当前证据 | 对完成状态的影响 |
| --- | --- | --- |
| REVIEW-01 | 新增 SQL103、项目配置后端及 Web/Desktop 编辑与继承摘要、Extension 只读摘要和 Admin 内容治理代码 | 多端实现已开始；保留原 REQ-065 未证明完整的状态 |
| REVIEW-02 | 第三次专项共 22 项，22 通过、0 失败、0 跳过；该回执中的平台类型、Admin 类型和平台构建均通过 | 已有成功的限定专项回执；新增实际界面、兼容、完整回归与正式交付仍待验证 |
| REVIEW-03 | 首次专项的 SQL42501、迁移数和预留状态失败在第二次对应检查中已通过；原始 12/15 失败报告保留 | 原数据库权限故障已有修复证据；不能继续列作当前仍复现的故障，也不能删除第一次失败历史 |
| REVIEW-04 | 第二次失败来自测试消息遗漏 expected_version；第三次同项私有任务版本与可见性检查通过，并新增共享文件分页/字面搜索及旧正文失效检查 | 原失败已有重跑通过证据；保留两份失败历史，不将该限定通过扩大为全部客户流程达标 |
| REVIEW-05 | 阶段 85 的 1494 个选定源码重新计算摘要：1473 一致、21 个变化；第三次专项的 1489 个选定源码全部匹配当前字节，原始 TAP 与验证器 SHA-256 匹配回执 | 最新专项可以绑定当前选定源码；旧 1001 项通过仍属于原基线，不能替代新增源码的完整回归 |
| REVIEW-06 | 实时读取八个远程分支，六组件已提交 HEAD 均与远程一致，docs/main 输入为 a1c9ca7e7851320744f97f4b83eb3edf0515f6be；六组件都有未提交增量 | 已发布源码确已同步；未提交的共享配置增量尚未发布，不能混称为远程已交付 |
| REVIEW-07 | 已新增实际 Web、Admin、原生 Side Panel 的配置流程脚本，并扩展打包 Desktop 检查脚本；尚无这些新增界面的运行回执 | 脚本和预期检查数不等于已执行或已通过；保留阶段 85 的 13/41 项作为各自历史范围 |

三次专项原始材料分别保留在本地 `dev/copypaste-delivery/evidence/project-configuration-checks-01.*`、`project-configuration-checks-02.*`、`project-configuration-checks-03.*` 及各自 `-verifier.mjs`；前两次为 `failed`，第三次为 `passed`。第三次回执记录 `source_unchanged=true`、`owned_database_shutdown=true`。22 项由 19 项共享配置检查与 3 项迁移检查组成，包含实际原生 PostgreSQL、HTTP 与资料字节检查，运行适配器使用受控夹具；不证明真实供应商、真实 Codex 专业成果或完整浏览器流程。当前摘要、仓库状态、远程分支和回执核对保存在[本轮复核记录](2026-10-25-goal-gap-review-03.json)，[第二次记录](2026-10-25-goal-gap-review-02.json)保留原时间与结果。此次评估没有启动数据库或浏览器。

此前第二次复核的三份文档共有 223 个本地链接，26 个差异编号及 102 项需求映射检查通过；更早的全目录通用检查另记录 6199 条历史归档相对链接错误，全部位于未修改的 `quality/history/`。这些数字属于对应历史记录，本轮未重跑全目录检查。GAP-25 继续要求明确归档来源位置与校验范围；本轮改动的局部检查另记于复核记录，不能据此宣称全目录已通过。

## 评估口径

| 项目 | 当前记录 | 应如何理解 |
| --- | --- | --- |
| 原需求 / 原产品验收用例 | 102 / 102 | 保留原编号和完整通过条件 |
| 部分验证 | 83 项 | 有局部实现及验证证据，尚未关闭同号完整验收 |
| 尚未证明完整达标 | 19 项 | 同时包含实际缺少功能和已有增量但完整条件未满足的需求 |
| 完整验收关闭 | 0 项 | 不能解释为产品没有功能，也不能据此声称只剩 19 项开发工作 |
| 角色目录 | 18 个候选 | 已有目录、精确 Skill 绑定及部分实际运行；正式合格角色记录仍为 0，至少 12 个的交付目标尚未验收 |
| 阶段 85 完整平台检查（历史） | 1001 / 1001 通过 | 来自已发布基线，覆盖 78 个测试文件、20 个批次；不代表当前候选源码完整通过 |
| 阶段 85 客户端 / 实际跨端 / 打包 Desktop（历史） | 分别 124 / 13 / 41 项 | 保留当时范围；不能相加当成独立产品验收数量，也不能替代当前增量验证 |
| 当前共享配置专项 / 实际 Web、Admin、侧栏 | 分别 24 / 12 项通过 | 分别绑定当前选定源码；实际跨用户附件隔离及共享配置治理已观察，完整回归未完成 |
| 当前打包 Desktop 增量 | 38 个观察后整体失败 | 等待隔离资料提示超时；新增本机配置版本固定与续做场景未进入，不计为通过 |
| 发布门槛 | G01–G10 均未完整证明 | 源码推送、局部 UI 检查与正式发布验收是不同事项 |

来源：[当前需求追踪](requirements-alignment-progress.json)、[阶段 85 精确检查点](audio-authorizations-checkpoint.json)、[原测试计划](01-test-and-acceptance-plan.md)。本报告不更改上述状态，也不给出无法据此推导的完成百分比。

下表采用本次评估编号 GAP-01–GAP-26，并在附录映射全部原需求。一个需求可以关联多个差异项，26 个差异组不是剩余任务数量。类型含义：**功能缺口**指仍需开发；**流程待补**指已有实现但尚未贯通完整边界；**验收待补**指需要相应运行或业务证据。建议优先级 P0 为核心交付前优先处理，P1 为完整业务范围继续补齐，P2 为原文档的可选后续能力；不覆盖原需求自己的优先级。

## 编号差异表

| 编号 | 模块 / 类型 | 当前已具备 | 距离目标的具体差异 | 完成标准 | 建议优先级 |
| --- | --- | --- | --- | --- | --- |
| GAP-01 | 访问、登录与首项工作；流程、验收待补 | 邀请、用户登录、设备 PKCE、刷新撤销、默认助手、站内通知及部分真实页面流程 | 从首次访问到首任务的完整入口矩阵尚未验收；自动发现必要资料、补齐后续做、退出/过期/换企业/断网及安装包身份流程仍不齐 | 用户从邀请或访问进入，完成登录、选择可用角色、补齐必要输入、提交和领取成果；异常后状态、身份和费用均正确 | P0 |
| GAP-02 | Desktop 本机能力；功能、流程待补 | 本机锁定 Codex、文件与终端、客户主动且可撤销的完整权限、Skills、浏览器工具、父子 SOP、停止及同线程继续 | 目录监听、防抖去重、批量本地调度仍缺；检查点和离线续做、全角色本机工具与应用操作尚未完整证明，不能宣称已全面对标 Codex Desktop | 按 DESK-L01–L08 逐项验证本机文件/终端/工具、持续会话、停止恢复、切换身份和撤权；补齐本地调度及逐项承诺的应用操作 | P0 |
| GAP-03 | Extension 对话和文件；流程、视觉待补 | 原生右侧 Side Panel、ChatGPT 式云端聊天独立于 Desktop；当前私有会话分片上传、精确回执重用和同项目其他编辑者隔离已实际通过，47 项单元检查保留 | 完整大文件、中断、真实 worker 休眠、换项目、撤权及站点授权矩阵仍待验收；窄侧栏展开摘要后输入/发送区未完整入镜，需补视口和末项触达 | 无需 Desktop 完成私有附件上传与消息绑定；项目共享须明确选择。实际故障矩阵不重复提交或串会话，窄屏各状态均可访问输入与发送操作 | P0 |
| GAP-04 | Codex 持续执行与恢复；流程待补 | 唯一 Codex 内核、公司网关、持久任务、事件、租约、排队暂停、原线程继续和停止均有局部证据 | 已付费步骤检查点、运行中安全暂停、多节点/崩溃恢复、全工具追踪和全部工作模式边界尚未贯通 | 中断后续做原任务并正确累计费用；不重复付费步骤、不丢已确认结果、不回退到其他内核 | P0 |
| GAP-05 | 至少十二个专业角色；流程、业务验收待补 | 18 个候选角色，覆盖开发、设计和指定设计师；已有精确 Skill 包和部分真实 Codex 加载 | 目录数量已超过 12，但尚未取得至少 12 个角色各自完整任务、成果修改及依赖/权限异常的正式资格证据 | 至少 12 个不同角色可直接选用，逐个交付真实文件、继续修改、正确处理异常，并记录模板/Skill/内核/模型和费用；设计师包含 Image 2 | P0 |
| GAP-06 | Skill、企业模板与能力采用；功能、流程待补 | 随附 Skill 安装、绑定、版本固定和撤销；部分文字/图片及视频能力已支持受控验证发布 | 自定义 Skill 包试运行/组织发布、企业模板覆盖、安全复制、版本比较与用户显式采用尚未齐；全部动态依赖交集和音频发行仍需接入 | 从草稿、试运行、审核、发布到比较/显式升级和回滚完整可用；历史运行固定旧版本，安全撤销约束后续调用 | P0 |
| GAP-07 | 设计、生图、排版与可编辑交付；流程、验收待补 | 品牌固定版本、图片/限定编辑链路、真实字体与分层图文、批量矩阵、局部修改、PDF/源码交付已有局部证据 | 真实 Image 2 的业务质量未验收；字体/混排/换行/溢出、品牌事实遵循、图片选区修改、全类型审阅和可恢复工程未覆盖完整专业业务 | 完成 brief→固定品牌→出图→准确排版→选区/单格修改→客户审阅→交付与恢复编辑，文件、版本和费用一致 | P0 |
| GAP-08 | 视频完整生产；流程、验收待补 | 脚本/分镜/模板工程、真实可播放成片、生成式视频异步作业、后台视频能力验证/发布/回滚均已有局部实现 | 全视频规格、专业角色委派、字幕/音轨/参考素材组合和真实供应商质量未齐；当前工程依赖同项目固定来源及渲染环境，不能当作离线自包含工程 | 按约定视频类型完成生产、局部修改、真实播放、导出和恢复；明确工程依赖，补足专业质量及失败费用验收 | P1 |
| GAP-09 | 独立特效目录；功能缺口 | 渲染已有 fade、zoom、still 等有限效果 | 尚无独立版本化、注明输入规格、可分别调用和比较示例的转场、文字动效、抠像、修复目录 | 每项承诺的效果有版本、依赖、输入输出、实际示例、费用/失败规则及可重复验证任务；不能用一个特效开关代表全部支持 | P1 |
| GAP-10 | 配音、转写和声音授权；功能、流程、验收待补 | 内部音频/转写、真实时间字幕、版本修订、客户独立确认精确提案、撤回及未知费用保留 | 后台音频能力验证/独立发布/回滚未齐；未知音频 POST 的外部证据、独立审核、原任务结算与恢复交付闭环缺失；真实语音/香港粤语专业质量及权属审核未验收 | 补齐音频后台发行与未知费用恢复；验证语言/音质/字幕和授权引用。当前登录确认只记录客户声明，不能当作权属证明 | P1 |
| GAP-11 | Google/Meta/GA4/GSC 与广告分析；流程、验收待补 | 四平台模拟授权、真实 HTTP/PKCE、账户项目绑定、分页/限流恢复、固定快照、CSV/XLSX 导入、确定性指标和引用校验 | 正式账户权限/字段/新鲜度尚未验收；官方导出语言数字矩阵、多维归因与完整专业解读仍不齐；Meta 当前接入范围为广告读取 | 先用假数据完成完整业务与异常矩阵；后续对正式账户逐字段核对，报告每个数字可回溯，不混币种、归因或未知值 | P0 |
| GAP-12 | SEO、GEO 与创意反馈；功能、流程、验收待补 | 受限 SEO 抓取/逐 URL 证据/复查、固定 GEO 问句配置与重复观察、原始回答、显式广告素材映射和反馈 | Desktop GEO 仍通过浏览器入口，本机 GEO 工具协议未齐；正式网站/提供方/消费者产品观察、真实 creative 身份及客户成果未验收；CMS 写回需单独实现授权链 | 诊断和反馈可复核、可重跑；API 与消费者产品样本分列，素材映射经用户确认，不将观察当全网排名或因果保证 | P1 |
| GAP-13 | 项目共享、记忆与云文件；开发中、流程待补 | 已发布持续 Agent、分层记忆和云文件；未发布共享配置已有核心 24/24、实际 Web/Admin/侧栏 12 项通过，包含原先无配置的旧任务续做、固定版本和独立正文治理 | 打包 Desktop 的来源失效提示检查超时，新增本机 v3/v3/v4 版本继承与工具读取尚未进入；完整兼容、全平台回归及组件发布未完成；长会话、Office/PDF 和大目录边界仍不齐 | 当前源码实际跨端与回归通过后交付；新工作固定明确配置版本，旧工作保留原版或原先无配置状态；仅共享明确获准资料，不泄露私有内容或凭据 | P1 |
| GAP-14 | 持久专业团队 Agent Group；功能缺口 | 已有临时子任务和本机父子 SOP，每步可记录角色、费用及结果 | 缺少持久团队实体、协调者、依赖图、受控并行、成员进展和统一总预算/交付；现有独立子预算不等于团队统一预留 | 能保存并复用团队，依赖失败和冲突可定位；总预算、并发和递归派单有界，父任务不把缺项报为全部成功 | P1 |
| GAP-15 | 企业工作流与云端计划；功能、流程待补 | 版本化工作流、每日/每周日历、时区、错过合并和去重基础逻辑、暂停未来触发 | 自然语言/既有成果→计划提案→确认→固定依赖→激活未完整贯通；正式事件触发、运行中恢复及全部失败策略/版本/停用矩阵待补 | 用户从对话保存重复工作，确认后才激活；关掉客户端仍运行，每次独立可追踪，无重复触发或补跑风暴 | P1 |
| GAP-16 | 可复用业务方案包；功能缺口 | 已有角色、Skill 和工作流等组成要素 | 缺少方案的预览、试运行、发布、复制以及目标项目依赖重新绑定 | 能把获验的方法组合为方案包；复制只带方法与依赖声明，不带源客户内容或密钥；缺口可见并重新授权 | P1 |
| GAP-17 | 外部操作授权与幂等；功能、流程待补 | 批准摘要、部分工具调用防重及未知费用不盲目重试 | 外部发布、预算修改、网站写回等操作的统一意图落库、精确参数授权、未知结果查询/人工对账尚未贯通 | 参数变化使原授权失效；操作、费用及审计关联同一意图；供应商已接受但回包丢失时不重复发布或修改预算 | P0 |
| GAP-18 | Admin 完整内容与运营；功能、流程待补 | 独立后台/MFA、用户目录、用户/企业控制、内容目录、隔离删除、受控支持、敏感审计和部分能力发布 | 尚未覆盖团队、方案、自定义 Skill 与全部正文修订；公告/帮助/菜单/灰度配置不完整；异步批量冻结对象/版本、部分成功和安全重试未齐；全部角色/字段/范围/异步矩阵未验收 | Admin 按权限管理所有承诺的用户端内容；列表/下载/worker 权限一致，正文变更形成新版本，批量逐项可追踪、可安全重试 | P0 |
| GAP-19 | 用户消耗、人工费用及 VIP；流程、验收待补 | 人工赠额/扣回/授信/收款登记、补偿账本、退款、个人/企业 VIP、席位/存储准入和通知；最新实际 Admin 赠额、预览不改余额及重放不重复赠额已有局部观察 | 完整多维消耗钻取、历史来源对账、全部退款/到期/并发矩阵及媒体/团队/调度权益交集尚未齐，跨端全状态仍待验收 | 从管理员开通到用户实际使用/扣费/到期/退款全程一致；未知不算零，余额、VIP、预算及实收分别记录。自动支付扩展不作为当前人工开通版本的前置条件 | P0 |
| GAP-20 | 全域权限与数据生命周期；流程待补 | 租户/项目/字段鉴权、来源门控、凭据边界、在线隔离/物理删除及撤权负向证据；侧栏私有附件的上传者/同项目编辑者隔离和共享配置独立正文治理已有最新实际通过 | 新增业务、全部异步/下载/导出/不可信内容路径未完成全矩阵；项目/企业整删、索引与备份删除重放未齐。原附件范围故障已有修复证据，不再列为当前复现缺陷 | 私有附件与明确项目共享分别受控；完整角色/数据范围、跨租户负向、撤权后调用/下载、整删和备份重放均有可核对证据 | P0 |
| GAP-21 | CopyPaste 视觉、双语和可访问性；流程、验收待补 | 品牌 token、浅深主题、繁英及局部尺寸验证；Desktop 无边框/菜单、隐藏纵横滚动条且保留真实滚动和进度已有实际证据 | 当前窄侧栏展开配置摘要后输入/发送区未完整入镜；全端组件单源、全部状态和动态文案、时区/指标表达、200% 缩放/键盘/对比/reduced-motion 尚未完整验收 | 全端关键页面、错误及空态贴合品牌；窄屏输入/发送与末项均可触达，隐藏滚动条后全部内容及操作仍可访问 | P0 |
| GAP-22 | 性能、资源和灾备；流程、验收待补 | 企业/用户/能力槽位、租约、部分多 Worker 和本机浏览器资源归属/退出已实现 | 未完成设计负载下压测、媒体队列隔离、真实备份恢复及 RPO/RTO 演练；本机浏览器每驱动 4 页的硬上限与文档每任务默认 3 页未对齐，池内 8 页也不等于上下文配额 | 对齐并验证资源口径；用原生环境验证 P95、错误率、资源回收及用户/后台并发负载；恢复任务、对象、账本并重放删除记录 | P0 |
| GAP-23 | 安装、更新与正式交付；流程、发布验收待补 | 七个独立 Git 仓库、八个远程分支、中英 README、截图/GIF/视频、构建命令及打包预览已有交付 | 签名安装、升级回滚、卸载、旧客户端兼容、目标系统/DPI 和扩展正式发布矩阵未完成；源码同步不等于正式上线 | 在声明的系统进行实际安装→登录→使用→升级/回滚→卸载，并形成可复现发布和兼容证据；扩展按声明渠道验证安装发布 | P0 |
| GAP-24 | 客户业务价值；业务验收待补 | 已有客户接受/修改/弃用、人工时间、成本、真实读取复用及后台质量记录机制 | 尚未执行原计划的三类各 10 个代表任务、人工基线、盲审、真实返工与续用观察 | 现有 marketing 团队对素材、分析、流程三类交付进行实际评价；以可用成果、人工投入、完整成本和复用衡量，不以消息量代替 | P0 |
| GAP-25 | 文档与验收登记；文档待补 | 主文档在 docs，各端独立双语说明与实际媒体，原始需求和历史证据均保留；已新增当前差异入口 | SRS/测试计划历史总述与后续实现状态易混读，完整逐项验收仍未关闭；通用链接检查对历史归档相对路径报错，需明确来源位置和校验范围 | 形成唯一当前状态入口，区分原测试设计、最新实现、复用证据和正式完整验收；补齐归档校验口径，保持原条件及历史事实 | P1 |
| GAP-26 | 可选专属云电脑；功能缺口 | 基础云文件、云任务和后台计划已有独立实现 | 独占电脑、长期进程、实时可视操作的资源/会话/费用生命周期未实现 | 原 REQ-059 的 P2 扩展；仅在决定启用时建设并验证，不作为基础 Web 云 Agent 或云文件的前置条件，也不在本地使用 Docker/WSL | P2 |

## 已有实现的边界与直接源码证据

以下核对用于纠正旧 finding，避免把已实现的能力重复列为缺失，也避免仅凭角色名称判断业务完成。

| 核对点 | 当前证据 | 本次判断 |
| --- | --- | --- |
| Desktop 已经本机执行 | [CLIENT01](../requirements/03-client-execution-amendment.md)、[本机执行与控制面](../technical/72-desktop-local-execution-and-control-plane.md)、[本机浏览器](../technical/77-desktop-native-browser.md)、阶段 85 检查点 | 旧的「仅云端 Agent 加文件桥」已经修正；剩余是完整本机能力及恢复等验收 |
| 无边框、菜单及滚动条 | [当前布局约束](../requirements/04-desktop-layout-and-scroll.md)、[实际画面复核](audio-authorizations-visual-review-02.md)、打包 Desktop 41 项检查 | 这些要求已有范围明确的实际证据；保留真实进度、滚轮、键盘及末项访问，不列为全然缺失 |
| Extension 的执行位置 | [原生对话附件实现](../technical/71-extension-cloud-conversations.md)、CLIENT01 EXT-C01–C06 | 主体为原生侧栏内的云端聊天/附件；基础流程不依赖 Desktop，Native Host 仅是可选增强 |
| 角色与 Skill 数量 | [当前角色目录](../contracts/role-preset-catalog-current.json)、[当前需求追踪](requirements-alignment-progress.json) | 18 个候选不等于至少 12 个正式合格角色；已绑定 Skill 不等于完成全部专业任务 |
| 视频与音频后台 | [已实现的视频能力发行](../technical/81-managed-video-capability-releases.md)、[音频当前边界](../technical/85-audio-rights-and-administration.md) | 视频后台验证/发布/回滚已有局部实现；音频对应流程仍需补齐，不能统称全部媒体后台缺失 |
| 有限特效 | [render.ts](https://github.com/copypasteltd/workmate/blob/67649555272c24ae2c96edccf43229e4e3d29ce4/src/render.ts) 中的 fade/zoom/still | 已有有限渲染效果；尚不构成 REQ-020 的完整独立特效目录 |
| 项目与团队 | [persistent-work.ts](https://github.com/copypasteltd/workmate/blob/67649555272c24ae2c96edccf43229e4e3d29ce4/src/persistent-work.ts) 的固定 Agent/记忆/历史上下文；[本机父子 SOP](../technical/76-desktop-native-workflows.md) | 不等于项目发布共享配置，也不等于持久专业团队和统一总预算 |
| 自动调度 | [schedules.ts](https://github.com/copypasteltd/workmate/blob/67649555272c24ae2c96edccf43229e4e3d29ce4/src/schedules.ts) 的 advanceSchedules 已有 latestOccurrence、SKIP LOCKED、错过合并及当前权限检查 | 不能笼统说「没有定时任务」；差在自然语言创建、正式事件和完整恢复/失败矩阵 |
| 后台导出 | [admin-jobs.ts](https://github.com/copypasteltd/workmate/blob/67649555272c24ae2c96edccf43229e4e3d29ce4/src/admin-jobs.ts) 创建 ready 记录，下载时查询并校验权限，部分源限制 500 条 | 不等于按对象/版本快照执行的异步批量；部分成功和逐项重试仍需建设 |
| 浏览器资源口径 | [native-browser.ts](https://github.com/copypasteltd/workmate/blob/48954026902277053392d218f5b0e813cdbdcb41/src/native-browser.ts) 中 makePage/弹窗限制每驱动 4 页、全池 8 页，已有 owned session 退出清理；[NFR](../requirements/02-nonfunctional-and-service-levels.md) 默认每任务 3 页/每执行器 2 上下文 | 已有清理，不能沿用旧 finding 称完全没有归属；但数量和计量单位尚未完全对齐，需受控配置及故障矩阵 |

CLIENT01 对 Desktop 完整本机权限的明确要求优先于早期 NFR 中受限执行器的一般默认。不得为对齐旧文档把已授权的 Desktop 降回仅目录桥接；云端执行器仍应遵守自身边界。

## 建议推进顺序

1. 保留 GAP-03/GAP-20 私有附件修复的实际通过证据，继续补齐真实恢复矩阵和侧栏输入/发送可达性；定位并修复当前打包 Desktop 共享配置检查失败，完成新增本机版本固定/续做及完整兼容回归后交付。继续用已授权假数据推进 GAP-01–04、05、07、11、18–20 的核心客户旅程。
2. 补齐明确的代码缺口：GAP-06、09、10、13–17，以及 GAP-02 的本地调度、GAP-18 的全量内容和批量。可按依赖拆分，但不把未实现模块写成已完成。
3. 在核心流程开发中持续覆盖 GAP-21，并为 GAP-22、23 建立实际运行证据。性能与备份演练可使用假业务数据和原生工具，无需等真实模型密钥。
4. 最后在相应服务与客户条件就绪时完成真实能力和 GAP-24 的业务接受，逐项关闭原 TC 和 G01–G10。GAP-26 保持 P2，不阻塞基础版本。

这是一份差异评估与建议顺序，没有执行新的业务修复，也没有将当前版本标为正式完整交付。

## 快照与可复核性

首次评估读取时七仓库均干净，组件与当时发布清单一致。下表保留首次评估输入版本。第二次主文档输入为 fb89a046f29c105dbc35b6e8e27cdb797c4e85cb，第三次为 a1c9ca7e7851320744f97f4b83eb3edf0515f6be，第四次为 3ab1800a4011d4dd18d22a9d05277128e031e82c；当前第五次输入为 738d9f2c67f560823cee2d942668aa3a1ab33c0d。六组件已提交 HEAD 未变并与实际远程匹配，但六组件均有上文列出的未提交增量。docs/main 后续文档提交会变化；不得将已提交组件与未提交工作区混称为同一通过版本。

| 仓库 | 输入分支 | 输入提交 |
| --- | --- | --- |
| 主文档 | codex/docs → docs、main | 64b5e3ed09d867263c2aa15122d181a3fd171aa4 |
| backend | codex/backend → backend | 67649555272c24ae2c96edccf43229e4e3d29ce4 |
| web | codex/web → web | 8980ae87e4ecc90a4f4ce42b7d2f8ecee47c7076 |
| admin | codex/admin → admin | 0f81d230dc0633e155a01035ef0bc04ddb07e8b4 |
| desktop | codex/desktop → desktop | 48954026902277053392d218f5b0e813cdbdcb41 |
| extension | codex/extension → extension | 32638a66e45eeb6411cb07907a5ad2ec0e50e8c4 |
| delivery | codex/delivery → delivery | f3d59fa43a7f5bdbf2062a3e1f1413a0ff8d914a |

阶段 85 上次推送回执位于本地忽略目录 dev/copypaste-delivery/.data/publication/4a2e1fcf-0509-410c-ade6-3ad93d68f22a/receipt.json，状态 pushed_and_verified。主清单的 ready_for_remote_verification 是发布协议输入状态，不能据此误判该次推送尚未完成。源码与证据绑定参见 [publication manifest](workmate-publication.json)。

## English

The fifth review records passing repair evidence for the previously reproduced private-attachment defect. The actual native Side Panel now uploads to the actor's private conversation: exact owner bytes download successfully, while an independently authenticated same-project editor cannot list the asset and receives 404 for its download, versions and conversation. The current core receipt passes 24/24, including no-guidance continuation inheritance and successful actual HTTP request/response checks for eight additive contract operations. The actual Web/Admin/Side Panel receipt passes 12 bounded checks; a separate raw Extension unit log records 47/47. Their qualification scopes remain distinct.

The newest packaged Desktop receipt fails after 38 bounded observations because the expected unavailable-source message does not become visible within 20 seconds of quarantine. The cause remains unresolved; the new native v3/v3/v4 continuation and tool scenarios were not reached and are not qualified. A retained narrow Side Panel screenshot also leaves the full composer/Send action outside the captured viewport, requiring layout and action-reachability work before visual acceptance. All 1493 core, 1460 cross-client UI and 1404 Desktop selected source entries still match their respective receipts. The historical stage 85 baseline now has 1471 exact and 23 changed entries out of 1494, with new files additional. Six component worktrees remain unpublished; their committed heads and the docs/main input match all eight actual remote refs. This assessment changes documentation only, retains every original requirement and gate, reruns no product test and starts no browser/database or virtualization. Earlier review notes below retain their historical scope.

The fourth review records an actual product defect: the native Side Panel uploads a chat attachment to the project asset endpoint without a private-conversation binding, leaving private_owner NULL. This broadens the file to project sharing and must be fixed first under GAP-03/GAP-20; it does not establish cross-tenant exposure. The newest actual UI report fails overall after seven bounded observations: one Admin funding/idempotency check, five Web configuration checks, and native Side Panel opening/login/read-only guidance. Subsequent attachment, recovery and complete Admin governance are not qualified. Its 1457 selected source entries match current bytes. The earlier 22/22 receipt remains historical: 1476 of its 1489 selected entries match now and 13 changed, including a candidate continuation-inheritance fix without a new passing receipt. Native Desktop configuration scenarios have been added but not run. All six component worktrees retain unpublished development; committed component heads match the actual remote branches. This assessment changes documentation only and leaves all original acceptance states open. The third-review paragraphs below describe their historical inputs, not the fourth review's current qualification.

The current product provides a runnable multi-client implementation with bounded verification. Complete product acceptance remains open. The unchanged 102-requirement register records 83 partially verified requirements, 19 whose complete acceptance remains unproven, and zero closed complete acceptance cases. These counts cannot be converted into a completion percentage or a count of remaining coding tasks.

The 26 numbered groups distinguish missing features, incomplete end-to-end flows, business qualification and release qualification. Desktop already runs local Codex with a customer-controlled full OS grant and verified frameless, menu-free, rail-free layouts. The native right Side Panel already provides cloud conversations and explicit uploaded attachments without requiring Desktop. Those implemented directions must not be reported as still absent.

Major remaining work includes local directory scheduling, the independent effects catalog, managed audio publication and unknown-request recovery, completion and qualification of shared project configurations, persistent professional teams, reusable solution packages, conversational schedules, and complete Admin content/batch coverage. The 18-role catalog does not prove the required 12 fully qualified professional roles. Real business deliverables, fault recovery, fee/entitlement consistency, full visual accessibility, performance, disaster recovery and signed release installation remain to be completed and accepted.

Synthetic data remains authorized for current development. Missing live credentials do not block further implementation and are not counted as code defects. This assessment reuses the stated test receipts without rerunning tests, changing product source, relaxing original acceptance conditions or claiming production readiness.

The third same-day review records uncommitted shared-project configuration work across Backend, Web, Desktop, Extension and Admin, plus Delivery checks. Candidate code includes editing, history, inherited summaries, file search/pagination, source fencing and content governance. The latest native PostgreSQL report passes all 22 checks: 19 shared-configuration checks and three migration checks. The prior missing-expected_version failure now has passing rerun evidence, and both failed reports remain intact. All 1489 selected source entries in the third receipt match current bytes, as do its TAP and verifier digests. New UI scripts exist but have no execution receipt; actual client journeys, compatibility and full current regression remain open. Rehashing the 1494 stage 85 entries finds 1473 exact and 21 changed entries, with new files additional. All eight remote refs match committed local input snapshots, while all six component working trees contain unpublished changes. Original acceptance statuses remain unchanged.

The second review passed 223 scoped links and the complete 26-group/102-requirement mapping; an earlier generic whole-directory check reported 6199 archive-relative link errors. Those results retain their original scope and time. This review records scoped validation separately in the linked third review receipt. Archive-aware resolution remains part of GAP-25, and global validation remains open.

## 全部原需求映射

下表由本次读取的 requirements-alignment-progress.json 原编号和状态生成，只用于索引；每条原始验收条件仍以该文件和原测试计划为准。部分验证记为「部分」，completion_not_proven 记为「未证明完整」，两者都不是正式关闭。

| 原需求 | 原优先级 | 当前登记 | 本报告差异组 |
| --- | --- | --- | --- |
| REQ-001 | P0 | 部分 | GAP-20 |
| REQ-002 | P0 | 部分 | GAP-20 |
| REQ-003 | P0 | 部分 | GAP-01 |
| REQ-004 | P0 | 部分 | GAP-11 |
| REQ-005 | P0 | 部分 | GAP-13 |
| REQ-006 | P0 | 部分 | GAP-13、GAP-20 |
| REQ-007 | P0 | 部分 | GAP-01 |
| REQ-008 | P0 | 部分 | GAP-04 |
| REQ-009 | P0 | 部分 | GAP-04 |
| REQ-010 | P0 | 未证明完整 | GAP-17 |
| REQ-011 | P0 | 部分 | GAP-04 |
| REQ-012 | P0 | 部分 | GAP-07 |
| REQ-013 | P0 | 部分 | GAP-07 |
| REQ-014 | P0 | 部分 | GAP-03 |
| REQ-015 | P0 | 部分 | GAP-07 |
| REQ-016 | P0 | 部分 | GAP-07 |
| REQ-017 | P0 | 部分 | GAP-07 |
| REQ-018 | P0 | 部分 | GAP-08 |
| REQ-019 | P1 | 部分 | GAP-08 |
| REQ-020 | P1 | 未证明完整 | GAP-09 |
| REQ-021 | P1 | 未证明完整 | GAP-10 |
| REQ-022 | P0 | 部分 | GAP-07、GAP-08 |
| REQ-023 | P0 | 部分 | GAP-11 |
| REQ-024 | P0 | 部分 | GAP-11 |
| REQ-025 | P0 | 部分 | GAP-11 |
| REQ-026 | P1 | 部分 | GAP-11 |
| REQ-027 | P1 | 部分 | GAP-11 |
| REQ-028 | P1 | 部分 | GAP-11 |
| REQ-029 | P1 | 部分 | GAP-12 |
| REQ-030 | P1 | 未证明完整 | GAP-12 |
| REQ-031 | P1 | 未证明完整 | GAP-12 |
| REQ-032 | P1 | 未证明完整 | GAP-15 |
| REQ-033 | P1 | 未证明完整 | GAP-15 |
| REQ-034 | P0 | 未证明完整 | GAP-17 |
| REQ-035 | P0 | 部分 | GAP-01 |
| REQ-036 | P1 | 部分 | GAP-03 |
| REQ-037 | P0 | 部分 | GAP-03 |
| REQ-038 | P1 | 部分 | GAP-03 |
| REQ-039 | P1 | 部分 | GAP-02、GAP-23 |
| REQ-040 | P1 | 未证明完整 | GAP-02 |
| REQ-041 | P1 | 部分 | GAP-02、GAP-03 |
| REQ-042 | P1 | 未证明完整 | GAP-02、GAP-22 |
| REQ-043 | P0 | 部分 | GAP-04、GAP-20 |
| REQ-044 | P0 | 部分 | GAP-04 |
| REQ-045 | P0 | 部分 | GAP-06 |
| REQ-046 | P0 | 部分 | GAP-19 |
| REQ-047 | P0 | 部分 | GAP-19 |
| REQ-048 | P0 | 未证明完整 | GAP-18 |
| REQ-049 | P0 | 部分 | GAP-20 |
| REQ-050 | P0 | 部分 | GAP-03、GAP-20 |
| REQ-051 | P0 | 部分 | GAP-10、GAP-21 |
| REQ-052 | P0 | 部分 | GAP-22 |
| REQ-053 | P0 | 部分 | GAP-22 |
| REQ-054 | P0 | 部分 | GAP-23 |
| REQ-055 | P0 | 部分 | GAP-21 |
| REQ-056 | P0 | 未证明完整 | GAP-24 |
| REQ-057 | P0 | 部分 | GAP-20 |
| REQ-058 | P0 | 部分 | GAP-03、GAP-20 |
| REQ-059 | P2 | 未证明完整 | GAP-26 |
| REQ-060 | P0 | 部分 | GAP-23、GAP-25 |
| REQ-061 | P0 | 部分 | GAP-13 |
| REQ-062 | P0 | 部分 | GAP-05、GAP-06 |
| REQ-063 | P0 | 部分 | GAP-13 |
| REQ-064 | P0 | 部分 | GAP-06 |
| REQ-065 | P1 | 未证明完整 | GAP-13 |
| REQ-066 | P1 | 未证明完整 | GAP-14 |
| REQ-067 | P0 | 部分 | GAP-04 |
| REQ-068 | P0 | 部分 | GAP-07 |
| REQ-069 | P0 | 部分 | GAP-01、GAP-03、GAP-04 |
| REQ-070 | P1 | 未证明完整 | GAP-16 |
| REQ-071 | P1 | 未证明完整 | GAP-15 |
| REQ-072 | P0 | 部分 | GAP-01 |
| REQ-073 | P0 | 部分 | GAP-05 |
| REQ-074 | P0 | 部分 | GAP-05、GAP-06 |
| REQ-075 | P0 | 部分 | GAP-04、GAP-05、GAP-06 |
| REQ-076 | P0 | 部分 | GAP-05 |
| REQ-077 | P0 | 部分 | GAP-05、GAP-07 |
| REQ-078 | P0 | 部分 | GAP-05、GAP-06 |
| REQ-079 | P0 | 部分 | GAP-06 |
| REQ-080 | P0 | 部分 | GAP-05、GAP-24 |
| REQ-081 | P0 | 部分 | GAP-21 |
| REQ-082 | P0 | 部分 | GAP-21 |
| REQ-083 | P0 | 部分 | GAP-18、GAP-20 |
| REQ-084 | P0 | 部分 | GAP-18 |
| REQ-085 | P0 | 部分 | GAP-18 |
| REQ-086 | P0 | 部分 | GAP-19 |
| REQ-087 | P0 | 部分 | GAP-19 |
| REQ-088 | P0 | 部分 | GAP-19 |
| REQ-089 | P0 | 部分 | GAP-19 |
| REQ-090 | P0 | 部分 | GAP-18 |
| REQ-091 | P0 | 部分 | GAP-18、GAP-20 |
| REQ-092 | P0 | 部分 | GAP-15、GAP-18 |
| REQ-093 | P1 | 未证明完整 | GAP-06、GAP-18 |
| REQ-094 | P0 | 部分 | GAP-18、GAP-20 |
| REQ-095 | P0 | 部分 | GAP-18 |
| REQ-096 | P0 | 部分 | GAP-18、GAP-20 |
| REQ-097 | P1 | 未证明完整 | GAP-18 |
| REQ-098 | P0 | 部分 | GAP-18、GAP-21 |
| REQ-099 | P0 | 部分 | GAP-06、GAP-10 |
| REQ-100 | P0 | 部分 | GAP-19、GAP-20 |
| REQ-101 | P0 | 部分 | GAP-19 |
| REQ-102 | P0 | 部分 | GAP-19 |
