# M06 广告、网站、SEO 与 GEO 分析

<!-- stage64-current-report-task-source-fences:start -->
原始分析与 SEO 报告的通用任务历史现执行相同来源治理，包括活动 SSE 的后续消息。分析数据集、原始 CSV、产物和终态任务的保留期在清理前生效。见[阶段 64 实现](../technical/64-task-source-visibility.md)与[绑定回执](../quality/task-source-checkpoint.json)。网站/CMS 写回、GEO 和完整 TC-029 继续跟踪。
<!-- stage64-current-report-task-source-fences:end -->

<!-- stage63-source-governed-website-changes:start -->
当前已补齐来源治理的「保存修改任务」子流程：选定冻结问题、独立预算、私有普通任务、Codex 草稿、下载和明确复查。见[实现细则](../technical/63-source-governed-website-change-tasks.md)及[绑定证据](../quality/seo-change-checkpoint.json)。网站/CMS 写回须另行授权；Search Console 在诊断内的连接指标、GEO 观测、正式站点与完整 TC-029 保留。下方前期范围说明是历史记录。
<!-- stage63-source-governed-website-changes:end -->

<!-- stage62-scoped-seo -->
本阶段已实现的范围见[网站诊断与复查](../technical/62-scoped-seo-audits.md)和[实际回执](../quality/scoped-seo-checkpoint.json)。GEO 的固定提示、模型、产品、地区、语言和检索观测仍单独跟踪；普通 HTML 检查不能替代 GEO。完整修改任务与规范 TaskDTO 仍待交付。

当前实现增量：CSV/XLSX 固定来源版本、规范导入、实际单元格定位、更正链和依赖删除见 [文件导入与更正链](../technical/29-file-imports-and-correction-lineage.md)；AnalysisSpec 和报告任务见 [报告任务](../technical/28-analysis-report-tasks-and-evidence.md)。以下完整模块目标继续保留，不能以局部验证替代。

关联：REQ-023–031。分析模块拥有数据快照、计算口径、证据与报告，平台凭证由 M07 管理。

## 1. 数据层次与导入

保留 raw 文件/响应、normalized 标准事实、metric 计算结果和 narrative 报告四层。每层记录父快照、数据截止时间、转换版本及范围。模型读取必要的汇总及证据，不负责金额加总。

导入先识别平台和表头，预览映射并检查日期、币种、时区、账户、粒度、归因、转化定义与可用列。没有转化列是 unknown，不自动填零。CSV/XLSX 解析仅取数据，不执行宏、外部链接或单元格公式。

同文件摘要、映射版本和项目范围构成导入幂等标识。标准事实唯一键含 source、account、date、entity_level、entity_id、dimension_hash、attribution_hash 和 currency；不得把不同维度报表混为同一可加事实表。

## 2. 指标字典

| 指标   | 公式                                 | 口径与边界                                   |
| ------ | ------------------------------------ | -------------------------------------------- |
| CTR    | clicks / impressions                 | 比率原值；界面按百分比显示                   |
| CPC    | spend / clicks                       | 同币种、同范围计算                           |
| CPM    | spend × 1000 / impressions           | 无曝光不可计算                               |
| CVR    | conversions / clicks                 | 明确采用的 conversion definition             |
| CPA    | spend / conversions                  | 无/未知转化不可计算                          |
| ROAS   | conversion_value / spend             | 归因转化价值 / 广告费用，不等同净利润        |
| 变化率 | (current − previous) / abs(previous) | previous=0 时显示新增/不可比较，不显示无穷大 |

所有分母为零时结果为 null 并带 reason；必要输入缺失时结果 null，不当零。聚合先加可加基础指标再算比率。金额和比率采用 Decimal，计算保留至少 8 位小数，显示才四舍五入。

跨币种默认分组，启用汇率换算必须记录 rate、source、date 和转换版本。Google、Meta 及 GA4 的归因结果分别呈现；没有事件级合法关联和去重策略时不输出统一去重转化。

