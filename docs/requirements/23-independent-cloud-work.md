# 云端会话独立多工作 / Independent cloud work

本项细化REQ-061以及product/05-web-agent-workbench.md第5节；该产品文档明确约束Web。SRS的REQ-061–072是扩展设计建议，不能说成用户逐字提出的要求。technical/86及93曾明确记录普通会话单活跃限制；本次对云端提交能力取代该实现约束，旧执行证据保留。

- 同一私有、未封存的云端会话可提交独立新工作，仍受当前套餐活跃数与执行容量约束。不同任务独立权限、固定角色/上下文、预算预留、进度、输入请求、结果与费用。团队会话仍从已审阅团队计划发起。
- 交付输入明确表示新工作。笔记不启动AI。资料补充、进度和停止针对用户选定的具体任务；切换任务不把新工作草稿默默改成对旧任务的指令。
- 新任务只绑定当时可用的历史结果，排除仍运行、暂停、待输入或核对中的阶段回复。已冻结引用的撤销校验、文件乐观版本冲突、计划审批的原会话版本校验保留。计划期间会话改变仍须重新审阅。
- Web同一标签页刷新后重填相同内容，可用原请求标识和原expected_version重试；存储仅含摘要键与版本，不存消息正文。关闭标签页后的全部恢复组合未宣称通过。Extension保留原正文与标识的已有回执恢复。
- 真正Desktop本机继续一条Codex线程的单轮所有权；独立本机会话和已审批团队可并行。本次同步的是共享云端renderer，实际本机/app/conversations仍是LocalAgentWorkspace；不可据此宣称修改了本机操作能力。

English: each cloud delegation is independent work within the current plan. Select the exact task for progress, input and cancellation. Nonterminal assistant checkpoints are omitted only when freezing a new task; all frozen-source checks remain. Native Desktop thread ownership and local-session/team concurrency are separate.
