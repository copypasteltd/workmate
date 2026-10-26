# 私有云端流程顾问 / Private cloud workflow consultant

本增量把企业流程顾问接到实际的云端顺序执行引擎。Web/Extension 使用云端 Codex；Desktop 继续使用客户本机 Codex 和独立的本机流程工具。流程版本保持私有，不因发布而成为项目共享内容。

## 用户流程 / Customer journey

1. 从角色目录选用流程顾问，在私有会话中明确选择 Execute 并说明目标、资料和交付。当前顾问任务按自身实际用量计费。
2. 顾问读取获准数据，以 `workflow_validate` 核对顺序、实际可用的子角色、数据来源和各步骤预算；保存不可变版本，发布后发起请求。
3. 请求保持待确认。用户在 Workflows 查看固定版本、完整步骤、人工审批点及所有 Agent 子步骤的总预算上限。确认前不创建子任务，不预留子任务费用。
4. 用户勾选预算同意并确认后，服务按步骤执行。计算摘要会保存实际私有文件；Codex 子任务具有独立预留、真实结果和实际结算。人工审批步骤等待用户再次确认。
5. 页面展示当前任务、逐步结果及实际费用。修改创建新版本；已保存版本和既有执行绑定保持不变。取消释放未执行预留，中断运行任务；未知结果/费用保留核对，不自动重跑。

The consultant prepares a private immutable version. The customer reviews its exact steps and separate child-step budget before execution. The service runs a bounded sequence, pauses at actual human review points, retains real private deliverables, and settles each Codex child from its own usage. Revisions preserve original versions and runs.

```mermaid
sequenceDiagram
  participant User as Customer
  participant Codex as Cloud consultant / Codex
  participant Service as Company workflow service
  participant Child as Cloud Codex child
  User->>Codex: Execute an authorized preparation task
  Codex->>Service: Validate, save immutable version, publish
  Codex->>Service: Request fixed version and definition hash
  Service-->>User: Pending request; no child reservation
  User->>Service: Review exact revision, cursor, steps and maximum budget
  Service->>Service: Confirm original task succeeded and sources remain authorized
  Service->>Child: Reserve and queue one fixed child step
  Child-->>Service: Actual task result and settlement
  Service-->>User: Private files, receipts and next human approval
  User->>Service: Approve continuation or stop
```

## 执行与权限 / Execution and authority

- `workflow-consultant@1.1.0` 绑定 `workflow-design@1.1.0`、`workflow-execution@1.1.0`。保留旧角色与旧 Skill 包，不静默升级已有专业助手。
- 模型可验证、保存、发布、请求、查询和取消，无法调用预算或人工审批接口。Ask/Plan 仅提供当前读取与验证工具。
- 准备请求绑定不可变定义、版本、散列和子角色定义散列。确认要求匹配当前 revision、cursor、definition hash 及预算，使用幂等键应对网络重试。
- 子任务原子绑定 run/cursor；唯一索引阻止并发 tick 重复创建任务和预留。取消、来源、用户状态、套餐和角色可用性由服务器及数据库再次核对。
- 私有文件、会话、版本和执行记录均绑定真实租户、项目与用户。另一会话无法经模型读取已保存的私有流程。来源隔离和衍生文件可用性沿用现有来源遍历，保留品牌、GEO、创意反馈及项目配置校验。
- SQL105 为新增迁移，不修改 SQL001–104。原有共享流程和定时调度保留独立默认路径；本机流程保持本机执行。

## 当前边界 / Current scope

支持最多八个顺序步骤：实际可用的指定云端 Codex 角色、授权数据摘要、明确人工审批。嵌套流程、任意云端 shell、外部应用写入、自动 OAuth/广告账号写入和视频子任务尚未在这条私有云端流程链路开放。它们不能通过角色标签或模型文本获得权限。

本地网关和账户数据按用户要求使用明确标注的假数据；原生 Codex、工具调用、事务、文件、预留和页面操作为实际执行。模拟服务验证不等于真实模型专业质量、正式账户验收或完整产品验收。

## 接口与恢复 / API and recovery

读取使用 `GET /v1/tenants/:tenant/projects/:project/cloud-workflows`，只返回当前真实用户在指定项目中的获准私有流程及执行记录。返回版本、定义散列、revision、cursor、实际结果和子任务预算；读取不会授权执行。页面保留既有共享流程入口，新的私有区使用单独接口和权限范围。

客户操作使用 `POST /v1/tenants/:tenant/projects/:project/cloud-workflows/runs/:run/decision`。需要真实登录用户、项目权限、CSRF 和 `Idempotency-Key`，请求字段如下。客户端必须使用读取到的当前值；实际界面由用户核对并勾选后才提交。

```json
{
  "decision": "approve",
  "expected_revision": 1,
  "definition_hash": "<exact returned SHA-256>",
  "stage": "start",
  "max_budget_micros": 100000,
  "expected_cursor": 0
}
```

`decision` 为 `approve` 或 `cancel`；首次授权为 `start`，实际人工审批点为 `step`。预算单位为港币微额，`100000` 为 HK$0.10 的子步骤总上限，顾问准备任务另外按真实用量结算。客户端网络重试复用同一键和原请求；revision、cursor、定义散列或预算不符时服务拒绝，客户端重新读取，不能将未知结果自动重做为新收费请求。

The GET response is scoped to the authenticated actor and current project. The decision endpoint requires CSRF, idempotency and exact revision/cursor/hash/budget values. Only the customer interface can authorize initial execution or continuation at a human review. Agent tools cannot make these decisions. A stale decision fails instead of approving a newer procedure. Unknown child usage keeps its original reservation and blocks replacement execution.

原生定时器只选取仍获准的私有云端请求，并在每次 tick 重新核对来源、用户状态、固定版本与角色可用性。排队、执行、需补充输入、待结算和待人工审批分别保留真实状态。数据摘要不启动模型；实际 Agent 子任务通过现有公司 Worker 运行 Codex。私有执行唯一绑定 `(run_id,cursor)`，不借用规划任务的父子关系字段。

迁移使用新增 SQL105；旧 SQL001–104 不修改。新角色及两个 Skill 由 `scripts/upgrade-workflow-role.ts` 幂等追加，旧 35 个 Skill 包及既有专员固定版本保持原字节。后端部署应先完成数据库迁移再启动新版本；客户端和服务应成套升级，以显示新的私有执行与确认入口。

## 实际验证 / Recorded checks

[源码绑定检查](../quality/cloud-workflows-checkpoint.json)记录 55 项相关后端回归与 8 项真实浏览器检查，覆盖顾问准备、显式预算、暂停审批、实际摘要与子任务下载、修改版本、私有隔离、取消、来源撤权和单次结算。模型为明确假数据，顾问、子任务及修改均使用实际固定版 Codex 进程。

浏览器第 03 次记录保留原始文件，但窄屏截图受到并发采集与窗口缩放的竞争影响。第 04 次在缩放前结束采集，并验证正文、操作按钮及折叠侧栏的实际边界，作为本次最终界面证据；不修改旧录屏。后端第 09 次通过后只修改了浏览器检查脚本，精确旧脚本保留于原始 verifier，最终第 04 次单独验证新脚本；产品运行代码保持一致。

[实际待确认页面](../design/implementation/workmate-cloud-workflow-04-pending-request.png) · [实际繁中窄屏](../design/implementation/workmate-cloud-workflow-04-review-zh-375.png) · [准备与确认 GIF](../design/implementation/workmate-cloud-workflow-04-cloud-workflow-prepare.gif) · [执行与修改 GIF](../design/implementation/workmate-cloud-workflow-04-cloud-workflow-review.gif)
