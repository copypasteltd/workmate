# 205 · 逐项交付、精确修正与持久状态 / Exact call outcomes

Backend0.5.12／Web0.5.14／Desktop0.7.18／Delivery0.5.12；Admin0.5.2及Extension0.5.7保留原样业务代码。Codex唯一内核，公司API、本机Desktop、无框无菜单及原生右侧SidePanel保持原要求。

同一工具的另一份成功输出，不再清除原失败项。只有带精确原参考号、已确认未执行且可修正的调用，才能解除对应项。参考号填错保留原项并返回有界核对信息；未知操作不因换参数或重复身份变成可重做。音视频须确认真实完成、可用文件和用量。

schema166独立保存受租户／任务RLS控制的安全状态；补充资料、后续回合和活动清理不会抹掉未完成项。Web与Desktop云任务审阅使用一致活动身份和有界摘要。完整原生本机工具的通用逐项恢复协议仍按原验收范围保留。

| 内容 | 实际证据及边界 |
| --- | --- |
| 本轮代码 | [统一冻结的844份源码／166份迁移](final-source-manifest.json)、[完整102条／32组](requirements-102.md)，没有用清除标记代替验收。 |
| 相关验证 | [统一结果](verification.json)、[790项相关证据](test-summary.json)：本轮执行675项，其余为原样Admin／Extension证据；不是全产品矩阵。 |
| 界面与客户端 | [正式Web／最终0.7.18原生Desktop](live-production-journey.json)、[双语双主题受控错误场景](controlled-tool-feedback-ui.json)、[实际PNG／GIF／MP4](actual-media.json)。两类场景分别标注。 |
| 部署 | [应用切换、真实库备份及兼容回退](deployment.json)，未声称完成回退／全量恢复演练；[保留中断文件并完整校验后原子发布](download-publication.json)、[恢复时重新取得的保持基线](interrupted-deployment-baseline.json)。 |
| 下载 | [20501不可变包／目录与实际结果](public-downloads.json)、[四文件完整公网检查](open-public-download-gate.json)当前为通过；内网完整字节与SHA通过。 |
| 网络与服务 | [9份网络文件及实时规则保持](network-preserved.json)、[原凭证／数据库／代理保持](final-service-state.json)。不修改或重载服务器网络配置。 |
| 失败与资源 | [原失败保留](retained-attempts.json)、[目录已退出的只读核对](fixture-reclamation-readback.json)、[所有本轮自建资源已关闭](runtime-cleanup.json)。 |

19角色／50Skills的专业签收、真实视频／语音及Google／Meta／企业IdP接入、设备／并发／长期稳定／完整灾备与WorkBuddy同题盲测继续按原范围保留。默认公网HTTP/2、直接出口和正常DNS地址故障转移未被本机QA路径替代。不声明完整goal完成。

English: Independent outputs never clear another failed call. Exact validated corrections, monotonic unknown outcomes, durable RLS metadata, pruning-safe summaries and actual media completion preserve original authorization and accounting. 675 current related cases plus unchanged Admin/Extension evidence support this measured release. Actual deployed/native journeys and controlled UI scenarios remain distinct. Server networking is read-only. Full professional, external, operational and device acceptance remains open; public complete-download status is passed for the explicit QA path. No full-product completion claim.
