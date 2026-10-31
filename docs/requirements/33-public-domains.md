# 正式域名与客户端接入 / Public domains and client access

用户确认 Web 为 `agent.copypaste.hk`，后台为 `agent-dashboard.copypaste.hk`，API 为 `ai-api.copypaste.hk`。旧称 `agent-admin` 无效。现有反代通过 ZeroTier 地址 `192.168.196.204` 转发 `63070/63071/63072`；与 LAN `192.168.31.20` 是同一服务器。

The confirmed Web/Admin/API hostnames above are authoritative. `agent-admin` was corrected by the user. The external gateway uses the server's ZeroTier address; the original LAN address remains valid for maintenance.

- 浏览器登录、回调和 CORS 使用正式 HTTPS origin；用户与管理员 Cookie 必须独立、host-only、Secure、HttpOnly，保留 CSRF、MFA 与权限边界。
- Desktop 固定正式 API/Web origin，本地 Codex、完整权限、无边框和隐藏滚动条不变；Extension 固定正式 API/Web origin和扩展 ID，保持右侧原生面板与主动文件上传。
- 继续使用授权假数据与本地测试收件箱，不自行启用真实收费或复用其他项目密钥。所有原凭据保留，明文位置仍为服务器 `/root/cfg/workmate/`。
- 追加新构建与独立增量包，保留冻结版本；更新全部仓库双语说明及真实媒体后同步 Git。

Use HTTPS origins consistently across cookies, callbacks and CORS, preserving separate customer/admin security. Compile native clients for these domains while retaining their execution and permission model. Keep synthetic providers, local test mail and existing credentials. Deliver additive artifacts and publish updated bilingual documentation/evidence without replacing frozen releases.
