# M02/M03 持续 Agent、任务与记忆


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

关联：REQ-005–012、034、059、061、062、064–067、069、070。Web 形态见 [工作台需求](../product/05-web-agent-workbench.md)。

## 1. 对象与职责

Agent 定义长期职责及配置；AgentVersion 冻结指令、工具目录和品牌范围。Conversation 记录用户沟通；Task 是具体业务委派；TaskAttempt 是一次执行尝试；Step 是可恢复单元。所有运行引用固定 AgentVersion、输入快照与能力版本。

Codex 为所有默认/定制 Agent、专业角色、团队成员和 Routine 的唯一内核。本产品 task/attempt ID 与 Codex 原生 thread/turn ID 分别保存并持久映射；重连、恢复及 Codex 版本升级不能丢失业务历史，不提供跨内核会话迁移。

## 2. 权威任务状态

| 状态 | 含义 | 正常下一状态 |
| --- | --- | --- |
| draft | 尚未提交执行 | needs_input、queued、cancelled |
| needs_input | 缺必要输入或等待用户调整范围/预算 | queued、cancelled |
| queued | 已持久接受，等待运行资源 | running、paused、cancelled |
| running | 至少一个步骤可执行或正在执行 | needs_input、waiting_approval、waiting_device、paused、cancelling、succeeded、partially_succeeded、failed |
| waiting_approval | 无其他可运行步骤，等待具体授权 | queued、cancelled |
| waiting_device | 无其他可运行步骤，等待获准设备 | queued、cancelled |
| paused | 在检查点确认暂停 | queued、cancelled |
| cancelling | 已发停止请求，仍需回收执行/核对上游 | cancelled、partially_succeeded、failed |
| succeeded | 全部约定交付完成 | 无；修改另建任务 |
| partially_succeeded | 有可用结果，同时有失败或取消步骤 | 可按策略 queued，创建新 attempt |
| failed | 当前执行不能继续 | 可按策略 queued，创建新 attempt |
| cancelled | 已确认停止且无须继续的交付 | 无；重新执行另建任务 |

取消与完成并发由数据库版本条件更新决定先后：已经成功提交终态则返回该终态；停止请求先提交时进入 cancelling，不再把随后完成当作新的整项成功。已完成结果可以保留为部分成功。

并行步骤中的某一项被阻塞时，其余步骤可继续；只有全部可执行工作阻塞时才进入 waiting 状态。Step 状态为 pending、running、waiting、completed、failed、skipped、cancelled、unknown。unknown 用于外部结果待核对，不允许直接重放。

## 3. 接受、执行与恢复

提交请求携带 Idempotency-Key；服务在同一事务内创建任务、首个 attempt、输入引用、预算预留和 outbox。事务成功后返回 202。调度器向队列投递稳定作业标识，worker 领取时检查状态版本、权限和租约。

每完成一个步骤，先保存输出及事件再推进后续依赖。执行租约超时后，新 worker 使用新的 fencing token；旧 worker 无权提交结果。文件最终化和费用账本同样使用稳定键，避免崩溃后重复提交。

失败重试只重做未完成或明确失效步骤；变更输入、品牌或规格导致依赖变更时创建新输入版本及新任务，不能混用旧检查点。队列可能重复投递，不对跨外部系统动作宣称 exactly-once。

## 4. 授权与外部动作

Approval 固定 action_type、对象、参数摘要、input_hash、授权范围、有效期和审批人。提交前在服务端重算摘要并检查当前权限。默认成员不能批准自己的高影响外部操作，Owner/Admin 可按企业策略执行。

ExternalAction 记录 planned、submitting、confirmed、rejected、unknown。上游支持幂等键时传递相同键；超时后查询原操作。上游既无幂等也无查询能力时交人工处理，不自动重复写入。

## 5. 记忆与长期配置

记忆按企业/品牌/项目/个人/会话分域，保存来源、版本、有效期和可见范围。用户反馈先形成候选记忆，影响后续任务的持久规则需明确可见并可撤销；网页和附件不能直接改写系统策略。

