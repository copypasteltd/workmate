# Stage149 更新 / Changes

| 编号 | 事项 | 状态 |
|---|---|---|
| 1 | 管理专用项目目录、状态/搜索/分页、编辑和归档恢复 | 已实现 |
| 2 | 最后项目归档后恢复入口、资料与身份保留 | 已实现并验证 |
| 3 | 锁等待后权限复查、预期状态冲突、幂等重放 | 已实现；10项后端检查通过 |
| 4 | Web/Desktop旧列表、恢复选中及提交前会话竞争 | 已修复；5组实际界面旅程通过 |
| 5 | 双语README、4张PNG、2组GIF/MP4与独立源码分支 | 随本轮同步 |
| 6 | 首个冻结版及五个ZIP | 保持原样；149为未冻结后续修复 |
| 7 | 聚合整删、完整导出、真实服务和签名更新 | 待处理；完整验收保持开放 |

Project management is restored end to end on Web and native Desktop. Ten focused backend cases, five actual client groups and six build steps passed. The original failed backend verifier is retained with its corrected successor. Broad regressions were deliberately omitted. Original frozen tags and archives are not replaced. Aggregate erasure and the remaining full acceptance scopes remain open.

[实现及使用 / Implementation and usage](../development/149-project-management.md) · [完整编号 / Full ledger](../quality/remaining-work-stage149.md)
