# 开发工作区与文档路径规范

版本：1.6 · 2026-10-18 · 来源 PATH01：用户要求将当前完整项目迁移至指定 D 盘目录，并统一后续开发及文档位置。

## 1. 唯一工作区

项目根目录固定为 `D:\dev\copypasted\自有agent\`，包括 Git 元数据、现有文档及后续代码、配置、构建与交付产物。后续 shell、编辑器、脚本及自动任务均直接使用该目录作为工作区；不能只修改项目显示名称。

实际代码、开发脚本、依赖、原生数据库数据及构建产物统一放在根目录 `dev/`，六个独立 Git 仓库分别维护，不将产品源码放在根目录或 docs。各端的中英 README、流程图、页面截图、许可和运行证据按用户最新要求随仓库交付；它们是明确的独立仓库交付附件。主需求、设计、治理和汇总质量文档仍放在 `D:\dev\copypasted\自有agent\docs\`，沿用现有 product、requirements、technical、modules、governance、research、contracts 和 quality 分类。文档生成工具保存在 docs/tools，核查报告写入 docs/quality。

文档内部链接使用相对路径；工具以脚本所在位置推导 docs 根目录，避免硬编码旧的 C 盘路径。根目录 AGENTS.md 是执行约束入口，具体业务说明仍在 docs 中维护。

## 2. 迁移与兼容入口

迁移覆盖原项目的全部 109 个文件、23 个目录及隐藏的 .git，复制后逐文件核对大小和 SHA-256。迁移前清单及结果保存在 [迁移记录](../quality/workspace-migration.json)，不将文档与契约校验写成产品已实现。

当前会话占用原目录句柄，因此保留旧的空目录作为兼容入口，使用目录链接访问新工作区的 docs 和 .git，并提供新路径执行指引；项目内容实际位于 D 盘。开发、构建和新增文件必须直接使用上方指定根目录。

迁移过程的原始文件保存在项目根下 `.migration-source-backup`，只供恢复，不作为工作区或文档权威来源；不从其中构建、检索需求或生成文档。该目录通过本仓库本地 Git 排除规则忽略。正式文档与工具均使用 docs 下的当前版本。

## 3. 新位置核查

在项目根目录依次执行以下原生命令：

    python -B -X utf8 docs/tools/build_contracts.py
    python -B -X utf8 docs/tools/build_quality.py
    python -B -X utf8 docs/tools/validate_docs.py

核对 Git 根目录、文档相对链接、机器契约和既有视觉证据输入摘要。迁移本身不启动浏览器、内部 AI、产品服务或本地虚拟化环境。实际结果见 [静态核查报告](../quality/validation-report.json) 与迁移记录。

## 4. 后续约束

新增工作继续使用 Codex 唯一内核和公司内部 AI 网关；不得因更换工作目录改变既有需求、权限或模型选择。禁止本地 Docker、WSL 及其他虚拟化环境，浏览器调用结束后释放自建且不再需要的标签页、上下文和实例。

## 5. 本轮代码实施

六仓库、启动/关闭、版本锁定及实际实现边界见 [实施清单](../technical/12-implementation-and-repositories.md)，真实代码与页面验收见 [验收记录](../quality/04-implementation-acceptance.md)。根仓库忽略 dev 下的独立代码仓库，避免把嵌套仓库误作没有内容的子模块。旧迁移清单保持原始快照，不重写历史摘要。
