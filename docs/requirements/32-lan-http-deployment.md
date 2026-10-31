# 内网部署补充 / LAN deployment amendment

本轮交付目标明确为 `192.168.31.20` 上可访问的内网 HTTP 部署，不提前配置尚未提供的正式域名。使用独立高位端口提供 Web/Admin/API，应用和数据库使用专用账户、目录与回环端口。自行安装缺少的原生环境，但必须保留已有运行服务及 `/root/cfg/` 中其他项目的 key；不调用本地 Docker/WSL 或其他虚拟化。

本次新数据库、用户、密码、内部主密钥、测试收件箱口令和管理员验证器信息必须在服务器 `/root/cfg/workmate/` 明文可读。明文保存符合本次用户指示，仍保持 root 文件访问权限；凭据值不得随源码、截图、录像或公开文档发布。

邮箱验证码及管理员独立 TOTP 权限链必须真实运行；暂时用受口令保护的本地收件箱替代 SMTP 投递。内网 HTTP 浏览器的 UUID、文件摘要、工作区建立和上传必须能够实际使用，不依赖把内网 HTTP 强制标记为安全上下文的浏览器参数。AI 与外部服务继续采用已授权假数据，任务及文件持久化。

Deployment targets the supplied LAN host over HTTP, with independent high ports, service identities, native toolchains and loopback database/upstream. Existing services/keys must be preserved. New credentials must remain plaintext in server `/root/cfg/workmate/` with root access controls and must not enter published sources/media. Real OTP/TOTP authentication and persistent task/file operations are required; the protected local mailbox replaces SMTP transport. HTTP compatibility must be verified in an actual insecure browser context. External AI/services remain synthetic until configuration is supplied.

正式域名到位后的迁移、原生客户端正式端点构建与 Windows 专属云执行配置的边界见 [部署手册](../releases/lan-176.md)。
