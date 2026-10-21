# CopyPaste 企业 Agent 文档

<!-- stage59-creative-matrices -->
阶段 59 的[营销设计矩阵](technical/59-creative-production-matrices.md)已完成确定性排版子流程：创意 × 语言 × 尺寸最多 60 个独立单元，保存实际 PNG、SVG 与 JSON；失败、修改、重试与费用按格独立。专项 **22/22** 纳入平台 **607/607**（保留原全部 588 项命名测试），实际 Web **10 项**及新打包原生客户端 **13 项**通过。修复了桌面长页面滚动后的弹窗定位，继续无边框、无默认菜单；扩展实际按钮打开/关闭 Chrome 原生 Side Panel，并提供完整设计工作台入口。两库 068→069 各保留 151 张原表全部行摘要及 SQL001–068。新包位于各端 `release/matrices-59-02/`，旧包保留；未签名 localhost 预览不代表安装或生产资格。排版不调用 AI，AI HK$0 不包括原素材上游费用；Codex 委派、专业媒体和字体资格仍独立跟踪。[核查回执](quality/creative-matrix-checkpoint.json)保留全部失败与源码前像，原始 102 项、TC/NFR/G01–G10 的完整条件不变。

阶段 58 的[调用管理与独立核对后台](technical/58-provider-admin-control-and-reconciliation.md)通过专项 **158/158**、全量 **588/588**（保留全部原 559 项测试）、真实构建版 Admin **10 项流程与 29 份严格响应样本**。费用确认、容量释放和原任务唯一结算分别受控；策略、证据、范围与近期 MFA 重新检查。两库 067→068 各保留 144 张原表全部行摘要及 SQL001–067，新七表强制 RLS，不自动授予已有管理员新权限。[核查回执](quality/provider-admin-checkpoint.json)绑定源码与失败记录；原始 102 项、TC/NFR/G01–G10 与实网资格范围不变。

阶段 57 的[逐调用预算](technical/57-per-request-budget-enforcement.md)通过专项 **129/129** 和全量 **559/559**（专项包含于全量），741 份平台来源不变，保留原 546 项测试；类型检查与实际构建通过。文本与图片共用原预留，内部实际计数独立由平台付费，Admin 验证具有运行及每日预算；超额与未知保留实际费用和承诺。两库 066→067 各保留 136 张原公共表全部行摘要与 SQL001–066，未补造历史消费。[核查回执](quality/provider-budget-checkpoint.json)保留失败及源码前像。完整后台策略控制与原始 102 项综合验收继续跟踪；之前 UI/原生报告保留原来源范围。

阶段 56 的 [持久请求与共享限额](technical/56-durable-provider-request-control.md) 通过专项 **116/116** 和全量 **546/546**（专项包含于全量），738 份来源前后一致，保留原 531 项命名测试；类型检查和构建通过。跨进程准入、逐次用量、未知容量、孤立执行恢复及终止帧落盘交接已覆盖。两库增量升级各保留 132 张原公共表完整行摘要及 SQL001–065，未补造历史请求；066 自此不可改写。[核查回执](quality/provider-control-checkpoint.json)保留全部失败和源码前像。本轮没有打开浏览器或客户端；逐调用预算、完整后台策略控制及原始 102 项综合验收继续跟踪。

阶段 55 的 [内部 AI 请求与逐次鉴权](technical/55-scoped-internal-inference-requests.md) 已通过专项 03 的 **112/112**、最终全量 02 的 **531/531**，733 份平台来源前后一致，保留全部原 484 项命名测试；专项与全量重叠，不相加。新增短期 Codex 凭证、逐请求当前权限复查、可信归属、完整流式工具校验和有界请求，图片生成与编辑共用固定规格；首次请求前取消确认零消耗并释放原预留。SQL001–065 保持原字节，实际夹具回收和自建数据库关闭均通过。本轮未打开浏览器或客户端，既有页面与原生包回执保留其原始来源范围。跨 Worker 供应商限额、逐调用预算、完整 102 项需求与 TC/NFR/G01–G10 继续独立跟踪。

