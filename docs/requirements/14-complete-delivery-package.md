# 完整交付包与业务闭环

本补充落实用户要求的主要功能闭环：提交目标 → 补充资料 → 原任务执行 → 确认交付 → 下载成果 → 按原对话继续修改。它细化 REQ-012、REQ-022、REQ-035、REQ-036、REQ-039、REQ-060、REQ-073 和 REQ-078；不改变这些原始需求的完整验收范围。

1. 客户可以从 Web 或 Chrome 右侧栏的原对话直接下载某次任务的全部现有交付物。任务审阅区也必须提供入口，具备只读项目权限的客户可以下载共享成果。
2. Desktop 提供相同的已提交成果导出能力，使用原生保存窗口并检查下载完整性。取消保存不能显示成功。本机 Codex 和客户本机工作区仍按 CLIENT01 在本地执行；没有提交为云端交付的本机文件不得自动加入云端压缩包。
3. 每个包包含实际交付文件、文字答复（如有）、固定版本清单、SHA-256 校验列表及中英双语编辑说明。相同名字的多个文件必须同时保留，不能互相覆盖。
4. 任务失败或取消后已有的成果可以导出，必须明确标示为部分成果。尚未结束的工作、规划任务和没有成果的任务不得伪造成功交付。
5. 导出绑定任务版本及交付摘要。导出期间发生版本、项目访问、素材来源、保留期限或可见性变化，必须在发送压缩包前再次核查；发现不一致即拒绝整个包。
6. 任一文件大小或摘要不符，整个包失败，不得悄悄省略文件、替换为较新版本或发送半成品压缩包。
7. 下载不得调用 AI、创建新任务、增加 AI 费用或改变原预算预留。新的修改工作沿用原有授权、报价和预算确认流程。
8. 临时打包采用受控磁盘和流式读写，具备容量、并发、超时、断开清理及限流控制。达到服务容量时应明确拒绝，客户仍可使用独立文件下载。
9. Admin 原有企业、用户、项目、内容、保留和来源控制同样约束新导出接口；管理员身份本身不自动获得用户私有会话文件。下载授权形成审计事实。

可恢复性按实际格式说明：原始码包、SVG、PPTX、工程 JSON 与只读成片分别使用适合的编辑方式。不得将 PDF／PNG／MP4 或缺少来源的文件称为完整可编辑工程。完整跨环境恢复和真实专业业务质量按原需求继续验收。

## English

Customers download the available output of one exact terminal task directly from their original Web or native Chrome side-panel conversation, or from delivery review. Desktop uses its native save dialog and checksum validation; cancelling is not success. Local Codex execution and local-only workspace files remain local.

The archive contains actual outputs, task text when present, fixed versions, checksums and bilingual editing instructions. Partial outputs remain explicitly partial. Every file must pass verification; no newer version, silent omission or fabricated source project is permitted. Authorization, source availability, retention and the selected delivery are checked again after construction. Exporting creates no AI execution or charge. Existing administrative controls and customer privacy continue to apply.

[实现与约束](../technical/137-complete-delivery-package.md) · [客户端方向](03-client-execution-amendment.md)
