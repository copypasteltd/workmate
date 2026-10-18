# 文档体系与使用规则

版本：1.9 · 2026-10-19 · 状态：方案基线与本轮实现记录并存；实际代码范围以实施清单和运行证据为准。

## 1. 交付范围

本套文档将 CopyPaste 企业 Agent 服务从需求展开到产品、模块、接口、开发、测试与运营。覆盖云端 Web、Chrome 扩展、原生本地桥接和完整 Desktop；覆盖营销图片、视频、字体与特效、广告及网站分析、SEO/GEO、企业重复流程。

「文档完成」表示方案可供评审和研发拆解；本轮实际实现另外记录在 [仓库清单](technical/12-implementation-and-repositories.md) 与 [当前验收](quality/07-cloud-schedule-acceptance.md)，不能据文档覆盖宣称全量产品通过或外部平台获批。未知信息通过设计默认值、决策状态和验证门槛管理，不用空白章节替代设计。

## 2. 阅读路径

| 角色 | 建议顺序 |
| --- | --- |
| 业务负责人 | 产品 PRD → 用户旅程 → 发布与商业模式 → 决策记录 |
| 产品与设计 | SRS → 品牌规范/官网核查 → 用户旅程 → 页面交互 → 各业务模块 |
| 平台运营与财务 | Admin 页面 → 用户/消耗 → 人工费用与 VIP → 权限与内容控制 → G10 |
| 后台研发 | Admin 技术设计 → 权限目录 → 数据/API → AD01–AD10 → TC-083–102 |
| 研发负责人 | 架构 → 数据模型 → API/事件 → 内核/网关 → 开发交付 |
| 连接器与媒体研发 | 模块说明 → 媒体数据管线 → 接口契约 → 测试计划 |
| 客户端研发 | 三端模块 → 本地执行器协议 → 权限设计 → 三端测试 |
| 测试与运维 | 需求追踪矩阵 → 测试计划 → 非功能要求 → 运维手册 |

入口与全部链接集中在 [README](README.md)。旧的 01–03 文件保留为第一轮需求来源；与新版有差异时，以本套分目录文档、显式决策和机器契约为准。

## 3. 规则与权威来源

1. 用户硬约束优先：主文档在 `docs/`，实际源码和构建在 `dev/`；各端独立 Git 的中英 README、流程图、截图按最新交付要求随仓库保存；不调度本地 Docker、WSL 等虚拟化环境；浏览器调用后释放不用的标签页；所有 AI API 经过内部服务器；Agent 内核唯一使用 Codex。
2. 需求编号 `REQ-001` 至 `REQ-102` 的定义以 [SRS](requirements/01-srs.md) 为准；原稿 U01–U10、F01–F22 及 WEB01 对标、ROLE01 角色预设、BRAND01 官网视觉、CORE01 Codex 唯一内核、ADMIN01 完整管理后台指令通过追踪矩阵保留来源关系。CORE01 收敛已有 REQ-044/075，不新增同义编号。
3. 产品词义、任务状态与金额单位以 [术语](governance/02-glossary-and-sources.md)、[任务模块](modules/02-agents-tasks-memory.md) 和机器契约为准。
4. `contracts/` 定义长期设计的 API 字段与枚举；0.4.0 的实际路由清单和客户端实现另见实施清单，二者尚非全部一一实现；协议变更必须同步需求、客户端影响、示例与测试，不只改一处。
5. 尚无用户决策的实施选择是「设计默认」，不是已采购或已部署事实。精确依赖版本在工程初始化时锁定，不假称采用未验证的最新版本。
6. 示例中的账户、素材、域名和金额均为虚构；不含内部网关地址、密钥或真实客户资料。

## 4. 阶段与状态

M0 能力验证 → M1 Web 工作台及导入试点 → M2 协作、云端计划与正式连接器 → M3 扩展与本地能力 → M4 完整桌面与业务扩展。完整需求保留到 M4 及其增量版本，阶段安排不删除长期范围。Web 产品形态以 [专册](product/05-web-agent-workbench.md) 为准，证据与推导以 [对标研究](research/01-web-benchmark-workbuddy-accio.md) 为准。

文档使用四类标记：「用户已确认」「设计默认」「需实测」「待业务决策」。开发任务的完成证据必须包含运行结果；测试计划及样例文件本身不算产品测试通过。

