# 用户目录运营筛选 / Operational user-directory filters

本项落实管理后台原需求（REQ-084），不新增独立用户端，也不改变 Desktop 本机 Codex、Extension 右侧栏和云端 Codex 的分工。适用于当前源码分支；已冻结 v0.1.0 ZIP 及标签不包含阶段168，仍保持原字节。

## 用户流程 / Operator journey

管理员以独立邮箱验证码和 TOTP 登录，打开用户列表，展开筛选，将注册/访问时间、企业/项目、账户状态、VIP、费用和角色条件组合。套用后显示当前权限内的匹配用户，URL 保存条件；刷新和进入详情后返回恢复条件。详情分别呈现注册来源、最近登录及最近账户访问。

An independently authenticated Admin combines directory conditions, applies them, opens a user and returns with the same URL filters. Reload restores conditions. Login, registration origin and authenticated account access remain separate facts.

|编号|条件|业务口径|
|---|---|---|
|1|注册时间/来源|下限含、上限不含；新邮箱验证码建号记 `email_otp`，历史来源为空，不因再次登录补造来源。|
|2|最近账户访问|仅有效用户会话在通过 CSRF 后的认证访问；包含原生设备后台轮询。最多每分钟记录一次；不代表真人在线，不改变账户或认证版本。未知记录可单独筛选。|
|3|VIP 方案/状态/到期|全部条件匹配同一项个人或企业授予，排除 starter。生效状态额外检查用户、企业和当前成员资格；支持计划中、已到期、暂停、撤销。有效到期使用替代授予后的实际截止时间。|
|4|已确认扣费范围|港币微单位，精确整数；上下限均含。按实际任务发起人的 `charge` 账目和指定账目期间统计；不混入预留、待确认费用或退款。零不代表免费或已完成对账。|
|5|费用异常|查询待对账任务或工具操作；“无待对账”仅针对当前可读范围。此项不宣称统计异常检测。|
|6|角色使用|按实际任务发起人和角色键，区分已建立与已开始（attempt>0）；角色/待对账使用所选期间内建立的任务。|
|7|可用额度|至少一个当前可读关联账户满足比较条件。逐账户计算余额＋授信－预留－到期未预留赠额，不合并个人和企业资金。比较额默认1微港币；未知/账务不一致不作不足或充足分类。|
|8|权限/分页|费用、VIP、账务字段各需独立权限；每个结果同时受当前用户与业务范围约束。签名游标绑定全部条件、会话、权限及稳定创建时间/ID顺序；目录读取不写账。|

原目录联系信息权限、审计、近期 MFA、明确拒绝优先和服务端分页继续适用。筛选只帮助运营定位，不发放权限、不承诺某个具体任务一定可执行，也不会自动付费、充值或改变 VIP。

Current user/field scopes, recent MFA, explicit denies, auditing and signed pagination continue to apply. Filtering performs no funding, entitlement or billing mutation. Balance classifications concern individual readable accounts, rather than pooled funds or guaranteed task affordability.

## 兼容与交付 / Compatibility

`GET /v1/admin/users` 和用户详情默认响应保持旧严格契约；Admin 显式传 `view=operations` 才增加 `registration_source` 与 `last_active_at`。扩展条件及响应见 [机器契约](../contracts/admin-directory-operations-168.json)。用户端不接受这些管理查询。

数据库需要完整迁移001–156和匹配的新 API/Worker。升级先停止旧 API/Worker，备份数据库并执行迁移，再启动匹配版本；旧冻结 v0.1.0 服务只支持155，不能与156库混用。156保留历史字段为空，不推测历史活动。回退应使用升级前备份及对应服务。

The default directory DTO stays unchanged; `view=operations` opts into the two new fields. Deploy schema156 with matching API/Worker after stopping the previous services and backing up. Frozen v0.1.0 requires schema155. Historical unknowns are preserved.

详细实现、当前定向检查及原待办见 [开发说明](../development/168-admin-directory-operational-filters.md)、[本轮更新](../changes/168-admin-directory-operational-filters.md)。原完整授权/运营矩阵和真实外部服务验收继续跟踪。
