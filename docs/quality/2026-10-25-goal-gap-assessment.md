# 当前产品与完整目标的差异评估 / Goal gap assessment

评估日期：2026-10-25，Asia/Taipei。评估基线为阶段 85 已提交并推送的产品；本次重新读取需求、当前代码、检查点和仓库状态，没有重新运行产品测试，也没有修改产品代码。

当前产品已有可运行的多端实现和大量局部验证，但尚未达到「全部业务模块完整可用、至少十二个专业角色合格、三端完整交付并通过业务验收」的目标。主要差距包括功能缺口、已有功能未贯通的完整流程，以及业务与正式发布验收。

本评估继续遵守「暂时先用假数据」的用户指令。内部 API 密钥和真实客户账号未提供，不作为当前代码开发的阻塞条件；真实服务质量、正式平台授权和客户接受另列为后续验收，不把模拟接口通过写成已经正式接通。

## 评估口径

| 项目 | 当前记录 | 应如何理解 |
| --- | --- | --- |
| 原需求 / 原产品验收用例 | 102 / 102 | 保留原编号和完整通过条件 |
| 部分验证 | 83 项 | 有局部实现及验证证据，尚未关闭同号完整验收 |
| 尚未证明完整达标 | 19 项 | 同时包含实际缺少功能和已有增量但完整条件未满足的需求 |
| 完整验收关闭 | 0 项 | 不能解释为产品没有功能，也不能据此声称只剩 19 项开发工作 |
| 角色目录 | 18 个候选 | 已有目录、精确 Skill 绑定及部分实际运行；正式合格角色记录仍为 0，至少 12 个的交付目标尚未验收 |
| 最新平台检查 | 1001 / 1001 通过 | 来自已有检查点，覆盖 78 个测试文件、20 个批次；本次没有重跑 |
| 客户端 / Web、Admin、原生侧栏 / 打包 Desktop | 分别 124 / 13 / 41 项 | 范围不同且可能重叠，不能相加当成独立产品验收数量 |
| 发布门槛 | G01–G10 均未完整证明 | 源码推送、局部 UI 检查与正式发布验收是不同事项 |

来源：[当前需求追踪](requirements-alignment-progress.json)、[阶段 85 精确检查点](audio-authorizations-checkpoint.json)、[原测试计划](01-test-and-acceptance-plan.md)。本报告不更改上述状态，也不给出无法据此推导的完成百分比。

下表采用本次评估编号 GAP-01–GAP-26，并在附录映射全部原需求。一个需求可以关联多个差异项，26 个差异组不是剩余任务数量。类型含义：**功能缺口**指仍需开发；**流程待补**指已有实现但尚未贯通完整边界；**验收待补**指需要相应运行或业务证据。建议优先级 P0 为核心交付前优先处理，P1 为完整业务范围继续补齐，P2 为原文档的可选后续能力；不覆盖原需求自己的优先级。

## 编号差异表

