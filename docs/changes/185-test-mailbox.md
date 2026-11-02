# 阶段185：修复测试收件箱 / Stage185: repair the test inbox

- 原因 / Cause: RFC日期文字排序在跨星期时失序，30封限制隐藏了今天的两封验证码。Lexical RFC-date ordering and the30-message cap hid both new Monday codes.
- 修复 / Fix: 时间排序、最新邮件置顶、5秒自动检查、返回页面检查、手动刷新、受限并行读取、数量／时间和可恢复错误提示。Parsed chronological order, newest first, automatic checks, manual refresh, bounded reads and recoverable feedback.
- 验证 / Verification: 跨星期／跨年、30封限制、自动出现、读取失败保留、恢复、空列表、文字安全及窄屏检查；另用正式域名的新验证码与既有 TOTP 实际登录。Regression covers date boundaries, limiting, polling, failures, recovery, empty state, text rendering and narrow layout; separate qualification uses an actual public-domain OTP and existing TOTP.
- 部署 / Deployment: 静态页面原子更新，旧页面备份；既有凭证、认证、路由和服务保持原配置。Atomic static-page update with backup; existing credentials, authentication, routing and service configuration retained.
- 模式 / Mode: 根据用户最新选择继续测试收件箱。此次不切换真实SMTP投递。The test mailbox remains the selected delivery mode.
- 记录 / Record: 初次诊断偏向SMTP，随后实际验证码文件及目录排序证据确认页面显示缺陷；错误正则、边缘缓存断言和初次录制／语言设置等检查尝试的原始字节保留。The initial SMTP hypothesis was corrected by challenge-file and listing evidence; diagnostic and qualification attempts remain preserved.

[使用和实现 / Usage and implementation](../development/185-test-mailbox.md) · [验收证据 / Evidence](../quality/test-mailbox-185.json)
