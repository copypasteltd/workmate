# Stage 147 独立静态反证 v3

检查日期：2026-10-31。仅阅读迁移、运行代码与新测试源码；本次只写此报告。未启动服务、未执行测试、未修改产品、测试或验证器。下述结论属于静态复核，不能作为 backend07 或后续验证已通过的记录。

## 结论

**本次未确认新增的具体阻断反例。** 迁移 144 解决的是原任务删除时，保留的 handoff 外键阻止依赖内容退役的问题；它没有级联删除费用或本机执行身份。新 scope-v3 与 file-access-v2 已修正此前明确的搭建方式；是否运行通过仍需主代理查看实际验证结果。

## 144：依赖内容退役与保留记录

| 反证目标 | 静态检查结果 | 证据 |
| --- | --- | --- |
| 移除物理外键后，活动 handoff 的原依赖可被普通删除 | 新 BEFORE DELETE 检查所有引用 OLD.id 的 retained handoff。只要对应 OLD.task_id 的原任务尚未标记 deleted，即抛出 23514；不根据 waiting/working/completed/cancelled 放宽。因此保留记录仍关联活动原任务时不能先删除依赖内容。 | `dev/copypaste-platform/migrations/144-handoff-dependency-retirement.sql` 的 guard_handoff_dependency_retirement；`migrations/028-task-input-dependencies.sql:25`–26 原有应用/控制角色权限。 |
| 原任务已删除，但依赖描述、问答内容仍被旧 FK 卡住 | 144 仅移除 task_local_handoffs.dependency_id 的 FK。现有 retire_task_dependencies 在看到 NEW.content_state='deleted' 后删除该任务全部依赖；新守卫此时允许删除。task_local_handoffs.dependency_id 本身保留原 UUID，不复制依赖描述或答案。 | `migrations/144-handoff-dependency-retirement.sql:5`；`migrations/028-task-input-dependencies.sql:27`–38；`migrations/141-task-local-handoffs.sql:3`–22、`:50`–58。 |
| 费用或本机执行记录随依赖内容一起被删除 | 144 没有删除 handoff、tasks、desktop_executions、reservations 或账务记录，也没有给它们添加级联删除。任务擦除清理内容、消息、事件、检查点及工具结果，保留任务身份和费用事实。 | `migrations/144-handoff-dependency-retirement.sql` 全文；`src/erasure.ts:366`–398。 |
| 原任务删除后，本机产物还能脱离原来源继续使用 | 141 的 withdraw_task_handoffs 取消活跃请求，并把关联 native task 标记 deleted。local_handoff_source_tasks 仍要求原依赖存在、原任务内容有效且 hash/身份一致；依赖行退役不会把来源绑定解释为空或无来源。迁移 143 对原 auth_version 的条件也保留。 | `migrations/141-task-local-handoffs.sql:67`–108、`:144`–159；`migrations/143-task-scoped-uploads.sql:75`–80。 |
| 程序仍能在缺少 144 的数据库上启动 | requiredSchemaVersion 已为 144，并继续要求迁移历史完整且版本完全匹配。 | `src/schema-compatibility.ts:5`、`:17`–32。 |

表中 `src/`、`migrations/` 相对 `dev/copypaste-platform/`。有效客户端的 handoff 创建仍先锁原任务与依赖并校验身份；144 没有新增客户端删除依赖的入口，也没有给 cp_app 增加 DELETE 权限。

## scope-v3 搭建复核

`tests/task-local-handoff-scope-147-v3.test.ts:43`–54 的 ConsumedInputThenRequest 是受控 Runtime 替身，**不是实际 Codex 模型**。它发出 thread/turn，调用实际 asset_text_read 消费源字节，再调用实际 request_input，最后返回已知用量的完成回合。`:96`–114 由实际 Worker 运行上述过程，先断言 attempt=1、原 runtime_thread、实际 task_source_reads 与 waiting 付费检查点，再删除源资产，并检查上传读取、分块、完成、handoff 直接访问被拒绝；同时检查无关的有效收件箱项仍可读取。这条路径不再用“尚未消费的初始文件选择”冒充已消费来源的撤回。

`:116`–135 的删除用例同时检查：活动依赖直删被拒绝；原任务 deleted 后依赖内容行退役；handoff 的 dependency_id/native_task_id/definition_hash 保留；本机任务被标记 deleted；已有 reservation 的金额与状态保留；本机来源校验拒绝；任务上传记录和私人派生资产进入删除。所选原文件由 fixture 的 asset() 创建，内容与新测试读取断言相符。静态阅读未发现新的明显搭建错误。

这些断言的存在并不证明它们已经运行通过；本次没有读取或制造成功结果。

## 032：Unicode 预览与真实模拟网关请求

`src/workflow-handoffs.ts:29`–56 仍先保存完整 UTF-8 文本文件；预览最多取 6000 个 UTF-16 单元，并在截断点恰好落在高、低代理项之间时回退一位。因此完整输出与命名输出文件没有被截短，而进入 JSONB receipt 的预览不会因这一截断产生孤立代理项。该共享函数同时供云端和 Desktop 工作流捕获实际输出使用。

`tests/workflow-file-access-147-v2.test.ts:14`–40 保存原 fetch，只观察实际 `/v1/images/edits` 的序列化 multipart 字节、任务/操作/模式标识，再用 realFetch 原样转发请求并返回原响应；after 恢复原 fetch。`:93`–120 先断言未批准版本、错误 hash、无关私人图片不发请求，再检查唯一实际请求为 simulated、响应为 200、multipart 中是客户选中的旧版本字节，且记录的是旧版本 source read。它没有通过自造图像响应或假端口证明派发完成，也没有将模拟模式写成真实供应商验收。

本次没有确认上述实现中仍成立的新阻断。运行结果、数据迁移验收及发布资格仍由主代理依据实际测试输出判定。
