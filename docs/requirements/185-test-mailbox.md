# 测试收件箱验证码修复 / Test mailbox OTP repair

用户明确继续使用测试收件箱。验收范围为验证码生成、服务器本地投递、受保护收件箱显示和实际管理员登录。此次不需要 SMTP 凭证。

The user explicitly retains the test mailbox. Acceptance covers OTP generation, local delivery, protected inbox visibility and actual administrator sign-in. SMTP credentials are not needed for this mode.

1. 邮件按实际时间从新到旧排列，然后才截取最近30封；不能按包含星期、月份名称的日期字符串排序。Newest-first order uses parsed timestamps before applying the30-message limit.
2. 新验证码无需重新打开页面即可出现；每次检查完成后5秒再次检查，切回页面立即检查，并保留手动刷新。New codes appear automatically; checks recur five seconds after completion and resume immediately on returning to the page. Manual refresh remains available.
3. 显示收件数量、最近检查时间、空收件箱和读取错误；失败时保留上次内容并允许重试。Show counts, check time, empty state and errors. Preserve previous messages on failure and allow retries.
4. 保留独立收件箱凭证、禁止缓存及管理员 TOTP。邮件正文只作为文字显示。Retain separate mailbox credentials, no-store and administrator TOTP; display mail as text.
5. 验证新邮件在正式域名自动显示，并使用对应验证码和现有 TOTP 登录；截图和录制隐藏收件人及验证码。Verify public-domain automatic delivery and actual OTP/TOTP sign-in; redact recipients and codes from media.

入口 / Entry: [测试收件箱 / Test mailbox](https://agent-dashboard.copypaste.hk/ops/mailbox/)。这是管理员操作用的测试收件箱，凭证独立于管理员登录。This is an operator test inbox with credentials separate from administrator sign-in.
