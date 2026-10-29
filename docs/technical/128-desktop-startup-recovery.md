# Desktop 安全启动恢复 / Safe Desktop startup recovery

本阶段补齐客户本机 Codex 在 initialize、thread/start 或 thread/resume 发生传输故障时的启动恢复。执行位置、客户本机权限、原任务、原费用预留、worker attempt 与原始执行截止保持一致。每个任务最多两次启动；已准入轮次、任何模型/输入计数/公司工具请求、未知结果或清理失败均禁止重放。

The customer-local Codex may recover from a startup transport failure at initialize, thread/start or thread/resume. The original task, reservation, worker attempt, authority and absolute deadline remain. A task has at most two launches. Turn admission, any provider/input-count/company-tool admission, unknown work or cleanup failure prevents replay.

## 协议与权限 / Protocol and authority

1. 新客户端在启动时声明明确版本的恢复协议。公司端返回启动代次、固定契约摘要与原截止；旧客户端保持原来行为，不获得恢复许可。
2. 主进程在本机原子日志记录启动代次后才创建 Codex。只有原生运行器明确识别的启动传输故障、且所属进程和锁已清理，才允许提出恢复请求。
3. 恢复意图及请求键先写入日志。公司端锁定父任务、原任务和执行记录，撤销旧凭证、切换隔离代次并持久化恢复意图，再关闭本节点旧网关与工具请求。
4. 公司端再次在相同锁序内校验当前身份、企业、项目、父任务、角色、Skill、固定输入、预算和原截止；以持久记录证明零模型、零输入计数、零公司工具及零轮次准入，才发放第二次启动凭证。
5. 旧模型请求和旧公司工具请求即使晚到，也必须因代次不符而失败。各节点网关缓存按任务与隔离代次区分。
6. 主进程再次确认客户本机授权后才启动第二个本机进程。提交 turn/start 前先持久登记轮次准入；此后任何错误均不自动重放。

The recovery intent is journaled before sending. The server durably fences old authority, drains owned gateways/calls and proves zero durable admissions under the original task locks before issuing the second credential. Old delayed requests cannot cross the epoch. The main process rechecks local consent, and durably admits the turn before calling native turn/start.

## 丢失响应与崩溃 / Lost responses and crashes

相同恢复请求键仅对应同一个第二代凭证，不另建任务、不增加预留、不延长绝对截止。恢复响应丢失时仅重取同一恢复结果。日志已标记启动但无法证明所属进程状态时，不再创建进程；进入停止或核对路径。崩溃后的全部本机工具恢复仍需独立完整验收。

An identical recovery key retrieves the same second generation, without a new task, hold or deadline. A lost response only retrieves that recovery. A journaled launch with uncertain process ownership cannot create another process. Complete crash recovery across all local tools remains a separate acceptance item.

## 接口与部署 / Interfaces and deployment

两个接口均挂在原执行记录 `/v1/tenants/:tenant/projects/:project/desktop-executions/:execution` 下，只接受原 Desktop 登录家族、原本机绑定及当前项目写权限。所有恢复和轮次请求都需要持久的 `Idempotency-Key`。

Both endpoints belong to the original execution and require its Desktop sign-in family, local binding and current project write authority. Each recovery or turn admission uses a durable `Idempotency-Key`.

| 接口 / Endpoint | 输入与行为 / Input and behavior |
| --- | --- |
| `POST /start` | 原绑定及可选 `startup_protocol: desktop-startup-recovery-v1`；返回原任务、原凭证截止及固定契约摘要 / Original binding and explicit opt-in; returns the original task, deadline and fixed contract digest. |
| `POST /startup-recovery` | 原绑定、`startup_fencing_token`、`contract_sha256`、`expected_attempt: 1`、`stage`；同键同正文取回同一恢复，换键或换正文拒绝 / Original binding, fence, contract, first-attempt number and classified stage; identical retries retrieve one recovery, changed identities conflict. |
| `POST /turn-admission` | 原绑定、当前隔离代次和契约摘要；持久准入后才能提交本机轮次或公司请求 / Original binding, current fence and contract; durable admission precedes the native turn and company calls. |

升级时先停止需要新协议的 API，使用数据库所有者按顺序执行 SQL001–133，再启动要求 schema133 的服务，最后分发对应 Desktop。SQL001–132 不改写。旧客户端没有恢复协议字段，继续使用原执行路径；新协议客户端不能绕过轮次准入屏障。

Apply SQL001–133 in order with the database owner before starting the matching schema133 API and distributing Desktop. Existing SQL001–132 stay unchanged. Legacy clients retain their original execution path; opted-in clients must pass turn admission.

本机 journal 只保留启动次数、隔离代次、契约摘要、原截止、轮次请求键和恢复意图。公司推理凭证不写入 journal，也不发给渲染页面。任何已标记但无法证明退出的启动都需要核对，不能仅因应用重启而再启动。

The local journal holds launch count, fence, contract, original deadline, turn key and recovery intent. Scoped inference credentials stay out of the journal and renderer. Restarting the app cannot repeat a journaled launch whose exit is unproven.

## 验证状态 / Qualification state

本轮通过91项相关控制层检查、43项真实固定版本Codex检查、30项原生数据库/API检查、3项当前编译，以及6项实际未签名打包界面检查。真实本机初始化故障后，公司端核对零准入并保留原任务，完成后只有一次模型请求、一次原预留和一次费用；待响应启动撤权后所属进程全部关闭且没有新模型请求。三个实际窗口宽度保持无边框、无默认菜单、无可见滚动条和无横向溢出。

This increment passed 91 related controller, 43 actual pinned-Codex, 30 native database/API, three current compilation and six actual unsigned packaged-UI checks. After a real local initialization fault, company services prove zero admission and retain the original task. Completion has one provider request, original reservation and charge. Pending-startup withdrawal closes all owned processes without another provider request. Three native window widths have no default frame/menu, visible scroll rails or horizontal overflow.

具体源码、原始失败和最终结论见[检查点](../quality/startup-recovery-checkpoint-128.json)、[恢复边界检查](../quality/desktop-startup-recovery-review-128.md)和[原始证据归档](../quality/startup-recovery-evidence-128/index.json)。模型回答继续按用户授权使用假数据；原生对话框选择为测试输入。实际打包只覆盖主任务旅程，完整父子任务、全部崩溃与多节点组合、正式模型、签名安装和完整专业角色继续列入[编号待办](../quality/remaining-work-stage128.md)。阶段127及更早的原始记录保持原样。

The checkpoint, recovery-boundary review and original evidence archive bind these conclusions to exact sources and retain earlier failures. Model responses and native-dialog decisions are synthetic as authorized. The packaged journey covers a main task. Complete parent/child workflows, crash/multi-node combinations, live providers, signed installation and full professional roles remain in the numbered open-work ledger. Earlier stages retain their original records.
