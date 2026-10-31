# REQ-041 接续修复 / Handoff repair

日期：2026-10-31。工作区：`D:/dev/copypasted/自有agent`。这是阶段147审查后的实现记录，原始审查保留在 `req-041-implementation-review-v1.md`。本记录不替代独立验收。

| 范围 | 实现与约束 |
|---|---|
| 私人任务文件上传 | `platform/src/uploads.ts` 接受独立的 `source_task_id`；`task-local-handoffs.ts::taskLocalUploadScope` 在创建、读取、分片与完成时重新核对原任务、当前用户、原文件输入版本、已结束并结算的本机准备。私人范围从服务器上的原任务派生，没有会话也保持私人。禁止把该范围同时用来覆盖既有资产。 |
| 上传恢复 | Web/Desktop `resumable-upload.tsx` 将原任务加入本机恢复键及上传请求；恢复时核对服务器返回的任务范围。已完成的回执可在原任务继续后重读；尚未完成的上传必须仍有有效待补资料。取消待传文件允许清理已经失效的来源。 |
| 输入与产物来源 | 顾客主动选取的输入标记为 `metadata.input_task_id`、`input_origin=customer_selected_upload`，并保留 `upload_sessions.source_task_id`。不把输入写成 `metadata.task_id` 产物，避免原任务 → 输入 → 原任务的虚假产物来源环。储存层复用显式 `privateOwner` 和真实会话，未改 `storage.ts`。 |
| 数据库与删除 | 新增143迁移，冻结会话的任务/用户/项目/会话/覆盖目标范围，并核对完成结果实际资产的范围及上传版本归属。原任务删除会取消、清除该范围的上传回执与文件名，登记暂存删除项，删除其私人输入资产并建立删除依赖。142及以前迁移未修改；要求 schema143。 |
| 失效请求隔离 | 项目授权仍先整体检查。列表逐条以保存点核对来源，仅跳过403/404/409的失效项；其他错误仍抛出。以原始记录稳定推进游标、补足可见项，每请求最多扫描300条。失效项不泄漏旧标题/描述；直接读取、接单、交回继续拒绝失效来源。零条可见项但仍有下一页时，三端保留分页入口。 |
| 精确分页 | 数据库直接输出包含六位微秒的 UTC 游标；不经过 JavaScript Date 截断。相同毫秒内的不同请求仍可逐页到达。 |
| Starter 并发 | `plans.ts::authorizeTaskPlan` 仅在内部接单参数及冻结的 handoff/本机任务身份、费用、角色、提示、项目、用户、文件输入版本均一致时，允许其唯一直接 `needs_input` 原任务暂让出并发位。其他待补资料/活动任务正常计数；不提高套餐并发，不排除全部等待任务。两个任务继续独立保留真实预算和资金预留。 |
| 原任务授权撤回 | `parentAccess` 检查原任务冻结的 `actor_auth_version` 与当前有效用户及请求登录版本。Native 父级锁与数据库来源清单也检查原任务用户版本。管理员撤销登录后，重新登录不能为已失效的旧任务接单、开始、上传或交回；不会重绑旧任务授权。 |
| Extension 文件选择 | `local-handoffs.ts` 提供明确选择文件、上传确认，再选择固定版本并确认交回。复用 `chat-upload.ts` 的完整校验与分片恢复，上传身份单独绑定原任务，不要求伪造私人会话。保留原本5 MiB选择限制。没有自动读取或上传本机目录。 |

实际修改的代码路径均位于 `dev/`：

- `copypaste-platform/src/task-local-handoffs.ts`、`uploads.ts`、`plans.ts`、`task-service.ts`、`schema-compatibility.ts`。
- `copypaste-platform/migrations/143-task-scoped-uploads.sql`。
- Web与Desktop renderer 各自的 `src/task-local-handoffs.tsx`、`src/resumable-upload.tsx`。
- `copypaste-extension/src/local-handoffs.ts`、`chat-upload.ts`。

专用新增验证：`dev/copypaste-platform/tests/task-local-handoff-scope-147-v2.test.ts`，共9项。覆盖无会话私人输入、真实会话与共享输入、跨用户不可见、未结束准备/错误会话/覆盖目标拒绝、撤回来源阻止上传各阶段且其他收件箱项可用、范围不可改及删除联动、Starter单槽与双预算、无关等待任务仍阻挡、新登录不能重授旧授权、微秒分页。首项调用真实 Worker 和 `asset_text_read` 业务读取器读取实际 CSV 字节；仅运行时为显式测试替身，不调用模型，不证明本机 Codex/OS 执行。v1保留原字节；v2只修正新增测试在不同本机准备间复用 local_session_id 的搭建错误，每次独立准备使用新会话。

本次已运行：platform、Extension、Web、Desktop renderer 的 TypeScript `--noEmit`，全部退出0；新增v2后再次运行platform检查也退出0。完整数据库、迁移及三端交互由主代理的 backend07/build02/UI02 检查，尚未在本记录中声明通过；backend06保留运行中的原始结果，不因测试搭建错误修改已取样v1。未使用浏览器、Docker/WSL/VM；未提交或推送 Git；未修改既有已执行测试及迁移。

English: Task-bound uploads preserve the original private scope independently of chats and retain user-input provenance separately from task output provenance. Revoked inbox entries are isolated without weakening direct authorization. Starter admission yields only the strictly bound direct waiting parent's execution slot while preserving both reservations. A fresh login cannot reactivate the original task's revoked authorization. The added integration tests exercise real storage and Worker file reads with an explicit test runtime, not a model or OS-execution claim.
