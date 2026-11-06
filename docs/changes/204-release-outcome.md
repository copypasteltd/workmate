# 204 · 实际发布内容与验收边界

本轮交付 Backend 0.5.11、Web 0.5.13、Desktop 0.7.17 和 Delivery 0.5.11，Admin 0.5.2 与 Extension 0.5.7 的业务代码和扩展包保持原字节。各端继续使用独立仓库，更新中英双语 README、流程图及已标注来源的截图、GIF 和录影。完整证据见[本轮核查目录](../quality/integrated-round-204/README.md)。

云端 Codex 工具现在返回有界的参数校验提示和支持参考号，并持久化实际失败、完成与恢复事件。未完成的交付不能被模型最后一段文字覆盖成成功；补充资料后的新回合继承原失败记录。真实文件和实际模型用量继续分别核对。未知结果不自动重放。

云端任务的 45 秒续租从长业务事务的锁中分离，保留当前权限、预算、取消／撤权和过期围栏；Desktop 原生认证及事务规则保持。新增迁移已经应用到 schema 165。正式切换前先旁路验证完整运行时，使用与实际 PostgreSQL 18.4 兼容的独立工具备份应用数据库。未更改系统数据库、系统工具链、网络配置或其他业务服务，也未把备份清单检查冒充完整灾备恢复演练。

真实营销分析观察在同一任务中经历一次 `chart_render` 执行前输入校验失败，随后正确修正并交付 9 份实际文件，包含 PNG、SVG、HTML、CSV、证据与 ZIP，收费 HK$0.306432。累计 12／12 类代表性功能样例有文件证据；这些样例不能替代 19 角色／50 Skills 的专业业务交付验收，也不能反推出原历史失败的确切原因。

最终 Desktop 安装包的实际登录、固定 Codex 字节、无边框／无菜单，以及与正式 Web 相同的 13 种分析口径、六次同字节导出、双语／双主题和布局已经核对。受控工具错误场景与实际正式站点录制分别标注。725 项相关通过证据区分本轮执行和原样源码沿用，原失败轮次保持失败。

应用沿已有 63070／63071／63072 及静态、下载入口更新。发布后的只读检查确认 9 份网络配置、实时路由／规则、原凭证、数据库和代理进程保持一致。公网存在默认协议、部分 DNS 地址及并行大文件传输不稳定的实际记录；本机验证选择 HTTP/1.1 和另一个当前公网地址，不代表修复了正常公网路径。服务器网络修改未获授权且未实施。

全部 102 条要求／32 组范围继续保留。外部视频／语音、营销授权、企业 IdP、全设备安装升级、大文件、并发、长稳、灾备、专业签收和 WorkBuddy 同题盲测仍独立开放。本轮发布不声明整个产品目标完成。

English: Release safe Codex tool feedback, durable truthful delivery outcomes and independently fenced cloud leases while preserving native Desktop behavior and company-only AI. The actual marketing correction delivered nine files for HKD 0.306432 after a proven pre-execution validation failure. Actual final clients, distinct qualified test evidence and retained failures are documented separately. Server networking, credentials, database and proxy processes remain unchanged. Default public paths, complete professional/external/production qualification and the full original 102-requirement scope remain open.
