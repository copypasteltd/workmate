# 需求追踪矩阵

<!-- stage64-current-report-task-source-fences:start -->
阶段 64 新增原始分析/SEO 任务历史与活动事件流的来源约束证据，见[绑定回执](task-source-checkpoint.json)。原 102 项需求、全部 TC/NFR/G01–G10、81 项局部验证、21 项未证明完成和 0 项完整验收保持不变。原字段与旧失败记录保留。
<!-- stage64-current-report-task-source-fences:end -->

<!-- stage63-source-governed-website-changes:start -->
阶段 63 为 UC05/REQ-029 新增来源治理的修改任务与真实客户端证据，见[绑定回执](seo-change-checkpoint.json)。完整范围保持 102 项需求、全部 TC、NFR 与 G01–G10，81 项局部验证、21 项未证明完成、0 项完整验收。原需求文本、原验收条件与原始发现保持原值。
<!-- stage63-source-governed-website-changes:end -->

<!-- stage62-scoped-seo -->
阶段 62 为 REQ-029 增加受限网站抓取、逐 URL 原文、私有来源治理及不可变复查的局部证据，并补强 Codex、权限、报告和三端入口。见[当前绑定回执](scoped-seo-checkpoint.json)；原始 102 项需求、完整 TC、NFR 和 G01–G10 保留，完整修改任务、GEO、正式网站及整体验收继续跟踪。

<!-- stage61-marketing-connectors -->
阶段 61 对 REQ-004、025–028 的模拟连接子流程增加实际证据，并补强分析来源、权限与 Admin 控制；[绑定当前源码的回执](marketing-connector-checkpoint.json)保留失败记录、原始需求和完整 TC。局部验证不能关闭正式供应商、完整角色或综合系统验收。

<!-- stage60-template-video -->
阶段 60 验证 REQ-018/TC-018 的单模板本地合成子流程，串联独立工程、真实字幕/音轨成片、Web 和无边框客户端、原生侧栏入口、权限与物理删除；[实际证据](template-video-checkpoint.json)绑定实际来源，原始综合验收条件保留。

<!-- stage59-creative-matrices -->
阶段 59 在原 REQ-017/TC-017 条件下验证了本地排版子流程；关联 REQ-012/016/022/048/049/052 的独立输出、权限与删除。原表及原验收条件保持不变，当前执行与剩余项见[矩阵回执](creative-matrix-checkpoint.json)和[增量设计](../technical/59-creative-production-matrices.md)。

版本：1.5 · 2026-10-18。REQ 定义以 [SRS](../requirements/01-srs.md) 为准。本表是设计覆盖，不代表实现完成。

每项完整产品、模块、技术文件、operationId 和用例列表在 [traceability.json](traceability.json)。下表只显示前两个 operationId 以便阅读；同号 TC 的全部用例设计见 [测试计划](01-test-and-acceptance-plan.md)。

