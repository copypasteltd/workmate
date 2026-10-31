# F147 最终独立静态反证 v5：本机授权读锁与心跳竞争

日期：2026-10-31。工作区：`D:\dev\copypasted\自有agent\`。

## 结论与证据范围

本次仅静态阅读冻结后的源码、迁移及新测试，没有执行服务、测试、浏览器或模型，没有修改产品、测试和旧报告。未找到这次锁调整引入的具体功能阻断。UI07 已观测到的“心跳持有来源排他锁、等待本机任务锁，任务所有者再读来源 manifest 遭遇 NOWAIT 冲突”在当前源码中有对应修复；新增测试明确构造了这一等待顺序。

这是一项静态结论。backend09 的 92 项通过对应旧锁源码，不能作为当前字节的运行证据。本报告不声称 backend10、UI08 或原生 Codex 第二轮 Responses 已通过；这些结果须由当前版本的实际运行另行确认。

## 1. 授权读锁与写入锁的边界

| 编号 | 核查对象 | 当前证据与判断 |
| --- | --- | --- |
| V5-01 | 授权读取来源 | `dev/copypaste-platform/src/task-local-handoffs.ts:99` 的 `lockLocalHandoffParent` 先读取不可变的原任务绑定，再对 parent（104）、用户（105）、handoff（108）依次取得 `FOR SHARE`。该 helper 不更新来源、revision、费用或任务绑定。两个授权读取事务可以并行，且与来源 manifest 的 SHARE 锁相容。 |
| V5-02 | 正式接收本机任务 | 同文件 `admitLocalHandoff:113` 仍调用 `load(..., true):115`。`load:41` 经 `parentAccess:29` 对 parent 使用 UPDATE（31），再对 handoff 使用 UPDATE（46），并锁 dependency（48）。绑定设备、原生 family、工作区、runtime，以及 prompt/role/budget/revision 的核验没有被共享读锁替换（116–130）。 |
| V5-03 | 正式撤回与回传 | cancel 路由在 212 行、complete 路由在 231 行仍调用 `load(..., true)`，随后才锁 child（216、236）。正式撤回必须等待授权读者释放 parent/handoff 的 SHARE；获得写锁后仍精确取消 child、修改 handoff 状态和 revision（217–219）。回传仍检查已完成且已结算的 child、当前来源及原 dependency，再原子完成 handoff 与输入解析（237–245）。 |

因此，没有将正式来源变更降为可与授权读取并行的普通读操作。当前排序为来源 parent → 用户 → handoff → 本机 child → execution；helper 的 SHARE 与写流程的 UPDATE 仍互斥。

## 2. 原生推理、工具与心跳的锁序

| 编号 | 真实入口 | 先来源、后本机任务与 execution 的证据 |
| --- | --- | --- |
| V5-04 | 统一原生控制路径 `own(..., lock=true)` | `dev/copypaste-platform/src/desktop-executions.ts:269` 先通过 hint 调用 helper（277），再锁 task（281–285）和 execution（290–294）。心跳真实路由通过此路径进入（1081），随后执行当前授权检查（1083）。 |
| V5-05 | 每次推理请求与实际 dispatch 前的授权 | `inferenceAuthority:381` 内的 `check` 先调用 helper（385），再锁 task（388）、execution（392），核验 fencing 与启动授权（396–399）。同一 `check` 用于请求 admission（426–429）并传给 provider permit（435–440）。`src/provider-request-control.ts:344` 的实际 dispatch 会再次执行该授权函数（347），之后才分配生成预算并登记 dispatch（351–369）。 |
| V5-06 | 公司业务工具授权 | `desktop-executions.ts:481` 的工具 authorize 先调用 helper（483），再锁 task/execution（486、490），验证 fencing、创建者并执行完整 authorize（494–501）。工具中的推理也走上述 `inferenceAuthority`（503）。 |
| V5-07 | scoped HTTP inference 预检 | 同文件 1264–1269 行先取 hint 并锁来源，随后才锁 task/execution（1272、1278），再验证 credential、启动权限和当前授权（1282–1285）。这覆盖 UI07 第二次 Responses 进入的 HTTP 入口。 |

上述改动消除了已定位入口中“先持 child，再请求 helper 的来源锁”的相反顺序。helper 的来源读锁也不再阻断另一个授权事务的 SHARE manifest。其他用于处理未知消费或失联任务的本机 task 写锁，不被本报告当作已获模型执行权限的入口。

## 3. 当前来源、身份与费用没有被缓存放行

`desktop-executions.ts:302` 的完整 authorize 仍验证原生 session/family、当前 session 撤回状态（318–324）、角色与 skill（326–329）、当前执行计划（330–336），并在 337 行调用 `assertTaskContentSources`。运行状态、取消标记、内容状态、lease/credential 到期（359–367）及真实 reservation（368–376）仍逐项检查。推理授权还精确匹配 tenant/project/actor、attempt/fencing、capability version 与模型别名（415–424）。本次共享锁没有增加身份重绑、放宽额度或重新创建 reservation 的路径。

来源检查也不只依赖 helper 返回成功：`migrations/141-task-local-handoffs.sql:67` 的 `local_handoff_source_tasks` 校验 handoff 对应 child、双方 tenant/project/owner、private owner、来源内容有效期、prompt/description hash、role/budget，以及 working 状态下当前 pending dependency/version（76–86）；`migrations/143-task-scoped-uploads.sql:75` 将 parent 原有 auth version 与当前 active 用户绑定继续注入该检查（78–80）。141 的 manifest hook 将 handoff 与原任务加入来源核验（96–108）。

`migrations/099-confirmed-creative-feedback.sql:228` 所定义、后续迁移扩展的锁函数先生成 manifest（232），再取得 SHARE/NOWAIT 来源锁（233–235），最后重新检查来源可用性（237）。`src/task-content-sources.ts:7` 对失效来源返回 `TASK_SOURCE_REVOKED`（11–17），只把真实锁冲突映射为 `TASK_SOURCE_BUSY`（24–28）。正式撤回后的新请求不会因 helper 使用 SHARE 而继续授权；与真正写操作竞争时仍可能短暂等待或被拒绝，这是来源变更的保护边界。

## 4. 新并发测试实际覆盖的事实

文件：`dev/copypaste-platform/tests/task-local-handoff-concurrency-147-v1.test.ts`。

| 编号 | 测试与构造 | 可以证明的回归范围 |
| --- | --- | --- |
| V5-T1 | 48 行起：持有真实 helper 事务，未释放前并发运行来源 manifest、真实 project-configuration GET 和 heartbeat POST（54–58），要求响应成功（59–62）。 | 旧 helper 的排他锁会使另一个 manifest 的 SHARE/NOWAIT 冲突，或使心跳等待读者释放。新测试要求这些读取在 holder 提交前完成，直接检验读锁兼容性。 |
| V5-T2 | 71 行起：holder 首先取得真实 child UPDATE（78），发起真实 heartbeat（79），通过 `pg_blocking_pids` 观察实际等待（26–33、81），随后由持 child 的 holder 执行来源 manifest（84），再提交并要求同一次 heartbeat 成功（85–88）。 | 明确构造 UI07 的竞争顺序：心跳已通过 parent/handoff helper，但被 child 所有者阻塞；child 所有者再执行 SHARE/NOWAIT 来源读取。这里不是靠偶然调度或固定延迟猜测等待已发生。 |
| V5-T3 | 97 行起：holder 持 helper SHARE（104），发起真实 Web handoff cancel（105），观察写事务等待（107），确认当前读者仍能读取来源（108），提交后要求撤回成功（109–111）。撤回后检查来源读取、配置接口以及带真实 scoped credential 的 Responses HTTP 预检均拒绝（116–124）。 | 检验读锁仍阻止正式撤回提前完成，并且撤回提交后的权限不会继续复用。它覆盖真实 HTTP 预检拒绝，但不涉及成功模型推理。 |

三项均比较 parent/child reservation 的金额不变（36–38、67、93、125），检查仅有一个 child、两条 reservation、无推理或 input-count 请求登记（40–45）；撤回用例还检查 child 已记费用为零及精确 revision（126–127）。fixture 的 provider 只会计数并返回错误，结束时要求调用数为零：`tests/task-local-handoff-fixture-147-v2.ts:13`、32。由此这些测试不会把虚假模型成功算作竞争修复的证据，也不覆盖真实已消费费用的结算成功。

## 5. 交给当前版本资格验证的边界

当前未发现需要阻断本次锁修复的静态反例。上述测试针对真实数据库锁顺序与控制面授权，足以作为已观测竞争的定向回归设计；成功的原生 Codex 后续模型轮次、真实消费记账，以及完整本机处理后回到原 Web 线程，仍以当前冻结源码的 backend10/UI08 运行记录为准。阅读测试源码不代表执行通过。
