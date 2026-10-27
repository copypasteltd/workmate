# 产品 API、事件与错误契约

**签名事件实现 / Signed events：** 新增的实际接口和运行时 DTO 以 [cloud-events.openapi.json](../contracts/cloud-events.openapi.json) 为准，来源为实际 Zod schema，而非下文早期设计。客户确认、控制和密钥轮换使用当前用户授权、CSRF／产品 bearer 及幂等键；独立 webhook 入口对 32 KiB 原始 JSON 按 Workmate HMAC 协议验签，持久化后返回 202。Admin 仅有受范围与近期 MFA 约束的元数据读取和暂停。详见[当前方案](115-signed-cloud-events.md)。


实施状态：本分册保留长期设计约束；本轮锁定版本、实际 API/工具、各端实现与差异，以 [实际开发清单](12-implementation-and-repositories.md) 和 [运行验收](../quality/04-implementation-acceptance.md) 为准，未实现项没有删除。


版本：1.5 · 2026-10-18。机器契约为 [OpenAPI](../contracts/openapi.json)、[任务事件](../contracts/task-event.schema.json) 和 [设备命令](../contracts/device-command.schema.json)。这是拟实施接口，不是已经运行的服务。

## 1. 公共约定

产品 API 使用 HTTPS JSON，路径前缀 `/v1`。Web 使用安全会话 cookie 和写入 CSRF；原生客户端使用产品 bearer token，标准浏览器 PKCE 流程换取凭证。认证协议、邀请和会话撤销由身份模块实现。

数据接口使用 `X-Tenant-ID` 选择企业，服务端重新校验成员身份并检查资源归属；路径已含企业时仍验证一致性。客户端指定企业不等于获得授权。设备 bearer 与用户 token 用途分开，不能互换。

写入请求使用 Idempotency-Key，建议保留 24 小时；任务和外部操作还用长期业务唯一键。金额是 micros 整数字符串，日期 UTC，列表采用稳定 cursor，不依赖可变 offset。

## 2. 资源与操作

