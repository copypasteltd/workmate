# 术语、权威定义与来源

版本：1.5 · 核查日期：2026-10-18。

## 1. 术语

| 术语 | 本项目含义 |
| --- | --- |
| Tenant / 企业 | 服务与数据隔离边界，不等同品牌或登录用户 |
| Project / 项目 | 企业内协作范围，保存资料、规则、能力和资源引用；与文件空间、计算进程区分 |
| Agent | 长期职责、资料与工具配置，不等同一次模型请求 |
| Conversation | 沟通上下文，可以委派多个任务 |
| Task / Attempt / Step | 业务委派 / 一次执行尝试 / 可恢复工作单元 |
| Harness / Agent 内核 | 固定为 Codex 的执行内核，与底层模型、受控工具及企业平台分别设计 |
| Workspace / 云文件工作区 | 有权限边界的逻辑文件树与持久文件版本，可供按需计算使用；不意味着独占电脑 |
| Runtime | 实际执行进程与资源实例，可回收/休眠，与 Agent、会话及持久文件生命周期分离 |
| AgentTemplate / AgentGroup | 专业角色的初始化方法 / 有协调者和专业成员的持久团队 |
| Skill / Tool / Connector | 可复用业务方法 / 原子执行动作 / 获准的外部业务资源访问 |
| Solution / Routine | 角色、技能与资源要求的方案包 / 保存的重复工作与触发配置 |
| AssetVersion / Artifact | 不可变文件版本 / 归属任务的交付引用 |
| Snapshot / Evidence | 冻结数据范围 / 能复现事实或指标的证据 |
| CapabilityVersion | 已定义协议、参数、费用和验证状态的内部能力版本 |
| Grant | 获准的设备、目录或动作范围，不是任意远端路径 |
| Fencing token | 每次接管递增的租约代次，拒绝旧执行者提交 |
| Reservation / Ledger | 费用承诺预留 / 不可变资金事件账本 |
| Money micros | 百万分之一货币单位，API 用整数字符串 |
| 技术成功 / 业务接受 | 完成约定步骤 / 用户认为产物可实际使用，分别记录 |
| SEO / GEO | 搜索诊断 / 固定方法下的 AI 可见性观测，不提供全网排名保证 |

任务状态权威表在 [M02/M03](../modules/02-agents-tasks-memory.md)，机器枚举在 OpenAPI；费用和默认保留期分别以 M11/NFR 为准。

## 2. 官方资料登记

