# REQ-032 backend07 follow-up v1

本次依据 `dev/copypaste-delivery/evidence/functional-closure-147/backend-07.tap` 的实际失败定位，在主任务确认 UI04 完成并明确解冻后修改。仅修改一个共享产品函数并新增第二版测试；原有已执行测试、fixture、verifier、脚本与迁移均保持原样。本次没有启动服务、数据库或测试，没有提交／推送。

## 两个窄根因

1. **test68 为产品缺陷。** TAP1502–1506 的 PostgreSQL JSON 解析错误发生在保存步骤结果时，并非数据库触发器拒绝契约。`src/workflow-handoffs.ts::captureWorkflowOutput` 的 `.slice(0,6000)` 将合法 Unicode 文本中的 `🌟` 代理对切开，产生孤立高代理项 `\ud83c`。`cloud-workflows.ts:963–964` 把这个预览序列化写入 jsonb，失败后外层捕获将流程标记 failed。Desktop 使用相同共享函数。现在仍遵守6000 UTF-16单元上限，只有当边界位于代理对内部时向前退一个单元，完整私有成果文件的保存字节不变。既有 `workflow-contracts-147-v2.test.ts` 的完整 Unicode 输出用例可直接回归。

2. **test73 为第一版测试捕获假设错误。** `workflow-handoff-fixture-145-v1.ts:239` 默认启用 DEMO_MODE；`server.ts:117–118` 启动并使用内部 demo 的配置，`demo-gateway.ts:892–906` 覆盖传入的 AI 地址、模型和费率。因此第一版新增测试所启动的外置服务未收到请求，不能由其计数0推断公司工具未执行；工具与子任务此前实际成功。已执行第一版文件原样保留。

## 新增第二版测试

`dev/copypaste-platform/tests/workflow-file-access-147-v2.test.ts` 继续覆盖三项原业务断言，纠正图片网络观察位置。它使用原 fixture 和内部 demo 服务，仅包装真实 `fetch`，复制待发送的 multipart 字节后原样转发同一请求，不替换网络响应、不改公司网关或绕过授权。

`internal-ai-gateway.ts:320–322` 会先将 FormData 序列化，实际 `fetch` 的正文在 `:528–533` 为 Uint8Array。新测试读取该真实正文和任务／操作标识，要求错误版本、错误 SHA 和未选私有文件都没有网络派发，合法请求只发生一次并获得 HTTP200；重新解析真实 multipart，核对图片恰好为已批准旧版全部字节，新的当前版本没有进入请求；同时核对真实 `task_source_reads` 仍只记录旧版。其他用例继续验证跨会话精确私有CSV可读、未选文件拒绝，以及云端命名输出过期后不再返回缓存内容。测试结束恢复原 fetch 并关闭原 fixture。

## 验证状态

按主任务要求，没有独立运行类型检查、测试或服务，避免误接主数据库。源码和新测试完成后立即冻结，交由主任务统一 backend08／UI05 验证。本报告不声明本次修改已经通过验证。
