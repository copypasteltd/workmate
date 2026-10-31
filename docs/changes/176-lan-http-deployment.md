# 176 · 内网部署变更 / LAN deployment changes

1. 使用指定 Ubuntu 服务器，在 HTTP `63070`、`63071`、`63072` 提供 Web、Admin、API；后台与 PostgreSQL 使用独立回环端口。
2. 新增隔离原生运行环境、专用用户及三个独立自启服务，凭据明文保存在服务器 `/root/cfg/workmate/credentials.txt`。
3. 提供带独立操作口令的测试收件箱，保留用户 OTP 与管理员 OTP/TOTP 完整登录逻辑。
4. Web/Admin 增加内网 HTTP 所需的安全 UUID、SHA-256 与复制兼容，修复公开演示配置与首次会话读取的并发问题。
5. 保留所有原失败及 `v0.1.3` 冻结字节；使用独立前端更新包和相应源码。补充真实 HTTP 页面、任务、文件、后台核查和媒体。
6. 正式域名/HTTPS、SMTP、真实供应商、原生客户端正式端点构建，以及 Windows 精确云端运行配置在 Linux 的替代方案均按手册明确边界。

Deploys private-IP HTTP Web/Admin/API on independent high ports, dedicated native services/database and explicit plaintext server credentials. Adds a protected development mailbox, secure HTTP browser fallbacks and a public-config/session race fix. Original failures and frozen release bytes are retained; the frontend overlay has matching buildable sources. See [deployment guide](../releases/lan-176.md) and [implementation](../development/176-lan-http-deployment.md).
