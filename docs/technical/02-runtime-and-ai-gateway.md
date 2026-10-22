# Codex 内核与内部 AI 网关集成

实施状态：本分册保留长期设计约束；本轮锁定版本、实际 API/工具、各端实现与差异，以 [实际开发清单](12-implementation-and-repositories.md) 和 [运行验收](../quality/04-implementation-acceptance.md) 为准，未实现项没有删除。

[短期凭证与逐次鉴权](55-scoped-internal-inference-requests.md)补充当前统一出站入口、真实 Codex 内核工具约束、完整 SSE 帧检查、逐请求当前权限、图片规格及费用状态；正式回归记录在该分册独立维护。跨 Worker 供应商限额与逐调用预算仍是后续完整实现要求。

阶段 52 的 [任务能力版本与原价冻结](52-capability-versions-and-frozen-task-pricing.md) 已将模型别名、推理强度、协议、费率和网关指纹绑定到具体任务。Worker 与图片工具使用原绑定，重试继承；仅默认配置改变不会静默改用新版本。受控后台发布/回滚、用户可见的版本采纳及短期逐请求网关凭证仍是完整设计要求，尚未以本次基础实现宣告完成。


版本：1.4 · 2026-10-18。CORE01 明确 **Codex 为唯一 Agent 内核**，适用于默认助手、全部专业角色、团队成员、后台计划及三端相关运行。所有接口名中标为产品适配器的内容为本系统设计，不是 Codex 原生 API 承诺。

## 1. 适配器边界

```typescript
interface CodexRuntimeAdapter {
  start(ctx: RunContext): AsyncIterable<RuntimeEvent>;
  resume(ctx: RunContext, checkpointId: string): AsyncIterable<RuntimeEvent>;
  requestStop(runId: string, reason: string): Promise<StopReceipt>;
  describeCapabilities(): Promise<RuntimeCapabilities>;
}
```

RunContext 固定 tenant/project/task/attempt、agent_version、capability_version、input_refs、scope、budget_ref、workspace 和 fencing_token。适配器提供执行事件，不自行决定企业权限和账单金额；云端业务工具通过受控工具服务，Desktop 的本机文件、终端及工具按客户在本机选择的实际权限执行。

适配器只承担产品与 Codex 协议/版本的转换；不建设多内核插件、内核选择器或自动切换机制。Codex 内核与底层推理模型分别配置，锁定内核不改变用户指定的内部模型与媒体能力。

RuntimeEvent 映射为状态、可见消息、工具开始/结束、检查点、产物、用量和错误。原生会话 ID 与产品 task/attempt 映射持久保存；重连先查询或恢复原运行，不盲目新建。

## 2. Codex 集成路径