| 需求 | 阶段 | 来源 | 流程 | 模块 | 技术主文档 | 接口示例 | 验收 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| REQ-001 · 企业与成员隔离 | P0 / M1 | U01, U02, F01 | UC01 | M01 | [07-security-and-permissions](../technical/07-security-and-permissions.md) | listTenants, createTenant | TC-001 |
| REQ-002 · 品牌及项目权限 | P0 / M1 | U02, U09, F01 | UC01, UC16 | M01 | [07-security-and-permissions](../technical/07-security-and-permissions.md) | listProjects, createProject | TC-002 |
| REQ-003 · 身份和会话 | P0 / M1 | F01, F22 | UC01, UC10, UC12 | M01 | [07-security-and-permissions](../technical/07-security-and-permissions.md) | createAuthChallenge, createSession | TC-003 |
| REQ-004 · 外部授权管理 | P0 / M2 | F10 | UC01, UC04, UC12 | M01 | [07-security-and-permissions](../technical/07-security-and-permissions.md) | listConnections, createConnection | TC-004 |
| REQ-005 · 持续 Agent | P0 / M1 | U02, U06, F02 | UC01, UC13 | M02 | [01-architecture-and-stack](../technical/01-architecture-and-stack.md) | listAgents, createAgent | TC-005 |
| REQ-006 · 分层记忆 | P0 / M1 | F02 | UC01, UC16 | M02 | [01-architecture-and-stack](../technical/01-architecture-and-stack.md) | listMemories, createMemory | TC-006 |
| REQ-007 · 自然语言委派 | P0 / M1 | U03, F02 | UC01, UC13 | M02 | [01-architecture-and-stack](../technical/01-architecture-and-stack.md) | createAgent, getAgent | TC-007 |
| REQ-008 · 持久任务 | P0 / M1 | U02, U03, F03 | UC11, UC13, UC15 | M03 | [01-architecture-and-stack](../technical/01-architecture-and-stack.md) | listTasks, createTask | TC-008 |
| REQ-009 · 恢复与控制 | P0 / M1 | U02, U03, F03 | UC03, UC11 | M03 | [01-architecture-and-stack](../technical/01-architecture-and-stack.md) | getTask, provideTaskInput | TC-009 |
| REQ-010 · 操作授权 | P0 / M1 | F20 | UC05, UC07, UC11 | M03 | [07-security-and-permissions](../technical/07-security-and-permissions.md) | listApprovals, decideApproval | TC-010 |
| REQ-011 · 可追踪执行 | P0 / M1 | F03 | UC11, UC15 | M03 | [01-architecture-and-stack](../technical/01-architecture-and-stack.md) | listMessages, getTask | TC-011 |
| REQ-012 · 产物版本 | P0 / M1 | F02 | UC02, UC13 | M03 | [01-architecture-and-stack](../technical/01-architecture-and-stack.md) | reviewArtifacts, createComment | TC-012 |
| REQ-013 · 品牌资料 | P0 / M1 | U08, U09, F05 | UC02 | M04 | [06-media-and-data-pipelines](../technical/06-media-and-data-pipelines.md) | listAssets, createBrandVersion | TC-013 |
| REQ-014 · 文件传输 | P0 / M1 | U08, F05 | UC02 | M04 | [06-media-and-data-pipelines](../technical/06-media-and-data-pipelines.md) | createUpload, completeUpload | TC-014 |
| REQ-015 · 生图与限定编辑 | P0 / M1 | U08, F06 | UC02 | M05 | [06-media-and-data-pipelines](../technical/06-media-and-data-pipelines.md) | createTask, createMediaJob | TC-015 |
| REQ-016 · 准确排版 | P0 / M1 | U08, F07 | UC02 | M05 | [06-media-and-data-pipelines](../technical/06-media-and-data-pipelines.md) | createTask, editArtifact | TC-016 |
| REQ-017 · 批量适配 | P0 / M1 | U08, U09, F07 | UC02 | M05 | [06-media-and-data-pipelines](../technical/06-media-and-data-pipelines.md) | createTask, editArtifact | TC-017 |
| REQ-018 · 视频基础生产 | P0 / M1 | U08, F08 | UC03 | M05 | [06-media-and-data-pipelines](../technical/06-media-and-data-pipelines.md) | createTask, createMediaJob | TC-018 |
| REQ-019 · 生成式视频 | P1 / M4 | U07, U08, F14 | UC03 | M05 | [06-media-and-data-pipelines](../technical/06-media-and-data-pipelines.md) | createMediaJob, getMediaJob | TC-019 |
| REQ-020 · 特效目录 | P1 / M4 | U08, F14 | UC03 | M05 | [06-media-and-data-pipelines](../technical/06-media-and-data-pipelines.md) | createMediaJob, getMediaJob | TC-020 |
| REQ-021 · 音频能力 | P1 / M4 | U07, U08, F14 | UC03 | M05 | [06-media-and-data-pipelines](../technical/06-media-and-data-pipelines.md) | createMediaJob, getMediaJob | TC-021 |
| REQ-022 · 审阅与导出 | P0 / M1 | U08, F07 | UC02, UC03 | M04 | [06-media-and-data-pipelines](../technical/06-media-and-data-pipelines.md) | reviewArtifacts, createComment | TC-022 |
| REQ-023 · 广告导入 | P0 / M1 | U08, U09, F09 | UC04 | M06 | [06-media-and-data-pipelines](../technical/06-media-and-data-pipelines.md) | createDatasetImport, getSnapshot | TC-023 |
| REQ-024 · 确定性分析 | P0 / M1 | U08, F11 | UC04 | M06 | [06-media-and-data-pipelines](../technical/06-media-and-data-pipelines.md) | createDatasetImport, getSnapshot | TC-024 |
| REQ-025 · Google Ads | P0 / M2 | U08, U09, F10 | UC04 | M07 | [06-media-and-data-pipelines](../technical/06-media-and-data-pipelines.md) | createReport, listConnections | TC-025 |
| REQ-026 · Meta Ads | P1 / M4 | U08, F13 | UC04 | M07 | [06-media-and-data-pipelines](../technical/06-media-and-data-pipelines.md) | createReport, listConnections | TC-026 |
| REQ-027 · GA4 | P1 / M4 | U08, F13 | UC04 | M07 | [06-media-and-data-pipelines](../technical/06-media-and-data-pipelines.md) | getSnapshot, createReport | TC-027 |
| REQ-028 · Search Console | P1 / M4 | U08, F13 | UC04, UC05 | M07 | [06-media-and-data-pipelines](../technical/06-media-and-data-pipelines.md) | getSnapshot, createReport | TC-028 |
| REQ-029 · SEO | P1 / M4 | U08, F15 | UC05 | M06 | [06-media-and-data-pipelines](../technical/06-media-and-data-pipelines.md) | createTask, getEvidence | TC-029 |
| REQ-030 · GEO | P1 / M4 | U07, U08, F15 | UC06 | M06 | [06-media-and-data-pipelines](../technical/06-media-and-data-pipelines.md) | createTask, getEvidence | TC-030 |
| REQ-031 · 创意反馈 | P1 / M4 | U08, F11 | UC04 | M06 | [06-media-and-data-pipelines](../technical/06-media-and-data-pipelines.md) | createReport, getReport | TC-031 |
| REQ-032 · 流程模板 | P1 / M2 | U08, F16, F21 | UC07 | M08 | [06-media-and-data-pipelines](../technical/06-media-and-data-pipelines.md) | createTask, listWorkflows | TC-032 |
| REQ-033 · 自动触发 | P1 / M2 | U08, F16, F21 | UC07 | M08 | [06-media-and-data-pipelines](../technical/06-media-and-data-pipelines.md) | listTriggers, createTrigger | TC-033 |
| REQ-034 · 外部写入幂等 | P0 / M1 | U08, F20, F21 | UC07, UC11 | M03 | [01-architecture-and-stack](../technical/01-architecture-and-stack.md) | controlTask, decideApproval | TC-034 |
| REQ-035 · Web 工作台 | P0 / M1 | U01, U02, U03, F02 | UC01, UC13 | M09 | [03-data-model-and-lifecycle](../technical/03-data-model-and-lifecycle.md) | listTenants, listProjects | TC-035 |
| REQ-036 · 扩展网页协作 | P1 / M3 | U04, F17 | UC08 | M09 | [05-local-executor-and-browser](../technical/05-local-executor-and-browser.md) | createMessage | TC-036 |
| REQ-037 · 基础本地文件 | P0 / M1 | U03, U04, F17 | UC08 | M09 | [05-local-executor-and-browser](../technical/05-local-executor-and-browser.md) | createTask, createUpload | TC-037 |
| REQ-038 · 原生桥接 | P1 / M3 | U04, U05, F18 | UC09 | M09 | [05-local-executor-and-browser](../technical/05-local-executor-and-browser.md) | authorizeNativeClient, exchangeNativeToken | TC-038 |
| REQ-039 · Desktop | P1 / M4 | U05, F19, F22 | UC10 | M09 | [05-local-executor-and-browser](../technical/05-local-executor-and-browser.md) | authorizeNativeClient, exchangeNativeToken | TC-039 |
| REQ-040 · 本地调度 | P1 / M3 | U04, U05, F18 | UC09, UC10 | M10 | [05-local-executor-and-browser](../technical/05-local-executor-and-browser.md) | createTask, revokeDevice | TC-040 |
| REQ-041 · 三端接续 | P1 / M3 | U04, U05, F19 | UC09, UC10, UC11 | M09 | [05-local-executor-and-browser](../technical/05-local-executor-and-browser.md) | createConversation, listConversations | TC-041 |
| REQ-042 · 浏览器资源 | P1 / M3 | U04, U05, F18 | UC09 | M10 | [05-local-executor-and-browser](../technical/05-local-executor-and-browser.md) | openDeviceChannel, submitCommandResult | TC-042 |
| REQ-043 · 统一 AI 路径 | P0 / M1 | U06, U07, U10, F04 | UC02, UC03, UC06, UC10 | M11 | [02-runtime-and-ai-gateway](../technical/02-runtime-and-ai-gateway.md) | createTask, createMediaJob | TC-043 |
| REQ-044 · Codex 唯一内核与协议兼容 | P0 / M1 | U06, U07, U10, F04, CORE01 | UC02, UC24 | M11 | [02-runtime-and-ai-gateway](../technical/02-runtime-and-ai-gateway.md) | createTask, listCapabilities | TC-044 |
| REQ-045 · 模型能力注册 | P0 / M1 | U06, U07, U10, F04 | UC02, UC06 | M11 | [02-runtime-and-ai-gateway](../technical/02-runtime-and-ai-gateway.md) | updateAgent, listCapabilities | TC-045 |
| REQ-046 · 预算和费用 | P0 / M1 | U07, U10, F12 | UC02, UC03, UC07, UC15, UC20 | M11 | [02-runtime-and-ai-gateway](../technical/02-runtime-and-ai-gateway.md) | createMediaJob, cancelMediaJob | TC-046 |
| REQ-047 · 商业权益 | P0 / M1 | U08, ADMIN01 | UC07, UC21 | M11 | [11-admin-control-plane](../technical/11-admin-control-plane.md) | getUsage, listPlans | TC-047 |
| REQ-048 · 管理运营 | P0 / M1 | U02, F12, ADMIN01 | UC12 | M12 | [11-admin-control-plane](../technical/11-admin-control-plane.md) | createSupportGrant, revokeSupportGrant | TC-048 |
| REQ-049 · 数据生命周期 | P0 / M1 | U02 | UC12, UC22 | M04 | [07-security-and-permissions](../technical/07-security-and-permissions.md) | deleteAgent, deleteMemory | TC-049 |
| REQ-050 · 凭证与数据边界 | P0 / M1 | U04, U07 | UC08, UC12 | M11 | [07-security-and-permissions](../technical/07-security-and-permissions.md) | createAssetDownload, createVersionDownload | TC-050 |
| REQ-051 · 香港使用体验 | P0 / M1 | U01, U09, F07 | UC01 | M09 | [08-development-and-delivery](../technical/08-development-and-delivery.md) | createBrandVersion, createExport | TC-051 |
| REQ-052 · 资源与性能 | P0 / M2 | F12 | UC11 | M12 | [08-development-and-delivery](../technical/08-development-and-delivery.md) | getAdminHealth | TC-052 |
| REQ-053 · 可靠性 | P0 / M2 | F12 | UC11 | M12 | [08-development-and-delivery](../technical/08-development-and-delivery.md) | getAdminHealth | TC-053 |
| REQ-054 · 可维护发布 | P0 / M2 | U05, U06, F19, F22 | UC10 | M12 | [08-development-and-delivery](../technical/08-development-and-delivery.md) | getAdminHealth | TC-054 |
| REQ-055 · 可访问交互 | P0 / M1 | U03 | UC08 | M09 | [08-development-and-delivery](../technical/08-development-and-delivery.md) | getTask | TC-055 |
| REQ-056 · 质量评估 | P0 / M1 | U08, U09 | UC11 | M12 | [08-development-and-delivery](../technical/08-development-and-delivery.md) | reviewArtifacts, getAdminHealth | TC-056 |
| REQ-057 · 执行边界 | P0 / M1 | U04, U05, U07 | UC05, UC09 | M10 | [07-security-and-permissions](../technical/07-security-and-permissions.md) | createTask, openDeviceChannel | TC-057 |
| REQ-058 · 能力可用性 | P0 / M1 | U08, U10 | UC02, UC03 | M11 | [02-runtime-and-ai-gateway](../technical/02-runtime-and-ai-gateway.md) | createTask, createMediaJob | TC-058 |
| REQ-059 · 专属云端运行环境 | P2 / M4+ | U02 | UC11 | M02 | [01-architecture-and-stack](../technical/01-architecture-and-stack.md) | createTask | TC-059 |
| REQ-060 · 文档与开发约束 | P0 / M1 | U02 | UC11 | M12 | [08-development-and-delivery](../technical/08-development-and-delivery.md) | getAdminHealth | TC-060 |
| REQ-061 · 会话生命周期 | P0 / M1 | WEB01, AC03, AC04, WB11 | UC13 | M02 | [03-data-model-and-lifecycle](../technical/03-data-model-and-lifecycle.md) | createConversation, listConversations | TC-061 |
| REQ-062 · 专业 Agent 模板 | P0 / M1 | WEB01, WB05, AC03 | UC01, UC14, UC17 | M02 | [03-data-model-and-lifecycle](../technical/03-data-model-and-lifecycle.md) | createAgent, updateAgent | TC-062 |
| REQ-063 · 云文件工作区 | P0 / M1 | WEB01, WB04, WB07, AC04 | UC13, UC16 | M04 | [03-data-model-and-lifecycle](../technical/03-data-model-and-lifecycle.md) | listAssets, listCloudWorkspaces | TC-063 |
| REQ-064 · 技能生命周期 | P0 / M1 | WEB01, WB06, AC07, AC12 | UC14, UC17 | M02 | [03-data-model-and-lifecycle](../technical/03-data-model-and-lifecycle.md) | createAgent, updateAgent | TC-064 |
| REQ-065 · 共享项目配置 | P1 / M2 | WEB01, WB04, WB09 | UC15, UC16 | M02 | [03-data-model-and-lifecycle](../technical/03-data-model-and-lifecycle.md) | listProjectConfigVersions, publishProjectConfig | TC-065 |
| REQ-066 · 专业团队协作 | P1 / M2 | WEB01, WB05, AC05, AC06 | UC15 | M02 | [03-data-model-and-lifecycle](../technical/03-data-model-and-lifecycle.md) | createConversation, createMessage | TC-066 |
| REQ-067 · 工作模式 | P0 / M1 | WEB01, WB03, AC12 | UC13, UC15 | M02 | [03-data-model-and-lifecycle](../technical/03-data-model-and-lifecycle.md) | createMessage, createTask | TC-067 |
| REQ-068 · 成果继续工作 | P0 / M1 | WEB01, WB08, WB12, AC04 | UC02, UC13, UC15, UC16 | M04 | [03-data-model-and-lifecycle](../technical/03-data-model-and-lifecycle.md) | createMessage, createComment | TC-068 |
| REQ-069 · 按需依赖引导 | P0 / M1 | WEB01, WB05, AC11 | UC01, UC14 | M07 | [03-data-model-and-lifecycle](../technical/03-data-model-and-lifecycle.md) | createMessage, createTask | TC-069 |
| REQ-070 · 业务解决方案复用 | P1 / M2 | WEB01, AC08, WB04 | UC14, UC16 | M08 | [03-data-model-and-lifecycle](../technical/03-data-model-and-lifecycle.md) | createSkillVersion, verifySkillVersion | TC-070 |
| REQ-071 · 对话创建云端计划 | P1 / M2 | WEB01, AC09, WB04 | UC07 | M08 | [03-data-model-and-lifecycle](../technical/03-data-model-and-lifecycle.md) | createRoutineDraft, getRoutineDraft | TC-071 |
| REQ-072 · 首项工作与通知 | P0 / M1 | WEB01, WB03, AC02 | UC01, UC13 | M09 | [03-data-model-and-lifecycle](../technical/03-data-model-and-lifecycle.md) | createConversation, createMessage | TC-072 |
| REQ-073 · 预设角色目录 | P0 / M1 | ROLE01 | UC17, UC18, UC24 | M02 | [02-runtime-and-ai-gateway](../technical/02-runtime-and-ai-gateway.md) | listAgentTemplates, instantiateAgentTemplate | TC-073 |
| REQ-074 · 可执行技能组合 | P0 / M1 | ROLE01 | UC17, UC18 | M02 | [02-runtime-and-ai-gateway](../technical/02-runtime-and-ai-gateway.md) | createRoleTemplateDraft, instantiateAgentTemplate | TC-074 |
| REQ-075 · Codex 技能执行 | P0 / M1 | ROLE01, CORE01 | UC17, UC18 | M02, M11 | [02-runtime-and-ai-gateway](../technical/02-runtime-and-ai-gateway.md) | instantiateAgentTemplate, verifySkillVersion | TC-075 |
| REQ-076 · 角色选择与创建 | P0 / M1 | ROLE01 | UC17, UC18 | M02, M09 | [02-runtime-and-ai-gateway](../technical/02-runtime-and-ai-gateway.md) | listAgentTemplates, instantiateAgentTemplate | TC-076 |
| REQ-077 · 设计师与 Image 2 | P0 / M1 | ROLE01 | UC17 | M05, M11 | [02-runtime-and-ai-gateway](../technical/02-runtime-and-ai-gateway.md) | instantiateAgentTemplate, getEffectiveCapabilities | TC-077 |
| REQ-078 · 角色工作与交付约定 | P0 / M1 | ROLE01 | UC17, UC18 | M02, M05, M09 | [02-runtime-and-ai-gateway](../technical/02-runtime-and-ai-gateway.md) | createRoleTemplateDraft, instantiateAgentTemplate | TC-078 |
| REQ-079 · 模板版本与企业定制 | P0 / M1 | ROLE01 | UC17, UC18 | M02, M11 | [02-runtime-and-ai-gateway](../technical/02-runtime-and-ai-gateway.md) | updateAgent, createRoleTemplateDraft | TC-079 |
| REQ-080 · 角色发布资格 | P0 / M1 | ROLE01 | UC17, UC18, UC24 | M02, M12 | [02-runtime-and-ai-gateway](../technical/02-runtime-and-ai-gateway.md) | listAgentTemplates, verifySkillVersion | TC-080 |
| REQ-081 · CopyPaste 品牌一致性 | P0 / M1 | BRAND01 | UC01, UC08, UC10, UC13, UC17, UC24 | M09 | [10-frontend-design-system](../technical/10-frontend-design-system.md) | 执行/交互规则 | TC-081 |
| REQ-082 · 品牌设计验收 | P0 / M1 | BRAND01 | UC01, UC08, UC10, UC13, UC17, UC24 | M09, M12 | [10-frontend-design-system](../technical/10-frontend-design-system.md) | 执行/交互规则 | TC-082 |
| REQ-083 · 后台独立身份 | P0 / M1 | ADMIN01 | UC19, UC23 | M01, M12 | [11-admin-control-plane](../technical/11-admin-control-plane.md) | getAdminContext, revokeAdminUserSessions | TC-083 |
| REQ-084 · 完整用户管理 | P0 / M1 | ADMIN01 | UC19 | M01, M12 | [11-admin-control-plane](../technical/11-admin-control-plane.md) | listAdminUsers, getAdminUser | TC-084 |
| REQ-085 · 账号与企业控制 | P0 / M1 | ADMIN01 | UC19 | M01, M12 | [11-admin-control-plane](../technical/11-admin-control-plane.md) | listAdminUsers, changeAdminUserProfile | TC-085 |
| REQ-086 · 用户消耗分析 | P0 / M1 | ADMIN01 | UC20 | M11, M12 | [11-admin-control-plane](../technical/11-admin-control-plane.md) | getAdminOverview, listAdminUsers | TC-086 |
| REQ-087 · 人工费用管理 | P0 / M1 | ADMIN01 | UC20, UC21 | M11, M12 | [11-admin-control-plane](../technical/11-admin-control-plane.md) | listAdminBillingAccounts, getAdminBillingAccount | TC-087 |
| REQ-088 · VIP 人工开通 | P0 / M1 | ADMIN01 | UC21 | M11, M12 | [11-admin-control-plane](../technical/11-admin-control-plane.md) | getAdminUser, listAdminVipGrants | TC-088 |
| REQ-089 · 方案与权益版本 | P0 / M1 | ADMIN01 | UC21 | M11, M12 | [11-admin-control-plane](../technical/11-admin-control-plane.md) | listAdminVipGrants, createAdminVipGrant | TC-089 |
| REQ-090 · 全量用户内容管理 | P0 / M1 | ADMIN01 | UC22 | M04, M12 | [11-admin-control-plane](../technical/11-admin-control-plane.md) | listAdminContent, getAdminContent | TC-090 |
| REQ-091 · 内容状态与生命周期 | P0 / M1 | ADMIN01 | UC22 | M04, M12 | [11-admin-control-plane](../technical/11-admin-control-plane.md) | listAdminContent, getAdminContentDownload | TC-091 |
| REQ-092 · 执行控制 | P0 / M1 | ADMIN01 | UC22, UC24 | M03, M12 | [11-admin-control-plane](../technical/11-admin-control-plane.md) | listAdminExecutions, controlAdminExecution | TC-092 |
| REQ-093 · 用户端公开内容配置 | P1 / M2 | ADMIN01 | UC24 | M12 | [11-admin-control-plane](../technical/11-admin-control-plane.md) | publishAdminPlan, listAdminCatalogReleases | TC-093 |
| REQ-094 · 后台细粒度权限 | P0 / M1 | ADMIN01 | UC19, UC20, UC22, UC23 | M01, M12 | [11-admin-control-plane](../technical/11-admin-control-plane.md) | getAdminContext, getAdminUser | TC-094 |
| REQ-095 · 客服受控协助 | P0 / M1 | ADMIN01 | UC22, UC23 | M01, M12 | [11-admin-control-plane](../technical/11-admin-control-plane.md) | listAdminSupportSessions, createAdminSupportSession | TC-095 |
| REQ-096 · 后台操作审计与风险 | P0 / M1 | ADMIN01 | UC21, UC22, UC23 | M01, M12 | [11-admin-control-plane](../technical/11-admin-control-plane.md) | changeAdminUserProfile, changeAdminUserStatus | TC-096 |
| REQ-097 · 批量与导出 | P1 / M2 | ADMIN01 | UC20, UC23, UC24 | M04, M12 | [11-admin-control-plane](../technical/11-admin-control-plane.md) | listAdminJobs, createAdminBatch | TC-097 |
| REQ-098 · 后台交互与视觉 | P0 / M1 | ADMIN01 | UC19, UC24 | M12 | [11-admin-control-plane](../technical/11-admin-control-plane.md) | getAdminContext, getAdminOverview | TC-098 |
| REQ-099 · 受控平台配置 | P0 / M1 | ADMIN01 | UC24 | M11, M12 | [11-admin-control-plane](../technical/11-admin-control-plane.md) | listAdminCatalogReleases, getAdminCatalogRelease | TC-099 |
| REQ-100 · 跨端管理生效 | P0 / M1 | ADMIN01 | UC19, UC21, UC22, UC24 | M01, M03, M11, M12 | [11-admin-control-plane](../technical/11-admin-control-plane.md) | changeAdminUserStatus, revokeAdminUserSessions | TC-100 |
| REQ-101 · 收款退款与对账 | P0 / M1 | ADMIN01 | UC20, UC21 | M11, M12 | [11-admin-control-plane](../technical/11-admin-control-plane.md) | getAdminUsageSummary, listAdminUsageEntries | TC-101 |
| REQ-102 · 权益真实执行 | P0 / M1 | ADMIN01 | UC21, UC24 | M03, M11, M12 | [11-admin-control-plane](../technical/11-admin-control-plane.md) | listAdminVipGrants, createAdminVipGrant | TC-102 |

