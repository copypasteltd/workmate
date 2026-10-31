# REQ-032 独立反证检查

日期：2026-10-31。检查角色：独立反证；仅阅读规范和代码，未修改运行数据、代码、测试或 Git。

## 结论

**不能推翻“流程自身缺少版本化、可声明的命名输入/输出契约及每次运行的命名业务输入”这一窄化结论。** 但必须推翻更宽的说法“平台所有可复用方法都不能接收变化输入”：解决方案包确实已声明命名资产需求、连接需求，并接受每次试运行的精确绑定和私人 brief。此现有能力应保留并复用，不能重新计为完全未实现。

权威依据为 `docs/requirements/01-srs.md:154` 的 REQ-032（版本化输入输出、步骤、工具范围、预算、失败处理、冻结版本、手动复用），以及 `docs/technical/03-data-model-and-lifecycle.md:63` 明确将输入输出 schema 列入 workflow_versions。`docs/product/01-prd.md:75` 允许成功方法沉淀为技能、解决方案包或结构化流程；因此不能自行要求只有一种复用入口。

## 逐路径反证尝试

| 已检查的替代路径 | 实际证据 | 能否推翻缺口 |
| --- | --- | --- |
| 共享业务流程 | `dev/copypaste-platform/src/business.ts:195`–210 的顶层严格仅接受 steps；Codex prompt、dataset_id 写入定义。`:451`–494 的手动运行使用空请求体作为幂等负载，复制已发布 definition，没有解析每次命名业务值。 | 不能。手动复用和固定步骤真实存在，但同一模板更换活动名、日期或数据集缺少流程契约入口。 |
| 私有云流程 | `src/cloud-workflows.ts:38` 直接复用 nativeWorkflowDefinition；`:201`–266 的 requestRun 参数只有 workflow_id、version、definition_hash，冻结相同 definition/role_hashes。 | 不能。版本冻结有效，但未接收或冻结命名业务输入映射。 |
| 私有 Desktop 流程 | `src/desktop-workflows.ts:22`–35 严格定义为 steps，只有 codex、approval、analytics.summary；`:188`–198 的 workflow_run 参数只有版本身份和 hash。 | 不能。原生执行和冻结版本存在，未声明模板自己的输入/输出字段。 |
| 已实现的前序产物传递 | `src/workflow-handoffs.ts:28`–49 保存真实文本及文件版本；`:52`–102 根据 input_steps 选择真实前序产物并校验版本/hash，支持分页读取。云端 `src/cloud-workflows.ts:1029`–1053、原生 `src/desktop-workflows.ts:300`–307 都实际绑定这些产物。 | 不能。它是步骤间已产生结果的精确交接，不能等价于运行发起者填写的、由模板声明的命名输入；产物 manifest 也不等价于模板声明的命名输出契约。不得再报告为“步骤完全没有数据传递”。 |
| 解决方案包：云端与原生试运行 | `src/solution-model.ts:22`–35 声明 required_assets/required_connectors，`:45`–90 接收命名 requirement + asset_version_id/hash、精确连接绑定和每次 brief。`src/solution-service.ts:261`–292 拒绝未知需求、校验必填资产及权限/hash；`:573`–617 将冻结方法、私人 brief 和绑定交给独立角色，按选择创建 cloud 或 desktop 任务。 | **部分反驳宽泛表述。** 这是可变输入的真实复用实现。不过这些试运行创建 solution_trials/solution_trial 任务；不是 workflow_runs，也没有流程步骤映射或流程自己的输出 schema。不能据此宣告 workflow_versions 的输入输出契约已经完成。 |
| 角色模板与 Skill schema | `src/agent-templates.ts:107`–132 有角色级 required/optional 字段、input_schema、deliverables；`src/skill-lifecycle.ts:46`–50 有 Skill 级 input_schema/output_schema。 | 不能。它们约束角色或 Skill；没有被流程定义声明、映射并在 workflow_run 输入处验证。不能把任意 schema 字段的存在当成流程契约完成。 |

表中 `src/` 均相对 `dev/copypaste-platform/`。本次另对上述工作流与方案源码定向搜索 input_schema、output_schema、parameters、input_values，未发现可替代的流程输入契约；判断以逐条调用链为依据，不以搜索空结果单独证明缺失。

## 对原检查结论的约束

1. 应报告“现有工作流模板的契约缺口”，而不是“所有方法均不可复用、均无输入、均无输出”。Solutions 的命名资产/连接需求、私有 brief、角色模板字段和现有交接是真实功能。
2. 规范没有规定某一版 JSON Schema、必须任意分支、必须图形编排，不能把这些实现偏好计为未完成需求。受限且版本化的字段类型与映射足以成为合理实现。
3. 需要补齐的是模板声明和运行验证的一致关系：声明命名输入/输出，冻结每次经过校验的输入，明确步骤如何读取输入，记录实际命名输出并检查必需交付；失败和旧版本必须保留其真实状态。无需推翻现有角色、Solutions、原生执行或前序文件交接。

检查限制：独立检查未启动服务、未运行数据库或额外测试；这是源码和权威规范层面的反证审查，不是新增运行验收记录。
