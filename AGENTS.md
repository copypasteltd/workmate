# 项目执行约束

- 唯一开发、构建和执行根目录为 `D:\dev\copypasted\自有agent\`；所有命令显式使用此工作目录，后续代码、配置及产物都在此根目录内维护。
- 实际产品代码、开发脚本、依赖、构建产物统一位于 `dev/`；各端是独立 Git 仓库。仓库随附的中英双语 README、截图及运行说明保存在各仓库内，以满足独立交付；项目主文档仍以 `docs/` 为准。
- 所有项目文档、文档工具与核查报告统一存放在 `D:\dev\copypasted\自有agent\docs\`。路径维护规则见 [工作区规范](docs/governance/03-workspace-and-path-policy.md)。
- 旧的 C 盘入口仅用于兼容当前会话；不得在旧入口或 `.migration-source-backup` 中建立第二套开发工作区。迁移备份只用于恢复。
- Agent 内核唯一使用 Codex；全部 AI 请求经公司内部服务器，遵守当前开发文档的版本、权限与模型约束。
- CLIENT01：Desktop 必须在客户本机运行 Codex Agent，并提供客户可主动授予的完整本机权限；不得以云端 Agent 加文件桥接替代。Extension 使用 ChatGPT 式对话和附件结构，承担获准文件获取、读取及上传，Agent 在云端运行；保留原生右侧 Side Panel。权威补充见 docs/requirements/03-client-execution-amendment.md。
- 严禁调度任何本地 Docker、WSL 或其他虚拟化环境，使用原生工具开发和核查。
- 禁止修改服务器网络环境。DNS、hosts、路由、网卡、系统代理、防火墙、反代／Nginx及内网穿透配置只能只读检查；不得为部署改写或重载反代，不得调整其他业务的网络及服务。Workmate应用更新沿用已有端口、下载映射和静态入口，仅切换自身应用；记录并核对发布前后网络配置／实时规则、原凭证与数据库／代理进程。详见 docs/governance/05-server-network-preservation.md。
- 使用浏览器后，关闭本次调用创建且不再需要的页面、上下文及独立浏览器实例，释放内存；保留用户原有页面。
- 开发按完整轮次推进：先系统盘点原始需求、所有代码待办和未定事项，完成本轮可自主处理的全部代码包后，再统一构建、测试和联调；发现的问题汇总为整批修复后复验，不以逐模块开发/调测循环代替整轮交付。保留失败证据；外部配置、专业及生产验收不得通过缩小目标或清除 TODO 标记自动判定完成。
- 各端独立仓库按 [Git 分支与同步规则](docs/governance/04-git-branches-and-publication.md) 发布至 `git@github.com:copypasteltd/workmate.git` 的对应分支；后续代码修改需同步中英双语 README、相关实际截图/交互 GIF 和更新说明，再提交并推送。用户已经授权此持续同步，不重复询问常规推送权限；不得强推覆盖其他人的工作。
