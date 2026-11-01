# 模型完整验证修复 / Full model verification repair

当前问题是后台「配置與驗證」中的真实文字 Agent 验证失败。本轮修复必须让用户已保存的 `gpt-6-luna`、每模型 API 地址、加密 API Key、推理强度和费率进入原有完整 Codex 流程。连接测试通过不等于工具与对话完整验证通过。

The current defect affects the real text-agent validation in Admin's Configuration & validation panel. The saved model, its own upstream/key, reasoning effort and rates must pass the complete original Codex flow. A successful connection test does not establish a successful agent tool round trip.

1. 同时支持固定 Codex 的普通 function 工具格式及 `additional_tools` 中的原生 code mode。工具编排入口只能使用本任务已注册的业务工具，业务参数、租户、授权和预算检查保持生效。不得将 `functions.exec` 混同为操作系统命令或直接开放云服务器权限。
2. 完整验证必须真实完成指定模型请求、一次 nonce 绑定的工具调用及结果返回、最终文字回复，以及可核对的用量记录。不得强制伪造工具成功、跳过工具环节或改用其他模型。
3. 将实际失败代码保留到后台回执和请求记录；不能在主动取消错误流时将它覆盖成无关的取消错误。上游已接受但费用不明的历史记录继续保留待对账，不能凭修复成功将旧记录改为零费用或通过。
4. 文字验证失败或待对账后，可以在原有预算与权限检查下重新创建独立验证；运行中的验证、音视频未解决的对账仍受各自规则约束。后台用中英双语解释具体错误。
5. 原生工具上下文的上游预估量可能不足；必须在派发前预留完整上下文的保守费用上限，并按实测量计费。保留历史精确计数规则、预算限额与违规记录，不能简单关闭费用校验。
6. 真实上线验证使用当前保存配置，记录实际页面、交互录制和检查结果；文档与对应仓库同步。不得影响现有其他服务、凭据、冻结版本或用户文件。

Support both pinned native tool formats; retain registered business authority and real billing. Verification must include the nonce-bound tool/result round trip, final text and known usage. Preserve specific failure codes and uncertain historical spending. Permit independently budgeted text retries while retaining active-run/audio/video controls. Publish actual evidence and bilingual guidance without changing unrelated services, credentials, frozen releases or user files.

[开发与操作 / Implementation and use](../development/181-model-tool-contract.md) · [变更 / Changes](../changes/181-model-tool-contract.md)
