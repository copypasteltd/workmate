# 阶段177：正式域名部署 / Stage177: public domains

- Web、后台、API 正式域名及 HTTPS 登录配套上线；后台域名采用用户修正后的 `agent-dashboard`。
- 修复 HTTPS 代理下模拟部署的 Cookie 标志，以及首次邮箱登录与匿名状态检查的并发冲突。
- 发布 Desktop 0.7.2 与 Extension 0.5.3，固定正式端点，保留本机 Codex、无边框、隐藏滚动条和右侧 Side Panel。
- 增量部署、独立回退备份及下载清单；保留原凭据、23份外部配置和61个无关运行服务，未调用 Docker/WSL。
- 同步六仓中英说明、实际页面/交互媒体、检查记录及源码增量；旧发行包和失败记录保留。

Enable confirmed HTTPS hostnames and matching authentication. Correct Secure-cookie selection and anonymous-bootstrap login races. Publish native clients with official endpoints while preserving their existing execution/permission model. Deploy additive, reversible overlays; retain credentials, unrelated services/configuration and immutable release artifacts. Publish bilingual guides, actual captures and source increments.
