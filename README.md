# CopyPaste Admin Dashboard

[English](README.en.md) · 独立运营控制台 · 0.3.0

本仓库是独立 Git 管理后台，与用户 Web 使用独立身份、Cookie 和入口。它管理用户、企业、消耗、费用、VIP、内容、任务、权限和产品配置；采用 CopyPaste 同源品牌样式及繁体中文/英文、浅深主题。所有实际授权、审计和事务在 platform 执行。

![运营概览](assets/screenshots/01-overview.png)

## 启动

Node.js 22.14+。先启动 platform API 与数据库，并通过 platform CLI 创建管理员、导入 TOTP：

```powershell
# 在 platform 仓库执行
npm run admin:create -- admin@your-company.example super_admin
```

然后在本仓库：

```powershell
npm ci
npm run dev
npm run typecheck
npm run build
```

访问 `http://localhost:4318`。生产部署 `dist/`，HTTPS 与精确 Admin origin，将 `/v1` 反向代理到平台；SPA 路由回退与 API 分开。可用 `.env.example` 中的公开 `VITE_API_BASE`。禁止将模型 key 或数据库凭证放入前端。禁止 Docker、WSL 和虚拟化环境。

管理员每次登录需邮箱验证码及 TOTP；敏感提交要求最近 10 分钟 MFA，过期后重新登录。开发 OTP 来自 platform 本机 mailbox；没有共享默认管理员。

## 16 个运营页面

| 页面        | 实现                                                                       |
| ----------- | -------------------------------------------------------------------------- |
| Overview    | 按各自权限范围汇总企业、用户、消耗、预留和对账                             |
| Users       | 数据库分页/检索、联系信息单独权限、用户详情、成员关系、消耗、状态/会话操作 |
| Workspaces  | 企业状态、成员数、按账务权限显示余额                                       |
| Usage       | 按用户/企业/项目范围汇总任务和实际 token/费用                              |
| Billing     | 不可变账本、确认入账、赠送、来源退款/扣款、对账                            |
| VIP         | 个人或企业授权、开始/到期时间、暂停/恢复/延长/撤销                         |
| Content     | 全域内容元数据、正文/下载独立权限、隔离/恢复与版本检查                     |
| Execution   | 任务状态、取消、对账、满足条件的新子任务重试                               |
| Catalog     | 已安装角色/Skill 启停和展示、帮助/公告/导航版本发布                        |
| Connections | 已连接服务、范围、撤销                                                     |
| Access      | 邀请开户/真实 MFA、停用/恢复、会话、八类角色/67 权限、受限委派                  |
| Support     | 限时支持会话元数据与撤销；不具备静默代登录                                 |
| Audit       | 可追溯操作、结果与时间                                                     |
| Jobs        | 有预览/提交的用户状态批量操作、受控 CSV 导出                               |
| Plans       | 版本化套餐、能力/角色/并发和任务预算约束                                   |
| Policy      | 审批金额阈值与 VIP 最长期限的版本配置                                      |

![用户详情及消耗](assets/screenshots/02-user-detail.png)
![费用账本](assets/screenshots/01-billing.png)
![权限管理](assets/screenshots/01-access.png)

## 管理员邀请与账号生命周期

0.3.0 在 Access 页面提供邀请开户及可选初始角色、范围、金额/期限/批次上限。账号和初始授权原子创建，逐项检查权限及委派来源。操作者只看到投递结果，邀请链接仅寄给受邀邮箱。未分配业务权限的已开通账号显示等待授权。

```mermaid
flowchart LR
  Bootstrap[受信 CLI 首次超管] --> Invite[后台邀请与受限初始授权]
  Invite --> Mail[仅收件人获得链接]
  Mail --> OTP[本人验证邮箱]
  OTP --> MFA[本人绑定新验证器]
  MFA --> Session[独立 Admin 会话]
  Session --> Scope[按角色与范围使用后台]
  Scope --> Control[停用 / 重设 / 撤销会话]
  Control --> Fresh[旧会话失效，重新验证]
```

链接进入页面后立即移除 fragment，不保存在浏览器存储。验证码和 MFA 设置限时、限次、单消费；密钥只显示给已验证的本人。账号详情展示安全的会话元数据、角色/范围、MFA 及邮件状态。重发邀请会废弃旧链接和未完成设置；投递失败明确显示，支持重试。停用和恢复都不恢复旧会话。

