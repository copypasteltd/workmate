# 工作流内容治理补充 / Workflow content governance

拆分既有 REQ-090、091、094、098；不新增完整需求编号，不缩减原验收范围。This elaborates existing requirements and does not replace their whole acceptance.

| 编号 | 要求 / Requirement |
|---|---|
| WF-H01 | 管理员可从统一内容目录阅读共享、私有云端及本机工作流的全部实际保存定义，50版分页、双向与首尾导航。Read every retained shared/cloud/native definition through bounded reversible pages. |
| WF-H02 | 共享旧数据仅在迁移时保留当前版，标明迁移快照时间；不得重建缺失历史或假冒历史操作者。Preserve only the actual migration snapshot and subsequent saves, without invented provenance. |
| WF-H03 | 保持独立管理身份、正文与目录双权限、精确范围、显式拒绝、原会话和近期MFA。Keep independent scoped administration, both permissions, current sessions and recent MFA. |
| WF-H04 | 定义依据其冻结来源阅读；旧创建任务到期不永久封锁有效定义，调查根自身隔离/归档与外部来源撤回分开。Read exact frozen sources, independently of expired creator tasks; distinguish root investigation from dependency withdrawal. |
| WF-H05 | 来源撤回后，新历史及旧正文入口一致隐藏相关正文、来源内容与摘要；来源竞争返回重试。Both old and new readers withhold withdrawn bodies and sensitive version details. |
| WF-H06 | 保存、发布元数据或治理变化后旧游标失效；游标不能跨对象、账号或会话。Changes invalidate signed, identity-bound cursors. |
| WF-H07 | 工作流运行显示当前执行快照；固定输入、子任务、输出撤回后隐藏缓存正文。不把当前快照称为执行状态历史。Execution views revalidate fixed sources and are explicitly current snapshots, not fabricated state histories. |
| WF-H08 | 可见页面每15秒及聚焦时复查，读取失败、权限变化、切换身份/对象后清除正文；无浏览器正文持久化。Recheck visible views and clear private state on changed access or identity. |
| WF-H09 | 永久删除清除新增共享历史；已删除范围禁止重新写入；完整授权资料导出包含可用共享历史并过滤撤回版本。Connect saved history to permanent erasure, admission fences and complete authorized exports. |
| WF-H10 | 阅读不启动Codex、任务、预留或费用；保留CopyPaste繁英界面、实际截图及录制。Reads create no paid execution; preserve the bilingual brand UI and actual media. |

私有云计划/事件按各自原规范继续仅供后台查看元资料与暂停，不借本补充开放客户私有正文、签名密钥或付费恢复。Private schedule/event restrictions remain governed by their original specifications.

[设计与实现 / Design](../development/153-workflow-content-history.md)
