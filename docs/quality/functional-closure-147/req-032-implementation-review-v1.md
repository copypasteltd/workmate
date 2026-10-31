# REQ-032 stage 147 implementation review v1

本报告先独立尝试反驳新增流程契约实现，再按主任务明确授权修复已确认的问题。所有操作显式位于 `D:/dev/copypasted/自有agent/`；没有调度浏览器、Docker、WSL、虚拟化或其他 Agent，没有提交／推送，没有编辑迁移141/142、已有测试或资格脚本。

**结论：命名契约的主体实现存在且能沿调用链验证；发现五个具体接入问题。其中四个已在本工作范围修复，Extension 确认内容遗漏交由主任务修复。类型检查通过；五个新增测试尚待主任务独占的原生测试环境执行，不能记作已通过。**

## 权威要求及已确认实现

原 REQ-032 的版本化输入输出要求、PRD 的确认输入输出后复用流程继续有效。阶段147的明确约束见 `docs/requirements/12-workflow-contract-and-local-handoff.md:7–11,16,19`：命名字段和类型、每次运行固定值、客户确认、精确版本、完整保存文本、定时／事件继承，以及撤回后阻断后续读取。技术语法和边界见 `docs/technical/147-workflow-contract-and-local-handoff.md:33–60`。不要求任意条件图或表达式求值。

- `dev/copypaste-platform/src/workflow-contracts.ts:6–41` 声明最多12个 text/number/boolean/file 字段；区分未提供、0、false和小数；拒绝未知字段、错误类型和不可访问的文件。文件保存明确版本、SHA、文件名、MIME、大小，摘要覆盖值及清单。
- `workflow-contracts.ts:44–61` 对执行时输入重新绑定并比较摘要／文件清单；子任务通过 `workflow_binding` 得到同一份值。文件正文和业务值不授予权限或费用。
- `migrations/142-workflow-contracts.sql:8–59` 在数据库约束运行输入不可变、重复触发输入与已批准版本一致、子任务的运行／拥有者／角色／预算与实际流程匹配。`:61–100` 把命名文件加入既有来源追踪。该迁移本次仅阅读，未修改。
- `cloud-workflows.ts:203–271,639–672,724–815` 冻结单次输入，旧请求拒绝更换输入，批准时核对输入摘要并重新检查来源。`desktop-workflows.ts:193–204,220–263` 在真实本机流程路径执行相同绑定；业务输入不变更本机执行位置。
- `workflow-contracts.ts:64–92` 从实际完成步骤的保存文件收集命名输出；文本读完整字节并核对长度／SHA，检查2 MB单文件及4 MB合计边界。前序文件及完整文本交接保留，没有把旧预览当作完整成果。
- `cloud-schedules.ts:181–260,465–558,996–1002,1063–1094`、`cloud-events.ts:152–171,211–276,1237–1243,1300–1346` 在准备、批准和后续触发时继承实际固定输入；事件正文不替换命名输入。迁移142同时约束重复运行插入值。
- Desktop `src/local-workflow.ts:55–86,94–150` 验证输入摘要、分页显示完整输入，再独立确认子步骤费用。授权监视会重新读取版本／摘要，并通过 `local-agent.ts:1351–1358,1513–1555` 的 heartbeat 核对当前来源和原生授权。未发现模型可直接答复这些确认卡的实现。

## 已确认问题与处置

以下源码路径除单独注明外相对 `dev/copypaste-platform/`。行号为本次实际读取位置；修复后的入口列同时给出当前函数名，便于后续核查。

| 编号 | 观察到的具体问题和源证据 | 可复现的业务后果 | 本次处置 |
|---|---|---|---|
| R032-147-01 | `task-private-asset-scope.ts` 原 `:17–25` 只识别前序 `workflow_inputs`，没有命名 `workflow_binding.files`。实际专业读取调用方包括 `analysis-role-tools.ts:161–190`、`editable-design-tools.ts:36–61` 和 `task-business-tools.ts` 的 Image2源读取。 | 合法选择同用户其他会话中的私有CSV或图片作为命名输入；清单可列出，但专业读取返回 NOT_FOUND。 | 已增加精确命名文件分支。实际 workflow_run 必须与当前子任务的 tenant/project/owner/location、run_id、input_hash、values和files一致；只开放绑定的 asset/version/SHA。未开放同用户所有私有文件，未改SQL迁移。 |
| R032-147-02 | `task-business-tools.ts` 原 `:1918–1935,1977–1988` 的 image2_edit 只接受 asset_id，并固定选择 current_version。 | 客户批准v1而素材已有v2时，实际上传到Image2的可能是v2；确认摘要仍显示v1，违背FC147-04。 | 已支持可选 asset_version_id及SHA；存在命名绑定时默认使用该固定版本。多个不同已批准版本必须明确选择，替换版／不匹配SHA在请求前拒绝；源字节继续校验摘要并记录真实读取。未绑定的合法普通图片操作保留原调用兼容性。 |
| R032-147-03 | `task-business-tools.ts:344,1711` 原工具描述和能力过滤只检查前序列表长度。 | 第一步只有命名输入、没有前序步骤时，真实runtime不提供 workflow_inputs，不能消费新契约。 | 两处均同时识别 workflow_binding；最终能力过滤继续要求角色具备 asset.read。此问题同时由独立backend核查发现，没有修改其测试期望。 |
| R032-147-04 | `desktop-workflows.ts` 原 `:216–218` GET只调用 own和run；`desktop-executions.ts:259–299` 的own只检查登录／项目／本机归属，来源检查在另一个authorize中。 | 文件保留期结束后，决策／执行会正确拒绝，但GET仍能返回缓存的命名输入／完整命名文本。 | 新增 `workflow-read-access.ts::assertWorkflowReadAccess`；Desktop GET检查根和实际子任务来源、固定输入、交付版本及完整命名文本。Cloud GET也使用相同检查并隐藏不可用运行。读取已完成执行不要求运行中lease。 |
| R032-147-05 | Extension `src/cloud-schedules.ts:51–106,152–180,195–207` 和 `src/cloud-events.ts:84–123,230–269` 展示步骤／来源／hash并允许直接启用，却没有渲染新增 body.input_binding。 | 客户可勾选“已核对输入”而看不到命名值、false／0或固定文件版本。服务器摘要不能替代实际展示。 | 已即时交给主任务；不在本工作范围改Extension，以免与UI负责人冲突。本报告不把此项记为已修复。 |