## 1. 早期来源覆盖

原始 U01–U10 定义在 [第一轮需求](../01-product-requirements.md)，F01–F22 定义在 [第一轮范围计划](../02-mvp-and-validation.md)。每个来源均保留至少一个 REQ 映射。来源映射表示方案关系，不把后续可选项升级为用户已确认要求。

WEB01 表示用户指定 WorkBuddy 与 Accio 作为 Web 对标的指令；WB/AC 编号来自 [官方证据索引](../research/01-web-benchmark-workbuddy-accio.md)。REQ-061–072 是基于该指令展开的设计建议，不将竞品宣传或桌面能力当作本产品已验证能力。

ROLE01 表示用户要求至少十二个技能组合预设、覆盖开发到设计，并以 Codex＋设计 Skill＋Image 2 举例。REQ-073–080 直接拆解该要求，十八个具体目录条目和实施细节见 [角色分册](../product/06-role-templates-and-skill-presets.md)；不把用户要求归为竞品推导。

BRAND01 表示用户指定公司官网作为最终产品风格、样式和色系的依据，拆为 REQ-081/082。基础色、Logo 与字体层级来源及产品扩展见 [品牌规范](../product/07-brand-design-system.md)和 [官网核查](../research/03-copypaste-brand-reference.md)。这两项由 UI、共享资源与验收落实，不为追踪新增无关后端接口。

