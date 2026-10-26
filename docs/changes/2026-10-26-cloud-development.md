# 云端实际程序检查与源码绑定交付


## 阶段 100 云端 API 与数据库检查 / Stage 100 cloud API and database checks

云端 Codex 新增真实 HTTP 应用请求及原生 SQLite 数据和约束检查工具。请求经匿名管道传输，不涵盖外部 TCP/TLS；SQL 验证使用新建 SQLite，并在原生调用前拒绝 PRAGMA、ATTACH、DETACH、VACUUM。原生 AppContainer/单进程 Job 限制网络、文件和进程；超时、取消及宿主中断须实际清理。回执绑定确切源码，失败及旧版本不可冒充当前通过。Web 显示实际输出、版本状态和下载；Desktop 保持客户本机执行。96 项相关测试与 4 项登录 Web 流程使用假模型和额度，实际运行 Codex、原生程序及 PostgreSQL。

Cloud Codex can run actual HTTP application requests and native SQLite data and constraint checks inside a native AppContainer and single-process Job. Receipts bind exact source; failures and stale versions cannot become current passes. Web exposes output and authorized downloads. Desktop remains customer-local. The 96 related tests and four Web journey checks use synthetic model responses and credit with actual Codex, native execution and PostgreSQL.

[Design / 设计](../technical/100-cloud-development-checks.md) · [Evidence / 证据](../quality/cloud-development-checkpoint.json). Original requirement and gate decisions remain unchanged; cloud browser preview, production model quality and full professional acceptance remain unproven.