| 编号 | 模块 / 类型 | 当前已具备 | 距离目标的具体差异 | 完成标准 | 建议优先级 |
| --- | --- | --- | --- | --- | --- |
| GAP-01 | 访问、登录与首项工作；流程、验收待补 | 邀请、用户登录、设备 PKCE、刷新撤销、默认助手、站内通知及部分真实页面流程 | 从首次访问到首任务的完整入口矩阵尚未验收；自动发现必要资料、补齐后续做、退出/过期/换企业/断网及安装包身份流程仍不齐 | 用户从邀请或访问进入，完成登录、选择可用角色、补齐必要输入、提交和领取成果；异常后状态、身份和费用均正确 | P0 |
| GAP-02 | Desktop 本机能力；功能、流程待补 | 本机锁定 Codex、文件与终端、客户主动且可撤销的完整权限、Skills、浏览器工具、父子 SOP、停止及同线程继续 | 目录监听、防抖去重、批量本地调度仍缺；检查点和离线续做、全角色本机工具与应用操作尚未完整证明，不能宣称已全面对标 Codex Desktop | 按 DESK-L01–L08 逐项验证本机文件/终端/工具、持续会话、停止恢复、切换身份和撤权；补齐本地调度及逐项承诺的应用操作 | P0 |
| GAP-03 | Extension 对话和文件；流程、验收待补 | 原生右侧 Side Panel、ChatGPT 式消息与底部输入、历史、明确版本附件、云端 Codex；基础流程独立于 Desktop | 大文件及上传中断、站点授权/网页选区、worker 长时间休眠恢复、换项目与撤权的全部组合尚未完整验收；可选 Native Host 的大文件矩阵也未齐 | 无需安装 Desktop 即完成选文件、读取、上传、绑定本次消息和连续对话；失败不假报送达，恢复不串项目、不丢任务 | P0 |
| GAP-04 | Codex 持续执行与恢复；流程待补 | 唯一 Codex 内核、公司网关、持久任务、事件、租约、排队暂停、原线程继续和停止均有局部证据 | 已付费步骤检查点、运行中安全暂停、多节点/崩溃恢复、全工具追踪和全部工作模式边界尚未贯通 | 中断后续做原任务并正确累计费用；不重复付费步骤、不丢已确认结果、不回退到其他内核 | P0 |
| GAP-05 | 至少十二个专业角色；流程、业务验收待补 | 18 个候选角色，覆盖开发、设计和指定设计师；已有精确 Skill 包和部分真实 Codex 加载 | 目录数量已超过 12，但尚未取得至少 12 个角色各自完整任务、成果修改及依赖/权限异常的正式资格证据 | 至少 12 个不同角色可直接选用，逐个交付真实文件、继续修改、正确处理异常，并记录模板/Skill/内核/模型和费用；设计师包含 Image 2 | P0 |
| GAP-06 | Skill、企业模板与能力采用；功能、流程待补 | 随附 Skill 安装、绑定、版本固定和撤销；部分文字/图片及视频能力已支持受控验证发布 | 自定义 Skill 包试运行/组织发布、企业模板覆盖、安全复制、版本比较与用户显式采用尚未齐；全部动态依赖交集和音频发行仍需接入 | 从草稿、试运行、审核、发布到比较/显式升级和回滚完整可用；历史运行固定旧版本，安全撤销约束后续调用 | P0 |
| GAP-07 | 设计、生图、排版与可编辑交付；流程、验收待补 | 品牌固定版本、图片/限定编辑链路、真实字体与分层图文、批量矩阵、局部修改、PDF/源码交付已有局部证据 | 真实 Image 2 的业务质量未验收；字体/混排/换行/溢出、品牌事实遵循、图片选区修改、全类型审阅和可恢复工程未覆盖完整专业业务 | 完成 brief→固定品牌→出图→准确排版→选区/单格修改→客户审阅→交付与恢复编辑，文件、版本和费用一致 | P0 |
| GAP-08 | 视频完整生产；流程、验收待补 | 脚本/分镜/模板工程、真实可播放成片、生成式视频异步作业、后台视频能力验证/发布/回滚均已有局部实现 | 全视频规格、专业角色委派、字幕/音轨/参考素材组合和真实供应商质量未齐；当前工程依赖同项目固定来源及渲染环境，不能当作离线自包含工程 | 按约定视频类型完成生产、局部修改、真实播放、导出和恢复；明确工程依赖，补足专业质量及失败费用验收 | P1 |
| GAP-09 | 独立特效目录；功能缺口 | 渲染已有 fade、zoom、still 等有限效果 | 尚无独立版本化、注明输入规格、可分别调用和比较示例的转场、文字动效、抠像、修复目录 | 每项承诺的效果有版本、依赖、输入输出、实际示例、费用/失败规则及可重复验证任务；不能用一个特效开关代表全部支持 | P1 |
| GAP-10 | 配音、转写和声音授权；功能、流程、验收待补 | 内部音频/转写、真实时间字幕、版本修订、客户独立确认精确提案、撤回及未知费用保留 | 后台音频能力验证/独立发布/回滚未齐；未知音频 POST 的外部证据、独立审核、原任务结算与恢复交付闭环缺失；真实语音/香港粤语专业质量及权属审核未验收 | 补齐音频后台发行与未知费用恢复；验证语言/音质/字幕和授权引用。当前登录确认只记录客户声明，不能当作权属证明 | P1 |
| GAP-11 | Google/Meta/GA4/GSC 与广告分析；流程、验收待补 | 四平台模拟授权、真实 HTTP/PKCE、账户项目绑定、分页/限流恢复、固定快照、CSV/XLSX 导入、确定性指标和引用校验 | 正式账户权限/字段/新鲜度尚未验收；官方导出语言数字矩阵、多维归因与完整专业解读仍不齐；Meta 当前接入范围为广告读取 | 先用假数据完成完整业务与异常矩阵；后续对正式账户逐字段核对，报告每个数字可回溯，不混币种、归因或未知值 | P0 |
| GAP-12 | SEO、GEO 与创意反馈；功能、流程、验收待补 | 受限 SEO 抓取/逐 URL 证据/复查、固定 GEO 问句配置与重复观察、原始回答、显式广告素材映射和反馈 | Desktop GEO 仍通过浏览器入口，本机 GEO 工具协议未齐；正式网站/提供方/消费者产品观察、真实 creative 身份及客户成果未验收；CMS 写回需单独实现授权链 | 诊断和反馈可复核、可重跑；API 与消费者产品样本分列，素材映射经用户确认，不将观察当全网排名或因果保证 | P1 |
| GAP-13 | 项目共享、记忆与云文件；功能、流程待补 | 持续 Agent、分层记忆、会话生命周期、云文件树/搜索/版本/移动及源码引用 | 项目共享配置版本、继承摘要和固定资料/方法快照仍缺；长会话与多任务消息、Office/PDF 分页和大目录选择、历史/备份删除重放未齐 | 项目发布可追溯共享配置，新工作显示继承摘要并固定版本；仅共享获准资料，私有内容和凭据不外泄 | P1 |
| GAP-14 | 持久专业团队 Agent Group；功能缺口 | 已有临时子任务和本机父子 SOP，每步可记录角色、费用及结果 | 缺少持久团队实体、协调者、依赖图、受控并行、成员进展和统一总预算/交付；现有独立子预算不等于团队统一预留 | 能保存并复用团队，依赖失败和冲突可定位；总预算、并发和递归派单有界，父任务不把缺项报为全部成功 | P1 |
| GAP-15 | 企业工作流与云端计划；功能、流程待补 | 版本化工作流、每日/每周日历、时区、错过合并和去重基础逻辑、暂停未来触发 | 自然语言/既有成果→计划提案→确认→固定依赖→激活未完整贯通；正式事件触发、运行中恢复及全部失败策略/版本/停用矩阵待补 | 用户从对话保存重复工作，确认后才激活；关掉客户端仍运行，每次独立可追踪，无重复触发或补跑风暴 | P1 |
| GAP-16 | 可复用业务方案包；功能缺口 | 已有角色、Skill 和工作流等组成要素 | 缺少方案的预览、试运行、发布、复制以及目标项目依赖重新绑定 | 能把获验的方法组合为方案包；复制只带方法与依赖声明，不带源客户内容或密钥；缺口可见并重新授权 | P1 |
| GAP-17 | 外部操作授权与幂等；功能、流程待补 | 批准摘要、部分工具调用防重及未知费用不盲目重试 | 外部发布、预算修改、网站写回等操作的统一意图落库、精确参数授权、未知结果查询/人工对账尚未贯通 | 参数变化使原授权失效；操作、费用及审计关联同一意图；供应商已接受但回包丢失时不重复发布或修改预算 | P0 |
| GAP-18 | Admin 完整内容与运营；功能、流程待补 | 独立后台/MFA、用户目录、用户/企业控制、内容目录、隔离删除、受控支持、敏感审计和部分能力发布 | 尚未覆盖团队、方案、自定义 Skill 与全部正文修订；公告/帮助/菜单/灰度配置不完整；异步批量冻结对象/版本、部分成功和安全重试未齐；全部角色/字段/范围/异步矩阵未验收 | Admin 按权限管理所有承诺的用户端内容；列表/下载/worker 权限一致，正文变更形成新版本，批量逐项可追踪、可安全重试 | P0 |
| GAP-19 | 用户消耗、人工费用及 VIP；流程、验收待补 | 人工赠额/扣回/授信/收款登记、补偿账本、分次退款、个人/企业 VIP、方案版本、席位/存储准入和站内通知 | 完整多维消耗钻取、历史来源对账、全部退款/到期/并发矩阵及媒体/团队/调度权益交集尚未齐，跨端全状态仍待验收 | 从管理员开通到用户实际使用/扣费/到期/退款全程一致；未知不算零，余额、VIP、预算及实收分别记录。自动支付扩展不作为当前人工开通版本的前置条件 | P0 |
| GAP-20 | 全域权限与数据生命周期；流程、验收待补 | 租户/项目/字段鉴权、当前来源门控、凭据边界、在线隔离/物理删除及大量撤权负向证据 | 新增业务、全部异步/下载/导出/不可信内容路径未完成全矩阵；项目/企业整删、索引与备份恢复后的删除重放未齐 | 完整角色与数据范围矩阵、跨租户负向、撤权后新调用/下载、整删和备份重放均有可核对证据 | P0 |
| GAP-21 | CopyPaste 视觉、双语和可访问性；流程、验收待补 | 品牌 token、浅深主题、繁英及局部尺寸验证；Desktop 无边框/菜单、隐藏纵横滚动条且保留真实滚动和进度已有实际证据 | 全端组件单源、全部状态和动态文案、时区/指标表达、200% 缩放/键盘/对比/reduced-motion 尚未完整验收 | Web/Admin/Extension/Desktop 的关键页面、错误及空态均贴合品牌；隐藏滚动条后全部内容及操作仍可访问 | P0 |
| GAP-22 | 性能、资源和灾备；流程、验收待补 | 企业/用户/能力槽位、租约、部分多 Worker 和本机浏览器资源归属/退出已实现 | 未完成设计负载下压测、媒体队列隔离、真实备份恢复及 RPO/RTO 演练；本机浏览器每驱动 4 页的硬上限与文档每任务默认 3 页未对齐，池内 8 页也不等于上下文配额 | 对齐并验证资源口径；用原生环境验证 P95、错误率、资源回收及用户/后台并发负载；恢复任务、对象、账本并重放删除记录 | P0 |
| GAP-23 | 安装、更新与正式交付；流程、发布验收待补 | 七个独立 Git 仓库、八个远程分支、中英 README、截图/GIF/视频、构建命令及打包预览已有交付 | 签名安装、升级回滚、卸载、旧客户端兼容、目标系统/DPI 和扩展正式发布矩阵未完成；源码同步不等于正式上线 | 在声明的系统进行实际安装→登录→使用→升级/回滚→卸载，并形成可复现发布和兼容证据；扩展按声明渠道验证安装发布 | P0 |
| GAP-24 | 客户业务价值；业务验收待补 | 已有客户接受/修改/弃用、人工时间、成本、真实读取复用及后台质量记录机制 | 尚未执行原计划的三类各 10 个代表任务、人工基线、盲审、真实返工与续用观察 | 现有 marketing 团队对素材、分析、流程三类交付进行实际评价；以可用成果、人工投入、完整成本和复用衡量，不以消息量代替 | P0 |
| GAP-25 | 文档与验收登记；文档待补 | 主文档在 docs，各端独立双语说明与实际媒体，原始需求和历史证据均保留 | SRS/测试计划仍有「当前仅文档/全部 not_run」的历史总述，后续实现证据以阶段附录增补；当前状态容易混读，完整逐项验收仍未关闭 | 形成唯一当前状态入口，区分原测试设计、最新实现、复用证据和正式完整验收；保持原条件及历史事实，不靠改状态掩盖缺口 | P1 |
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