本人通过侧栏「验证器设置」更换 MFA，需要近期登录及新的邮箱验证；新 TOTP 确认前保留旧密钥，成功后撤销旧会话并签发当前新会话。他人重设、状态及会话操作要求独立权限、记录版本与原因；不能自己重设或停用自己，最后一位已开通、有效的永久超管受到并发保护。邀请中账号不计入此保护。权限调整会撤销旧会话；未开通身份保留收件邀请，但须重新验证邮箱和设置 MFA。

解除 deny 会恢复权限，服务端同时检查委派权限、实际范围交集、限额和有效期；不能删除自己的 deny，也不能用全局授权绕过操作者在较小范围内的明确限制。绑定删除支持同键重试，避免重复撤销会话。

![真实管理员账号管理](assets/screenshots/04-admin-identities.png)
![受邀人邮箱验证](assets/screenshots/05-admin-email-enrollment.png)
![MFA 与会话详情](assets/screenshots/08-admin-account-sessions.png)
![移动账号详情](assets/screenshots/09-admin-account-mobile.png)

`src/admin-identities.tsx` 承载实际开通、本人 MFA 和账号详情。Delivery `npm run qa:admin-identities` 验证 6 组真实浏览器流程，平台另有 14 组 PostgreSQL/API 逻辑测试；截图隐藏密钥与验证码。生产 SMTP 与企业 SSO 尚需分别接入验证。

## 敏感操作流程

```mermaid
flowchart LR
  A[Admin 邮箱 OTP + TOTP] --> R[权限与范围]
  R --> P[填写费用或 VIP 命令]
  P --> V[只读预览 / hash / 目标版本]
  V --> C[5 分钟内确认提交]
  C --> T{金额达到审批阈值?}
  T -->|是| I[另一位有权限管理员审批]
  T -->|否| D[事务提交]
  I --> D
  D --> L[账本 / 权益事件 / 审计]
```

金额用 HKD 整数 micros；UI 输入换算不改变后端记账口径。付款必须填写已确认的唯一引用，后台不会自动向客户收款。VIP 不改变余额；余额不代表 VIP。月费默认值尚未商业定价。

权限包含 global/tenant/project 范围，显式拒绝优先，金额/期限/批次数及授权到期限制。权限委派不能超过自己的来源授权，不允许自授权，不允许破坏最后一位永久超级管理员的恢复权限。用户联系信息、消耗、余额、内容正文和下载分别控制；不能凭普通用户列表权限获得其他数据。

后台发布角色只能调整已安装定义的启用和展示；Skill 只能启停。可执行工具/内核/模型不能通过 JSON 绕过发布资格。内容隔离立即影响用户可见性、分享和后续执行。所有集合按 SQL 授权范围分页，不先全量拉取再前端过滤。

## 私密内容治理

内容列表包含专家、私密会话、记忆及原有业务资源。列表元数据与正文读取分别授权；正文检查记录审计。平台 Admin 须具备明确的范围及正文权限，普通客户管理员不因此获得其他用户的私密内容。

隔离立即影响用户 API、RLS 读取和运行任务的后续工具。会话删除先检查在途任务，再清空可读消息、任务正文、记忆版本及缓存重放；已删除会话/记忆不提供恢复按钮。专家职责变更通过专用版本接口，内容治理不能覆盖固定执行版本。重试保留私有归属与上下文，重新检查当前授权与权益。

![实际私密正文治理](assets/screenshots/03-private-content-governance.png)

## 验证与已知边界

`npm test` 是类型检查，真实 16 页、邮箱/TOTP、费用/VIP 提交、用户详情的浏览器旅程见 delivery `npm run qa:web`；私密正文、隔离/恢复由 `npm run qa:persistent` 验证；平台测试覆盖越权、并发、金额重放、VIP、委派和最后超级管理员保护。

CSV 导出最多 500 行、15 分钟有效并在下载时重查源权限。首次恢复超管由受信 CLI 引导；后续邀请开户、本人 MFA 开通、更换、停用/恢复、重发和会话撤销由 UI 完成。支持会话只提供元数据，不实现客户内容委托或代登录。在线支付、SSO 和大规模导出仍未完成。

`src/main.tsx` 实现页面/运营命令，`api.ts` 处理 Cookie/CSRF，UI 为本仓库独立快照，来源记录在 `shared-source.json`。截图为真实开发数据，包含虚构 fixture 企业；主文档在交付根目录 `docs/`。素材许可见 [说明](THIRD_PARTY_NOTICES.md)。
