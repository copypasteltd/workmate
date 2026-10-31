# REQ-041 独立反证检查

日期：2026-10-31。仅阅读规范和实际调用链；未改变运行数据、代码、测试或 Git。

## 结论

**未能以现有依赖补齐或设备命令推翻 UC11 的接续缺口。** 现有实现包含真实的本机 Codex、受限文件操作及云任务资料补齐；缺少的是把 Web 原任务的明确本机步骤持久化为等待、由 Desktop 用户授权执行，再把真实产物绑定回原任务并让 Web 审阅的一条完整链。

直接依据是 `docs/requirements/01-srs.md:163` 的 REQ-041，以及 `docs/product/02-user-journeys.md:114`：Web 发起 → 本地目录需求显示等待设备 → Desktop 选择范围 → 本地完成 → Web 审阅。`:116` 又明确禁止 Desktop 离线后云端自动接管。不能为了补齐跨端接续而把本机 Agent 改成云端 Agent。

## 现有路径能否构成反例

| 尝试的反例 | 源码证据 | 判断 |
| --- | --- | --- |
| 在统一任务创建时指定设备 | `dev/copypaste-platform/src/canonical-tasks.ts:377`–404 将 device_id 列为不支持字段并拒绝。 | 无法从此路径建立 Web 原任务的设备执行步骤。 |
| 利用已实现的资料补齐 | `src/paid-task-inputs.ts:22`–46 的请求类型为 file、connection、question；`src/task-dependencies.ts:305`–363 处理客户选择和版本；`:377`–422 更新依赖、保持原 task_id 并入队。Web `dev/copypaste-web/src/task-dependencies.tsx:18` 起按 needs_input 显示现有输入界面。 | 原任务继续执行是真实能力，可作为接续基础。但没有设备等待、本机步骤认领或 Desktop 授权输入。手工上传文件不等于已建立 UC11 的本机执行链。 |
| Web 设备面板发送文件命令 | `dev/copypaste-web/src/main.tsx:2599`–2659 独立排程文件命令，提交 operation/grant_id/path/content，未传原 task_id；结果在该面板显示 JSON。 | 能操作已授权目录，但未关联任务的等待步骤或交付审阅。 |
| 命令接口的可选 task_id | `src/business.ts:821`–835 校验原任务权限并可保存 task_id；`:861`–902 的完成事务只更新 device_commands.state/result。全 src 搜索 device_commands 另仅有撤销、断开及输入检查点的未决操作检测。 | task_id 外键不构成状态机：没有创建资产、解析依赖、继续原任务或生成 Web 交付事件的完成逻辑。 |
| 离线后稍后领取已有文件命令 | `src/business.ts:833` 固定两分钟过期；`:759`–772 仅返回 pending 并改 claimed；`:890` 仅接受未过期 claimed 完成结果。Desktop `dev/copypaste-desktop/src/main.ts:558`–629 校验签名、执行、单次回报，catch 不保留待提交结果。 | 这是短时命令机制，不能直接证明持久设备等待与断线恢复已实现。不能仅延长超时就宣告接续闭环；已执行但回执丢失的状态仍须保留真实结果并对账。 |
| 本机防重复日志已经解决一切 | `dev/copypaste-desktop/src/files.ts:148`–237 有权限、路径、过期、request_id/digest 校验和完成结果日志。 | 是有效的本机防重复机制，应保留。但服务端不重新投递 claimed，客户端也无完成回执 outbox，因此本机日志本身不能恢复原任务或补交服务器结果。 |
| 用已有 Desktop 私有流程接管云任务 | `src/desktop-workflows.ts:46`–63 要求原任务及 workflow_run 具有本机执行上下文；`:300`–307 的子任务明确创建 desktop_execution。`src/task-service.ts:97`–112 强制 Desktop 本地执行；`:122`–142 禁止父子改变 execution_location。 | 已有纯 Desktop 路径真实，且约束正确；它不是 Web 原任务本机依赖的替代接续路径，不能通过翻转云任务执行位置绕过。 |

表中 `src/` 相对 `dev/copypaste-platform/`。

## 必须保留的范围边界

1. 不应报告“Desktop 没有本机 Agent”或“文件操作从未实现”：这些已有真实实现。缺口是跨端等待、授权、执行、产物与原任务继续的关联。
2. REQ-041 不要求任意跨操作系统的完整自动迁移。客户明确授权的文件读取可作为受限本机步骤；一般本机 Agent 工作应由独立、明确关联的 Desktop 执行所有者完成。
3. 目前 `src/paid-task-inputs.ts:198`–216 会在原任务仍有 pending/claimed 命令时拒绝将其视为安全输入检查点。因此不能先挂一个永久 claimed 命令，再假设普通文件依赖会自行恢复。
4. 后续闭环应能证明：原任务和明确本机步骤绑定、设备离线仍有可见等待、Desktop 客户选择范围和预算、重复请求及重连不重复执行、真实结果持久化且绑定回原依赖、Web 原任务审阅；必须保留取消、撤销和执行所有权约束。

检查限制：本次未运行服务或进行故障注入；以上为独立的规范与源码反证结论，不替代后续运行验证。
