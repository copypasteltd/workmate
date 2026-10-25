# 首项工作与安全重试 / First work and safe retries

Web 工作台的三类快捷入口选择对应设计、分析和开发角色。新工作表单保存当前分頁中按用户、企业及项目隔离的草稿；关闭/重新整理及同一账户过期后重新验证可恢复。明确登出清除正文。

请求结果未知时保留原参数和创建身份，重新打开后显式重试同一请求。确认成功先保存原工作入口；客户明确开始另一项才创建新工作。已移除结果不重放，晚到响应不跳转到客户新选择的项目。

验证状态以当前检查点和原始回执为准。原生 Desktop、云端 Side Panel、公司 AI 网关及全部原 102 项验收目标保持；本增量不代表完整登录矩阵、十二角色或真实专业质量已验收。

English: Web shortcuts choose the corresponding design, marketing-analysis and engineering roles. Actor/tenant/project scoped tab drafts survive closure, reload and same-account reauthentication. Explicit sign-out clears draft text. Unknown submissions retain exact parameters and identity; confirmed receipts open the original work, and another task requires an explicit new intent. Removed replies never rerun the original request, and late replies cannot navigate into another selected project. Actual evidence and remaining full-product gates are recorded separately.

[方案及边界](../technical/89-first-work-and-submission-recovery.md) · [完整差异](../quality/2026-10-25-goal-gap-summary.md)

阶段 89：Web 首次建项目、设计/分析/开发角色入口及按账户/企业/项目隔离的草稿；离线、过期重登、已提交后回包丢失、精确重试、原工作回执、晚到响应与记录移除均有实际浏览器检查。14 项浏览器检查和 195 项客户端单元通过；实际 Worker 交付与下载文件字节一致，同一请求只有一项任务、一份预留，结算 30 港币微额。回复内容为明确假数据，本 UI 测试未启动原生 Codex。完整登录/跨端矩阵、至少十二个合格角色、全部 102 项条件和 G01–G10 继续开放。

Stage 89 verifies Web first-work onboarding, design/analysis/development shortcuts and actor/tenant/project scoped tab drafts. Fourteen actual browser checks and 195 client unit tests pass, including offline handling, expired-session reauthentication, committed response loss, exact retries, receipts, late responses and removed results. Real Worker delivery/download bytes agree; the original request has one task, one reservation and a 30-micro-HKD settlement. Reply content is explicitly synthetic; this UI fixture does not launch native Codex. The full login/client matrix, twelve qualified professional roles, all 102 complete conditions and G01–G10 remain open.

[当前证据](../quality/work-intake-checkpoint.json) · [媒体解码](../quality/work-intake-media-review-01.json)
