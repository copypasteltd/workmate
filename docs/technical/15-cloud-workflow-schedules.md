# 云端工作流程定时执行

版本：1.9 · 2026-10-19 · 产品 0.4.0。对应 REQ-008/010/011/032/033/092/094/100。此前账号生命周期保持不变；当前实现仅开放每日/每周日历，不提供任意脚本。

## 用户流程与权限

项目 owner/admin 选择已发布工作流程 → 输入时区、每日/每周时刻、起止区间和漏跑策略 → 预览后续时刻、工作流程版本及每次 Agent 预算 → 勾选授权 → 启用。后台保存独立计划，关闭浏览器或 Desktop 后原生服务继续执行。成员可按项目权限查看；创建、修改和用户端暂停/恢复/停止要求项目管理权限。

每次触发产生独立 workflow_run，保留当时的工作流程定义、版本、角色哈希、执行用户与授权版本。运行使用原用户身份，执行前及每个步骤重新检查当前账号、企业、项目和内容授权。修改使用 CAS 与幂等键，生成不可变配置版本，从新生效时刻开始；旧记录保留原配置。用户恢复会建立当前管理者的新授权版本，不补跑暂停期间。停止为终态，需新建计划。

Admin 可在 Execution 下按 scope 检索、暂停、恢复，分别要求 execution.read/pause/resume、近期 MFA、目标版本、原因和幂等键。管理员恢复保留原用户和原配置，只重设未来游标；若原授权已撤销或工作流程不可用，恢复拒绝，必须由项目管理员确认新授权。后台动作保留实际管理员审计，不以管理员身份替代客户执行身份。

## 时间规则

时区采用有效 IANA 标识，时刻为 HH:mm，weekly 明确选择 ISO 星期 1–7。开始默认当前时间，结束为排除端点；结束后不会补跑并收费。频率和时区修改生成新版本。定时依赖原生 Worker 的周期派发，不承诺硬实时。

重复的本地时刻取第一个 UTC 时刻，仅运行一次；夏令时跳过的本地时刻在时区转换点记录 skipped_dst，不移动到另一时刻执行。实现使用锁定的 [Temporal polyfill 0.5.1](https://github.com/js-temporal/temporal-polyfill)；歧义时间模型参考 [Temporal 官方说明](https://tc39.es/proposal-temporal/docs/zoneddatetime.html)。测试另覆盖半小时切换、45 分钟偏移、闰年和整天跳过。

漏跑默认 latest：仅处理最近一个应到的日历时刻，较早机会合并为一条区间，保存起点、排除终点和数量，不逐次创建运行。合并计数是日历机会数，包括其中可能不存在的本地时刻，不冒称实际可执行次数。skip 策略只容许一分钟内的派发延迟，超过则记录略过。暂停/恢复跳过暂停区间；无历史执行风暴。

每项目最多 50 个非停止计划，一次扫描最多 20 个。每计划最多一个未结束运行；人工审批算未结束，已失败流程中尚有 queued/running/paused/awaiting_approval/reconciling 子任务也阻止新运行。不确定费用仍由原任务对账，不能通过下一次触发绕过。

## 持久性与内容控制

迁移 009 增加 workflow_schedules、workflow_schedule_versions、workflow_schedule_occurrences，以及运行上的 schedule/revision/scheduled_at/workflow_version/role_hashes。三表启用 FORCE RLS；配置历史与触发历史不可修改。后台删除计划可在受限 erasing_content 事务中清空配置正文，并使缓存幂等结果成为删除墓碑。

Worker 对计划行使用 FOR UPDATE SKIP LOCKED；触发记录具有计划/UTC 时刻/工作流程版本唯一约束，运行另有未结束计划的唯一索引。触发记录与运行同事务提交，崩溃时共同提交或回滚。较旧漏跑区间不需要枚举所有日期。

计划隔离停止未来触发，恢复内容不会自动恢复定时。工作流程下架/删除会阻止后续触发并请求取消关联运行及子任务；运行停止与未来定时暂停分开处理。子任务创建复用统一 enqueueTask，包括 Codex/Skill、权限、权益、预算预留、审计和 outbox，不另开未经约束的 AI 路径。角色哈希变化在收费前阻止定时执行。

## 实际接口

用户前缀为 `/v1/tenants/:tenant/projects/:project`。敏感写请求使用原有会话/原生 bearer、CSRF 及 Idempotency-Key。

| method / path | 用途 |
| --- | --- |
| GET `/workflow-schedules` | 当前项目计划及最近 100 次触发 |
| POST `/workflow-schedules/preview` | 校验输入和资源，返回未来时刻、工作流程版本/摘要及每次预算 |
| POST `/workflow-schedules` | 明确提交 expected_workflow_version/expected_definition_hash，原子创建 |
| GET `/workflow-schedules/:id` | 配置版本历史及未来时刻 |
| POST `/workflow-schedules/:id/versions` | expected_version 与工作流程摘要，新配置版本 |
| POST `/workflow-schedules/:id/status` | expected_version；pause/resume/retire |
| POST `/workflow-runs/:id/cancel` | 独立取消当前运行及其可取消子任务 |
| GET `/v1/admin/workflow-schedules` | scope 过滤后的分页列表 |
| POST `/v1/admin/workflow-schedules/:id/pause` | 当前权限、MFA、expected_version/reason |
| POST `/v1/admin/workflow-schedules/:id/resume` | 同上，并验证原用户授权仍有效 |

每次 Agent 预算为固定步骤预算之和；它不等于报价、余额或预扣费用。数据/审批步骤可以不调用 AI，Codex 步骤仍须真实公司网关、可用角色与现有费用约束。生成式视频、事件 Webhook、任意 cron 表达式、多计划并行及完整团队编排不由本增量冒充完成。验收见 [0.4.0 记录](../quality/07-cloud-schedule-acceptance.md)。
