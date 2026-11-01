# 最高管理员直接执行 / Highest-administrator direct execution

状态 / Status：阶段182；实施规则取代此前“所有管理员均须另一人审批”的描述。实际部署与验收见同编号开发文档及核查记录。

## 角色与审批规则 / Roles and approval policy

- 当前有效、已完成注册、全局绑定内置 `super_admin` 的管理员是最高管理员。前端不能自行声明此身份。
- 最高管理员可直接执行模型发布和回滚、费用与额度、VIP、方案发布、账号及成员变更；也可主动处理自己或其他管理员的现有待审批申请。
- 其他管理员按现有业务策略决定是否需要审批。需要审批时，申请人不能审批自己的申请，审批人还须具备对应业务权限和范围。
- 支付凭据、外部退款及供应商／音频证据核实同样支持最高管理员直接执行；凭据、实际金额、原始费率、版本及来源核对仍须通过。
- 每次敏感操作仍检查有效会话、近期 MFA、具体业务权限、范围、明确禁止项及金额等限制。过期申请须重新预览；此变更不会批量执行旧申请。
- 所有操作保留真实操作者、原申请人、原因、原命令摘要、执行模式和结果。最高管理员直接执行不得伪装成另一位管理员独立审批。

An active, enrolled administrator with an effective global binding to the built-in `super_admin` role is the highest administrator. Identity is determined by current server records. A copied permission list or tenant/project-scoped binding does not qualify.

Highest administrators can execute model publication/rollback, financial and VIP changes, plan publication, and account/membership changes directly. They can also explicitly execute existing pending requests. Other roles retain the current business approval policies and independent-review requirements. Direct payment/refund/provider/audio verification still requires valid original evidence, amounts, tariffs and versions.

Live sessions, recent MFA, business permissions, scopes, explicit denies and limits continue to apply. Expired commands need fresh previews. Actions retain actual actors, original requesters, reasons, frozen-command hashes, execution modes and outcomes. Direct execution must never invent an independent reviewer.

## 用户流程 / User flow

最高管理员：预览变更 → 核对内容及原因 → 确认直接执行 → 立即查看结果与审计。

普通管理员：预览变更 → 按策略直接执行或提交审批 → 由另一位授权管理员核对 → 查看结果与审计。

Highest administrator: preview → review the changes and reason → confirm direct execution → inspect the result and audit.

Other administrators: preview → execute or request review according to policy → another authorized administrator reviews where required → inspect the result and audit.

详细实现 / Implementation：[开发说明](../development/182-highest-admin-direct.md)。
