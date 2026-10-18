# 模块总览与职责边界

版本：1.5 · 2026-10-18。

| 模块 | 职责及权威数据 | 说明文档 |
| --- | --- | --- |
| M01 企业身份 | 企业、成员、项目、产品身份；独立平台管理员身份、角色及数据范围 | [身份与权限](01-identity-workspaces-permissions.md) |
| M02 持续 Agent 与记忆 | Agent/18 个角色预设、会话、技能版本与绑定、团队、项目配置及范围化记忆 | [Agent 与任务](02-agents-tasks-memory.md) |
| M03 任务执行 | 任务、尝试、步骤、授权、事件和副作用记录 | [Agent 与任务](02-agents-tasks-memory.md) |
| M04 品牌资产 | 品牌版本、云文件树、文件对象、编辑描述、交付版本与删除 | [品牌资产](03-brand-assets-and-deliverables.md) |
| M05 营销生产 | 图像、文字布局、视频工程、效果目录和媒体作业 | [营销生产](04-marketing-production.md) |
| M06 分析与搜索 | 数据快照、指标结果、证据、SEO/GEO 观测与素材反馈 | [分析与搜索](05-analytics-seo-geo.md) |
| M07 外部连接 | 连接身份、可用账户、授权范围、同步游标 | [连接与流程](06-connectors-workflows.md) |
| M08 企业流程 | 方案包、重复工作、模板版本、触发器、运行及事件去重 | [连接与流程](06-connectors-workflows.md) |
| M09 三端体验 | Web、扩展、Desktop 页面、登录与接续；CopyPaste 品牌 token/组件 | [三端与设备](07-web-extension-desktop.md) |
| M10 受控执行器 | 设备、目录授权、命令、浏览器资源和本地作业 | [三端与设备](07-web-extension-desktop.md) |
| M11 AI 与费用 | 内部 AI、用量、账户/账本、人工费用、VIP、方案版本和权益 | [用量与运营](08-usage-billing-admin.md) |
| M12 运营与交付 | 完整 Admin Dashboard、用户/内容/执行控制、权限审计、配置发布及服务质量 | [用量与运营](08-usage-billing-admin.md) |

## 1. 调用依赖

三端经产品 API 访问 M01–M08、M11。M03 调度内核，内核只获得按任务缩小的工具集合；M05/M06/M07/M10 实现实际工具。AI 类调用统一进入 M11 的内部服务适配，业务连接器使用各平台 API。

M04 保存文件及版本，其他模块引用 asset_id，不各自创建不可追踪的临时文件仓库。M11 保存费用权威账本，业务模块提供执行及作业归属，不能直接修改余额。M12 通过领域服务完成后台管理；内容管理员可在显式授权范围内直接管理完整内容，客服默认只读元数据，不以支持入口扩大权限。

## 2. 通用模块契约

所有命令包含服务端确定的企业、项目、执行身份、request_id，以及需要时的任务和幂等键。结果区分接受、完成、部分完成和状态未知；异步作业返回稳定 ID。

跨模块状态通过事务记录和 outbox 事件衔接，不依赖前端调用顺序维持一致性。文件、连接、设备或成员撤销后，执行前重新核查，已经执行的不可逆动作保留审计结果。

## 3. 维护责任

业务服务和各执行器分别承担自己的状态与资源清理。M03 决定任务状态，M05 决定媒体作业状态，M10 决定设备命令结果；适配层把后两者映射为步骤事件，不把三个状态机合为一个枚举。

技术边界见 [架构](../technical/01-architecture-and-stack.md)，字段见 [数据模型](../technical/03-data-model-and-lifecycle.md)，接口见 [API 说明](../technical/04-api-and-event-contracts.md)。

角色预设复用上述模块，不新增独立执行系统。软件开发、设计、分析和流程均由 M02 组合专业 Skill，M03 调度受控工具及 M11 的内部 AI，按 M04 交付和 M12 的资格验证发布。目录与职责见 [角色分册](../product/06-role-templates-and-skill-presets.md)。

品牌设计由 M09 维护共用 UI 资源，M12 管理 G09 发布检查；所有业务页面复用 [CopyPaste 品牌规范](../product/07-brand-design-system.md)，M04/M05 中的客户交付仍使用客户自己的品牌版本。REQ-081/082 不新增独立业务模块或模型调用。

ADMIN01 复用 M01/M11/M12 及各资源模块，不另设重复内核或平行计费系统。16 个后台页面见 [产品分册](../product/08-admin-dashboard.md)，AD01–AD10 工作包和 G10 见 [技术分册](../technical/11-admin-control-plane.md)。模块总数仍为 12。