| 来源 | 用途与核查边界 |
| --- | --- |
| [CopyPaste 官网](https://copypaste.hk/) / [官网 CSS](https://copypaste.hk/styles.css) / [界面脚本](https://copypaste.hk/app.js) | BRAND01 的真实品牌来源；原生 HTTP 和独立原生浏览器核查基础色、Logo、字体声明/实际回退及浅深截图，记录在品牌研究 |
| [Grok Bot 介绍](https://x.ai/news/introducing-grok-bot) | 持续任务与云端执行的对标方向 |
| [WorkBuddy 官方介绍](https://cloud.tencent.com/product/workbuddy) / [官方指南](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Project) | 用户指定的 Web 对标；项目、角色、技能、会话与成果逻辑，明确本机远程与云端的区别 |
| [Accio Web](https://www.accio.com/work/app) / [官方会话指南](https://www.accio.com/wow/doc-chat-guide.html) | 用户指定的 Web 对标；公开 HTML 入口及跨端产品说明，不代表登录后功能实测 |
| [Codex app-server](https://learn.chatgpt.com/docs/app-server) | 自定义客户端集成；原生协议不等于产品 API |
| [Codex 网关兼容](https://learn.chatgpt.com/docs/enterprise/gateway-compatibility) | Responses 与工具/事件行为验证 |
| [Codex 配置](https://learn.chatgpt.com/docs/config-file/config-reference) | Provider 与协议配置边界 |
| [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) | 用户模型表述的候选映射，内部别名仍待实测 |
| [File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access) | 浏览器文件选择与用户授权 |
| [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) | 扩展与原生 host 的连接方式 |
| [扩展 worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) | 长任务与 UI/worker 生命周期分开 |
| [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security) | 渲染隔离与 IPC 边界；实施验证版本和配置 |
| [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) | 行级策略、特权绕过及运行角色边界 |
| [pg-boss 官方仓库](https://github.com/timgit/pg-boss) | PostgreSQL 作业队列候选，不宣称外部副作用 exactly-once |
| [Fastify 官方文档](https://fastify.dev/docs/latest/) | API 框架候选及 schema 校验方向 |
| [Google Ads 迁移](https://developers.google.com/google-ads/api/docs/api-policy/developer-token) | 当前项目访问级别迁移，旧页面可能仍有旧术语 |
| [GA Data API](https://developers.google.com/analytics/devguides/reporting/data/v1) | 网站/应用报告与口径保存 |
| [Search Console 查询](https://developers.google.com/webmaster-tools/v1/searchanalytics/query) | 搜索数据查询、聚合及范围 |
| [Google AI 搜索说明](https://developers.google.com/search/docs/appearance/ai-features) | Google AI 搜索数据与常规 Web 搜索报告关系 |
| [WCAG 2.2 Quickref](https://www.w3.org/WAI/WCAG22/quickref/) | 可访问性设计目标，不作为已认证声明 |
| [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) | 设备签名采用的 JSON canonicalization 规则 |
| [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0) | 产品 REST schema 与操作契约格式 |

Meta [Insights](https://developers.facebook.com/docs/marketing-api/insights/) 及授权文档本次无法完整取回。相关权限、审批、配额与字段只保留为集成验证项，未标已验证。

UI/UX Pro Max 的本机检索用于可读性、交互反馈和密度检查。最终主色、Logo 及字体层级依据官网快照，新增 TC 回退、状态色、增强边界和布局为产品设计扩展；通用检索配色不覆盖品牌依据。

## 3. 证据分类

公开文档说明、内部接口实测、产品运行测试及客户业务接受分别记录。前一类不能替代后一类。文档校验器只能证明其覆盖的静态结构、追踪和算例，不能证明云端服务、平台授权或本地客户端运行。

本轮 Web 研究详细区分 H（公开应用 HTML）、D（官方说明）、I（本产品设计推导）。26 个来源及端差异登记在 [研究报告](../research/01-web-benchmark-workbuddy-accio.md) 与 [HTTP 核查记录](../research/02-source-checks.json)，不将宣传案例、能力数量或桌面权限写成实测结论。

## 4. 角色预设术语与来源补充

RolePreset 指客户可直接使用的专业方法组合，包含职责、固定 Skill 版本、运行/模型/工具、输入、流程、交付及验收；Skill 是可加载的方法包，模型负责特定推理/媒体能力，工具执行实际操作。三者分别建模。Qualified 表示有匹配版本的运行证据；Ready 还需目标企业的当前能力、权益和权限满足。design_only 不等于已发布或运行合格。

ROLE01 来源为用户本轮角色预设指令，具体映射 REQ-073–080。2026-10-18 核查 [Codex Skill 官方说明](https://learn.chatgpt.com/docs/build-skills)及 [Image 2 官方模型资料](https://developers.openai.com/api/docs/models/gpt-image-2)。前者用于包结构/按需加载边界，后者用于用户指定 Image 2 的公开标识；均不证明公司内部网关、产品技能包或十八个角色已经实现。内部版本和媒体能力另行实测。

## 5. 品牌设计术语与来源补充

BRAND01 表示用户指定 CopyPaste 官网为最终产品视觉依据，映射 REQ-081/082。Design token 是版本化颜色、字体、间距、圆角、阴影及过渡变量；platform_theme 是平台浅深外观，customer_brand_version 是客户交付引用的品牌版本，两者分别维护。

2026-10-18 的 [品牌核查记录](../research/03-copypaste-brand-reference.md) 包含 7 个官网源文件/资产、3 个实际视图及资源关闭记录。官网字体声明不等于生产字体已打包；[品牌规范](../product/07-brand-design-system.md) 区分实测来源与产品扩展。静态样板检查仅验证该样板，不能替代全部页面、端或可访问性认证。

## 6. Codex 唯一内核与集成依据

CORE01 是用户最新内核方向指令，确定仅使用 Codex，替代此前候选评估。它是产品约束，映射 REQ-044/075、G01、DEV-02 及决策 D03/D11；公开文档用于确定集成方法，不用于决定是否采用其他内核。

2026-10-18 实际阅读 [Codex app-server](https://learn.chatgpt.com/docs/app-server)、[配置参考](https://learn.chatgpt.com/docs/config-file/config-reference) 和 [网关兼容说明](https://learn.chatgpt.com/docs/enterprise/gateway-compatibility)。据此采用受控 app-server 子进程与默认 stdio，映射 thread/turn 及事件；固定程序版本与对应协议 schema。Provider 指向内部服务器并验证 Responses、增量/终态事件、工具调用及结果续接；普通聊天或模型列表成功不能证明完整兼容。

产品侧另行约束全部 AI 网络路径、企业权限、任务状态和费用；provider 配置不能替代工具/插件网络控制。现有模型表述 `gpt 6 luna max` 与 Image 2 要求继续保留，内部 alias、版本及真实能力仍需实测。此次只核对官方资料并修改设计，未运行 Codex 集成或内部收费模型。

## 7. 管理后台术语与来源

ADMIN01 来源为用户的完整后台指令，拆为 REQ-083–102。Platform Admin 是公司平台管理身份，Tenant Owner/Admin 是客户企业身份；二者不自动互授权限。AdminScope 描述全局或指定企业/项目，Permission 控制注册动作和字段。SupportSession 是保留真实管理员身份的限时只读协助，不能冒充用户登录。

VIP / EntitlementGrant 是特定主体和时段的版本化权益；BillingAccount 是付费主体；PaidBalance、PromotionalCredit、Reservation、CreditLimit 和 Budget 分别为实付余额、赠送、预留、信用上限和执行预算，不能互相替代。AdminOperation 表示可追踪管理命令，接受不等于完成；CatalogRelease 是用户端配置的校验与发布版本。

2026-10-18 阅读 OWASP 官方 [Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)，用于最小权限、默认拒绝、每次请求检查及上下文授权设计；阅读 [Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)，用于管理员行为、敏感访问、变更和导出的审计及日志隔离。这些资料支持设计方法，不能作为本产品已经完成安全验证的证据。

本机 UI/UX Pro Max 的后台模式检索未获得适合当前产品的完整样式方案，因此未采用其营销页或通用配色；定向检索的错误摘要、可聚焦校验及就近字段错误建议用于后台表单。视觉继续沿用已固化的 CopyPaste 品牌。此次只更新文档和契约，未启动交互浏览器、调用 AI、执行付款或实际开通会员。