## 修复后的读取边界

新增 `src/workflow-read-access.ts` 只做读取授权，不领取执行权、不预留费用、不要求运行中进程或lease。它检查原任务身份／保留期和来源；重新核对命名输入；检查实际产生结果的本机／云端子任务来源；批量验证保留结果中精确文件的当前状态／来源；命名文本重新核对真实保存文件。保存点确保某个不可用运行不破坏整个云端列表事务。修改范围只涉及内容读取和专业输入，未改变取消、账务对账或未知操作重放策略。

## 最终代码及测试清单

产品源码共五项：

1. `dev/copypaste-platform/src/task-private-asset-scope.ts`：命名文件的可信流程范围。
2. `dev/copypaste-platform/src/task-business-tools.ts`：第一步读取工具及Image2固定版本。
3. `dev/copypaste-platform/src/desktop-workflows.ts`：本机运行读取重新授权。
4. `dev/copypaste-platform/src/cloud-workflows.ts`：云端运行读取重新授权。
5. 新增 `dev/copypaste-platform/src/workflow-read-access.ts`：共享读取检查。

新增测试共两项，使用已有fixture，没有修改已有测试、fixture或verifier：

| 测试文件 | 断言目标 |
|---|---|
| `tests/workflow-file-access-147-v1.test.ts`（3例） | 第一子步骤实际拿到命名读取工具；跨会话已选私有CSV可专业读取、未选文件仍拒绝；Image2实际multipart只含已批准旧版字节，换版／SHA错误／未选私有源拒绝；云端已完成输出版本过期后不继续展示缓存文本。 |
| `tests/workflow-native-read-access-147-v1.test.ts`（2例） | 本机GET在待确认阶段重查输入保留期；本机完成后不依赖执行lease仍可合法读取，精确输出过期后拒绝。 |

## 验证及未覆盖范围

- `npm run typecheck` 已实际通过（tsc --noEmit，退出0）。
- 首次直接测试尝试在fixture启动阶段因 `cp_owner` 密码认证失败（PostgreSQL 28P01）停止；5个用例均是hookFailed，未进入业务断言，不能作为5项产品失败或通过。未改.env、未取得／输出密钥，认证失败前没有创建测试数据库。TAP工具输出副本位于 `dev/copypaste-delivery/evidence/functional-closure-147/workflow-file-access-initial-auth-147-v1.tap`，没有覆盖其他运行记录。
- 随后主任务明确要求使用其阶段147独占原生数据库启动器，并由其后续backend／qualifier统一执行这两个新文件。本工作已停止独立重跑，也没有运行资格脚本。
- 当前没有实际生产Image2效果／专业品质验收，也没有声称模拟模型证明真实本机OS操作。多命名字段指向同一图片的不同版本采取显式选择和拒绝歧义；其额外组合尚未单独执行。Extension确认修复及真实三端界面由主任务另行验收。

## 检索及实际阅读记录

已阅读根AGENTS；对实际平台src、migrations、tests、Desktop、Web、Extension及docs报告路径的父目录定向检查没有额外AGENTS。最初递归列出整个dev的AGENTS搜索没有完成，已中止，未将其当作空结果。

定向搜索覆盖 workflow-contracts、native/cloud workflow、cloud schedules/events、task-service、task-content-sources、task-private-asset-scope、专业文件工具及三端契约呈现；实际命中和完整函数调用链构成上述结论。不存在的旧文件名搜索报错均未用作不存在证据。重点实际读段：workflow-contracts全93行；migration142全102行；workflow-handoffs:1–110；desktop-workflows的输入绑定、GET、批准与推进函数；cloud-workflows:203–271,639–815,875–907,930–985,1021–1100；cloud-schedules的准备、批准、输入继承与触发调用函数；cloud-events:126–186,209–276,1121–1360；cloud-event-model:1–114；Desktop local-workflow:1–160；local-agent:1346–1395,1500–1557；Web workflow-contracts全29行；Extension两张批准卡和实际提交调用方；上述专业读取函数和独立测试fixture。未把被工具截断的整段输出声明为连续完整阅读。
