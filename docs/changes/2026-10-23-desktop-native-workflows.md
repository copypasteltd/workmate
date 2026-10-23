# 本机流程顾问 / Native workflow consultant

Desktop 的流程顾问现在由客户本机的父子 Codex 执行。公司服务管理不可变私有版本、当前身份与内容权限、独立费用预留和使用收据；云端 Worker 与定时任务不会接管本机步骤。首个子集支持最多八步的本机 Codex、人工审批和广告汇总。

客户先授予本机目录与权限，再确认当前顾问对话之外的子步骤预算；遇到人工审批须再次确认具体事项。真实本机开发与 QA 子角色使用独立 Skills、公司工具和推理凭据。SOP、可执行流程 JSON 与恢复说明可私有下载。完整 OS 权限不扩大公司数据或预算权限。

Stop 与撤权的真实检查确认父子进程均退出，等待 10 秒后没有出现已中止命令预定的后续写入。已受理但结果未知的公司工具保留未知错误及费用核对状态，不会为使界面成功而伪造结果。另修复应用关闭与请求落盘竞态：关闭之后不能再启动仍在等待落盘的任务。

SQL094 新增流程版本、读取来源、运行修订、父子绑定与取消传播，不改写 SQL001–093。来源隔离会约束缓存读取、子任务启动、私有交付和明确发布的衍生 SOP。管理员沿用既有权限、MFA、原因和审计控制，预览增加本机版本及运行信息。实际接口清单同步至 428 条，保留此前全部 415 条。

复查还修复了可复用流程遗漏原始外部来源的缺口：每个版本从真实读取账本冻结来源，新会话、派生版本及 SOP 发布继续继承。原文件隔离后首次读取、缓存、子任务和下载均受约束；旧创建任务删除后仍可保留合法可复用流程。来源由数据库计算且不可改写，受控擦除同时清理来源正文。发现缺口后停止了完整回归 17 的驱动，活动第 13 批正常结束并关闭自有数据库；13/17 批共 707 项通过只作为历史部分运行保留。修复后重新执行完整清单及定向、真实父子流程与打包交互，旧通过结果不作为修改后来源逻辑的证明。

当前选定证据：平台 848/848；重叠定向 75/75；真实父子流程 3/3；本机内核 17/17；客户端 56/56；实际打包旅程 19/19。交互包含费用、逐步审批、真实下载、双语重载及实际 800×600 窗口。模型响应、系统对话框选择和部分设计输入明确采用已获授权的假数据；二进制、文件、身份、权限、公司收据、合成及下载字节实际运行。

保留定向 01/02、原生流程 01/02 和完整回归 16 第 10 批的失败证据；原生 01 因夹具误读追加 Skills 消息与错误清理而中断，仅清理其精确 UUID 测试数据库及自有进程，不计验证覆盖。原生 02 暴露核查脚本错误期待取消返回成功，修正脚本后继续保留产品未知结果语义。回归 16 的两处迁移测试仍断言最新版本 93，已仅改为新增版本 94，原财务/历史保留断言不变，并从头重新执行完整清单。当前检查点列出每份原始报告和源码范围；选定的定向、本机父子流程、打包交互与完整回归均执行于来源修复后的冻结源码。独立内核回归仅覆盖未变化的 Desktop 源码，不把旧后端证据当作执行了新增迁移或测试。

Extension 的 31 项产品/构建/测试文件和三项验证器与既有通过记录逐字节相同；仍为 ChatGPT 式 Chrome 原生右侧栏、客户明确选取文件并上传公司云端 Codex，无需 Desktop。本轮没有新增 Extension UI 运行。

18 个角色的本机协议准入不代表全部专业成果验收。18 角色/29 Skill、原 102 REQ/102 TC、NFR、G01–G10 保留；状态仍为 81 部分 / 21 未证明 / 0 完整验收。完整浏览器/第三方应用操作、跨设备与定时本机流程、真实内部模型和完整生产交付继续跟踪。

## English

Desktop now runs the bounded workflow consultant and specialist children on the customer's computer. Immutable private versions, explicit additional child budgets, human step approvals, real local developer/QA files, private SOP/JSON/recovery downloads and company usage receipts are verified. The cloud Worker cannot take over. Stop and revoke terminate both native processes and prevent delayed writes; unknown accepted actions retain reconciliation state and never replay automatically. App shutdown now fences requests still awaiting journal persistence.

SQL094 adds native provenance and immutable versions while SQL001–093 remain unchanged. Source withdrawal governs cached reads and published derivatives. The actual 428-route inventory retains all 415 prior routes. Evidence covers 848 platform, 75 overlapping focused, 3 actual workflow, 17 supervisor, 56 client and 19 packaged-journey checks. Synthetic model/dialog decisions are explicit; binary, filesystem, auth, permission, ledger and download behavior is real. Failed attempts remain preserved. Extension sources/verifiers are unchanged; no new Extension UI run is claimed. Native admission for 18 roles is not full professional or production acceptance; the original 102 requirements and all acceptance gates remain intact.

Review also found and fixed missing external provenance when a saved native workflow was reused in a new session. Database-computed immutable snapshots now retain original inputs through derived versions and published SOPs, without requiring the creator task to live forever. First reads, cached calls, child admission and downloads reject withdrawn sources. Control17 was superseded after 13/17 batches and 707 passing cases, with its active batch finishing and closing its database normally; this partial run is retained, not counted as a current full regression. The selected full, focused, native-workflow and packaged-UI proofs were rerun after the correction.

[设计](../technical/76-desktop-native-workflows.md) · [检查点](../quality/desktop-workflow-checkpoint.json) · [真实交互 GIF](../design/implementation/workmate-local-21-local-agent.gif)