阶段 54 的 [用户明确采用专家、模型与费率版本](technical/54-explicit-agent-version-adoption.md) 通过其时完整回归 02 的 **484/484**（729 份不变平台来源，保留全部原 462 项测试），专项 06 的 93/93 与全量重叠；实际构建版 Web 06 为 12/12，新版无边框打包 Desktop 与原生 Side Panel 05 为 11/11，严格补充合同为五项通过。两库 064→065 各保留 131 张原公共表及旧迁移字节和校验值，未补造历史采用事实。新版预览位于各端 `release/adoption-54/`，见 [字节清单](quality/agent-adoption-artifacts-02.json)。以下阶段 53 的结果保留其原始来源范围；完整 102 项需求、TC/NFR/G01–G10 与零个实网合格角色仍继续逐项跟踪。

阶段 53 的 [受控能力配置与发布](technical/53-controlled-capability-releases.md) 已补齐后台配置、验证、独立审批发布和回滚。完整回归 04 通过 **462/462**（726 份不变来源），含全部原 435 项测试；候选 11 的 71/71 与全量重叠。实际后台浏览器 06 通过 11/11、保留 14 张未编辑截图；补充合同 02 通过六项检查。两库 063→064 升级各保留 125 张原公共表的完整行摘要、旧 SQL 与校验值，两个延期测试夹具实际回收，全部本轮自建浏览器与服务关闭。[历史回执](quality/controlled-capability-in-progress-20261021.json)、全部失败及较早源码通过报告保持原样。该阶段当时尚未完成用户可见模型/价格比较与明确采用，后续见上方阶段 54；网关逐请求限制及全部综合验收继续跟踪。下方阶段 52 的 435/435 保留其原源码范围。

阶段 52 历史基线见 [能力版本与任务费率冻结](technical/52-capability-versions-and-frozen-task-pricing.md)：当时平台全量 **435/435**、714 份源码前后一致，其中专项及模板/私人流程 35/35；两个原生数据库升级各保留 124 张原公共表。当时后台配置验证/发布/回滚和用户可见版本确认尚未完成，后续后台实现见上方阶段 53。以下阶段 51 等报告保留其原源码和包字节范围。

阶段 51 的 [限时只读支持与用户授权](technical/51-controlled-read-only-support.md)：真实管理员身份、明确用户/项目/期限、每次读取复查、正文双重条件、撤销与到期清空。当时 14 组支持专项纳入平台 424/424（711 份来源）；实际 Web/Admin 8/8（816 份来源），另有三个原规范端点响应及一份提取 DTO、9 张未编辑截图。062 两库升级各保留 122 张原公共表，001–061 和历史校验值不变。

Desktop 继续无边框、自绘窗口控制且无 Electron 默认菜单；Extension 工具栏打开 Chrome 原生 Side Panel，在右侧设置下实测。当前打包外观 10 项、原生权益 6 项、三端费用 8 项及会话恢复独立核查，见 [原生预览与规则](technical/30-native-window-and-browser-sidepanel.md)。完整 102 项 TC、NFR、G01–G10、安装/签名与生产资格持续逐项跟踪。

此前的 [费用通知与三端账户](technical/50-durable-financial-notifications.md) 保留原事务/outbox 设计与升级证据，当前三端费用复查绑定 817 份来源。原规范和补充合同分别计数，阶段 50 当时的 410/707、808 份来源报告作为历史归档。

VIP 与明确赠额现可在既有后台一次预览、确认及必要的独立审批中整体提交，保留父操作、两个规范子操作、独立到期和唯一赠额参考，见 [原子组合开通](technical/49-atomic-vip-and-explicit-credit.md)。当前完整证据不代替原始 102 项综合验收。

新增不可变方案家族/版本、发佈前冻结比较、独立审批与历史授权固定绑定，见 [方案版本与授权绑定](technical/46-immutable-plans-and-legacy-grant-bindings.md)。方案发佈不自动开通 VIP 或入账；席位及存储的后续实际执行见 [企业容量](technical/48-enterprise-seat-and-storage-enforcement.md)，其他完整商业验收继续保留。

规范授予/续期/替换/暂停/恢复/撤销、个人企业实时合并、严格用户读取及持久权益通知，见 [VIP 生命周期与有效权益](technical/47-canonical-vip-lifecycle-and-effective-entitlements.md)。057 已应用，旧 SQL 不改写；主库首次迁移缺少升级前行快照的限制与原失败保留。

版本：2.0 · 2026-10-20 · 状态：保留 v1.5 需求设计基线，当前产品 0.5.0 增加企业 OIDC 身份、独立邮箱连接证明与跨端授权撤销；六个独立仓库的实现与验收按版本记录。主文档继续在本目录维护。

