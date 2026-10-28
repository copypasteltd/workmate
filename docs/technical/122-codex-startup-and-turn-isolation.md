# Codex 启动恢复与轮次隔离 / Startup recovery and turn isolation

本轮处理原有 Codex、执行安全、任务恢复和 Desktop 验收项；不新增产品需求编号。阶段 121 的失败记录、源码绑定和发布回执保持原字节。一次原生初始化超时的历史根因仍未证明，不能用后续成功或恢复机制宣称原根因已修复。

## 云端启动

- 唯一内核仍是配置并锁定版本的原生 Codex；不增加其他 Agent 内核、Docker、WSL 或虚拟化。
- 每次 RPC 保留 60 秒超时。一次任务沿用同一个 15 分钟截止时间，初始化恢复不重新计算任务时限。
- 最多启动两次。只有 `initialize` 发生超时或连接丢失、已关闭并撤销第一条推理网关且确认没有模型请求、前一个原生进程及管道已实际关闭时，才允许第二次初始化。
- `thread/start`、`thread/resume`、`turn/start` 和已进入轮次后的失败均不由该机制重放；版本不符、配置不符、RPC 明确拒绝、取消和清理失败也不自动恢复。
- 恢复仍使用原任务、原配置与能力绑定、原 Worker fencing、原预算及服务器实时授权；它不新建业务任务、费用预留或用户操作。
- 诊断只记录 RPC 方法、错误码、尝试编号、耗时、模型请求数及 stdout/stderr 字节数。不得记录原始提示、参数、密钥或运行时 stderr 内容。

## 协议作用域

云端工具请求必须匹配当前线程及当前轮次，且轮次已被提交、工具在注册列表内、调用标识有效。初始化期间、其他线程/轮次或错误 namespace 的请求不能进入业务工具。输出增量、完成和错误通知也必须属于当前轮次。

Desktop 保留本机 Codex、客户完整本机授权和公司权限/费用限制。既有工具授权继续执行；本轮补齐通知的轮次隔离及轮次 ID 一致性，保留原生完成通知解决丢失响应的能力，禁止旧轮次重新绑定当前轮次。

## 验证要求

1. 在受控测试中暂停或终止本次启动的原生 Codex，核对关闭旧进程后才恢复、仍只有一个模型工作轮次和原任务费用。
2. 不更改既有 60 秒 RPC 期限或既有测试期限；需要覆盖完整超时的新增测试可有明确的独立执行上限。
3. 取消、撤权、明确拒绝、清理失败、丢失 `turn/start` 响应、已发生模型请求等情形不能被误判为可安全重放。
4. 注入初始化期间和其他线程/轮次的协议消息，核对工具未执行、输出未污染、当前任务未被错误完成；同时验证真实原生正常工具流程。
5. 复核既有持久会话、用量、继续执行和 Desktop 原生权限测试，更新受影响的客户端文案、实际页面媒体和双语说明。
6. 记录实际通过、失败和未验证范围后再整合发布；不得把协议故障注入、假模型输出或限定验证扩大成专业质量或完整生产验收。

The implementation keeps the native Codex kernel and the original task authority. Only a proven pre-thread, zero-dispatch initialization failure may restart once after the old process and gateway have closed. RPC deadlines stay unchanged and both attempts share one task deadline. Turn, tool, output and completion messages must remain in their current thread and turn. The earlier observed timeout remains historically unexplained; recovery coverage does not prove its original cause.

## 新检出目录的测试准备 / Fresh-checkout preparation

Desktop 的测试入口必须先构建程序守护器、更新守护器和 Native Host；不能依赖此前执行完整打包所遗留的 `dist/native-host.cjs`。首轮在新工作目录执行时，179 项通过、1 项因缺少该文件失败；该失败记录保留。补上 `pretest` 构建步骤后，180 项单元测试及 25 项锁定原生 Codex 测试通过。

The Desktop test command builds the program guardian, update guardian and Native Host before running tests. A clean checkout must not depend on an earlier packaging command leaving `dist/native-host.cjs` behind. The original failed run is retained; the corrected preparation passed all 180 unit tests and 25 native Codex tests.

## 当前已取得的限定证据 / Recorded bounded evidence

