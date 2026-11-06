# 197 · 公司连接恢复与本机结果审阅

整批代码完成后统一构建、测试，再生成实际安装包并完成真实客户端和线上验证。服务器使用 integrated-197-v2，保持 schema163。公司凭证及测试邮箱保留，未改动正在使用的数据库和代理主进程。

| 组件 | 版本 | 本轮变化 |
| --- | --- | --- |
| Backend | 0.5.5 | 未准入原生回合的持久零准入证明与预留释放 |
| Web | 0.5.4 | 统一连接错误处理，移除重复软件检查面板 |
| Admin | 0.5.2 | 统一读取恢复及不确定写入语义 |
| Desktop | 0.7.8 | 隔离 Chromium 公司连接、本机心跳与折叠记录 |
| Extension | 0.5.6 | 统一连接规则，原生右侧栏及附件实测 |
| Delivery | 0.5.3 | 统一回归、实际媒体、不可变下载和部署回读 |

[线上应用](https://agent.copypaste.hk) · [后台](https://agent-dashboard.copypaste.hk) · [客户端下载](https://agent.copypaste.hk/downloads)

六端构建和 Desktop 主进程／渲染类型检查通过；528 项相关测试通过，无失败、跳过或取消。后端选取原生启动、推理、公司工具、账务和工作区相关用例，不声称重跑全部历史矩阵。实际 Desktop 使用发布包、原公司 HTTPS、真实登录授权、私人文件上传／下载及本机 Codex；Extension 使用真正的原生右侧栏。

截图人工复核发现了 Linux 耗时缺失导致的 NaNs。197-07 整批修正后统一复验；服务端读取真实宿主耗时或原回执的规范起止时间，无法确认则返回 null，各端不显示非法耗时。原通过回执和有缺陷截图均保留。

最终 Desktop0.7.8 已用真实公司登录和现有任务完成显示差异验证；包内全部主进程 JavaScript 与原生运行时逐字节等同于本轮0.7.7真实本机闭环。0.7.7 的本机任务真实消费 HK$0.035904，原预留已结算。没有把差异验证写成0.7.8重新执行了一次付费任务。

本轮启动核账覆盖未准入回合的 unknown、失联、持久工具准入、伪报完成及并发完成／准入。只有服务端明确证明六类准入与费用／token 均为零才释放预留；已准入回合和旧未知记录保持核账。没有以自动重跑业务写入解决网络问题。

| 证据 | 文件 |
| --- | --- |
| 代码批次与检查 | [代码清单](implementation-batch.json) · [528 项检查](verification.json) |
| 实际客户端 | [Desktop 原生闭环0.7.7](real-desktop-journey.json) · [最终0.7.8及相同内核](desktop-delta-journey.json) · [Extension](extension-journey.json) · [Web 审阅](web-review-journey.json) · [Web/Admin](final-smoke.json) |
| 上线与下载 | [服务器回读](deployment.json) · [完整下载散列](public-downloads.json) · [最终元数据](release-metadata-validation.json) |
| 完整范围 | [32 组／102 条](requirements-102.md) · [本轮覆盖层](requirements-overlay.json) · [保留失败](retained-attempts.json) |

完整专业业务产出、视频／音频和广告平台外部接入、长期连接稳定性、完整兼容与生产验收继续开放。受信 Windows 代码签名按用户要求排除。不能据本轮成功宣称全部原始要求或 WorkBuddy 完整对标已验收。

English: Ships company-session transport, bounded read/heartbeat recovery, durable pre-turn zero-admission settlement and compact native review after a complete implementation batch. Six builds and 528 selected regressions pass. Actual packaged native Codex, cloud-file transfer and browser side-panel journeys are recorded. External services, professional outputs and complete production/compatibility acceptance remain open.
