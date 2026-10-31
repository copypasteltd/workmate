# v0.1.2 冻结 / Freeze

本轮交付全部端和当前源码，补齐阶段172尚未进入完整包的入账期间报表。Backend/Admin重新构建；Web/Extension/Desktop/Delivery运行产物与阶段170逐文件一致后复用，Windows完整目录、Portable、Setup不重新打包。先提交所有手册和发布工具，再建立七个新固定标签，封装七类分发和完整ZIP，核对资产摘要后发布GitHub Release。旧归档/标签不变。

This freeze includes all clients/current source and the stage172 posting-period reports missing from the previous bundle. Backend/Admin are rebuilt; unchanged runtime outputs and Windows distributions are verified and reused. All handbooks/helpers are committed before seven new fixed tags. Seven distributions plus a complete bundle are published after asset digest verification; previous archives/tags remain immutable.

继承源码一致的阶段172：8项新原生SQL/API、1项精确投影、6项既有SQL/API、7组实际Admin/CSV旅程；本轮不重跑功能测试或广泛历史回归。外部假数据、Windows未签名及完整专业/跨系统验收待办保持。

Inherit exact-source stage172 focused results without rerunning functional/broad regression tests. Authorized synthetic dependencies, unsigned Windows and professional/cross-OS acceptance remain explicit limits.

[使用 / Guide](../releases/v0.1.2.md) · [冻结记录 / Record](../quality/release-freeze-checkpoint-173.json) · [原编号待办 / Ledger](../quality/remaining-work-stage172.md)
