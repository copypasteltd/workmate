# 用户详情的任务与内容入口 · REQ-084 / REQ-090

本增量连接用户详情与已有任务、内容管理页。保留 rc.5 冻结文件和标签；当前分支向前更新。Admin 用户目录条件随返回链路保存。

1. 用户详情按权限提供“查看用户任务”和“查看用户内容”。页面、分页、搜索及刷新始终携带同一个 `user_id`，范围提示明确目标用户，并可返回原详情和原目录条件。
2. 后端接受 UUID 用户条件，要求独立 Admin 会话、当前近期 MFA、`admin.users.read` 及相应资源读取权限；列表逐行同时受用户可见范围和任务/内容范围约束，显式拒绝优先。
3. 任务按发起人 `created_by`，内容目录的二十类资源按实际创建者。品牌使用首版的客户作者，后续编辑不改变归属。作者未知的旧资料及系统记录不猜测为某位企业成员；在原全站目录按既有权限管理。
4. 目标用户不存在或当前不可见时返回相同的 404；无相应权限拒绝访问。过滤接口不扩展正文、下载或写操作权限，记录用户目标审计，响应 `no-store`。
5. 改变用户目标立即销毁旧行、正文与操作弹窗；读取失败保留该目标条件。全站导出、清理队列、其他人的计划等全局面板只在全站视图出现。

验收采用真实原生 PostgreSQL、实际 Admin OTP/TOTP 和页面交互；覆盖同企业不同作者、不同企业、显式拒绝、撤权、分页/搜索、未知作者及目标切换。外部服务仍使用已授权假数据。本增量不代表关闭原102项的完整专业和生产验收。

User detail links to creator-filtered task/content pages. Current Admin identity, MFA, user scope and resource scope intersect; explicit denies prevail. Original brand author attribution never follows a later editor. Unknown legacy authors remain unattributed. Search, pagination, refresh and return navigation retain the selected user. Body/download/write authority remains separate, target changes discard old dialogs, and failures never widen the filter. Frozen rc.5 stays immutable.
