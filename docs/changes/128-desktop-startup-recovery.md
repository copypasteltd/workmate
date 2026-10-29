# 本机启动安全恢复 · 阶段128 / Safe local startup recovery

Desktop 在轮次提交前发生原生启动传输故障时，现在可以安全恢复一次。公司端先撤销旧凭证并隔离旧请求，核对全部持久准入记录，再为同一任务发放第二次启动凭证。本机主进程必须先完成旧进程、锁和工具资源清理，并再次确认客户权限。原任务、预算预留、worker attempt 和绝对截止保持一致。

Desktop can recover one classified native startup transport failure before submitting a turn. Company services revoke old authority, fence delayed requests and prove zero durable admissions before issuing the second credential for the same task. The local main process first drains the old process, lock and resources and rechecks customer consent. Task, hold, worker attempt and absolute deadline remain.

| 编号 / ID | 本轮实现 / Change | 验证范围 / Qualification |
| --- | --- | --- |
| 128-01 | 服务端两阶段恢复、原任务隔离代次及零准入证明 / Fenced two-phase recovery and zero-admission proof | 原生 SQL、实际 API、并发同键和重复恢复 / Native SQL, actual API, identical-key concurrency and replay |
| 128-02 | 轮次准入屏障与旧模型/工具请求拒绝 / Turn gate and rejection of old model/tool requests | 未准入零请求、旧凭证失效、旧工具代次拒绝 / No pre-turn requests, invalidated credentials and old tool epochs |
| 128-03 | 主任务和工作流子任务使用相同安全恢复逻辑 / Shared recovery for main and child tasks | 控制层验证原任务、一次恢复、一次轮次与一次结算 / Controller original-task, one-recovery/turn/settlement checks |
| 128-04 | 初始化、建会话、恢复会话故障和第二次失败上限 / Initialization/start/resume faults and two-launch limit | 固定 SHA 的实际 Codex、传输断线、真实超时及所属进程退出 / Pinned native Codex, disconnect, real timeout and owned-process exit |
| 128-05 | 丢失响应重取原结果，未知启动与清理失败拒绝重做 / Retrieve lost responses; refuse unknown launches and failed cleanup | 持久日志、原请求键、撤权及换账号边界 / Journal, original key, withdrawal and identity boundaries |
| 128-06 | 双语重连提示、完成回答不重复展示及原费用记录 / Bilingual reconnect feedback, one displayed final answer and original receipt | 新目录包、实际无边框窗口、截图、GIF、MP4 / Fresh package, actual frameless window and captures |
| 128-07 | 向前 SQL133 及六端双语安装说明 / Additive SQL133 and six bilingual setup guides | SQL001–132 保持原样，版本准入升级为133 / SQL001–132 preserved; API admission advances to133 |
| 128-08 | 保留原始失败、更新编号待办并普通推送 / Preserve failures, update numbered work and use ordinary pushes | 检查点、证据归档与远端 SHA 回读 / Checkpoint, archive and remote SHA readback |

所有运行结论以[最终检查点](../quality/startup-recovery-checkpoint-128.json)及匹配源码的原始记录为准。当前使用用户授权的假模型数据及原生授权对话框测试选择。实际打包旅程覆盖主任务；完整父子工作流、多节点/全部崩溃组合、正式模型、签名安装与专业角色整体验收继续开放。

Final runtime decisions are recorded in the matching-source checkpoint and immutable raw executions. Model responses and native-dialog decisions are synthetic as authorized. The packaged journey covers a main task. Full parent/child workflows, all-node/crash combinations, live providers, signed installation and complete professional-role acceptance remain open.
