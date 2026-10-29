# 原生 Codex 发布工具闭环 / Native Codex publishing tool flow

本轮修复角色创建入口和发布预览来源追踪两个实际缺陷。继续使用客户已允许的模拟模型与账户；Codex 可执行文件、HTTP 鉴权、数据库、文件处理、工具调用和费用记录真实执行。

## 客户使用逻辑

1. 客户登录并选择项目，从模板创建社交内容角色。公司工具就绪时，不应被误报为尚未实现。
2. 客户连接并明确启用发布账户与项目策略，选择已授权的固定素材版本。
3. Codex 实际加载绑定的发布 Skill，读取当前账户和格式，再根据确切版本及哈希建立预览。
4. 准备操作只能创建 awaiting_confirmation 记录。Codex 读取该操作状态并提示原客户去发布页确认。
5. 客户复核内容、账户和媒体后明确确认，已有服务端协议才允许发送外部写操作。模型工具没有自行确认接口；咨询和计划模式不允许创建预览或准备操作。

~~~mermaid
sequenceDiagram
    participant U as 客户 / Customer
    participant C as 本机或云端 Codex
    participant T as 公司工具 / Company tools
    participant P as 发布页 / Publishing
    U->>C: 指定项目、账户、固定素材和内容
    C->>T: publication_accounts
    T-->>C: 当前账户、格式、策略
    C->>T: publication_preview
    T-->>C: preview_id + payload_sha256
    C->>T: publication_prepare（使用原预览摘要）
    T-->>C: awaiting_confirmation
    C->>T: publication_status（使用原操作ID）
    T-->>C: 等待客户确认，尚未发送
    C-->>U: 提示审阅
    U->>P: 复核并明确确认
    P->>T: 现有客户确认协议
~~~

## 修复内容

| 编号 | 缺陷 | 修复及约束 |
| --- | --- | --- |
| FIX-126-01 | publication.read / publication.prepare 已实现，但未登记在角色入口的工具准入表中，导致新版社交角色创建被拒绝。 | 补齐登记；保留模型、Skill、项目、运行位置与当前权限检查。 |
| FIX-126-02 | 预览来源追踪用素材ID代替素材版本ID，违反 task_source_reads 的版本身份约束。 | 记录真实 asset_version_id 及来源哈希；保留数据库约束，不放宽来源权限。 |
| FIX-126-03 | 模拟提供方缺少完整受控发布决策流程。 | 使用现有严格草稿 schema、当前实际账户与工具返回的真实身份；只准备，不代客户确认。明确模拟草稿标记仅用于可重复开发验收。 |

## 验证范围

原生专项检查覆盖Facebook原PNG、Instagram派生JPEG、咨询只读、计划只读、拒绝多余确认字段。实际调用位置为云端Worker；Desktop本机Codex的四工具组合仍需独立验收。执行完整的四工具顺序，核对实际调用ID、任务／项目／客户归属、固定版本来源记录及哈希、一次费用预留与计费；确认无外部调用，并验证后台不会派发未确认操作。最终通过次数与确切源码以[本轮检查点](../quality/native-publication-checkpoint-126.json)为准。

当前源码专项09通过5/5，完整16文件相关回归10通过155/155，源码未变且所属原生数据库／夹具清理通过。原始专项05通过5/5，独立分析复查07通过12/12。扩大回归06中断且没有最终回执，原记录出现营销分析角色180秒超时；扩大回归08为132通过、1失败，在Facebook的thread/start处达到60秒RPC截止，模型请求和收费均为零。这些旧记录保留原结论；不得用之后的通过覆盖失败或补造缺失的清理回执。

## 启动恢复和费用边界

旧恢复只覆盖initialize，未覆盖提交轮次前的thread/start和thread/resume传输故障。新逻辑仍共享原15分钟执行截止，单次RPC仍为60秒，整个启动流程最多两个Codex进程；没有延长截止时间来隐藏失败。