检索前按权限过滤，向量服务同样走内部 AI 网关。首期可用结构化品牌资料及文本检索，不以必须部署向量系统阻塞主要流程。删除记忆后清理提取内容和索引，历史快照可保留脱敏标识及校验记录，不强制永久保留被删除正文。

## 6. 持续云端工作环境

区分逻辑云文件工作区与计算 Runtime：基础文件/目录元数据和内容版本持续保存，按任务启动计算，闲置进程可回收。Workspace 绑定企业、项目和会话隔离区，任务历史及文件不依赖长期存活进程。专属电脑与实时画面属于 REQ-059 的独立启用条件；专业团队使用现有任务调度，不以购买专属机器为前提。

## 7. 事件、审阅与完成

所有事件包含 tenant_id、task_id、attempt_id、seq、type、occurred_at 和限定 payload。持久事件先落库再广播，客户端按序去重并支持重放。

业务审阅状态为 pending_review、accepted、changes_requested、discarded；与任务状态正交。技术成功不自动代表用户接受。任务、事件和审阅接口见 [API 说明](../technical/04-api-and-event-contracts.md)，测试覆盖取消竞争、重复投递和未知结果恢复。

## 8. 会话与工作模式

Conversation 的参与目标是一个 Agent 或 Agent Group，二者互斥；同一目标允许多个会话。一会话包含多任务，消息意图明确为讨论、委派或补充，补充必须指定 task_id 和 expected_task_version。消息落库不等于工具已运行；派生任务的稳定键包含 conversation_id 和 client_message_id，重复投递复用原任务。

会话支持标题、搜索、置顶、归档及删除。归档只影响列表；有未结束任务时删除返回 ACTIVE_TASKS，用户先明确取消或等任务结束。删除按 REQ-049 清理会话内容及私有派生物，不默认删除共享项目成果或长期记忆；界面提供单独清理入口。

mode 为 execute、plan 或 ask；任务保存初始模式和当前有效模式。plan 只进行获准只读调查和方案生成，产出 PlanVersion，用户批准当前 plan_version/input_hash 后，以版本校验及审计将有效模式转为 execute。ask 禁止业务写入、媒体生成和触发器创建；切换模式必须来自用户。配置改变或输入摘要不匹配时计划批准失效，返回 PLAN_STALE。

## 9. 专业模板与技能

AgentTemplate 是可发布的初始化配置，含职责、工作示例、推荐 SkillVersion 和资源要求；Agent 是有归属项目的实例。复制仅带允许复用的方法与依赖声明，不复制私有对话、记忆或凭证。AgentVersion 同时冻结模板、技能、项目规则和模型能力版本。

SkillVersion 保存来源、内容摘要、输入输出、工具声明、运行条件和审核状态。Installation 表示已安装版本，Binding 表示在项目/Agent 可用，enabled 表示参与新任务。实际调用还要与当前权限和能力状态取交集。版本冲突显式解决，不按同名包任意替换。

普通停用只影响新任务；安全禁用或权限撤销在每次调用前检查，旧任务也不能继续调用。自学习只生成候选记忆或技能版本，发布需要相应权限及样例验证，不能修改强制策略。第三方 Skill 内嵌的 AI 调用统一受内部网关和出站控制约束。

## 10. 项目继承与能力方案

ProjectConfigVersion 组织共享说明、参考资料版本、可用 Agent/技能、连接资源与交付规则。新任务解析出 EffectiveConfig 快照，UI 展示继承来源。内容优先级在允许范围内为本次明确要求、项目方法、Agent 模板；企业强制策略和资源权限始终取交集，个人偏好不能覆盖禁止项。

SolutionVersion 是可发布的方法组合，引用 Agent 模板、技能版本、资料要求和连接器定义。安装到目标项目时生成缺口清单，重新绑定资源并试运行。方案配置与凭证分开保存，发布范围不自动包含源任务内容。

