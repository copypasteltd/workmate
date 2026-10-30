# 工作流交接补充 / Workflow handoff supplement

本补充映射原REQ032，并保持原SRS及全部验收范围。仅描述本轮已实现的私有云端／本机顺序流程，不替代团队图、其他业务路径或正式环境验收。

| 编号 | 约束 |
|---|---|
| WF145-01 | 每次运行冻结输入步骤选择、角色、预算、失败策略及定义摘要。 |
| WF145-02 | 只能选择唯一前序产出步骤；审批、自己和后序引用必须在收费前拒绝。 |
| WF145-03 | 完整文本与原始交付版本单独保存，截短收据不得冒充完整成果。 |
| WF145-04 | 按固定版本和摘要读取；后续修订不静默替换既定输入。 |
| WF145-05 | 来源撤回、删除、过期或权限失效后停止后续读取／执行。 |
| WF145-06 | 私有文件不能因知道ID而被其他用户、项目或租户读取。 |
| WF145-07 | 模型不能确认预算或人工略过；必须由当前客户明确决定。 |
| WF145-08 | 默认失败停止；已知且结算完成的失败可等待确认，绝不自动重试。 |
| WF145-09 | 未解决外部操作、未知用量、撤权及来源错误不得走略过入口。 |
| WF145-10 | 需要失败成果的步骤必须停止；独立步骤才可继续。 |
| WF145-11 | 略过不抹除费用和失败；最终整体状态保留失败。 |
| WF145-12 | 重复确认、并发推进与过期状态不得重复创建任务或费用预留。 |
| WF145-13 | Desktop保持客户本机Codex、原目录及授权；不得云端接管。 |
| WF145-14 | Extension保持原生右侧对话／附件；云端流程确认使用既有Web入口。 |
| WF145-15 | 关闭的窄屏导航必须视觉隐藏且不可命中，正文不能被残留侧栏遮挡。 |
| WF145-16 | 旧截短成果缺少完整保存内容时明确停止，不制造历史或自动重跑付费步骤。 |

These requirements supplement the original SRS. Qualification is bounded to the selected synthetic-model workflows, exact retained file versions and real customer control journeys; complete professional and production acceptance remains unchanged.
