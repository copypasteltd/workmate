# 后台完整内容历史需求补充

本补充拆分既有REQ-048、REQ-090、REQ-091、REQ-094和REQ-098的历史阅读要求；不新增一组独立完整验收记录，也不以本项通过替代完整后台交付。

| 编号 | 客户／管理员行为要求 | 验收方式 |
| --- | --- | --- |
| HIST-R01 | 管理员从统一用户端内容列表查看完整会话、专家和记忆历史 | 实际页面到达最早与最新记录，不能在200版后无提示截止。 |
| HIST-R02 | 长历史逐页读取，并提供前后翻页和首尾入口 | 每页最多50条；相同时间消息、超过200版内容不得漏读或重复。 |
| HIST-R03 | 记录保持原文、原时间、原版本和修订来源 | 客户与管理员版本清晰区分，HTML不执行；专家配置与记忆定义可完整查看。 |
| HIST-R04 | 读取受当前后台账号、正文权限及企业项目范围约束 | 缺权限、跨项目、显式拒绝、旧会话和移用游标均拒绝；MFA不能被阅读入口绕过。 |
| HIST-R05 | 内容变化后不把不同状态拼成同一段历史 | 客户更新、消息变更、审核变化和过期游标要求重新读取。 |
| HIST-R06 | 来源不可用、内容删除或授权撤回后遵守当前限制 | 助手来源被隔离时隐藏其正文；删除后不返回旧版本；页面复查失败后清空正文。 |
| HIST-R07 | 不在切换账号／对象时显示旧正文 | 关闭或切换后取消旧请求；真实迟到响应不能填入其他内容，浏览器存储不保留正文及游标。 |
| HIST-R08 | 阅读与付费执行分开 | 翻页、刷新和权限复查不建立任务、费用预留或模型请求；只记录最少阅读审计。 |
| HIST-R09 | 遵守现有品牌和双语可用性 | 现有CopyPaste后台样式，中英文本，窄屏不横向溢出，支持键盘关闭。 |
| HIST-R10 | 兼容旧调用方并如实提示限制 | 旧正文响应保留字段，并提供截断标记和完整历史地址。 |

普通客户会话仍有80条输入限制；完整后台历史阅读不代表放开该客户侧限制。可见页面每15秒及重新聚焦时复查，不承诺离线时收到即时撤权通知。后台调查可在授权范围内阅读隔离／归档内容；已删除内容按删除策略不可读。

[实现与接口方案](../technical/132-admin-content-history.md) · [实际检查点](../quality/content-history-checkpoint-132.json) · [原始证据](../quality/content-history-evidence-132/index.json) · [完整编号待办](../quality/remaining-work-stage132.md)

English: This supplement decomposes existing administrator content and access requirements. It requires complete bounded history, original provenance, live scoped authorization, stale-page rejection, private-state cleanup, no paid work on reads and the existing bilingual brand system. It leaves the ordinary customer input limit and all broader acceptance records intact.

<!-- business-history-stage144 -->
## 业务资源历史补充 / Business history supplement

| 编号 | 要求 / Requirement |
|---|---|
| HIST-R11 | 统一阅读品牌、团队、项目简报、自动化计划，以及普通画布／视频／矢量／演示稿／批量设计的实际已保存历史；保留原三类入口。Read retained business and all five creative histories alongside the original readers. |
| HIST-R12 | 普通画布后续保存形成不可变历史；已有数据只保留迁移时当前版，未知历史与操作者不得编造。Retain future canvas saves; preserve only existing migration snapshots and never invent missing history or actors. |
| HIST-R13 | 批量设计按作品及版号区分；新客户品牌保存记录真实操作者；来源撤回、权限和删除同样约束正文。Keep distinct work/version identities, actual actors for new brand saves and current withdrawal/permission/erasure constraints. |

[实现与验证 / Implementation and validation](../development/144-admin-business-content-history.md)。这是既有完整内容治理要求的补充，原完整验收不缩减。This elaborates existing full content governance without narrowing its acceptance scope.
