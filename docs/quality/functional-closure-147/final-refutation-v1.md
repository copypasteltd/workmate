# Stage 147 最终独立反证 v1

检查日期：2026-10-31。检查对象为正在集成的工作区源码，不是已发布提交。仅阅读运行代码、迁移、既有测试及文档；未启动服务、模型或浏览器，未修改产品、测试、数据库及 Git。

只记录两个会阻断实际客户流程的新反例。已在修复的无会话上传 scope、收件箱坏条目隔离、专业读取工具私有范围及 Image2 旧版读取、首步 workflow_inputs、Desktop GET 撤回 guard、Extension 定时/事件输入审阅不重复列入。

## F147-R1：等待中的原任务占满 Starter 配额，本机准备无法创建

**优先级 P1；确定的调用链阻断。** Starter 客户仅有一个云任务，真实 paid Codex 调用 request_input 后进入 needs_input，再创建并在 Desktop 启动本机准备请求，无法创建本机任务，返回 `PLAN_TASK_LIMIT`。因此最基本套餐无法完成 Web → 本机准备 → 原线程继续。

证据：

- `dev/copypaste-platform/src/plans.ts:17`–21：Starter 的 max_active_tasks 为 1。
- 同文件 `:90`–100：活动计数包含 needs_input；达到套餐上限即拒绝创建新任务。
- `dev/copypaste-platform/src/desktop-executions.ts:761`–779：已经验证的 handoff 最终仍调用 enqueueTask，仅传入 task_id/local_handoff_id/role_hash 等身份，没有配额关联处理。
- `dev/copypaste-platform/src/task-service.ts:242`–249：enqueueTask 无条件调用 authorizeTaskPlan。
- `dev/copypaste-platform/src/paid-task-inputs.ts:295`–302：完成付费输入检查点时保留原任务并设置 needs_input，正好满足被计数条件。

最小场景：默认 Starter → 一个云端执行任务 → 原生模型回合完成并要求文件 → 创建本机准备 → 同账户 Desktop 授权并确认费用 → 本机 create 被配额拒绝。无需多任务竞争即可发生；更高套餐达到等待任务上限时同样发生。

修复边界：仅对经过验证的、直接关联当前 waiting parent 的唯一 handoff 处理容量关系；保留原云任务与本机任务各自预算、余额预留和真实用量。全局增加套餐上限或全局忽略 needs_input 不能证明该关系正确。

状态：已将证据交给主代理；主代理已交由 REQ-041 审查代理修复。本报告记录发现时的源码事实，尚不宣称修复或回归通过。

## F147-R2：原云任务授权已永久失效，重新登录仍可为它支付本机费用

**优先级 P1；确定的权限版本不一致。** 管理员撤销客户会话后，旧 needs_input 任务保留旧 actor_auth_version。客户重新登录后仍可创建、认领并执行该任务的本机准备；然而交回文件后，原云线程继续必然因旧授权版本失败，客户已经发生的本机费用无法完成其原目标。

证据：

- `dev/copypaste-platform/src/admin-accounts.ts:350`–354：users.sessions.revoke 将 users.auth_version 加 1；`:276`–289 只撤销 sessions、refresh_tokens、native_auth_codes，没有将旧 needs_input 任务取消或重授权。
- `dev/copypaste-platform/src/task-local-handoffs.ts:29`–35：parentAccess 以本次重新登录的 actor 检查项目权限，核对原任务所有者、执行位置、mode、内容和保留时间，但没有比较原任务 actor_auth_version 与当前授权版本。
- 同文件 `:50`–52：waiting 检查 pending 文件依赖及付费检查点，同样没有核对原任务冻结授权版本。admitLocalHandoff 经 load/parentAccess/waiting 进入，不能补上此判断。
- `dev/copypaste-platform/src/desktop-executions.ts:761`–779 与 `src/task-service.ts:265`：新本机任务以当前 native principal 创建，具有新的 actor_auth_version；`:302`–337 对本机执行检查的是新任务授权，无法阻止此费用。
- `dev/copypaste-platform/src/worker.ts:433`–448：原任务恢复时使用 t.actor_auth_version 构造 actor，再调用 projectAccess。
- `dev/copypaste-platform/src/access.ts:17`–27：tenantAccess 要求 users.auth_version 与 actor.authVersion 相等，旧任务必然不满足。Worker `:477`–493 随即取消或转入对账，不能开始原线程的新回合。
- `dev/copypaste-platform/migrations/084-content-source-row-identifiers.sql:13`–18 的来源检查验证内容、成员、用户及项目状态，没有比较任务冻结的授权版本，因此 parentAccess 的 assertTaskContentSources 不能反驳这一反例。

最小场景：原付费云任务等待文件 → 管理员撤销该用户全部会话 → 用户用同一账号重新登录 Web 与 Desktop → 本机准备通过新会话授权并产生用量 → 用户交回文件 → 原任务按旧 auth_version 续跑被拒绝。它不是关闭普通标签页或正常令牌刷新；只有明确改变用户授权版本时触发。

修复边界：在接受、认领和回传相关步骤前，确认原等待任务的冻结权限仍可续跑；权限变化后应拒绝追加本机工作并提供真实状态。不要把旧任务 actor_auth_version 更新为新值以隐式恢复已撤销的执行授权。

状态：已交给主代理；本报告未改动任何产品或测试。

## 本次反证的限度

已逐链检查真实 paid request_input 的检查点、同 task_id/runtime_thread 继续、本机独立预算和原生授权、输入绑定的版本/hash、命名输出提取，以及 schedule/event 冻结输入传入 workflow_runs。除上述两个新反例与已交由其他代理修复的问题外，本次源码阅读未确认第三个新增阻断；这不是运行验收或发布资格声明。

引用行号为本次阅读时的工作区位置；并行修复会移动行号。当前源代码中保留的函数名、路由和错误码可用于定位。
