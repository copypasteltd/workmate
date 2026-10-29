# Desktop 启动恢复边界检查 / Desktop startup recovery review

本表记录本阶段必须验证的约束。下面的代码位置是实现位置，不代表已经通过运行验收；最终结论必须由对应源码的原始执行记录证明。之前的失败、取消、超时及限定验收范围保持原样。

The locations identify implementations, not successful qualification. Final decisions require immutable executions of the matching sources. Earlier failures, cancellations, timeouts and bounded qualification remain unchanged.

| 编号 / ID | 必须成立的约束 / Required invariant | 实现位置 / Implementation | 运行证据 / Runtime evidence |
| --- | --- | --- | --- |
| REC-128-01 | 新客户端先登记轮次准入，才允许模型与公司工具请求 / Admit the turn before provider or company-tool requests | backend desktop-startup-recovery / desktop-executions | 已通过：原生 SQL/API 30项；未准入模型与工具请求被拒绝 / Passed in native SQL/API qualification. |
| REC-128-02 | 旧凭证与晚到旧请求无法进入新代次 / Old credentials and delayed requests cannot enter a new epoch | 原任务行锁、隔离代次及工具请求代次 / Task locks, fencing and tool envelope | 已通过：旧凭证401、旧工具代次409、并发恢复只生成同一代次 / Passed: invalidated credential, fenced tool and concurrent identical recovery. |
| REC-128-03 | 零收费不能替代零准入；输入计数和只读工具也会阻止重试 / Zero spend does not prove zero admission; counts and read-only tools also block replay | SQL133 desktop_startup_admission_proof | 已通过：模型、输入计数及只读工具的零收费准入均阻止恢复 / Passed: zero-price durable admissions still prohibit replay. |
| REC-128-04 | 同一任务最多两次启动，原 worker attempt 不增加 / At most two launches with the original worker attempt | SQL133、恢复记录和本机启动日志 / SQL133, recovery receipt and local journal | 已通过：91项控制层、43项真实Codex及30项SQL验证两次上限 / Passed in controller, actual native and SQL scopes. |
| REC-128-05 | 不新增任务、预算预留或扣费身份，不延长原绝对截止 / Preserve task, hold, charge identity and absolute deadline | 同一任务恢复及 startup_deadline_at / Original-task recovery and deadline | 已通过：SQL原任务、原预留、单次扣费及截止不可延长 / Passed: original task/hold, one charge and immutable deadline. |
| REC-128-06 | 只有确切原生启动传输故障、且清理完成后才恢复 / Recover only a classified native startup transport fault after cleanup | LocalCodexStartupFailure / LocalStartupCoordinator | 已通过：真实Codex初始化、建会话、恢复会话断线及真实超时，所属进程全部退出 / Passed with actual pinned Codex and verified cleanup. |
| REC-128-07 | 明确拒绝、协议或配置异常、清理失败及已提交轮次都不自动重放 / No automatic replay of rejection, invalid configuration/protocol, cleanup failure or admitted work | 分类错误、轮次准入与 journal / Typed failure, turn admission and journal | 已通过：控制层错误分类、清理失败、已准入轮次及真实原生拒绝路径 / Passed within the recorded controller/native cases. |
| REC-128-08 | 客户撤权、换账号、父任务撤销或公司权限失效阻止新进程 / Local withdrawal, account change, parent cancellation or company revocation blocks a new process | 本机 assertOwner、signal 与服务端 authorize / Local owner/signal and server authority | 部分验证：撤权、换账号及服务端取消/归属/项目拒绝已覆盖；父子及多节点全部竞争矩阵仍开放 / Partial; complete parent/child and multi-node races remain open. |
| REC-128-09 | 重复及丢失响应只返回同一恢复，不追加代次 / Duplicate/lost responses retrieve the same recovery | request_key、request_sha256 与持久恢复意图 / Request identity and durable intent | 已通过：SQL并发同键、改键拒绝，以及控制层丢失响应取回原结果 / Passed in SQL concurrency and controller lost-response cases. |
| REC-128-10 | 崩溃后未知的旧启动不再创建进程；仅未启动的恢复结果可取回 / Unknown journaled launches cannot spawn; an unlaunched pending recovery may be retrieved | launchAttempt 与 pending recovery journal | 已通过限定日志用例：未知启动拒绝再次创建，未启动的pending结果可取回；完整崩溃矩阵仍开放 / Bounded journal cases passed; full crash matrix open. |
| REC-128-11 | 主任务和工作流子任务都保留各自原预留，并重查父任务 / Main/child tasks keep their original holds and children recheck the parent | 两个 LocalStartupCoordinator 调用点 / Both coordinator paths | 部分验证：主任务和子任务控制层恢复用例均通过；实际完整父子工作流恢复仍开放 / Both controller paths passed; complete actual parent/child recovery remains open. |
| REC-128-12 | 客户端不持久化推理凭证，界面展示清楚的恢复和停止说明 / No persisted scoped credential; readable recovery/stopped feedback | journal 元数据和双语界面 / Journal metadata and bilingual UI | 已通过：恢复日志不含凭证；实际打包04验证正在重连、单次回答和撤权后明确停止提示 / Passed: credential-free journal and actual packaged attempt04 recovery, single answer and readable stopped feedback. |

## 原始范围 / Original scope

Desktop 仍在客户电脑运行 Codex，并遵守客户本机授权。Extension 仍是云端 Agent 与明确确认的文件上传、原生浏览器右侧栏。本轮并不替代十二个专业角色、营销业务、Admin、Extension、签名安装或完整产品验收。

Desktop remains customer-local Codex with customer-owned local consent. Extension remains cloud execution plus explicitly reviewed uploads in the native right Side Panel. This increment does not replace full role, marketing, Admin, Extension, signed-installation or product qualification.

当前依据为控制层 probe12、原生 probe13、SQL backend07 和当前编译 probe15。执行代码保持一致；后续只修改的渲染文案由当前编译及实际打包界面验证，SQL测试断言由最终SQL记录验证。所有先前失败与各自源码保持原样。最终发布以[检查点](startup-recovery-checkpoint-128.json)和[完整归档](startup-recovery-evidence-128/index.json)为准。

Current evidence uses controller probe12, native probe13, SQL backend07 and current compilation probe15. Execution sources remain identical; current compilation and packaged UI qualify the presentation changes, and the final SQL run qualifies its corrected assertion. Every earlier failure and source snapshot is retained.

实际打包04的6项交互检查通过，所属浏览器、Electron、API、原生数据库和模拟服务均关闭。人工检查三张原始截图：蓝色与浅底品牌风格、恢复说明、单次回答及撤权说明清楚；1000/1240/1440宽度的原生窗口检查均无默认边框、菜单、可见滚动条或横向溢出。这只覆盖本轮主任务旅程，父子任务完整恢复和全部崩溃组合继续开放。

All six packaged attempt04 interaction checks passed, and owned browser, Electron, API, native database and synthetic-provider resources closed. Visual review of the three original screenshots confirms the blue/light brand treatment, readable recovery/withdrawal feedback and one answer. Native widths 1000/1240/1440 have no default frame/menu, visible scroll rails or horizontal overflow. This covers the recorded main-task journey; complete child workflows and crash combinations remain open.