1. 先用已授权假数据跑通核心客户旅程：GAP-01–04、05、07、11、18–20。优先解决身份、原任务续做、真实产物、费用/权益及跨端管理的一致性。
2. 补齐明确的代码缺口：GAP-06、09、10、13–17，以及 GAP-02 的本地调度、GAP-18 的全量内容和批量。可按依赖拆分，但不把未实现模块写成已完成。
3. 在核心流程开发中持续覆盖 GAP-21，并为 GAP-22、23 建立实际运行证据。性能与备份演练可使用假业务数据和原生工具，无需等真实模型密钥。
4. 最后在相应服务与客户条件就绪时完成真实能力和 GAP-24 的业务接受，逐项关闭原 TC 和 G01–G10。GAP-26 保持 P2，不阻塞基础版本。

这是一份差异评估与建议顺序，没有执行新的业务修复，也没有将当前版本标为正式完整交付。

## 快照与可复核性

本次读取时七仓库均干净，组件与当前发布清单一致。下表记录评估输入版本；新增本评估文档后，docs/main 的后续文档提交会变化，六个产品组件版本保持不变。

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

The current product is a runnable multi-client implementation with bounded verification, rather than a fully accepted delivery. The unchanged 102-requirement register records 83 partially verified requirements, 19 whose complete acceptance remains unproven, and zero closed complete acceptance cases. These counts are not a completion percentage or a count of remaining coding tasks.

The 26 numbered groups distinguish missing features, incomplete end-to-end flows, business qualification and release qualification. Desktop already runs local Codex with a customer-controlled full OS grant and verified frameless, menu-free, rail-free layouts. The native right Side Panel already provides cloud conversations and explicit uploaded attachments without requiring Desktop. Those implemented directions must not be reported as still absent.

Major remaining features include local directory scheduling, the independent effects catalog, managed audio publication and unknown-request recovery, shared project configurations, persistent professional teams, reusable solution packages, conversational schedules, and complete Admin content/batch coverage. The 18-role catalog does not prove the required 12 fully qualified professional roles. Real business deliverables, fault recovery, fee/entitlement consistency, full visual accessibility, performance, disaster recovery and signed release installation remain to be completed and accepted.

Synthetic data remains authorized for current development. Missing live credentials do not block further implementation and are not counted as code defects. This assessment reuses the stated test receipts without rerunning tests, changing product source, relaxing original acceptance conditions or claiming production readiness.

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
