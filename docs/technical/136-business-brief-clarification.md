# 业务问题与原任务续跑 / Business questions and continuation

云端 Codex 的 `request_input` 现在支持 `question`、`file` 和 `connection` 三种需求。问题对应尺寸、受众、统计口径等实际阻塞字段；建议选项最多八个，文字回答最多 4,000 字符。模型不能替客户填写答案，也不能通过回答取得文件、账户、本机工具或额外预算权限。具体范围见[需求](../requirements/13-business-brief-inputs.md)及[当前检查点](../quality/business-inputs-checkpoint-136.json)。

The cloud Codex tool now supports essential business questions alongside authorized files and connections. Suggestions are optional; customers may always write a different answer. Business answers do not grant resources, tools or spending authority. The linked checkpoint records exact source and evidence boundaries.

## 服务端与费用

`task-input-contracts.ts` 集中定义问题、建议选项和回答的严格结构。模型侧的问题结构没有答案或资源编号字段；文件与连接仍需对应角色工具范围。`task-dependencies.ts` 在同一已授权事务中验证整批选择、当前问题版本、所需类型、资源授权和来源状态，全部验证通过后才更新。已确认的相同答案可安全重放，不同答案不能覆盖原值；审计只记录任务、类型及资源数量，不复制回答正文。

首次执行前可由客户明确配置问题或预填资料；付费执行中的提问复用既有原生检查点。必须先完成一轮 Codex、确认计量及原生线程／回合归属，再进入 `needs_input`。原预算预留保持有效。所有所需输入补齐后，原任务进入队列，新租约在当前权限、来源、容量和预算规则下继续同一线程。最多八轮、总计三十二项输入，保留已完成工具操作的原有重放保护。信息不足或费用不确定时不能用新任务掩盖原任务状态。

确认文字回答后，在原会话写入一条包含问题与答案的用户备注，关联原任务及问题编号。重试不会新增第二条备注。问题全部补齐前保持等待；取消时只结算已经计量的处理。原会话删除仍清除问题、答案、原生检查点、工具记录和对话正文，并保留必要的费用事实。

The server validates complete batches before writing, retains version checks and current source authorization, and records one conversation note per confirmed answer. Identical replay is safe; edits to confirmed answers are rejected. Paid questions wait only at a completed, measured native boundary and resume the original task and budget. Existing cancellation, capacity, uncertainty and tool-replay protections continue to apply.

## 数据库与接口兼容

SQL135 为原输入依赖增加问题类型、建议选项和答案列。约束要求问题没有资源编号，资源输入没有文字答案，已解决的问题具有合法答案；重复或过长选项拒绝。触发器防止改写已经确认的问题定义和答案。原 SQL001–134 保持原始字节，当前 API／Worker 明确要求 SQL135，旧版本数据库须先完成迁移。

来源校验与发布来源收集原先把所有非文件输入视为连接。新迁移仅对当前函数中的两处确切分支增加 `connection` 条件，保留后续迁移已增加的来源、媒体、流程和权限检查；业务答案不会产生虚构连接引用。找不到唯一预期分支时迁移失败，不用宽松替换继续启动。

原有二十项 `task-schemas.json` 定义及主 OpenAPI 保持原始字节。新结构位于 `contracts/business-inputs-v1.schema.json`，注明基线摘要，沿用原 Money、角色、模式及其他条件，仅为创建与补交输入注册显式的补充定义。既有 URL 继续支持原文件／连接请求；文字回答使用 `answer`，不能与 `resource_ids` 混合提交。

SQL135 is additive. Original migrations and the twenty baseline task schemas remain unchanged. Strict constraints and immutable confirmed answers preserve input meaning. Two exact source-function branches now distinguish connections from questions while retaining later governance changes. A versioned schema supplement extends the existing input endpoints without weakening original Money or task-scope conditions.

## 客户端

Web 的原会话和任务详情显示问题卡片，建议按钮只填入编辑框，用户仍需确认。繁中／英文切换保留未提交文字，提交期间禁用该表单；失败保留回答并显示错误。

Extension 的 `ConversationState` 只在当前任务等待输入时读取依赖，先确认会话、任务与来源可用，再把问题交给原对话渲染。问题草稿仅保留于当前界面内存，切换语言继续显示；切换身份或会话会清除。请求失败或来源不可用会清除受保护问题及旧正文。回答期间已经发出的旧轮询完成后，再读取权威状态；旧身份的迟到响应不能回填新会话。高级任务详情也兼容同一回答接口，但原对话回答不要求展开高级工具。

Desktop 维护相同的云端任务问题组件。本机 Codex 的原生 `requestUserInput` 仍遵守原有本机权限、会话与中断规则；本阶段没有把云端任务当成本机执行，也没有增加本机权限。无边框、无 Electron 默认菜单和无可见滚动条要求继续适用。

Web and the native Chrome Side Panel display questions in the original conversation. Drafts survive language changes; no suggestion is submitted automatically. Extension clears protected questions when access fails and rejects stale identity responses. Desktop's cloud task view remains compatible; its separate local Codex question and permission flow retains its existing behavior.

## 可复查范围

[检查点](../quality/business-inputs-checkpoint-136.json)保存实际通过的后端、客户端、构建、截图与录制来源，并保留原失败记录。后端原生检查使用实际固定版本 Codex 与合成 Responses 服务；页面旅程用合成业务回复及受控工具调用验证界面、任务与费用链路。两种范围分别登记，不能把页面夹具称为真实模型生成。

本阶段不据此关闭全部专业角色或自然语言理解质量验收，不代表真实 Image 2、视频、广告账户或生产模型已经验收。继续遵守用户授权的假数据阶段。全部工作位于规定的 D 盘路径，使用原生数据库，关闭本次创建的浏览器、客户端及服务。

Native integration uses the actual pinned Codex binary with synthetic provider responses. UI journeys use controlled tool calls and synthetic business replies. These scopes remain separate; neither establishes full specialist qualification or live media, advertising and production-model acceptance.