例如两行曝光 1,000/9,000、点击 100/90，应得到合计 CTR 190/10,000=1.9%，不能平均成 5.5%。完整固定算例见 `contracts/analytics-metric-vectors.json`。

## 3. 分析请求与报告

AnalysisSpec 包含项目、来源快照/连接、账户、区间、时区、币种策略、维度、指标、比较区间和业务问题。查询执行后冻结 Snapshot，报告保留 spec_hash 及公式版本。

报告依次展示覆盖范围与数据时间、关键数字、变化与异常、可能解释、证据和下一步测试。每个关键数字带 evidence_id，能定位查询/文件、过滤范围和计算值。模型不得在 final narrative 中改变工具返回的数字；生成后执行引用和数字校验。

低样本、追踪缺失、迟到转化、平台阈值或取数范围受限时显式说明。报告完成时即固定其快照，连接后续同步不会暗中改变历史报告。

## 4. SEO 诊断

CrawlSpec 固定 allowed_hosts、路径范围、最大页数、并发和缓存策略。只访问允许范围并遵守访问限制；重定向和每次域名解析重新检查网络边界，禁止抓取内部地址和云元数据端点。

检查标题、描述、heading、canonical、索引线索、内部链接、结构化数据和内容问题，按 URL 保存抓取时间与证据。可选页面性能数据有独立来源，不声称一次 HTML 抓取测得真实用户体验。

结果为问题清单、严重度、页面证据和修改任务。CMS 写回需要另行连接及具体授权；修改后重查形成对比版本，不保证搜索排名提升。

## 5. GEO 样本方法

Experiment 固定品牌别名、问句集、语言、地区、模型/产品、版本、检索设置和重复次数。Run 保存每个样本的实际请求配置、回答、引用 URL、时间、能力状态及费用。

统计样本中的提及率、带引用比例和同配置下的变化；引用需要对应实际回答中的来源。API 观测与消费产品界面观测分别标识，无法覆盖的产品列为未观测。配置或模型改变时标注方法变化，不直接连续比较。

所有 AI 观测调用也走内部服务。网页采样执行仍受浏览器标签页回收规则约束。

消费产品样本默认仅接收人工导入的已有观测记录；若以后自动向消费产品发起 AI 交互，必须先具备公司内部服务提供的正式能力及相应授权，不能通过浏览器自动提交绕过内部 AI 路径。未具备该能力时仅展示未观测范围。

## 6. 素材反馈与实验

CreativeMapping 关联本产品 asset_version、活动、平台 account/creative_id 和有效期，来源为正式映射或人工确认。通过文件名猜测的候选只作为建议。

表现差异转为可测假设，例如文案、视觉或受众需要复测；生成下一轮 brief 时保留证据及假设身份。A/B 测试设计与样本显著性为独立能力，不把相关变化直接当因果结论。

## 7. 故障与验收

字段错误定位原行；同步不完整不能标 complete；旧数据可用但标 stale。取数限制、零分母、重复导入、比率聚合、多币种和报表快照均有固定用例。SEO/GEO 验收验证证据和方法一致性，不以真实排名上升作为软件功能通过标准。

## 当前代码与未完成项（2026-10-19）

CSV 映射预览、原文摘要、去重、精确指标/未知原因、冻结计算、证据及 Web/源码 Desktop 下载已有实际运行证据，见 [导入与计算](../technical/27-marketing-import-metrics-and-evidence.md)。后续新增多来源 AnalysisSpec/比较、私人 Codex 报告任务、分页事实工具、数字引用检查、固定 HTML/JSON 资产及规范 Snapshot/Evidence 读取，见 [报告任务与证据](../technical/28-analysis-report-tasks-and-evidence.md)。XLSX、完整多维事实、自然语言语义/统计质量、正式连接器、SEO/GEO 和创意反馈仍按原需求继续实施。REQ-023/024 仅记为局部验证。
