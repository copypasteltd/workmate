# 模型独立连接配置 / Per-model upstream connections

本补充落实用户要求：接口地址和 API Key 随每个模型配置保存。新增 `gpt-6-luna` 时，管理员在同一表单填写该模型的上游和密钥；不同模型可以使用不同上游、不同密钥。它补充此前仅管理模型别名、费率的能力目录。

Each model configuration owns its upstream API base URL and API key. A new `gpt-6-luna` entry specifies its connection in the same form; other models may use independent servers and credentials.

1. 入口为 Admin → 角色与内容发布 → 模型能力 → 建立配置；文字、图片、视频、语音、转写共用连接表单。
2. 必填模型别名、API Base URL、API Key 和原有能力／费率。复制既有配置时可以明确保留该来源版本的密钥；更换地址或内网范围后必须提供新密钥。
3. 密钥只在公司后端保存，使用已有 MASTER_KEY 加密；客户、浏览器、扩展、桌面端不获得供应商密钥，管理员读取接口也不回传完整密钥。
4. 保存、连接测试、能力验证、审批发布分别执行。连接测试读取指定上游的 `/models`，不执行推理；不支持模型列表的上游仍可进入原有完整能力验证。
5. 实际请求按工作确认的能力版本选择连接；验证按模型配置的连接执行。旧任务、其他模型、历史版本不随新版本保存而被改写，缺失显式连接不得回退其他密钥或演示上游。
6. Codex 仍是唯一内核。文字上游需要支持 OpenAI Responses API，只有 Chat Completions 的服务不能冒充已兼容。媒体继续使用原有对应协议及资格流程。
7. 正式域名、现有登录和企业数据模式保持。试用账本／未接入服务可继续模拟；独立模型连接会访问其实际上游，真实验证和执行可能消耗该上游额度。上线本次入口不会自动配置或启用任何真实供应商密钥。

The form, server storage, probe, capability verification and execution must all use the model-bound connection. Credentials never reach native clients. New versions preserve old task bindings and missing explicit connections fail closed. Trial accounting remains distinct from actual upstream calls. Existing historical versions retain their explicitly documented environment fallback.