采用 Codex app-server 集成：Web/Extension 由云端 worker 托管，Desktop 必须由客户本机 main process 托管。通过本机 stdio 双向消息管理初始化、会话、turn、事件及授权交互；原生控制接口不直接暴露公网。Codex 官方支持 app-server 与按运行版本生成的协议 schema，产品将这些原生消息映射到自己的任务与事件。[官方集成说明](https://learn.chatgpt.com/docs/app-server)

内部 provider 指向公司网关，按官方当前配置使用 Responses。完整流式事件、历史输入、工具调用和调用结果必须端到端保留；健康检查和普通文本答复不能代替运行验证。[官方网关要求](https://learn.chatgpt.com/docs/enterprise/gateway-compatibility)

接入时依据锁定 Codex CLI/app-server 版本生成/核对协议 schema，将原生事件映射到产品事件；不把官方 app-server JSON-RPC 与面向客户的 REST API 混用。provider 的 wire_api 按已核查的官方配置采用 responses；具体版本、内部 alias 及参数经真实集成后冻结。[配置依据](https://learn.chatgpt.com/docs/config-file/config-reference)

## 3. 唯一内核与配置约束

| 层级 | 必须约束 |
| --- | --- |
| 运行配置 | runtime_profiles.kernel 固定 codex，启用前固定 Codex 版本、包摘要、协议 schema 与验证状态 |
| 角色和团队 | 默认助手、18 个预设、定制模板、团队成员和 Routine 只解析到获准 Codex 配置 |
| 发布和调度 | 创建/发布模板、实例化、任务开始/恢复时校验内核、版本、依赖和当前权限；运行冻结对应版本 |
| 客户输入 | 不接受替换 Codex 内核程序或 provider 地址；Skill 和上传配置不能改平台强制配置。Desktop 完整模式允许在客户授权下运行本机终端命令与程序，这不等同替换 Agent 内核 |
| 故障和升级 | Codex 缺失或未验证时阻止启动；运行故障按检查点和既有重试规则处理，禁用自动切换其他内核；回滚仅回到已验收的 Codex 版本 |
| 内部 AI | 所有 Codex 推理、媒体工具和 Skill 中 AI 请求经过公司内部服务器；不使用客户个人模型登录代替内部路由 |

按用户 2026-10-22 的 [CLIENT01](../requirements/03-client-execution-amendment.md)，Web/扩展使用云端 Codex，Desktop 必须使用客户本机 Codex。Desktop 由产品安装/管理锁定版本，提供受限与客户可授予的完整本机权限模式；不能沿用云端 read-only/禁 shell 配置来限制完整模式。所有推理和媒体 AI 仍经内部网关；产品权限、账单与平台连接仍由企业平台管理。阶段 72 已接入独立本机 Codex、客户授权和任务级公司推理凭据；原有文件桥保持可选，具体实现和资格边界见 [本机执行及控制面](72-desktop-local-execution-and-control-plane.md)。

## 4. 模型标识与能力协商

用户指定的 `gpt 6 luna max` 暂保存为现有能力说明。可能映射到 `gpt-6-luna` 与 `reasoning.effort=max`，但网关实际别名必须由内部配置确认。

官方模型资料对 Chat Completions 推理/工具路径有约束，接入按 Responses 工具循环验证。模型支持图片输入并不证明内部媒体生成功能开放，媒体工具分别登记。[模型说明](https://developers.openai.com/api/docs/models/gpt-6-luna)

每个 capability 记录经验证的协议、参数、工具类型和输入限制；服务端先拒绝不支持字段，不静默删除或换模型。客户端获取的是产品能力目录，不是供应商原始密钥或可任意修改的 base_url。

## 5. 请求控制与网络边界

业务 worker 以短期、范围化内部凭证调用网关，附内部可信的 tenant/task/operation/capability 归属。外部客户端传来的计费归属 header 不能直接信任，必须由服务器重建。

网关及代理保留成功/失败终止、限流和错误信息。整体任务、单次调用和流空闲超时独立配置；SSE 中断先判定上游是否已接受与是否可查询，不自动重放可能计费的创建请求。

仅设置环境变量不能确保 AI 路径约束。执行工具目录、插件审查和系统网络出口策略共同禁止直接访问未批准 AI 地址；产品也不允许用户插件携带任意供应商 Key 绕过内部服务。

## 6. Codex 集成 PoC 与准入

在固定 Codex 版本和原有内部模型要求下验证：多轮文件/计算工具、带图素材分析、真实生图、可修改排版、模板视频、报表计算、断线继续及取消。记录输入、版本、工具协议、实际文件、费用、失败和修改次数。

本阶段验证 Codex 与内部网关的兼容性和业务准入，不再比较或选择内核。G01/TC-044 必须覆盖工具闭环、流式事件、权限、取消、恢复、费用，以及非 Codex 配置/客户覆盖被拒绝。未通过则修复 Codex 适配、网关或受影响能力，并暂停其发布；不静默替换内核、模型或推理强度。

## 7. 升级与故障处理

内核升级用固定样例回归事件映射、授权、停止和用量；新版本小流量验证再扩大。模型/媒体不可用时暂停对应新任务，已有任务显示实际状态，避免输出占位文件充当成功。

## 8. 角色预设与 Skill 加载

全部角色执行内核固定为 Codex，RunContext 增加 template_version_id、preset_definition_hash、runtime_profile、skill_version_ids/content_hashes、模型能力版本及工具白名单。平台提供已验证包的受控只读入口，先提供发现元数据，进入对应步骤时显式加载必需 Skill，按需读取脚本/资源。记录加载的包、版本、摘要与步骤，不记录隐藏推理。Codex 支持的具体装载接口/路径与版本由真实 PoC 确认；这些产品字段不是原生 API 字段。

绑定只能来自有效安装、项目策略、角色配置、资源授权和实测能力的交集。必需包或摘要不匹配阻止该步骤；可选包按任务需求检查。不能仅在 system prompt 写「你是设计师」就视为已加载设计方法。候选本机技能需改造成生产包，逐项审查固定路径、显卡、外网和虚拟化依赖；本地验证仍仅用原生环境。

文本模型保留用户 gpt 6 luna max 的要求，内部精确映射待验证。Image 2 使用独立 internal-image2-v1 配置，公开模型名 gpt-image-2 只供对照，internal_model_alias 当前为空；禁止静默切换模型。调用 Images 生成/编辑的具体标准协议及参数在公司网关实测，所有调用经受控工具服务走内部地址，客户端和 Skill 不携带供应商主密钥。

M0/角色发布执行 G08：固定 Codex 版本实际加载技能、正确工具循环、真实 Image 2 生成/编辑、准确排版及修改；确认失败、取消、恢复与费用。角色目录及 schema 中 kernel 固定 codex，不提供等价内核分支。

官方边界参考 [Skill 包说明](https://learn.chatgpt.com/docs/build-skills)及 [Image 2 模型资料](https://developers.openai.com/api/docs/models/gpt-image-2)；本公司的模板、发布资格和内部模型映射由本产品实现和验证。
