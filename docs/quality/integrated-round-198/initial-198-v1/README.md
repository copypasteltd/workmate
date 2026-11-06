# 198 · 完整任务目录与工作上下文

整批产品代码完成后统一构建、测试和客户端联调。当前线上为 integrated-198-v1，schema163不变。Web和Desktop新增完整任务目录、标题／状态／位置／模式筛选及签名分页；从成果、通知或会话进入工作时确认企业和项目，返回保留原任务和视图。Extension恢复历史搜索与归档筛选，不让失效历史页阻断当前会话。

[应用](https://agent.copypaste.hk) · [后台](https://agent-dashboard.copypaste.hk) · [客户端下载](https://agent.copypaste.hk/downloads)

| 组件 | 当前版本 | 本轮交付 |
| --- | --- | --- |
| Backend | 0.5.6 | 只读完整任务目录、当前授权、签名游标和来源隔离 |
| Web | 0.5.5 | 目录与筛选、精确原会话、范围门控、返回状态 |
| Admin | 0.5.2 | 当前部署兼容与真实就绪／验收记录复核 |
| Desktop | 0.7.9 | 同一任务目录、本机原会话与成果视图恢复、固定公司目标 |
| Extension | 0.5.7 | 原生右侧栏历史状态恢复及非阻断提示 |
| Delivery | 0.5.4 | 完整批次检查、真实媒体、不可变包与服务器回读 |

六端构建、Desktop主进程和渲染类型检查通过；555项相关测试通过：Backend69、Web42、Admin22、Desktop301、Extension93、Delivery28，无失败或跳过。后端为与本轮权限、分页、原生和账务风险相关的选定回归，不是全部历史用例。

实际Desktop0.7.9使用发布包、本机Codex和公司模型网关，读取文件、运行PowerShell并写出经过核对的result.json；真实费用HK$0.032730已结算。完整权限原生确认与撤权、本机原会话和结果返回通过。Extension0.5.7通过真正原生右侧栏、PKCE、两类私人附件上传及历史筛选恢复。Web复验原任务／会话和375／768／1024／1440实际宽度；Admin新邮箱验证码加TOTP登录检查真实服务就绪与保留记录。

公开Setup、Portable、Extension ZIP以及校验文本均完成真实浏览器完整下载、字节数和SHA-256核对。原导航超时、早期脚本错误和弱截图证据保留，没有通过替换响应或重放业务写入获得通过。Web最终复验复用仍有效且经线上身份核对的自有QA会话，未伪称再次执行新邮箱登录。测试收件箱按要求保留。

| 交付证据 | 文件 |
| --- | --- |
| 代码与验证 | [代码批次](implementation-batch.json) · [555项检查](verification.json) |
| 真实客户端 | [Desktop](real-desktop-journey.json) · [Extension](extension-journey.json) · [Web](web-directory-journey.json) · [Web/Admin](final-smoke.json) |
| 上线与包 | [服务器回读](deployment.json) · [完整下载](public-downloads.json) · [打包](packaging.json) · [实际媒体](actual-media.json) |
| 原始范围 | [全部102条](requirements-102.md) · [32组覆盖层](requirements-overlay.json) · [保留尝试与纠正](retained-attempts.json) |

视频／语音与Google／Meta等外部接入、客户专业业务产出验收、完整应用／浏览器兼容、长期负载与灾备仍开放。19个预设角色及50个skill的现有受控验证不等于全部专业场景已验收；受信Windows签名按用户决定排除。没有把本轮交付或TODO标记为空当作完整目标或WorkBuddy对标完成。

English: Ships a full authorized task directory, signed pagination, exact conversation/task navigation, scope gating and restored review/history context after one implementation batch. Six builds, Desktop type checks and555 relevant regressions pass. Actual0.7.9 native Codex execution bills HK$0.032730;0.5.7 Side Panel, live Web/Admin and complete public package downloads are verified. Original failures remain. External, professional and full production/compatibility acceptance stays open.
