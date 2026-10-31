# 工作流阅读定向记录 / Scoped workflow-reader evidence —153

首个冻结版保持原样。本增量只构建和验证修改后的后端与Admin，不重跑全平台/历史测试。9项后端SQL/HTTP及7组实际Admin页面操作通过，来源文件在检查期间保持一致。

| 编号 | 已验证范围 | 结果 |
|---|---|---|
| 1 | 105个已保存共享版本，双向及首尾分页；旧入口显式标注截断 | 通过 |
| 2 | 私有云端3版，创建任务到期、根隔离及项目归档调查 | 通过 |
| 3 | 外部数据来源撤回，旧/新入口一致隐藏正文和敏感版本详情 | 通过 |
| 4 | 保存及发布变化使旧签名游标失效；历史不可变 | 通过 |
| 5 | 双权限、精确范围、显式拒绝、近期MFA、会话及身份绑定 | 通过 |
| 6 | 全部106个共享历史进入授权ZIP；不可用来源被过滤 | 通过 |
| 7 | 当前运行快照及旧正文在固定输出撤回后隐藏 | 通过 |
| 8 | Desktop控制层保存/发布/申请运行及精确隔离根、自引用版本链；无本机模型启动 | 通过 |
| 9 | 工作流永久删除清除共享历史，删除范围禁止重建正文 | 通过 |

7组真实浏览器操作覆盖独立OTP/TOTP登录、共享长历史、私有来源、来源撤回、当前运行快照、繁英切换/1440·960·390宽度及当前权限撤回。10张截图、2组GIF/MP4来自实际页面。没有以截图代替HTTP/SQL验证。

两项独立只读复核发现的来源持锁缺口及隔离调查遗漏已修正：闭合集合包含项目配置，定义/运行均在持锁后重查；前向SQL151/152只对精确调查根提供隔离例外，客户/执行函数没有扩大权限。已应用SQL150/151未重写；失败迁移草案和失败检查日志保留原文。

共享105/106版是明确标注的SQL业务夹具；私有云端通过显式假模型适配器调用真实保存工具，Desktop只验证真实控制API。真实Codex进程、模型/媒体/广告供应方、签名更新、跨OS及完整生产矩阵仍未在本轮验收。所有本次浏览器、上下文、API、预览服务及原生数据库均已关闭；未使用Docker/WSL。

Only focused changed-surface checks were run. All9 backend cases and7 actual Admin journey groups passed with exact source receipts. Business/model fixtures are synthetic; no live provider or native model acceptance is claimed. First frozen artifacts are preserved. Full production/cross-OS acceptance remains open.

[来源与媒体清单 / Source and media manifest](workflow-content-history-checkpoint-153.json) · [实现 / Implementation](../development/153-workflow-content-history.md) · [完整待项 / Whole ledger](remaining-work-stage153.md)
