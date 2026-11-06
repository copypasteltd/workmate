# 196 · 审阅、文字新版本与真实执行工作区

本轮计划内代码包已整批完成并上线，之后统一六仓构建、类型检查、回归、汇总修复与实机联调。没有逐模块边开发边测试。服务器运行 integrated-196-v1；原 schema163、公司模型配置、凭证和测试邮箱保持。

|组件|当前版本|入口|
|---|---|---|
|Backend|0.5.3 / schema163|https://ai-api.copypaste.hk|
|Web|0.5.2|https://agent.copypaste.hk|
|Admin|0.5.1（兼容复验）|https://agent-dashboard.copypaste.hk|
|Desktop|0.7.6|[安装/便携下载](https://agent.copypaste.hk/downloads)|
|Extension|0.5.5（同包兼容复验）|[原生侧栏下载](https://agent.copypaste.hk/downloads)|
|Delivery|0.5.2|本轮统一验证与交付工具|

## 已交付

- 同一任务集中使用成果、文件、变更、执行、网页、活动、费用七个标签；云端程序与网页按记录类型在后端分页。键盘左右键及Home/End可切换标签。
- 查看当前交付与有权访问的早期版本差异、散列和格式变化；支持受权UTF-8文字保存新版本，原字节保留。任务/交付/资产版本及原散列共同检查，并发只允许匹配的版本提交。人工编辑不调用模型、不增加模型费用，新交付需重新审阅。
- 实际保存后丢失响应时，界面冻结原内容；明确核对复用相同请求键和正文，不重复新建版本。撤权、来源失效及身份切换不能利用旧回放读取内容。
- Desktop在本机运行Codex。当前任务展示真实绑定的命令/文件/工具事件，当前文件预览独立核验本机权限；撤权后拒绝预览。保持无边框、无Electron菜单及隐藏滚动条。
- 新工作读取当前项目的实际角色模板、交付范围、服务依赖和示例；明确选用示例仅填简报，不启动或收费。角色数量来自目录。
- Desktop0.7.6安装/便携包及当前ExtensionZIP均已挂在产品下载页，真实完整下载与SHA-256核对通过。后台与侧栏完成当前部署兼容实测。

## 验证与证据

六仓构建和Desktop主进程/渲染类型检查通过，最终相关测试**476项通过**，零失败、取消、跳过。另保留较早批次63项未变更后端成功用例，未重复计算成最终批次；该较早批次整体曾有1项HTTP状态断言失败，最终版本已修复。**这不是全部历史后端测试或全产品矩阵重跑。**

|组件|最终通过|失败|跳过|
|---|---:|---:|---:|
|copypaste-web|35|0|0|
|copypaste-admin|22|0|0|
|copypaste-extension|89|0|0|
|copypaste-delivery|28|0|0|
|copypaste-desktop|284|0|0|
|copypaste-platform|18|0|0|

- [统一验证](verification.json) · [开发先于测试的整批回执](implementation-batch.json) · [实际包散列后的Web元数据复验](release-metadata-validation.json)。
- [Web工作区与角色指引](workspace-journey.json)：真实保存、故意丢失响应、原请求核对、实际旧/新版本比较、执行/网页视图、指定宽度和暗色。完整脚本最后的入口选择器失败保留，角色步骤另行通过；未伪装成原脚本全绿。原测试文件字节已恢复为新版本。
- [Desktop发布包实机](real-desktop-journey.json)：实际PKCE、明确完整本机权限、读取本机源文件、命令执行、输出核对、HK$0.057310真实结算、任务内执行记录与撤权后拒绝预览；未替换模型或网络结果。
- [原生Extension侧栏](extension-journey.json)：真实工具栏、原生右侧栏、浏览器授权及CSV/图片私人上传。粘贴/拖入使用携带真实字节的受控事件，不宣称所有系统剪贴板或硬件矩阵。
- [部署与原生Office](deployment.json)：非root API、2687运行文件散列、原服务/凭证与兼容回滚目录；Linux真实DOCX/XLSX/PPTX、中文和宏拒绝通过。
- [公开完整下载](public-downloads.json)：三个客户端包及校验清单实际字节/散列；Setup复用同一不可变URL的[先前成功完整下载](public-downloads-v1.json)，其余由浏览器原生下载后核对。
- [最终Web/Admin核对](final-smoke.json)：当前部署访问真实既有成果/费用、下载链接、后台新验证码/TOTP登录、就绪和原验收证据。
- [本轮两次本机测试费用](owned-native-accounting.json)：首次连接中断发生于模型调用前，服务器确认零请求，其HK$2预留经现有最高管理员审计对账流程释放，任务仍为失败；第二次实际模型任务正常结算。未修改旧未知费用。
- [保留失败](retained-attempts.json)：构建/断言/浏览器工具/上传/下载/首次本机尝试均保留。一次测试工具异常涉及的自有测试会话已撤销并确认401，公开证据不含认证字段。

真实录制保留墙钟响应时间，不插入假结果帧。已关闭本轮自建浏览器、侧栏和桌面实例；未使用本地Docker/WSL/虚拟化。源码、双语说明、实际截图与GIF/MP4按各端独立仓库交付，普通推送对应分支，受保护用户文件不变。

## 明确保留的后续范围

间歇公司公网连接超时仍有本轮观测；只读有界重试后成功不能证明长期可用性。原Web详情与新工作区仍有重复执行区块，下一整批应精简。它们继续进入统一待办，不用本轮成功案例掩盖。

真实视频/语音、Google/Meta及发布授权、至少12角色的实际客户专业评审、完整设计/字体/排版/特效交付、广告口径和SEO/GEO业务效果，以及安装/离线/休眠/大文件/权限/灾备/SLA全矩阵仍开放。测试邮箱按用户决定保留；受信Windows签名按用户决定排除。完整目标继续保持进行中，不宣称与WorkBuddy全面等价、全部需求已验收或全产品零错误。

[32组/102条追溯](requirements-102.md) · [机器覆盖层](requirements-overlay.json) · [需求](../../requirements/196-workspace-completion-round.md) · [实现](../../development/196-task-review-and-native-context.md)

English: The complete implementation batch precedes integrated validation. This release adds authorized immutable text revisions and exact-request recovery, pinned comparisons, task-bound cloud/native execution views and contextual specialist guidance. Six builds, Desktop types and476 final selected tests pass;63 unchanged earlier backend successes remain separately recorded. Real native execution, billing, Side Panel, downloads and Admin compatibility have independent evidence. Original failed attempts remain. Public-route reliability, professional role outcomes, external integrations and full production/compatibility acceptance remain open.
