# 管理员邀请、MFA 与账号生命周期

版本：1.8 · 2026-10-19 · 对应 REQ-083/094/096/100、AD01。0.2.0 已交付证据保持不变；本分册记录 0.3.0 实现及其验收条件。

## 产品流程

受信 CLI 保留首次超级管理员引导。后续管理员从后台 Access 发起邀请，输入姓名、邮箱、操作原因及可选初始角色/范围/限额。创建账号和初始授权在一个事务中；初始授权逐项执行原有可委派权限、范围、金额、期限和到期上限检查，不能自授权或通过开户越权。

邀请链接仅发至受邀邮箱，管理员列表只显示投递状态和有效期。链接能力放 URL fragment，进入开通页后移除地址中的令牌，不写本地存储。受邀者先通过新邮箱验证码，再自行设置验证器并提交真实 TOTP；成功才成为已开通身份并建立独立 Admin 会话。未开通账号不计入最后超管保护，普通用户注册不会自动生成管理员身份。

账号详情提供角色/范围、MFA 状态、会话元数据和投递状态；不返回密钥、登录令牌或邀请链接。重发邀请撤销旧链接及旧 setup；停用撤销会话与邀请，恢复不恢复旧会话或旧链接。MFA 丢失由另一位有权管理员按版本重置，撤销旧会话并重新邀请；不能通过此入口重置自己或最后一个有效恢复超管。

本人更换验证器采用已登录且近期 MFA 的独立流程，再验证邮箱。确认新 TOTP 前保留旧验证器；确认后原子换密钥、撤销全部旧会话并签发当前新会话。setup 限时、限次、单次消费，不因重试产生额外授权或会话。

## 数据与一致性

管理员新增独立 version、enrollment_state、enrolled_at；auth_version 继续使旧会话失效。pending 账号没有有效 TOTP，旧受信 CLI 账号保持兼容。邀请和 setup 仅保存 token hash，待投递邮件能力及新 TOTP 以 MASTER_KEY 加密；完成/撤销后清空可解密能力。管理员公开投影由显式字段组成。

账号状态、授权和开通/重置使用同一恢复保护锁；锁内重查操作者当前权限及近期 MFA。最后保护检查至少一位 active、已开通、永久 global super_admin，且恢复管理权限无有效显式拒绝。版本冲突拒绝覆盖。权限变更提高 auth_version 并撤销目标会话，后续 API 仍逐次检查当前授权。对 pending 账号调整绑定时保留收件邀请，更新授权版本并废弃已验证的 setup，受邀者必须重新验证邮箱；恢复、会话撤销与重发则明确撤销旧链接。

删除 allow 属于撤权；删除 deny 会恢复权限，因此除撤销权限外还要检查 bindings.write，以及被恢复权限与操作者的授权范围、限额和有效期。禁止删除自己的 deny，由另一位有权管理员处理。范围检查按 global、tenant、project 的实际交集执行，只检查受影响权限；操作者在较小范围内有显式 deny 时，不得通过更大的委派或解除限制绕过。删除绑定支持幂等重试；成功后同键重试不会重复撤销会话或增加版本。

邮件投递结果与账号创建分别展示。SMTP 失败保留已创建但未开通的账号，明确显示投递失败，允许有权操作人重发；不能把未送达邮件显示为成功。邮箱链接不可用于普通登录，设置用邮箱验证码也不能跳过正常 Admin MFA 登录。

## 验收要求

真实 PostgreSQL/API 验证：未授权/企业身份/范围不足/过期 MFA 拒绝，创建和授权原子性，自授权/委派扩大拒绝，邀请码过期/撤销/重复消费，邮箱挑战的绑定/限次/单消费，真实 TOTP 设置与重放拒绝，停用及授权变更使旧会话失效，重发废弃旧 setup，最后超管与并发停用保护，投递失败及幂等重试，自己换 MFA 的失败保留与成功切换。

浏览器贯穿邀请、收取开发邮箱、本人验证与设置、后台登录、角色生效、停用/恢复和会话撤销；截图避免包含 setup 密钥和令牌。所有自己创建的页面、上下文和浏览器在 finally 关闭。生产 SMTP 和真实企业身份提供商仍需实际环境联调；本实现不以邮箱邀请冒充企业 SSO。

## 0.3.0 实际接口

接口由 platform 注册并纳入 `contracts/implemented-routes.json`；规划 OpenAPI 继续保留长期设计，两者尚非完整一致。Admin 写请求需要独立会话、CSRF、Idempotency-Key；敏感操作在恢复锁内重查当前权限和最近 10 分钟 MFA。`expected_version` 冲突返回 VERSION_CONFLICT，主体不存在返回 NOT_FOUND。

| method / path（统一前缀 `/v1/admin`） | 输入与授权 |
| --- | --- |
| GET `/access/principals` | read；分页、搜索；显式安全字段 |
| GET `/access/principals/:id` | read；主体、绑定、最近 100 会话元数据、投递状态 |
| POST `/access/principals` | principals.write；email/name/reason，可选 binding；绑定另查 bindings.write 和逐权限委派 |
| PATCH `/access/principals/:id` | principals.write；expected_version/name/reason；邮箱不允许编辑 |
| POST `/access/principals/:id/status` | principals.write；expected_version/state/reason；拒绝自行停用/恢复 |
| POST `/access/principals/:id/enrollment` | principals.write；expected_version/reason；pending 且 active 才可重发 |
| POST `/access/principals/:id/reset-mfa` | principals.write；expected_version/reason；另一位已开通管理员、active 才可重设 |
| POST `/access/principals/:id/session-revocations` | sessions.revoke；expected_version/reason；撤销所有会话及未完成 setup |
| POST `/auth/enrollment/inspect` | 43 字符邮箱能力 token；只返回受邀者身份与有效期 |
| POST `/auth/enrollment/setup` | token/challenge_id/code；受邀邮箱证明后返回单次 setup_token/密钥/URI |
| POST `/auth/enrollment/complete` | setup_token/totp；确认后签发独立 HttpOnly Admin 会话 |
| POST `/auth/mfa/setup` | 本人有效近期 MFA 会话；challenge_id/code；设置绑定当前 session |
| POST `/auth/mfa/complete` | 本人当前 session、近期 MFA；setup_token/totp；换密钥并轮换会话 |

邀请 24 小时有效；MFA setup 最长 10 分钟且不超邀请有效期。OTP 和 setup 各最多 5 次验证、单次消费。公开请求统一拒绝失效/撤销/已消费能力。本人 MFA setup 可随页面关闭放弃，原密钥保留；重新验证邮箱才可获得新 setup。邮箱验证码本身不跳过正常管理员登录的 TOTP。

注册路由、受限数据库身份、失败/并发和实际页面的证据见 [0.3.0 验收](../quality/06-admin-identity-acceptance.md)。

旧版 `/access/principals/:id/revoke-sessions` 保留为同一会话撤销处理器的别名，统一要求 expected_version/reason、当前权限、近期 MFA 和幂等键，不提供无版本/无原因的旁路。新增测试同时检查旧别名的缺字段拒绝与版本冲突。
