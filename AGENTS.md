# 项目执行约束

- 唯一开发、构建和执行根目录为 `D:\dev\copypasted\自有agent\`；所有命令显式使用此工作目录，后续代码、配置及产物都在此根目录内维护。
- 实际产品代码、开发脚本、依赖、构建产物统一位于 `dev/`；各端是独立 Git 仓库。仓库随附的中英双语 README、截图及运行说明保存在各仓库内，以满足独立交付；项目主文档仍以 `docs/` 为准。
- 所有项目文档、文档工具与核查报告统一存放在 `D:\dev\copypasted\自有agent\docs\`。路径维护规则见 [工作区规范](docs/governance/03-workspace-and-path-policy.md)。
- 旧的 C 盘入口仅用于兼容当前会话；不得在旧入口或 `.migration-source-backup` 中建立第二套开发工作区。迁移备份只用于恢复。
- Agent 内核唯一使用 Codex；全部 AI 请求经公司内部服务器，遵守当前开发文档的版本、权限与模型约束。
- 严禁调度任何本地 Docker、WSL 或其他虚拟化环境，使用原生工具开发和核查。
- 使用浏览器后，关闭本次调用创建且不再需要的页面、上下文及独立浏览器实例，释放内存；保留用户原有页面。
- 各端独立仓库按 [Git 分支与同步规则](docs/governance/04-git-branches-and-publication.md) 发布至 `git@github.com:copypasteltd/workmate.git` 的对应分支；后续代码修改需同步中英双语 README、相关实际截图/交互 GIF 和更新说明，再提交并推送。用户已经授权此持续同步，不重复询问常规推送权限；不得强推覆盖其他人的工作。
