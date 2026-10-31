# Stage 147 最终独立反证复核 v2

检查日期：2026-10-31。对象为主代理通知冻结后的工作区源码。仅阅读；未编辑产品、测试或验证器，未运行服务、模型、浏览器、数据库测试或 Git 操作。本报告核查原反例是否仍能由当前代码路径成立，不代替主代理正在执行的 backend07 资格结果。

## 结论

**原 F147-R1 与 F147-R2 在当前实现中均已消除。** 本次检查没有发现这两项修复或所要求的上传、固定版本读取边界中仍然成立的具体阻断反例。

| 原阻断 | 当前修复及反证结果 | 证据 |
| --- | --- | --- |
| F147-R1：Starter 原 needs_input 任务占满配额，无法创建其本机准备任务 | 只排除此次已认领本机步骤的直接 waiting parent。校验 handoff/task/project/user、pending 文件依赖版本、父与本机 prompt hash、role/hash、预算、本机位置及 execute 模式；要求本机 task 尚未插入。沿用按用户的配额事务锁，其他等待任务仍计入配额。未提高套餐上限，也未全局豁免 needs_input。原“只有一个等待父任务也必然 PLAN_TASK_LIMIT”的反例不再成立。 | `dev/copypaste-platform/src/plans.ts:72`–126；`src/task-service.ts:242`–250 从内部已验证 binding 传参；`src/task-local-handoffs.ts:112`–130 先锁定并验证关联再预留本机任务身份。 |
| F147-R2：授权版本撤销后重新登录，仍可为不能恢复的旧原任务支付本机费用 | parentAccess 同时比较当前用户版本、原任务冻结版本及本次 actor 版本；认领、回传、任务上传均经过此门。已创建本机任务的所有权锁还会重新核对原父任务版本。共享来源清单通过迁移 143 增加同一版本条件，不能经缓存产物或其他读取路径绕过。没有更新旧任务 actor_auth_version。原“以新会话为旧失效任务新增本机费用”的反例不再成立。 | `src/task-local-handoffs.ts:29`–38、`:98`–107；`migrations/143-task-scoped-uploads.sql:75`–80；`src/desktop-executions.ts:269`–278 先调用 lockLocalHandoffParent。 |

表中 `src/`、`migrations/` 相对 `dev/copypaste-platform/`。

## 容量与费用没有被旁路

`plans.ts:81`–89 在限定排除之前仍执行配额锁、当前执行套餐与预算上限检查；`:114`–124 只排除已证实的一个直接父任务。其他 queued/running/paused/awaiting_approval/reconciling/needs_input 任务继续计数。`migrations/089-paid-checkpoint-capacity.sql:31`–40 的实际执行容量仅统计 running/reconciling；Desktop 的 `migrations/092-desktop-execution-ownership.sql:107`–115 仍校验本机所有者并调用该容量函数，因此创建成功后没有第二个“等待父任务仍占执行槽”的同类阻断。

独立原云任务与本机任务仍各有 task_id、预算和余额预留；本次窄化处理只涉及容量计数。现有 `tests/task-local-handoff-scope-147-v2.test.ts:106`–124 明确断言两份真实 reservation、重复认领同 task_id、无关任务仍被拒绝、失败认领不新增本机任务或费用。`:152`–167 包含重新登录后拒绝读取、请求、认领、启动、回传及不重绑原 auth_version 的断言。本次阅读确认了这些测试的目标；**未将读取测试源码写成测试已通过。**

## task-scoped upload 的隐私与来源

- `src/uploads.ts:211`–216 禁止 source_task_id 同时改写既有 asset，并通过 taskLocalUploadScope 派生实际会话；`:90`–118 在后续上传操作中重查源范围。
- `src/task-local-handoffs.ts:76`–93 将原任务 private_owner 原样返回，不把“无 conversation 的 private task”推断成共享任务。
- `src/uploads.ts:476`–495 将派生 privateOwner 交给存储，只记录 `metadata.input_task_id` 与 customer_selected_upload；没有把该客户上传声明为原任务的产出。
- `src/storage.ts:349`–382 仅把事务中的 app.task_id 或 metadata.task_id 当作产物来源。`src/db.ts:47` 每次事务将 app.task_id 重置为空；上传流程没有把原任务写入该字段。`migrations/084-content-source-row-identifiers.sql:92`–94 也只沿 metadata.task_id 遍历产出来源。因此选中该上传作为原任务输入时，不会新增“输入文件 → 原任务产出”的反向边，不形成该自来源环。
- `migrations/143-task-scoped-uploads.sql:10`–31 冻结上传身份并要求有效原授权、已完成且已结算的本机准备；`:38`–54 再从数据库约束实际 asset owner 等于原任务 private_owner，版本必须带 input_task_id 且不得带 task_id。不能仅通过提交一个源 task ID 将私人上传变成共享文件。

## REQ-032 固定版本读取边界

- `src/workflow-contracts.ts:22`–46 按声明验证类型，以明确 asset_version_id 绑定文件，再比对冻结 values/files/hash；没有 current_version 条件，选中的旧版本可以继续使用。
- `src/workflow-handoffs.ts:81`–107 可在没有前序步骤的首步读取 named binding；指定文件必须在冻结 manifest 内，按版本 ID/hash 校验权限、存续及实际字节，不静默切换到文件当前版本。
- `src/task-private-asset-scope.ts:26`–43 要求 workflow_run 与当前任务的 run_id/input_hash/values/files 全部一致，只为冻结的 asset_id/version_id/hash 添加相应私有读取范围；知道另一个私人文件 ID 不构成授权。
- `src/task-business-tools.ts:1975`–2007 的 Image2 对同一 asset 的已批准版本去重；单一旧版本自动锁定，多个批准版本要求明确选择；显式替换版本或 hash 被拒绝，查询按锁定版本读取。没有把新 current_version 冒充原批准图片。
- `src/workflow-read-access.ts:12`–50 在读取保留结果时重新检查原来源、输入契约、实际子任务及产物版本，命名输出还会重新提取验证。完成后的缓存文本不能绕过已撤回的固定文件。

本次只读复核没有确认新的残留阻断。最终运行测试、构建及发布判断由主代理依据 backend07 和各端验证记录完成。
