# Stage 147 独立静态反证 v4

检查日期：2026-10-31。检查已冻结的 migration 145、ErasureService.assets 和新增 task-upload-erasure-147-v1 测试源码。本次只写此报告；未执行测试、服务或数据库操作，未修改产品、测试、验证器及旧报告。

## 结论

**静态检查未确认新增的具体绕过或正常删除阻断。** migration 145 对 task-scoped upload 的终态放行绑定到其真实原任务删除，或该上传回执实际对应的固定资产版本删除。无关删除记录、单独设置 erasing_content 标志不能满足这些关系。最终是否通过仍以主代理的 backend09 实际输出为准。

## 删除授权关系

| 检查点 | 观察到的精确条件与结论 |
| --- | --- |
| 正式删除原任务 | `dev/copypaste-platform/migrations/145-task-upload-erasure-transitions.sql:13`–16 必须命中 OLD.source_task_id 的 cloud/execute 原任务；tenant、project、created_by 均与旧上传回执一致，任务必须已 deleted；deletion_jobs 必须以 tasks/该 task UUID 为目标且 tenant/project 相符。其他任务或资产的 journal 无法替代。 |
| 独立删除上传资产 | 同文件 `:17`–22 要求 OLD.state=completed；asset_versions.upload_session_id 必须等于这张回执 OLD.id；OLD.result.id 必须是该实际 asset，OLD.result.version.id 必须是该实际 version；asset tenant/project/created_by 与回执一致且已 deleted；journal 的目标必须是该 asset UUID，tenant/project 也必须一致。仅同用户、同项目或任意一个 deleted 资产均不足以放行。 |
| journal 与所有者 | task/asset 的 created_by 直接与 OLD.created_by 比较。journal 的 target UUID、tenant/project 与该实际对象相同；journal 由既有内容删除触发器记录对象身份，普通应用角色只有 SELECT 权限，不能以自行提交另一条 journal 替代对象关系。这里无需把管理员删除发起者错误地等同于原上传者。参见 `migrations/015-erasure-journal-expansion.sql:12`–14、`migrations/011-content-erasure.sql:36`–37。 |
| 原会话删除行为 | `:10`–11 保留 legacy 059 对原私人会话已删除时的既有允许条件；没有用这次 task-upload 修复扩大普通上传的终态权限。 |
| 允许的终态与其他不可变字段 | `:9` 只允许 cancelled + `[deleted]` + NULL result 的退役形态。`:24`–32 仍禁止更改原资源身份、MIME、大小、hash、分块、asset/version 绑定、会话和创建时间，禁止延长到期时间；新建仍要求有效 pending 并检查存储配额。143 对 source_task_id 及原上传范围的不可变约束仍在。重新打开 cancelled 回执为 pending 不获允许。 |

除首个完整路径外，表内路径均相对 `dev/copypaste-platform/`。

## 实际擦除顺序

`src/erasure.ts:359`–374 在 asset 已验证 deleted 的擦除事务中，先精确取消 task-bound 回执：result.id 对应当前 asset，同时该回执的 upload_session_id 与 result.version.id 必须指向其真实 asset_versions 行。随后才执行原有的普通回执 filename/result 清理。这解决了“task-bound 回执仍为 completed，却先把 result 清空，触发 143 结果身份约束”的原阻断。

放行所需的 journal 不依赖事后补写：既有 `content_erasure_journal` 触发器在资产或任务变为 deleted 时建立记录；同类 AFTER 触发器按名称顺序执行，任务的 content_erasure_journal 先于 task_upload_erasure。因此原任务删除触发上传回执退役时，145 要求的正式 task journal 已可见。独立资产擦除则由 ErasureService 先验证目标确实 deleted，才进入 scrub。参见 `migrations/011-content-erasure.sql:88`、`migrations/143-task-scoped-uploads.sql:56`–74、`src/erasure.ts:112`–147。

同一 asset 有多次普通上传版本时，旧 task-bound 回执仍按自己的 upload_session_id 和旧 result.version.id 匹配，不会切换到 current_version。正常上传的新版本回执 source_task_id 为 NULL，保留原来的 completed 状态并清理文件名/result；143 的 task-bound 结果守卫不适用。资产删除的既有 journal 先收集所有版本对象及对应上传目录，再清除回执结果，故新旧版本和暂存目录不会因先清指针而失去删除条目。参见 `migrations/015-erasure-journal-expansion.sql:15`–17、`migrations/018-upload-erasure.sql:3`–15。

## 私人与共享范围、费用

删除 private 原任务时，143 取消该任务上传回执、登记暂存目录清理，并将其私人上传派生资产标记 deleted；关联子删除依赖仍保留。删除 shared 原任务时，仅退役该任务的上传回执和暂存目录，显式共享资产沿用既有可见性。此行为符合本次明确范围；本报告不要求共享资产随原任务自动删除。参见 `migrations/143-task-scoped-uploads.sql:56`–69。

145 没有变更 ledger、funding_lots、reservations、任务费用或本机执行身份。新增 ErasureService.assets 逻辑也只处理对应上传回执与原有资产删除。因此不会因这次终态转换自动释放、转移或抹去已记录费用。

## 新增测试的静态搭建复核

已阅读 `tests/task-upload-erasure-147-v1.test.ts`，没有确认明显的新搭建错误：

- `:65`–90：经真实上传接口保存私人输入，交回原任务后再删除；检查对象与暂存目录消失、另一个上传回执和资产保持原状、费用记录不变；即便同 owner/project 已有另一个正式资产删除 journal，并设置 erasing_content，也不能取消无关 completed 回执；同时拒绝重开、延期及改 MIME。
- `:93`–113：创建共享 task-scoped 版本，再通过普通上传新增同 asset 的第二版；分别检查两个真实 upload_session_id、所有版本字节及暂存目录删除；第一张 task-bound 回执 cancelled，第二张普通回执维持原 completed 终态并清内容。原任务保持 active，证明不是靠删除源任务绕过固定资产匹配。
- `:116`–130：共享原任务在取消后删除，通过 ErasureService 处理真实删除队列；要求该 task 回执及暂存目录退役、已明确共享的资产与字节保留、两笔任务的费用事实保持，同时本机 handoff 被取消。

这些用例使用实际上传和擦除服务，但本机完成来自控制面 fixture，不能证明真实 OS 执行。本次只检查源码与断言目标，没有执行它们，也不把预期断言写成已取得的验证结果。
