# 阶段 122：Codex 启动恢复与轮次隔离 / Codex startup recovery and turn isolation

本轮属于原有需求的实现修复，不新增需求编号，也不将原始 102 项完整验收自动关闭。公司网关继续使用客户已授权的假数据。此前一次原生初始化超时的根因仍未证明。

| 编号 / ID | 已实现 / Implemented | 验证范围 / Verification |
| --- | --- | --- |
| 122-01 | 云端只允许在 initialize 超时或连接丢失、零模型请求、网关撤销及旧进程实际关闭后恢复一次；沿用原任务期限与权限。 | 真实锁定 Codex，含实际 60 秒超时、进程终止、两次失败、取消、明确拒绝、已提交线程／模型、清理失败和原期限耗尽。 |
| 122-02 | 云端及 Desktop 工具、用量、输出和完成事件绑定当前线程／轮次；Desktop 不让延迟消息归属于新任务。 | 不同线程／轮次、初始化期间、异常调用标识及 namespace；真实合法工具流程和持续会话继续验证。 |
| 122-03 | Desktop 保留原生完成通知处理丢失的 turn/start 响应；RPC 诊断去除原始错误内容。 | 实际原生管道丢弃响应，核对单次推理及单次完成；注入嵌套敏感错误内容并核对诊断。 |
| 122-04 | Desktop 新检出目录的测试入口先构建 Native Host，补齐原先依赖旧打包产物的问题。 | 首轮 179／180 的原始失败保留；修复后 180 项单元及 25 项原生测试通过。 |
| 122-05 | Web／Desktop 对连接故障与恢复增加繁中／英文活动提示，沿用原任务操作身份。 | Web 原有 20 项单元测试、类型与构建通过；实际打包 Desktop 登录、任务、费用、撤权与退出流程通过。 |
| 122-06 | 同一 Worker／费用预留的回归及实际页面媒体归档，并维护双语 README 与发布证明。 | 详细计数、原始日志、源文件摘要及真实打包媒体以本轮 checkpoint／证据索引为准；原子推送结果以发布器回执为准。 |

实际打包 Desktop 的 8 项检查已通过。新增 6 张 PNG、1 组 GIF／MP4；原生窗口 1440×980、1280×800、800×600 下均检查无可见滚动条与横向溢出。客户本机 Codex、文件改动和服务器账本真实执行；Image 2／模型输出及原生确认对话框决定为明确模拟。检查结束已关闭本轮创建的浏览器、页面、Electron、API 和数据库。

The cloud runtime may restart initialization once only after a zero-dispatch timeout or lost connection, gateway revocation and confirmed process closure. It keeps the original task, deadline, worker authority and funding source. Later thread/turn failures are not replayed. Desktop remains a customer-local Codex application with explicit revocable local permission; the extension remains a separate cloud Side Panel client.

Protocol messages are bound to their exact thread and turn. A lost Desktop turn/start response can still resolve from the actual native completion, while nested native error contents stay out of diagnostics. Fresh-checkout tests now build the Native Host explicitly. The first failed run remains archived; 12 cloud native, 180 Desktop unit, 25 Desktop native and 20 Web unit checks passed in their stated scopes.

Eight actual packaged Desktop checks produced six screenshots and one GIF/MP4 pair, covering local execution, exact fixture billing, permission revocation, custom frameless controls and three window sizes. Native processes, files and the database are real; company model/media replies and native dialog decisions are synthetic fixtures. Owned browsers and services were closed after the run.

阶段 121 的 112 个完整文件／1388 项后端回归保留其原始源码范围。本轮不声称重新完成全量后端回归、真实供应商专业效果、签名生产发行、完整人工安装与操作系统矩阵，或客户业务接受。完整要求仍见[全部编号需求](../quality/remaining-work-stage121-published.md)；本轮新证据见[技术约束](../technical/122-codex-startup-and-turn-isolation.md)。

本轮保留两次账务专项失败：首次相关整批 79 项中 78 项通过、1 项超时取消；首次独立复现 0／1，任务状态为 failed。分离真实数据准备后，加入安全阶段诊断的独立复现 1／1 通过，核心恢复／账本断言约 13.6 秒，仍使用 120 秒上限。前两次失败的确切根因尚未证明，不能由后续成功推定修复；完整相关文件重跑结果以本轮 checkpoint 为准。

Two initial billing attempts remain in the evidence: 78 of 79 passed with one cancellation, followed by an isolated task failure. A later isolated run with sanitized phase diagnostics passed, with about 13.6 seconds for recovery and ledger assertions under the same 120-second bound. Earlier causes remain unproven. The checkpoint records the subsequent complete related-file result without rewriting those failures.
