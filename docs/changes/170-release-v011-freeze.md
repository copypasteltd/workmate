# v0.1.1 发版 / Release


本版是在v0.1.0基础上冻结的完整更新包，加入用户运营筛选及多维消耗报表。数据库迁移至156；服务端与Admin使用最新构建。用量页面支持固定快照、付款方／企业／项目／创建期间／能力／来源筛选、原账本与退款明细及同选择CSV。内部供应商实际成本明确未知，不用客户售价代替。

This complete update adds operational user filters and immutable consumption reports to v0.1.0. Use schema156 and matching backend/Admin builds. Reports distinguish confirmed charges, consumption refunds, holds and reconciliation, with payer/project/capability/source filters, original ledger detail and same-snapshot CSV. Actual supplier cost is explicitly unknown.

**冻结检查范围 / Freeze checks**：沿用源码完全一致的阶段169 Backend/Admin构建、6项原生SQL/API和6组实际浏览器／CSV旅程；未改Web/Extension/Desktop/Delivery运行构建逐文件对照阶段167，Windows目录及两种安装包逐文件一致并复用。No broad historical rerun; unchanged clients are verified and reused. The earlier eight-case/eight-journey descriptions below are prior inherited evidence, not fresh checks for this update.

**已知限制 / Known limits**：已授权假数据；Windows未签名；正式提供方／真实供应商成本／按入账期间报表／完整专业业务和跨OS矩阵仍开放。完整源码及全部端交付不等于上述生产资格已验收。Existing frozen v0.1.0 assets/tags remain unchanged.

管理后台报表的时间条件是工作建立期间，显示该批工作截至快照的累计费用，不是费用入账期间；五分钟后需重新建立快照。A report is a work-creation cohort with cumulative accounting, not a posting-date report; refresh after the five-minute expiry.


[安装使用](../releases/v0.1.1.md)