| 验证 / Check | 结果 / Result | 范围 / Scope |
| --- | --- | --- |
| 云端原生运行 / Cloud native runtime | 12 / 12 | 10 个新增故障／作用域场景及 2 个原有持久恢复／取消场景；锁定真实 Codex、明确假模型响应。 |
| Desktop 单元 / Desktop unit | 180 / 180 | 原有单元范围及新检出目录 Native Host 准备。 |
| Desktop 原生 / Desktop native | 25 / 25 | 22 个既有原生场景及 3 个新增轮次、丢失响应、脱敏场景。 |
| Web 单元 / Web unit | 20 / 20 | 现有登录返回、精确费用及付费请求身份等范围；恢复事件新增繁英文案。 |
| 实际打包 Desktop / Packaged Desktop | 8 / 8 | 当前打包程序真实登录、本机文件／工具、模拟费用、撤权与退出；三档原生窗口；6 PNG 及 1 GIF／MP4。 |
| 相关后端完整文件 / Complete related backend files | 79 / 79 | 五个完整文件：账务来源、内部网关、请求控制、独立原生恢复账本和既有 SEO 变更；0 失败／取消／跳过，源码一致、私有夹具回收、数据库及端口关闭核对通过。 |

源码整合及八个远端引用同步分别记录，不能由上表推定完成。阶段 121 的完整回归保留其原版本范围；上述结果不代表新的全量后端回归、真实供应商专业效果或原 102 项整体完成。

## 账务夹具与执行时限 / Billing fixture and execution deadline

首轮相关回归记录为 79 项中的 78 项通过、1 项因新增场景达到 120 秒上限取消，数据库及夹具正常回收。该失败报告、原始 TAP 和执行时的源码保持原字节；不能记为全通过。

首次独立复现记录为 0／1，任务返回 `failed`，未得到期望草稿；该次记录也保留。加入测试专用的安全阶段日志后，下一次独立复现为 1／1，确认旧进程实际关闭后恢复，仍只有一个成功轮次和原费用结算，核心断言耗时约 13.6 秒。此前两次失败的确切根因仍未证明，后续成功不能抹去该限制。

新增恢复场景随后移入独立测试文件。真实来源抓取、冻结审核结果、创建私有任务及其费用预留由独立夹具准备并记录耗时；恢复执行及原账本断言仍保留 120 秒上限。既有 18 项 SEO 测试恢复为先前已限定验证的相同字节，另行完整重跑这些测试及账务／网关／请求控制测试；最终结果由 checkpoint 记录。没有提高产品 RPC 或任务期限。

The initial related run recorded 78 passes and one cancellation when the newly added combined-fixture test reached its 120-second limit. That failed receipt, raw TAP and exact source snapshot are retained. A separate test file now times real fixture preparation independently and keeps the recovery/ledger assertions within the original 120-second bound. The existing 18 SEO cases retain their earlier qualified bytes. The checkpoint records the subsequent complete related-file run; none of these changes increases the product RPC or task deadline.

The first isolated attempt also failed to produce a draft. Both failures remain archived with their exact causes unproven. With sanitized test-phase diagnostics, the next isolated attempt passed and recorded approximately 13.6 seconds for recovery and ledger assertions. This passing scope does not establish production startup reliability or explain either earlier failure.

## 交付字节核对 / Delivered source bytes

首次 checkpoint 在写出文件前发现四个既有脚本／源码的主仓库工作副本为 CRLF，而本轮测试快照为 LF。逐文件确认 Git 声明 `text=auto, eol=lf`、无过滤器，且当前已提交 Git blob 与测试快照的 SHA-256 相同后，仅将这四份工作副本恢复为该 Git blob 的 LF 字节。没有更改代码逻辑、原始报告或已封存快照。处理明细见 [换行核对记录](../quality/runtime-startup-line-endings-122.json)。随后对实际交付源码重新核对通过。

The first checkpoint stopped before writing output because four existing working copies used CRLF while the qualified snapshots used LF. Declared Git attributes and actual committed blobs proved that only line endings differed. Restoring those four working copies to the exact qualified Git bytes changed no source logic or retained evidence; the subsequent delivered-source check passed.
