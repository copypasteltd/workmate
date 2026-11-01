# 阶段178更新 / Stage178 changes

- 模型配置表单新增独立 API Base URL、API Key 和内网范围。
- 密钥按配置版本加密保存，管理员接口仅返回配置状态。
- 新增逐模型连接测试，并将验证和实际工作路由绑定到原模型版本。
- 支持复制时明确保留密钥，更换上游后要求重新提供密钥。
- 现有任务连接保持，显式连接丢失时停止，不替换为其他上游。
- 模型就绪状态读取已发布能力，试用环境提示说明独立上游可能产生真实消耗。
- 新增 schema157、正式域名部署增量、定向证据和实际界面材料；原冻结版本不覆盖。

Each model now owns a URL and encrypted credential. Validation and work select that exact connection. Existing task versions and credentials remain unchanged. The additive deployment preserves frozen releases and existing services; real supplier qualification remains separate.