| 资源 | 主要操作及注意事项 |
| --- | --- |
| me / tenants / projects / members | 身份、企业切换、项目和成员管理；移除成员立即影响新请求 |
| agents / agent-templates / agent-groups / memories | 模板实例化、专业实例与团队版本、范围化记忆及删除 |
| conversations / messages | 会话检索、命名/置顶/归档/删除；消息意图区分讨论、委派和补充，明确委派才原子派生计量任务 |
| tasks / inputs / controls / reviews / comments | 委派、补充缺项、控制、审阅和评论，受状态版本约束 |
| uploads / assets / brand-versions | 上传申请、complete、资产元数据/版本、受控下载和品牌版本 |
| media-jobs / reports / geo-experiments / evidence | 媒体生产、快照分析、GEO 配置及 SEO/GEO 证据；实际观测作为任务结果 |
| connections / syncs | 发起正式授权、选择账户、同步及撤销；不返回平台 token |
| workflows / triggers | 模板版本、手动运行、计划及停用 |
| devices / grants / commands | 配对、能力、撤销、设备命令领取和结果提交 |
| usage / billing / effective-entitlements / deletions | 用户可见用量、有效权益/账单与生命周期 |
| admin/* | 独立后台会话下的用户、用量、人工费用/VIP、全量内容、执行、配置、权限、审计及批量作业 |
| skill-versions / skill-installations / effective-capabilities | 技能方法、验证、安装/启停/卸载、Agent 绑定及实际可用依赖 |
| workspaces / workspace-nodes / promotions | 云文件树和不可变文件版本引用、移动/修改、成果存入项目；校验共享范围 |
| configuration-versions / solution-versions | 项目共享配置、业务包、样例验证及目标项目重新绑定 |
| execution-plans / task-dependencies | 方案版本与确认、只读模式边界、就地补齐依赖并恢复原任务 |
| routine-drafts / notifications | 从对话创建并确认云端计划，产品内完成/失败/待处理通知与任务深链接 |

全部 operationId、输入输出、响应码和阶段信息在 OpenAPI 中展开；下游开发应由该文件生成类型，而不是手写另一套枚举。

自然语言先用 type=delegation 持久创建任务，规划、缺项收集和执行都关联同一预算与追踪；具体模板使用严格输入类型。补充输入由 provideTaskInput 检查当前 needs_input 与 expected_version。产物修改生成新任务/版本，不覆盖既有文件；历史下载使用 asset_version_id。

Web 可使用 createMessage 的 intent=delegate 作为单次委派入口，同时保存消息和派生任务，返回 task_id。纯讨论不隐式委派；补充消息需要 task_id/expected_task_version。旧客户端省略 intent 时按只保存讨论处理。createTask 仍可独立调用；同一委派不能由客户端同时走两条路径造成重复计费。

ConversationCreate 与 TaskCreate 允许 agent_id 或 agent_group_id，必须且只能提供一个。团队子任务记录实际成员、parent_task_id 和 group_run_id。模版/包/角色是方法配置，不能据此取得资源权限。共享接口的 x-stage 表示最早阶段，M1 入口存在不等于 M2 群组变体已可用。

技能安装后，通过 AgentUpdate 绑定 installation_id，查询 effective-capabilities 获得可用技能和缺口。安全撤销使用受权的 security_revoke，普通 enabled=false 只作用新任务；执行器每次调用重新检查。方案发布引用已接受的验证任务，并核验其输入/输出与方法版本一致。文件节点写入带 expected_version，存入项目先检查源和目标范围。

先计划的执行批准必须匹配 plan_version、input_hash 与 expected_task_version，且重新确认预算和权限；仅传 confirmed_plan_id 不授权执行。对话计划转为 execute 有审计记录。依赖解除和计划激活使用幂等键，重复回调或重复点击复用原工作。

## 3. 异步创建及控制

POST 创建任务或媒体作业返回 202、稳定 ID 和查询位置；仅表示持久接受。资源完整结果通过 GET 或事件获得。任务控制带 expected_version，竞争更新返回 VERSION_CONFLICT，客户端先刷新再决定动作。

同 Idempotency-Key 与同请求摘要返回原结果，不创建新任务；键相同但参数不同返回 409。上传完成重复请求可以返回同一资产版本，不能重复分配费用。

## 4. 任务事件 SSE

`GET /v1/tasks/{task_id}/events` 返回 `text/event-stream`。每条持久事件有 seq 和 event_id，SSE id 使用 seq；客户端以 Last-Event-ID 重连，按 task_id+seq 去重。瞬时心跳是注释，不占持久序号。

事件类型包括 task.state_changed、task.progress、message.appended、artifact.ready、approval.requested、usage.updated 和 task.warning。payload 按类型 schema 校验。事件只包含受权用户可见信息，不带供应商密钥或隐藏推理。

先订阅与查询的竞争通过持久 seq 解决：客户端取得 task.version/last_seq 后重放更大的序号。游标早于保留期返回 410 EVENT_CURSOR_EXPIRED，重新获取任务快照再从最新 seq 继续。

## 5. 设备控制面

设备主动连接 `/v1/devices/{device_id}/channel` 建立 WebSocket；握手使用设备产品凭证，连接绑定 device_id。控制帧和命令由本地协议定义，HTTP result 提交作为可恢复的兼容通道。

连接断开不意味着命令丢失；重新连接先同步 auth_version 和取消，再领取持久命令。同一 command_id 重发时设备返回账本中的结果，不再执行一次文件写入。

## 6. 错误模型

错误统一含 error.code、message、request_id、retryable 和可选 details。details 仅含用户有权看到的字段。常用 code：VALIDATION_ERROR、UNAUTHENTICATED、FORBIDDEN、NOT_FOUND、VERSION_CONFLICT、IDEMPOTENCY_CONFLICT、CAPABILITY_UNAVAILABLE、BUDGET_EXCEEDED、DEVICE_OFFLINE、GRANT_REVOKED、UPSTREAM_RATE_LIMITED、RESULT_UNKNOWN、EVENT_CURSOR_EXPIRED。Web 补充 ACTIVE_TASKS、PLAN_STALE、MODE_RESTRICTED、SKILL_REVOKED、DEPENDENCY_STALE，按 409/403/422 的状态及权限含义处理。

400 表示格式或规则错误，401 身份失效，403 权限不足，404 不存在或不可见，409 状态/幂等冲突，410 游标过期，413 超限，422 语义输入错误，429 限流，502/503/504 为上游或服务故障。retryable 是建议，不授权自动重放具有副作用的请求。

## 7. 版本兼容与审计

新增可选字段通常向后兼容，删除、改单位、改枚举含义和强制新字段视为破坏性变更。设备协议携带 protocol_version，超出兼容范围拒绝执行并要求升级；不能忽略未知动作。

请求、事件和费用以 task/attempt/operation 对齐，支持定位实际执行。契约样例以虚构数据验证，不能据 schema 验证结果宣称真实内核或平台已接通。

## 8. 角色模板 API 与可用性

listAgentTemplates 增加 category/q/project_id 过滤，getAgentTemplate 返回默认助手或专业预设详情。专业模板包含 RolePresetDefinition：角色 key、Codex 运行配置、固定 Skill 版本/摘要、必需/可选模型配置、工具、输入 schema、步骤、交付和验收。AgentTemplateUse 必须指定 template_version；三端均按同一版本实例化，此字段为 1.2 的必需契约变更，旧调用需显式补齐版本。

preflightRoleTemplate 在目标项目解析包、模型、权益和资源，返回 ready/needs_configuration/unavailable、必需/可选缺口、已解析版本、策略和有效期；状态不得由客户端自行声明。前端可在「使用」动作内自动调用，不增加客户配置步骤。instantiateAgentTemplate 仍需服务端重新检查，幂等创建 Agent 与获准绑定，不以预检查过期快照扩大权限。

createRoleTemplateDraft 和 publishRoleTemplate 用于具有 template.publish 权限的目录维护者，不由普通企业角色自动获得；企业复制实例/定制沿用 agent.manage。发布请求携带 expected_version 和至少三个验证任务，服务端检查正常/修改/依赖异常三类、模板与 Skill/模型版本、实际文件、费用和业务评价，不能用任意三个任务冒充。默认助手与未合格/禁用预设不计入至少十二个专业可用角色。

RolePresetOverrides 仅允许名称/职责、品牌、语言及交付偏好，不接受外部 AI 地址、模型密钥或任意工具提升；需要改变 Skill 组合走受控新版本。定义 hash 与实际加载事件关联历史运行。内部 Image 2、必需包或权限缺失采用现有 CAPABILITY_UNAVAILABLE/SKILL_REVOKED/FORBIDDEN，不伪造成功。

OpenAPI 1.3.0 的 x-runtime-policy 记录 CORE01：kernel=codex、集成为 app-server、默认 stdio、automatic_kernel_fallback=false。这是产品集成约束，不是新增客户端内核选择参数或 Codex 原生协议字段。RolePresetDefinition.runtime_profile_id 必须解析到启用且版本固定的 Codex 配置；仅验证 UUID 格式不足。发布、实例化、启动和恢复均重新核验，客户 overrides 不接受 kernel 或运行程序地址。未通过版本或依赖校验时拒绝启动，故障按检查点恢复或使用已验收的 Codex 版本；详见 [运行配置](02-runtime-and-ai-gateway.md) 与 [数据约束](03-data-model-and-lifecycle.md)。

文档 [目录快照](../contracts/role-preset-catalog.json)与其 schema 是 design_only 设计数据；OpenAPI 中的发布/运行资源管理实际验证状态，不能直接把设计目录加载为已发布生产目录。

## 9. Admin API 与独立认证

OpenAPI 1.4.0 保留 CORE01，增加 ADMIN01 的独立 AdminSession 安全方案和后台资源。`/v1/auth/admin-sessions` 以单次授权码及 PKCE 交换注册平台管理员的会话，服务端验证独立 audience、MFA、nonce/回调来源及管理员状态；只设置 HttpOnly 的 cp_admin_session，不返回原始会话令牌。`GET /v1/admin/me` 返回权限、范围、有效期与 csrf_admin。此流程是待实现协议，身份提供方配置在 AD01 验证。

所有 `/v1/admin/*` 仅接受 AdminSession；不接受普通 UserBearer、WebSession 或 DeviceBearer。写入强制 AdminCsrfHeader 和 Origin，使用 Idempotency-Key；普通用户 X-Tenant-ID 不会赋予平台跨企业权限。后台列表由服务端按有效 global/tenant/project 范围求可见集合；默认拒绝，字段、对象状态和限额独立校验。

每个后台接口有注册的 x-permission 与 x-admin-policy。内容控制、执行控制和批量接口同时通过 x-action-permissions 映射载荷动作的附加权限，不能仅检查基础读权限。导出源数据读取和字段权限同样是附加条件，导出许可不授予联系资料、内部成本、正文或财务读取。完整目录及八类角色见 [权限契约](../contracts/admin-permission-catalog.json)；旧 health 接口的 support.metadata 凭证不再有效，这是明确的后台认证迁移，不能保留隐式兼容入口。

人工费用按 top-up、gift、debit、refund、credit-limit 分接口，正数金额、原账项或确认付款来源分别必需。VIP 授予、延期、撤销与 PlanVersion 发布独立。正文、下载、白名单元数据、新版本与隔离/恢复/删除分开处理；连接只暴露元数据。变更返回 202 和 AdminOperation，后续读取实际结果；202 不等于到账或 VIP 已生效。风险策略在服务端选择直接执行或 pending_approval，客户端不能提交 approved、ledger_entries 或任意 provider 参数。

`GET /v1/effective-entitlements` 默认提供当前企业有效权益摘要；subject_kind=user 时以会话用户为个人主体，不接受他人 user_id。摘要含当前权益、auth_version 和 entitlement_version，保留普通成员鉴权；不是平台权限入口。用户状态、权益、余额、内容控制和公开配置变化通过事务 outbox 派生 entitlement.changed、billing.account_changed、identity.access_revoked、content.control_changed、catalog.published 等事件，含 ID、版本、operation_id 和最小摘要，不含正文/密钥。投递前重验接收者权限，断线后用快照恢复。事务及幂等规则见 [Admin 技术设计](11-admin-control-plane.md)。