CORE01 表示用户最新要求唯一使用 Codex。它收敛已有 REQ-044/075，并保留原有来源映射；覆盖默认助手、所有角色、团队、后台计划及发布/启动/恢复的内核配置校验，取消其他内核比较和自动回退。集成与数据约束见 [Codex 分册](../technical/02-runtime-and-ai-gateway.md)。

ADMIN01 是用户要求完整后台、完整用户与消耗、人工费用/VIP 和细粒度内容权限的原始指令。REQ-083–102 为本轮拆分，并将 REQ-047/048 的人工商业开通及后台基础提前至 M1。页面、权限与工作包见 [Admin 分册](../product/08-admin-dashboard.md) 和 [技术分册](../technical/11-admin-control-plane.md)。金额阈值和商业价格仍是待配置政策。

F20 的外部发布/预算工具、F21 的更多企业连接器及 F22 的 SSO/更多系统认证继续作为 M4 后增量；当前设计提供授权、幂等、身份和兼容基础，未宣称已完成那些工具。

## 2. 覆盖规则

需求必须有来源、旅程、模块、产品与技术文档以及验收编号。API operationId 必须能在机器契约找到，接口的 x-requirements 必须指向有效 REQ。通用质量需求可以由交互、执行器或运维落实，不因附在一个查询接口就视为实现。

产品实现状态统一为 not_implemented；所有运行测试为 not_run。本轮静态文档结果独立记录，后续实施时分别更新真实证据。