最新后台增量对齐用户列表、详情及企业列表的严格原规范，新增签名游标、字段/项目范围交集、账本确认扣费、有效 VIP 与实际页面消费者，见 [规范目录与消耗](technical/38-admin-canonical-directories-and-scoped-usage.md)。已有 [账户生命周期与在途控制](technical/37-admin-account-lifecycle-and-inflight-control.md) 继续生效。邀请、成员、完整原生、规范费用/VIP写及全部验收仍按逐项进度记录。

当前 Desktop 无边框与 Chrome 原生侧栏预览已按最新源码重建并复核，补齐桌面权益／通知的限定本地 API，以及共同刷新的实时方案／权益。实际打包界面 10 项、Desktop 单元 25 项、原生权益联调 6 项和源码会话 12 项通过，报告绑定实际测试字节，见 [当前原生预览](technical/30-native-window-and-browser-sidepanel.md) 及 [本轮联调](technical/47-canonical-vip-lifecycle-and-effective-entitlements.md)。完整系统及认证矩阵仍独立待验收。

人工付款已补充凭据登记、独立核实和准确入账，见 [付款证据与充值](technical/44-manual-payment-evidence-and-exact-posting.md)。新增原消费资金来源补偿、原付款退款冻结、独立核实部分付款与剩余未付、未知/差额对账，见 [退款与付款核实](technical/45-source-bound-refunds-and-cash-reconciliation.md)。历史授信来源对账、支付机构、VIP 和综合验收继续保留。

后台现有待审批业务统一使用真实请求、原始游标目录和版本/摘要决定；旧记录升级与实际期限处理见 [统一审批请求](technical/43-shared-admin-approval-requests.md)。完整财务业务、全部后台和综合验收继续保留。