## 11. 持久团队与后台子任务

AgentGroupVersion 固定一个协调者及成员职责、AgentVersion 引用、共享 Workspace 和预算/并发策略。用户输入默认交协调者，也可显式指定成员。协调者创建父任务及可追踪子任务，依赖完成后再调度；成员结果以引用回传，最终按父任务交付清单判断完成。

每个子任务记录 parent_task_id、group_run_id、assigned_agent_id 和输入快照，费用向总运行汇总但不重复记账。父任务只有一个总预算预留，子调用原子占用该预留，不能各自按总额再次预留。成员失败、权限变化或文件冲突只影响相应依赖；父任务显示局部失败或等待，不伪造完整成功。

增组、增成员与递归深度受服务端上限及项目策略限制，成员不能扩大总工具范围。后台 SubAgent 是任务内的临时执行策略，不自动成为持久 Agent 实例或人类项目成员。本套文档不要求研究/开发过程实际调度任何子 Agent。

## 12. 依赖补齐与恢复

DependencyRequest 关联 task_id、step_key、需求类型、资源范围、状态及版本。需要连接时仅在此处引导；回调完成资源绑定后，按任务当前版本解除阻塞。重复回调采用稳定 dependency_id 幂等处理，已取消任务不会被重新唤醒。

连接成功不默认获得用户未选账户；无依赖步骤可以继续，全部可执行步骤阻塞时才提升为任务等待。授权、文件或能力恢复仍经过原任务预算和策略，不能以重新连接为理由重新创建完整付费任务。

## 13. 完整角色预设与发布资格

REQ-073–080 将模板落实为可执行专业配置。18 个定义见 [角色分册](../product/06-role-templates-and-skill-presets.md)，每个固定 role_key、模板版本、Skill 精确版本与内容摘要、必需/可选标记、Codex 配置、模型能力、工具范围、输入输出、步骤、交付和验收样例。

TemplateUse 事务检查模板发布及资格、企业权益、包/能力/资源，绑定预先批准的安装与模型版本，创建 AgentVersion 和幂等记录。平台预置的已审核包由服务端在授权内准备，不要求客户逐个安装；非预先批准的包仍需项目管理规则。缺资料可先创建实例并在任务中补齐，缺必需执行能力不能进入该步骤。预检查结果仅供提示，执行前须重新校验。

必需 Skill 的适用步骤显式加载，包缺失或摘要变化阻塞执行；实际加载、工具调用和产物均留可审计记录。仅换角色提示词不满足专业预设。企业通过复制/覆盖构建自己的角色，更新生成新版本；旧运行固定方法，安全禁用即时生效。

官方目录发布由具有 template.publish 权限的维护者执行，不自动授予普通企业成员；企业私有 Agent 定制沿用 agent.manage。资格需要相同配置的正常、修改、依赖/权限异常证据；发布前检查真实文件、成本和业务接受。至少十二个合格角色且含开发、设计及指定设计师，才能满足首发数量。

## 14. Admin 执行与记忆治理

REQ-090–092/100/102 的后台入口经同一 Agent/任务/记忆领域服务操作。管理员可在权限范围读取正文、归档会话、修订记忆、创建新 Agent/流程版本、控制任务和未来触发，真实身份及受益用户分别记录。安全隔离或授权撤销立即阻止后续读取/工具调用，运行快照不保留永久权限。禁止直接改终态、伪造用户消息或无条件重放未知外部动作；费用与预留按原 operation 对账。具体注册动作、版本及权限见 [Admin 技术分册](../technical/11-admin-control-plane.md)。


## 0.2.0 实施定位

持续专家、私密会话、范围记忆、计划批准及跨端实现的实际边界见 [持续工作约束](../technical/13-persistent-agents-conversations-memory.md) 和 [本轮验收](../quality/05-persistent-work-acceptance.md)。本分册的完整长期要求继续保留，不能由页面存在或局部测试推定全部完成。
