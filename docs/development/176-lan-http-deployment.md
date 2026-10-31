# 176 · 内网高位端口部署 / LAN high-port deployment

用户已授权通过 SSH 配置缺少的运行环境、部署高位端口、保留服务器原有服务，并将新凭据明文写入 `/root/cfg/`。进一步明确暂时只使用内网 IP、HTTP 和假数据。唯一开发路径、独立仓库和文档路径沿用现有规范。

The user authorized SSH deployment, missing native dependencies, high ports and plaintext server-side credentials, with existing services preserved. The current target is explicitly private-IP HTTP with synthetic data.

## 部署结构 / Deployment structure

- 专用非登录用户 `workmate`；独立 Node `24.22.2`、固定 `codex-cli 0.163.0-alpha.11`、原生 PostgreSQL 18、数据库结构 `156`。
- `63070/63071/63072` 分别提供 Web/Admin/API；底层 API `63073`、数据库 `63074` 仅绑定 `127.0.0.1`。Web/Admin 采用同源 API 代理。
- 只新增 `workmate-db.service`、`workmate-api.service`、`workmate-lan-proxy.service`。设置独立数据目录、无特权用户、资源上限、重启和开机启动；没有管理已有 Docker/VMware 或替换共享服务。
- 数据库 owner/迁移凭据与 app/control/queue 运行凭据分开。运行角色没有超级用户、建角色或绕过 RLS 权限。敏感文件 root `0600`，专用配置目录 `0700`。
- 登录保持真实邮箱挑战/验证码及 Admin 独立 TOTP。未接 SMTP 时，邮件持久化到本地，并通过带独立口令的操作收件箱查看。

Private native toolchains and PostgreSQL are used with dedicated non-login service identity, loopback-only upstream/database, three independently managed units and resource limits. Runtime DB roles retain RLS and do not receive owner credentials. OTP/MFA are enforced; only email transport is replaced by the protected local mailbox.

## HTTP 兼容 / HTTP compatibility

内网 IP 的 HTTP 页面不是安全上下文。Chromium 的 `crypto.getRandomValues` 可用，而 `crypto.randomUUID`、`crypto.subtle` 和 Clipboard API 可能不可用。因此 Web/Admin 使用显式模块导入的 `browserCrypto`，保留安全随机数；在原生 UUID 不可用时按 RFC UUIDv4 组装，在原生 SHA-256 不可用时使用锁定版本 `@noble/hashes 2.4.0`。没有使用 `Math.random` 或弱化摘要。剪贴板以用户手势下的本地复制方式兼容。

真正内网浏览器检查还暴露了启动竞态：公开部署配置与首次未登录会话检查并发，401 引起的会话版本变化会丢弃公开配置，导致模拟额度按钮消失。只让精确 `GET /v1/public/config` 跨会话变化保留；所有受保护读写、延迟旧会话响应、CSRF 和重试请求身份继续保持原约束。两项真实 HTTP 并发回归和九项既有传输回归用于检查该边界。

Private-IP HTTP lacks UUID/SubtleCrypto/Clipboard APIs in Chromium. Explicit helpers retain CSPRNG-backed UUIDv4 and SHA-256 through pinned Noble, with native APIs preferred. A concurrent first-session 401 previously discarded public deployment settings. Only the exact public configuration GET is session-independent; protected stale responses, CSRF and idempotency behavior remain guarded. Tests use real delayed HTTP responses rather than rewriting the expected result.

## 原始证据与变更 / Original evidence and changes

安装过程保留了原失败：v1 缺少 vendor `pg_isready`；v2 健康检查地址使用了不存在的 `/health`；v3 拒绝覆盖原独立代理配置。v4 使用系统客户端只探测专用 PostgreSQL，并检查实际 `/health/ready`，完成部署。页面更新通过有摘要的不可变 overlay 安装，修改前备份本次独立代理配置，仅重载 `workmate-lan-proxy`。

实际浏览器的首次两个运行保留演示配置竞态失败；第三个运行记录视频工具路径未配置。第四个运行因自动化选择器未包含按钮的快捷键文本而失败；这不是产品任务失败。第五个完整运行通过13项检查。另一次操作收件箱页面检查发现目录式地址错误映射到单个HTML文件，修正本次独立代理为带认证的目录/index映射后，第二次独立检查通过。后续运行使用工作区现有浏览器/录制依赖，保持原脚本、失败回执和截图不变。原始失败不是成功证据，最终成功单独记录。

Failed installers and browser runs are retained with their original conclusions. The final successful run has its own receipt. Overlay installation verifies byte digests, backs up only the owned proxy config and reloads only the owned Workmate proxy. The frozen release remains immutable.

详细入口、运维与后续配置见 [部署手册 / Deployment guide](../releases/lan-176.md)。原有完整专业/生产验收台账保持原范围；此次内网部署不等同于真实广告、支付、真实模型和所有平台执行配置的完整验收。
