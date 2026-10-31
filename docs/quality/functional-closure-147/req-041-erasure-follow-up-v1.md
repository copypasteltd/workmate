# REQ-041 删除链与撤回验证修正 / Erasure and withdrawal follow-up

2026-10-31。唯一工作区 `D:/dev/copypasted/自有agent`。本记录补充 `req-041-repair-v1.md`；当前 schema 要求更新为144，当前专用测试版本为 `task-local-handoff-scope-147-v3.test.ts`。

主代理 backend07 原始证据：`dev/copypaste-delivery/evidence/functional-closure-147/backend-07.tap:1264` 记录 scope-v2 第四项预期409、实际200；`:1290` 记录删除输入的外键错误。已执行的v1/v2及迁移1–143保持原字节。

第一项是验证搭建错误，不修改共享来源语义。v2在原任务 attempt=0、文件未消费时删除预选输入，但共享来源清单明确保留首轮前重新选文件的能力（迁移084:48–61及后继定义）。上传的原任务范围检查确实执行；缺少真实消费事实时，200不能证明其绕过来源校验。v3使用真实 Worker 和真实 `asset_text_read` 读取CSV，随后通过 `request_input` 建立已计量的待输入检查点；先断言实际字节、attempt=1、已记录来源读取与 waiting 检查点，再撤回该来源，覆盖上传读取、分片、完成、handoff直接访问及其他有效收件箱项。只注入明确标记的测试运行时，不调用模型，也不证明本机OS操作。

第二项是产品删除链缺口。迁移028的 `retire_task_dependencies` 在任务逻辑删除后物理删除输入行，以清除描述、文件选择及答案；迁移141却为需留存的handoff收据增加非空 dependency_id 外键，导致整个任务删除事务回滚，141的来源撤回与143的上传清理无法完整生效。

新增 `dev/copypaste-platform/migrations/144-handoff-dependency-retirement.sql`：

- 保留handoff不可变的原输入UUID，移除要求历史输入内容行永久存在的物理外键。
- 新建删除守卫：有handoff引用且原任务尚未逻辑删除时，仍拒绝删除输入。创建时的原输入存在性、范围及版本检查保持执行。
- 原任务删除时允许028清除输入内容；141仍取消handoff并撤回本机子任务内容；143仍清理绑定上传、私人输入与删除依赖。
- 不级联删除handoff、native任务身份、结算与必要收据。来源函数遇到已删除原任务或缺失输入仍不可用。

同步更新 `src/schema-compatibility.ts` 为144。v3删除用例补充活跃来源删除受阻、删除后的输入行清空、收据锚点与冻结定义保留、native内容已删除、资金预留/结算记录保留、来源清单拒绝已删除native内容等断言。未变更其他产品语义、既有迁移或已执行测试；未单独运行服务或测试。完整验证由主代理 backend08/UI05 负责，本记录不声明其结果。

English: The first failure confused an unconsumed selection with a consumed source; the new test obtains a real Worker read and paid input checkpoint before withdrawal. The second failure was a real conflict between input erasure and retained handoff receipts. Migration144 permits content-row retirement only after the original task is logically deleted, preserves immutable receipt identities and financial facts, and keeps deleted native sources unavailable.
