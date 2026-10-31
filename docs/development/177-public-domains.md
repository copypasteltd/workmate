# 正式域名实施 / Domain implementation

部署入口与使用方式见 [上线手册](../releases/domains-177.md)。

后端 `secureBrowserCookie` 按配置的使用方 HTTPS origin 决定 Secure 标志；生产模式始终 Secure。此次保留 `DEMO_MODE=true`、回环绑定与 development 模式，未削弱原生产环境禁止模拟服务、要求 SMTP/HTTPS/主密钥的规则。用户/SSO 使用 Web origin，管理员使用后台 origin，发布回调使用 API origin。

The cookie policy follows the configured HTTPS audience even when the authorized synthetic deployment runs in development mode behind TLS termination. Production validation remains unchanged. Six cookie/config tests exercise real Fastify serialization and production guards.

Web/Admin 初始匿名会话检查会返回401。邮件验证码申请或验证响应可能与此检查并发；新增独立认证代次，仅明确退出及成功登录使旧认证结果失效。私有请求仍使用原会话代次，旧401不能清掉新登录，旧私有响应不得重新显示。20 项传输检查覆盖两端认证、三端旧会话与公开配置并发情形。

Separate authentication generations let email sign-in finish alongside an anonymous bootstrap 401. Explicit sign-out and a newer successful login invalidate older authentication results. Private data retains its original session-generation guard. Twenty transport checks cover these boundaries.

服务器使用独立 overlay、systemd API drop-in 和独立 nginx 配置；仅重启 Workmate API、重载其专用代理。代理按三个已知 Host 设置转发协议，未信任任意客户端传入的协议头。前端继续同源 `/v1/` 代理，避免扩大 Cookie 域；原生客户端访问 API 域名。

Additive overlays and an owned systemd drop-in preserve frozen release bytes. Only the owned API/proxy change. Protocol forwarding follows the three configured hosts. Frontends retain same-origin API proxies and separate host-only cookies. Native clients use the API hostname.

客户端：Desktop 0.7.2、Extension 0.5.3。固定本机 Codex 及四个执行文件摘要核对；真实打包 Electron 窗口和原生 Chrome Side Panel 连通正式 API。扩展默认 origin 来源改为 `deployment.json`，环境覆盖仍支持显式本地开发地址，固定扩展 ID 不变。

The native versions are 0.7.2 and 0.5.3. Exact local Codex/helper hashes and real packaged/native browser surfaces are checked. Extension defaults now come from its versioned deployment configuration; explicit local development overrides and the stable ID remain available.