## 5. 文档维护

需求新增时分配新的 REQ 编号；已有编号不复用。每个需求必须能定位产品流程、模块、技术设计和验收用例。新增接口须有认证、作用域、幂等、异常和版本策略。涉及费用和外部写入的变更须同步预算及授权规则。

本套静态核查入口为 `python docs/tools/validate_docs.py`，覆盖文件、链接、需求追踪和机器契约样例等；具体覆盖范围在 [文档交付审查](quality/03-documentation-review.md) 说明。

## 6. 角色预设的权威定义

客户角色职责、18 个目录条目、设计师链路和发布门槛以 [角色分册](product/06-role-templates-and-skill-presets.md) 为准；REQ-073–080 在 SRS 定义，UC17/UC18 在用户旅程展开。具体绑定设计由 [build_role_presets.py](tools/build_role_presets.py)生成 [目录及 schema](contracts/README.md)，运行态 API 另以 OpenAPI 为准。图像生成指定 Image 2，内部映射仍需实测；不得以候选技能包名称声称已上线。

## 7. 品牌视觉的权威定义

最终产品外观以 [CopyPaste 品牌规范](product/07-brand-design-system.md) 为准，官网来源及原始截图见 [品牌核查](research/03-copypaste-brand-reference.md)。官网九个基础色与产品状态色、字体回退、密度等扩展分别标记；[token](design/brand-tokens.json) 和 [静态样板](design/brand-preview.html) 对应同一版本，重建来源为 [build_brand_design.py](tools/build_brand_design.py)。原交互文档通用配色默认由本规范替代。

REQ-081/082、TC-081/082 及 G09 管理产品验收；当前样板运行证据只覆盖文档样板，不计为 Web、扩展、Desktop 或完整无障碍通过。平台主题与客户作品品牌分开，官网更新不自动覆盖已发布资源。

## 8. 唯一 Codex 内核的权威定义

CORE01 的实际集成、配置与准入以 [Codex 设计](technical/02-runtime-and-ai-gateway.md) 为准，已同步 [架构](technical/01-architecture-and-stack.md)、[数据约束](technical/03-data-model-and-lifecycle.md)、[开发包](technical/08-development-and-delivery.md) 及 [决策 D03/D11](governance/01-decisions-assumptions-and-questions.md)。机器契约 x-runtime-policy、角色目录 kernel 常量与静态核查共同防止方向回退；真正的配置/执行拒绝行为按 TC-044/075 实测。

## 9. 工作区路径

PATH01 指定 `D:\dev\copypasted\自有agent\` 为唯一开发、构建与执行根目录，所有文档、文档工具与核查报告在其 docs 子目录维护。具体操作及兼容入口以 [路径规范](governance/03-workspace-and-path-policy.md) 为准；迁移不新增或删减产品需求。旧入口和迁移备份不得作为第二套开发工作区。

## 10. 完整后台的权威定义

ADMIN01 的页面、用户/消耗、人工费用/VIP、内容与角色职责以 [后台产品分册](product/08-admin-dashboard.md) 为准，身份、权限、事务、API、迁移及工作包以 [控制面技术分册](technical/11-admin-control-plane.md) 为准。机器权限键以 [权限目录](contracts/admin-permission-catalog.json) 为准，OpenAPI 显式声明独立 AdminSession、动作权限和追踪。M1 与 M2 范围分别验收；所有产品用例仍为 not_run。

## 11. 管理员账号生命周期增量

0.3.0 邀请、本人邮箱/MFA、账号状态/会话控制与 AD01 的实际对应见 [身份生命周期](technical/14-admin-identity-lifecycle.md)，证据见 [0.3.0 验收](quality/06-admin-identity-acceptance.md)。0.1.0、0.2.0 验收及机器原始报告保留历史版本；新检查不批量修改 102 条综合用例的 not_run 状态。

## 12. 云端日历增量

0.4.0 每日/每周、时区、明确执行授权、配置版本、漏跑/重叠、后台暂停恢复与删除见 [定时技术约束](technical/15-cloud-workflow-schedules.md)，实际时钟和跨端证据见 [0.4.0 验收](quality/07-cloud-schedule-acceptance.md)。早期版本原始验收保留，不用增量测试代替全量产品准入。
