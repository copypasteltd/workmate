# 195 · 整轮开发、真实验证与上线交付

本轮已经完成统一输入、成果工作区、后台运行就绪、角色验收台账、Linux Office 与客户端输入能力的整批开发，并发布到正式域名。执行顺序为**整批开发 → 统一构建和测试 → 汇总问题修复 → 整轮复验 → 实际部署与旅程验证**。实际旅程发现的 Office 上传格式和会话附件协议遗漏均已修复，原始失败保留。

|组件|版本|访问/交付|
|---|---|---|
|Backend|0.5.2 / schema163|https://ai-api.copypaste.hk|
|Web|0.5.1|https://agent.copypaste.hk|
|Admin|0.5.1|https://agent-dashboard.copypaste.hk/readiness|
|Desktop|0.7.5|[安装/便携版](https://agent.copypaste.hk/downloads)|
|Extension|0.5.5|[原生侧栏 ZIP](https://agent.copypaste.hk/downloads)|
|Delivery|0.5.1|本轮可复现脚本及证据|

## 本轮实际变化

- Web 会话支持文件选择/拖入、剪贴板图片及 @ 素材引用，固定所选文件版本；原始文件先归当前私人会话。发送时后台验证描述、所有权、项目、固定版本及重复请求，原子创建任务和预算预留。无授权输入不会产生半条消息或半笔任务。
- 单个任务集中查看成果、文件、受权预览/下载、活动和实际费用。继续修改保持原执行位置。任务/身份切换会丢弃旧预览与回调，网络结果不明时保留原幂等请求。
- Desktop 在本机运行真实 Codex；文件选择、拖入及获准图片副本由主进程复核目录、权限版本和身份。保持无边框、无 Electron 菜单、滚动能力和隐藏滚动条。
- Extension 继续使用实际 Chrome 原生右 Side Panel、浏览器授权和云端 Codex，新增图片粘贴和拖入反馈。
- Admin 的 `/readiness` 展示真实模型、广告连接、测试邮箱、Office、原生执行、磁盘及环境状态。`/role-acceptance` 保存任务/角色/技能/费用/交付快照；可新增、分页筛选、批量撤回，保留不可重写证据与审计。逐模型 API/key 编辑仍在原模型能力管理。
- Word/Excel/PowerPoint 在线预览使用服务器原生受限进程；源文件/运行时散列复核、宏/外链预检、资源/时间边界、父进程退出终止、临时文件清理均保留。上传三种 OOXML MIME 且验证 ZIP 文件头；预览还有独立内容预检。

## 验证证据与范围

六个仓库构建通过。本轮最终相关测试共 **517 项通过**，没有失败、取消或跳过；Windows Office 另保留v6/v7冷启动失败，并在最终批次改为已固定二进制和同一配置内的一次81重启。后端按改动边界选取，**不是所有历史后端测试的新一轮全跑**。

|组件|通过|失败|跳过|
|---|---:|---:|---:|
|copypaste-web|32|0|0|
|copypaste-admin|22|0|0|
|copypaste-extension|89|0|0|
|copypaste-delivery|28|0|0|
|copypaste-desktop|278|0|0|
|copypaste-platform|68|0|0|

- [统一验证回执](verification.json)：包含每个构建/测试日志散列及选择范围。
- [Web/Admin 实际旅程](ui-journey.json)：真实文件/图片/Word 上传、API 服务身份下的中文 Office 预览、付费云端 Codex、成果下载散列、活动/费用、主题/指定宽度、后台新增/批次撤回。
- [Desktop 实际旅程](real-desktop-journey.json)：发布包原生 PKCE、本机完整权限、真实本机 Codex 读取文件/执行命令/写出并核对结果、真实结算及撤权。
- [Extension 实际旅程](extension-journey.json)：实际工具栏、原生右侧栏、原生浏览器授权、两份真实私人附件上传，无弹窗替代或普通页伪装。
- [部署](deployment.json)：非 root API、schema163、Linux Word/Excel/PPTX、数据库与代理主进程不变、原有模型/邮件/数据库配置不改写；原配置/回滚文件保存在服务器 `/root/cfg/workmate/integrated-195/`。
- [公开下载](public-downloads.json)：三个安装/扩展包实际完整下载散列及校验清单；同一不可变 URL 的既有成功下载可追溯至原始回执，未用 HEAD 代替文件校验。
- [最终线上核对](final-smoke.json)：v10 上重新访问既有成功任务、交付/费用、下载页及后台就绪/已撤回证据，没有重复发起付费任务。
- [运行文件一致性](runtime-equivalence.json)：付费 Web/Admin 旅程运行于 v9，最终 v10 的683份后台运行 JS/映射及 Web/Admin 产物字节相同；另做最终只读核对。Desktop 实机旅程运行于本轮较早的 v7 服务器和同一最终客户端安装包，不宣称整套真实旅程都在 v10 重跑。
- [原始失败](retained-attempts.json)：不删失败来制造全绿。首轮代理重载检查过早，已实际自动回滚并补有界就绪等待；后续切换通过。

浏览器中的粘贴/拖入使用携带真实字节的受控事件；不把它说成全部操作系统剪贴板或硬件矩阵实测。真实录制保留实际墙钟响应时间，不插入伪造结果帧。只关闭本轮自建浏览器/应用，未使用本地 Docker、WSL 或虚拟化。

## 剩余边界

本轮源码中的 TODO/FIXME/HACK/XXX 标记扫描无命中；这不等于全部商业、外部和生产条件已经实现或验收。视频/语音/Google/Meta 仍缺真实公司配置或客户授权；至少12角色及完整设计、广告分析、SEO/GEO效果仍须实际客户专业评审；完整安装/浏览器/权限/大文件/灾备/可用性矩阵仍开放。测试邮箱按用户决定保留，受信 Windows 签名按用户决定排除。不能宣称与 WorkBuddy 全面等价或全产品零错误。

[32组与102条追溯](requirements-102.md) · [机器可读覆盖层](requirements-overlay.json) · [需求](../../requirements/195-integrated-development-round.md) · [开发方案](../../development/195-integrated-workspaces-and-acceptance.md) · [194原评估](../system-assessment-194/README.md)

English: The implementation batch, selected integrated regression, real cloud/native/Side Panel journeys and deployment are recorded separately. Pinned inputs remain private and idempotent; Desktop runs Codex locally. Readiness never returns secrets and role evidence never auto-certifies professional quality. External integrations, professional acceptance and the full production/compatibility matrix remain open.
