# 音频客户确认与后台治理 / Customer audio confirmation and governance

本阶段延续原始 REQ-021 及音频依赖需求，修复阶段 84 已明确列出的“工具参数不能代表客户独立授权”缺口。原始需求、102 项验收案例、NFR 与 G01–G10 不变。阶段 84 的成功回执保留其历史源码范围；本阶段源码已按新的实际检查点重新核对，失败及成功原始回执均保留；假服务证据不代表原始完整业务验收。

## 客户流程与执行位置

1. 客户登录，选择项目和视频／音频角色，提出配音或转写任务。Web、Chrome 原生右侧 Side Panel 使用云端 Codex；无边框 Desktop 使用客户本机固定版本 Codex。
2. Codex 提交具体音频提案，包含原文或精确音源版本、摘要、实际时长、语言、经验证声音、速度、时间戳要求、用途及公司报价。工具参数中的权利声明只代表提案。
3. 服务端保存不可变提案并等待，客户端展示确认卡。复选框初始不选中，权利依据与用途初始为空。客户核对内容和费用后，在当前有效的登录会话中填写并确认，也可以拒绝。
4. 等待沿用原 Codex 工具调用与任务，不增加音频接口调用，不持有数据库连接，不创建音频作业预留或新的服务容量。原任务已发生的推理用量仍按真实记录计费。
5. 确认固定提案摘要、版本、报价、操作者及其会话；服务端再次检查当前任务、执行租约、角色／技能、能力、来源、权限、原预算和容量，再保存并派发唯一音频作业。
6. 拒绝、五分钟截止、任务停止、来源失效或撤权阻断新的派发。撤回确认同时阻断后续交付和受保护下载；已经派发的真实费用或未知费用保留，不自动重新提交。

Desktop 的完整本机权限由客户主动授予并可撤回。该本机权限与具体音频用途确认分别记录。授权确认过程中本地 Codex 不会切换成云端 Agent。Chrome Side Panel 无须安装 Desktop。

~~~mermaid
sequenceDiagram
    participant U as 已登录客户
    participant C as Web / Side Panel / Desktop
    participant X as 云端或本机 Codex
    participant A as 公司服务端
    participant P as 公司音频网关
    X->>A: audio_produce（固定操作提案）
    A->>A: 保存 pending，尚无音频 POST
    C->>A: 读取本人的提案
    C->>U: 文案/来源、声音、用途、精确费用
    U->>C: 填写依据、用途并明确勾选
    C->>A: 当前会话确认 + 版本/摘要/报价
    A->>A: 确认事实与审计；重验来源/权限/预算
    A->>P: 唯一标准 OpenAI 音频 POST
    P-->>A: 实际 WAV 或完整转写 JSON
    A->>A: 确认公司用量；重验交付权限
    A-->>X: 原工具结果与受保护产物
    C->>A: 受保护预览/版本下载
~~~

## 状态、版本与费用

新增 SQL102，SQL001–101 保留已发布字节。每个原任务最多八个独立提案；相同内容或调用键复用原事实，变更内容不能覆盖旧事实。提案和确认各有摘要，状态转换严格递增版本，事件不可改写或删除。

| 状态 | 允许的后续状态 | 派发与费用 |
| --- | --- | --- |
| pending | confirmed、declined、withdrawn、expired、cancelled | 等待客户，无音频 POST |
| confirmed | withdrawn、cancelled | 截止前且当前会话有效才允许创建／派发作业 |
| declined／withdrawn／expired／cancelled | 不恢复 | 原作业及历史费用事实保留 |

同一授权最多绑定一个音频作业。确认动作校验版本、提案摘要和费用字符串，拒绝宽松字段、错误来源、过期或已撤销会话。固定幂等键重放只返回当前状态，不返回撤权前的“已确认”旧响应。确认入口不暴露为 Codex 工具，内部 Worker 构造的无会话身份不能签署。

