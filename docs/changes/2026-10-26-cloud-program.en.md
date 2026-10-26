# Actual cloud software checks and source-bound delivery


## 阶段 99 云端程序检查 / Stage 99 cloud program checks

云端 Codex 新增固定 Node 程序、内置测试及语法检查工具。原生 AppContainer/单进程 Job 限制网络、文件和进程；超时、取消及宿主中断须实际清理。回执绑定确切源码，失败及旧版本不可冒充当前通过。Web 显示实际输出、版本状态和下载；Desktop 保持客户本机执行。83 项相关测试与 4 项登录 Web 流程使用假模型和额度，实际运行 Codex、原生程序及 PostgreSQL。

Cloud Codex can run pinned Node programs, built-in tests and syntax checks inside a native AppContainer and single-process Job. Receipts bind exact source; failures and stale versions cannot become current passes. Web exposes output and authorized downloads. Desktop remains customer-local. The 83 related tests and four Web journey checks use synthetic model responses and credit with actual Codex, native execution and PostgreSQL.

[Design / 设计](../technical/99-cloud-program-execution.md) · [Evidence / 证据](../quality/cloud-program-checkpoint.json). Original requirement and gate decisions remain unchanged; the other three cloud development tools and full professional acceptance remain unproven.
