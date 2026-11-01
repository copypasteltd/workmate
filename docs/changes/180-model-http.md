# 移除每模型公网 HTTP 拦截 / Remove public HTTP blocking for models

- 每模型配置保存和实际请求均支持 HTTP/HTTPS，取消公网 HTTP 的 HTTPS 强制要求。
- 内网选项仅表示允许访问公司私有地址，后台提示同步更新。
- 当前 `gpt-6-luna` 可直接使用原已保存的接口和 Key，无须另建模型或更换连接。
- Codex 能力验证和发布审批保留原流程，连接成功不等同于完整能力验证通过。

Per-model saves and requests now support HTTP and HTTPS. The Admin explains that public HTTP needs no private-network checkbox. Existing addresses and encrypted keys are preserved. A successful connection check does not substitute for Codex capability validation or publication.

部署及实际线上检查结果以 [本轮核查记录](../quality/model-http-180.json) 为准；历史失败和原始记录保留。
