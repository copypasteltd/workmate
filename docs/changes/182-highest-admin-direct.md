# 阶段182更新 / Stage182 changes

- 最高管理员可直接执行模型发布/回滚、费用、VIP、方案及账户/成员等管理操作；其他角色保留业务审批策略。
- 支持最高管理员直接处理原有待审批申请，并保留原版本、摘要、期限和实际操作者；不批量自动执行。
- Admin 同步移除最高管理员自己的审批页面拦截，明确区分直接执行与独立审批。
- 追加数据库迁移160和直接执行审计，保留旧事实及独立审批记录。敏感操作权限、MFA、范围、限额及证据核对继续生效。

Highest administrators can execute protected administrative changes directly; other roles retain their business approval policies. Existing pending requests can be explicitly executed without inventing another reviewer. The Admin UI, business executors and additive schema160 record the actual execution mode and retain immutable audit. Permissions, MFA, scopes, limits and evidence checks remain enforced.

[需求 / Requirements](../requirements/182-highest-admin-direct.md) · [设计、使用和逻辑图 / Design, usage and diagram](../development/182-highest-admin-direct.md) · [实际核查 / Evidence](../quality/highest-admin-direct-182.json)
