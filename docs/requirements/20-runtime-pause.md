# 云端任务安全暂停与继续 / Safe cloud pause and resume

这是原REQ-009及后台REQ-092的细化，不增加原始需求数量。本增量在首个冻结版之后，未加入冻结安装包。

| 编号 | 需求约束 / Requirement |
|---|---|
| 1 | 客户或具有精确项目范围的管理员可以对运行中云任务请求暂停；暂停要求不等于即时中断当前轮次。 |
| 2 | 已确认要求后禁止开始新的业务工具；已接受的操作继续完成、落账和登记结果。 |
| 3 | 仅原生模型完成轮次、用量明确且无未知工具/提供方/设备副作用时保存不可变检查点。 |
| 4 | 保留同一任务、线程、固定角色/skill/来源版本和原预算预留，不释放已发生费用。 |
| 5 | 继续时重新核对原用户身份版本、权限、套餐、skill、来源及预算，再领取名额；检查点只消费一次。 |
| 6 | 暂停前已请求补充资料的轮次，回答完成后仍保持暂停，必须明确选择继续。 |
| 7 | 取消按累计明确用量只结算一次；未知费用进入核对，不自动重放。 |
| 8 | 单任务补充输入与暂停检查点合计最多8轮；原预算耗尽不得再执行。 |
| 9 | 永久擦除清除新增执行事实；元数据接口不暴露原生线程、内部路径和其他客户资料。 |
| 10 | Desktop本机Codex控制独立保留；本次桌面修改仅涉及云任务详情。Extension保留原生右侧Side Panel。 |

A running pause records intent. The accepted current turn can continue consuming the original budget until a trustworthy completed boundary. Resume uses the original task/thread and hold after checking the original user's current authority. Outstanding answers do not silently resume a paused task.

[实现 / Implementation](../development/154-runtime-pause.md) · [接口 / API](../contracts/runtime-pause-openapi.json)
