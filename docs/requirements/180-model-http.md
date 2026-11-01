# 模型接口支持 HTTP 和 HTTPS / Model upstream HTTP and HTTPS

管理员为每个模型填写的上游 API Base URL 可以使用 HTTP 或 HTTPS，公网 HTTP 无须勾选内网选项。保存配置、连接测试、完整能力验证以及实际推理使用同一协议规则，不得再次以 `MODEL_CONNECTION_HTTPS_REQUIRED` 拦截公网 HTTP。

Administrator-configured per-model upstreams support HTTP and HTTPS. Public HTTP does not require the private-network option. Saving, connection tests, full validation and inference follow the same transport policy.

本轮不要求修改已有模型地址或 Key，也不自动发布未验证的模型。内网选项只控制私有地址访问。此项更新取代此前关于每模型公网接口必须 HTTPS 的限制。

Existing model addresses, encrypted keys and publication decisions remain as configured. The private-network option controls private address access. This requirement supersedes the earlier per-model public HTTPS requirement.
