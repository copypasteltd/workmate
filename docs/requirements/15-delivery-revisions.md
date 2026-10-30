# 成果修改与新版本交付

本项补充当前需求，约束客户收到成果后的修改流程。原有三端职责、Codex 唯一内核、公司 OpenAI 兼容网关、企业隔离、预算及管理后台权限继续适用。

客户从原聊天或交付审阅区点击“以这份成果继续修改”，选择整份交付、文字答复、单个文件、文字选段、图片区域或视频时段，填写具体要求，明确确认本次预算后开始修改。新工作沿用原角色版本、关联原任务并生成新的成果；原成果及原任务费用保留。

| 编号 | 功能要求 | 交付约束 |
| --- | --- | --- |
| REV-01 | 原聊天及交付区提供修改入口 | Web、原生 Chrome 右侧栏均可进入；不强制跳转高级工具 |
| REV-02 | 引用确切交付版本 | 原任务版本、交付摘要、素材版本和内容摘要必须一致；过期选择要求重新核对 |
| REV-03 | 引用确切文字 | 文字答复及 UTF-8 文件可选段；按 Unicode 字符计数，原文与引用必须逐字一致 |
| REV-04 | 标记图片区域 | 支持拖选及比例输入；坐标必须位于所选原图范围内。区域是修改意见的位置，不自动授予编辑操作或掩膜权限 |
| REV-05 | 标记视频时段 | 仅对已保留有效时长的原视频开放；起止时间必须位于原片内。未取得时长仍能选择整个文件 |
| REV-06 | 单独确认预算 | 开始修改会创建一笔新工作及其预算预留；浏览、核对或预览不触发模型调用和扣费 |
| REV-07 | 保留原执行位置 | Web／Extension 使用云端 Codex；Desktop 从原本机会话交由本机 Codex 处理，不回退云端 |
| REV-08 | 本机权限不扩大 | 沿用当前有效的本机权限与原目录绑定；撤权、改目录、换会话、未完成工作均不能绕过原本机执行规则 |
| REV-09 | 网络异常可安全重试 | 保留原提交内容和请求标识；重试返回原任务。相同标识携带不同要求应拒绝；本机执行记录跨重启保留 |
| REV-10 | 来源持续有效 | 源素材撤回、删除、隔离、过期或换版后，后续读取及完成交付不得继续使用旧来源；单独增加审阅不改变文件身份 |
| REV-11 | 审批流程继续生效 | 团队、方案试用、媒体特效、GEO 观察、SEO 修改和专属云电脑从其原工作流程提出修改；不借此绕过原确认步骤 |
| REV-12 | 版本和费用可追溯 | 新任务保留父任务、角色、来源版本、修改位置与审计事件；管理员依现有权限查看任务和消耗，不因此获得私有正文访问权 |

当前边界：文本预览至多 1 MiB；图片／MP4 内嵌预览至多 4 MiB；超过预览范围仍可下载后按完整文件提出修改。整份修改至多引用 20 个成果文件，超过时选择具体文件，禁止静默漏选。修改意见最多 6,000 个字符，文字引用最多 4,000 个 Unicode 字符。预算输入范围 HKD 0.01–10,000，仍受当前计划、钱包、项目上限和角色能力约束。

本轮不将区域意见解释为专业媒体编辑质量验收，也不将少量合成交付视为全部角色、设计工程、分享和跨环境恢复已通过。完整需求状态继续记录在[编号清单](../quality/remaining-work-stage138.md)。

## English

Customers can revise an exact existing delivery from its original chat or delivery review. They choose the complete delivery, answer, file, quoted text, image region or verified video interval, describe their changes and explicitly confirm a new budget. A separate task retains the fixed role, source identity and parent relationship; original files and charges are retained.

Web and the native Chrome right side panel run revisions in cloud Codex. Desktop revisions execute actual local Codex in the original local session under its current revocable permissions. No additional OS permissions or cloud fallback are granted. Network retries retain the original request identity and body; native dispatch records survive restart. Source revocation and replacement fence subsequent execution. Specialist workflows retain their own approvals.

Text previews are limited to 1 MiB and inline image/MP4 previews to 4 MiB. Complete-file revisions remain available for larger or unsupported preview formats. Complete-delivery revisions accept at most 20 selected files. Video intervals require retained valid duration. Feedback anchors are not pre-approved media edits, image masks or professional-quality acceptance.