| 情形 | 处理 |
| --- | --- |
| initialize、thread/start或thread/resume连接丢失／超时，尚未提交轮次，关闭网关后确认模型请求为零 | 完整关闭原Codex和网关后，使用原任务及权限再启动一次。 |
| 发生第二次可恢复故障 | 结束；不同启动阶段共享两次上限。 |
| 明确RPC拒绝、已提交turn/start、已有模型请求、结果未知或清理失败 | 不自动重放。保留现有失败／对账流程。 |
| 客户取消或权限撤销导致原信号中止 | 停止恢复；不得新建Codex进程继续执行。 |
| 恢复成功 | 沿用原worker attempt、fencing token、预算预留及结算身份，提交一次轮次并结算一次。 |

9项独立真实原生故障检查覆盖创建／恢复线程的连接丢失与真实60秒超时、明确拒绝、跨阶段重试上限、清理后取消，以及测试进程PID／可执行文件／创建时间的所属校验。另在完整相关回归中验证initialize和thread/start恢复后的原始账务记录，已完成任务重复调度不会再启动进程。实际运行次数及全套结果仍以最终回执为准。

测试辅助器最初在延迟注入时使用当前时间来核对进程创建时间，导致green02为7/8；现改为捕获实际spawn时间，并以单独原生检查验证错误时间拒绝、原时间允许及进程退出。失败原件和旧辅助器快照保留。底层偶发原生／Windows延迟根因尚未证明；补齐恢复边界不等于证明永久消除启动延迟。

Desktop保持客户本机Codex。对src/local-codex.ts及两个local-agent调用点的检查发现，它在启动异常后关闭并抛错，外层进入失败结算，尚未提供相同的自动启动恢复。该客户端行为仅作源码发现，未完成原生故障注入、修复和费用组合验收，不计入本轮云端恢复资格。

Desktop的下一步还需处理服务端证明：当前desktop-executions在running阶段允许原作用域凭据向公司网关请求模型，publicExecution只返回费用等状态。安全恢复需要在公司端撤销旧网关、排空在途授权并原子核对实际请求记录，同时沿用原任务／预留；当前费用数值不足以证明没有在途请求。主任务及工作流子任务两个本机调用点都应纳入故障和计费验收，客户本机授权撤回后必须阻止重启。

本轮没有新增界面、安装包或视频播放资格；阶段125的界面截图与GIF仍保留其原验收范围。未证明真实提供方、十二个完整专业角色或完整产品交付。

## English

This change fixes two actual admission/provenance defects: implemented publishing tools were absent from template readiness, and preview provenance stored an asset ID where the database requires an immutable asset-version ID. The strict database identity constraint remains intact.

A pinned real Codex process loads its bound Skill and calls accounts, preview, prepare and status. The exact preview ID/hash and original operation ID carry through. Preparation stops at explicit customer consent; ask/plan stay read-only and the model cannot self-confirm. The deterministic development provider uses the existing strict draft schema and actual guarded tool results; only model decisions and provider accounts are simulated.

The native calls in this increment execute through the cloud Worker; the Desktop-local four-tool combination remains separately unqualified. Current native09 passes5/5 and complete sixteen-file related10 passes155/155 with unchanged source and reclaimed owned native database/fixtures. Original05 passes five publishing checks; diagnostic07 passes twelve analysis checks. Interrupted06 has no terminal receipt. Full08 (132 passed, one failed) exposed a pre-turn thread/start timeout with zero model requests and zero charge. Failed results and exact source snapshots are preserved.

Startup recovery now includes initialize, thread/start and thread/resume transport failure only before turn admission and after the closed gateway proves zero provider requests. The original 60-second RPC bound, shared 15-minute deadline and two-process maximum remain. Cleanup completes before retry; rejection, cancellation, unknown/accepted work and turn submission are not replayed. The original worker attempt, fencing authority, reservation and single final charge carry through. Nine native fault checks cover both real timeouts and rejection/cancellation/ownership boundaries; the related full run additionally checks worker billing. Final counts and exact sources are recorded in the current checkpoint.

The first green fault run failed7/8 because the QA helper compared native creation time to delayed suspension time. It now records actual spawn time; a separate ownership test rejects a wrong timestamp and admits the owned process. The underlying intermittent native/Windows latency cause remains unproven. Desktop-local startup has a separate close-and-fail path and is not covered by the cloud recovery qualification. This is not live-provider, new UI/installer/video, twelve-role or full-product acceptance.