撤回时：prepared 作业取消并确认零音频费用；dispatched 作业转为 unknown 并保留原预留；完整有效回答即使迟到也保留实际公司费用，但禁止交付。传输未知不能视为零成本。人工字幕修订仍沿用原音轨，不新增 AI 请求。

升级不补造历史授权。既有完成作业标记为 legacy_model_declaration，保留原有效产物及明确版本修订；旧 prepared 取消，旧 dispatched 转为未知待核对。不能使用旧模型声明继续创建新的原始音轨或原始转写交付。

## 用户、管理员与内容权限

客户接口为项目下 audio-authorizations 的列表、详情及 confirm／decline／withdraw。仅原任务客户可查看和决定；项目同事、企业管理员和平台管理员均不能代签。浏览器会话沿用 CSRF，原生登录沿用 PKCE，所有决定仍校验当前会话及 auth_version。

后台保留独立的 admin.ai.requests.read、admin.ai.cost.read 和 admin.content.body.read：元数据列表不含文案、音源正文或权利依据；费用单独按企业／项目范围返回；敏感正文及确认／审计详情需现有独立内容授权和有效 MFA，读取写入审计。管理员界面提供授权记录、确认摘要、截止和审计查看，不提供替客户确认按钮。

原文、音源和独立确认在原任务删除时擦除正文，保留最小状态、摘要与费用事实。受保护产物继续继承当前来源、隔离、保留期、私有任务、能力和项目权限门控。

## 界面与验证约束

三端确认卡使用现有 CopyPaste 字体、留白、蓝色重点、明暗主题和中英双语。长文案、摘要和来源标识换行，确认表单不使用横向布局溢出。Desktop 隐藏滚动条轨道但保留滚轮、Home／End、Tab 焦点和完整内容访问；真实进度仍可展示。需要验证实际 1440×980、1280×800 和 800×600 无边框窗口，而非仅模拟网页尺寸。

验证需保留原阶段全部音频测试，再增加独立确认、默认未勾选、错误报价／摘要、CSRF、模型代签拒绝、拒绝／超时／撤回、在途费用、已完成后下载阻断、并发预算、当前来源和后台独立范围测试。三端必须用实际登录和实际界面确认，不能通过测试数据库写入“客户已授权”替代交互。

## 仍需完成的原始范围

- 音频能力仍需接入后台完整的能力验证、双人发布与回滚流程；已配置的公司服务端能力不能冒充完整后台管理交付。
- 已派发而结果未知的音频仍需外部费用证据、独立审核、原任务结算和恢复交付闭环。未知提交继续保留费用，不能发明网关查询协议或重放 POST。
- 真实声音质量、香港粤语准确率、声音权利审核和完整专业交付需要各自证据。当前用户授权使用假数据，合成音调和固定转写只能验证接口、逻辑与流程。

## English

Stage 85 adds independent, current-customer-session confirmation before a proposed speech or transcription operation can become a paid audio job. The customer reviews exact copy or an immutable source version/hash/duration, language, verified voice, speed, intended use and frozen company quote. The checkbox starts unchecked; the customer's own rights reference and use start blank. Codex tool arguments alone never authorize dispatch.

The original local or cloud Codex tool waits without holding a database connection, creating a second AI turn, or submitting an audio request. The original task's already-incurred reasoning usage remains chargeable. Confirmation binds the exact proposal, price, version, actor and session; current origin, source, permissions, capability, budget and capacity are rechecked before dispatch. Five-minute deadlines, bounded requests, immutable events, CAS and idempotency prevent silent replacement or revival.

Withdrawal blocks future dispatch and delivery. Prepared jobs cancel at zero audio cost; submitted unknown outcomes retain their holds; validated late responses retain actual company charges while delivery stays blocked. Completed historical results are explicitly identified as legacy tool declarations, never backfilled as human consent. SQL001–101 and their published evidence remain unchanged.

