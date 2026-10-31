# 158 · v0.1.0-rc.2 完整冻结交付 / Complete current freeze

- 当前六仓及数据库155版进入新的冻结候选版；旧148版不变。
- 通用demo入口校验Codex pin和四个配套文件；bootstrap按锁定依赖构建，首次独占生成配置，支持明确选择本机数据库端口。
- 本机数据库启动拒绝既有活进程；停止只针对当前实际子进程与完整postmaster记录，失败启动不会停止其他实例。
- 补齐当前源码快照、运行文件配套、七类分发包及complete ZIP、双语README、实际截图与GIF/MP4、版本清单和校验值。
- 六端构建、3项配置场景、实际源码首次任务下载和当前Windows包启动通过；按用户要求省略大范围重复回归。
- 真实提供方、签名安装更新和完整验收矩阵保持原编号范围；当前HTTPS凭据的GitHubRelease渠道返回403，SSH分支/标签单独核对。

Current schema155 sources are frozen as a new candidate. The generic synthetic-demo entry verifies the pinned four-file Codex runtime, supports explicit local database ports and preserves existing configuration/processes. All six builds, focused initializer cases, a fresh-source first task/download and current packaged Windows launch qualify the artifacts. Seven distributions and a complete ZIP include bilingual instructions, real media and checksums. Broad regression is deliberately skipped; production providers, signing and full acceptance remain separately tracked.