开发与构建根目录固定为 `D:\dev\copypasted\自有agent\`，所有文档统一位于该根目录的 `docs\`。后续命令直接在 D 盘工作区执行，旧入口仅作会话兼容；见 [工作区与路径规范](governance/03-workspace-and-path-policy.md)。

产品服务在港企业，首批为现有客户的 marketing 团队。以统一企业平台支撑云端 Web、Chrome 扩展/原生桥接、完整 Desktop，覆盖营销素材生产、广告及网站分析、SEO/GEO 和重复流程。全部 AI 请求经过公司内部服务器，**Codex 为唯一 Agent 内核**，由 CORE01 固定；实际 Codex 版本与受控 Responses 工具回合已验证；公司内部网关尚待提供配置并真实联调。

当前按用户授权使用明确标识的假数据继续全体系修复，跟踪见 [102 条差异基线与修复](quality/09-implementation-alignment-audit.md)，新实现约束见 [删除、传输、保留及事件](technical/17-erasure-transfer-retention-events.md)。0.5.0 原始离线发布物保留；本次 Desktop 无边框及扩展原生侧栏另行构建客户端预览包，见 [窗口与侧栏](technical/30-native-window-and-browser-sidepanel.md)。

运行前等待并补齐文件或连接、同一任务继续、私人附件和计划来源守卫见 [资料检查点](technical/22-pre-execution-input-checkpoint.md)。模型依赖继续使用获准假数据；不将该子流程计为完整检查点恢复或正式角色资格。

原生画布和设计师工具新增单页 PDF 审阅稿，保留实际源工程和素材版本；格式权限、版本冲突、重复请求与跨端下载见 [PDF 设计交付](technical/26-design-pdf-review-delivery.md)。PDF 为图片审阅稿，不计为完整专业交付资格。

营销数据新增字段映射预览、原文摘要、重复导入保护、未知转化处理、冻结精确指标及实际 CSV/JSON/SVG 下载，见 [营销数据与证据](technical/27-marketing-import-metrics-and-evidence.md)。后续已接入多来源/比较的 AnalysisSpec、真实 Codex 私人报告任务、分页事实工具、固定 HTML/JSON 资产及规范 Snapshot/Evidence 读取，见 [报告任务与冻结证据](technical/28-analysis-report-tasks-and-evidence.md)。CSV/XLSX 固定文件版本和显式更正见 [文件导入与更正链](technical/29-file-imports-and-correction-lineage.md)。正式广告授权、完整官方导出矩阵、语义质量与专业交付资格仍未完成。

**已确认**：内部 API 已上线，支持用户表述的 gpt 6 luna max。准确模型别名、工具协议、图片/视频能力和费用限额仍需真实接口验证。本轮已实现原生平台、Web、Admin、Chrome 扩展与 Windows Desktop；实际范围和未完成项见 [实施清单](technical/12-implementation-and-repositories.md) 与 [当前代码验收](quality/08-enterprise-federation-acceptance.md)。未完成外部平台授权或公司真实模型准入。

## 建议阅读

直接启动及接收本轮源码、安装包和独立 Git 仓库，先读 [代码交付入口](DELIVERY.md)。

本轮开发交付先读 [实际仓库与启动](technical/12-implementation-and-repositories.md) 和 [实际验收与发布边界](quality/08-enterprise-federation-acceptance.md)。原设计中的后台补充先读 [Admin 产品与页面](product/08-admin-dashboard.md)、[后台技术与 AD01–AD10](technical/11-admin-control-plane.md) 和 [权限目录](contracts/admin-permission-catalog.json)。Codex 集成见 [内核与内部网关](technical/02-runtime-and-ai-gateway.md)。视觉方向见 [CopyPaste 品牌规范](product/07-brand-design-system.md) 与 [浅深主题视觉样板](design/brand-preview.html)。业务负责人读 [PRD](product/01-prd.md)、[用户旅程](product/02-user-journeys.md)、[发布路线](product/04-release-and-commercial-model.md)；研发再读 [架构](technical/01-architecture-and-stack.md)、[数据模型](technical/03-data-model-and-lifecycle.md)、[API](technical/04-api-and-event-contracts.md)，测试从 [追踪矩阵](quality/02-requirements-traceability.md) 进入。

范围分为 102 条需求、12 个逻辑模块、24 条用户旅程及 102 个基础验收用例；原先 102 个综合验收用例仍为 not_run，未用本轮局部代码测试替代其完整条件。本轮平台、Desktop 与各客户端的实际测试单独记录。阶段为 M0 验证 → M1 Web 工作台及导入试点 → M2 协作、云端计划与正式连接器 → M3 扩展与本地 → M4 Desktop 及业务扩展。三端属于同一产品，各阶段保留完整长期范围。

Web 主线以自然语言委派、会话中的真实执行、右侧成果/云文件及项目复用组织。详见 [Web 工作台需求](product/05-web-agent-workbench.md)；其依据、竞品端差异及未验证项见 [对标研究](research/01-web-benchmark-workbuddy-accio.md)。多专业团队和基础云端计划属于 Web 设计，逻辑云文件持久化与独占云电脑分开。

## 文档总目录

| 类别 | 文档                                                                                 | 主要内容                                                                |
| ---- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 总则 | [文档地图与维护规则](00-document-map.md)                                             | 权威来源、阅读角色、阶段与变更                                          |
| 需求 | [软件需求 SRS](requirements/01-srs.md)                                               | REQ-001–102、范围和完成条件                                             |
| 需求 | [非功能与服务指标](requirements/02-nonfunctional-and-service-levels.md)              | 性能、资源、可靠性、保留、兼容及设计目标                                |
| 产品 | [PRD](product/01-prd.md)                                                             | 定位、客户、业务价值及产品规则                                          |
| 产品 | [用户旅程](product/02-user-journeys.md)                                              | UC01–UC24，三端、业务闭环、预设角色及后台运营                           |
| 产品 | [信息架构与交互](product/03-information-architecture-and-interactions.md)            | 页面、入口、组件、异步状态与错误                                        |
| 产品 | [发布与商业模型](product/04-release-and-commercial-model.md)                         | 全阶段范围、接入服务、权益和单位经济                                    |
| 产品 | [Web Agent 工作台](product/05-web-agent-workbench.md)                                | 首次使用、会话、角色/技能、云文件、团队及自动化                         |
| 产品 | [预设角色与 Skill 组合](product/06-role-templates-and-skill-presets.md)              | 18 个角色、Codex/Skill/Image 2 组合、输入交付与至少 12 个可用角色的门槛 |
| 产品 | [CopyPaste 品牌与产品设计规范](product/07-brand-design-system.md)                    | 官网同源色系、Logo、字体、组件、两主题、三端与客户作品边界              |
| 产品 | [Admin Dashboard](product/08-admin-dashboard.md)                                     | 16 个页面、完整用户/消耗、人工费用/VIP、全内容控制及八类权限            |
| 研究 | [WorkBuddy / Accio 对标](research/01-web-benchmark-workbuddy-accio.md)               | 26 个官方来源、核心机制、端差异及需求推导                               |
| 研究 | [CopyPaste 官网品牌核查](research/03-copypaste-brand-reference.md)                   | 原始 HTML/CSS/脚本、Logo 资产、实际渲染/字体及浅深截图                  |
| 模块 | [模块目录](modules/00-catalog.md)                                                    | M01–M12 的权威数据及依赖                                                |
| 模块 | [身份、企业与权限](modules/01-identity-workspaces-permissions.md)                    | 角色矩阵、认证和撤销                                                    |
| 模块 | [Agent、任务与记忆](modules/02-agents-tasks-memory.md)                               | 版本、状态机、恢复、授权与持续环境                                      |
| 模块 | [品牌、资产与交付](modules/03-brand-assets-and-deliverables.md)                      | 文件、字体、编辑工程和导出                                              |
| 模块 | [营销生产](modules/04-marketing-production.md)                                       | 生图、排版、视频、特效及语音                                            |
| 模块 | [分析、SEO 与 GEO](modules/05-analytics-seo-geo.md)                                  | 指标口径、证据、观测和创意反馈                                          |
| 模块 | [连接器与流程](modules/06-connectors-workflows.md)                                   | OAuth、同步、模板、定时与副作用                                         |
| 模块 | [Web、扩展与 Desktop](modules/07-web-extension-desktop.md)                           | 三端、设备、目录与浏览器资源                                            |
| 模块 | [AI、用量与运营](modules/08-usage-billing-admin.md)                                  | 能力注册、预算、账本、权益和支持                                        |
| 技术 | [架构与技术选型](technical/01-architecture-and-stack.md)                             | 原生开发栈、边界和部署拓扑                                              |
| 技术 | [Codex 与内部网关](technical/02-runtime-and-ai-gateway.md)                           | 唯一内核、app-server、版本/配置约束、模型映射及真实 PoC                 |
| 技术 | [数据模型与生命周期](technical/03-data-model-and-lifecycle.md)                       | 表、约束、隔离、索引、金额与删除                                        |
| 技术 | [API 与事件契约](technical/04-api-and-event-contracts.md)                            | 认证、幂等、SSE、设备控制及错误                                         |
| 技术 | [本地执行与浏览器](technical/05-local-executor-and-browser.md)                       | 路径、签名、租约、恢复及 tab 清理                                       |
| 技术 | [媒体与数据管线](technical/06-media-and-data-pipelines.md)                           | 图文/视频渲染、指标计算、SEO/GEO                                        |
| 技术 | [安全与权限设计](technical/07-security-and-permissions.md)                           | 信任边界、凭证、出站、支持及数据说明                                    |
| 技术 | [开发实施与交付](technical/08-development-and-delivery.md)                           | 工程组织、原生依赖、19 个主工作包、角色/后台子包及 CI                   |
| 技术 | [运营与故障手册](technical/09-operations-runbooks.md)                                | 排队、上游、设备、费用、恢复与发布                                      |
| 技术 | [前端设计系统集成](technical/10-frontend-design-system.md)                           | 品牌 token、共享组件、主题/字体、原生样板验证                           |
| 技术 | [Admin 控制面与开发拆分](technical/11-admin-control-plane.md)                        | 独立身份、权限、账本/权益事务、内容注册表及 AD01–AD10                   |
| 技术 | [实际开发与独立仓库](technical/12-implementation-and-repositories.md)                | dev 路径、六仓库、真实启动、实现范围与生产配置                          |
| 技术 | [持续专家、会话与记忆](technical/13-persistent-agents-conversations-memory.md)       | 私有归属、五种记忆范围、版本冻结、只读模式和计划批准                    |
| 技术 | [管理员账号生命周期](technical/14-admin-identity-lifecycle.md)                       | 邮箱邀请、本人 MFA、权限委派、停用与会话管理                            |
| 技术 | [云端定时工作流](technical/15-cloud-workflow-schedules.md)                           | IANA 日历、配置/授权冻结、漏跑/重叠、后台控制与删除                     |
| 质量 | [0.5.0 身份与交付验收](quality/08-enterprise-federation-acceptance.md)               | 逻辑回归、真实签名 IdP、打包客户端与交付边界                            |
| 技术 | [企业联邦与原生授权](technical/16-enterprise-federation-and-native-auth.md)          | 邮箱证明、MFA 配置、SSO 撤销和浏览器到原生端                            |
| 技术 | [删除、文件传输、保留及事件](technical/17-erasure-transfer-retention-events.md)      | 假数据依赖、不可逆清理、分片续传、保留策略、SSE 与领取恢复              |
| 技术 | [持久云文件](technical/18-persistent-cloud-files.md)                                 | 四类作用域、固定引用、持久源码和独立共享                                |
| 技术 | [项目技能](technical/19-project-skill-lifecycle.md)                                  | 精确安装、版本绑定、安全撤销与权益复查                                  |
| 技术 | [站内通知](technical/20-in-app-notifications.md)                                     | 最终状态、接收者隔离、分页与跨项目定位                                  |
| 技术 | [默认助手与首次委派](technical/21-default-assistant-and-first-delegation.md)         | 无需自建专家、私人会话、原子预留与明确版本采纳                          |
| 技术 | [用户明确采用版本](technical/54-explicit-agent-version-adoption.md) | 默认助手、专家与会话的模型/强度/费率比较、明确确认及三端验证 |
| 技术 | [内部推理请求约束](technical/55-scoped-internal-inference-requests.md) | 短期范围凭证、逐次权限、完整流工具校验、图片规格与已知费用 |
| 技术 | [58 调用管理与独立核对](technical/58-provider-admin-control-and-reconciliation.md) | 策略发布、费用与容量独立审批及原任务结算 |
| 技术 | [59 营销设计矩阵](technical/59-creative-production-matrices.md) | 独立单元、真实排版、重试、权限与派生删除 |
| 技术 | [57 逐调用预算与平台费用](technical/57-per-request-budget-enforcement.md) | 原预算分配、实际输入计数、平台验证预算及结算事实 |
| 技术 | [持久请求与共享限额](technical/56-durable-provider-request-control.md) | 跨进程准入、速率、用量事实、未知容量与逐次预算后续要求 |
| 质量 | [全体系需求差异复查](quality/09-implementation-alignment-audit.md)                   | 不可覆盖的 102 条基线、契约漂移、修复证据与未完成条件                   |
| 历史 | [0.4.0 云端计划验收](quality/07-cloud-schedule-acceptance.md)                        | 上一版本的定时流程与证据                                                |
| 质量 | [0.3.0 身份历史](quality/06-admin-identity-acceptance.md)                            | 邀请、本人 MFA、账号/会话控制及当时原始证据                             |
| 质量 | [0.2.0 历史验收](quality/05-persistent-work-acceptance.md)                           | 持续专家、私密会话与记忆的历史检查                                      |
| 质量 | [0.1.0 历史验收](quality/04-implementation-acceptance.md)                            | 上一版本记录，保留原始时间和范围                                        |
| 设计 | [视觉样板](design/brand-preview.html) / [颜色与尺寸 token](design/brand-tokens.json) | 本地交互方向样板与 CSS 变量，非完整产品                                 |
| 质量 | [测试与验收计划](quality/01-test-and-acceptance-plan.md)                             | 分层测试、故障注入及 TC-001–102                                         |
| 质量 | [需求追踪矩阵](quality/02-requirements-traceability.md)                              | 来源 → 流程 → 模块 → 技术 → API → 用例                                  |
| 质量 | [文档审查结果](quality/03-documentation-review.md)                                   | 本轮静态验证及其边界                                                    |
| 治理 | [决策、默认与问题](governance/01-decisions-assumptions-and-questions.md)             | 已确认、设计默认及实施门槛                                              |
| 治理 | [术语与资料来源](governance/02-glossary-and-sources.md)                              | 统一词义、官方来源及验证边界                                            |
| 治理 | [工作区与路径规范](governance/03-workspace-and-path-policy.md)                       | D 盘唯一开发根目录、docs 文档路径、迁移备份和兼容入口                   |
| 契约 | [机器契约与样例目录](contracts/README.md)                                            | OpenAPI、事件/设备/编辑工程 schema 及算例                               |

## 可执行静态核查

使用原生 Python；依赖及重建方式见 [契约说明](contracts/README.md)。在工作区根目录运行：

    python -X utf8 docs/tools/validate_docs.py

结果保存在 [validation-report.json](quality/validation-report.json)。检查本地链接、需求覆盖、OpenAPI 官方 meta-schema、JSON 引用、有效/无效样例、Codex 唯一内核约束及来源追踪、后台独立认证/权限与财务请求结构、公开测试签名、广告指标、品牌来源/配色与指定对比组合。此命令不启动浏览器、服务、Docker 或 WSL。

视觉样板可用原生 Python 运行 `python -B -X utf8 docs/tools/verify_brand_preview.py`，它会启动并关闭自己创建的原生无头浏览器，写入 [样板报告](quality/brand-preview-review.json) 与截图；与完整产品验收分别记录。

## 第一轮来源

下列文件保留早期输入与推导来源，已由上方体系展开；接口、状态、阶段和测试以新版分册为准。

- [第一轮产品需求](01-product-requirements.md)
- [第一轮 MVP 与验证](02-mvp-and-validation.md)
- [第一轮技术依据](03-technical-findings-and-open-questions.md)

## 本次角色预设补充

用户要求拆成 REQ-073–080，新增 [18 个预设角色](product/06-role-templates-and-skill-presets.md)，从软件开发/测试到品牌、平面广告、电商、UI/UX、字体排版、演示、信息图、网页及视频动效；保留营销分析和企业流程角色。「设计师」明确采用 Codex＋设计 Skill＋Image 2，所有 AI 请求经过内部服务器。至少 12 个角色通过真实任务、修改与异常验收后才可计入上线可用数量。

[机器目录](contracts/role-preset-catalog.json)记录每个角色的技能绑定、模型依赖、输入、步骤和交付；此处保留设计快照；实际平台已安装 28 个原创 Skill 包并校验哈希，但逐角色真实业务资格仍为 pending_live_validation，详见实施清单。

## 本次品牌设计补充

BRAND01 拆为 REQ-081/082，取消旧通用配色默认。以官网暖灰白、深墨和亮蓝及现有深色主题，配合真实 Logo、衬线展示标题、无衬线正文、胶囊按钮、圆角细边卡片和轻阴影，统一 Web、扩展、Desktop 与管理页。客户交付沿用客户品牌。官网来源与产品扩展分别登记，完整产品视觉发布执行 G09。

## 本次内核方向调整

CORE01 固定唯一使用 Codex，收敛 REQ-044/075、G01、DEV-02 及所有角色/团队/计划任务的运行配置，取消原双候选评估与适配分支。采用 Codex app-server 的受控集成，发布、实例化、执行和恢复均校验 kernel=codex 及版本；Codex 不可用时修复或按检查点恢复，禁用自动内核回退。全部 AI 仍走内部服务器，现有模型与 Image 2 的要求分别保留。实际内核已经运行 initialize、thread/start 和本地受控 Responses 工具回合；公司网关的真实模型/媒体能力仍待联调。

## 本次 Admin Dashboard 补充

ADMIN01 拆为 REQ-083–102、UC19–UC24 和 TC-083–102；同步 P14/A01–A16、M01/M11/M12、数据/API/权限/运维、AD01–AD10 及 G10。M1 含用户与消耗、人工费用和 VIP、内容/执行控制及细权限审计；M2 完成批量/导出和公开配置发布。管理员可在授权范围主动操作，费用与权益分别记账，所有新调用实时复核。实际后台已有 16 页、独立邮箱/TOTP 登录、范围权限、账务/VIP、内容与配置发布、批量/导出和审计；0.3.0 已补齐邀请、本人 MFA 与账号生命周期；客户支持委托等剩余项按实施清单保留。

## 当前交付证据维护

当前版本实际发布和离线恢复通过后，在根目录运行 `python -X utf8 docs/tools/collect_implementation_evidence.py` 汇总原始报告；[汇总工具](tools/collect_implementation_evidence.py) 核对提交、报告摘要及恢复清单，更新质量 JSON 并保留上一版证据，不改写 102 条计划用例状态。

当前云文件与 Codex 工作源码约束见 [持久云文件](technical/18-persistent-cloud-files.md)。
项目方法安装、版本绑定与即时安全撤销见 [技能生命周期](technical/19-project-skill-lifecycle.md)。当前 102 条需求的原始条件和逐项差异见 [修复进度](quality/requirements-alignment-progress.json)，局部回归不等同完整产品验收。

企业共用执行槽、当前用户方案、能力容量、同任务自动排队和跨企业交错派发见 [执行容量与公平派发](technical/23-execution-capacity-and-fair-dispatch.md)。

Admin 清理记录的筛选、50 条默认分页、撤权显示及独立原生测试库见 [后台记录与测试隔离](technical/24-admin-record-pages-and-test-isolation.md)。

持久角色目录、预检/实例化、真实 Codex/能力版本及撤销行为见 [模板注册表与运行绑定](technical/25-role-template-registry-and-runtime-binding.md)。Web 与 Desktop 已接入该流程，专业角色资格门槛保持不变。

固定原文件版本的 CSV／XLSX、规范导入 API、显式更正链及来源治理见 [文件导入与更正链](technical/29-file-imports-and-correction-lineage.md)。

首次模型调用前的排队暂停/同任务恢复、Admin 共用守卫，以及真实 Codex 续聊原语和增量费用边界见 [任务控制与原生续聊](technical/31-task-controls-and-native-continuation.md)。已付费步骤恢复仍未完成。

Web、无边框 Desktop 与扩展的设备目录、整族撤销、退出/刷新竞争、离线退出反馈及跨标签清理见 [跨端会话与撤销](technical/32-cross-client-sessions-and-revocation.md)。五个规范用户认证接口、实际三端接入、加密回执、未知响应恢复和多个侧栏的账号边界见 [规范认证与重试恢复](technical/33-canonical-authentication-and-retry-recovery.md)；完整企业身份及全部规范接口矩阵继续独立验收。

规范用户资料、私有工作区初始化、三端消费者迁移与并发孤儿清理修复，见 [用户资料与清理竞态](technical/34-user-profile-context-and-orphan-scan-races.md)。该增量保留首次失败和历史原始回归，不替代完整原生旅程及 102 项综合验收。

规范后台成员变更、管理暂停、当前范围与 MFA、独立审批和不可变策略快照见 [Admin 成员控制](technical/36-admin-membership-control-and-policy-snapshots.md)。用户端严格 Member 契约保持不变；历史未记录策略的操作不补造 UUID。当前成员页面六组复核通过，详见下文；完整后台契约与安装包矩阵继续待完成。

后充值任务结算、实付/赠送/授信来源、实际债务偿还、信用下限和数据库不可变金额校验见 [授信与结算来源](technical/39-billing-credit-and-settlement-provenance.md)。此增量不关闭完整规范费用/VIP 和真实收款对账验收。

真实个人/企业账户、任务付款快照、不可变账务操作者/事件、规范账户和账本读取、完整财务范围拒绝规则见 [账户主体与账务事件](technical/40-billing-subjects-and-financial-event-provenance.md)。所有工作流的付款选择、费用写入与完整 VIP 交付仍依原始契约推进。

## 规范费用操作与实际审批增量

[费用命令与独立审批](technical/41-canonical-fee-commands-and-independent-approvals.md)说明真实个人／企业账户的 gift、原来源 debit、credit-limit、无业务效果预览、独立审批请求／不可变决定及实际后台消费者。原始费用付款、退款、VIP、完整审批目录和验收范围保留，局部通过不视为整体验收。

## 当前成员页面与原生认证恢复

[当前源码复核](technical/42-current-membership-ui-and-native-auth-recovery.md)记录 Web 成员 6/6、Admin 成员 6/6，以及 Web／源码 Electron／MV3 认证和会话恢复 12/12。原问题回执不改写，当前报告绑定前后相同源码／运行文件与实际资源清理，14 张新截图同步各端双语 README。该轮八份新规范响应纳入当时 89/89 检查；不据此关闭完整安装包／SSO／系统／原生成员矩阵及全部 102 项综合验收。

## 后台统一审批当前复核

[统一审批请求](technical/43-shared-admin-approval-requests.md)补齐真实请求身份、原始游标列表与四字段决定、双人当前授权及实际过期。阶段 43 平台全量 303/303，Admin 成员/费用/账户分别 6/6、4/4、5/5，Web 成员 6/6，三端认证 12/12，原规范样本 91/91。原始失败和旧通过快照保留；这些局部结果不等于完整 102 项验收。

## 当前付款证据与入账复核

[付款记录、双人核实与精确充值](technical/44-manual-payment-evidence-and-exact-posting.md)增加原凭据/主体/模式检查、另一人核实、精确付款唯一入账、授信偿还及实际页面状态刷新。最终平台 310/310（676 份来源一致）、费用页面 5/5、三端源码认证 12/12、规范样本 96/96；首次全量及迁移/页面失败均保留。完整退款、VIP、支付机构、全部 102 项及发布门继续单独跟踪。