Desktop stays a frameless, customer-local Codex application with explicit revocable native permissions. Web and the native right Chrome Side Panel keep cloud Codex. The confirmation UI preserves both languages/themes and complete keyboard/wheel access without Desktop scrollbar rails or horizontal overflow. Administrators inspect metadata, costs and audited sensitive content under separate scopes; they cannot sign for customers.

This bounded repair does not close original professional acceptance, live voice/Cantonese qualification, managed audio capability release/rollback, or external-evidence reconciliation of unknown audio costs. Current implementation and test outcomes must be bound to a new checkpoint; stage 84 receipts retain their historical source scope.


## 已执行检查 / Recorded evidence

当前平台 **1001** 项覆盖 78 个测试文件与 20 个独立原生数据库批次，保留全部原 **988** 个用例。核心音频/网关/升级 **56**、兼容 **80**、客户端 **124**、实际 Web/Admin/原生右侧栏 **13**、打包本机 Desktop **41** 分别通过。当前选定回执记录的全部源码摘要逐项精确相同，没有将旧快照重新标为当前。见[检查点](../quality/audio-authorizations-checkpoint.json)、[实际画面](../quality/audio-authorizations-visual-review-02.md)、[新增契约](../contracts/audio-authorizations-openapi.json)及[实际 HTTP 校验](../quality/audio-authorizations-contract-08.json)。

实际客户表单默认未勾选、依据/用途为空。Web 和 Side Panel 由原登录客户操作；Desktop 的固定本机 Codex 保持原工具等待，经实际 UI 确认才继续。Desktop 已核对三种实际窗口、真实滚轮/Home/End、焦点及完整末项操作，无可见纵横滚动条；真实进度保留。四组原始 GIF/MP4 记录客户确认流程并完整解码，自建浏览器/窗口/数据库均按回执关闭。

SQL101 已有 prepared/dispatched/completed 数据的真实升级检查验证：未派发取消为零，派发未知保留预留，已完成字节及费用不变；不补造客户确认。审计记录既受普通服务数据库权限保护，也受数据库不可变触发器保护。旧角色 1.3.0、31 个已发布包及原功能断言均保留；新角色 1.4.0、speech-production 1.2.0、总包版本 32 的断言增量另行复核。

第 14 轮核心检查发现新增 Skill 包缺少已审阅目录定义，服务启动拒绝；补齐定义，保持启动校验。第 15 轮发现旧数据测试读取未返回的存储字段、审计测试错误匹配过窄；改为读取实际存储键，并分别验证普通服务权限拒绝和 owner 不可变触发器拒绝。两轮失败原始回执保留，不计入通过覆盖。

第 20 轮兼容性进程中断，没有最终 TAP 汇总、源码核对或资源关闭回执；随后实际查询确认原进程消失且 55432 无监听，才以第 21 轮重新执行。第 20 轮原始日志及核查说明保留，不计为通过，不用于当前覆盖。

另通过真实 PostgreSQL 行锁复现恢复与续租竞争：恢复扫描先读到过期租约，随后等待正在续租的任务锁，旧逻辑会在续租提交后仍取消有效授权。第 18 轮在同一用例实际失败；修复只增加取得锁后的当前期限/任务状态复查，第 19 轮相同测试及其余核心检查通过。第 37 轮完整回归的自动循环在前两批后停止，自建数据库正常关闭；117 项历史批次不充当本次完整回归。后续完整回归另用新编号和新源码，见[真实锁竞争记录](../quality/audio-authorizations-recovery-race.json)。

English: Current evidence binds 1001 platform cases preserving all 988 earlier cases, 56 focused cases, 80 compatibility cases, 124 client tests, 13 actual Web/Admin/native Side Panel checks and 41 packaged local Desktop checks. All selected recorded source hashes match exactly. Real customer forms, native OS window sizes, wheel/keyboard/focus access, original media decoding and owned-resource cleanup are recorded. The populated SQL101 upgrade preserves completed bytes/fees without backfilling consent. Failed attempts remain failed. This evidence does not establish live professional quality or close the original 102-case acceptance.
