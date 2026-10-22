# 2026-10-22 客户端执行方向修订（CLIENT01）

用户明确 Desktop 必须在客户本机运行 Codex Agent，允许客户主动授予完整本机权限，操作能力对标 Codex Desktop；Extension 使用 ChatGPT 式对话和附件结构，在浏览器获取、读取并上传文件，由云端 Agent 执行。现有无边框及原生右侧栏、公司内部 AI 路由和 CopyPaste 品牌要求继续有效。

代码检查确认 Desktop 当前为云端 Codex 加受限文件桥接，不符合本机内核/完整权限要求。Extension 已有原生侧栏和基础上传，但任务表单主线需要调整。已同步 SRS 补充、PRD、决策、用户旅程、页面结构、架构、内核、权限、本地执行器、三端模块、交付差异与各端中英 README。

本次新增八项 Desktop、六项 Extension 补充验收，不删除或放宽原 102 项需求与 TC。未修改客户端运行代码，未创建调整后界面的虚构截图，也未以历史安装包/录屏认定新能力完成。

具体约束与计划：[CLIENT01](../requirements/03-client-execution-amendment.md)、[方向检查](../technical/69-desktop-local-codex-and-extension-direction.md)、[机器审计](../quality/client-direction-audit.json)。完整产品修复和新客户端交付仍在进行。
